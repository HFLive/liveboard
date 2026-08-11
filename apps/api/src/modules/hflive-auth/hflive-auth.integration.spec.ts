import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomUUID } from "node:crypto";
import { RedisService } from "../redis/redis.service";
import type { HfliveDirectoryService } from "./directory.service";
import type { HfliveAuthConfig } from "./hflive-auth.config";
import { HfliveAuthService } from "./hflive-auth.service";
import { OidcTransactionService } from "./oidc-transaction.service";

const suite =
  process.env.RUN_PHASE6_TESTS === "true" ? describe : describe.skip;
const redisIt = process.env.RUN_PHASE6_REDIS_TESTS === "true" ? it : it.skip;

suite("Phase 6 HFLive Auth persistence", () => {
  const database = new PrismaClient();
  const runId = randomUUID();
  const username = `phase6_${runId.replaceAll("-", "").slice(0, 16)}`;
  const subject = `phase6-subject-${runId}`;
  const eventId = `phase6-event-${runId}`;
  const webhookSecret = "phase-6-integration-webhook-secret";
  const config = {
    enabled: true,
    directoryClientId: "phase6-directory-client",
    webhookSecret,
    previousWebhookSecret: "",
    validationErrors: () => [],
  };
  const directory = { getStatus: jest.fn(), getProfile: jest.fn() };
  const transactions = {} as OidcTransactionService;
  const service = new HfliveAuthService(
    database as never,
    config as unknown as HfliveAuthConfig,
    transactions,
    directory as unknown as HfliveDirectoryService,
  );
  let userId: string | undefined;
  let mismatchUserId: string | undefined;
  let redisService: RedisService | undefined;

  beforeAll(() => {
    process.env.SESSION_SECRET = "phase-6-integration-session-secret";
  });

  afterAll(async () => {
    await database.externalIdentityEvent.deleteMany({ where: { eventId } });
    if (userId) {
      await database.authenticationAuditEvent.deleteMany({
        where: { subjectUserId: userId },
      });
      await database.user.deleteMany({ where: { id: userId } });
    }
    if (mismatchUserId) {
      await database.authenticationAuditEvent.deleteMany({
        where: { subjectUserId: mismatchUserId },
      });
      await database.user.deleteMany({ where: { id: mismatchUserId } });
    }
    await redisService?.onModuleDestroy();
    await database.$disconnect();
  });

  it("converges two concurrent JIT callbacks to one user and identity", async () => {
    const profile = {
      issuer: "https://auth.hsfz.live",
      subject,
      preferredUsername: username,
      email: `${username}@example.invalid`,
      emailVerified: true,
      displayName: "Phase 6 Integration",
      picture: null,
      directoryUpdatedAt: new Date().toISOString(),
    };
    const resolveLogin = (
      service as unknown as {
        resolveLogin(value: typeof profile): Promise<{ user: { id: string } }>;
      }
    ).resolveLogin.bind(service);
    const results = await Promise.all([
      resolveLogin(profile),
      resolveLogin(profile),
    ]);
    userId = results[0].user.id;
    expect(new Set(results.map((result) => result.user.id))).toEqual(
      new Set([userId]),
    );
    await expect(
      database.externalIdentity.count({
        where: { issuer: profile.issuer, subject },
      }),
    ).resolves.toBe(1);
    const user = await database.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user).toMatchObject({
      systemRole: "member",
      localPasswordEnabled: false,
    });
  });

  it("rejects linking an old user whose username differs from HFLive", async () => {
    const localUser = await database.user.create({
      data: {
        username: `old_${runId.replaceAll("-", "").slice(0, 16)}`,
        displayName: "Old account",
        passwordHash: "not-used-by-this-test",
        systemRole: "member",
        status: "active",
      },
    });
    mismatchUserId = localUser.id;
    const profile = {
      issuer: "https://auth.hsfz.live",
      subject: `mismatch-${subject}`,
      preferredUsername: `new_${runId.replaceAll("-", "").slice(0, 16)}`,
      email: null,
      emailVerified: false,
      displayName: "HFLive account",
      picture: null,
      directoryUpdatedAt: new Date().toISOString(),
    };
    const linkIdentity = (
      service as unknown as {
        linkIdentity(
          targetUserId: string,
          value: typeof profile,
          input: { method: "ADMIN"; linkedByUserId: string },
        ): Promise<unknown>;
      }
    ).linkIdentity.bind(service);

    await expect(
      linkIdentity(localUser.id, profile, {
        method: "ADMIN",
        linkedByUserId: localUser.id,
      }),
    ).rejects.toThrow("LiveBoard 用户名必须与 HFLive Auth 用户名一致");
    await expect(
      database.externalIdentity.count({ where: { userId: localUser.id } }),
    ).resolves.toBe(0);
  });

  it("rolls back the duplicate webhook transaction so sessionVersion increments once", async () => {
    const occurredAt = new Date().toISOString();
    const body = Buffer.from(
      JSON.stringify({
        id: eventId,
        type: "user.status.changed",
        clientId: config.directoryClientId,
        subject,
        status: "DISABLED",
        occurredAt,
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    const headers = {
      "x-hflive-event-id": eventId,
      "x-hflive-timestamp": timestamp,
      "x-hflive-signature": `v1=${signature}`,
    };
    await Promise.all([
      service.processWebhook(body, headers),
      service.processWebhook(body, headers),
    ]);
    const user = await database.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(user.sessionVersion).toBe(1);
    await expect(
      database.externalIdentityEvent.count({ where: { eventId } }),
    ).resolves.toBe(1);
  });

  redisIt(
    "uses real Redis GETDEL semantics for one-time OIDC state",
    async () => {
      const redis = new RedisService(
        new ConfigService({
          REDIS_URL: process.env.REDIS_URL,
          DEPLOYMENT_TARGET: "self_hosted",
        }),
      );
      redisService = redis;
      const store = new OidcTransactionService(redis);
      const state = `state-${runId}`;
      const value = {
        codeVerifier: "verifier",
        nonce: "nonce",
        returnTo: "/app",
        intent: "LOGIN" as const,
        createdAt: new Date().toISOString(),
      };
      await store.storeOidc(state, value);
      const attempts = await Promise.allSettled([
        store.consumeOidc(state),
        store.consumeOidc(state),
      ]);
      expect(
        attempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
    },
  );
});
