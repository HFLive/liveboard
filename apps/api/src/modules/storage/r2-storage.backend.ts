import {
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type {
  ObjectStorageBackend,
  PresignDownloadOptions,
  PresignedUpload,
} from "./storage-backend";

export interface R2ClientConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * 可选 Endpoint 覆盖。缺省按 accountId 推导 Cloudflare 端点。
   * 仅用于 R2 兼容的 S3 网关（如本地 MinIO 做联调、内部网关）。
   */
  endpoint?: string;
}

export const R2_PRESIGN_PUT_TTL_SECONDS = 60;

/** 变量后缀（不含前缀）。前缀为 `R2_`（应用自身）或 `SOURCE_R2_`/`TARGET_R2_`（迁移）。 */
const R2_REQUIRED_SUFFIXES = [
  "ACCOUNT_ID",
  "BUCKET",
  "ACCESS_KEY_ID",
  "SECRET_ACCESS_KEY",
] as const;

export function r2Endpoint(accountId: string) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** 返回缺失的 R2 环境变量名；全部存在时返回空数组。 */
export function missingR2EnvVars(
  config: Record<string, string | undefined>,
  prefix = "R2",
): string[] {
  return R2_REQUIRED_SUFFIXES.map((suffix) => `${prefix}_${suffix}`).filter(
    (name) => !config[name]?.trim(),
  );
}

export function resolveR2ClientConfig(
  config: Record<string, string | undefined>,
  prefix = "R2",
): R2ClientConfig {
  const missing = missingR2EnvVars(config, prefix);
  if (missing.length > 0) {
    throw new Error(`缺少 R2 环境变量（${prefix}）: ${missing.join(", ")}`);
  }
  const endpoint = config[`${prefix}_ENDPOINT`]?.trim();
  return {
    accountId: config[`${prefix}_ACCOUNT_ID`]!.trim(),
    bucket: config[`${prefix}_BUCKET`]!.trim(),
    accessKeyId: config[`${prefix}_ACCESS_KEY_ID`]!.trim(),
    secretAccessKey: config[`${prefix}_SECRET_ACCESS_KEY`]!.trim(),
    ...(endpoint ? { endpoint } : {}),
  };
}

function buildClient(config: R2ClientConfig) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint ?? r2Endpoint(config.accountId),
    // 自定义 endpoint（MinIO 等 S3 兼容网关）时用 path-style 寻址；
    // 真实 Cloudflare R2 保持默认虚拟主机式。
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestHandler: {
      // 大对象直传/下载需要足够长的连接超时，避免长流被前端代理中断。
      connectTimeout: 5_000,
      socketTimeout: 5 * 60 * 1_000,
    } as never,
  });
}

/**
 * Cloudflare R2（S3 兼容端点）后端。
 *
 * - Endpoint 由 `R2_ACCOUNT_ID` 推导；设置 `R2_ENDPOINT`（或 `SOURCE_R2_`/`TARGET_R2_`
 *   前缀版）可覆盖为 R2 兼容网关（迁移/联调场景）。应用自身的存储配置仍由
 *   `R2_ACCOUNT_ID` 推导，不对外开放填写。
 * - Bucket 保持私有，不配置 ACL 或 public-read。
 * - 直传使用 60 秒有效的预签名 PUT，签入 Content-Type。
 * - 上传/下载都通过 AWS SDK 的 Node Readable 流式传递，不整块读入内存。
 */
export class R2StorageBackend implements ObjectStorageBackend {
  readonly name = "r2" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(readonly config: R2ClientConfig) {
    this.bucket = config.bucket;
    this.client = buildClient(config);
  }

  async putObject(
    key: string,
    data: Buffer | Readable,
    mimeType: string,
    contentLength?: number,
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
        // 流式上传必须显式给 Content-Length，否则 SDK 走 aws-chunked 且
        // MinIO 等 S3 兼容网关会因 decoded length 为 undefined 拒绝。
        ...(contentLength !== undefined
          ? { ContentLength: contentLength }
          : {}),
      }),
    );
  }

  async getObject(key: string) {
    const output: GetObjectCommandOutput = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!output.Body) {
      throw new Error(`R2 对象不存在: ${key}`);
    }
    return output.Body as Readable;
  }

  async removeObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async copyObject(fromKey: string, toKey: string, mimeType: string) {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: toKey,
        CopySource: `/${this.bucket}/${encodeURIComponent(fromKey)}`,
        ContentType: mimeType,
      }),
    );
  }

  async presignGet(key: string, options: PresignDownloadOptions) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.responseContentDisposition
          ? {
              ResponseContentDisposition: options.responseContentDisposition,
            }
          : {}),
        ...(options.responseCacheControl
          ? { ResponseCacheControl: options.responseCacheControl }
          : {}),
      }),
      { expiresIn: options.expirySeconds },
    );
  }

  presignUpload(
    _key: string,
    _options: {
      expirySeconds: number;
      sizeBytes: number;
      mimeType: string;
    },
  ): Promise<PresignedUpload | null> {
    return Promise.resolve(null);
  }

  async presignPut(
    key: string,
    options: {
      expirySeconds: number;
      sizeBytes: number;
      mimeType: string;
    },
  ) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: options.mimeType,
      }),
      { expiresIn: options.expirySeconds },
    );
    return {
      url,
      headers: { "Content-Type": options.mimeType },
    };
  }

  async initiateMultipartUpload(key: string, mimeType: string) {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
      }),
    );
    if (!result.UploadId) {
      throw new Error("R2 未返回 multipart upload ID");
    }
    return result.UploadId;
  }

  async uploadMultipartPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ) {
    const result = await this.client.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: data,
        ContentLength: data.length,
      }),
    );
    if (!result.ETag) {
      throw new Error("R2 未返回 multipart 分片 ETag");
    }
    return { etag: result.ETag };
  }

  async listMultipartParts(key: string, uploadId: string) {
    const parts: Array<{
      partNumber: number;
      etag: string;
      size: number;
    }> = [];
    let marker: string | undefined;
    do {
      const result = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          ...(marker === undefined ? {} : { PartNumberMarker: marker }),
        }),
      );
      for (const part of result.Parts ?? []) {
        if (part.PartNumber === undefined || !part.ETag) continue;
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          size: part.Size ?? 0,
        });
      }
      marker = result.IsTruncated
        ? (result.NextPartNumberMarker ?? undefined)
        : undefined;
    } while (marker !== undefined);
    return parts;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async presignMultipartPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expirySeconds: number,
  ) {
    const url = await getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: expirySeconds },
    );
    return { url, headers: {} };
  }

  async statObject(key: string) {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { size: head.ContentLength ?? 0 };
  }

  async healthCheck() {
    // Bucket-scoped token 不能列全部 bucket，用 HeadBucket 精确探测目标 Bucket。
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
