import type { PrismaClient } from "@prisma/client";
import type {
  ObjectStorageBackend,
  StorageBackendName,
} from "../storage/storage-backend";
import { collectObjectRefs, type ObjectRef } from "./migration-engine";
import type { MigrationManifest } from "./migration-manifest";

/**
 * 导入后校验（改编自 scripts/verify-vercel-data-migration.ts 为通用版本）。
 * 所有阻断项汇总后一次性返回，`missing=0` 才允许上线。
 */

export interface VerifyResult {
  checks: Array<{ check: string; ok: boolean; detail?: string }>;
  blocking: boolean;
}

function buildResult(): { results: VerifyResult["checks"]; blocking: boolean } {
  return { results: [], blocking: false };
}

function record(
  state: { results: VerifyResult["checks"]; blocking: boolean },
  check: string,
  ok: boolean,
  detail?: string,
) {
  state.results.push({ check, ok, detail });
  if (!ok) state.blocking = true;
}

export async function verifyImport(options: {
  prisma: PrismaClient;
  manifest: MigrationManifest;
  targetBackend: ObjectStorageBackend;
  targetBackendName: StorageBackendName;
}): Promise<VerifyResult> {
  const { prisma, manifest, targetBackend, targetBackendName } = options;
  const state = buildResult();

  // 1. 各业务表行数与 manifest 一致
  for (const [table, expected] of Object.entries(manifest.tables)) {
    const actual = await countTable(prisma, table);
    record(
      state,
      `行数 ${table}`,
      actual === expected,
      `期望=${expected} 实际=${actual ?? "无法读取"}`,
    );
  }

  // 2. 关键外键无孤立引用
  const orphans = await collectOrphans(prisma);
  record(
    state,
    "孤立外键",
    orphans.length === 0,
    `${orphans.length} 条孤立引用`,
  );

  // 3. 至少一名正常最高管理员
  const superAdmin = await prisma.user.findFirst({
    where: { systemRole: "super_admin", status: "active" },
    select: { id: true, username: true },
  });
  record(
    state,
    "存在正常最高管理员",
    Boolean(superAdmin),
    superAdmin?.username ?? "无",
  );

  // 4. 对象全部在目标后端存在且大小正确、backend 全部为目标后端
  const manifestByKey = new Map(manifest.objects.map((o) => [o.storageKey, o]));
  const refs = await collectObjectRefs(prisma);
  let missing = 0;
  let wrongBackend = 0;
  for (const ref of refs) {
    if (ref.backend !== targetBackendName) wrongBackend += 1;
    const entry = manifestByKey.get(ref.storageKey);
    const expectedSize = entry?.sizeBytes ?? null;
    if (!(await objectExists(targetBackend, ref.storageKey, expectedSize))) {
      missing += 1;
    }
  }
  record(state, "缺失对象", missing === 0, `${missing} 个缺失对象`);
  record(
    state,
    "对象 backend 均为目标后端",
    wrongBackend === 0,
    `${wrongBackend} 条记录非 ${targetBackendName}`,
  );

  // 5. _prisma_migrations 与 manifest 一致且全部完成
  const migrations = (await prisma.$queryRaw`
    SELECT "migration_name", "finished_at" IS NOT NULL AS done FROM "_prisma_migrations"
  `) as Array<{ migration_name: string; done: boolean }>;
  const expectedNames = manifest.migrations.map((m) => m.name);
  const actualNames = migrations
    .filter((row) => row.done)
    .map((row) => row.migration_name);
  const missingMigration = expectedNames.filter(
    (name) => !actualNames.includes(name),
  );
  const extraMigration = actualNames.filter(
    (name) => !expectedNames.includes(name),
  );
  record(
    state,
    "_prisma_migrations 与 manifest 一致",
    missingMigration.length === 0 && extraMigration.length === 0,
    [
      missingMigration.length ? `缺少: ${missingMigration.join(", ")}` : "",
      extraMigration.length ? `多余: ${extraMigration.join(", ")}` : "",
      `共 ${actualNames.length} 条`,
    ]
      .filter(Boolean)
      .join("；"),
  );

  // 6. 密钥确认为空
  const aiConfigs = await prisma.aiProviderConfig.count({
    where: { apiKey: { not: "" } },
  });
  record(
    state,
    "AI Provider 密钥已清空",
    aiConfigs === 0,
    `${aiConfigs} 条仍含密钥`,
  );
  const storage = await prisma.storageSettings.findFirst({
    select: {
      backend: true,
      ossAccessKeyId: true,
      ossAccessKeySecret: true,
      ossEndpoint: true,
    },
  });
  const ossDirty = Boolean(
    storage?.ossAccessKeyId ||
    storage?.ossAccessKeySecret ||
    storage?.ossEndpoint,
  );
  // OSS 目标允许存在目标自身的 OSS 凭据（导入前捕获、还原后写回，密钥未变）；
  // 非 OSS 后端必须清空，防止源端凭据随 dump 泄漏到目标库。
  const storageDirty = storage?.backend !== "oss" && ossDirty;
  record(
    state,
    "StorageSettings 凭据已清空",
    !storageDirty,
    storageDirty ? "仍含 OSS 凭据" : "已清空",
  );

  return { checks: state.results, blocking: state.blocking };
}

