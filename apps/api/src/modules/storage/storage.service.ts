import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isSuperAdmin } from "@liveboard/shared";
import type { StorageSettings } from "@prisma/client";
import { Client } from "minio";
import { randomUUID } from "node:crypto";
import { AiSecretService } from "../ai/ai-secret.service";
import { PrismaService } from "../prisma/prisma.service";
import { MinioStorageBackend } from "./minio-storage.backend";
import { OssStorageBackend, type OssClientConfig } from "./oss-storage.backend";
import type {
  ObjectStorageBackend,
  StorageBackendName,
  StorageDownloadMode,
} from "./storage-backend";

export interface OssSettingsInput {
  region?: string;
  bucket?: string;
  endpoint?: string;
  internal?: boolean;
  accessKeyId?: string;
  /** 留空表示沿用已保存的密钥 */
  accessKeySecret?: string;
}

export interface UpdateStorageSettingsInput {
  backend?: string;
  downloadMode?: string;
  oss?: OssSettingsInput;
}

export interface PresignDownloadTarget {
  filename: string;
  mimeType: string;
  inline: boolean;
  cacheControl?: string;
}

export interface StorageFileDistribution {
  minio: { count: number; bytes: number };
  oss: { count: number; bytes: number };
}

const SETTINGS_CACHE_TTL_MS = 30_000;
const PRESIGN_EXPIRY_SECONDS = 600;
const BACKENDS: StorageBackendName[] = ["minio", "oss"];
const DOWNLOAD_MODES: StorageDownloadMode[] = ["proxy", "direct"];

