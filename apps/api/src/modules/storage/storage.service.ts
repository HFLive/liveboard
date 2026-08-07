import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isSuperAdmin } from "@liveboard/shared";
import type { PendingUpload, StorageSettings } from "@prisma/client";
import { Client } from "minio";
import { randomUUID } from "node:crypto";
import {
  getDeploymentTarget,
  type DeploymentTarget,
} from "../../common/deployment-target";
import { AiSecretService } from "../ai/ai-secret.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MinioStorageBackend } from "./minio-storage.backend";
import { OssStorageBackend, type OssClientConfig } from "./oss-storage.backend";
import {
  R2_PRESIGN_PUT_TTL_SECONDS,
  R2StorageBackend,
  resolveR2ClientConfig,
  type R2ClientConfig,
} from "./r2-storage.backend";
import type {
  ObjectStorageBackend,
  ObjectUploadInstruction,
  StorageBackendName,
  StorageDownloadMode,
  StorageUploadMode,
} from "./storage-backend";
import {
  ATOMIC_UPLOAD_PART_SIZE_BYTES,
  isSafeInlineImageMime,
  multipartPartCount,
  MULTIPART_UPLOAD_PART_SIZE_BYTES,
  shouldUseMultipartUpload,
} from "./storage-backend";

export interface OssSettingsInput {
  region?: string;
  bucket?: string;
  endpoint?: string;
  internal?: boolean;
  /** 自定义内网 Endpoint;留空用阿里云默认内网域名 */
  internalEndpoint?: string;
  accessKeyId?: string;
  /** 留空表示沿用已保存的密钥 */
  accessKeySecret?: string;
}

export interface UpdateStorageSettingsInput {
  backend?: string;
  downloadMode?: string;
  uploadMode?: string;
  oss?: OssSettingsInput;
}

export interface PresignDownloadTarget {
  filename: string;
  mimeType: string;
  inline: boolean;
  cacheControl?: string;
  /** 覆盖默认有效期；PDF 预览需要跨整个阅读会话逐页拉取，时长由调用方决定。 */
  expirySeconds?: number;
}

export interface StorageFileDistribution {
  minio: { count: number; bytes: number };
  oss: { count: number; bytes: number };
  r2: { count: number; bytes: number };
}

const SETTINGS_CACHE_TTL_MS = 30_000;
export const PRESIGN_EXPIRY_SECONDS = 600;
/**
 * PDF 预览直传签名有效期：disableAutoFetch 下翻页会按需对同一签名 URL 发
 * Range 请求，有效期必须覆盖整个阅读会话，不能沿用 600s 的附件/图片短签。
 */
export const PDF_PREVIEW_PRESIGN_EXPIRY_SECONDS = 3600;
/** R2 内联图片签名是短期 bearer token，缩短权限撤销后的残余可访问窗口。 */
export const R2_INLINE_IMAGE_PRESIGN_EXPIRY_SECONDS = 120;
const PENDING_UPLOAD_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const PENDING_UPLOAD_CLEANUP_BATCH_SIZE = 100;
const BACKENDS: StorageBackendName[] = ["minio", "oss", "r2"];
const DOWNLOAD_MODES: StorageDownloadMode[] = ["proxy", "direct"];
const UPLOAD_MODES: StorageUploadMode[] = ["relay", "direct"];
// 比 PendingUpload 的 1 小时寿命更长，给定时清理留出取消 multipart 的窗口。
const MULTIPART_STATE_TTL_MS = 2 * 60 * 60 * 1000;

