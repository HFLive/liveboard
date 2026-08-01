import type { Readable } from "node:stream";

export type StorageBackendName = "minio" | "oss" | "r2";
export type StorageDownloadMode = "proxy" | "direct";
export type StorageUploadMode = "relay" | "direct";

/**
 * LiveBoard 当前最大上传为 100MB。把 SDK 分片阈值设得更高，
 * 让所有受支持上传使用原子单次 PUT，避免进程中断留下未完成分片。
 */
export const ATOMIC_UPLOAD_PART_SIZE_BYTES = 128 * 1024 * 1024;

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
 * 上传指令判别联合：前端根据 `transport` 字段决定走 Form POST 还是
 * 原始 PUT，禁止通过是否存在 `fields` 猜测协议。
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
    };

export interface ObjectStorageBackend {
  readonly name: StorageBackendName;
  putObject(
    key: string,
    data: Buffer | Readable,
    mimeType: string,
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
  /** 读取对象元信息，用于直入上传后的存在性与大小校验。 */
  statObject(key: string): Promise<{ size: number }>;
  healthCheck(): Promise<void>;
}
