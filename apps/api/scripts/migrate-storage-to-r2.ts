/**
 * MinIO / 阿里云 OSS → Cloudflare R2 对象迁移工具。
 *
 * 覆盖：
 * - User.avatarStorageKey / bannerStorageKey
 * - Workspace 默认/亮色/暗色 favicon
 * - FileAsset.storageKey
 * - ClassroomFile.storageKey
 *
 * 规则：
 * - 默认 `--dry-run`，只有显式 `--execute` 才写入数据库和 R2。
 * - 使用相同 storageKey 流式复制，不把大对象完整读入内存。
 * - 复制后对 R2 stat 校验对象存在与大小；只有单个对象验证成功后才把
 *   对应记录的 storageBackend 改为 r2，禁止提前批量 UPDATE。
 * - 单对象失败记录错误并继续，不阻断全部迁移。
 * - 可中断、可恢复、可重复执行：R2 已存在且大小一致的对象自动跳过。
 * - 日志不包含存储 Secret、签名 URL 或用户隐私内容。
 *
 * 用法：
 *   pnpm --filter @liveboard/api migrate-storage-to-r2 -- --dry-run
 *   pnpm --filter @liveboard/api migrate-storage-to-r2 -- --execute --concurrency 4
 */
import { PrismaClient } from "@prisma/client";
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

interface Args {
  execute: boolean;
  concurrency: number;
  limit: number;
  types: string[] | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    execute: false,
    concurrency: 4,
    limit: 0,
    types: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") args.execute = true;
    else if (arg === "--concurrency") {
      args.concurrency = Math.max(1, Math.min(16, Number(argv[++index] ?? 4)));
    } else if (arg === "--limit") {
      args.limit = Math.max(0, Number(argv[++index] ?? 0));
    } else if (arg === "--type") {
      args.types = (argv[++index] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--dry-run") {
      args.execute = false;
    }
  }
  return args;
}

export interface ObjectRef {
  kind: "avatar" | "banner" | "favicon" | "file_asset" | "classroom_file";
  recordKey: string;
  storageKey: string;
  backend: StorageBackendName;
  expectedSize: number | null;
  mimeType: string | null;
  updateBackend: (prisma: PrismaClient) => Promise<unknown>;
}

async function collectRefs(prisma: PrismaClient): Promise<ObjectRef[]> {
  const refs: ObjectRef[] = [];

  const users = await prisma.user.findMany({
    select: {
      id: true,
      avatarStorageKey: true,
      avatarStorageBackend: true,
      avatarMimeType: true,
      bannerStorageKey: true,
      bannerStorageBackend: true,
      bannerMimeType: true,
    },
  });
  for (const user of users) {
    if (user.avatarStorageKey) {
      refs.push({
        kind: "avatar",
        recordKey: user.id,
        storageKey: user.avatarStorageKey,
        backend: user.avatarStorageBackend as StorageBackendName,
        expectedSize: null,
        mimeType: user.avatarMimeType ?? null,
        updateBackend: (client) =>
          client.user.update({
            where: { id: user.id },
            data: { avatarStorageBackend: "r2" },
          }),
      });
    }
    if (user.bannerStorageKey) {
      refs.push({
        kind: "banner",
        recordKey: user.id,
        storageKey: user.bannerStorageKey,
        backend: user.bannerStorageBackend as StorageBackendName,
        expectedSize: null,
        mimeType: user.bannerMimeType ?? null,
        updateBackend: (client) =>
          client.user.update({
            where: { id: user.id },
            data: { bannerStorageBackend: "r2" },
          }),
      });
    }
  }

  const workspaces = await prisma.workspace.findMany({
    select: {
      id: true,
      faviconStorageKey: true,
      faviconStorageBackend: true,
      faviconMimeType: true,
      faviconLightStorageKey: true,
      faviconLightStorageBackend: true,
      faviconLightMimeType: true,
      faviconDarkStorageKey: true,
      faviconDarkStorageBackend: true,
      faviconDarkMimeType: true,
    },
  });
  for (const workspace of workspaces) {
    const variants: Array<{
      key: string | null;
      backend: StorageBackendName;
      mime: string | null;
      update: (client: PrismaClient) => Promise<unknown>;
    }> = [
      {
        key: workspace.faviconStorageKey,
        backend: workspace.faviconStorageBackend as StorageBackendName,
        mime: workspace.faviconMimeType ?? null,
        update: (client) =>
          client.workspace.update({
            where: { id: workspace.id },
            data: { faviconStorageBackend: "r2" },
          }),
      },
      {
        key: workspace.faviconLightStorageKey,
        backend: workspace.faviconLightStorageBackend as StorageBackendName,
        mime: workspace.faviconLightMimeType ?? null,
        update: (client) =>
          client.workspace.update({
            where: { id: workspace.id },
            data: { faviconLightStorageBackend: "r2" },
          }),
      },
      {
        key: workspace.faviconDarkStorageKey,
        backend: workspace.faviconDarkStorageBackend as StorageBackendName,
        mime: workspace.faviconDarkMimeType ?? null,
        update: (client) =>
          client.workspace.update({
            where: { id: workspace.id },
            data: { faviconDarkStorageBackend: "r2" },
          }),
      },
    ];
    for (const variant of variants) {
      if (variant.key) {
        refs.push({
          kind: "favicon",
          recordKey: workspace.id,
          storageKey: variant.key,
          backend: variant.backend,
          expectedSize: null,
          mimeType: variant.mime,
          updateBackend: variant.update,
        });
      }
    }
  }

  const fileAssets = await prisma.fileAsset.findMany({
    select: {
      id: true,
      storageKey: true,
      storageBackend: true,
      sizeBytes: true,
      mimeType: true,
    },
  });
  for (const asset of fileAssets) {
    refs.push({
      kind: "file_asset",
      recordKey: asset.id,
      storageKey: asset.storageKey,
      backend: asset.storageBackend as StorageBackendName,
      expectedSize: asset.sizeBytes,
      mimeType: asset.mimeType,
      updateBackend: (client) =>
        client.fileAsset.update({
          where: { id: asset.id },
          data: { storageBackend: "r2" },
        }),
    });
  }

  const classroomFiles = await prisma.classroomFile.findMany({
    select: {
      id: true,
      storageKey: true,
      storageBackend: true,
      sizeBytes: true,
      mimeType: true,
    },
  });
  for (const file of classroomFiles) {
    refs.push({
      kind: "classroom_file",
      recordKey: file.id,
      storageKey: file.storageKey,
      backend: file.storageBackend as StorageBackendName,
      expectedSize: file.sizeBytes,
      mimeType: file.mimeType,
      updateBackend: (client) =>
        client.classroomFile.update({
          where: { id: file.id },
          data: { storageBackend: "r2" },
        }),
    });
  }

  return refs;
}

