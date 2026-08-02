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
import type { StorageBackendName } from "../storage/storage-backend";
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
export type FaviconVariant = "default" | "light" | "dark";

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
    variant: FaviconVariant = "default",
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
    const storageKey = `site/favicon/${variant}/${randomUUID()}.${extension}`;
    const backend = await this.storage.activeBackend();

    await backend.putObject(storageKey, file.buffer, mimeType);

    let updated: Awaited<ReturnType<typeof this.prisma.workspace.update>>;
    try {
      updated = await this.prisma.workspace.update({
        where: { id: workspace.id },
        data: faviconUpdateData(variant, storageKey, mimeType, backend.name),
      });
    } catch (caught) {
      await backend.removeObject(storageKey).catch(() => undefined);
      throw caught;
    }

    const previousIcon = storedFavicon(workspace, variant);
    if (previousIcon.storageKey && previousIcon.storageKey !== storageKey) {
      const previous = await this.storage.backendFor(previousIcon.backend);
      await previous
        .removeObject(previousIcon.storageKey)
        .catch(() => undefined);
    }

    return this.toPublicSettings(updated);
  }

  async resetFavicon(
    userId: string | null,
    variant: FaviconVariant = "default",
  ) {
    await this.requireAdmin(userId);
    const workspace = await this.getDefaultWorkspace();
    const currentIcon = storedFavicon(workspace, variant);

    if (!currentIcon.storageKey) {
      return this.toPublicSettings(workspace);
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: faviconResetData(variant),
    });

    const previous = await this.storage.backendFor(currentIcon.backend);
    await previous.removeObject(currentIcon.storageKey).catch(() => undefined);

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

  async getFavicon(variant: FaviconVariant = "default") {
    const workspace = await this.getDefaultWorkspace();
    const icon = storedFavicon(workspace, variant);
    if (!icon.storageKey) {
      throw new NotFoundException("Website icon not found");
    }

    const mimeType = icon.mimeType ?? "image/png";
    const backend = await this.storage.backendFor(icon.backend);
    return {
      mimeType,
      stream: (await backend.getObject(icon.storageKey)) as Readable,
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
    faviconLightUpdatedAt?: Date | null;
    faviconDarkUpdatedAt?: Date | null;
    updatedAt: Date;
  }) {
    return {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      timeZone: workspace.timeZone,
      faviconUrl: workspace.faviconUpdatedAt
        ? `/settings/favicon?v=${workspace.faviconUpdatedAt.getTime()}`
        : null,
      faviconLightUrl: workspace.faviconLightUpdatedAt
        ? `/settings/favicon/light?v=${workspace.faviconLightUpdatedAt.getTime()}`
        : null,
      faviconDarkUrl: workspace.faviconDarkUpdatedAt
        ? `/settings/favicon/dark?v=${workspace.faviconDarkUpdatedAt.getTime()}`
        : null,
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }
}

function storedFavicon(
  workspace: {
    faviconStorageKey: string | null;
    faviconMimeType: string | null;
    faviconStorageBackend: StorageBackendName;
    faviconLightStorageKey: string | null;
    faviconLightMimeType: string | null;
    faviconLightStorageBackend: StorageBackendName;
    faviconDarkStorageKey: string | null;
    faviconDarkMimeType: string | null;
    faviconDarkStorageBackend: StorageBackendName;
  },
  variant: FaviconVariant,
) {
  if (variant === "light") {
    return {
      storageKey: workspace.faviconLightStorageKey,
      mimeType: workspace.faviconLightMimeType,
      backend: workspace.faviconLightStorageBackend,
    };
  }
  if (variant === "dark") {
    return {
      storageKey: workspace.faviconDarkStorageKey,
      mimeType: workspace.faviconDarkMimeType,
      backend: workspace.faviconDarkStorageBackend,
    };
  }
  return {
    storageKey: workspace.faviconStorageKey,
    mimeType: workspace.faviconMimeType,
    backend: workspace.faviconStorageBackend,
  };
}

function faviconUpdateData(
  variant: FaviconVariant,
  storageKey: string,
  mimeType: string,
  backend: StorageBackendName,
) {
  const updatedAt = new Date();
  if (variant === "light") {
    return {
      faviconLightStorageKey: storageKey,
      faviconLightMimeType: mimeType,
      faviconLightUpdatedAt: updatedAt,
      faviconLightStorageBackend: backend,
    };
  }
  if (variant === "dark") {
    return {
      faviconDarkStorageKey: storageKey,
      faviconDarkMimeType: mimeType,
      faviconDarkUpdatedAt: updatedAt,
      faviconDarkStorageBackend: backend,
    };
  }
  return {
    faviconStorageKey: storageKey,
    faviconMimeType: mimeType,
    faviconUpdatedAt: updatedAt,
    faviconStorageBackend: backend,
  };
}

function faviconResetData(variant: FaviconVariant) {
  if (variant === "light") {
    return {
      faviconLightStorageKey: null,
      faviconLightMimeType: null,
      faviconLightUpdatedAt: null,
    };
  }
  if (variant === "dark") {
    return {
      faviconDarkStorageKey: null,
      faviconDarkMimeType: null,
      faviconDarkUpdatedAt: null,
    };
  }
  return {
    faviconStorageKey: null,
    faviconMimeType: null,
    faviconUpdatedAt: null,
  };
}

export function parseFaviconVariant(value: string): FaviconVariant {
  if (value === "default" || value === "light" || value === "dark") {
    return value;
  }
  throw new BadRequestException("未知的网站图标版本");
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
