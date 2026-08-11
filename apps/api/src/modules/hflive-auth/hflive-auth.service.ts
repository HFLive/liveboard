import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type ExternalIdentity, type User } from "@prisma/client";
import type { HfliveAccountContext } from "@liveboard/shared";
import argon2 from "argon2";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  DirectoryRequestError,
  HfliveDirectoryService,
  type DirectoryProfile,
} from "./directory.service";
import { HFLIVE_ISSUER, HfliveAuthConfig } from "./hflive-auth.config";
import {
  OidcTransactionService,
  type ConflictTicket,
  type OidcIntent,
} from "./oidc-transaction.service";

const STATUS_FRESH_MS = 15 * 60_000;
const STATUS_GRACE_MS = 60 * 60_000;
const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60_000;

class LinkUsernameMismatchError extends Error {}

export function usernamesMatchForLink(
  localUsername: string,
  hfliveUsername: string,
) {
  return (
    localUsername.trim().toLowerCase() === hfliveUsername.trim().toLowerCase()
  );
}

// Keep this as a literal native import. openid-client is ESM-only, while the
// API emits CommonJS; Node16 module emit preserves import() and Vercel can then
// trace the package into the Serverless function bundle.
const importOpenidClient = () => import("openid-client");

type VerifiedProfile = ConflictTicket;

