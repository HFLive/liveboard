/**
 * 导入器：把迁移包应用到目标部署。
 *
 * 执行顺序（docs/migrate-any-direction-design.md §7）：
 *   前置校验（fail-closed）→ 腾空目标库（DROP SCHEMA）→ pg_restore 还原 →
 *   逐条 prisma migrate resolve → 抹除密钥 → 对象写入激活后端并逐对象校验后
 *   翻转 storageBackend → 导入后校验。任一步失败立即终止。
 *
 * 目标允许已有数据：导入前会彻底清空目标库且不做自动备份，因此必须传入
 * `--confirm` 确认语（§7.1 决策 #4）。
 *
 * 对象来源模式（互斥）：
 *   - 缺省：从包内 objects/ 读取（server→server）。
 *   - --finalize-objects：对象已由源服务器直推到目标后端（server→vercel），
 *     只做"逐对象 stat + backend 翻转"收尾。
 *   - --pull-source-r2：从源 R2 直拉进目标后端（vercel→server / vercel→vercel，
 *     源 R2 凭据走 SOURCE_R2_* 一次性交接）。
 *
 * 用法：
 *   tsx scripts/migrate-import.ts --job-id <id> --source <包目录或.tar> \
 *     --confirm CONFIRM-IMPORT [--target-backend minio|oss|r2] [--concurrency 4] \
 *     [--finalize-objects|--pull-source-r2] [--ensure-maintenance]
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  collectObjectRefs,
  messageOf,
  newSummary,
  transferObjectTo,
  type ObjectRef,
  type ObjectTransferSummary,
} from "../src/modules/migration/migration-engine";
import {
  DEFAULT_IMPORT_CONFIRM_PHRASE,
  loadManifest,
  type MigrationManifest,
} from "../src/modules/migration/migration-manifest";
import { normalizeBundledMigrations } from "../src/modules/migration/migration-history";
import {
  formatVerifyResult,
  verifyImport,
} from "../src/modules/migration/migration-verify";
import { writeJobState } from "../src/modules/migration/migration-job-file";
import {
  MAINTENANCE_OFF,
  readMaintenanceStateFile,
  writeMaintenanceStateFile,
} from "../src/modules/migration/maintenance-file";
import {
  appVersion,
  databaseUrlForTools,
  migrationDataDir,
  parsePostgresUrl,
  pgConnectionArgs,
  runPgTool,
  runPrismaResolve,
  targetMigrationsDir,
} from "./migrate-cli";
import {
  createTargetActiveBackend,
  ossFromSettings,
  sourceR2Backend,
  targetR2Backend,
  type OssSettingsFields,
} from "./migrate-backends";
import { resolvePackageDir } from "./migrate-package";

const EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
  "PendingUpload",
  "ServerMetricSample",
  "MigrationJob",
]);

/** 目标 StorageSettings 的字段子集（清库前捕获，含 OSS 凭据与目标后端）。 */
interface TargetStorageFields {
  backend: string | null;
  ossRegion: string | null;
  ossBucket: string | null;
  ossEndpoint: string | null;
  ossInternal: boolean;
  ossInternalEndpoint: string | null;
  ossAccessKeyId: string | null;
  ossAccessKeySecret: string | null;
}

/** 对象来源模式：缺省从包内 objects/ 读取；finalize = 目标后端已有对象，只 stat+翻转；pull-r2 = 从源 R2 直拉。 */
type ObjectSourceMode = "package" | "finalize" | "pull-r2";

