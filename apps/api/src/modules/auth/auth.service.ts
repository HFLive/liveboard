import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotImplementedException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  UserProfile,
  UserPublicActivity,
  UserSummary,
} from "@liveboard/shared";
import argon2 from "argon2";
import type { PendingUpload } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import type { StorageBackendName } from "../storage/storage-backend";
import { StorageService } from "../storage/storage.service";
import type { ChangePasswordDto, UpdateProfileDto } from "./auth.dto";
import { LoginRateLimitService } from "./login-rate-limit.service";

export interface UploadedProfileImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
export const MAX_BANNER_SIZE_BYTES = 5 * 1024 * 1024;
const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;
const PROFILE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = argon2.hash(randomUUID());

  constructor(
    private readonly prisma: PrismaService,
    private readonly loginRateLimit: LoginRateLimitService,
    private readonly storage: StorageService,
  ) {}

  async validateLogin(
    username: string,
    password: string,
    clientAddress = "unknown",
  ): Promise<{ user: UserSummary; sessionVersion: number }> {
    const normalizedUsername = username.trim();
    if (
      await this.loginRateLimit.isBlocked(clientAddress, normalizedUsername)
    ) {
      throw new HttpException(
        "登录尝试过多，请稍后再试",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      include: {
        badgeAssignments: {
          where: { equippedOrder: { not: null } },
          include: { badge: true },
          orderBy: { equippedOrder: "asc" },
          take: 3,
        },
      },
    });
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? (await this.dummyPasswordHash),
      password,
    );

    if (!user || user.status !== "active" || !passwordMatches) {
      await this.loginRateLimit.recordFailure(
        clientAddress,
        normalizedUsername,
      );
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.loginRateLimit.clear(clientAddress, normalizedUsername);
    return { user: this.toSummary(user), sessionVersion: user.sessionVersion };
  }

  async getCurrentUser(userId: string | null): Promise<UserProfile> {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        badgeAssignments: {
          where: { equippedOrder: { not: null } },
          include: { badge: true },
          orderBy: { equippedOrder: "asc" },
          take: 3,
        },
      },
    });

    if (!user || user.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return this.toProfile(user);
  }

  async getUserProfile(
    userId: string | null,
    targetUserId: string,
  ): Promise<UserProfile> {
    await this.requireActiveUser(userId);
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        badgeAssignments: {
          where: { equippedOrder: { not: null } },
          include: { badge: true },
          orderBy: { equippedOrder: "asc" },
          take: 3,
        },
      },
    });

    if (!target || target.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return this.toProfile(target);
  }

  async getUserPublicActivity(
    userId: string | null,
    targetUserId: string,
  ): Promise<UserPublicActivity> {
    await this.requireActiveUser(userId);
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });

    if (!target || target.status !== "active") {
      throw new NotFoundException("User not found");
    }

    const forumThreads = await this.prisma.forumThread.findMany({
      where: { authorId: targetUserId, isAnonymous: false },
      include: {
        category: { select: { name: true } },
        _count: { select: { posts: true } },
      },
      orderBy: { lastActivityAt: "desc" },
      take: 8,
    });

    return {
      forumThreads: forumThreads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        categoryName: thread.category.name,
        postCount: thread._count.posts,
        lastActivityAt: thread.lastActivityAt.toISOString(),
      })),
    };
  }

  async updateProfile(
    userId: string | null,
    input: UpdateProfileDto,
  ): Promise<UserProfile> {
    const user = await this.requireActiveUser(userId);
    const data: { displayName?: string; bio?: string | null } = {};

    if (typeof input.displayName === "string") {
      const displayName = input.displayName.trim();
      if (!displayName) {
        throw new BadRequestException("显示名不能为空");
      }
      data.displayName = displayName;
    }

    if (typeof input.bio === "string") {
      data.bio = input.bio.trim() || null;
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });

    return this.toProfile(updated);
  }

  async updateAvatar(
    userId: string | null,
    file: UploadedProfileImageFile | undefined,
  ): Promise<UserProfile> {
    const user = await this.requireActiveUser(userId);

    if (!file) {
      throw new BadRequestException("请选择头像图片");
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new BadRequestException("头像图片不能超过 2MB");
    }

    const mimeType = normalizeProfileImageMimeType(file, "头像");
    const storageKey = `avatars/${user.id}/${randomUUID()}.${profileImageExtension(mimeType)}`;
    const backend = await this.storage.activeBackend();

    await backend.putObject(storageKey, file.buffer, mimeType);

    let updated: Awaited<ReturnType<typeof this.prisma.user.update>>;
    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          avatarStorageKey: storageKey,
          avatarMimeType: mimeType,
          avatarUpdatedAt: new Date(),
          avatarStorageBackend: backend.name,
        },
      });
    } catch (caught) {
      await backend.removeObject(storageKey).catch(() => undefined);
      throw caught;
    }

    if (user.avatarStorageKey && user.avatarStorageKey !== storageKey) {
      const previous = await this.storage.backendFor(user.avatarStorageBackend);
      await previous.removeObject(user.avatarStorageKey).catch(() => undefined);
    }

    return this.toProfile(updated);
  }

  async updateBanner(
    userId: string | null,
    file: UploadedProfileImageFile | undefined,
  ): Promise<UserProfile> {
    const user = await this.requireActiveUser(userId);

    if (!file) {
      throw new BadRequestException("请选择 Banner 图片");
    }

    if (file.size > MAX_BANNER_SIZE_BYTES) {
      throw new BadRequestException("Banner 图片不能超过 5MB");
    }

    const mimeType = normalizeProfileImageMimeType(file, "Banner");
    const storageKey = `banners/${user.id}/${randomUUID()}.${profileImageExtension(mimeType)}`;
    const backend = await this.storage.activeBackend();

    await backend.putObject(storageKey, file.buffer, mimeType);

    let updated: Awaited<ReturnType<typeof this.prisma.user.update>>;
    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          bannerStorageKey: storageKey,
          bannerMimeType: mimeType,
          bannerUpdatedAt: new Date(),
          bannerStorageBackend: backend.name,
        },
      });
    } catch (caught) {
      await backend.removeObject(storageKey).catch(() => undefined);
      throw caught;
    }

    if (user.bannerStorageKey && user.bannerStorageKey !== storageKey) {
      const previous = await this.storage.backendFor(user.bannerStorageBackend);
      await previous.removeObject(user.bannerStorageKey).catch(() => undefined);
    }

    return this.toProfile(updated);
  }

  /**
   * Banner 直传第一步：校验并预留 PendingUpload，返回浏览器直传对象存储的
   * 上传指令。Banner 上限 5MB，超过 Vercel 普通请求体限制，Vercel 下必须直传。
   */
  async signBannerUpload(
    userId: string | null,
    input: { filename: string; sizeBytes: number; mimeType?: string },
  ) {
    const user = await this.requireActiveUser(userId);
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException("无效的文件大小");
    }
    if (input.sizeBytes > MAX_BANNER_SIZE_BYTES) {
      throw new BadRequestException("Banner 图片不能超过 5MB");
    }
    const mimeType = normalizeDirectProfileMime(
      input.filename,
      input.mimeType,
      "Banner",
    );
    const storageKey = `banners/${user.id}/${randomUUID()}.${profileImageExtension(mimeType)}`;
    const backend = await this.storage.activeBackend();
    const instruction = await this.storage.signUpload(
      backend.name,
      this.storage.objectKeyForPendingUpload(backend.name, storageKey),
      { sizeBytes: input.sizeBytes, mimeType },
    );
    if (!instruction) {
      throw new NotImplementedException(
        "当前存储配置不支持签名直入,请改用服务器中转上传",
      );
    }
    await this.reapExpiredPendingUploads(user.id);
    const workspace = await this.getDefaultWorkspace();
    const pending = await this.prisma.pendingUpload.create({
      data: {
        kind: "profile_banner",
        workspaceId: workspace.id,
        storageBackend: backend.name,
        filename: "banner",
        mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        uploadedBy: user.id,
        expiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
      },
    });
    return {
      uploadId: pending.id,
      instruction,
      expiresAt: instruction.expiresAt,
    };
  }

  /** Banner 直传第三步：校验对象与真实文件头后更新用户 Banner。 */
  async confirmBannerUpload(userId: string | null, uploadId: string) {
    const user = await this.requireActiveUser(userId);
    const pending = await this.requirePendingUpload(user.id, uploadId);
    try {
      await this.storage.verifyAndFinalizePendingObject(pending);
      const backend = await this.storage.backendFor(pending.storageBackend);
      const buffer = await readStreamBuffer(
        await backend.getObject(pending.storageKey),
        MAX_BANNER_SIZE_BYTES,
      );
      const detectedMime = detectAvatarMimeType(buffer);
      if (!detectedMime || !PROFILE_IMAGE_MIMES.has(detectedMime)) {
        throw new BadRequestException("Banner 仅支持 PNG、JPEG 或 WebP 图片");
      }

      const updated = await this.prisma.$transaction(async (transaction) => {
        const result = await transaction.user.update({
          where: { id: user.id },
          data: {
            bannerStorageKey: pending.storageKey,
            bannerMimeType: detectedMime,
            bannerUpdatedAt: new Date(),
            bannerStorageBackend: pending.storageBackend,
          },
        });
        await transaction.pendingUpload.delete({
          where: { id: pending.id },
        });
        return result;
      });

      // 更新成功后尽力删除旧 Banner；失败不回滚新 Banner。
      if (
        user.bannerStorageKey &&
        user.bannerStorageKey !== pending.storageKey
      ) {
        const previous = await this.storage
          .backendFor(user.bannerStorageBackend as StorageBackendName)
          .catch(() => null);
        if (previous) {
          await previous
            .removeObject(user.bannerStorageKey)
            .catch(() => undefined);
        }
      }
      return this.toProfile(updated);
    } catch (caught) {
      await this.storage.discardPendingUpload(pending);
      throw caught;
    }
  }

  /** Banner 直传取消或失败时释放预留并清理对象；重复调用安全。 */
  async abortBannerUpload(userId: string | null, uploadId: string) {
    const user = await this.requireActiveUser(userId);
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (
      pending &&
      pending.kind === "profile_banner" &&
      pending.uploadedBy === user.id
    ) {
      await this.storage.discardPendingUpload(pending);
    }
    return { ok: true as const };
  }

  private async requirePendingUpload(userId: string, uploadId: string) {
    const pending = await this.prisma.pendingUpload.findUnique({
      where: { id: uploadId },
    });
    if (
      !pending ||
      pending.kind !== "profile_banner" ||
      pending.uploadedBy !== userId
    ) {
      throw new NotFoundException("上传任务不存在或已完成");
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.storage.discardPendingUpload(pending);
      throw new NotFoundException("上传任务已过期,请重新上传");
    }
    return pending;
  }

  /** 惰性清理：签名新任务时回收该用户已过期的直入预留。 */
  private async reapExpiredPendingUploads(userId: string) {
    const expired = await this.prisma.pendingUpload.findMany({
      where: { uploadedBy: userId, expiresAt: { lte: new Date() } },
      take: 20,
    });
    for (const pending of expired) {
      await this.storage.discardPendingUpload(pending);
    }
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    return workspace;
  }

  async getAvatar(userId: string | null, targetUserId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        avatarStorageKey: true,
        avatarMimeType: true,
        avatarStorageBackend: true,
        status: true,
      },
    });

    if (!user || user.status !== "active" || !user.avatarStorageKey) {
      throw new NotFoundException("Avatar not found");
    }

    const mimeType = user.avatarMimeType ?? "image/webp";
    const redirectUrl = await this.storage.presignDownload(
      user.avatarStorageBackend,
      user.avatarStorageKey,
      { filename: "avatar", mimeType, inline: true },
    );
    if (redirectUrl) {
      return { mimeType, redirectUrl, stream: null };
    }

    const backend = await this.storage.backendFor(user.avatarStorageBackend);
    const stream = await backend.getObject(user.avatarStorageKey);

    return {
      mimeType,
      redirectUrl: null,
      stream: stream as Readable,
    };
  }

  async getBanner(userId: string | null, targetUserId: string) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        bannerStorageKey: true,
        bannerMimeType: true,
        bannerStorageBackend: true,
        status: true,
      },
    });

    if (!user || user.status !== "active" || !user.bannerStorageKey) {
      throw new NotFoundException("Banner not found");
    }

    const mimeType = user.bannerMimeType ?? "image/webp";
    const redirectUrl = await this.storage.presignDownload(
      user.bannerStorageBackend,
      user.bannerStorageKey,
      { filename: "banner", mimeType, inline: true },
    );
    if (redirectUrl) {
      return { mimeType, redirectUrl, stream: null };
    }

    const backend = await this.storage.backendFor(user.bannerStorageBackend);
    const stream = await backend.getObject(user.bannerStorageKey);

    return {
      mimeType,
      redirectUrl: null,
      stream: stream as Readable,
    };
  }

  async changePassword(userId: string | null, input: ChangePasswordDto) {
    const user = await this.requireActiveUser(userId);
    const passwordMatches = await argon2.verify(
      user.passwordHash,
      input.currentPassword,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("当前密码不正确");
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(input.newPassword),
        sessionVersion: { increment: 1 },
      },
      select: { id: true, sessionVersion: true },
    });

    return { userId: updated.id, sessionVersion: updated.sessionVersion };
  }

  private async requireActiveUser(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private toSummary(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt?: Date | null;
    systemRole: UserSummary["systemRole"];
    status: UserSummary["status"];
    badgeAssignments?: Array<{
      equippedOrder: number | null;
      badge: {
        id: string;
        name: string;
        description: string | null;
        color: string;
      };
    }>;
  }): UserSummary {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUpdatedAt
        ? `/auth/avatar/${user.id}?v=${user.avatarUpdatedAt.getTime()}`
        : null,
      systemRole: user.systemRole,
      status: user.status,
      badges: user.badgeAssignments?.map(({ badge }) => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
        color: normalizeBadgeColor(badge.color),
      })),
    };
  }

  private toProfile(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt?: Date | null;
    bio?: string | null;
    bannerUpdatedAt?: Date | null;
    systemRole: UserSummary["systemRole"];
    status: UserSummary["status"];
    badgeAssignments?: Array<{
      equippedOrder: number | null;
      badge: {
        id: string;
        name: string;
        description: string | null;
        color: string;
      };
    }>;
  }): UserProfile {
    return {
      ...this.toSummary(user),
      bio: user.bio ?? null,
      bannerUrl: user.bannerUpdatedAt
        ? `/auth/banner/${user.id}?v=${user.bannerUpdatedAt.getTime()}`
        : null,
    };
  }
}