interface MultipartUploadState {
  uploadId: string;
  mode: StorageUploadMode;
  expiresAt: string;
}

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly deploymentTarget: DeploymentTarget;
  private minioClient: Client | null = null;
  private readonly minioBucket: string;
  private readonly minioEndpointDisplay: string;
  private minioBackend: MinioStorageBackend | null = null;
  private ossBackend: {
    fingerprint: string;
    backend: OssStorageBackend;
  } | null = null;
  private r2Backend: R2StorageBackend | null = null;
  private settingsCache: { at: number; value: StorageSettings | null } | null =
    null;
  private pendingUploadCleanupTimer: NodeJS.Timeout | null = null;
  private readonly localMultipartStates = new Map<
    string,
    MultipartUploadState
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secrets: AiSecretService,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.deploymentTarget = getDeploymentTarget(config);
    this.minioBucket = config.get<string>("MINIO_BUCKET", "liveboard-assets");
    const endpoint = config.get<string>("MINIO_ENDPOINT", "localhost");
    const port = config.get<number>("MINIO_PORT", 9000);
    this.minioEndpointDisplay = `${endpoint}:${port}`;
    // Vercel 下不读取 MinIO 凭据；R2 配置必须完整，缺失时启动失败并列出变量名。
    if (this.deploymentTarget === "vercel") {
      resolveR2ClientConfig(this.env());
    }
  }

  onModuleInit() {
    // Vercel 是 Serverless，禁止进程内 setInterval；过期上传清理改由每日
    // Cron、请求时惰性清理和 R2 Lifecycle 共同完成。
    if (this.deploymentTarget !== "vercel") {
      void this.cleanupExpiredPendingUploads().catch((caught: unknown) => {
        this.logger.warn(
          `清理过期 OSS 上传任务失败: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
      this.pendingUploadCleanupTimer = setInterval(() => {
        void this.cleanupExpiredPendingUploads().catch((caught: unknown) => {
          this.logger.warn(
            `清理过期 OSS 上传任务失败: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        });
      }, PENDING_UPLOAD_CLEANUP_INTERVAL_MS);
      this.pendingUploadCleanupTimer.unref();
    }
  }

  onModuleDestroy() {
    if (this.pendingUploadCleanupTimer) {
      clearInterval(this.pendingUploadCleanupTimer);
      this.pendingUploadCleanupTimer = null;
    }
  }

  /** 当前部署目标，供其他模块分支使用。 */
  get target(): DeploymentTarget {
    return this.deploymentTarget;
  }

  /**
   * R2 直传的临时对象统一放在 `pending/` 前缀下，由 R2 Lifecycle 一天后
   * 兜底删除；确认上传时服务端把对象复制到正式业务 Key 再删除临时对象。
   * MinIO/OSS 直入没有 Lifecycle，临时对象直接写在正式 Key 上。
   */
  objectKeyForPendingUpload(
    storageBackend: StorageBackendName,
    storageKey: string,
  ) {
    return storageBackend === "r2" ? `pending/${storageKey}` : storageKey;
  }

  /**
   * 清理 PendingUpload 时需要删除的全部对象 Key。R2 直传的临时对象在
   * `pending/` 下，确认后复制出来的正式业务对象在 storageKey 下，两者都要
   * 尽力删除（S3 对不存在 Key 的删除按成功处理，可安全重复）。
   */
  objectKeysToCleanForPendingUpload(
    storageBackend: StorageBackendName,
    storageKey: string,
  ) {
    return storageBackend === "r2"
      ? [`pending/${storageKey}`, storageKey]
      : [storageKey];
  }

  private multipartStateKey(
    storageBackend: StorageBackendName,
    objectKey: string,
  ) {
    return `liveboard:storage-multipart:${storageBackend}:${Buffer.from(
      objectKey,
    ).toString("base64url")}`;
  }

  private async rememberMultipartUpload(
    storageBackend: StorageBackendName,
    objectKey: string,
    state: MultipartUploadState,
  ) {
    const key = this.multipartStateKey(storageBackend, objectKey);
    this.localMultipartStates.set(key, state);
    const client = await this.redis?.getClient();
    if (client) {
      await client.set(key, JSON.stringify(state), {
        PX: MULTIPART_STATE_TTL_MS,
      });
    }
  }

  private async multipartState(
    storageBackend: StorageBackendName,
    objectKey: string,
  ): Promise<MultipartUploadState | null> {
    const key = this.multipartStateKey(storageBackend, objectKey);
    const local = this.localMultipartStates.get(key);
    if (local) {
      if (Date.parse(local.expiresAt) > Date.now()) return local;
      this.localMultipartStates.delete(key);
    }

    const client = await this.redis?.getClient();
    if (!client) return null;
    const raw = await client.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<MultipartUploadState>;
      if (
        typeof parsed.uploadId !== "string" ||
        (parsed.mode !== "relay" && parsed.mode !== "direct") ||
        typeof parsed.expiresAt !== "string" ||
        Date.parse(parsed.expiresAt) <= Date.now()
      ) {
        return null;
      }
      return parsed as MultipartUploadState;
    } catch {
      return null;
    }
  }

  private async forgetMultipartUpload(
    storageBackend: StorageBackendName,
    objectKey: string,
  ) {
    const key = this.multipartStateKey(storageBackend, objectKey);
    this.localMultipartStates.delete(key);
    await this.redis
      ?.getClient()
      .then((client) => client?.del(key))
      .catch(() => undefined);
  }

  private expectedMultipartPartSize(sizeBytes: number, partNumber: number) {
    const count = multipartPartCount(sizeBytes);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) {
      throw new BadRequestException("无效的上传分片编号");
    }
    return partNumber === count
      ? sizeBytes - MULTIPART_UPLOAD_PART_SIZE_BYTES * (count - 1)
      : MULTIPART_UPLOAD_PART_SIZE_BYTES;
  }

  private async multipartContext(
    pending: Pick<PendingUpload, "storageBackend" | "storageKey" | "sizeBytes">,
    partNumber: number,
    sizeBytes: number,
    expectedMode: StorageUploadMode,
  ) {
    if (!shouldUseMultipartUpload(pending.sizeBytes)) {
      throw new BadRequestException("该文件不需要分片上传");
    }
    const expectedSize = this.expectedMultipartPartSize(
      pending.sizeBytes,
      partNumber,
    );
    if (sizeBytes !== expectedSize) {
      throw new BadRequestException("上传分片大小不正确");
    }
    const storageBackend = pending.storageBackend as StorageBackendName;
    const objectKey = this.objectKeyForPendingUpload(
      storageBackend,
      pending.storageKey,
    );
    const state = await this.multipartState(storageBackend, objectKey);
    if (!state || state.mode !== expectedMode) {
      throw new NotFoundException("上传任务不存在或已过期");
    }
    return { storageBackend, objectKey, state, expectedSize };
  }

  /** 为浏览器直传 multipart 的单个分片生成短期 PUT 地址。 */
  async presignMultipartPartForPending(
    pending: Pick<PendingUpload, "storageBackend" | "storageKey" | "sizeBytes">,
    partNumber: number,
    sizeBytes: number,
  ) {
    const context = await this.multipartContext(
      pending,
      partNumber,
      sizeBytes,
      "direct",
    );
    const backend = await this.backendFor(context.storageBackend);
    const signed = await backend.presignMultipartPart(
      context.objectKey,
      context.state.uploadId,
      partNumber,
      PRESIGN_EXPIRY_SECONDS,
    );
    if (!signed) {
      throw new NotImplementedException("当前存储配置不支持浏览器分片直传");
    }
    return signed;
  }

  /** 接收服务器中转 multipart 的单个分片，返回即表示对象存储已写入。 */
  async uploadMultipartPartForPending(
    pending: Pick<PendingUpload, "storageBackend" | "storageKey" | "sizeBytes">,
    partNumber: number,
    data: Buffer,
  ) {
    const context = await this.multipartContext(
      pending,
      partNumber,
      data.length,
      "relay",
    );
    const backend = await this.backendFor(context.storageBackend);
    return backend.uploadMultipartPart(
      context.objectKey,
      context.state.uploadId,
      partNumber,
      data,
    );
  }

  /** PendingUpload 行尚未创建时的补偿，例如配额预检或建行失败。 */
  async discardMultipartUpload(
    storageBackend: StorageBackendName,
    objectKey: string,
  ) {
    const state = await this.multipartState(storageBackend, objectKey);
    if (!state) return true;
    const backend = await this.backendFor(storageBackend);
    await backend.abortMultipartUpload(objectKey, state.uploadId);
    await this.forgetMultipartUpload(storageBackend, objectKey);
    return true;
  }

  /**
   * 按行内 backend 清理对象后再删除 PendingUpload 行（R2 同时清理
   * `pending/` 临时 Key 与确认后复制的正式 Key）。任一对象删除失败时保留
   * 任务行供后续重试，避免制造不可追踪的孤立对象。
   */
  async discardPendingUpload(
    pending: PendingUpload,
    options: { onlyIfExpired?: boolean } = {},
  ) {
    const storageBackend = pending.storageBackend as StorageBackendName;
    const objectKey = this.objectKeyForPendingUpload(
      storageBackend,
      pending.storageKey,
    );
    const backend = await this.backendFor(storageBackend).catch(() => null);
    if (!backend) return false;
    const state = await this.multipartState(storageBackend, objectKey);
    if (state) {
      try {
        await backend.abortMultipartUpload(objectKey, state.uploadId);
        await this.forgetMultipartUpload(storageBackend, objectKey);
      } catch {
        // 不能确认 multipart 已取消时保留 PendingUpload，等待下一轮清理重试。
        return false;
      }
    }
    for (const key of this.objectKeysToCleanForPendingUpload(
      storageBackend,
      pending.storageKey,
    )) {
      const removed = await backend
        .removeObject(key)
        .then(() => true)
        .catch(() => false);
      if (!removed) return false;
    }
    const deleted = await this.prisma.pendingUpload.deleteMany({
      where: options.onlyIfExpired
        ? { id: pending.id, expiresAt: { lte: new Date() } }
        : { id: pending.id },
    });
    return deleted.count > 0;
  }

  /**
   * 直传确认：校验 PendingUpload 对应对象存在且大小精确匹配；R2 下把
   * `pending/` 临时对象复制到正式业务 Key 并删除临时对象。
   * 任何校验失败都会抛异常，调用方负责清理 PendingUpload。
   */
  async verifyAndFinalizePendingObject(pending: {
    storageBackend: StorageBackendName;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    const backend = await this.backendFor(pending.storageBackend);
    const objectKey = this.objectKeyForPendingUpload(
      pending.storageBackend,
      pending.storageKey,
    );
    const state = await this.multipartState(pending.storageBackend, objectKey);
    if (shouldUseMultipartUpload(pending.sizeBytes) && !state) {
      throw new BadRequestException("分片上传会话不存在,请重新上传");
    }
    if (state) {
      const parts = await backend.listMultipartParts(objectKey, state.uploadId);
      const expectedCount = multipartPartCount(pending.sizeBytes);
      const sortedParts = [...parts].sort(
        (left, right) => left.partNumber - right.partNumber,
      );
      const complete =
        sortedParts.length === expectedCount &&
        sortedParts.every((part, index) => {
          const partNumber = index + 1;
          return (
            part.partNumber === partNumber &&
            part.size ===
              this.expectedMultipartPartSize(pending.sizeBytes, partNumber) &&
            Boolean(part.etag)
          );
        });
      if (!complete) {
        throw new BadRequestException("分片上传不完整,请重新上传");
      }
      await backend.completeMultipartUpload(
        objectKey,
        state.uploadId,
        sortedParts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
        })),
      );
      await this.forgetMultipartUpload(pending.storageBackend, objectKey);
    }
    const stat = await backend.statObject(objectKey).catch(() => null);
    if (!stat) {
      throw new BadRequestException("对象存储中未找到已上传的文件,请重新上传");
    }
    if (stat.size !== pending.sizeBytes) {
      throw new BadRequestException("上传内容不完整,请重新上传");
    }
    if (pending.storageBackend === "r2") {
      await backend.copyObject(objectKey, pending.storageKey, pending.mimeType);
      await backend.removeObject(objectKey).catch(() => undefined);
    }
  }

  /**
   * 全局回收过期的直传任务。先删除对象、再删除任务行；对象删除失败
   * 时保留任务供下轮重试，避免把占用空间的对象变成不可追踪孤儿。
   */
  async cleanupExpiredPendingUploads() {
    const expired = await this.prisma.pendingUpload.findMany({
      where: { expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: "asc" },
      take: PENDING_UPLOAD_CLEANUP_BATCH_SIZE,
    });
    if (expired.length === 0) return 0;

    let cleaned = 0;
    for (const pending of expired) {
      // 先取消 multipart、再删除对象和任务行；任一步失败都保留任务供重试。
      if (await this.discardPendingUpload(pending, { onlyIfExpired: true })) {
        cleaned += 1;
      }
    }
    return cleaned;
  }

  /** 当前激活的上传后端。Vercel 固定为 R2，忽略数据库中的选择。 */
  async activeBackend(): Promise<ObjectStorageBackend> {
    if (this.deploymentTarget === "vercel") return this.backendFor("r2");
    const settings = await this.getSettings();
    return this.backendFor(settings?.backend ?? "minio");
  }

  /** 按对象自身记录的后端解析，保证切换后历史文件仍可读写。 */
  async backendFor(name: StorageBackendName): Promise<ObjectStorageBackend> {
    if (name === "minio") {
      if (this.deploymentTarget === "vercel") {
        throw new ServiceUnavailableException("Vercel 环境不使用 MinIO 存储");
      }
      this.minioBackend ??= new MinioStorageBackend(
        this.getMinioClient(),
        this.minioBucket,
      );
      return this.minioBackend;
    }
    if (name === "r2") {
      if (!this.r2Backend) {
        // Vercel 已在构造时校验；自托管环境按需从环境变量解析，缺 R2 配置时
        // 无法读取已经迁移到 R2 的对象。
        this.r2Backend = new R2StorageBackend(
          resolveR2ClientConfig(this.env()),
        );
      }
      return this.r2Backend;
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
    if (this.deploymentTarget === "vercel") return "direct";
    const settings = await this.getSettings();
    return settings?.downloadMode ?? "proxy";
  }

  /** 当前激活后端的上传模式。 */
  async activeUploadMode(): Promise<StorageUploadMode> {
    if (this.deploymentTarget === "vercel") return "direct";
    const settings = await this.getSettings();
    return settings?.uploadMode ?? "relay";
  }

  /**
   * 生成上传指令：小文件继续使用单请求，大文件统一创建 multipart 会话。
   * relay 模式的 multipart 分片由 API 接收，direct 模式返回每片预签名 PUT
   * 的会话描述；会话 ID 保存在 Redis（本地开发无 Redis 时使用进程内降级）。
   */
  async signUpload(
    storageBackend: StorageBackendName,
    key: string,
    options: { sizeBytes: number; mimeType: string },
    opts?: { expirySeconds?: number },
  ): Promise<ObjectUploadInstruction | null> {
    const configuredUploadMode = await this.activeUploadMode();
    const backend = await this.backendFor(storageBackend);
    // MinIO 只监听服务器内网，不能为浏览器签发可达的分片地址；兼容旧的
    // 错误配置时也要在签名阶段直接改走 API 中转，而不是上传第一片才失败。
    const uploadMode: StorageUploadMode =
      storageBackend === "minio" ? "relay" : configuredUploadMode;
    const multipart = shouldUseMultipartUpload(options.sizeBytes);
    if (multipart) {
      const objectUploadId = await backend.initiateMultipartUpload(
        key,
        options.mimeType,
      );
      const expiresAt = new Date(
        Date.now() + MULTIPART_STATE_TTL_MS,
      ).toISOString();
      try {
        await this.rememberMultipartUpload(storageBackend, key, {
          uploadId: objectUploadId,
          mode: uploadMode,
          expiresAt,
        });
      } catch (caught) {
        await backend
          .abortMultipartUpload(key, objectUploadId)
          .catch(() => undefined);
        await this.forgetMultipartUpload(storageBackend, key);
        throw caught;
      }
      return {
        transport: "multipart",
        mode: uploadMode,
        partSizeBytes: MULTIPART_UPLOAD_PART_SIZE_BYTES,
        partCount: multipartPartCount(options.sizeBytes),
        expiresAt,
      };
    }

    if (uploadMode !== "direct") return null;
    const expirySeconds =
      opts?.expirySeconds ??
      (storageBackend === "r2"
        ? R2_PRESIGN_PUT_TTL_SECONDS
        : PRESIGN_EXPIRY_SECONDS);
    const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
    if (storageBackend === "r2") {
      const put = await backend.presignPut(key, {
        expirySeconds,
        ...options,
      });
      if (!put) return null;
      return {
        transport: "put",
        url: put.url,
        headers: put.headers,
        expiresAt,
      };
    }
    const form = await backend.presignUpload(key, {
      expirySeconds,
      ...options,
    });
    if (!form) return null;
    return {
      transport: "form_post",
      url: form.url,
      fields: form.fields,
      expiresAt,
    };
  }

  /**
   * 直出模式下为对象生成预签名地址；中转模式或后端不支持时返回 null，
   * 调用方回退到服务器流式中转。Vercel 下经过文件头校验的 R2 位图可以在
   * API 权限校验后短期签名直出，避免图片字节经过 Vercel；PDF 预览同样在
   * direct 模式下签名直出，让浏览器直接拉对象存储做流式加载。其他 inline
   * 资源继续中转，尤其不能改变阿里云 OSS 默认域名的预览兼容策略。
   */
  async presignDownload(
    storageBackend: StorageBackendName,
    key: string,
    target: PresignDownloadTarget,
  ): Promise<string | null> {
    if ((await this.activeDownloadMode()) !== "direct") return null;
    const directInlineR2Image =
      target.inline &&
      this.deploymentTarget === "vercel" &&
      storageBackend === "r2" &&
      isSafeInlineImageMime(target.mimeType);
    // 与 getAssetPreviewKind 的判定一致：.pdf 文件可能以 application/octet-stream
    // 落库（未声明 MIME 的上传归一化结果），这些 PDF 预览也应能直传。
    const inlinePdf =
      target.inline &&
      (target.mimeType === "application/pdf" ||
        target.mimeType === "application/octet-stream");
    if (target.inline && !directInlineR2Image && !inlinePdf) return null;
    const backend = await this.backendFor(storageBackend);
    return backend.presignGet(key, {
      // 位图短签（120s）压缩权限撤销后的残余窗口；PDF 预览由调用方决定
      // 更长有效期，覆盖逐页拉取的一整个阅读会话。
      expirySeconds:
        target.expirySeconds ??
        (directInlineR2Image
          ? R2_INLINE_IMAGE_PRESIGN_EXPIRY_SECONDS
          : PRESIGN_EXPIRY_SECONDS),
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
    if (this.deploymentTarget === "vercel") {
      this.r2Backend ??= new R2StorageBackend(
        resolveR2ClientConfig(this.env()),
      );
      const [healthy, fileDistribution] = await Promise.all([
        this.r2Backend
          .healthCheck()
          .then(() => true)
          .catch(() => false),
        this.fileDistribution(),
      ]);
      return this.toPublicSettingsVercel(healthy, fileDistribution);
    }
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
    if (this.deploymentTarget === "vercel") {
      await this.requireSuperAdmin(userId);
      throw new ConflictException(
        "Vercel 环境的存储后端由环境变量固定为 Cloudflare R2，不能在此修改",
      );
    }
    const user = await this.requireSuperAdmin(userId);
    const backend = parseEnum(input.backend, BACKENDS, "存储后端");
    const downloadMode = parseEnum(
      input.downloadMode,
      DOWNLOAD_MODES,
      "下载模式",
    );
    const uploadMode = parseEnum(input.uploadMode, UPLOAD_MODES, "上传模式");
    const existing = await this.getSettings();
    const workspace = await this.getDefaultWorkspace();

    const nextBackend = backend ?? existing?.backend ?? "minio";
    const nextDownloadMode = downloadMode ?? existing?.downloadMode ?? "proxy";
    const nextUploadMode = uploadMode ?? existing?.uploadMode ?? "relay";
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
      uploadMode: nextUploadMode,
      ossRegion: mergedOss?.region ?? null,
      ossBucket: mergedOss?.bucket ?? null,
      ossEndpoint: mergedOss?.endpoint?.trim() || null,
      ossInternal: mergedOss?.internal ?? false,
      ossInternalEndpoint: mergedOss?.internalEndpoint?.trim() || null,
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
    if (this.deploymentTarget === "vercel") {
      await this.requireSuperAdmin(userId);
      throw new ConflictException(
        "Vercel 环境使用 R2，不支持测试阿里云 OSS 连接",
      );
    }
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
            internalEndpoint: existing.ossInternalEndpoint ?? undefined,
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
      internalEndpoint:
        input.internalEndpoint !== undefined
          ? input.internalEndpoint.trim() || undefined
          : (existing?.ossInternalEndpoint ?? undefined),
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
            internalEndpoint: settings.ossInternalEndpoint ?? undefined,
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
      internalEndpoint: source.internalEndpoint ?? null,
      accessKeyId: source.accessKeyId,
      accessKeySecret: this.secrets.decrypt(encryptedSecret),
    };
  }

  /** 统计课堂文件与文档附件分别落在各后端上的数量与体积。 */
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
      r2: { count: 0, bytes: 0 },
    };
    for (const row of [...classroomFiles, ...fileAssets]) {
      const key =
        row.storageBackend === "oss"
          ? "oss"
          : row.storageBackend === "r2"
            ? "r2"
            : "minio";
      distribution[key].count += row._count._all;
      distribution[key].bytes += row._sum.sizeBytes ?? 0;
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

  private toPublicSettingsVercel(
    healthy: boolean,
    fileDistribution: StorageFileDistribution,
  ) {
    const config = resolveR2ClientConfig(this.env());
    return {
      backend: "r2",
      source: "environment",
      editable: false,
      bucket: config.bucket,
      activeBackendHealthy: healthy,
      uploadMode: "direct",
      downloadMode: "direct",
      fileDistribution,
      updatedAt: null,
    };
  }

  private toPublicSettings(
    settings: StorageSettings | null,
    activeBackendHealthy: boolean,
    fileDistribution: StorageFileDistribution,
  ) {
    return {
      backend: settings?.backend ?? "minio",
      downloadMode: settings?.downloadMode ?? "proxy",
      uploadMode: settings?.uploadMode ?? "relay",
      minio: {
        endpoint: this.minioEndpointDisplay,
        bucket: this.minioBucket,
      },
      oss: {
        region: settings?.ossRegion ?? null,
        bucket: settings?.ossBucket ?? null,
        endpoint: settings?.ossEndpoint ?? null,
        internal: settings?.ossInternal ?? false,
        internalEndpoint: settings?.ossInternalEndpoint ?? null,
        accessKeyId: settings?.ossAccessKeyId ?? null,
        secretConfigured: Boolean(settings?.ossAccessKeySecret),
      },
      activeBackendHealthy,
      fileDistribution,
      updatedAt: settings?.updatedAt.toISOString() ?? null,
    };
  }

  private getMinioClient() {
    if (this.minioClient) return this.minioClient;
    const endpoint = this.config.get<string>("MINIO_ENDPOINT", "localhost");
    const port = this.config.get<number>("MINIO_PORT", 9000);
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
    this.minioClient = new Client({
      endPoint: endpoint,
      port,
      useSSL: this.config.get<string>("MINIO_USE_SSL", "false") === "true",
      accessKey,
      secretKey,
      partSize: ATOMIC_UPLOAD_PART_SIZE_BYTES,
    });
    return this.minioClient;
  }

  private env() {
    return {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
      R2_BUCKET: process.env.R2_BUCKET,
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
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
