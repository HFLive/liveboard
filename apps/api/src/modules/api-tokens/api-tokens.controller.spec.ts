import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { ApiTokensController } from "./api-tokens.controller";
import { ApiTokenService } from "./api-token.service";

describe("ApiTokensController", () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const apiTokens = {
    createToken: jest.fn(),
    listTokens: jest.fn(),
    revokeToken: jest.fn(),
  };
  let controller: ApiTokensController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new ApiTokensController(
      prisma as unknown as PrismaService,
      apiTokens as unknown as ApiTokenService,
    );
  });

  const adminUser = {
    id: "admin-1",
    username: "admin",
    systemRole: "super_admin",
    status: "active",
  };

  it("rejects non-admin users", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "member-1",
      username: "member",
      systemRole: "member",
      status: "active",
    });

    await expect(
      controller.create("member-1", {
        userId: "user-1",
        name: "claude",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(apiTokens.createToken).not.toHaveBeenCalled();
  });

  it("creates a token and returns the plaintext once", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(adminUser) // requireSuperAdmin
      .mockResolvedValueOnce({ id: "user-1", status: "active" }); // 目标用户
    apiTokens.createToken.mockResolvedValue({
      token: "lbt_secret",
      tokenId: "tok-1",
      tokenPrefix: "lbt_secret",
    });

    const result = await controller.create("admin-1", {
      userId: "user-1",
      name: "claude-code",
    });

    expect(result.token).toBe("lbt_secret");
    expect(apiTokens.createToken).toHaveBeenCalledWith({
      userId: "user-1",
      name: "claude-code",
      expiresAt: undefined,
    });
  });

  it("rejects creating a token for a missing or disabled user", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(adminUser)
      .mockResolvedValueOnce({ id: "user-1", status: "disabled" });

    await expect(
      controller.create("admin-1", { userId: "user-1", name: "claude" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(apiTokens.createToken).not.toHaveBeenCalled();
  });

  it("lists tokens without leaking hashes", async () => {
    prisma.user.findUnique.mockResolvedValue(adminUser);
    apiTokens.listTokens.mockResolvedValue([
      {
        id: "tok-1",
        name: "claude-code",
        userId: "user-1",
        username: "user-1",
        tokenPrefix: "lbt_abc123",
        createdAt: new Date(),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      },
    ]);

    const result = await controller.list("admin-1", "user-1");

    expect(result.tokens).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("tokenHash");
  });

  it("revokes a token idempotently", async () => {
    prisma.user.findUnique.mockResolvedValue(adminUser);
    apiTokens.revokeToken.mockResolvedValue(undefined);

    await expect(controller.revoke("admin-1", "tok-1")).resolves.toEqual({
      ok: true,
    });
    expect(apiTokens.revokeToken).toHaveBeenCalledWith("tok-1");
  });
});
