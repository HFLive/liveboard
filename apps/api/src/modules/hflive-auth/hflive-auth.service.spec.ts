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
import { HfliveAuthService } from "./hflive-auth.service";
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
    user: { update: jest.fn() },
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
    directory.getStatus.mockRejectedValue(
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
});