@Injectable()
export class HfliveAuthService {
  private readonly logger = new Logger(HfliveAuthService.name);
  private oidcConfigurationPromise?: Promise<
    import("openid-client", {
      with: { "resolution-mode": "import" },
    }).Configuration
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: HfliveAuthConfig,
    private readonly transactions: OidcTransactionService,
    private readonly directory: HfliveDirectoryService,
  ) {}

  get capabilities() {
    return this.config.publicCapabilities();
  }

  get readinessErrors() {
    return this.config.validationErrors();
  }

  async accountContext(userId: string | null): Promise<HfliveAccountContext> {
    if (!userId) throw new UnauthorizedException("Missing session");
    const [user, identity] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, localPasswordEnabled: true },
      }),
      this.prisma.externalIdentity.findUnique({
        where: { userId_issuer: { userId, issuer: HFLIVE_ISSUER } },
        select: {
          preferredUsername: true,
          email: true,
          displayName: true,
          picture: true,
          externalStatus: true,
          syncState: true,
          syncErrorCode: true,
          lastProfileSyncedAt: true,
        },
      }),
    ]);
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Account is unavailable");
    }
    return {
      ...this.capabilities,
      linked: Boolean(identity),
      authoritative: this.config.enabled && Boolean(identity),
      localPasswordEnabled: user.localPasswordEnabled,
      identity: identity
        ? {
            ...identity,
            lastProfileSyncedAt:
              identity.lastProfileSyncedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  accountLinkPageUrl(ticket: string) {
    const target = new URL("/login/link", this.config.redirectUri);
    target.hash = new URLSearchParams({ ticket }).toString();
    return target.href;
  }

  loginErrorPageUrl() {
    const target = new URL("/login", this.config.redirectUri);
    target.searchParams.set("reason", "hflive-failed");
    return target.href;
  }

  async recordBreakglass(outcome: "SUCCESS" | "FAILURE", userId?: string) {
    await this.audit("auth.breakglass", outcome, {
      subjectUserId: userId,
      errorCode: outcome === "FAILURE" ? "BREAKGLASS_REJECTED" : undefined,
    });
  }

  async begin(input: {
    intent?: OidcIntent;
    returnTo?: string;
    userId?: string;
  }) {
    this.requireEnabled();
    const oidc = await importOpenidClient();
    const configuration = await this.getOidcConfiguration();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    await this.transactions.storeOidc(state, {
      codeVerifier,
      nonce,
      returnTo: this.transactions.normalizeReturnTo(input.returnTo),
      intent: input.intent ?? "LOGIN",
      userId: input.userId,
      createdAt: new Date().toISOString(),
    });
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.redirectUri,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
  }

  callbackUrl(originalUrl: string) {
    this.requireEnabled();
    const callback = new URL(this.config.redirectUri);
    callback.search = originalUrl.includes("?")
      ? originalUrl.slice(originalUrl.indexOf("?"))
      : "";
    return callback;
  }

  async complete(currentUrl: URL, state: string) {
    this.requireEnabled();
    const transaction = await this.transactions.consumeOidc(state);
    const oidc = await importOpenidClient();
    const configuration = await this.getOidcConfiguration();
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: state,
        expectedNonce: transaction.nonce,
      });
    } catch (error) {
      const protocolFailure = oidcProtocolFailure(error);
      this.logger.warn(
        `HFLive OIDC callback rejected: ${JSON.stringify(protocolFailure)}`,
      );
      await this.audit("oidc.login", "FAILURE", {
        errorCode: "OIDC_PROTOCOL_REJECTED",
        metadata: protocolFailure,
      });
      throw new UnauthorizedException("OIDC response rejected");
    }
    const claims = tokens.claims();
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !claims ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.iss !== HFLIVE_ISSUER ||
      typeof claims.iat !== "number" ||
      claims.iat > nowSeconds + 60
    ) {
      throw new UnauthorizedException("OIDC claims are invalid");
    }
    const profile = await this.loadVerifiedProfile(claims.sub);
    if (transaction.intent === "LOCAL_SESSION") {
      if (!transaction.userId)
        throw new UnauthorizedException("Invalid link state");
      const result = await this.linkIdentity(transaction.userId, profile, {
        method: "LOCAL_SESSION",
        linkedByUserId: transaction.userId,
      });
      return { ...result, returnTo: transaction.returnTo };
    }
    const result = await this.resolveLogin(profile);
    return { ...result, returnTo: transaction.returnTo };
  }

  async beginLocalSessionLink(
    userId: string | null,
    password: string,
    returnTo?: string,
  ) {
    if (!userId) throw new UnauthorizedException("Missing session");
    await this.verifyPasswordForUser(userId, password);
    return this.begin({ intent: "LOCAL_SESSION", userId, returnTo });
  }

  async linkWithPassword(input: {
    ticket: string;
    username: string;
    password: string;
  }) {
    this.requireEnabled();
    const profile = await this.transactions.consumeConflict(input.ticket);
    const username = input.username.trim();
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });
    const dummyHash = await argon2.hash(randomBytes(32));
    const matches = await argon2.verify(
      user?.passwordHash ?? dummyHash,
      input.password,
    );
    if (
      !user ||
      !matches ||
      !user.localPasswordEnabled ||
      user.status !== "active" ||
      user.systemRole !== "member"
    ) {
      await this.audit("oidc.link.password", "FAILURE", {
        errorCode: "LOCAL_PROOF_REJECTED",
        profile,
      });
      throw new UnauthorizedException("Unable to link this account");
    }
    return this.linkIdentity(user.id, profile, {
      method: "LOCAL_PASSWORD",
      linkedByUserId: user.id,
    });
  }

  async adminLink(
    actorUserId: string | null,
    targetUserId: string,
    subject: string,
  ) {
    this.requireEnabled();
    if (!actorUserId) throw new UnauthorizedException("Missing session");
    const [actor, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actorUserId } }),
      this.prisma.user.findUnique({ where: { id: targetUserId } }),
    ]);
    if (!actor || actor.status !== "active" || actor.systemRole === "member") {
      throw new ForbiddenException("Administrator access required");
    }
    if (!target) throw new BadRequestException("Target user not found");
    if (target.systemRole !== "member" && actor.systemRole !== "super_admin") {
      throw new ForbiddenException(
        "Only a super administrator can link administrators",
      );
    }
    const profile = await this.loadVerifiedProfile(subject);
    return this.linkIdentity(target.id, profile, {
      method: "ADMIN",
      linkedByUserId: actor.id,
    });
  }

  async adminIdentityStatus(actorUserId: string | null, targetUserId: string) {
    if (!actorUserId) throw new UnauthorizedException("Missing session");
    const [actor, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actorUserId } }),
      this.prisma.user.findUnique({ where: { id: targetUserId } }),
    ]);
    if (!actor || actor.status !== "active" || actor.systemRole === "member") {
      throw new ForbiddenException("Administrator access required");
    }
    if (!target) throw new BadRequestException("Target user not found");
    if (target.systemRole !== "member" && actor.systemRole !== "super_admin") {
      throw new ForbiddenException(
        "Only a super administrator can inspect administrators",
      );
    }
    const identity = await this.prisma.externalIdentity.findUnique({
      where: {
        userId_issuer: { userId: targetUserId, issuer: HFLIVE_ISSUER },
      },
      select: {
        issuer: true,
        preferredUsername: true,
        externalStatus: true,
        syncState: true,
        syncErrorCode: true,
        linkMethod: true,
        lastStatusConfirmedAt: true,
        lastProfileSyncedAt: true,
        directoryUpdatedAt: true,
      },
    });
    return { linked: Boolean(identity), identity };
  }

  async checkExternalSession(userId: string) {
    if (!this.config.enabled) return { allowed: true as const };
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { userId_issuer: { userId, issuer: HFLIVE_ISSUER } },
    });
    if (!identity) return { allowed: true as const };
    if (identity.externalStatus === "DISABLED")
      return { allowed: false as const };
    const confirmedAt = identity.lastStatusConfirmedAt?.getTime() ?? 0;
    if (
      identity.externalStatus === "ACTIVE" &&
      Date.now() - confirmedAt < STATUS_FRESH_MS
    ) {
      return { allowed: true as const };
    }
    const now = new Date();
    const lease = await this.prisma.externalIdentity.updateMany({
      where: {
        id: identity.id,
        OR: [
          { statusRefreshLeaseUntil: null },
          { statusRefreshLeaseUntil: { lt: now } },
        ],
      },
      data: { statusRefreshLeaseUntil: new Date(now.getTime() + 10_000) },
    });
    if (lease.count === 0) {
      if (
        identity.externalStatus === "ACTIVE" &&
        Date.now() - confirmedAt <= STATUS_GRACE_MS
      ) {
        return { allowed: true as const, degraded: true as const };
      }
      throw new ServiceUnavailableException(
        "HFLive account status refresh is in progress",
      );
    }
    try {
      const status = await this.directory.getStatus(identity.subject);
      if (
        status.subject !== identity.subject ||
        !["ACTIVE", "DISABLED"].includes(status.status)
      ) {
        throw new DirectoryRequestError("INVALID_RESPONSE");
      }
      if (status.status === "ACTIVE") {
        await this.prisma.externalIdentity.update({
          where: { id: identity.id },
          data: {
            externalStatus: "ACTIVE",
            lastStatusConfirmedAt: new Date(),
            statusRefreshLeaseUntil: null,
            syncErrorCode: null,
          },
        });
        return { allowed: true as const };
      }
      await this.disableIdentity(identity, "DIRECTORY_DISABLED");
      return { allowed: false as const };
    } catch (caught) {
      if (
        caught instanceof DirectoryRequestError &&
        caught.code === "NOT_FOUND"
      ) {
        await this.disableIdentity(identity, "DIRECTORY_NOT_FOUND");
        return { allowed: false as const };
      }
      if (
        identity.externalStatus === "ACTIVE" &&
        Date.now() - confirmedAt <= STATUS_GRACE_MS
      ) {
        await this.prisma.externalIdentity.update({
          where: { id: identity.id },
          data: {
            syncState: "ERROR",
            syncErrorCode:
              caught instanceof DirectoryRequestError
                ? caught.code
                : "UNAVAILABLE",
            statusRefreshLeaseUntil: null,
          },
        });
        return { allowed: true as const, degraded: true as const };
      }
      throw new ServiceUnavailableException(
        "HFLive account status is unavailable",
      );
    }
  }

  async processWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ) {
    this.requireEnabled();
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException("Webhook requires application/json");
    }
    const timestamp = headers["x-hflive-timestamp"] ?? "";
    const signature = headers["x-hflive-signature"] ?? "";
    const eventId = headers["x-hflive-event-id"] ?? "";
    this.verifyWebhook(timestamp, signature, rawBody);
    let payload: {
      id?: unknown;
      type?: unknown;
      clientId?: unknown;
      subject?: unknown;
      status?: unknown;
      occurredAt?: unknown;
    };
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as typeof payload;
    } catch {
      throw new BadRequestException("Invalid JSON payload");
    }
    if (
      !eventId ||
      payload.id !== eventId ||
      payload.clientId !== this.config.directoryClientId ||
      typeof payload.subject !== "string" ||
      typeof payload.occurredAt !== "string" ||
      !["user.status.changed", "user.profile.changed"].includes(
        String(payload.type),
      )
    ) {
      throw new BadRequestException("Invalid event envelope");
    }
    const occurredAt = new Date(payload.occurredAt);
    if (Number.isNaN(occurredAt.getTime()))
      throw new BadRequestException("Invalid event time");
    const digest = createHash("sha256").update(rawBody).digest("base64url");
    let calibratedStatus: "ACTIVE" | "DISABLED" | null = null;
    let refreshedProfile: VerifiedProfile | null = null;
    if (payload.type === "user.status.changed" && payload.status === "ACTIVE") {
      try {
        const status = await this.directory.getStatus(payload.subject);
        if (status.subject === payload.subject && status.status === "ACTIVE") {
          calibratedStatus = "ACTIVE";
        }
      } catch {
        calibratedStatus = null;
      }
    } else if (payload.type === "user.profile.changed") {
      try {
        refreshedProfile = await this.loadVerifiedProfile(payload.subject);
      } catch {
        refreshedProfile = null;
      }
    }
    try {
      return await this.serializable(async (tx) => {
        const duplicate = await tx.externalIdentityEvent.findUnique({
          where: { eventId },
        });
        if (duplicate) return { duplicate: true };
        const identity = await tx.externalIdentity.findUnique({
          where: {
            issuer_subject: {
              issuer: HFLIVE_ISSUER,
              subject: payload.subject as string,
            },
          },
        });
        if (!identity) {
          await tx.externalIdentityEvent.create({
            data: {
              eventId,
              eventType: String(payload.type),
              subject: payload.subject as string,
              occurredAt,
              payloadDigest: digest,
              outcome: "IGNORED",
              errorCode: "UNKNOWN_SUBJECT",
              processedAt: new Date(),
            },
          });
          return { ignored: true };
        }
        if (
          payload.type === "user.status.changed" &&
          identity.lastStatusEventAt &&
          occurredAt <= identity.lastStatusEventAt
        ) {
          await tx.externalIdentityEvent.create({
            data: {
              eventId,
              eventType: String(payload.type),
              subject: identity.subject,
              occurredAt,
              payloadDigest: digest,
              outcome: "IGNORED",
              errorCode: "STALE_EVENT",
              processedAt: new Date(),
            },
          });
          return { ignored: true };
        }
        let outcome: "APPLIED" | "IGNORED" = "APPLIED";
        if (
          payload.type === "user.status.changed" &&
          payload.status === "DISABLED"
        ) {
          await tx.externalIdentity.update({
            where: { id: identity.id },
            data: { externalStatus: "DISABLED", lastStatusEventAt: occurredAt },
          });
          if (identity.externalStatus !== "DISABLED") {
            await tx.user.update({
              where: { id: identity.userId },
              data: { sessionVersion: { increment: 1 } },
            });
          }
        } else if (payload.type === "user.status.changed") {
          await tx.externalIdentity.update({
            where: { id: identity.id },
            data:
              calibratedStatus === "ACTIVE"
                ? {
                    externalStatus: "ACTIVE",
                    lastStatusEventAt: occurredAt,
                    lastStatusConfirmedAt: new Date(),
                    statusRefreshLeaseUntil: null,
                    syncState: "CURRENT",
                    syncErrorCode: null,
                  }
                : {
                    lastStatusEventAt: occurredAt,
                    syncState: "ERROR",
                    syncErrorCode: "STATUS_REFRESH_REQUIRED",
                  },
          });
          outcome = calibratedStatus === "ACTIVE" ? "APPLIED" : "IGNORED";
        } else {
          if (refreshedProfile) {
            const user = await tx.user.findUniqueOrThrow({
              where: { id: identity.userId },
            });
            const conflict = await tx.user.findFirst({
              where: {
                id: { not: user.id },
                OR: [
                  {
                    username: {
                      equals: refreshedProfile.preferredUsername,
                      mode: "insensitive",
                    },
                  },
                  ...(refreshedProfile.emailVerified && refreshedProfile.email
                    ? [
                        {
                          emailNormalized: normalizeEmail(
                            refreshedProfile.email,
                          ),
                        },
                      ]
                    : []),
                ],
              },
              select: { id: true },
            });
            await tx.user.update({
              where: { id: user.id },
              data: {
                displayName: refreshedProfile.displayName,
                ...(!conflict
                  ? { username: refreshedProfile.preferredUsername }
                  : {}),
                ...(!conflict && refreshedProfile.emailVerified
                  ? {
                      email: refreshedProfile.email,
                      emailNormalized: normalizeEmail(refreshedProfile.email),
                    }
                  : {}),
              },
            });
            await tx.externalIdentity.update({
              where: { id: identity.id },
              data: {
                ...identitySnapshot(refreshedProfile),
                lastProfileSyncedAt: new Date(),
                syncState: conflict ? "PROFILE_CONFLICT" : "CURRENT",
                syncErrorCode: conflict ? "PROFILE_CONFLICT" : null,
              },
            });
          } else {
            await tx.externalIdentity.update({
              where: { id: identity.id },
              data: {
                syncState: "ERROR",
                syncErrorCode: "PROFILE_REFRESH_REQUIRED",
              },
            });
            outcome = "IGNORED";
          }
        }
        await tx.externalIdentityEvent.create({
          data: {
            eventId,
            eventType: String(payload.type),
            subject: identity.subject,
            occurredAt,
            payloadDigest: digest,
            outcome,
            processedAt: new Date(),
          },
        });
        await this.auditWith(tx, "hflive.webhook", "SUCCESS", {
          subjectUserId: identity.userId,
          profile: { issuer: HFLIVE_ISSUER, subject: identity.subject },
          metadata: { eventType: String(payload.type), outcome },
        });
        return { applied: outcome === "APPLIED" };
      });
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2002"
      ) {
        return { duplicate: true };
      }
      throw caught;
    }
  }

  private async resolveLogin(profile: VerifiedProfile) {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: {
        issuer_subject: { issuer: profile.issuer, subject: profile.subject },
      },
      include: { user: true },
    });
    if (existing) {
      if (
        existing.externalStatus === "DISABLED" ||
        existing.user.status !== "active"
      ) {
        throw new UnauthorizedException("Account is unavailable");
      }
      const updated = await this.syncExistingProfile(existing, profile);
      await this.audit("oidc.login", "SUCCESS", {
        subjectUserId: existing.userId,
        profile,
      });
      return { user: updated, sessionVersion: existing.user.sessionVersion };
    }
    const conflict = await this.findProfileConflict(profile);
    if (conflict) {
      const conflictTicket = await this.transactions.createConflict(profile);
      await this.audit("oidc.login", "FAILURE", {
        errorCode: "PROFILE_CONFLICT",
        profile,
      });
      throw new HttpException(
        { statusCode: 409, error: "ACCOUNT_LINK_REQUIRED", conflictTicket },
        HttpStatus.CONFLICT,
      );
    }
    const passwordHash = await argon2.hash(randomBytes(32));
    try {
      return await this.serializable(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: profile.preferredUsername,
            email: profile.emailVerified ? profile.email : null,
            emailNormalized: profile.emailVerified
              ? normalizeEmail(profile.email)
              : null,
            displayName: profile.displayName,
            passwordHash,
            localPasswordEnabled: false,
            systemRole: "member",
          },
        });
        await tx.externalIdentity.create({
          data: identityCreateData(user.id, profile, "JIT"),
        });
        await this.auditWith(tx, "oidc.jit", "SUCCESS", {
          subjectUserId: user.id,
          profile,
        });
        return { user, sessionVersion: user.sessionVersion };
      });
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2002"
      ) {
        const raced = await this.prisma.externalIdentity.findUnique({
          where: {
            issuer_subject: {
              issuer: profile.issuer,
              subject: profile.subject,
            },
          },
          include: { user: true },
        });
        if (raced && raced.user.status === "active") {
          return {
            user: raced.user,
            sessionVersion: raced.user.sessionVersion,
          };
        }
        throw new ConflictException("Account link conflict");
      }
      throw caught;
    }
  }

  private async linkIdentity(
    userId: string,
    profile: VerifiedProfile,
    input: {
      method: "LOCAL_PASSWORD" | "LOCAL_SESSION" | "ADMIN";
      linkedByUserId: string;
    },
  ) {
    try {
      return await this.serializable(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.status !== "active")
          throw new UnauthorizedException("Account unavailable");
        if (!usernamesMatchForLink(user.username, profile.preferredUsername)) {
          throw new LinkUsernameMismatchError();
        }
        const existing = await tx.externalIdentity.findFirst({
          where: {
            OR: [
              { issuer: profile.issuer, subject: profile.subject },
              { userId, issuer: profile.issuer },
            ],
          },
        });
        if (existing) throw new ConflictException("Identity is already linked");
        const conflict = await tx.user.findFirst({
          where: {
            id: { not: user.id },
            OR: [
              {
                username: {
                  equals: profile.preferredUsername,
                  mode: "insensitive",
                },
              },
              ...(profile.emailVerified && profile.email
                ? [{ emailNormalized: normalizeEmail(profile.email) }]
                : []),
            ],
          },
          select: { id: true },
        });
        await tx.externalIdentity.create({
          data: {
            ...identityCreateData(
              user.id,
              profile,
              input.method,
              input.linkedByUserId,
            ),
            syncState: conflict ? "PROFILE_CONFLICT" : "CURRENT",
            syncErrorCode: conflict ? "PROFILE_CONFLICT" : null,
          },
        });
        const synced = await this.updateCompatibleProfile(tx, user, profile);
        await this.auditWith(tx, "oidc.link", "SUCCESS", {
          actorUserId: input.linkedByUserId,
          subjectUserId: user.id,
          profile,
          metadata: { method: input.method },
        });
        return { user: synced, sessionVersion: user.sessionVersion };
      });
    } catch (caught) {
      if (caught instanceof LinkUsernameMismatchError) {
        await this.audit("oidc.link", "FAILURE", {
          actorUserId: input.linkedByUserId,
          subjectUserId: userId,
          errorCode: "USERNAME_MISMATCH",
          profile,
          metadata: { method: input.method },
        });
        throw new ConflictException("LiveBoard 用户名必须与 HFLive 用户名一致");
      }
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2002"
      ) {
        throw new ConflictException("Identity is already linked");
      }
      throw caught;
    }
  }

  private async loadVerifiedProfile(subject: string): Promise<VerifiedProfile> {
    let profile: DirectoryProfile;
    try {
      profile = await this.directory.getProfile(subject);
    } catch {
      throw new ServiceUnavailableException("HFLive Directory is unavailable");
    }
    if (
      profile.subject !== subject ||
      profile.status !== "ACTIVE" ||
      !profile.preferredUsername?.trim() ||
      !profile.name?.trim() ||
      Number.isNaN(new Date(profile.updatedAt).getTime())
    ) {
      throw new UnauthorizedException("HFLive account is unavailable");
    }
    return {
      issuer: HFLIVE_ISSUER,
      subject,
      preferredUsername: profile.preferredUsername.trim(),
      email: profile.emailVerified ? profile.email?.trim() || null : null,
      emailVerified: profile.emailVerified === true,
      displayName: profile.name.trim(),
      picture: profile.picture ?? null,
      directoryUpdatedAt: profile.updatedAt,
    };
  }

  private async getOidcConfiguration() {
    this.requireConfigured();
    this.oidcConfigurationPromise ??= importOpenidClient().then(
      async (oidc) => {
        const configuration = await oidc.discovery(
          new URL(HFLIVE_ISSUER),
          this.config.oidcClientId,
          { client_secret: this.config.oidcClientSecret },
          // HFLive advertises both methods. Use POST because its current OAuth
          // provider does not form-decode RFC 6749 Basic credentials before
          // comparing base64url client IDs and secrets.
          oidc.ClientSecretPost(this.config.oidcClientSecret),
        );
        if (configuration.serverMetadata().issuer !== HFLIVE_ISSUER) {
          throw new Error("HFLive discovery issuer mismatch");
        }
        configuration.timeout = 5;
        return configuration;
      },
    );
    return this.oidcConfigurationPromise;
  }

  private requireEnabled() {
    if (!this.config.enabled)
      throw new BadRequestException("HFLive login is disabled");
    this.requireConfigured();
  }

  private requireConfigured() {
    const errors = this.config.validationErrors();
    if (errors.length) {
      throw new ServiceUnavailableException({
        error: "HFLIVE_NOT_READY",
        missing: errors,
      });
    }
  }

  private async findProfileConflict(
    profile: VerifiedProfile,
    excludedUserId?: string,
  ) {
    return this.prisma.user.findFirst({
      where: {
        ...(excludedUserId ? { id: { not: excludedUserId } } : {}),
        OR: [
          {
            username: {
              equals: profile.preferredUsername,
              mode: "insensitive",
            },
          },
          ...(profile.emailVerified && profile.email
            ? [{ emailNormalized: normalizeEmail(profile.email) }]
            : []),
        ],
      },
      select: { id: true },
    });
  }

  private async syncExistingProfile(
    identity: ExternalIdentity & { user: User },
    profile: VerifiedProfile,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.updateCompatibleProfile(
        tx,
        identity.user,
        profile,
      );
      const conflict = await this.findProfileConflict(profile, identity.userId);
      await tx.externalIdentity.update({
        where: { id: identity.id },
        data: {
          ...identitySnapshot(profile),
          externalStatus: "ACTIVE",
          lastStatusConfirmedAt: new Date(),
          lastProfileSyncedAt: new Date(),
          syncState: conflict ? "PROFILE_CONFLICT" : "CURRENT",
          syncErrorCode: conflict ? "PROFILE_CONFLICT" : null,
        },
      });
      return user;
    });
  }

  private async updateCompatibleProfile(
    tx: Prisma.TransactionClient,
    user: User,
    profile: VerifiedProfile,
  ) {
    const conflict = await tx.user.findFirst({
      where: {
        id: { not: user.id },
        OR: [
          {
            username: {
              equals: profile.preferredUsername,
              mode: "insensitive",
            },
          },
          ...(profile.emailVerified && profile.email
            ? [{ emailNormalized: normalizeEmail(profile.email) }]
            : []),
        ],
      },
      select: { id: true },
    });
    return tx.user.update({
      where: { id: user.id },
      data: {
        displayName: profile.displayName,
        ...(!conflict ? { username: profile.preferredUsername } : {}),
        ...(!conflict && profile.emailVerified
          ? {
              email: profile.email,
              emailNormalized: normalizeEmail(profile.email),
            }
          : {}),
      },
    });
  }

  private async verifyPasswordForUser(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      user.status !== "active" ||
      !user.localPasswordEnabled ||
      !(await argon2.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException("Password confirmation failed");
    }
  }

  private async disableIdentity(identity: ExternalIdentity, errorCode: string) {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.externalIdentity.updateMany({
        where: { id: identity.id, externalStatus: { not: "DISABLED" } },
        data: {
          externalStatus: "DISABLED",
          statusRefreshLeaseUntil: null,
          syncState: "ERROR",
          syncErrorCode: errorCode,
        },
      });
      if (changed.count) {
        await tx.user.update({
          where: { id: identity.userId },
          data: { sessionVersion: { increment: 1 } },
        });
      }
    });
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (caught) {
        const retryable =
          caught instanceof Prisma.PrismaClientKnownRequestError &&
          caught.code === "P2034";
        if (!retryable || attempt === 2) throw caught;
      }
    }
    throw new Error("Unreachable transaction retry state");
  }

  private verifyWebhook(timestamp: string, signature: string, rawBody: Buffer) {
    const seconds = Number(timestamp);
    if (
      !Number.isInteger(seconds) ||
      Math.abs(Date.now() / 1000 - seconds) > 300
    ) {
      throw new UnauthorizedException("Invalid webhook timestamp");
    }
    const supplied = /^v1=([0-9a-f]{64})$/.exec(signature)?.[1];
    if (!supplied) throw new UnauthorizedException("Invalid webhook signature");
    const valid = [this.config.webhookSecret, this.config.previousWebhookSecret]
      .filter(Boolean)
      .some((secret) => {
        const expected = createHmac("sha256", secret)
          .update(`${timestamp}.`)
          .update(rawBody)
          .digest("hex");
        return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
      });
    if (!valid) throw new UnauthorizedException("Invalid webhook signature");
  }

  private async audit(
    eventType: string,
    outcome: "SUCCESS" | "FAILURE",
    input: AuditInput = {},
  ) {
    await this.auditWith(this.prisma, eventType, outcome, input);
  }

  private async auditWith(
    tx: Prisma.TransactionClient | PrismaService,
    eventType: string,
    outcome: "SUCCESS" | "FAILURE",
    input: AuditInput = {},
  ) {
    await tx.authenticationAuditEvent.create({
      data: {
        eventType,
        outcome,
        actorUserId: input.actorUserId,
        subjectUserId: input.subjectUserId,
        issuer: input.profile?.issuer,
        externalSubjectDigest: input.profile?.subject
          ? subjectDigest(input.profile.subject)
          : undefined,
        errorCode: input.errorCode,
        metadata: input.metadata ?? undefined,
        expiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
      },
    });
  }
}