@Injectable()
export class StorageService {
  private readonly minioClient: Client;
  private readonly minioBucket: string;
  private readonly minioEndpointDisplay: string;
  private minioBackend: MinioStorageBackend | null = null;
  private ossBackend: {
    fingerprint: string;
    backend: OssStorageBackend;
  } | null = null;
  private settingsCache: { at: number; value: StorageSettings | null } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly secrets: AiSecretService,
  ) {
    const endpoint = config.get<string>("MINIO_ENDPOINT", "localhost");
    const port = config.get<number>("MINIO_PORT", 9000);
    this.minioBucket = config.get<string>("MINIO_BUCKET", "liveboard-assets");
    this.minioEndpointDisplay = `${endpoint}:${port}`;
    const accessKey = config.get<string>("MINIO_ROOT_USER", "liveboard");
    const secretKey = config.get<string>(
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
    this.minioClient = new Client({
      endPoint: endpoint,
      port,
      useSSL: config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey,
      secretKey,
    });
  }

  /** 当前激活的上传后端。 */
  async activeBackend(): Promise<ObjectStorageBackend> {
    const settings = await this.getSettings();
    return this.backendFor(settings?.backend ?? "minio");
  }

  /** 按对象自身记录的后端解析，保证切换后历史文件仍可读写。 */
  async backendFor(name: StorageBackendName): Promise<ObjectStorageBackend> {
    if (name === "minio") {
      this.minioBackend ??= new MinioStorageBackend(
        this.minioClient,
        this.minioBucket,
      );
      return this.minioBackend;
    }
    const settings = await this.getSettings();
    const config = this.resolveOssClientConfig(settings);
    if (!config) {
      throw new ServiceUnavailableException("阿里云 OSS 尚未正确配置");
    }
    const fingerprint = JSON.stringify(config);
    if (!this.ossBackend || this.ossBackend.fingerprint !== fingerprint) {
      this.ossBackend = {
        fingerprint,
        backend: new OssStorageBackend(config),
      };
    }
    return this.ossBackend.backend;
  }

  /** 当前激活后端的下载模式。 */
  async activeDownloadMode(): Promise<StorageDownloadMode> {
    const settings = await this.getSettings();
    return settings?.downloadMode ?? "proxy";
  }

  /**
   * 直出模式下为对象生成预签名地址；中转模式或后端不支持时返回 null，
   * 调用方回退到服务器流式中转。
   */
  async presignDownload(
    storageBackend: StorageBackendName,
    key: string,
    target: PresignDownloadTarget,
  ): Promise<string | null> {
    const settings = await this.getSettings();
    if ((settings?.downloadMode ?? "proxy") !== "direct") return null;
    const backend = await this.backendFor(storageBackend);
    return backend.presignGet(key, {
      expirySeconds: PRESIGN_EXPIRY_SECONDS,
      responseContentDisposition: `${
        target.inline ? "inline" : "attachment"
      }; filename*=UTF-8''${encodeURIComponent(target.filename)}`,
      ...(target.cacheControl
        ? { responseCacheControl: target.cacheControl }
        : {}),
    });
  }

  async healthCheckActive() {
    const backend = await this.activeBackend();
    await backend.healthCheck();
  }

  async getSettingsForAdmin(userId: string | null) {
    await this.requireSuperAdmin(userId);
    const settings = await this.getSettings();
    const [healthy, fileDistribution] = await Promise.all([
      this.activeBackend()
        .then((backend) => backend.healthCheck())
        .then(() => true)
        .catch(() => false),
      this.fileDistribution(),
    ]);
    return this.toPublicSettings(settings, healthy, fileDistribution);
  }

  async updateSettings(
    userId: string | null,
    input: UpdateStorageSettingsInput,
  ) {
    const user = await this.requireSuperAdmin(userId);
    const backend = parseEnum(input.backend, BACKENDS, "存储后端");
    const downloadMode = parseEnum(
      input.downloadMode,
      DOWNLOAD_MODES,
      "下载模式",
    );
    const existing = await this.getSettings();
    const workspace = await this.getDefaultWorkspace();

    const nextBackend = backend ?? existing?.backend ?? "minio";
    const nextDownloadMode = downloadMode ?? existing?.downloadMode ?? "proxy";
    const mergedOss = this.mergeOssInput(existing, input.oss);
    const effectiveConfig = this.resolveOssClientConfig(
      existing,
      mergedOss ?? undefined,
    );

    if (nextBackend === "oss" && !effectiveConfig) {
      throw new BadRequestException(
        "启用阿里云 OSS 前请完整填写地域、Bucket 和访问凭证",
      );
    }
    // 启用 OSS 或修改 OSS 配置时，必须先通过真实读写探测才允许保存
    if (effectiveConfig && (nextBackend === "oss" || input.oss !== undefined)) {
      await this.probeOss(effectiveConfig);
    }

    const data = {
      backend: nextBackend,
      downloadMode: nextDownloadMode,
      ossRegion: mergedOss?.region ?? null,
      ossBucket: mergedOss?.bucket ?? null,
      ossEndpoint: mergedOss?.endpoint?.trim() || null,
      ossInternal: mergedOss?.internal ?? false,
      ossAccessKeyId: mergedOss?.accessKeyId ?? null,
      ossAccessKeySecret: mergedOss?.accessKeySecret
        ? this.secrets.encrypt(mergedOss.accessKeySecret)
        : (existing?.ossAccessKeySecret ?? null),
      updatedById: user.id,
    };

    const saved = await this.prisma.storageSettings.upsert({
      where: { workspaceId: workspace.id },
      create: { workspaceId: workspace.id, ...data },
      update: data,
    });
    this.settingsCache = null;
    const [healthy, fileDistribution] = await Promise.all([
      this.backendFor(saved.backend)
        .then((backend) => backend.healthCheck())
        .then(() => true)
        .catch(() => false),
      this.fileDistribution(),
    ]);
    return this.toPublicSettings(saved, healthy, fileDistribution);
  }

  async testConnection(userId: string | null, input: OssSettingsInput) {
    await this.requireSuperAdmin(userId);
    const existing = await this.getSettings();
    const merged = this.mergeOssInput(existing, input);
    const config = this.resolveOssClientConfig(existing, merged ?? undefined);
    if (!config) {
      throw new BadRequestException(
        "请完整填写地域、Bucket、AccessKey ID 和 AccessKey Secret",
      );
    }
    await this.probeOss(config);
    return { ok: true as const };
  }

  private async probeOss(config: OssClientConfig) {
    const backend = new OssStorageBackend(config);
    const probeKey = `site/storage-probe/${randomUUID()}`;
    try {
      await backend.healthCheck();
      await backend.putObject(probeKey, Buffer.from("ok"), "text/plain");
      await backend.removeObject(probeKey);
    } catch (caught) {
      await backend.removeObject(probeKey).catch(() => undefined);
      const code =
        typeof caught === "object" && caught !== null && "code" in caught
          ? String((caught as { code: unknown }).code)
          : "";
      const detail = caught instanceof Error ? caught.message : "请检查配置";
      throw new BadRequestException(
        `无法连接阿里云 OSS：${code ? `[${code}] ` : ""}${detail}`,
      );
    }
  }

  private mergeOssInput(
    existing: StorageSettings | null,
    input?: OssSettingsInput,
  ) {
    if (!input) {
      return existing
        ? {
            region: existing.ossRegion ?? undefined,
            bucket: existing.ossBucket ?? undefined,
            endpoint: existing.ossEndpoint ?? undefined,
            internal: existing.ossInternal,
            accessKeyId: existing.ossAccessKeyId ?? undefined,
          }
        : null;
    }
    return {
      region: input.region?.trim() || (existing?.ossRegion ?? undefined),
      bucket: input.bucket?.trim() || (existing?.ossBucket ?? undefined),
      endpoint:
        input.endpoint !== undefined
          ? input.endpoint.trim() || undefined
          : (existing?.ossEndpoint ?? undefined),
      internal: input.internal ?? existing?.ossInternal ?? false,
      accessKeyId:
        input.accessKeyId?.trim() || (existing?.ossAccessKeyId ?? undefined),
      accessKeySecret: input.accessKeySecret?.trim() || undefined,
    };
  }

  private resolveOssClientConfig(
    settings: StorageSettings | null,
    merged?: ReturnType<StorageService["mergeOssInput"]>,
  ): OssClientConfig | null {
    const source =
      merged ??
      (settings
        ? {
            region: settings.ossRegion ?? undefined,
            bucket: settings.ossBucket ?? undefined,
            endpoint: settings.ossEndpoint ?? undefined,
            internal: settings.ossInternal,
            accessKeyId: settings.ossAccessKeyId ?? undefined,
          }
        : null);
    if (!source?.region || !source.bucket || !source.accessKeyId) return null;
    const encryptedSecret =
      merged?.accessKeySecret ?? settings?.ossAccessKeySecret;
    if (!encryptedSecret) return null;
    return {
      region: source.region,
      bucket: source.bucket,
      endpoint: source.endpoint ?? null,
      internal: source.internal ?? false,
      accessKeyId: source.accessKeyId,
      accessKeySecret: this.secrets.decrypt(encryptedSecret),
    };
  }

  /** 统计课堂文件与文档附件分别落在服务器存储 / OSS 上的数量与体积。 */
  private async fileDistribution(): Promise<StorageFileDistribution> {
    const [classroomFiles, fileAssets] = await Promise.all([
      this.prisma.classroomFile.groupBy({
        by: ["storageBackend"],
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileAsset.groupBy({
        by: ["storageBackend"],
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
    ]);
    const distribution: StorageFileDistribution = {
      minio: { count: 0, bytes: 0 },
      oss: { count: 0, bytes: 0 },
    };
    for (const row of [...classroomFiles, ...fileAssets]) {
      const bucket =
        row.storageBackend === "oss" ? distribution.oss : distribution.minio;
      bucket.count += row._count._all;
      bucket.bytes += row._sum.sizeBytes ?? 0;
    }
    return distribution;
  }

  private async getSettings() {
    if (
      this.settingsCache &&
      Date.now() - this.settingsCache.at < SETTINGS_CACHE_TTL_MS
    ) {
      return this.settingsCache.value;
    }
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    const value = workspace
      ? await this.prisma.storageSettings.findUnique({
          where: { workspaceId: workspace.id },
        })
      : null;
    this.settingsCache = { at: Date.now(), value };
    return value;
  }

  private async getDefaultWorkspace() {
    const workspace = await this.prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!workspace) throw new NotFoundException("Workspace not found");
    return workspace;
  }

  private async requireSuperAdmin(userId: string | null) {
    if (!userId) throw new UnauthorizedException("Missing session");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !isSuperAdmin(user.systemRole) || user.status !== "active") {
      throw new ForbiddenException("只有最高管理员可以管理存储设置");
    }
    return user;
  }

  private toPublicSettings(
    settings: StorageSettings | null,
    activeBackendHealthy: boolean,
    fileDistribution: StorageFileDistribution,
  ) {
    return {
      backend: settings?.backend ?? "minio",
      downloadMode: settings?.downloadMode ?? "proxy",
      minio: {
        endpoint: this.minioEndpointDisplay,
        bucket: this.minioBucket,
      },
      oss: {
        region: settings?.ossRegion ?? null,
        bucket: settings?.ossBucket ?? null,
        endpoint: settings?.ossEndpoint ?? null,
        internal: settings?.ossInternal ?? false,
        accessKeyId: settings?.ossAccessKeyId ?? null,
        secretConfigured: Boolean(settings?.ossAccessKeySecret),
      },
      activeBackendHealthy,
      fileDistribution,
      updatedAt: settings?.updatedAt.toISOString() ?? null,
    };
  }
}

function parseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`无效的${label}`);
  }
  return value as T;
}
