/**
 * 导出器：把源部署的 PostgreSQL 快照与全部对象打进迁移包。
 *
 * 迁移包为一个目录：manifest.json + database.dump + objects/，随后打包为
 * `<数据目录>/exports/liveboard-migration-<时间>.tar`。源数据库全程只读，
 * 不修改任何 storageBackend（见 docs/migrate-any-direction-design.md §3 设计规则）。
 *
 * 对象去向（互斥）：
 *   - 缺省：打进包内 objects/（server→server）。
 *   - --no-objects：不打包，manifest 只记对象大小（vercel→server / vercel→vercel，
 *     对象由目标端从源 R2 直拉）。
 *   - --push-r2：对象直推目标 R2，包内不含对象（server→vercel；目标 R2 凭据走
 *     TARGET_R2_* 一次性交接，目标端用 migrate-import --finalize-objects 收尾）。
 *
 * 用法：
 *   tsx scripts/migrate-export.ts --job-id <id> [--out <目录>] [--concurrency 4] \
 *     [--no-objects|--push-r2] [--ensure-maintenance]
 *
 * - `--ensure-maintenance`：开始前开启维护模式、结束时关闭（按钮流程传入）。
 * - 可中断重跑：已写入且大小、sha256 一致的对象自动跳过。
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import {
  collectObjectRefs,
  messageOf,
  transferObjectTo,
  type ObjectRef,
} from "../src/modules/migration/migration-engine";
import {
  BASELINE_MIGRATION,
  normalizeBundledMigrations,
} from "../src/modules/migration/migration-history";
import {
  migrationDataDir,
  parsePostgresUrl,
  pgConnectionArgs,
  runPgTool,
  databaseUrlForTools,
  appVersion,
  targetMigrationsDir,
} from "./migrate-cli";
import { createSourceBackends, targetR2Backend } from "./migrate-backends";
import { writeJobState } from "../src/modules/migration/migration-job-file";
import {
  MAINTENANCE_OFF,
  readMaintenanceStateFile,
  writeMaintenanceStateFile,
} from "../src/modules/migration/maintenance-file";
import { MIGRATION_FORMAT_VERSION } from "../src/modules/migration/migration-manifest";

const EXCLUDED_TABLES = new Set([
  "_prisma_migrations",
  "PendingUpload",
  "ServerMetricSample",
  "MigrationJob",
]);

/** 保留的最近导出包数量；旧包（含 .tar 与解包目录）会被清理，避免 exports/ 无限增长。 */
const KEEP_EXPORTS = Math.max(
  1,
  Number(process.env.MIGRATION_EXPORTS_KEEP ?? 5) || 5,
);

