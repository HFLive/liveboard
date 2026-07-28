import type { Readable } from "node:stream";

export type StorageBackendName = "minio" | "oss";
export type StorageDownloadMode = "proxy" | "direct";

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

export interface ObjectStorageBackend {
  readonly name: StorageBackendName;
  putObject(key: string, data: Buffer, mimeType: string): Promise<void>;
  getObject(key: string): Promise<Readable>;
  removeObject(key: string): Promise<void>;
  /**
   * 生成浏览器可直接访问的预签名下载地址。
   * 返回 null 表示该后端不支持签名直出（例如只监听内网的 MinIO），
   * 调用方应回退到服务器中转模式。
   */
  presignGet(
    key: string,
    options: PresignDownloadOptions,
  ): Promise<string | null>;
  healthCheck(): Promise<void>;
}
