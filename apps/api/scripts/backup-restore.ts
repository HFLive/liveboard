/**
 * 回滚执行器（self_hosted）：把某个备份恢复为当前站点状态。
 *
 * 执行顺序：
 *   前置校验（fail-closed）→ 维护模式 → DROP SCHEMA → pg_restore 还原 →
 *   prisma migrate deploy（备份点之后应用升级过则补齐 schema）→
 *   可选对象回拷（按还原后 DB 引用的存储后端放回备份点对象）→ 校验 → 关维护。
 *
 * 与迁移导入的差异：
 *   - 同环境回滚：不需要捕获 OSS 凭据、不需要抹除密钥（AI_ENCRYPTION_KEY
 *     在 .env 中保持不变），对象回拷按还原后每个记录的 storageBackend 选后端。
 *   - 备份 dump 保留了 `_prisma_migrations`，还原后迁移历史与备份点一致；
 *     备份点之后的新迁移由 migrate deploy 补齐。
 *
 * 用法：
 *   tsx scripts/backup-restore.ts --job-id <id> --backup <backupId> \
 *     --confirm <确认语> [--include-objects|--no-objects] [--concurrency 4]
 *
 * - 回滚前必须先完成保护备份（由 API 侧 startRestore 链保证），本脚本只恢复。
 * - 任一步失败立即终止：DROP SCHEMA 之后（targetMutated）保持维护模式，
 *   不把已清空/半还原的库当作正常状态暴露给写流量。
 * - 状态文件写到 <数据目录>/backup-jobs/<id>.json（kind=restore）。
 */
import { PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  collectObjectRefs,
  messageOf,
  type ObjectRef,
} from "../src/modules/migration/migration-engine";
import { writeJobState } from "../src/modules/migration/migration-job-file";
import {
  MAINTENANCE_OFF,
  readMaintenanceStateFile,
  writeMaintenanceStateFile,
} from "../src/modules/migration/maintenance-file";
import { BACKUP_FORMAT_VERSION } from "../src/modules/backup/backup-format";
import {
  backupContentDir,
  ensureBackupDirs,
  type BackupDataPaths,
} from "../src/modules/backup/backup-dirs";
import {
  appVersion,
  databaseUrlForTools,
  parsePostgresUrl,
  pgConnectionArgs,
  prismaCliPath,
  runPgTool,
} from "./migrate-cli";
import { createSourceBackends } from "./migrate-backends";
import { BACKUP_EXCLUDED_TABLES } from "../src/modules/backup/backup-tables";

const DEFAULT_CONFIRM_PHRASE = "CONFIRM-RESTORE";

interface BackupManifest {
  formatVersion: number;
  appVersion?: string;
  exportedAt?: string;
  kind?: string;
  dumpSha256?: string;
  tables: Record<string, number>;
  objects: Array<{
    kind: string;
    storageKey: string;
    path: string | null;
    sizeBytes: number;
    sha256?: string;
    mimeType: string | null;
  }>;
}

interface Args {
  jobId: string;
  backupId: string;
  confirm: string;
  includeObjects: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    jobId: "",
    backupId: "",
    confirm: "",
    includeObjects: true,
    concurrency: 4,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job-id") args.jobId = argv[++index] ?? "";
    else if (arg === "--backup") args.backupId = argv[++index] ?? "";
    else if (arg === "--confirm") args.confirm = argv[++index] ?? "";
    else if (arg === "--concurrency") {
      const value = Number(argv[++index] ?? 4);
      args.concurrency = Number.isFinite(value)
        ? Math.max(1, Math.min(16, Math.trunc(value)))
        : 4;
    } else if (arg === "--include-objects") args.includeObjects = true;
    else if (arg === "--no-objects") args.includeObjects = false;
  }
  if (!args.jobId) throw new Error("缺少 --job-id");
  if (!args.backupId) throw new Error("缺少 --backup");
  return args;
}

function pickBackend(
  backends: Awaited<ReturnType<typeof createSourceBackends>>,
  backendName: ObjectRef["backend"],
):
  | Awaited<ReturnType<typeof createSourceBackends>>[keyof Awaited<
      ReturnType<typeof createSourceBackends>
    >]
  | null {
  if (backendName === "oss") return backends.oss;
  if (backendName === "r2") return backends.r2;
  return backends.minio;
}

type StateFn = (
  phase: string,
  extra?: Parameters<typeof writeJobState>[2],
) => Promise<unknown>;

async function dropSchema(dbUrl: string, state: StateFn): Promise<void> {
  const conn = parsePostgresUrl(dbUrl);
  await state("restore/drop-schema");
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
  if (psqlStatus !== 0) throw new Error(`腾空数据库失败（exit=${psqlStatus}）`);
}

