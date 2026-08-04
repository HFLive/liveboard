import type { PrismaClient } from "@prisma/client";
import { Client as MinioClient } from "minio";
import { AiSecretService } from "../src/modules/ai/ai-secret.service";
import { MinioStorageBackend } from "../src/modules/storage/minio-storage.backend";
import {
  OssStorageBackend,
  type OssClientConfig,
} from "../src/modules/storage/oss-storage.backend";
import {
  R2StorageBackend,
  resolveR2ClientConfig,
} from "../src/modules/storage/r2-storage.backend";
import type {
  ObjectStorageBackend,
  StorageBackendName,
} from "../src/modules/storage/storage-backend";
import { ATOMIC_UPLOAD_PART_SIZE_BYTES } from "../src/modules/storage/storage-backend";

/**
 * 迁移脚本的存储后端构造。与既有 migrate-storage-to-r2.ts 一致，但各后端
 * 均可选：导出端只需要"被引用对象所在后端"可达；导入端只需要"目标激活后端"。
 */

export interface SourceBackends {
  minio: MinioStorageBackend | null;
  oss: OssStorageBackend | null;
  r2: R2StorageBackend | null;
}

/** StorageSettings 的 OSS 字段子集（导入前从目标库捕获，凭据为加密值原样）。 */
export interface OssSettingsFields {
  ossRegion: string | null;
  ossBucket: string | null;
  ossEndpoint: string | null;
  ossInternal: boolean;
  ossInternalEndpoint: string | null;
  ossAccessKeyId: string | null;
  ossAccessKeySecret: string | null;
}

function minioBackend(): MinioStorageBackend {
  const bucket = process.env.MINIO_BUCKET ?? "liveboard-assets";
  const client = new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: (process.env.MINIO_USE_SSL ?? "false") === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "liveboard",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "",
    partSize: ATOMIC_UPLOAD_PART_SIZE_BYTES,
  });
  return new MinioStorageBackend(client, bucket);
}

/** 读取指定前缀的 R2 配置（如 `SOURCE_R2_`/`TARGET_R2_`）；缺省前缀 `R2_`。 */
function r2Backend(prefix = "R2"): R2StorageBackend | null {
  try {
    return new R2StorageBackend(resolveR2ClientConfig(process.env, prefix));
  } catch {
    return null;
  }
}

const R2_SUFFIXES = ["ACCOUNT_ID", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"];

/**
 * 某前缀的 R2 变量是否完整配置。
 * - 全部齐全 → true（用该前缀）；
 * - 一个都没有 → false（回退应用自身 `R2_*`）；
 * - 部分齐全 → throw（静默回退会让源==目标导致"假成功"导入，必须显式报错）。
 */
function assertR2PrefixComplete(prefix: string): boolean {
  const anyPresent = R2_SUFFIXES.some(
    (suffix) => process.env[`${prefix}_${suffix}`]?.trim(),
  );
  if (!anyPresent) return false;
  const missing = R2_SUFFIXES.filter(
    (suffix) => !process.env[`${prefix}_${suffix}`]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `R2 配置（${prefix}_*）不完整，缺少 ${missing.map((s) => `${prefix}_${s}`).join(", ")}`,
    );
  }
  return true;
}

/**
 * 迁移的源 R2：`SOURCE_R2_*` 优先（管理员电脑/目标服务器从源 R2 直拉时），
 * 回退应用自身 `R2_*`（Vercel 部署内导出时）。
 */
export function sourceR2Backend(): R2StorageBackend | null {
  return r2Backend(assertR2PrefixComplete("SOURCE_R2") ? "SOURCE_R2" : "R2");
}

/**
 * 迁移的目标 R2：`TARGET_R2_*` 优先（源服务器直推/管理员电脑直写时），
 * 回退应用自身 `R2_*`。
 */
export function targetR2Backend(): R2StorageBackend | null {
  return r2Backend(assertR2PrefixComplete("TARGET_R2") ? "TARGET_R2" : "R2");
}

export function ossFromSettings(
  settings: OssSettingsFields | null,
): OssStorageBackend | null {
  if (
    !settings ||
    !settings.ossRegion ||
    !settings.ossBucket ||
    !settings.ossAccessKeyId ||
    !settings.ossAccessKeySecret
  ) {
    return null;
  }
  const secrets = new AiSecretService({
    get: (key: string) => process.env[key],
  } as never);
  const config: OssClientConfig = {
    region: settings.ossRegion,
    bucket: settings.ossBucket,
    endpoint: settings.ossEndpoint ?? null,
    internal: settings.ossInternal,
    internalEndpoint: settings.ossInternalEndpoint ?? null,
    accessKeyId: settings.ossAccessKeyId,
    accessKeySecret: secrets.decrypt(settings.ossAccessKeySecret),
  };
  return new OssStorageBackend(config);
}

/** 导出端：构造全部可能的源后端。 */
export async function createSourceBackends(
  prisma: PrismaClient,
): Promise<SourceBackends> {
  const storage = await prisma.storageSettings.findFirst();
  return {
    minio: minioBackend(),
    oss: storage ? ossFromSettings(storage) : null,
    r2: sourceR2Backend(),
  };
}

/**
 * 导入端：目标激活后端。
 *
 * 导入会把目标库整体替换成源数据，`StorageSettings.backend` 也会变成源端的值，
 * 因此目标后端必须由调用方显式指定（导入前从目标端读取），不能依赖还原后的 DB。
 * `explicitBackend` 缺省时才回退读取 DB（供独立校验脚本使用）。
 *
 * OSS 目标：凭据存在会被清空的目标数据库中，必须在 DROP 前捕获并经
 * `preservedOss` 传入（`migrate-import` 主流程在清库前捕获）；缺省时回退读 DB
 * （还原后已由 wipeSecrets 把目标自身 OSS 配置写回，独立校验脚本可用）。
 */
export async function createTargetActiveBackend(
  prisma: PrismaClient,
  explicitBackend?: StorageBackendName,
  preservedOss: OssSettingsFields | null = null,
): Promise<{ backend: ObjectStorageBackend; name: StorageBackendName }> {
  if (explicitBackend) {
    const name: StorageBackendName = explicitBackend;
    if (name === "r2") {
      const r2 = targetR2Backend();
      if (!r2) throw new Error("目标后端为 R2，但缺少 R2 环境变量配置");
      return { backend: r2, name };
    }
    if (name === "oss") {
      const storage =
        preservedOss ??
        (await prisma.storageSettings.findFirst().catch(() => null));
      const oss = ossFromSettings(storage);
      if (!oss) {
        throw new Error(
          "目标后端为 OSS，但缺少 OSS 凭据配置（请在目标部署的管理端配置 OSS 存储后重试）",
        );
      }
      return { backend: oss, name };
    }
    return { backend: minioBackend(), name };
  }

  const storage = await prisma.storageSettings.findFirst();
  const name: StorageBackendName = storage?.backend ?? "minio";

  if (name === "r2") {
    const r2 = targetR2Backend();
    if (!r2) throw new Error("目标后端为 R2，但缺少 R2 环境变量配置");
    return { backend: r2, name };
  }
  if (name === "oss") {
    const oss = storage ? ossFromSettings(storage) : null;
    if (!oss) throw new Error("目标后端为 OSS，但 OSS 尚未正确配置");
    return { backend: oss, name };
  }
  return { backend: minioBackend(), name };
}