async function countTable(
  prisma: PrismaClient,
  table: string,
): Promise<number | null> {
  // 表名来自不受信的 manifest.tables，拼进 SQL 前必须校验为安全标识符。
  if (!/^[A-Za-z0-9_]+$/.test(table)) return null;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "public"."${table}"`,
    )) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  } catch {
    return null;
  }
}

async function collectOrphans(prisma: PrismaClient): Promise<string[]> {
  const orphans: string[] = [];
  const [
    assetRefs,
    folders,
    files,
    posts,
    workspaceRefs,
    classrooms,
    assetIds,
  ] = await Promise.all([
    prisma.fileAsset.findMany({
      select: {
        id: true,
        workspaceId: true,
        folderId: true,
        fileId: true,
        forumPostId: true,
      },
    }),
    prisma.folder.findMany({ select: { id: true } }),
    prisma.file.findMany({ select: { id: true } }),
    prisma.forumPost.findMany({ select: { id: true } }),
    prisma.workspace.findMany({ select: { id: true } }),
    prisma.classroom.findMany({ select: { id: true } }),
    prisma.fileAsset.findMany({ select: { id: true } }),
  ]);
  const folderIds = new Set(folders.map((f) => f.id));
  const fileIds = new Set(files.map((f) => f.id));
  const postIds = new Set(posts.map((p) => p.id));
  const workspaceIds = new Set(workspaceRefs.map((w) => w.id));
  const classroomIds = new Set(classrooms.map((c) => c.id));
  const assetIdSet = new Set(assetIds.map((a) => a.id));

  for (const asset of assetRefs) {
    if (!workspaceIds.has(asset.workspaceId))
      orphans.push(`FileAsset.workspaceId=${asset.workspaceId}`);
    if (asset.folderId && !folderIds.has(asset.folderId))
      orphans.push(`FileAsset.folderId=${asset.folderId}`);
    if (asset.fileId && !fileIds.has(asset.fileId))
      orphans.push(`FileAsset.fileId=${asset.fileId}`);
    if (asset.forumPostId && !postIds.has(asset.forumPostId))
      orphans.push(`FileAsset.forumPostId=${asset.forumPostId}`);
  }

  const classroomFiles = await prisma.classroomFile.findMany({
    select: { classroomId: true },
  });
  for (const file of classroomFiles) {
    if (!classroomIds.has(file.classroomId))
      orphans.push(`ClassroomFile.classroomId=${file.classroomId}`);
  }

  const deckItems = await prisma.teachingDeckItem.findMany({
    select: { assetId: true },
  });
  for (const item of deckItems) {
    if (item.assetId && !assetIdSet.has(item.assetId))
      orphans.push(`TeachingDeckItem.assetId=${item.assetId}`);
  }

  return orphans;
}

async function objectExists(
  backend: ObjectStorageBackend,
  key: string,
  expectedSize: number | null,
): Promise<boolean> {
  try {
    const stat = await backend.statObject(key);
    if (expectedSize !== null && stat.size !== expectedSize) return false;
    return true;
  } catch {
    return false;
  }
}

/** 供独立校验脚本打印结果。 */
export function formatVerifyResult(result: VerifyResult): string[] {
  const lines = result.checks.map(
    (c) =>
      `[verify] ${c.ok ? "PASS" : "FAIL"} ${c.check}` +
      (c.detail ? ` — ${c.detail}` : ""),
  );
  lines.push(
    `[verify] ${result.blocking ? "发现阻断性问题，禁止上线" : "全部校验通过"}`,
  );
  return lines;
}

export function hasMissingObjects(result: VerifyResult): boolean {
  const check = result.checks.find((c) => c.check === "缺失对象");
  return Boolean(check && !check.ok);
}
