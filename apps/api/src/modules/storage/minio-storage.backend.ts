import { Client } from "minio";
import type { Readable } from "node:stream";
import type {
  ObjectStorageBackend,
  PresignDownloadOptions,
} from "./storage-backend";

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

  async putObject(key: string, data: Buffer, mimeType: string) {
    await this.ensureBucket();
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

  presignGet(_key: string, _options: PresignDownloadOptions) {
    return Promise.resolve(null);
  }

  presignPut(_key: string, _options: { expirySeconds: number }) {
    return Promise.resolve(null);
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