interface Args {
  jobId: string;
  out: string | null;
  concurrency: number;
  includeObjects: boolean;
  /** 对象直推目标 R2（server→vercel）：打进包的替代，包内 objects/ 为空。 */
  pushR2: boolean;
  ensureMaintenance: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    jobId: "",
    out: null,
    concurrency: 4,
    includeObjects: true,
    pushR2: false,
    ensureMaintenance: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job-id") args.jobId = argv[++index] ?? "";
    else if (arg === "--out") args.out = argv[++index] ?? null;
    else if (arg === "--concurrency") {
      // 非数字输入（如 --concurrency abc）→ NaN → Math.max 得 NaN → 0 worker，
      // 导出会以 0 对象"成功"。这里校验后回退默认值。
      const value = Number(argv[++index] ?? 4);
      args.concurrency = Number.isFinite(value)
        ? Math.max(1, Math.min(16, Math.trunc(value)))
        : 4;
    } else if (arg === "--no-objects") args.includeObjects = false;
    else if (arg === "--push-r2") args.pushR2 = true;
    else if (arg === "--ensure-maintenance") args.ensureMaintenance = true;
  }
  if (!args.jobId) throw new Error("缺少 --job-id");
  if (args.pushR2 && !args.includeObjects) {
    throw new Error("--push-r2 与 --no-objects 互斥");
  }
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
 * 把对象流式写入包内文件并计算 sha256。可恢复执行：目标已存在且大小一致时
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
    if (EXCLUDED_TABLES.has(row.table_name)) continue;
    const result = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "public"."${row.table_name}"`,
    )) as Array<{ count: number }>;
    counts[row.table_name] = Number(result[0]?.count ?? 0);
  }
  return counts;
}

async function collectMigrations(
  prisma: PrismaClient,
): Promise<Array<{ name: string; checksum: string }>> {
  const rows = (await prisma.$queryRaw<
    Array<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
    }>
  >`SELECT "migration_name", "checksum", "finished_at" FROM "_prisma_migrations" ORDER BY "started_at"`) as Array<{
    migration_name: string;
    checksum: string;
    finished_at: Date | null;
  }>;
  const unfinished = rows.filter((row) => !row.finished_at);
  if (unfinished.length > 0) {
    throw new Error(
      `源数据库存在未完成的 migration，拒绝导出（fail-closed）：${unfinished.map((r) => r.migration_name).join(", ")}`,
    );
  }
  // 单 baseline 收口后，过渡库的 _prisma_migrations 仍保留被 baseline 合并的旧
  // 历史记录（应用已不打包这些文件夹）。manifest 只记录应用打包的迁移，否则
  // 导入端无法逐条校验/resolve，必然 fail-closed。
  const normalized = await normalizeBundledMigrations(
    rows.map((row) => ({ name: row.migration_name, checksum: row.checksum })),
    targetMigrationsDir(),
    false,
  );
  if (normalized.skippedLegacy > 0) {
    console.log(
      `[export] 已跳过 ${normalized.skippedLegacy} 条被单 baseline 合并的旧历史记录`,
    );
  }
  if (!normalized.migrations.some((m) => m.name === BASELINE_MIGRATION)) {
    throw new Error(
      "源数据库 _prisma_migrations 缺少单 baseline 记录，无法确定收口后的迁移历史，拒绝导出（fail-closed）。",
    );
  }
  return normalized.migrations;
}

async function tarBundle(parentDir: string, bundleName: string): Promise<void> {
  // -f 输出路径用绝对路径：bsdtar 的 -f 相对进程 CWD 解析（不受 -C 影响），
  // 相对路径会把 tar 写到错误位置。
  const result = spawnSync(
    "tar",
    [
      "-C",
      parentDir,
      "-cf",
      path.join(parentDir, `${bundleName}.tar`),
      bundleName,
    ],
    {
      stdio: "inherit",
    },
  );
  if (result.error || (result.status ?? 1) !== 0) {
    // 失败必须 fail 任务：界面上会给出 .tar 下载链接，若打包缺失则下载 404
    // 而任务却显示成功。包目录仍保留在 exports/ 下，可手动搬运。
    throw new Error(
      `打包 tar 失败：${result.error?.message ?? `exit=${result.status}`}` +
        `（包目录仍保留于 ${path.join(parentDir, bundleName)}，可手动搬运）`,
    );
  }
}

/**
 * 清理旧导出包：exports/ 会随每次成功导出无限增长（含全量对象的 .tar），
 * 保留最近 keepCount 个包，删除更旧的 .tar 与其解包目录。同一 jobId 的
 * 目录与 .tar 按基名归组视为一个包（以两者中较新的 mtime 为准）。
 * 仅在打包成功后才调用——失败/中断的包目录必须保留以便断点续传。
 */
async function pruneExports(outDir: string, keepCount: number): Promise<void> {
  const entries = await readdir(outDir, { withFileTypes: true }).catch(
    () => null,
  );
  if (!entries) return;
  const newestByBase = new Map<string, number>();
  for (const entry of entries) {
    // 只清理本工具生成的导出包；同目录下管理员放入的其它 .tar 一律不动。
    const isTar =
      entry.isFile() &&
      entry.name.startsWith("liveboard-migration-") &&
      entry.name.endsWith(".tar");
    const isDir =
      entry.isDirectory() && entry.name.startsWith("liveboard-migration-");
    if (!isTar && !isDir) continue;
    const base = isTar ? entry.name.slice(0, -".tar".length) : entry.name;
    const info = await stat(path.join(outDir, entry.name)).catch(() => null);
    if (!info) continue;
    const previous = newestByBase.get(base) ?? 0;
    if (info.mtimeMs > previous) newestByBase.set(base, info.mtimeMs);
  }
  const bundles = [...newestByBase.entries()]
    .map(([base, mtime]) => ({ base, mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  const stale = bundles.slice(keepCount);
  for (const item of stale) {
    await rm(path.join(outDir, `${item.base}.tar`), { force: true }).catch(
      () => undefined,
    );
    await rm(path.join(outDir, item.base), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
  if (stale.length > 0) {
    console.log(
      `[export] 已清理 ${stale.length} 个旧导出包（保留最近 ${keepCount} 个）`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = migrationDataDir();
  const jobsDir = path.join(dataDir, "jobs");
  const maintenanceFile = path.join(dataDir, "maintenance.json");

  const state = (phase: string, extra?: Parameters<typeof writeJobState>[2]) =>
    writeJobState(jobsDir, args.jobId, { phase, ...extra });

  await state("prepare", {
    kind: "export",
    status: "running",
    startedAt: new Date().toISOString(),
  });

  // 仅当任务本身开启维护时才记录 preExisting，finally 只关闭自己开的，
  // 不覆盖管理员手动开启的维护窗口。
  const preExistingMaintenance = args.ensureMaintenance
    ? (await readMaintenanceStateFile(maintenanceFile)).enabled
    : false;
  if (args.ensureMaintenance && !preExistingMaintenance) {
    await writeMaintenanceStateFile(maintenanceFile, {
      enabled: true,
      reason: "数据导出中",
      updatedAt: new Date().toISOString(),
      updatedBy: "migration-export",
    });
  }

  let prisma: PrismaClient | null = null;
  try {
    prisma = new PrismaClient();

    const tables = await collectTableCounts(prisma);
    const migrations = await collectMigrations(prisma);

    // 包目录名用 jobId（跨重跑稳定）：同一任务重跑才能命中 packageObjectIntoFile
    // 的"已存在且大小一致则跳过"续传逻辑。若用时间戳命名，每次重跑都新建目录，
    // 断点续传永不生效；jobId 均为 [a-z0-9]，符合导出包文件名安全字符。
    const bundleName = `liveboard-migration-${args.jobId}`;
    const outDir = args.out ?? path.join(dataDir, "exports");
    const bundleDir = path.join(outDir, bundleName);
    await mkdir(path.join(bundleDir, "objects"), {
      recursive: true,
      mode: 0o700,
    });

    await state("dump");
    const dbUrl = databaseUrlForTools();
    const conn = parsePostgresUrl(dbUrl);
    const dumpFile = path.join(bundleDir, "database.dump");
    const dumpStatus = runPgTool(
      "pg_dump",
      [
        ...pgConnectionArgs(conn),
        "-d",
        conn.database,
        "-Fc",
        // 排除表模式不带引号：args 数组直传 spawn（不经 shell），内嵌引号只会被
        // pg_dump 当作标识符引用原样吃掉；未加引号的模式按大小写不敏感匹配，
        // 这几个表名无特殊字符，逐字匹配即可。
        "--exclude-table-data=_prisma_migrations",
        "--exclude-table-data=PendingUpload",
        "--exclude-table-data=ServerMetricSample",
        "--exclude-table-data=MigrationJob",
        "-f",
        dumpFile,
      ],
      dbUrl,
    );
    if (dumpStatus !== 0) throw new Error(`pg_dump 失败（exit=${dumpStatus}）`);
    const dumpSha256 = await sha256File(dumpFile);

    // 对象清单 = 按 DB 引用枚举全部非空存储对象（manifest 始终保留清单供校验）。
    // includeObjects 时把对象打进包内 objects/；pushR2 时直推目标 R2（path 为空）；
    // --no-objects 只记录大小（对象由目标端从源 R2 直拉）。
    const backends = await createSourceBackends(prisma);
    const refs = await collectObjectRefs(prisma);
    // 直推目标 R2：目标 R2 凭据走一次性交接（TARGET_R2_* 或应用自身 R2_*），
    // 只存于任务进程，不落 StorageSettings、不进日志。
    let pushTarget: ReturnType<typeof targetR2Backend> = null;
    if (args.pushR2) {
      pushTarget = targetR2Backend();
      if (!pushTarget) {
        throw new Error(
          "--push-r2 需要目标 R2 配置：请提供 TARGET_R2_ACCOUNT_ID / TARGET_R2_BUCKET / TARGET_R2_ACCESS_KEY_ID / TARGET_R2_SECRET_ACCESS_KEY",
        );
      }
    }
    await state("objects", {
      progress: {
        done: 0,
        total: refs.length,
        label: args.pushR2
          ? "直推目标 R2"
          : args.includeObjects
            ? "收集对象"
            : "统计对象",
      },
    });
    const objectNames = refs.map((ref, index) => ({
      ref,
      name: `${String(index + 1).padStart(4, "0")}-${sanitizeObjectName(ref.storageKey)}`,
    }));

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
            `[export] MISSING ${item.ref.kind}:${item.ref.recordKey}（${item.ref.backend} 后端未配置）`,
          );
          missing += 1;
          continue;
        }
        const statResult = await statRef(backend, item.ref.storageKey);
        if (!statResult) {
          console.warn(
            `[export] MISSING ${item.ref.kind}:${item.ref.recordKey}（源对象不存在 ${item.ref.storageKey}）`,
          );
          missing += 1;
          continue;
        }

        if (args.pushR2) {
          // 直推：对象写入目标 R2，包内不含对象（manifest 清单保留供最终校验）。
          await transferObjectTo({
            source: backend,
            target: pushTarget!,
            storageKey: item.ref.storageKey,
            mimeType: item.ref.mimeType ?? "application/octet-stream",
            expectedSize: statResult.size,
          });
          results[index] = {
            kind: item.ref.kind,
            storageKey: item.ref.storageKey,
            path: null,
            sizeBytes: statResult.size,
            sha256: "",
            mimeType: item.ref.mimeType,
          };
        } else if (args.includeObjects) {
          const destPath = path.join(bundleDir, "objects", item.name);
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
        } else {
          results[index] = {
            kind: item.ref.kind,
            storageKey: item.ref.storageKey,
            path: null,
            sizeBytes: statResult.size,
            sha256: "",
            mimeType: item.ref.mimeType,
          };
        }

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
        `导出期间 ${missing} 个源对象缺失，迁移包不完整，拒绝完成（fail-closed）`,
      );
    }
    const objects = results.filter(Boolean) as Array<{
      kind: ObjectRef["kind"];
      storageKey: string;
      path: string | null;
      sizeBytes: number;
      sha256: string;
      mimeType: string | null;
    }>;

    const manifest = {
      formatVersion: MIGRATION_FORMAT_VERSION,
      appVersion: appVersion(),
      exportedAt: new Date().toISOString(),
      source: process.env.DEPLOYMENT_TARGET === "vercel" ? "vercel" : "server",
      dumpSha256,
      migrations,
      tables,
      objects,
      options: { includeAiSecrets: false },
    };

    await writeFile(
      path.join(bundleDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    await tarBundle(outDir, bundleName);
    await pruneExports(outDir, KEEP_EXPORTS);

    await state("done", {
      status: "succeeded",
      finishedAt: new Date().toISOString(),
      packageName: `${bundleName}.tar`,
      progress: { done: objects.length, total: objects.length, label: "完成" },
    });
    console.log(
      `[export] 完成：${bundleName}.tar（对象 ${objects.length}，表 ${Object.keys(tables).length}）`,
    );
  } catch (caught) {
    const message = messageOf(caught);
    console.error(`[export] 失败：${message}`);
    await state("failed", {
      status: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
    }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
    // 只关闭任务自身开启的维护模式；管理员预先手动开启的维护窗口保持原状。
    if (args.ensureMaintenance && !preExistingMaintenance) {
      await writeMaintenanceStateFile(maintenanceFile, MAINTENANCE_OFF).catch(
        () => undefined,
      );
    }
  }
}

main().catch((caught) => {
  console.error(`[export] 执行失败：${messageOf(caught)}`);
  process.exitCode = 1;
});
