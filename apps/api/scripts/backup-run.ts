/**
 * 备份执行器（self_hosted）：把 PostgreSQL 快照与可选的文件对象写入备份目录。
 *
 * 备份目录：`<数据目录>/backups/<jobId>/`，含 database.dump + objects/ + manifest.json。
 * 与迁移导出的差异：
 *   - 备份必须保留 `_prisma_migrations` 数据（同库回滚后迁移历史一致）；
 *     仅排除 PendingUpload（短期上传预留）与 ServerMetricSample（宿主指标）。
 *   - 备份纯只读，不开维护模式。
 *   - 保留策略（份数限额）由 API 侧 BackupService 在任务成功后执行。
 *
 * 用法：
 *   tsx scripts/backup-run.ts --job-id <id> --kind auto|manual \
 *     [--include-objects|--no-objects] [--concurrency 4]
 *
 * - 可中断重跑：已写入且大小一致的 dump/对象自动跳过（续传）。
 * - 状态文件写到 <数据目录>/backup-jobs/<id>.json（与迁移的 jobs/ 隔离）。
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  collectObjectRefs,
  messageOf,
  type ObjectRef,
} from "../src/modules/migration/migration-engine";
import { writeJobState } from "../src/modules/migration/migration-job-file";
import { backupExcludeTableDataArgs } from "../src/modules/backup/backup-tables";
import {
  backupContentDir,
  ensureBackupDirs,
  type BackupDataPaths,
} from "../src/modules/backup/backup-dirs";
import { BACKUP_EXCLUDED_TABLES } from "../src/modules/backup/backup-tables";
import { BACKUP_FORMAT_VERSION } from "../src/modules/backup/backup-format";
import {
  parsePostgresUrl,
  pgConnectionArgs,
  runPgTool,
  databaseUrlForTools,
  appVersion,
} from "./migrate-cli";
import { createSourceBackends } from "./migrate-backends";

interface Args {
  jobId: string;
  kind: "auto" | "manual";
  includeObjects: boolean;
  concurrency: number;
  /** 回滚前自动创建的保护备份标记（UI 显示「回滚前自动备份」）。 */
  protect: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    jobId: "",
    kind: "manual",
    includeObjects: true,
    concurrency: 4,
    protect: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job-id") args.jobId = argv[++index] ?? "";
    else if (arg === "--kind") {
      const value = argv[++index] ?? "manual";
      args.kind = value === "auto" ? "auto" : "manual";
    } else if (arg === "--concurrency") {
      const value = Number(argv[++index] ?? 4);
      args.concurrency = Number.isFinite(value)
        ? Math.max(1, Math.min(16, Math.trunc(value)))
        : 4;
    } else if (arg === "--include-objects") args.includeObjects = true;
    else if (arg === "--no-objects") args.includeObjects = false;
    else if (arg === "--protect") args.protect = true;
  }
  if (!args.jobId) throw new Error("缺少 --job-id");
  return args;
}

function sanitizeObjectName(storageKey: string): string {
  const base = storageKey.split("/").pop() ?? "object";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+/, "");
  return cleaned || "object";
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function pickSourceBackend(
  source: Awaited<ReturnType<typeof createSourceBackends>>,
  backendName: ObjectRef["backend"],
):
  | Awaited<ReturnType<typeof createSourceBackends>>[keyof Awaited<
      ReturnType<typeof createSourceBackends>
    >]
  | null {
  if (backendName === "oss") return source.oss;
  if (backendName === "r2") return source.r2;
  return source.minio;
}

async function statRef(
  backend: Awaited<ReturnType<typeof createSourceBackends>>[keyof Awaited<
    ReturnType<typeof createSourceBackends>
  >],
  key: string,
): Promise<{ size: number } | null> {
  if (!backend) return null;
  try {
    return await backend.statObject(key);
  } catch {
    return null;
  }
}

/**
 * 把对象流式写入备份目录并计算 sha256。可恢复执行：目标已存在且大小一致时
 * 只重算 sha256，不重新下载。
 */
async function packageObjectIntoFile(
  backend: Awaited<ReturnType<typeof createSourceBackends>>[keyof Awaited<
    ReturnType<typeof createSourceBackends>
  >],
  storageKey: string,
  destPath: string,
  knownSize: number,
): Promise<{ sizeBytes: number; sha256: string }> {
  try {
    const existing = await stat(destPath);
    if (existing.size === knownSize) {
      const sha256 = await sha256File(destPath);
      return { sizeBytes: knownSize, sha256 };
    }
  } catch {
    // 目标不存在或不完整，重新写入。
  }
  if (!backend) throw new Error("源后端不可用");
  const stream = await backend.getObject(storageKey);
  await pipeline(stream, createWriteStream(destPath, { mode: 0o600 }));
  const sha256 = await sha256File(destPath);
  return { sizeBytes: knownSize, sha256 };
}

