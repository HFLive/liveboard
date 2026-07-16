import { HttpException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import argon2 from "argon2";
import type { PrismaService } from "../prisma/prisma.service";
import type { LoginRateLimitService } from "./login-rate-limit.service";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
  };
  const limiter = {
    isBlocked: jest.fn(),
    recordFailure: jest.fn(),
    clear: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => fallback),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockImplementation(
      (key: string, fallback?: unknown) => fallback,
    );
    service = new AuthService(
      prisma as unknown as PrismaService,
      limiter as unknown as LoginRateLimitService,
      config as unknown as ConfigService,
    );
    limiter.isBlocked.mockResolvedValue(false);
  });

  it("returns the session version and clears failures after a valid login", async () => {
    const passwordHash = await argon2.hash("correct-password");
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "Teacher",
      systemRole: "member",
      status: "active",
      sessionVersion: 4,
      passwordHash,
    });

    await expect(
      service.validateLogin(" teacher ", "correct-password", "127.0.0.1"),
    ).resolves.toMatchObject({ sessionVersion: 4 });
    expect(limiter.clear).toHaveBeenCalledWith("127.0.0.1", "teacher");
  });

  it("records a failed login without disclosing whether the user exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.validateLogin("missing", "wrong", "127.0.0.1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limiter.recordFailure).toHaveBeenCalledWith("127.0.0.1", "missing");
  });

  it("stops before password verification when the limiter blocks the login", async () => {
    limiter.isBlocked.mockResolvedValue(true);

    await expect(
      service.validateLogin("teacher", "password", "127.0.0.1"),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("increments the session version when changing a password", async () => {
    const passwordHash = await argon2.hash("old-password");
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      passwordHash,
    });
    prisma.user.update.mockResolvedValue({ id: "user-1", sessionVersion: 8 });

    await expect(
      service.changePassword("user-1", {
        currentPassword: "old-password",
        newPassword: "new-password-long",
      }),
    ).resolves.toEqual({ userId: "user-1", sessionVersion: 8 });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
      }),
    );
  });

  it("updates the display name and public biography", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "Teacher",
      bio: null,
      bannerUpdatedAt: null,
      avatarUpdatedAt: null,
      systemRole: "member",
      status: "active",
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "张老师",
      bio: "负责线路基础课程",
      bannerUpdatedAt: null,
      avatarUpdatedAt: null,
      systemRole: "member",
      status: "active",
    });

    await expect(
      service.updateProfile("user-1", {
        displayName: " 张老师 ",
        bio: " 负责线路基础课程 ",
      }),
    ).resolves.toMatchObject({
      displayName: "张老师",
      bio: "负责线路基础课程",
      bannerUrl: null,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        displayName: "张老师",
        bio: "负责线路基础课程",
      },
    });
  });
});