interface Args {
  jobId: string;
  source: string;
  concurrency: number;
  confirm: string;
  ensureMaintenance: boolean;
  /** 目标激活后端；导入会整体替换目标库，必须显式指定，不能依赖还原后的 DB。 */
  targetBackend: "minio" | "oss" | "r2" | null;
  objectSource: ObjectSourceMode;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    jobId: "",
    source: "",
    concurrency: 4,
    confirm: "",
    ensureMaintenance: false,
    targetBackend: null,
    objectSource: "package",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job-id") args.jobId = argv[++index] ?? "";
    else if (arg === "--source") args.source = argv[++index] ?? "";
    else if (arg === "--concurrency") {
      // 非数字输入 → NaN → 0 worker，对象导入会"成功"但什么都没做。校验后回退。
      const value = Number(argv[++index] ?? 4);
      args.concurrency = Number.isFinite(value)
        ? Math.max(1, Math.min(16, Math.trunc(value)))
        : 4;
    } else if (arg === "--confirm") args.confirm = argv[++index] ?? "";
    else if (arg === "--target-backend") {
      const value = (argv[++index] ?? "") as Args["targetBackend"];
      if (value !== "minio" && value !== "oss" && value !== "r2") {
        throw new Error(`--target-backend 无效：${value}`);
      }
      args.targetBackend = value;
    } else if (arg === "--ensure-maintenance") args.ensureMaintenance = true;
    else if (arg === "--finalize-objects") {
      if (args.objectSource !== "package")
        throw new Error("--finalize-objects 与 --pull-source-r2 互斥");
      args.objectSource = "finalize";
    } else if (arg === "--pull-source-r2") {
      if (args.objectSource !== "package")
        throw new Error("--finalize-objects 与 --pull-source-r2 互斥");
      args.objectSource = "pull-r2";
    }
  }
  if (!args.jobId) throw new Error("缺少 --job-id");
  if (!args.source) throw new Error("缺少 --source");
  if (
    (args.objectSource === "finalize" || args.objectSource === "pull-r2") &&
    !args.targetBackend
  ) {
    throw new Error(
      `--${args.objectSource === "finalize" ? "finalize-objects" : "pull-source-r2"} 需要显式 --target-backend`,
    );
  }
  return args;
}

// --- 预校验（§7.1） ---------------------------------------------------------

