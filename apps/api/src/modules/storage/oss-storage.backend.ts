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
  /** 公网 Endpoint(自定义域名或默认公网域名),预签名地址也用它 */
  endpoint?: string | null;
  /** 启用后服务器侧读写走内网 Endpoint */
  internal: boolean;
  /** 自定义内网 Endpoint;留空用阿里云默认内网域名 */
  internalEndpoint?: string | null;
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
  private readonly presignClient: Client;
  private readonly bucket: string;

  constructor(config: OssClientConfig) {
    this.bucket = config.bucket;
    // 服务器侧数据客户端:启用内网时走内网 Endpoint(自定义或默认),
    // 中转上传/中转下载/预览/statObject/removeObject 全部受益。
    this.client = createOssClient(
      config,
      config.internal
        ? config.internalEndpoint?.trim() ||
            `s3.oss-${config.region}-internal.aliyuncs.com`
        : undefined,
    );
    // 预签名地址要给公网浏览器使用(签名直出下载、签名直入上传),
    // 内网配置下签名单独走公网 Endpoint(与内网指向同一个 Bucket)。
    this.presignClient = config.internal
      ? createOssClient(publicOssConfig(config))
      : this.client;
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
    return this.presignClient.presignedGetObject(
      this.bucket,
      key,
      options.expirySeconds,
      respHeaders,
    );
  }

  presignPut(key: string, options: { expirySeconds: number }) {
    return this.presignClient.presignedPutObject(
      this.bucket,
      key,
      options.expirySeconds,
    );
  }

  async statObject(key: string) {
    const stat = await this.client.statObject(this.bucket, key);
    return { size: stat.size };
  }

  async healthCheck() {
    await this.client.getBucketRegionAsync(this.bucket);
  }
}

function createOssClient(config: OssClientConfig, endpointOverride?: string) {
  const { endPoint, port, useSSL } = resolveOssEndpoint(
    config,
    endpointOverride,
  );
  return new Client({
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

/** 内网配置的公网变体：清掉 internal 标记，并还原自定义内网域名。 */
function publicOssConfig(config: OssClientConfig): OssClientConfig {
  return {
    ...config,
    internal: false,
    endpoint:
      config.endpoint?.replace("-internal.aliyuncs.com", ".aliyuncs.com") ??
      config.endpoint,
  };
}

function resolveOssEndpoint(config: OssClientConfig, override?: string) {
  const fallback = `s3.oss-${config.region}${
    config.internal ? "-internal" : ""
  }.aliyuncs.com`;
  const raw = override ?? (config.endpoint?.trim() || fallback);
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
