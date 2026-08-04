import { Client } from "minio";
import type { Readable } from "node:stream";
import type {
  ObjectStorageBackend,
  PresignDownloadOptions,
  PresignedPutUpload,
} from "./storage-backend";

type MinioMultipartClient = Client & {
  initiateNewMultipartUpload(
    bucketName: string,
    objectName: string,
    headers: Record<string, string>,
  ): Promise<string>;
  uploadPart(
    config: {
      bucketName: string;
      objectName: string;
      uploadID: string;
      partNumber: number;
      headers: Record<string, string | number>;
    },
    payload: Buffer,
  ): Promise<{ etag: string }>;
  listParts(
    bucketName: string,
    objectName: string,
    uploadId: string,
  ): Promise<Array<{ part: number; etag: string; size: number }>>;
  completeMultipartUpload(
    bucketName: string,
    objectName: string,
    uploadId: string,
    etags: Array<{ part: number; etag: string }>,
  ): Promise<unknown>;
  abortMultipartUpload(
    bucketName: string,
    objectName: string,
    uploadId: string,
  ): Promise<void>;
  presignedUrl(
    method: string,
    bucketName: string,
    objectName: string,
    expires: number,
    reqParams: Record<string, string>,
  ): Promise<string>;
};

/**
 * 服务器本地 MinIO 存储。生产部署中 MinIO 只监听容器内网，
 * 预签名地址浏览器不可达，因此不支持签名直出。
 */
export class MinioStorageBackend implements ObjectStorageBackend {
  readonly name = "minio" as const;

  constructor(
    private readonly client: Client,
    private readonly bucket: string,
  ) {}

  async putObject(
    key: string,
    data: Buffer | Readable,
    mimeType: string,
    contentLength?: number,
  ) {
    await this.ensureBucket();
    await this.client.putObject(
      this.bucket,
      key,
      data,
      Buffer.isBuffer(data) ? data.length : (contentLength ?? undefined),
      { "Content-Type": mimeType },
    );
  }

  async getObject(key: string) {
    return (await this.client.getObject(this.bucket, key)) as Readable;
  }

  async removeObject(key: string) {
    await this.client.removeObject(this.bucket, key);
  }

  async copyObject(fromKey: string, toKey: string, _mimeType: string) {
    await this.client.copyObject(
      this.bucket,
      toKey,
      `/${this.bucket}/${fromKey}`,
    );
  }

  presignGet(_key: string, _options: PresignDownloadOptions) {
    return Promise.resolve(null);
  }

  presignUpload(
    _key: string,
    _options: {
      expirySeconds: number;
      sizeBytes: number;
      mimeType: string;
    },
  ) {
    return Promise.resolve(null);
  }

  presignPut(
    _key: string,
    _options: {
      expirySeconds: number;
      sizeBytes: number;
      mimeType: string;
    },
  ) {
    return Promise.resolve(null);
  }

  async initiateMultipartUpload(key: string, mimeType: string) {
    await this.ensureBucket();
    return (this.client as MinioMultipartClient).initiateNewMultipartUpload(
      this.bucket,
      key,
      { "Content-Type": mimeType },
    );
  }

  async uploadMultipartPart(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ) {
    const result = await (this.client as MinioMultipartClient).uploadPart(
      {
        bucketName: this.bucket,
        objectName: key,
        uploadID: uploadId,
        partNumber,
        headers: { "Content-Length": data.length },
      },
      data,
    );
    return { etag: result.etag };
  }

  async listMultipartParts(key: string, uploadId: string) {
    const parts = await (this.client as MinioMultipartClient).listParts(
      this.bucket,
      key,
      uploadId,
    );
    return parts.map((part) => ({
      partNumber: part.part,
      etag: part.etag,
      size: part.size,
    }));
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ) {
    await (this.client as MinioMultipartClient).completeMultipartUpload(
      this.bucket,
      key,
      uploadId,
      parts.map((part) => ({ part: part.partNumber, etag: part.etag })),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    await (this.client as MinioMultipartClient).abortMultipartUpload(
      this.bucket,
      key,
      uploadId,
    );
  }

  async presignMultipartPart(
    _key: string,
    _uploadId: string,
    _partNumber: number,
    _expirySeconds: number,
  ): Promise<PresignedPutUpload | null> {
    return null;
  }

  async statObject(key: string) {
    const stat = await this.client.statObject(this.bucket, key);
    return { size: stat.size };
  }

  async healthCheck() {
    await this.client.listBuckets();
  }

  private async ensureBucket() {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
  }
}
