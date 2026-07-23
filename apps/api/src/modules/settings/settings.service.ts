import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isSuperAdmin } from "@liveboard/shared";
import { Client } from "minio";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";

export interface UpdateSystemSettingsInput {
  timeZone?: string;
}

export interface UploadedFaviconFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_FAVICON_SIZE_BYTES = 1024 * 1024;

@Injectable()
export class SettingsService {
  private readonly minio: Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>("MINIO_BUCKET", "liveboard-assets");
    this.minio = new Client({
      endPoint: config.get<string>("MINIO_ENDPOINT", "localhost"),
      port: config.get<number>("MINIO_PORT", 9000),
      useSSL: config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey: config.get<string>("MINIO_ROOT_USER", "liveboard"),
      secretKey: config.get<string>(
        "MINIO_ROOT_PASSWORD",
        "replace-with-a-strong-password",
      ),
    });
  }

  async getPublicSettings() {
    const workspace = await this.getDefaultWorkspace();

    return this.toPublicSettings(workspace);
  }

  async getSettings(userId: string | null) {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();

    return this.toPublicSettings(workspace);
  }

  async updateSettings(
    userId: string | null,
    input: UpdateSystemSettingsInput,
  ) {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    const data: { timeZone?: string } = {};

    if (input.timeZone !== undefined) {
      data.timeZone = normalizeTimeZone(input.timeZone);
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspace.id },
      data,
    });

    return this.toPublicSettings(updated);
  }

  async updateFavicon(
    userId: string | null,
    file: UploadedFaviconFile | undefined,
  ) {
    await this.requireAdmin(userId);
    if (!file) throw new BadRequestException("请选择网站图标");
    if (file.size > MAX_FAVICON_SIZE_BYTES) {
      throw new BadRequestException("网站图标不能超过 1MB");
    }

    const mimeType = detectFaviconMimeType(file.buffer);
    if (!mimeType) {
      throw new BadRequestException("网站图标仅支持 ICO、PNG、JPEG 或 WebP");
    }

    const workspace = await this.getDefaultWorkspace();
    const extension =
      mimeType === "image/x-icon"
        ? "ico"
        : mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : "jpg";
    const storageKey = `site/favicon/${randomUUID()}.${extension}`;

    await this.ensureBucket();
    await this.minio.putObject(
      this.bucket,
      storageKey,
      file.buffer,
      file.size,
      { "Content-Type": mimeType },
    );

    let updated: Awaited<ReturnType<typeof this.prisma.workspace.update>>;
    try {
      updated = await this.prisma.workspace.update({
        where: { id: workspace.id },
        data: {
          faviconStorageKey: storageKey,
          faviconMimeType: mimeType,
          faviconUpdatedAt: new Date(),
        },
      });
    } catch (caught) {
      await this.minio
        .removeObject(this.bucket, storageKey)
        .catch(() => undefined);
      throw caught;
    }

    if (
      workspace.faviconStorageKey &&
      workspace.faviconStorageKey !== storageKey
    ) {
      await this.minio
        .removeObject(this.bucket, workspace.faviconStorageKey)
        .catch(() => undefined);
    }

    return this.toPublicSettings(updated);
  }

  async resetFavicon(userId: string | null) {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();

    if (!workspace.faviconStorageKey) {
      return this.toPublicSettings(workspace);
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        faviconStorageKey: null,
        faviconMimeType: null,
        faviconUpdatedAt: null,
      },
    });

    await this.minio
      .removeObject(this.bucket, workspace.faviconStorageKey)
      .catch(() => undefined);

    return this.toPublicSettings(updated);
  }

  async getFavicon() {
    const workspace = await this.getDefaultWorkspace();
    if (!workspace.faviconStorageKey) {
      throw new NotFoundException("Website icon not found");
    }

    return {
      mimeType: workspace.faviconMimeType ?? "image/png",
      updatedAt: workspace.faviconUpdatedAt,
      stream: (await this.minio.getObject(
        this.bucket,
        workspace.faviconStorageKey,
      )) as Readable,
    };
  }

  private async requireAdmin(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Missing session");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !isSuperAdmin(user.systemRole) || user.status !== "active") {
      throw new ForbiddenException(
        "Only super administrators can manage system settings",
      );
    }
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    return workspace;
  }

  private async ensureBucket() {
    if (!(await this.minio.bucketExists(this.bucket))) {
      await this.minio.makeBucket(this.bucket);
    }
  }

  private toPublicSettings(workspace: {
    name: string;
    slug: string;
    timeZone: string;
    faviconUpdatedAt?: Date | null;
    updatedAt: Date;
  }) {
    return {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      timeZone: workspace.timeZone,
      faviconUrl: workspace.faviconUpdatedAt
        ? `/settings/favicon?v=${workspace.faviconUpdatedAt.getTime()}`
        : null,
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }
}

function detectFaviconMimeType(buffer: Buffer) {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00
  ) {
    return "image/x-icon";
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function normalizeTimeZone(value: string) {
  const timeZone = value.trim();

  if (!timeZone) {
    throw new BadRequestException("时区不能为空");
  }

  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format(new Date());
  } catch {
    throw new BadRequestException("无效的 IANA 时区标识");
  }

  return timeZone;
}