async function sha256File(file: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  const { pipeline } = await import("node:stream/promises");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/**
 * 归一化并校验包内迁移历史（§7.1 前置校验的一部分）。
 *
 * 目标应用只打包单 baseline 收口后的迁移文件夹，而源库 `_prisma_migrations`
 * 过渡后仍保留被 baseline 合并的旧历史记录（文件夹已不存在）。归一化会：
 * 保留目标有文件夹的迁移并校验 checksum；跳过无文件夹但有 baseline 覆盖的旧
 * 历史；无文件夹且无 baseline 时 fail-closed（目标版本不兼容）。归一化后的
 * manifest.migrations 供后续逐条 resolve 与导入后校验使用。
 */
async function normalizeAndValidateMigrationHistory(
  manifest: MigrationManifest,
): Promise<void> {
  const result = await normalizeBundledMigrations(
    manifest.migrations,
    targetMigrationsDir(),
    true,
  );
  if (result.skippedLegacy > 0) {
    console.log(
      `[import] 跳过 ${result.skippedLegacy} 条已并入 baseline 的旧历史迁移记录`,
    );
  }
  manifest.migrations = result.migrations;
}

async function validateDumpHasNoExcludedData(dumpFile: string): Promise<void> {
  const result = spawnSync("pg_restore", ["--list", dumpFile], {
    encoding: "utf8",
  });
  if (result.error || (result.status ?? 1) !== 0) {
    throw new Error(
      `pg_restore --list 失败：${result.error?.message ?? `exit=${result.status}`}`,
    );
  }
  const list = result.stdout ?? "";
  for (const table of EXCLUDED_TABLES) {
    if (new RegExp(`TABLE DATA\\s+\\S+\\s+${table}\\s`).test(list)) {
      throw new Error(
        `迁移包 database.dump 含 ${table} 的数据项，包不合法，拒绝导入。`,
      );
    }
  }
}

async function validateManifestPath(obj: {
  path: string | null;
}): Promise<void> {
  if (obj.path === null) return;
  if (
    !obj.path.startsWith("objects/") ||
    obj.path.includes("..") ||
    obj.path.split("/").length !== 2
  ) {
    throw new Error(
      `迁移包对象路径不合法，拒绝导入（fail-closed）：${obj.path}`,
    );
  }
}

// --- 还原（§7.2/7.3） -------------------------------------------------------

/**
 * 腾空目标库（DROP SCHEMA CASCADE）。这是对目标库的第一次改动：调用方必须在
 * 成功后立即把 targetMutated 置位，保证后续任何失败都保持维护模式，不会把
 * 已清空/半导入的目标库当作正常状态暴露给应用写流量。
 */
async function dropSchema(
  dbUrl: string,
  state: (phase: string) => Promise<void>,
) {
  const conn = parsePostgresUrl(dbUrl);

  await state("import/drop-schema");
  const dropSql =
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;";
  const psqlStatus = runPgTool(
    "psql",
    [
      ...pgConnectionArgs(conn),
      "-d",
      conn.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      dropSql,
    ],
    dbUrl,
  );
  if (psqlStatus !== 0) throw new Error(`腾空目标库失败（exit=${psqlStatus}）`);
}

/**
 * 还原 database.dump。`--single-transaction` 把整个还原包进一个事务：失败即
 * 整体回滚，库停在 DROP 后的"空 schema"，不会留下半还原状态，与调用方的
 * targetMutated 语义一致。
 */
async function restoreFromDump(
  dbUrl: string,
  dumpFile: string,
  state: (phase: string) => Promise<void>,
) {
  const conn = parsePostgresUrl(dbUrl);

  await state("import/restore");
  const restoreStatus = runPgTool(
    "pg_restore",
    [
      ...pgConnectionArgs(conn),
      "-d",
      conn.database,
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      dumpFile,
    ],
    dbUrl,
  );
  if (restoreStatus !== 0)
    throw new Error(`pg_restore 还原失败（exit=${restoreStatus}）`);
}

async function resolveAllMigrations(
  manifest: MigrationManifest,
  dbUrl: string,
  state: (
    phase: string,
    extra?: Parameters<typeof writeJobState>[2],
  ) => Promise<void>,
) {
  await state("import/resolve", {
    progress: {
      done: 0,
      total: manifest.migrations.length,
      label: "标记迁移历史",
    },
  });
  for (let index = 0; index < manifest.migrations.length; index += 1) {
    const migration = manifest.migrations[index]!;
    const status = runPrismaResolve(migration.name, dbUrl);
    if (status !== 0) {
      throw new Error(
        `prisma migrate resolve ${migration.name} 失败（exit=${status}）`,
      );
    }
    if ((index + 1) % 5 === 0 || index + 1 === manifest.migrations.length) {
      await state("import/resolve", {
        progress: { done: index + 1, total: manifest.migrations.length },
      });
    }
  }
}

async function wipeSecrets(
  prisma: PrismaClient,
  targetBackend: "minio" | "oss" | "r2",
  preservedOss: OssSettingsFields | null,
): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE "AiProviderConfig" SET "apiKey" = ''`);
  if (targetBackend === "oss" && preservedOss) {
    // OSS 目标：把导入前捕获的目标自身 OSS 配置（含加密 secret，密钥未变）写回，
    // 导入完成后应用无需重新配置即可继续访问 OSS。
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "StorageSettings" SET "backend" = 'oss',
        "ossRegion" = ${preservedOss.ossRegion},
        "ossBucket" = ${preservedOss.ossBucket},
        "ossEndpoint" = ${preservedOss.ossEndpoint},
        "ossAccessKeyId" = ${preservedOss.ossAccessKeyId},
        "ossAccessKeySecret" = ${preservedOss.ossAccessKeySecret},
        "ossInternal" = ${preservedOss.ossInternal},
        "ossInternalEndpoint" = ${preservedOss.ossInternalEndpoint}`,
    );
  } else {
    // StorageSettings.backend 强制改回目标后端（还原后 DB 里是源端的值），
    // 清空 OSS 凭据；MinIO/R2 配置来自环境变量，无需 DB 凭据。
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "StorageSettings" SET "backend" = ${targetBackend},
        "ossRegion" = NULL, "ossBucket" = NULL, "ossEndpoint" = NULL,
        "ossAccessKeyId" = NULL, "ossAccessKeySecret" = NULL, "ossInternal" = false, "ossInternalEndpoint" = NULL`,
    );
  }
}

// --- 对象导入（§7.6） -------------------------------------------------------

async function importObjects(options: {
  prisma: PrismaClient;
  packageDir: string;
  manifest: MigrationManifest;
  concurrency: number;
  targetBackend: "minio" | "oss" | "r2";
  /** 导入前从目标库捕获的 OSS 配置（OSS 目标时使用，否则忽略）。 */
  preservedOss: OssSettingsFields | null;
  objectSource: ObjectSourceMode;
  state: (
    phase: string,
    extra?: Parameters<typeof writeJobState>[2],
  ) => Promise<void>;
}): Promise<{
  failed: number;
  missing: number;
  migrated: number;
  skipped: number;
}> {
  const {
    prisma,
    packageDir,
    manifest,
    concurrency,
    targetBackend,
    preservedOss,
    objectSource,
    state,
  } = options;
  const refs = await collectObjectRefs(prisma);
  const refsByKey = new Map<string, ObjectRef>(
    refs.map((ref) => [ref.storageKey, ref]),
  );
  const target = await createTargetActiveBackend(
    prisma,
    targetBackend,
    preservedOss,
  );
  const summary: ObjectTransferSummary = newSummary();
  summary.total = manifest.objects.length;

  // pull-r2：从源 R2 直拉，需源 R2 一次性凭据（SOURCE_R2_* 或应用自身 R2_*）。
  let pullSource: ReturnType<typeof sourceR2Backend> = null;
  if (objectSource === "pull-r2") {
    pullSource = sourceR2Backend();
    if (!pullSource) {
      throw new Error(
        "--pull-source-r2 需要源 R2 配置：SOURCE_R2_ACCOUNT_ID / SOURCE_R2_BUCKET / SOURCE_R2_ACCESS_KEY_ID / SOURCE_R2_SECRET_ACCESS_KEY",
      );
    }
  }

  await state("import/objects", {
    progress: {
      done: 0,
      total: summary.total,
      label:
        objectSource === "finalize"
          ? "校验并翻转 backend"
          : objectSource === "pull-r2"
            ? "从源 R2 直拉"
            : `写入 ${target.name}`,
    },
  });

  const failures: string[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < manifest.objects.length) {
      const index = cursor;
      cursor += 1;
      const obj = manifest.objects[index];
      if (!obj) continue;
      const label = `${obj.kind}:${obj.storageKey}`;

      const ref = refsByKey.get(obj.storageKey);
      if (!ref) {
        failures.push(`${label} 在目标库中找不到对应记录`);
        summary.failed += 1;
        summary.missing += 1;
        await reportProgress(state, summary, index);
        continue;
      }

      // finalize：对象已由源服务器直推到目标后端，只做 stat 校验 + 翻转。
      if (objectSource === "finalize") {
        try {
          const statResult = await target.backend.statObject(obj.storageKey);
          if (statResult.size !== obj.sizeBytes) {
            failures.push(
              `${label} 目标对象大小不符：期望 ${obj.sizeBytes} 实际 ${statResult.size}`,
            );
            summary.failed += 1;
            await reportProgress(state, summary, index);
            continue;
          }
        } catch (caught) {
          failures.push(`${label} 目标对象缺失：${messageOf(caught)}`);
          summary.failed += 1;
          await reportProgress(state, summary, index);
          continue;
        }
        try {
          await flipBackend(prisma, ref, target.name);
        } catch (caught) {
          failures.push(`${label} 翻转 backend 失败：${messageOf(caught)}`);
          summary.failed += 1;
          await reportProgress(state, summary, index);
          continue;
        }
        summary.skipped += 1;
        await reportProgress(state, summary, index);
        continue;
      }

      // pull-r2：从源 R2 直拉进目标后端；已存在且大小一致则跳过。
      if (objectSource === "pull-r2") {
        try {
          const outcome = await transferObjectTo({
            source: pullSource!,
            target: target.backend,
            storageKey: obj.storageKey,
            mimeType: obj.mimeType ?? "application/octet-stream",
            expectedSize: obj.sizeBytes,
          });
          if (outcome === "migrated") {
            summary.migrated += 1;
            summary.totalBytes += obj.sizeBytes;
          } else {
            summary.skipped += 1;
          }
        } catch (caught) {
          failures.push(`${label} 直拉失败：${messageOf(caught)}`);
          summary.failed += 1;
          await reportProgress(state, summary, index);
          continue;
        }
        try {
          await flipBackend(prisma, ref, target.name);
        } catch (caught) {
          failures.push(`${label} 翻转 backend 失败：${messageOf(caught)}`);
          summary.failed += 1;
          await reportProgress(state, summary, index);
          continue;
        }
        await reportProgress(state, summary, index);
        continue;
      }

      // package（默认）：对象在包内 objects/。
      if (obj.path === null) {
        failures.push(
          `${label} 包内不含对象，请改用 --finalize-objects（目标端已直推）或 --pull-source-r2（从源 R2 直拉）`,
        );
        summary.failed += 1;
        await reportProgress(state, summary, index);
        continue;
      }

      // 幂等：目标已存在且大小一致则跳过（复用 migrateOne 逻辑）。
      try {
        const existing = await target.backend.statObject(obj.storageKey);
        if (existing.size === obj.sizeBytes) {
          await flipBackend(prisma, ref, target.name).catch((caught) => {
            failures.push(`${label} 翻转 backend 失败：${messageOf(caught)}`);
          });
          summary.skipped += 1;
          await reportProgress(state, summary, index);
          continue;
        }
      } catch {
        // 目标不存在，继续写入。
      }

      const filePath = path.join(packageDir, obj.path);
      // 上传前校验包内文件 sha256 与 manifest 一致，等长内容损坏可检出。
      // 仅在 sha256 非空时校验（push/no-objects 模式的 manifest 记录空串，
      // 走 finalize/pull-r2 分支，不经过此处）。
      if (obj.sha256) {
        const actualSha = await sha256File(filePath).catch(() => "");
        if (actualSha !== obj.sha256) {
          failures.push(
            `${label} 包内文件校验失败（sha256 与 manifest 不一致）`,
          );
          summary.failed += 1;
          await reportProgress(state, summary, index);
          continue;
        }
      }
      try {
        await target.backend.putObject(
          obj.storageKey,
          createReadStream(filePath),
          obj.mimeType ?? "application/octet-stream",
          obj.sizeBytes,
        );
      } catch (caught) {
        failures.push(`${label} 写入目标存储失败：${messageOf(caught)}`);
        summary.failed += 1;
        await reportProgress(state, summary, index);
        continue;
      }

      // 单对象校验成功后翻转。
      try {
        const statResult = await target.backend.statObject(obj.storageKey);
        if (statResult.size !== obj.sizeBytes) {
          failures.push(
            `${label} 大小不符：期望 ${obj.sizeBytes} 实际 ${statResult.size}`,
          );
          summary.failed += 1;
          await reportProgress(state, summary, index);
          continue;
        }
      } catch (caught) {
        failures.push(`${label} 校验失败：${messageOf(caught)}`);
        summary.failed += 1;
        await reportProgress(state, summary, index);
        continue;
      }

      try {
        await flipBackend(prisma, ref, target.name);
      } catch (caught) {
        failures.push(`${label} 翻转 backend 失败：${messageOf(caught)}`);
        summary.failed += 1;
        await reportProgress(state, summary, index);
        continue;
      }
      summary.migrated += 1;
      summary.totalBytes += obj.sizeBytes;
      await reportProgress(state, summary, index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    failed: failures.length,
    missing: summary.missing,
    migrated: summary.migrated,
    skipped: summary.skipped,
  };
}

async function reportProgress(
  state: (
    phase: string,
    extra?: Parameters<typeof writeJobState>[2],
  ) => Promise<void>,
  summary: ObjectTransferSummary,
  index: number,
) {
  if ((index + 1) % 10 === 0 || index + 1 === summary.total) {
    await state("import/objects", {
      progress: { done: index + 1, total: summary.total },
    });
  }
}

function flipBackend(
  prisma: PrismaClient,
  ref: ObjectRef,
  targetBackendName: string,
) {
  return ref.updateBackend(prisma, targetBackendName as ObjectRef["backend"]);
}

// --- 主流程 -----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = migrationDataDir();
  const jobsDir = path.join(dataDir, "jobs");
  const maintenanceFile = path.join(dataDir, "maintenance.json");

  const state = async (
    phase: string,
    extra?: Parameters<typeof writeJobState>[2],
  ) => {
    await writeJobState(jobsDir, args.jobId, { phase, ...extra });
  };

  await state("import/prepare", {
    kind: "import",
    status: "running",
    startedAt: new Date().toISOString(),
  });

  let packageInfo: { packageDir: string; cleanup: () => Promise<void> } | null =
    null;
  let prisma: PrismaClient | null = null;
  // 目标库是否已被改动（DROP SCHEMA 之后）。中途失败时保持维护模式，防止
  // 用户对半导入的目标库写入。
  let targetMutated = false;
  // 本次任务开启维护模式前，维护是否已处于开启状态（finally 只关闭自己开的）。
  let preExistingMaintenance = false;

  try {
    packageInfo = await resolvePackageDir(args.source, dataDir, args.jobId);
    const packageDir = packageInfo.packageDir;
    const manifest = await loadManifest(packageDir);

    // §7.1 前置校验（全部 fail-closed）
    const expectedConfirm =
      process.env.MIGRATION_IMPORT_CONFIRM_PHRASE?.trim() ||
      DEFAULT_IMPORT_CONFIRM_PHRASE;
    if (args.confirm.trim() !== expectedConfirm) {
      throw new Error("确认语不正确，已中止导入（目标库不会被改动）");
    }
    const targetVersion = appVersion();
    if (manifest.appVersion !== targetVersion) {
      throw new Error(
        `迁移包应用版本 ${manifest.appVersion} 与目标版本 ${targetVersion} 不一致。` +
          `请把其中一侧升级到同版本后重新导出，或对 database.dump 执行 ` +
          `docs/migrate-data-to-vercel-r2.md §4 的离线升级流程后重新打包。`,
      );
    }
    const dumpFile = path.join(packageDir, "database.dump");
    const actualDumpSha = await sha256File(dumpFile);
    if (actualDumpSha !== manifest.dumpSha256) {
      throw new Error(
        "database.dump 校验失败（sha256 与 manifest 不一致），拒绝导入",
      );
    }
    await normalizeAndValidateMigrationHistory(manifest);
    await validateDumpHasNoExcludedData(dumpFile);
    for (const obj of manifest.objects) await validateManifestPath(obj);

    // 目标后端解析 + OSS 凭据捕获必须在任何目标库改动之前完成：
    // OSS 凭据存在会被清空的 StorageSettings 里，只能 DROP 前捕获；
    // 后端支持性校验也必须在清库前 fail-closed（否则库被清空后才报错）。
    const dbUrl = databaseUrlForTools();
    const earlyPrisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });
    let targetStorage: TargetStorageFields | null = null;
    try {
      targetStorage = await earlyPrisma.storageSettings.findFirst();
    } catch (caught) {
      throw new Error(
        `读取目标存储配置失败（目标库不可用？）：${messageOf(caught)}`,
      );
    } finally {
      await earlyPrisma.$disconnect().catch(() => undefined);
    }
    const targetBackend = (args.targetBackend ??
      targetStorage?.backend ??
      "minio") as "minio" | "oss" | "r2";
    const preservedOss: OssSettingsFields | null = targetStorage
      ? {
          ossRegion: targetStorage.ossRegion,
          ossBucket: targetStorage.ossBucket,
          ossEndpoint: targetStorage.ossEndpoint,
          ossInternal: targetStorage.ossInternal,
          ossInternalEndpoint: targetStorage.ossInternalEndpoint,
          ossAccessKeyId: targetStorage.ossAccessKeyId,
          ossAccessKeySecret: targetStorage.ossAccessKeySecret,
        }
      : null;
    if (targetBackend === "oss" && !ossFromSettings(preservedOss)) {
      throw new Error(
        "目标后端为 OSS，但目标尚未配置有效 OSS 凭据（请在目标部署的管理端配置 OSS 存储后重试）",
      );
    }
    if (targetBackend === "r2" && !targetR2Backend()) {
      throw new Error(
        "目标后端为 R2，但缺少 R2 环境变量配置（TARGET_R2_* 或 R2_*）",
      );
    }

    // 维护模式：仅当任务本身开启时才记录 preExisting，finally 只关闭自己开的，
    // 不覆盖管理员手动开启的维护窗口。
    preExistingMaintenance = args.ensureMaintenance
      ? (await readMaintenanceStateFile(maintenanceFile)).enabled
      : false;
    if (args.ensureMaintenance && !preExistingMaintenance) {
      await writeMaintenanceStateFile(maintenanceFile, {
        enabled: true,
        reason: "数据导入中",
        updatedAt: new Date().toISOString(),
        updatedBy: "migration-import",
      });
    }

    // §7.2 腾空 + 还原
    await dropSchema(dbUrl, state);
    // DROP 成功即视为目标库已被改动：此后任何失败都必须保持维护模式。
    targetMutated = true;
    await restoreFromDump(dbUrl, dumpFile, state);

    // §7.3 逐条 resolve 迁移历史
    await resolveAllMigrations(manifest, dbUrl, state);

    // §7.5 抹除密钥（还原后第一步）；backend 强制改回目标后端
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await state("import/wipe-secrets");
    await wipeSecrets(prisma, targetBackend, preservedOss);

    // §7.6 对象导入 + 翻转（来源模式由 --finalize-objects / --pull-source-r2 决定）
    const objectResult = await importObjects({
      prisma,
      packageDir,
      manifest,
      concurrency: args.concurrency,
      targetBackend,
      preservedOss,
      objectSource: args.objectSource,
      state,
    });
    if (objectResult.failed > 0) {
      throw new Error(
        `${objectResult.failed} 个对象导入失败，目标处于部分导入状态，禁止上线。` +
          `请排查后重新导入（已校验成功的对象会自动跳过）。`,
      );
    }

    // §7.7 导入后校验
    const target = await createTargetActiveBackend(
      prisma,
      targetBackend,
      preservedOss,
    );
    const verifyResult = await verifyImport({
      prisma,
      manifest,
      targetBackend: target.backend,
      targetBackendName: target.name,
    });
    for (const line of formatVerifyResult(verifyResult)) console.log(line);
    if (verifyResult.blocking) {
      throw new Error("导入后校验未通过，禁止上线");
    }

    await state("done", {
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      packageName: path.basename(args.source),
      progress: {
        done: objectResult.migrated,
        total: manifest.objects.length,
        label: "完成",
      },
    });
    console.log(
      `[import] 完成：对象导入 ${objectResult.migrated}，跳过 ${objectResult.skipped}，` +
        `目标后端 ${target.name}。`,
    );
  } catch (caught) {
    const message = messageOf(caught);
    console.error(`[import] 失败：${message}`);
    await state("failed", {
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
    await packageInfo?.cleanup().catch(() => undefined);
    // 只关闭任务自身开启的维护模式；管理员预先手动开启的维护窗口保持原状。
    if (args.ensureMaintenance && !preExistingMaintenance) {
      // process.exitCode 初始为 undefined，须归一化后再判断非零。
      if (targetMutated && (process.exitCode ?? 0) !== 0) {
        console.warn(
          "[import] 目标库已被改动且导入未成功，保持维护模式。请排查后重试导入，或确认后手动关闭维护模式。",
        );
      } else {
        await writeMaintenanceStateFile(maintenanceFile, MAINTENANCE_OFF).catch(
          () => undefined,
        );
      }
    }
  }
}

main().catch((caught) => {
  console.error(`[import] 执行失败：${messageOf(caught)}`);
  process.exitCode = 1;
});
