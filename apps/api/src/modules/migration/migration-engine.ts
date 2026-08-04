import type { PrismaClient } from "@prisma/client";
import type {
  ObjectStorageBackend,
  StorageBackendName,
} from "../storage/storage-backend";

/**
 * 数据迁移引擎（导出/导入共用）。
 *
 * 从既有 `scripts/migrate-storage-to-r2.ts` 抽取并通用化：
 * - 去掉了"复制后把源库 storageBackend 翻转为 r2"的副作用——翻转只发生在
 *   导入端，且目标后端参数化，不硬编码。
 * - 期望大小只以 manifest 为准（导入时源往往不可达，avatar/banner/favicon
 *   在 DB 又没有大小字段）。
 * - 对象按 DB 引用枚举（collectObjectRefs），不列 bucket 目录。
 */

export type ObjectRefKind =
  "avatar" | "banner" | "favicon" | "file_asset" | "classroom_file";

export interface ObjectRef {
  kind: ObjectRefKind;
  recordKey: string;
  storageKey: string;
  backend: StorageBackendName;
  /** DB 记录的大小（file_asset/classroom_file 有）；avatar/banner/favicon 为 null。 */
  expectedSize: number | null;
  mimeType: string | null;
  /** 导入端把该记录翻转到目标后端；目标后端参数化。 */
  updateBackend: (
    prisma: PrismaClient,
    targetBackend: StorageBackendName,
  ) => Promise<unknown>;
}

export interface ObjectTransferSummary {
  total: number;
  planned: number;
  migrated: number;
  skipped: number;
  failed: number;
  missing: number;
  totalBytes: number;
}

export function newSummary(): ObjectTransferSummary {
  return {
    total: 0,
    planned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    missing: 0,
    totalBytes: 0,
  };
}

/** 枚举全部非空存储引用。与既有脚本一致，`pending/` 临时对象天然不在范围。 */
export async function collectObjectRefs(
  prisma: PrismaClient,
): Promise<ObjectRef[]> {
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
        updateBackend: (client, target) =>
          client.user.update({
            where: { id: user.id },
            data: { avatarStorageBackend: target },
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
        updateBackend: (client, target) =>
          client.user.update({
            where: { id: user.id },
            data: { bannerStorageBackend: target },
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
      update: (
        client: PrismaClient,
        target: StorageBackendName,
      ) => Promise<unknown>;
    }> = [
      {
        key: workspace.faviconStorageKey,
        backend: workspace.faviconStorageBackend as StorageBackendName,
        mime: workspace.faviconMimeType ?? null,
        update: (client, target) =>
          client.workspace.update({
            where: { id: workspace.id },
            data: { faviconStorageBackend: target },
          }),
      },
      {
        key: workspace.faviconLightStorageKey,
        backend: workspace.faviconLightStorageBackend as StorageBackendName,
        mime: workspace.faviconLightMimeType ?? null,
        update: (client, target) =>
          client.workspace.update({
            where: { id: workspace.id },
            data: { faviconLightStorageBackend: target },
          }),
      },
      {
        key: workspace.faviconDarkStorageKey,
        backend: workspace.faviconDarkStorageBackend as StorageBackendName,
        mime: workspace.faviconDarkMimeType ?? null,
        update: (client, target) =>
          client.workspace.update({
            where: { id: workspace.id },
            data: { faviconDarkStorageBackend: target },
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
      updateBackend: (client, target) =>
        client.fileAsset.update({
          where: { id: asset.id },
          data: { storageBackend: target },
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
      updateBackend: (client, target) =>
        client.classroomFile.update({
          where: { id: file.id },
          data: { storageBackend: target },
        }),
    });
  }

  return refs;
}

/** 读取源对象元信息；失败返回 null（源对象缺失）。 */
export async function statRefObject(
  source: ObjectStorageBackend,
  storageKey: string,
): Promise<{ size: number } | null> {
  try {
    return await source.statObject(storageKey);
  } catch {
    return null;
  }
}

/**
 * 跨后端复制单个对象（直推/直拉共用）：幂等——目标已存在且大小一致则跳过；
 * 否则从源拉流写目标，写后 stat 校验大小。返回 `migrated` 或 `skipped`。
 */
export async function transferObjectTo(options: {
  source: ObjectStorageBackend;
  target: ObjectStorageBackend;
  storageKey: string;
  mimeType: string;
  expectedSize: number;
}): Promise<"migrated" | "skipped"> {
  const { source, target, storageKey, mimeType, expectedSize } = options;
  try {
    const existing = await target.statObject(storageKey);
    if (existing.size === expectedSize) return "skipped";
  } catch {
    // 目标不存在，继续写入。
  }
  const stream = await source.getObject(storageKey);
  try {
    await target.putObject(storageKey, stream, mimeType, expectedSize);
  } catch (caught) {
    // 写目标失败时释放源下载流（持有远端连接），避免大批量失败时句柄累积。
    stream.destroy();
    throw caught;
  }
  const statResult = await target.statObject(storageKey);
  if (statResult.size !== expectedSize) {
    throw new Error(
      `对象 ${storageKey} 大小不符：期望 ${expectedSize} 实际 ${statResult.size}`,
    );
  }
  return "migrated";
}

export function messageOf(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
