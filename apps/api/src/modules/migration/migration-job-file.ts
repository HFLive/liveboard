import { mkdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 迁移任务的本地状态文件（`<dataDir>/jobs/<jobId>.json`）。
 *
 * 导入第一步会腾空目标库，期间 `MigrationJob` 表也不存在，因此任务状态写入
 * 本地状态文件；还原完成、表恢复后再把任务记录 upsert 回数据库。API 的
 * `GET admin/migration/jobs/:id` 先读状态文件（实时进度），再合并数据库元数据，
 * 数据库不可用时降级为纯状态文件。见 docs/migrate-any-direction-design.md §5.3。
 */

export type MigrationJobKind = "export" | "import";
export type MigrationJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface MigrationJobProgress {
  done: number;
  total: number;
  label?: string;
}

export interface MigrationJobFileState {
  jobId: string;
  kind: MigrationJobKind;
  status: MigrationJobStatus;
  /** 当前阶段，例如 export/dump / import/drop-schema / import/objects。 */
  phase: string;
  progress?: MigrationJobProgress | null;
  packageName?: string | null;
  manifest?: unknown | null;
  error?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export function jobStatePath(jobsDir: string, jobId: string) {
  // 防止 CLI 传入 --job-id ../../x 之类的路径穿越。服务端 jobId 来自 DB cuid，
  // 均落在 [A-Za-z0-9_-] 内；带 . 或 / 的非法值直接拒绝（fail-closed）。
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
    throw new Error(`无效的迁移任务 ID: ${jobId}`);
  }
  return path.join(jobsDir, `${jobId}.json`);
}

export async function readJobState(
  jobsDir: string,
  jobId: string,
): Promise<MigrationJobFileState | null> {
  try {
    const raw = await readFile(jobStatePath(jobsDir, jobId), "utf8");
    return JSON.parse(raw) as MigrationJobFileState;
  } catch {
    return null;
  }
}

/**
 * 进程内串行化 writeJobState 的读-改-写：导出/导入的对象 worker 会并发上报
 * 进度（见 migrate-import.ts 的 reportProgress），若各自基于旧状态做
 * read-modify-write，会互相覆盖（lost-update：进度回退、状态被旧快照冲掉）。
 * 串行后每个写都在前一个写完成后重新读取，进度/状态单调推进。
 * 跨进程（API 服务与 CLI 子进程）仍靠唯一临时名 + 原子 rename 保证文件不损坏，
 * 语义为 last-writer-wins。
 */
let writeChain: Promise<unknown> = Promise.resolve();

export async function writeJobState(
  jobsDir: string,
  jobId: string,
  partial: Partial<MigrationJobFileState>,
): Promise<MigrationJobFileState> {
  mkdirSync(jobsDir, { recursive: true, mode: 0o700 });
  const file = jobStatePath(jobsDir, jobId);

  const run = async (): Promise<MigrationJobFileState> => {
    const previous = await readJobState(jobsDir, jobId);
    const next: MigrationJobFileState = {
      jobId,
      kind: (partial.kind ?? previous?.kind ?? "export") as MigrationJobKind,
      status: partial.status ?? previous?.status ?? "running",
      phase: partial.phase ?? previous?.phase ?? "",
      progress:
        partial.progress !== undefined
          ? (partial.progress ?? null)
          : (previous?.progress ?? null),
      packageName:
        partial.packageName !== undefined
          ? (partial.packageName ?? null)
          : (previous?.packageName ?? null),
      manifest:
        partial.manifest !== undefined
          ? (partial.manifest ?? null)
          : (previous?.manifest ?? null),
      error:
        partial.error !== undefined
          ? (partial.error ?? null)
          : (previous?.error ?? null),
      startedAt:
        partial.startedAt !== undefined
          ? (partial.startedAt ?? null)
          : (previous?.startedAt ?? null),
      finishedAt:
        partial.finishedAt !== undefined
          ? (partial.finishedAt ?? null)
          : (previous?.finishedAt ?? null),
      updatedAt: new Date().toISOString(),
    };
    // 唯一临时名（pid+random）：并发写互不截断；rename 仍原子，last-writer-wins。
    // 对比固定 `${file}.tmp`：两个写在途时，先 rename 者把 tmp 移走后，后 rename
    // 者会因 ENOENT 抛错，进而让整个导入/导出任务中途失败（review #2）。
    const temporary = `${file}.${process.pid}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, file);
    return next;
  };

  const scheduled = writeChain.then(run, run);
  writeChain = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

export async function removeJobState(jobsDir: string, jobId: string) {
  await rm(jobStatePath(jobsDir, jobId), { force: true }).catch(
    () => undefined,
  );
}
