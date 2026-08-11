import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { PrismaService } from "../prisma/prisma.service";
import {
  DirectoryRequestError,
  type HfliveDirectoryService,
} from "./directory.service";
import type { HfliveAuthConfig } from "./hflive-auth.config";
import {
  HfliveAuthService,
  usernamesMatchForLink,
} from "./hflive-auth.service";
import type { OidcTransactionService } from "./oidc-transaction.service";

describe("HfliveAuthService webhook and status convergence", () => {
  const webhookSecret = "phase-6-webhook-secret";
  const identity = {
    id: "identity-1",
    userId: "user-1",
    issuer: "https://auth.hsfz.live",
    subject: "subject-1",
    externalStatus: "ACTIVE",
    lastStatusEventAt: null,
  };
  const tx = {
    externalIdentityEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    externalIdentity: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
    },
    authenticationAuditEvent: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    externalIdentity: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    authenticationAuditEvent: { create: jest.fn() },
  };
  const config = {
    enabled: true,
    directoryClientId: "directory-client",
    webhookSecret,
    previousWebhookSecret: "",
    validationErrors: () => [],
    publicCapabilities: jest.fn(),
  };
  const directory = { getStatus: jest.fn(), getProfile: jest.fn() };
  let service: HfliveAuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (value: typeof tx) => unknown) => callback(tx),
    );
    process.env.SESSION_SECRET = "phase-6-session-secret";
    tx.externalIdentityEvent.findUnique.mockResolvedValue(null);
    tx.externalIdentity.findUnique.mockResolvedValue(identity);
    config.publicCapabilities.mockReturnValue({
      mode: "hybrid",
      localLogin: true,
      hfliveOidc: true,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });
    service = new HfliveAuthService(
      prisma as unknown as PrismaService,
      config as unknown as HfliveAuthConfig,
      {} as OidcTransactionService,
      directory as unknown as HfliveDirectoryService,
    );
  });

  it("returns only the signed-in user's safe identity context", async () => {
    prisma.user.findUnique.mockResolvedValue({
      status: "active",
      localPasswordEnabled: true,
    });
    prisma.externalIdentity.findUnique.mockResolvedValue({
      preferredUsername: "teacher",
      email: "teacher@example.invalid",
      displayName: "Teacher",
      picture: "https://auth.hsfz.live/api/profile/avatar/id?v=1",
      externalStatus: "ACTIVE",
      syncState: "CURRENT",
      syncErrorCode: null,
      lastProfileSyncedAt: new Date("2026-08-11T06:00:00.000Z"),
    });

    await expect(service.accountContext("user-1")).resolves.toMatchObject({
      linked: true,
      authoritative: true,
      localPasswordEnabled: true,
      identity: {
        preferredUsername: "teacher",
        externalStatus: "ACTIVE",
        lastProfileSyncedAt: "2026-08-11T06:00:00.000Z",
      },
    });
  });

  it("applies a signed DISABLED event and increments sessionVersion once", async () => {
    const occurredAt = new Date().toISOString();
    const body = Buffer.from(
      JSON.stringify({
        id: "event-1",
        type: "user.status.changed",
        clientId: "directory-client",
        subject: "subject-1",
        status: "DISABLED",
        occurredAt,
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    await service.processWebhook(body, {
      "x-hflive-event-id": "event-1",
      "x-hflive-timestamp": timestamp,
      "x-hflive-signature": `v1=${signature}`,
    });
    expect(tx.externalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalStatus: "DISABLED" }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sessionVersion: { increment: 1 } } }),
    );
    expect(tx.externalIdentityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "APPLIED" }),
      }),
    );
  });

  it("rejects a changed body before any database write", async () => {
    const body = Buffer.from("{}");
    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-1",
        "x-hflive-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-hflive-signature": `v1=${"0".repeat(64)}`,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("bypasses Directory entirely after runtime rollback to local mode", async () => {
    Object.defineProperty(config, "enabled", {
      value: false,
      configurable: true,
    });
    await expect(service.checkExternalSession("user-1")).resolves.toEqual({
      allowed: true,
    });
    expect(directory.getStatus).not.toHaveBeenCalled();
    Object.defineProperty(config, "enabled", {
      value: true,
      configurable: true,
    });
  });

  it("refreshes only after 15 minutes and grants at most 60 minutes of outage grace", async () => {
    prisma.externalIdentity.findUnique.mockResolvedValue({
      ...identity,
      lastStatusConfirmedAt: new Date(Date.now() - 20 * 60_000),
    });
    prisma.externalIdentity.updateMany.mockResolvedValue({ count: 1 });
    directory.getProfile.mockRejectedValue(
      new DirectoryRequestError("UNAVAILABLE"),
    );
    await expect(service.checkExternalSession("user-1")).resolves.toEqual({
      allowed: true,
      degraded: true,
    });

    prisma.externalIdentity.findUnique.mockResolvedValue({
      ...identity,
      lastStatusConfirmedAt: new Date(Date.now() - 61 * 60_000),
    });
    prisma.externalIdentity.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.checkExternalSession("user-1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("returns retryable without any event row when Directory refresh fails for a profile event", async () => {
    const body = Buffer.from(
      JSON.stringify({
        id: "event-profile-fail",
        type: "user.profile.changed",
        clientId: "directory-client",
        subject: "subject-1",
        occurredAt: new Date().toISOString(),
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    directory.getProfile.mockRejectedValue(
      new DirectoryRequestError("UNAVAILABLE"),
    );

    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-profile-fail",
        "x-hflive-timestamp": timestamp,
        "x-hflive-signature": `v1=${signature}`,
      }),
    ).resolves.toEqual({ kind: "retryable" });
    // 瞬态失败不写事件行、不改 syncState：重试不会被幂等去重挡掉。
    expect(tx.externalIdentityEvent.create).not.toHaveBeenCalled();
    expect(tx.externalIdentity.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns retryable without touching lastStatusEventAt when ACTIVE calibration fails", async () => {
    const occurredAt = new Date().toISOString();
    const body = Buffer.from(
      JSON.stringify({
        id: "event-active-fail",
        type: "user.status.changed",
        clientId: "directory-client",
        subject: "subject-1",
        status: "ACTIVE",
        occurredAt,
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    directory.getStatus.mockRejectedValue(
      new DirectoryRequestError("UNAVAILABLE"),
    );

    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-active-fail",
        "x-hflive-timestamp": timestamp,
        "x-hflive-signature": `v1=${signature}`,
      }),
    ).resolves.toEqual({ kind: "retryable" });
    expect(tx.externalIdentity.update).not.toHaveBeenCalled();
    expect(tx.externalIdentityEvent.create).not.toHaveBeenCalled();
  });

  it("applies a confirmed ACTIVE event and a refetched profile via the shared path", async () => {
    directory.getStatus.mockResolvedValue({
      subject: "subject-1",
      status: "ACTIVE",
      updatedAt: new Date().toISOString(),
    });
    const occurredAt = new Date().toISOString();
    const body = Buffer.from(
      JSON.stringify({
        id: "event-active-ok",
        type: "user.status.changed",
        clientId: "directory-client",
        subject: "subject-1",
        status: "ACTIVE",
        occurredAt,
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");

    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-active-ok",
        "x-hflive-timestamp": timestamp,
        "x-hflive-signature": `v1=${signature}`,
      }),
    ).resolves.toEqual({ kind: "applied" });
    expect(tx.externalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalStatus: "ACTIVE",
          lastStatusEventAt: new Date(occurredAt),
          syncState: "CURRENT",
        }),
      }),
    );
    expect(tx.externalIdentityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "APPLIED" }),
      }),
    );
  });

  it("applies a profile event and always writes displayName, username only without conflict", async () => {
    const profile = {
      subject: "subject-1",
      status: "ACTIVE" as const,
      preferredUsername: "teacher_new",
      name: "New Display Name",
      picture: "https://auth.hsfz.live/api/profile/avatar/id?v=5",
      email: "teacher@example.invalid",
      emailVerified: true,
      updatedAt: new Date().toISOString(),
    };
    directory.getProfile.mockResolvedValue(profile);
    tx.externalIdentity.findUnique.mockResolvedValue(identity);
    tx.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      username: "teacher_old",
    });
    tx.user.findFirst.mockResolvedValue(null);
    const body = Buffer.from(
      JSON.stringify({
        id: "event-profile-ok",
        type: "user.profile.changed",
        clientId: "directory-client",
        subject: "subject-1",
        occurredAt: new Date().toISOString(),
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");

    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-profile-ok",
        "x-hflive-timestamp": timestamp,
        "x-hflive-signature": `v1=${signature}`,
      }),
    ).resolves.toEqual({ kind: "applied" });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: "New Display Name",
          username: "teacher_new",
          emailNormalized: "teacher@example.invalid",
        }),
      }),
    );
    expect(tx.externalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          picture: "https://auth.hsfz.live/api/profile/avatar/id?v=5",
          syncState: "CURRENT",
          lastProfileSyncedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("marks PROFILE_CONFLICT and still writes displayName when another user holds the username", async () => {
    const profile = {
      subject: "subject-1",
      status: "ACTIVE" as const,
      preferredUsername: "teacher_new",
      name: "New Display Name",
      picture: null,
      email: null,
      emailVerified: false,
      updatedAt: new Date().toISOString(),
    };
    directory.getProfile.mockResolvedValue(profile);
    tx.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      username: "teacher_old",
    });
    tx.user.findFirst.mockResolvedValue({ id: "user-2" });
    const body = Buffer.from(
      JSON.stringify({
        id: "event-profile-conflict",
        type: "user.profile.changed",
        clientId: "directory-client",
        subject: "subject-1",
        occurredAt: new Date().toISOString(),
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");

    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-profile-conflict",
        "x-hflive-timestamp": timestamp,
        "x-hflive-signature": `v1=${signature}`,
      }),
    ).resolves.toEqual({ kind: "applied" });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ username: "teacher_new" }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayName: "New Display Name" }),
      }),
    );
    expect(tx.externalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          syncState: "PROFILE_CONFLICT",
          syncErrorCode: "PROFILE_CONFLICT",
        }),
      }),
    );
  });

  it("admin sync pulls the directory profile and returns the refreshed identity status", async () => {
    const mockAdminTargetPair = () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: "admin-1",
          status: "active",
          systemRole: "super_admin",
        })
        .mockResolvedValueOnce({
          id: "user-1",
          status: "active",
          systemRole: "member",
        });
    };
    // adminSyncIdentity 前半段：权限校验 + 身份查找
    mockAdminTargetPair();
    prisma.externalIdentity.findUnique.mockResolvedValueOnce({
      id: "identity-1",
      userId: "user-1",
      subject: "subject-1",
    });
    directory.getProfile.mockResolvedValue({
      subject: "subject-1",
      status: "ACTIVE",
      preferredUsername: "teacher",
      name: "统一姓名",
      picture: null,
      email: "teacher@example.invalid",
      emailVerified: true,
      updatedAt: new Date().toISOString(),
    });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      username: "teacher",
    });
    tx.user.findFirst.mockResolvedValue(null);
    // adminSyncIdentity 尾部再次调用 adminIdentityStatus：权限校验 + 身份查找
    mockAdminTargetPair();
    prisma.externalIdentity.findUnique.mockResolvedValueOnce({
      subject: "subject-1",
      preferredUsername: "teacher",
      externalStatus: "ACTIVE",
      syncState: "CURRENT",
      syncErrorCode: null,
      linkMethod: "JIT",
      lastStatusConfirmedAt: new Date(),
      lastProfileSyncedAt: new Date(),
      directoryUpdatedAt: new Date(),
    });

    const result = await service.adminSyncIdentity("admin-1", "user-1");
    expect(result.linked).toBe(true);
    expect(result.identity).toMatchObject({
      preferredUsername: "teacher",
      syncState: "CURRENT",
    });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayName: "统一姓名" }),
      }),
    );
  });

  it("rejects admin sync for an unlinked target", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: "admin-1",
        status: "active",
        systemRole: "super_admin",
      })
      .mockResolvedValueOnce({
        id: "user-1",
        status: "active",
        systemRole: "member",
      });
    prisma.externalIdentity.findUnique.mockResolvedValue(null);

    await expect(
      service.adminSyncIdentity("admin-1", "user-1"),
    ).rejects.toThrow("该用户尚未绑定统一身份");
    expect(directory.getProfile).not.toHaveBeenCalled();
  });

  it("discards webhooks with 204 semantics while AUTH_MODE=local", async () => {
    Object.defineProperty(config, "enabled", {
      value: false,
      configurable: true,
    });
    const body = Buffer.from(
      JSON.stringify({
        id: "event-local-mode",
        type: "user.profile.changed",
        clientId: "directory-client",
        subject: "subject-1",
        occurredAt: new Date().toISOString(),
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    await expect(
      service.processWebhook(body, {
        "x-hflive-event-id": "event-local-mode",
        "x-hflive-timestamp": timestamp,
        "x-hflive-signature": `v1=${signature}`,
      }),
    ).resolves.toEqual({ kind: "ignored", reason: "HFLIVE_DISABLED" });
    expect(directory.getProfile).not.toHaveBeenCalled();
    expect(tx.externalIdentityEvent.create).not.toHaveBeenCalled();
    Object.defineProperty(config, "enabled", {
      value: true,
      configurable: true,
    });
  });

  it("periodic refresh repairs a stale profile while confirming an ACTIVE status", async () => {
    prisma.externalIdentity.findUnique.mockResolvedValue({
      ...identity,
      lastStatusConfirmedAt: new Date(Date.now() - 20 * 60_000),
    });
    prisma.externalIdentity.updateMany.mockResolvedValue({ count: 1 });
    directory.getProfile.mockResolvedValue({
      subject: "subject-1",
      status: "ACTIVE",
      preferredUsername: "teacher",
      name: "统一姓名",
      picture: "https://auth.hsfz.live/api/profile/avatar/id?v=9",
      email: "teacher@example.invalid",
      emailVerified: true,
      updatedAt: new Date().toISOString(),
    });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      username: "teacher",
    });
    tx.user.findFirst.mockResolvedValue(null);

    await expect(service.checkExternalSession("user-1")).resolves.toEqual({
      allowed: true,
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayName: "统一姓名" }),
      }),
    );
    // applyVerifiedProfile 写资料与 syncState
    expect(tx.externalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: "统一姓名",
          syncState: "CURRENT",
          lastProfileSyncedAt: expect.any(Date),
        }),
      }),
    );
    // 状态确认单独一次 update
    expect(tx.externalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalStatus: "ACTIVE",
          lastStatusConfirmedAt: expect.any(Date),
          statusRefreshLeaseUntil: null,
        }),
      }),
    );
  });
});

describe("HFLive legacy account username matching", () => {
  it("accepts the same normalized username", () => {
    expect(usernamesMatchForLink(" Teacher_01 ", "teacher_01")).toBe(true);
  });

  it("rejects a different HFLive username", () => {
    expect(usernamesMatchForLink("teacher_01", "teacher_02")).toBe(false);
  });
});