function normalizeBadgeColor(value: string) {
  return ["gold", "blue", "green", "purple", "red", "gray"].includes(value)
    ? (value as NonNullable<UserSummary["badges"]>[number]["color"])
    : ("gray" as const);
}

function normalizeProfileImageMimeType(
  file: UploadedProfileImageFile,
  label: string,
) {
  const mimeType = detectAvatarMimeType(file.buffer);

  if (!mimeType || !PROFILE_IMAGE_MIMES.has(mimeType)) {
    throw new BadRequestException(`${label}仅支持 PNG、JPEG 或 WebP 图片`);
  }

  return mimeType;
}

function profileImageExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "webp";
}

/**
 * 签名直入拿不到文件内容，只能基于文件名与浏览器声明的 MIME 归一化；
 * 拒绝 SVG，只放行头像/Banner 允许的图片类型，真实文件头在 confirm 时校验。
 */
function normalizeDirectProfileMime(
  filename: string,
  declared?: string,
  label = "图片",
) {
  const lowerName = filename.toLowerCase();
  const declaredMime = declared?.trim().toLowerCase() ?? "";
  if (lowerName.endsWith(".svg") || declaredMime === "image/svg+xml") {
    throw new BadRequestException("不支持上传 SVG 文件");
  }
  if (PROFILE_IMAGE_MIMES.has(declaredMime)) return declaredMime;
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".webp")) return "image/webp";
  throw new BadRequestException(`${label}仅支持 PNG、JPEG 或 WebP 图片`);
}

async function readStreamBuffer(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new BadRequestException("图片内容过大，无法处理");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function detectAvatarMimeType(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}