interface AuditInput {
  actorUserId?: string;
  subjectUserId?: string;
  errorCode?: string;
  profile?: Pick<VerifiedProfile, "issuer" | "subject">;
  metadata?: Prisma.InputJsonValue;
}

function normalizeEmail(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

function identitySnapshot(profile: VerifiedProfile) {
  return {
    preferredUsername: profile.preferredUsername,
    email: profile.email,
    emailNormalized: profile.emailVerified
      ? normalizeEmail(profile.email)
      : null,
    emailVerified: profile.emailVerified,
    displayName: profile.displayName,
    picture: profile.picture,
    directoryUpdatedAt: new Date(profile.directoryUpdatedAt),
  };
}

function identityCreateData(
  userId: string,
  profile: VerifiedProfile,
  method: "JIT" | "LOCAL_PASSWORD" | "LOCAL_SESSION" | "ADMIN",
  linkedByUserId?: string,
) {
  return {
    userId,
    issuer: profile.issuer,
    subject: profile.subject,
    ...identitySnapshot(profile),
    externalStatus: "ACTIVE" as const,
    lastStatusConfirmedAt: new Date(),
    lastProfileSyncedAt: new Date(),
    linkMethod: method,
    linkedByUserId,
  };
}

function subjectDigest(subject: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for audit digests");
  return createHmac("sha256", secret)
    .update(`hflive-audit-subject:${subject}`)
    .digest("base64url");
}

function oidcProtocolFailure(error: unknown): Prisma.InputJsonObject {
  const record = asErrorRecord(error);
  const cause = asErrorRecord(record?.cause);
  const type =
    error instanceof Error && safeDiagnostic(error.name)
      ? error.name
      : "UnknownError";
  const code = diagnosticValue(record?.code) ?? diagnosticValue(cause?.code);
  const oauthError =
    diagnosticValue(record?.error) ?? diagnosticValue(cause?.error);
  const status =
    diagnosticStatus(record?.status) ?? diagnosticStatus(cause?.status);
  return {
    type,
    ...(code ? { code } : {}),
    ...(oauthError ? { oauthError } : {}),
    ...(status ? { status } : {}),
  };
}

function asErrorRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function diagnosticValue(value: unknown) {
  return typeof value === "string" && safeDiagnostic(value) ? value : null;
}

function diagnosticStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function safeDiagnostic(value: string) {
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
}