async function collectTableCounts(
  prisma: PrismaClient,
): Promise<Record<string, number>> {
  const tables = (await prisma.$queryRaw<
    Array<{ table_name: string }>
  >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`) as Array<{
    table_name: string;
  }>;
  const counts: Record<string, number> = {};
  for (const row of tables) {
    if (BACKUP_EXCLUDED_TABLES.includes(row.table_name as never)) continue;
    const result = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "public"."${row.table_name}"`,
    )) as Array<{ count: number }>;
    counts[row.table_name] = Number(result[0]?.count ?? 0);
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // 脚本直接读环境变量（与 migrate-cli.ts 的 migrationDataDir() 同约定），
  // 不依赖 NestJS 容器。
  const dataDir = process.env.MIGRATION_DATA_DIR?.trim() || "/data/migration";
  const paths: BackupDataPaths = {
    dataDir,
    backupsDir: path.join(dataDir, "backups"),
    backupJobsDir: path.join(dataDir, "backup-jobs"),
  };
  if (!ensureBackupDirs(paths)) {
    throw new Error("无法创建备份数据目录（MIGRATION_DATA_DIR 未挂载）");
  }
  const contentDir = backupContentDir(paths, args.jobId);
  const jobsDir = paths.backupJobsDir;
  const kind = args.kind === "auto" ? "auto_backup" : "manual_backup";

  const state = (phase: string, extra?: Parameters<typeof writeJobState>[2]) =>
    writeJobState(jobsDir, args.jobId, { phase, ...extra });

  await state("prepare", {
    kind,
    status: "running",
    startedAt: new Date().toISOString(),
    includeObjects: args.includeObjects,
    ...(args.protect ? { isProtection: true } : {}),
  });

  let prisma: PrismaClient | null = null;
  try {
    await mkdir(path.join(contentDir, "objects"), {
      recursive: true,
      mode: 0o700,
    });
    prisma = new PrismaClient();

    const tables = await collectTableCounts(prisma);

    await state("dump");
    const dbUrl = databaseUrlForTools();
    const conn = parsePostgresUrl(dbUrl);
    const dumpFile = path.join(contentDir, "database.dump");
    const dumpStatus = runPgTool(
      "pg_dump",
      [
        ...pgConnectionArgs(conn),
        "-d",
        conn.database,
        "-Fc",
        // 混合大小写表名必须带引号：pg_dump 的模式不带引号会被折叠为小写。
        ...backupExcludeTableDataArgs(),
        "-f",
        dumpFile,
      ],
      dbUrl,
    );
    if (dumpStatus !== 0) throw new Error(`pg_dump 失败（exit=${dumpStatus}）`);
    const dumpSha256 = await sha256File(dumpFile);

    // 对象清单 = 按 DB 引用枚举全部非空存储对象；includeObjects 时复制进包。
    const backends = await createSourceBackends(prisma);
    const refs = await collectObjectRefs(prisma);
    const objectNames = refs.map((ref, index) => ({
      ref,
      name: `${String(index + 1).padStart(4, "0")}-${sanitizeObjectName(ref.storageKey)}`,
    }));

    const objects: Array<{
      kind: ObjectRef["kind"];
      storageKey: string;
      path: string | null;
      sizeBytes: number;
      sha256: string;
      mimeType: string | null;
    }> = [];
    if (args.includeObjects) {
      await state("objects", {
        progress: { done: 0, total: refs.length, label: "收集对象" },
      });
      let cursor = 0;
      let missing = 0;
      const results: Array<{
        kind: ObjectRef["kind"];
        storageKey: string;
        path: string | null;
        sizeBytes: number;
        sha256: string;
        mimeType: string | null;
      } | null> = new Array(objectNames.length);
      const worker = async () => {
        while (cursor < objectNames.length) {
          const index = cursor;
          cursor += 1;
          const item = objectNames[index];
          if (!item) continue;
          const backend = pickSourceBackend(backends, item.ref.backend);
          if (!backend) {
            console.warn(
              `[backup] MISSING ${item.ref.kind}:${item.ref.recordKey}（${item.ref.backend} 后端未配置）`,
            );
            missing += 1;
            continue;
          }
          const statResult = await statRef(backend, item.ref.storageKey);
          if (!statResult) {
            console.warn(
              `[backup] MISSING ${item.ref.kind}:${item.ref.recordKey}（源对象不存在 ${item.ref.storageKey}）`,
            );
            missing += 1;
            continue;
          }
          const destPath = path.join(contentDir, "objects", item.name);
          const packaged = await packageObjectIntoFile(
            backend,
            item.ref.storageKey,
            destPath,
            statResult.size,
          );
          results[index] = {
            kind: item.ref.kind,
            storageKey: item.ref.storageKey,
            path: `objects/${item.name}`,
            sizeBytes: packaged.sizeBytes,
            sha256: packaged.sha256,
            mimeType: item.ref.mimeType,
          };
          if ((index + 1) % 10 === 0 || index + 1 === objectNames.length) {
            await state("objects", {
              progress: { done: index + 1, total: objectNames.length },
            });
          }
        }
      };
      await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
      if (missing > 0) {
        throw new Error(
          `备份期间 ${missing} 个源对象缺失，备份不完整，拒绝完成（fail-closed）`,
        );
      }
      objects.push(
        ...(results.filter(Boolean) as Array<{
          kind: ObjectRef["kind"];
          storageKey: string;
          path: string | null;
          sizeBytes: number;
          sha256: string;
          mimeType: string | null;
        }>),
      );
    }

    const manifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: appVersion(),
      exportedAt: new Date().toISOString(),
      kind: args.kind,
      dumpSha256,
      tables,
      objects,
    };

    await writeFile(
      path.join(contentDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const dumpSize = (await stat(dumpFile)).size;

    await state("done", {
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      progress: { done: objects.length, total: objects.length, label: "完成" },
      manifest: manifest as never,
      ...(args.protect ? { isProtection: true } : {}),
    });
    console.log(
      `[backup] 完成：${args.jobId}（dump ${dumpSize} B，对象 ${objects.length}）`,
    );
  } catch (caught) {
    const message = messageOf(caught);
    console.error(`[backup] 失败：${message}`);
    await state("failed", {
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((caught) => {
  console.error(`[backup] 执行失败：${messageOf(caught)}`);
  process.exitCode = 1;
});
