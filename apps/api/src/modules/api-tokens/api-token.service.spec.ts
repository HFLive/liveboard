import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { API_TOKEN_PREFIX, ApiTokenService } from "./api-token.service";

describe("ApiTokenService", () => {
  const prisma = {
    apiToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  let service: ApiTokenService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ApiTokenService(prisma as unknown as PrismaService);
  });

  describe("hashToken", () => {
    it("is deterministic and produces a 64-char hex digest", () => {
      const hash = service.hashToken("lbt_some-token");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(service.hashToken("lbt_some-token")).toBe(hash);
      expect(service.hashToken("lbt_other")).not.toBe(hash);
    });
  });

  describe("createToken", () => {
    it("stores only the hash and prefix, returning the raw token once", async () => {
      prisma.apiToken.create.mockResolvedValue({ id: "tok-1" });

      const result = await service.createToken({
        userId: "user-1",
        name: "claude-code",
      });

      expect(result.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
      expect(result.token.length).toBeGreaterThan(40);
      expect(result.tokenPrefix).toBe(result.token.slice(0, 10));
      expect(prisma.apiToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          name: "claude-code",
          tokenPrefix: result.token.slice(0, 10),
        }),
        select: { id: true },
      });
      const data = prisma.apiToken.create.mock.calls[0][0].data;
      // 落库的必须是哈希，绝不可能是明文
      expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.tokenHash).not.toContain(result.token);
    });
  });

  describe("listTokens", () => {
    it("maps username and never exposes tokenHash", async () => {
      prisma.apiToken.findMany.mockResolvedValue([
        {
          id: "tok-1",
          name: "claude-code",
          userId: "user-1",
          tokenPrefix: "lbt_abc123",
          createdAt: new Date("2026-08-01"),
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          user: { username: "admin" },
        },
      ]);

      const tokens = await service.listTokens("user-1");

      expect(prisma.apiToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1" } }),
      );
      expect(tokens[0]).toEqual({
        id: "tok-1",
        name: "claude-code",
        userId: "user-1",
        username: "admin",
        tokenPrefix: "lbt_abc123",
        createdAt: expect.any(Date),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      });
      expect(JSON.stringify(tokens)).not.toContain("tokenHash");
    });
  });

  describe("revokeToken", () => {
    it("sets revokedAt", async () => {
      prisma.apiToken.update.mockResolvedValue({ id: "tok-1" });

      await service.revokeToken("tok-1");

      expect(prisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: "tok-1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("maps P2025 to NotFoundException", async () => {
      prisma.apiToken.update.mockRejectedValue(
        Object.assign(new Error("not found"), { code: "P2025" }),
      );

      await expect(service.revokeToken("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("authenticate", () => {
    const tokenRecord = {
      id: "tok-1",
      userId: "user-1",
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    };

    it("returns identity for a valid active token", async () => {
      prisma.apiToken.findUnique.mockResolvedValue(tokenRecord);
      prisma.apiToken.update.mockResolvedValue({ id: "tok-1" });
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        status: "active",
      });

      await expect(service.authenticate("lbt_valid")).resolves.toEqual({
        userId: "user-1",
        tokenId: "tok-1",
      });
      expect(prisma.apiToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
        select: expect.anything(),
      });
    });

    it.each([
      ["an unknown token", null],
      ["a revoked token", { ...tokenRecord, revokedAt: new Date() }],
      [
        "an expired token",
        { ...tokenRecord, expiresAt: new Date("2020-01-01") },
      ],
    ])("returns null for %s", async (_label, record) => {
      prisma.apiToken.findUnique.mockResolvedValue(record);
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        status: "active",
      });

      await expect(service.authenticate("lbt_whatever")).resolves.toBeNull();
    });

    it("returns null when the owning user is disabled or missing", async () => {
      prisma.apiToken.findUnique.mockResolvedValue(tokenRecord);
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        status: "disabled",
      });

      await expect(service.authenticate("lbt_valid")).resolves.toBeNull();
    });

    it("throttles lastUsedAt updates within the window", async () => {
      prisma.apiToken.findUnique.mockResolvedValue({
        ...tokenRecord,
        lastUsedAt: new Date(), // 刚用过：窗口内
      });
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        status: "active",
      });

      await service.authenticate("lbt_valid");

      expect(prisma.apiToken.update).not.toHaveBeenCalled();
    });

    it("updates lastUsedAt after the throttle window", async () => {
      prisma.apiToken.findUnique.mockResolvedValue({
        ...tokenRecord,
        lastUsedAt: new Date(Date.now() - 6 * 60 * 1000), // 6 分钟前
      });
      prisma.apiToken.update.mockResolvedValue({ id: "tok-1" });
      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        status: "active",
      });

      await service.authenticate("lbt_valid");

      expect(prisma.apiToken.update).toHaveBeenCalledWith({
        where: { id: "tok-1" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });
  });
});
