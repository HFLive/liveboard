import { HttpException, UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { LoginRateLimitService } from "./login-rate-limit.service";
import { AuthService } from "./auth.service";
import type { HfliveAuthConfig } from "../hflive-auth/hflive-auth.config";

describe("AuthService", () => {
  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    externalIdentity: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn() },
    forumPost: { findMany: jest.fn() },
    submission: { findMany: jest.fn() },
    file: { findMany: jest.fn() },
    exerciseSet: { findMany: jest.fn() },
    teachingDeck: { findMany: jest.fn() },
    classroomAnnouncement: { findMany: jest.fn() },
    classroomFile: { findMany: jest.fn() },
    fileAsset: { findMany: jest.fn() },
  };
  const limiter = {
    isBlocked: jest.fn(),
    recordFailure: jest.fn(),
    clear: jest.fn(),
  };
  const storage = {
    activeBackend: jest.fn(),
    backendFor: jest.fn(),
    discardMultipartUpload: jest.fn(),
    presignDownload: jest.fn(),
    healthCheckActive: jest.fn(),
  };
  const backend = {
    getObject: jest.fn(),
  };
  let service: AuthService;
  const hfliveConfig = { mode: "local", breakglassEnabled: false };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AuthService(
      prisma as unknown as PrismaService,
      limiter as unknown as LoginRateLimitService,
      storage as unknown as StorageService,
      hfliveConfig as unknown as HfliveAuthConfig,
    );
    limiter.isBlocked.mockResolvedValue(false);
    storage.backendFor.mockResolvedValue(backend);
  });

  it("returns the session version and clears failures after a valid login", async () => {
    const passwordHash = await argon2.hash("correct-password");
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "Teacher",
      systemRole: "member",
      status: "active",
      sessionVersion: 4,
      passwordHash,
      localPasswordEnabled: true,
    });

    await expect(
      service.validateLogin(" teacher ", "correct-password", "127.0.0.1"),
    ).resolves.toMatchObject({ sessionVersion: 4 });
    expect(limiter.clear).toHaveBeenCalledWith("127.0.0.1", "teacher");
  });

  it("records a failed login without disclosing whether the user exists", async () => {
    prisma.user.findFirst.mockResolvedValue(null);

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
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("rejects ordinary local login before a user lookup in hflive_oidc mode", async () => {
    hfliveConfig.mode = "hflive_oidc";
    await expect(
      service.validateLogin("teacher", "password", "127.0.0.1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    hfliveConfig.mode = "local";
  });

  it("streams an R2 avatar through the server instead of issuing a signed redirect", async () => {
    const stream = { pipe: jest.fn() };
    prisma.user.findUnique.mockResolvedValue({
      avatarStorageKey: "users/user-1/avatar.webp",
      avatarMimeType: "image/webp",
      avatarStorageBackend: "r2",
      status: "active",
    });
    backend.getObject.mockResolvedValue(stream);

    await expect(service.getAvatar("viewer-1", "user-1")).resolves.toEqual({
      mimeType: "image/webp",
      stream,
    });
    expect(storage.backendFor).toHaveBeenCalledWith("r2");
    expect(backend.getObject).toHaveBeenCalledWith("users/user-1/avatar.webp");
    expect(storage.presignDownload).not.toHaveBeenCalled();
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
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: {
          displayName: "张老师",
          bio: "负责线路基础课程",
        },
      }),
    );
  });

  it("keeps HFLive-owned display names read-only while allowing local biography edits", async () => {
    hfliveConfig.mode = "hybrid";
    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "统一姓名",
      bio: null,
      bannerUpdatedAt: null,
      avatarUpdatedAt: null,
      systemRole: "member",
      status: "active",
    });
    prisma.externalIdentity.findUnique.mockResolvedValue({ id: "identity-1" });

    await expect(
      service.updateProfile("user-1", {
        displayName: "本地改名",
        bio: "本地简介",
      }),
    ).rejects.toThrow("统一身份资料请前往 HFLive Auth 修改");
    expect(prisma.user.update).not.toHaveBeenCalled();

    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: false,
    });
    hfliveConfig.mode = "local";
  });

  it("prefers the HFLive picture for a linked profile while external auth is enabled", async () => {
    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "统一姓名",
      bio: null,
      bannerUpdatedAt: null,
      avatarUpdatedAt: new Date("2026-08-10T00:00:00.000Z"),
      openContentInCurrentTab: false,
      systemRole: "member",
      status: "active",
      externalIdentities: [
        {
          id: "identity-1",
          picture: "https://auth.hsfz.live/api/profile/avatar/id?v=2",
        },
      ],
      badgeAssignments: [],
    });

    await expect(service.getCurrentUser("user-1")).resolves.toMatchObject({
      avatarUrl: "https://auth.hsfz.live/api/profile/avatar/id?v=2",
    });

    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: false,
    });
  });

  it("uses the refreshed HFLive picture on another user's public profile", async () => {
    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: true,
    });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "viewer-1", status: "active" })
      .mockResolvedValueOnce({
        id: "user-1",
        username: "teacher",
        displayName: "统一姓名",
        bio: null,
        bannerUpdatedAt: null,
        avatarUpdatedAt: null,
        openContentInCurrentTab: false,
        systemRole: "member",
        status: "active",
        externalIdentities: [
          {
            id: "identity-1",
            picture: "https://auth.hsfz.live/api/profile/avatar/id?v=3",
          },
        ],
        badgeAssignments: [],
      });

    await expect(
      service.getUserProfile("viewer-1", "user-1"),
    ).resolves.toMatchObject({
      avatarUrl: "https://auth.hsfz.live/api/profile/avatar/id?v=3",
    });
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          externalIdentities: {
            where: { issuer: "https://auth.hsfz.live" },
            select: { id: true, picture: true },
            take: 1,
          },
        }),
      }),
    );

    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: false,
    });
  });

  it("shows the first-letter placeholder instead of the local avatar when HFLive has no picture", async () => {
    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "teacher",
      displayName: "统一姓名",
      bio: null,
      bannerUpdatedAt: null,
      avatarUpdatedAt: new Date("2026-08-10T00:00:00.000Z"),
      openContentInCurrentTab: false,
      systemRole: "member",
      status: "active",
      externalIdentities: [{ id: "identity-1", picture: null }],
      badgeAssignments: [],
    });

    await expect(service.getCurrentUser("user-1")).resolves.toMatchObject({
      avatarUrl: null,
    });

    Object.defineProperty(hfliveConfig, "enabled", {
      configurable: true,
      value: false,
    });
  });

  it("aggregates contribution days by category and excludes anonymous forum posts", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "viewer-1", status: "active" })
      .mockResolvedValueOnce({
        id: "user-1",
        status: "active",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      });
    prisma.workspace.findFirst.mockResolvedValue({ timeZone: "Asia/Shanghai" });
    prisma.forumPost.findMany.mockResolvedValue([
      { createdAt: new Date("2026-08-09T01:00:00.000Z") },
    ]);
    prisma.submission.findMany
      .mockResolvedValueOnce([
        { submittedAt: new Date("2026-08-09T03:00:00.000Z") },
      ])
      .mockResolvedValueOnce([
        { gradedAt: new Date("2026-08-09T05:00:00.000Z") },
      ]);
    prisma.file.findMany.mockResolvedValue([]);
    prisma.exerciseSet.findMany.mockResolvedValue([]);
    prisma.teachingDeck.findMany.mockResolvedValue([]);
    prisma.classroomAnnouncement.findMany.mockResolvedValue([]);
    prisma.classroomFile.findMany.mockResolvedValue([]);
    prisma.fileAsset.findMany.mockResolvedValue([]);

    await expect(
      service.getUserContributions("viewer-1", "user-1", "2026"),
    ).resolves.toMatchObject({
      total: 3,
      days: [{ date: "2026-08-09", count: 3 }],
      categories: [
        { category: "learning", count: 1 },
        { category: "teaching", count: 1 },
        { category: "community", count: 1 },
        { category: "resources", count: 0 },
      ],
    });
    expect(prisma.forumPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isAnonymous: false }),
      }),
    );
  });
});
