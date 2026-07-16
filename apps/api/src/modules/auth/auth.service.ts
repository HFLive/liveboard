import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { UserProfile, UserSummary } from "@liveboard/shared";
import argon2 from "argon2";
import { Client } from "minio";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
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
const PROFILE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = argon2.hash(randomUUID());
  private readonly minio: Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loginRateLimit: LoginRateLimitService,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>("MINIO_BUCKET", "liveboard-assets");
    const accessKey = this.config.get<string>("MINIO_ROOT_USER", "liveboard");
    const secretKey = this.config.get<string>(
      "MINIO_ROOT_PASSWORD",
      "replace-with-a-strong-password",
    );

    if (
      process.env.NODE_ENV === "production" &&
      (!accessKey ||
        !secretKey ||
        secretKey === "replace-with-a-strong-password")
    ) {
      throw new Error(
        "Secure MinIO credentials must be configured in production",
      );
    }

    this.minio = new Client({
      endPoint: this.config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: this.config.get<number>("MINIO_PORT", 9000),
      useSSL: this.config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey,
      secretKey,
    });
  }

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
    });

    if (!target || target.status !== "active") {
      throw new NotFoundException("User not found");
    }

    return this.toProfile(target);
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

    await this.ensureBucket();
    await this.minio.putObject(
      this.bucket,
      storageKey,
      file.buffer,
      file.size,
      {
        "Content-Type": mimeType,
      },
    );

    let updated: Awaited<ReturnType<typeof this.prisma.user.update>>;
    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          avatarStorageKey: storageKey,
          avatarMimeType: mimeType,
          avatarUpdatedAt: new Date(),
        },
      });
    } catch (caught) {
      await this.minio
        .removeObject(this.bucket, storageKey)
        .catch(() => undefined);
      throw caught;
    }

    if (user.avatarStorageKey && user.avatarStorageKey !== storageKey) {
      await this.minio
        .removeObject(this.bucket, user.avatarStorageKey)
        .catch(() => undefined);
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

    await this.ensureBucket();
    await this.minio.putObject(
      this.bucket,
      storageKey,
      file.buffer,
      file.size,
      { "Content-Type": mimeType },
    );

    let updated: Awaited<ReturnType<typeof this.prisma.user.update>>;
    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          bannerStorageKey: storageKey,
          bannerMimeType: mimeType,
          bannerUpdatedAt: new Date(),
        },
      });
    } catch (caught) {
      await this.minio
        .removeObject(this.bucket, storageKey)
        .catch(() => undefined);
      throw caught;
    }

    if (user.bannerStorageKey && user.bannerStorageKey !== storageKey) {
      await this.minio
        .removeObject(this.bucket, user.bannerStorageKey)
        .catch(() => undefined);
    }

    return this.toProfile(updated);
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
        status: true,
      },
    });

    if (!user || user.status !== "active" || !user.avatarStorageKey) {
      throw new NotFoundException("Avatar not found");
    }

    const stream = await this.minio.getObject(
      this.bucket,
      user.avatarStorageKey,
    );

    return {
      mimeType: user.avatarMimeType ?? "image/webp",
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
        status: true,
      },
    });

    if (!user || user.status !== "active" || !user.bannerStorageKey) {
      throw new NotFoundException("Banner not found");
    }

    const stream = await this.minio.getObject(
      this.bucket,
      user.bannerStorageKey,
    );

    return {
      mimeType: user.bannerMimeType ?? "image/webp",
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

  private async ensureBucket() {
    const exists = await this.minio.bucketExists(this.bucket);
    if (!exists) {
      await this.minio.makeBucket(this.bucket);
    }
  }

  private toSummary(user: {
    id: string;
    username: string;
    displayName: string;
    avatarUpdatedAt?: Date | null;
    systemRole: UserSummary["systemRole"];
    status: UserSummary["status"];
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
