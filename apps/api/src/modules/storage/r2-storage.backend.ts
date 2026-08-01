import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
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
}

export const R2_PRESIGN_PUT_TTL_SECONDS = 60;

const R2_REQUIRED_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

export function r2Endpoint(accountId: string) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** 返回缺失的 R2 环境变量名；全部存在时返回空数组。 */
export function missingR2EnvVars(
  config: Record<string, string | undefined>,
): string[] {
  return R2_REQUIRED_ENV_VARS.filter((name) => !config[name]?.trim());
}

export function resolveR2ClientConfig(
  config: Record<string, string | undefined>,
): R2ClientConfig {
  const missing = missingR2EnvVars(config);
  if (missing.length > 0) {
    throw new Error(`Vercel 环境缺少以下 R2 环境变量: ${missing.join(", ")}`);
  }
  return {
    accountId: config.R2_ACCOUNT_ID!.trim(),
    bucket: config.R2_BUCKET!.trim(),
    accessKeyId: config.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: config.R2_SECRET_ACCESS_KEY!.trim(),
  };
}

function buildClient(config: R2ClientConfig) {
  return new S3Client({
    region: "auto",
    endpoint: r2Endpoint(config.accountId),
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
 * - Endpoint 固定由 `R2_ACCOUNT_ID` 推导，不允许管理员填写任意 Endpoint。
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

  async putObject(key: string, data: Buffer | Readable, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
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