/** 还原 database.dump。--single-transaction：失败整体回滚，库停在空 schema。 */
async function restoreFromDump(
  dbUrl: string,
  dumpFile: string,
  state: StateFn,
): Promise<void> {
  const conn = parsePostgresUrl(dbUrl);
  await state("restore/restore");
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

/**
 * 备份点之后应用升级过则补齐 schema：migrate deploy 对比 prisma/migrations
 * 目录与还原后的 _prisma_migrations，执行备份点之后的新迁移。失败必须保持
 * 维护模式并 fail 任务——不允许半 schema 状态暴露。
 */
async function migrateDeploy(dbUrl: string, state: StateFn): Promise<void> {
  await state("restore/migrate-deploy");
  const schema = path.join(__dirname, "..", "prisma", "schema.prisma");
  const result = spawnSync(
    process.execPath,
    [prismaCliPath(), "migrate", "deploy", "--schema", schema],
    {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(`无法启动 prisma migrate deploy: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`prisma migrate deploy 失败（exit=${result.status}）`);
  }
}

/** 对象回拷：按还原后 DB 引用的后端，把备份里的对象放回原 key。 */
async function restoreObjects(options: {
  prisma: PrismaClient;
  contentDir: string;
  manifest: BackupManifest;
  concurrency: number;
  state: StateFn;
}): Promise<{ failed: number; restored: number }> {
  const { prisma, contentDir, manifest, concurrency, state } = options;
  const refs = await collectObjectRefs(prisma);
  const refByKey = new Map<string, ObjectRef>(
    refs.map((ref) => [ref.storageKey, ref]),
  );
  const backends = await createSourceBackends(prisma);
  const targets = manifest.objects.filter((obj) => obj.path);
  await state("restore/objects", {
    progress: { done: 0, total: targets.length, label: "回拷对象" },
  });

  let cursor = 0;
  let failed = 0;
  let restored = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const obj = targets[index];
      if (!obj) continue;
      try {
        const localPath = path.join(contentDir, obj.path!);
        const ref = refByKey.get(obj.storageKey);
        const backend = ref ? pickBackend(backends, ref.backend) : null;
        if (!backend) {
          // 还原后 DB 不再引用该对象（备份点之后记录被删）或后端未配置：
          // 不阻断数据库还原，仅记日志。
          console.warn(
            `[restore] SKIP ${obj.storageKey}（还原后无引用或后端不可用）`,
          );
          failed += 1;
          continue;
        }
        // 幂等续传：目标已存在且大小一致则跳过（重跑安全）。
        const existing = await backend
          .statObject(obj.storageKey)
          .catch(() => null);
        if (existing && existing.size === obj.sizeBytes) continue;
        await backend.putObject(
          obj.storageKey,
          createReadStream(localPath),
          obj.mimeType ?? "application/octet-stream",
          obj.sizeBytes,
        );
        restored += 1;
      } catch (caught) {
        console.warn(
          `[restore] 回拷失败 ${obj.storageKey}: ${messageOf(caught)}`,
        );
        failed += 1;
      }
      if ((index + 1) % 10 === 0 || index + 1 === targets.length) {
        await state("restore/objects", {
          progress: { done: index + 1, total: targets.length },
        });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { failed, restored };
}

/** 行数对账：manifest 里记录的每张表（排除 _prisma_migrations，可能被 deploy 补行）。 */
async function verifyTables(
  prisma: PrismaClient,
  manifest: BackupManifest,
): Promise<{ mismatches: string[] }> {
  const mismatches: string[] = [];
  for (const [table, expected] of Object.entries(manifest.tables)) {
    if (table === "_prisma_migrations") continue;
    const result = (await prisma
      .$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "public"."${table}"`)
      .catch(() => null)) as Array<{ count: number }> | null;
    const actual = Number(result?.[0]?.count ?? -1);
    if (actual !== expected) {
      mismatches.push(`${table} 期望=${expected} 实际=${actual}`);
    }
  }
  return { mismatches };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = process.env.MIGRATION_DATA_DIR?.trim() || "/data/migration";
  const paths: BackupDataPaths = {
    dataDir,
    backupsDir: path.join(dataDir, "backups"),
    backupJobsDir: path.join(dataDir, "backup-jobs"),
  };
  if (!ensureBackupDirs(paths)) {
    throw new Error("无法创建备份数据目录（MIGRATION_DATA_DIR 未挂载）");
  }
  const contentDir = backupContentDir(paths, args.backupId);
  const jobsDir = paths.backupJobsDir;
  const maintenanceFile = path.join(dataDir, "maintenance.json");

  const state = (phase: string, extra?: Parameters<typeof writeJobState>[2]) =>
    writeJobState(jobsDir, args.jobId, { phase, ...extra });

  // 前置校验（fail-closed）：确认语、备份目录、manifest 完整性。
  const expectedConfirm =
    process.env.BACKUP_RESTORE_CONFIRM_PHRASE?.trim() || DEFAULT_CONFIRM_PHRASE;
  if (args.confirm.trim() !== expectedConfirm) {
    throw new Error(`确认语不正确：请输入 ${expectedConfirm}`);
  }
  const manifestRaw = await readFile(
    path.join(contentDir, "manifest.json"),
    "utf8",
  ).catch(() => null);
  if (!manifestRaw) {
    throw new Error(`备份 #${args.backupId} 缺少 manifest.json，拒绝回滚`);
  }
  const manifest = JSON.parse(manifestRaw) as BackupManifest;
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `备份格式版本不兼容（${manifest.formatVersion} != ${BACKUP_FORMAT_VERSION}），拒绝回滚`,
    );
  }
  const dumpFile = path.join(contentDir, "database.dump");
  await readFile(dumpFile).catch(() => {
    throw new Error(`备份 #${args.backupId} 缺少 database.dump，拒绝回滚`);
  });

  await state("prepare", {
    kind: "restore",
    status: "running",
    startedAt: new Date().toISOString(),
    includeObjects: args.includeObjects,
    restoreFromId: args.backupId,
  });

  // 仅当任务开启维护时才记录 preExisting，finally 只关闭自己开的。
  const preExistingMaintenance = (
    await readMaintenanceStateFile(maintenanceFile)
  ).enabled;
  if (!preExistingMaintenance) {
    await writeMaintenanceStateFile(maintenanceFile, {
      enabled: true,
      reason: "从备份回滚中",
      updatedAt: new Date().toISOString(),
      updatedBy: "backup-restore",
    });
  }

  // 目标库是否已被改动（DROP SCHEMA 之后）。中途失败时保持维护模式。
  let targetMutated = false;
  let prisma: PrismaClient | null = null;
  try {
    const dbUrl = databaseUrlForTools();
    await dropSchema(dbUrl, state);
    targetMutated = true;
    await restoreFromDump(dbUrl, dumpFile, state);
    await migrateDeploy(dbUrl, state);

    prisma = new PrismaClient();
    if (args.includeObjects && manifest.objects.some((obj) => obj.path)) {
      const result = await restoreObjects({
        prisma,
        contentDir,
        manifest,
        concurrency: args.concurrency,
        state,
      });
      if (result.failed > 0) {
        // 对象回拷失败不阻断数据库还原，但记入 error 供界面提示。
        console.warn(
          `[restore] ${result.failed} 个对象回拷失败，数据库已还原（可稍后重跑回拷或手动检查）`,
        );
      }
    }

    await state("restore/verify");
    const { mismatches } = await verifyTables(prisma, manifest);
    const superAdmin = await prisma.user.findFirst({
      where: { systemRole: "super_admin", status: "active" },
      select: { username: true },
    });
    if (mismatches.length > 0) {
      throw new Error(`还原后行数对账失败：${mismatches.join("；")}`);
    }
    if (!superAdmin) {
      throw new Error(
        "还原后没有正常状态的最高管理员，拒绝完成（fail-closed）",
      );
    }

    await state("done", {
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      manifest: manifest as never,
      progress: {
        done: manifest.objects.length,
        total: manifest.objects.length,
        label: "完成",
      },
    });
    console.log(
      `[restore] 完成：从备份 #${args.backupId} 恢复（应用版本 ${appVersion()}）`,
    );
  } catch (caught) {
    const message = messageOf(caught);
    console.error(`[restore] 失败：${message}`);
    if (targetMutated) {
      // 已改动目标库：保持维护模式，不允许半还原状态暴露给写流量。
      console.error("[restore] 数据库已被改动，保持维护模式，请人工检查后处理");
    }
    await state("failed", {
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
    // 只关闭任务自身开启的维护模式；管理员预先手动开启的维护窗口保持原状。
    if (!preExistingMaintenance) {
      // process.exitCode 初始为 undefined，须归一化后再判断非零。
      if (targetMutated && (process.exitCode ?? 0) !== 0) {
        console.warn(
          "[restore] 目标库已被改动且回滚未成功，保持维护模式。请排查后重试回滚，或确认后手动关闭维护模式。",
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
  console.error(`[restore] 执行失败：${messageOf(caught)}`);
  process.exitCode = 1;
});
