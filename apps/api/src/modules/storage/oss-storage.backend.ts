import { Client } from "minio";
import type { Readable } from "node:stream";
import type {
  ObjectStorageBackend,
  PresignDownloadOptions,
} from "./storage-backend";
import { ATOMIC_UPLOAD_PART_SIZE_BYTES } from "./storage-backend";

export interface OssClientConfig {
  region: string;
  bucket: string;
  endpoint?: string | null;
  internal: boolean;
  accessKeyId: string;
  accessKeySecret: string;
}

/**
 * 阿里云 OSS，通过其 S3 兼容端点访问。
 * 只在保存配置时做一次写探测，不自动创建 Bucket（OSS Bucket 需在控制台创建）。
 */
export class OssStorageBackend implements ObjectStorageBackend {
  readonly name = "oss" as const;
  private readonly client: Client;
  private readonly bucket: string;

  constructor(config: OssClientConfig) {
    const { endPoint, port, useSSL } = resolveOssEndpoint(config);
    this.bucket = config.bucket;
    this.client = new Client({
      endPoint,
      port,
      useSSL,
      accessKey: config.accessKeyId,
      secretKey: config.accessKeySecret,
      region: config.region,
      pathStyle: false,
      partSize: ATOMIC_UPLOAD_PART_SIZE_BYTES,
    });
  }

  async putObject(key: string, data: Buffer, mimeType: string) {
    await this.client.putObject(this.bucket, key, data, data.length, {
      "Content-Type": mimeType,
    });
  }

  async getObject(key: string) {
    return (await this.client.getObject(this.bucket, key)) as Readable;
  }

  async removeObject(key: string) {
    await this.client.removeObject(this.bucket, key);
  }

  presignGet(key: string, options: PresignDownloadOptions) {
    const respHeaders: Record<string, string> = {};
    if (options.responseContentDisposition) {
      respHeaders["response-content-disposition"] =
        options.responseContentDisposition;
    }
    if (options.responseCacheControl) {
      respHeaders["response-cache-control"] = options.responseCacheControl;
    }
    return this.client.presignedGetObject(
      this.bucket,
      key,
      options.expirySeconds,
      respHeaders,
    );
  }

  async healthCheck() {
    await this.client.getBucketRegionAsync(this.bucket);
  }
}

function resolveOssEndpoint(config: OssClientConfig) {
  const fallback = `s3.oss-${config.region}${
    config.internal ? "-internal" : ""
  }.aliyuncs.com`;
  const raw = config.endpoint?.trim() || fallback;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("无效的 OSS Endpoint");
  }
  const useSSL = url.protocol !== "http:";
  return {
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : useSSL ? 443 : 80,
    useSSL,
  };
}
