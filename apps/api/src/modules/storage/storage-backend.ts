import type { Readable } from "node:stream";

export type StorageBackendName = "minio" | "oss" | "r2";
export type StorageDownloadMode = "proxy" | "direct";
export type StorageUploadMode = "relay" | "direct";

const SAFE_INLINE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** 只有经过文件头校验的这些位图格式允许浏览器内联渲染。 */
export function isSafeInlineImageMime(mimeType: string) {
  return SAFE_INLINE_IMAGE_MIME_TYPES.has(mimeType);
}

/** SDK 单次 putObject 的历史阈值，迁移脚本仍使用它控制内存/分片行为。 */
export const ATOMIC_UPLOAD_PART_SIZE_BYTES = 128 * 1024 * 1024;

/** 浏览器与对象存储 multipart 会话共用的分片大小。S3 要求非末片至少 5MiB。 */
export const MULTIPART_UPLOAD_PART_SIZE_BYTES = 8 * 1024 * 1024;

/** 小文件继续使用单请求，避免为几 KB 的上传创建 multipart 会话。 */
export const MULTIPART_UPLOAD_THRESHOLD_BYTES =
  MULTIPART_UPLOAD_PART_SIZE_BYTES;

export function shouldUseMultipartUpload(sizeBytes: number) {
  return sizeBytes > MULTIPART_UPLOAD_THRESHOLD_BYTES;
}

export function multipartPartCount(sizeBytes: number) {
  return Math.ceil(sizeBytes / MULTIPART_UPLOAD_PART_SIZE_BYTES);
}

export interface PresignDownloadOptions {
  expirySeconds: number;
  responseContentDisposition?: string;
  responseCacheControl?: string;
}

/** OSS 表单直入（HTML Form POST Policy）凭据。 */
export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}

/** R2 预签名 PUT 凭据：浏览器直接 `PUT` 原始文件。 */
export interface PresignedPutUpload {
  url: string;
  headers: Record<string, string>;
}

/**
 * 上传指令判别联合：前端根据 `transport` 字段决定走 Form POST、原始 PUT
 * 还是 multipart，禁止通过是否存在 `fields` 猜测协议。
 */
export type ObjectUploadInstruction =
  | {
      transport: "form_post";
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    }
  | {
      transport: "put";
      url: string;
      headers: Record<string, string>;
      expiresAt: string;
    }
  | {
      transport: "multipart";
      mode: StorageUploadMode;
      partSizeBytes: number;
      partCount: number;
      expiresAt: string;
    };

export interface ObjectStorageBackend {
  readonly name: StorageBackendName;
  putObject(
    key: string,
    data: Buffer | Readable,
    mimeType: string,
    /** 流式上传时已知的字节数；R2(S3) 流上传需显式 Content-Length。 */
    contentLength?: number,
  ): Promise<void>;
  getObject(key: string): Promise<Readable>;
  removeObject(key: string): Promise<void>;
  /**
   * 服务端复制对象（R2 直传确认时把 `pending/` 临时对象复制到正式业务 Key）。
   * 复制完成后调用方负责删除源对象。
   */
  copyObject(fromKey: string, toKey: string, mimeType: string): Promise<void>;
  /**
   * 生成浏览器可直接访问的预签名下载地址。
   * 返回 null 表示该后端不支持签名直出（例如只监听内网的 MinIO），
   * 调用方应回退到服务器中转模式。
   */
  presignGet(
    key: string,
    options: PresignDownloadOptions,
  ): Promise<string | null>;
  /**
   * 生成带大小与 MIME 约束的浏览器表单直传凭据。
   * 返回 null 表示该后端不支持签名直入（例如只监听内网的 MinIO），
   * 调用方应回退到服务器中转上传。
   */
  presignUpload(
    key: string,
    options: {
      expirySeconds: number;
      sizeBytes: number;
      mimeType: string;
    },
  ): Promise<PresignedUpload | null>;
  /**
   * 生成浏览器直接 PUT 的预签名凭据（Cloudflare R2 使用）。
   * 返回 null 表示该后端不支持 PUT 直传。
   */
  presignPut(
    key: string,
    options: {
      expirySeconds: number;
      sizeBytes: number;
      mimeType: string;
    },
  ): Promise<PresignedPutUpload | null>;
  /** 创建一个由浏览器分片、服务端确认完成的对象存储 multipart 会话。 */
  initiateMultipartUpload(key: string, mimeType: string): Promise<string>;
  /** 上传一个已校验大小的 multipart 分片。 */
  uploadMultipartPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<{ etag: string }>;
  /** 列出已写入的分片，确认时由服务端校验完整性。 */
  listMultipartParts(
    key: string,
    uploadId: string,
  ): Promise<Array<{ partNumber: number; etag: string; size: number }>>;
  /** 完成 multipart 对象。 */
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void>;
  /** 取消 multipart 会话并释放未完成分片。 */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** 为浏览器直传的单个分片生成预签名 PUT。 */
  presignMultipartPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expirySeconds: number,
  ): Promise<PresignedPutUpload | null>;
  /** 读取对象元信息，用于直入上传后的存在性与大小校验。 */
  statObject(key: string): Promise<{ size: number }>;
  healthCheck(): Promise<void>;
}