export interface Summary {
  total: number;
  planned: number;
  migrated: number;
  skipped: number;
  failed: number;
  missing: number;
  totalBytes: number;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const summary: Summary = {
    total: 0,
    planned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    missing: 0,
    totalBytes: 0,
  };

  let r2: R2StorageBackend;
  let sourceMinio: ObjectStorageBackend | null = null;
  let sourceOss: ObjectStorageBackend | null = null;
  let ossConfigured = false;

  try {
    r2 = new R2StorageBackend(resolveR2ClientConfig(process.env));

    const secretService = new AiSecretService({
      get: (key: string) => process.env[key],
    } as never);

    const storageSettings = await prisma.storageSettings.findFirst({
      include: { workspace: true },
    });
    if (storageSettings) {
      const config: OssClientConfig | null =
        storageSettings.ossRegion &&
        storageSettings.ossBucket &&
        storageSettings.ossAccessKeyId &&
        storageSettings.ossAccessKeySecret
          ? {
              region: storageSettings.ossRegion,
              bucket: storageSettings.ossBucket,
              endpoint: storageSettings.ossEndpoint ?? null,
              internal: storageSettings.ossInternal,
              internalEndpoint: storageSettings.ossInternalEndpoint ?? null,
              accessKeyId: storageSettings.ossAccessKeyId,
              accessKeySecret: secretService.decrypt(
                storageSettings.ossAccessKeySecret,
              ),
            }
          : null;
      if (config) {
        sourceOss = new OssStorageBackend(config);
        ossConfigured = true;
      }
    }

    const minioBucket = process.env.MINIO_BUCKET ?? "liveboard-assets";
    const minioClient = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: (process.env.MINIO_USE_SSL ?? "false") === "true",
      accessKey: process.env.MINIO_ROOT_USER ?? "liveboard",
      secretKey: process.env.MINIO_ROOT_PASSWORD ?? "",
      partSize: ATOMIC_UPLOAD_PART_SIZE_BYTES,
    });
    sourceMinio = new MinioStorageBackend(minioClient, minioBucket);

    const allRefs = await collectRefs(prisma);
    let refs = allRefs.filter((ref) => ref.backend !== "r2");
    if (args.types && args.types.length > 0) {
      refs = refs.filter((ref) => args.types!.includes(ref.kind));
    }
    if (args.limit > 0) {
      refs = refs.slice(0, args.limit);
    }
    summary.total = refs.length;

    console.log(
      `[migrate-storage-to-r2] mode=${args.execute ? "EXECUTE" : "dry-run"} ` +
        `total=${summary.total} concurrency=${args.concurrency}`,
    );
    if (!ossConfigured) {
      console.log(
        "[migrate-storage-to-r2] 注意：未找到可用的 OSS 配置，OSS 源对象将被视为缺失。",
      );
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < refs.length) {
        const ref = refs[cursor];
        cursor += 1;
        if (!ref) continue;
        await migrateOne(
          prisma,
          r2,
          sourceMinio!,
          sourceOss,
          ref,
          args.execute,
          summary,
        );
      }
    };

    await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

    console.log(
      `[migrate-storage-to-r2] done total=${summary.total} ` +
        `planned=${summary.planned} migrated=${summary.migrated} skipped=${summary.skipped} ` +
        `failed=${summary.failed} missing=${summary.missing} ` +
        `bytes=${summary.totalBytes}`,
    );
    if (summary.failed > 0 || summary.missing > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

export async function migrateOne(
  prisma: PrismaClient,
  r2: R2StorageBackend,
  sourceMinio: ObjectStorageBackend,
  sourceOss: ObjectStorageBackend | null,
  ref: ObjectRef,
  execute: boolean,
  summary: Summary,
) {
  const label = `${ref.kind}:${ref.recordKey}`;

  let source: ObjectStorageBackend;
  if (ref.backend === "oss") {
    if (!sourceOss) {
      summary.missing += 1;
      console.warn(`[migrate-storage-to-r2] MISSING ${label} (OSS 未配置)`);
      return;
    }
    source = sourceOss;
  } else {
    source = sourceMinio;
  }

  // 所有模式都先读取源对象元信息。头像、Banner、favicon 没有数据库大小字段，
  // 必须以源对象 stat 为准，不能把 R2 中任意同名对象直接视为迁移成功。
  let sourceSize: number;
  try {
    sourceSize = (await source.statObject(ref.storageKey)).size;
  } catch {
    summary.missing += 1;
    console.warn(`[migrate-storage-to-r2] MISSING ${label} (源对象不存在)`);
    return;
  }
  if (ref.expectedSize !== null && sourceSize !== ref.expectedSize) {
    summary.failed += 1;
    console.error(
      `[migrate-storage-to-r2] FAILED ${label} 源对象大小与数据库不符: 数据库 ${ref.expectedSize} 实际 ${sourceSize}`,
    );
    return;
  }
  const expectedSize = ref.expectedSize ?? sourceSize;
  summary.totalBytes += expectedSize;

  // 已存在且与源对象大小一致的对象视为已完成，自动跳过（可恢复执行）。
  try {
    const existing = await r2.statObject(ref.storageKey);
    if (existing.size === expectedSize) {
      if (execute && ref.backend !== "r2") {
        try {
          await ref.updateBackend(prisma);
        } catch (caught) {
          summary.failed += 1;
          console.error(
            `[migrate-storage-to-r2] FAILED ${label} 数据库更新失败: ${messageOf(caught)}`,
          );
          return;
        }
      }
      summary.skipped += 1;
      return;
    }
  } catch {
    // 目标不存在，执行模式继续复制；dry-run 只记录计划。
  }

  if (!execute) {
    summary.planned += 1;
    console.log(`[migrate-storage-to-r2] PLAN ${label} bytes=${expectedSize}`);
    return;
  }

  let stream;
  try {
    stream = await source.getObject(ref.storageKey);
  } catch (caught) {
    summary.missing += 1;
    console.warn(`[migrate-storage-to-r2] MISSING ${label} (源对象读取失败)`);
    return;
  }

  try {
    await r2.putObject(
      ref.storageKey,
      stream,
      ref.mimeType ?? "application/octet-stream",
    );
  } catch (caught) {
    summary.failed += 1;
    console.error(
      `[migrate-storage-to-r2] FAILED ${label} 目标写入失败: ${messageOf(caught)}`,
    );
    return;
  }

  try {
    const stat = await r2.statObject(ref.storageKey);
    if (stat.size !== expectedSize) {
      summary.failed += 1;
      console.error(
        `[migrate-storage-to-r2] FAILED ${label} 大小不符: 期望 ${expectedSize} 实际 ${stat.size}`,
      );
      return;
    }
  } catch (caught) {
    summary.failed += 1;
    console.error(
      `[migrate-storage-to-r2] FAILED ${label} 校验失败: ${messageOf(caught)}`,
    );
    return;
  }

  // 只有单个对象验证成功后才切换该记录的 backend。
  if (execute) {
    try {
      await ref.updateBackend(prisma);
    } catch (caught) {
      summary.failed += 1;
      console.error(
        `[migrate-storage-to-r2] FAILED ${label} 数据库更新失败: ${messageOf(caught)}`,
      );
      return;
    }
  }
  summary.migrated += 1;
  console.log(`[migrate-storage-to-r2] OK ${label}`);
}

function messageOf(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}

if (require.main === module) {
  run().catch((caught) => {
    console.error("[migrate-storage-to-r2] 执行失败:", messageOf(caught));
    process.exitCode = 1;
  });
}
