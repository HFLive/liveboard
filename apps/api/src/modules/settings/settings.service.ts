import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { isSuperAdmin } from "@liveboard/shared";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { HttpsAgentClient } from "./https-agent.client";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpsAgent: HttpsAgentClient,
    private readonly storage: StorageService,
  ) {}

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
    const backend = await this.storage.activeBackend();

    await backend.putObject(storageKey, file.buffer, mimeType);

    let updated: Awaited<ReturnType<typeof this.prisma.workspace.update>>;
    try {
      updated = await this.prisma.workspace.update({
        where: { id: workspace.id },
        data: {
          faviconStorageKey: storageKey,
          faviconMimeType: mimeType,
          faviconUpdatedAt: new Date(),
          faviconStorageBackend: backend.name,
        },
      });
    } catch (caught) {
      await backend.removeObject(storageKey).catch(() => undefined);
      throw caught;
    }

    if (
      workspace.faviconStorageKey &&
      workspace.faviconStorageKey !== storageKey
    ) {
      const previous = await this.storage.backendFor(
        workspace.faviconStorageBackend,
      );
      await previous
        .removeObject(workspace.faviconStorageKey)
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

    const previous = await this.storage.backendFor(
      workspace.faviconStorageBackend,
    );
    await previous
      .removeObject(workspace.faviconStorageKey)
      .catch(() => undefined);

    return this.toPublicSettings(updated);
  }

  async getHttpsStatus(userId: string | null) {
    await this.requireAdmin(userId);
    return this.httpsAgent.status();
  }

  async enableHttps(userId: string | null, domain: string, email: string) {
    await this.requireAdmin(userId);
    return this.httpsAgent.enable(domain.trim(), email.trim());
  }

  async disableHttps(userId: string | null, httpHost?: string) {
    await this.requireAdmin(userId);
    return this.httpsAgent.disable(httpHost?.trim() || undefined);
  }

  async configureHttpAccess(
    userId: string | null,
    primaryHost: string,
    allowedHosts: string[],
  ) {
    await this.requireAdmin(userId);
    return this.httpsAgent.configureHttpAccess(
      primaryHost.trim(),
      allowedHosts.map((host) => host.trim()).filter(Boolean),
    );
  }

  async setHttpsAutoRenew(userId: string | null, enabled: boolean) {
    await this.requireAdmin(userId);
    return this.httpsAgent.setAutoRenew(enabled);
  }

  async getFavicon() {
    const workspace = await this.getDefaultWorkspace();
    if (!workspace.faviconStorageKey) {
      throw new NotFoundException("Website icon not found");
    }

    const mimeType = workspace.faviconMimeType ?? "image/png";
    const redirectUrl = await this.storage.presignDownload(
      workspace.faviconStorageBackend,
      workspace.faviconStorageKey,
      { filename: "favicon", mimeType, inline: true },
    );
    if (redirectUrl) {
      return { mimeType, redirectUrl, stream: null };
    }

    const backend = await this.storage.backendFor(
      workspace.faviconStorageBackend,
    );
    return {
      mimeType,
      redirectUrl: null,
      stream: (await backend.getObject(
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
