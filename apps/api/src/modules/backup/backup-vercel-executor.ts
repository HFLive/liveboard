import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import {
  collectObjectRefs,
  type ObjectRef,
} from "../migration/migration-engine";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { retentionCandidates } from "./backup-schedule";
import { NeonClient } from "./neon.client";
import { StorageService } from "../storage/storage.service";

/**
 * Vercel 备份/回滚的分块执行器（Serverless 无持久盘、函数 60s 超时）：
 * 备份 = Neon 数据分支（数据库快照）+ R2 对象复制到 backup/ 前缀；
 * 回滚 = Neon 分支恢复（主分支 ← 备份分支）+ R2 回拷。
 *
 * 每个 tick 推进一块（创建分支/等待操作/复制 ≤20 个对象/收尾），任务进度
 * 写 BackupJob 行（progress JSON）+ Redis 双份（回滚替换主库期间 UI 从 Redis
 * 读进度）。所有阶段幂等：断点重进不会损坏（分支操作由 Neon 保证原子，
 * 对象复制大小一致则跳过）。
 *
 * 约束：备份分支不建 compute endpoint（不产生计算小时，只占分支配额）；
 * Neon 分支上限保守按 Free 计划 10 个/项目（含主分支与瞬态）控制默认保留数。
 */

interface VercelJobProgress {
  stage: string;
  done: number;
  total: number;
  operationId?: string | null;
  /** copy-objects 阶段的对象清单（按 DB 引用枚举快照，跨 tick 稳定）。 */
  objects?: Array<{
    storageKey: string;
    sizeBytes: number;
    mimeType: string | null;
  }>;
  /** 非阻断性错误汇总（如对象回拷失败），成功后并入 manifest 展示。 */
  errors?: string[];
  /**
   * 回滚链标记：startRestore 写入，每个阶段的进度都携带它（换库后重建
   * restore 行/保护备份行靠它互相定位，见 recoverJobRow/repairProtectionRow）。
   */
  protectJobId?: string | null;
}

/** 任务行（advance 各状态机共用的最小视图；findUnique/recover 都返回它）。 */
interface VercelJobRow {
  id: string;
  kind: "auto" | "manual" | "restore";
  status: "pending" | "running" | "succeeded" | "failed";
  neonBranchId: string | null;
  restoreFromId: string | null;
  includeObjects: boolean;
  isProtection: boolean;
  phase: string;
  progress: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** 修复源备份行时重建（manifest 从 Redis 进度恢复，见 repairSourceBackupRow）。 */
  manifest?: unknown;
  objectCount?: number | null;
}

/** Redis 里任务状态的落盘形态（writeRedisState 全量写入，重建行时读取）。 */
interface VercelRedisJobState {
  jobId: string;
  kind?: "auto" | "manual" | "restore";
  restoreFromId?: string | null;
  includeObjects?: boolean;
  isProtection?: boolean;
  progress?: VercelJobProgress | null;
  updatedAt?: string;
}

const OBJECTS_PER_TICK = 20;
const JOB_LOCK_TTL_MS = 60_000;
const JOB_LOCK_KEY_PREFIX = "liveboard:backup:job:";
/** 请求内推进预算：Vercel 函数最长 60s，预留请求与执行开销余量。 */
export const VERCEL_ADVANCE_BUDGET_MS = 45_000;
/**
 * 手动备份请求的推进预算：比续跑棒更短，让「立即备份」请求尽早返回
 * （页面按钮不长时间转圈），未完成的部分由接力续跑继续。
 */
export const VERCEL_MANUAL_BUDGET_MS = 20_000;
/** 回滚链请求预算：保护备份 + 回滚共享，同样取短值让请求尽早返回。 */
export const VERCEL_RESTORE_CHAIN_BUDGET_MS = 20_000;
/**
 * 单棒内 Neon 操作轮询窗口：函数 60s 上限内留余量，未完成则心跳退出本棒
 * （updatedAt 前进触发接力），由下一棒继续轮询。Neon 恢复分支可数分钟，
 * 旧实现按 5 分钟超时整棒死等，函数在轮询中被杀、无接力、链静默断。
 */
const VERCEL_OPERATION_POLL_MS = 25_000;

/** R2 备份前缀（对象复制到 backup/<jobId>/<storageKey>）。 */
function backupObjectKey(jobId: string, storageKey: string): string {
  return `backup/${jobId}/${storageKey}`;
}

@Injectable()
export class BackupVercelExecutor {
  private readonly logger = new Logger(BackupVercelExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** tick 推进：所有运行中的备份/回滚任务各推进一块。 */
  async advance(): Promise<void> {
    const rows = await this.prisma.backupJob
      .findMany({
        where: { status: { in: ["pending", "running"] } },
        orderBy: { createdAt: "asc" },
        take: 10,
      })
      .catch(() => null);
    const dbIds = new Set((rows ?? []).map((row) => row.id));
    for (const row of rows ?? []) {
      const before = row.updatedAt.getTime();
      await this.withJobLock(row.id, () => this.advanceJob(row));
      // 推进过且未终态的任务接力续跑：cron 才不会一次只推一块——长操作
      // （Neon 恢复数分钟）断链后靠这条路径在几分钟内跑完，而非每天一块。
      const after = await this.prisma.backupJob
        .findUnique({ where: { id: row.id } })
        .catch(() => null);
      if (
        after &&
        (after.status === "pending" || after.status === "running") &&
        after.updatedAt.getTime() > before
      ) {
        await this.scheduleContinuation(row.id);
      }
    }
    // 兜底：Neon 恢复换库会把备份点之后创建的行从 DB 抹掉（回滚行/保护
    // 备份行），接力断链时它们不在 findMany 结果里，永远无人推进。从
    // Redis 进度找回孤儿行，重建后推进一块并接力续跑（每日 cron 是
    // 接力断裂时的最后防线）。
    for (const jobId of await this.listOrphanedInFlightJobs(dbIds)) {
      const row = await this.recoverJobRow(jobId);
      if (!row) continue;
      await this.withJobLock(row.id, () => this.advanceJob(row));
      await this.scheduleContinuation(row.id);
    }
  }

  /**
   * 请求内立即把单个任务推进到完成或预算耗尽：手动备份/回滚链在创建任务的
   * 请求里驱动，不再等每日 cron 才动第一块。每轮读取最新行推进一块；
   * 预算耗尽且任务未终态时自动接力续跑（自己叫自己，见
   * scheduleContinuation），每棒一个函数实例（≤预算），直至完成；
   * 本轮无进展不接力（防止失控循环），交由每日 cron 兜底。restore 行在
   * 链等待（pending，等保护备份 finalize 唤醒）时每 1s 重试一次，并接力
   * 推进仍在进行中的保护备份。deadlineMs 由调用方共享（回滚链两条任务
   * 合计不超预算）。
   */
  async advanceUntilFinished(
    jobId: string,
    deadlineMs?: number,
  ): Promise<void> {
    const deadline = deadlineMs ?? Date.now() + VERCEL_ADVANCE_BUDGET_MS;
    let progressed = false; // 本轮推进过（updatedAt 前进）才接力。
    let chainTarget: string | null = null; // 接力目标（链等待时指向保护备份）。
    for (;;) {
      let row = (await this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null)) as unknown as VercelJobRow | null;
      if (!row) {
        // 换库后行被快照抹掉（回滚行不在备份点快照里）：从 Redis 进度
        // 重建再继续推进，否则任务静默蒸发（曾线上表现为回滚行消失、
        // UI 永远看不到完成）。
        row = await this.recoverJobRow(jobId);
        if (!row) return;
      }
      if (row.status === "succeeded" || row.status === "failed") {
        // 任务终态：若有被它唤醒的回滚任务，接力给回滚续跑（防链跨请求断链）。
        if (row.status === "succeeded") {
          await this.continueDependentRestores(jobId);
        }
        return;
      }
      if (row.kind === "restore" && row.status === "pending") {
        // 链等待：回滚必须等它的保护备份成功。保护备份 id 记在 restore
        // 行的 progress.protectJobId（startRestore 写入；restoreFromId
        // 是「源备份」，两者不同）。保护备份成功后自唤醒，还在跑则接力
        // 推进它，失败/缺失则不再接力（reconcileOrphanedRestores 兜底）。
        const protectId = this.protectJobIdOf(row.progress);
        const protect = protectId
          ? await this.prisma.backupJob
              .findUnique({ where: { id: protectId } })
              .catch(() => null)
          : null;
        if (protect && protect.status === "succeeded") {
          await this.prisma.backupJob
            .update({
              where: { id: jobId },
              data: {
                status: "running",
                phase: "restore/prepare",
                startedAt: new Date(),
              },
            })
            .catch(() => undefined);
          continue; // 下一轮以 running 进入 restore 状态机。
        }
        if (protect && protect.status !== "failed") {
          chainTarget = protect.id;
        } else {
          chainTarget = null;
        }
        if (Date.now() >= deadline) break;
        await sleep(1000);
        continue;
      }
      chainTarget = null;
      if (Date.now() >= deadline) break;
      const before = row.updatedAt.getTime();
      await this.withJobLock(jobId, () => this.advanceJob(row));
      const after = await this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null);
      if (after && after.updatedAt.getTime() > before) progressed = true;
    }
    // 预算耗尽：接力续跑（自己叫自己）。无进展不接力，交给每日 cron 兜底。
    if (progressed || chainTarget) {
      await this.scheduleContinuation(chainTarget ?? jobId);
    }
  }

  /** 保护备份成功收尾后，唤醒依赖它的回滚任务接力续跑（防链跨请求断链）。 */
  private async continueDependentRestores(backupId: string): Promise<void> {
    const restores = await this.prisma.backupJob
      .findMany({
        where: { kind: "restore", status: { in: ["pending", "running"] } },
        select: { id: true, progress: true },
      })
      .catch(() => null);
    for (const restore of restores ?? []) {
      if (this.protectJobIdOf(restore.progress) === backupId) {
        await this.scheduleContinuation(restore.id);
      }
    }
  }

  /** restore 行的保护备份 id（progress.protectJobId，startRestore 写入）。 */
  private protectJobIdOf(progress: unknown): string | null {
    const raw = progress as { protectJobId?: string } | null;
    return typeof raw?.protectJobId === "string" ? raw.protectJobId : null;
  }

  /**
   * 接力续跑：向自身公开端点发 GET /internal/cron/backup?jobId=<id>
   * （Bearer CRON_SECRET），由下一个函数实例继续推进同一任务（每棒 ≤预算）。
   * 最多等 3s 确保请求发出即返回，不等待下一棒完成；URL 或密钥缺失时
   * 静默跳过，由每日 cron 兜底。同一任务的并发由 per-job Redis 锁串行化。
   */
  private async scheduleContinuation(jobId: string): Promise<void> {
    const base = selfBaseUrl();
    const secret = process.env.CRON_SECRET?.trim();
    if (!base || !secret) return;
    await fetch(
      `${base}/internal/cron/backup?jobId=${encodeURIComponent(jobId)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(3000),
      },
    ).catch(() => undefined);
  }

  /** 每任务一块；返回后任务行已更新（无论推进到哪一步）。 */
  private async advanceJob(job: VercelJobRow): Promise<void> {
    const progress = this.parseProgress(job.progress);
    try {
      if (job.kind === "restore") {
        await this.advanceRestore(job, progress);
      } else {
        await this.advanceBackup(job, progress);
      }
    } catch (caught) {
      // 推进失败：任务落 failed（分支等已创建资源由保留策略兜底清理）。
      this.logger.error(
        `Vercel 备份任务 ${job.id} 推进失败: ${messageOfVercel(caught)}`,
      );
      // upsert：换库后行可能刚被重建（或尚未重建），update 会 P2025 打空。
      await this.upsertJobRow(
        job.id,
        job.kind,
        {
          status: "failed",
          error: messageOfVercel(caught),
          finishedAt: new Date(),
          phase: job.phase || "failed",
        },
        {
          restoreFromId: job.restoreFromId ?? null,
          includeObjects: job.includeObjects,
          isProtection: job.isProtection,
        },
      );
      await this.writeRedisState(
        job.id,
        {
          ...progress,
          stage: "failed",
          errors: [...(progress.errors ?? []), messageOfVercel(caught)],
        },
        this.redisMetaFor(job),
      ).catch(() => undefined);
    }
  }

  /** writeRedisState 的元数据参数（换库后重建行用，见 recoverJobRow）。 */
  private redisMetaFor(job: {
    kind: "auto" | "manual" | "restore";
    restoreFromId?: string | null;
    includeObjects: boolean;
    isProtection: boolean;
  }): {
    kind: "auto" | "manual" | "restore";
    restoreFromId: string | null;
    includeObjects: boolean;
    isProtection: boolean;
  } {
    return {
      kind: job.kind,
      restoreFromId: job.restoreFromId ?? null,
      includeObjects: job.includeObjects,
      isProtection: job.isProtection,
    };
  }

  // ---- 备份状态机（auto / manual）------------------------------------------

  private async advanceBackup(
    job: Pick<
      VercelJobRow,
      | "id"
      | "kind"
      | "phase"
      | "progress"
      | "error"
      | "createdAt"
      | "includeObjects"
      | "isProtection"
    >,
    progress: VercelJobProgress,
  ): Promise<void> {
    const stage = progress.stage || "";
    const neon = this.neon();
    const row = this.prisma.backupJob;

    if (stage === "") {
      // 创建 Neon 数据分支（无 compute endpoint）。
      const { branchId, operationId } = await neon.createBranch(
        `backup-${job.id}`,
      );
      await row.update({
        where: { id: job.id },
        data: {
          neonBranchId: branchId,
          status: "running",
          phase: "create-branch",
          progress: {
            stage: "branch",
            done: 0,
            total: 1,
            operationId,
          } as never,
        },
      });
      await this.writeRedisState(
        job.id,
        {
          stage: "branch",
          done: 0,
          total: 1,
          operationId,
        },
        this.redisMetaFor(job),
      );
      return;
    }

    if (stage === "branch") {
      // 预算感知等待分支创建操作：与回滚同理，未完成则心跳退出本棒
      // （避免函数 60s 内死在长轮询里，接力链断裂）。
      const finished = await neon.waitForOperation(
        progress.operationId ?? null,
        VERCEL_OPERATION_POLL_MS,
      );
      if (!finished) {
        const heartbeat: VercelJobProgress = {
          stage: "branch",
          done: 0,
          total: 1,
          operationId: progress.operationId ?? null,
        };
        await this.prisma.backupJob
          .update({
            where: { id: job.id },
            data: { phase: "create-branch", progress: heartbeat as never },
          })
          .catch(() => undefined);
        await this.writeRedisState(job.id, heartbeat, this.redisMetaFor(job));
        return;
      }
      const refs = await collectObjectRefs(this.prisma);
      if (!job.includeObjects) {
        await this.finalizeBackup(job, refs, [], {
          ...progress,
          stage: "finalize",
        });
        return;
      }
      const objects = refs
        .map((ref) => ({
          storageKey: ref.storageKey,
          sizeBytes: 0,
          mimeType: ref.mimeType ?? null,
        }))
        .filter((o) => o.storageKey);
      // 后续 tick 复制对象前先 stat 拿大小（幂等判断用），这里只存清单。
      await row.update({
        where: { id: job.id },
        data: {
          phase: "objects",
          progress: {
            stage: "copy-objects",
            done: 0,
            total: objects.length,
            objects,
          },
        },
      });
      await this.writeRedisState(
        job.id,
        {
          stage: "copy-objects",
          done: 0,
          total: objects.length,
          objects,
        },
        this.redisMetaFor(job),
      );
      return;
    }

    if (stage === "copy-objects") {
      const objects = progress.objects ?? [];
      let done = progress.done;
      const backend = await this.storage.backendFor("r2");
      const batch = objects.slice(done, done + OBJECTS_PER_TICK);
      const errors = progress.errors ?? [];
      for (const obj of batch) {
        try {
          const sourceKey = obj.storageKey;
          const targetKey = backupObjectKey(job.id, sourceKey);
          // 幂等续传：目标已存在且大小一致则跳过（重跑安全）。
          const existing = await backend
            .statObject(targetKey)
            .catch(() => null);
          if (
            existing &&
            existing.size === obj.sizeBytes &&
            obj.sizeBytes > 0
          ) {
            done += 1;
            continue;
          }
          const statResult =
            obj.sizeBytes > 0
              ? existing
              : await backend.statObject(sourceKey).catch(() => null);
          if (!statResult) {
            errors.push(`对象不存在 ${sourceKey}`);
            done += 1;
            continue;
          }
          if (obj.sizeBytes === 0) obj.sizeBytes = statResult.size; // 回写清单，供 manifest 与回拷幂等判断。
          await backend.copyObject(
            sourceKey,
            targetKey,
            obj.mimeType ?? "application/octet-stream",
          );
          done += 1;
        } catch (caught) {
          errors.push(`复制失败 ${obj.storageKey}: ${messageOfVercel(caught)}`);
          done += 1;
        }
      }
      const next: VercelJobProgress = {
        stage: done >= objects.length ? "finalize" : "copy-objects",
        done,
        total: objects.length,
        objects,
        errors,
      };
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          phase: done >= objects.length ? "finalize" : "objects",
          progress: next as never,
        },
      });
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "finalize") {
      await this.finalizeBackup(job, [], progress.objects ?? [], progress);
    }
  }

  /** 备份收尾：manifest + 调度标记 + 保留策略 + 回滚链唤醒。 */
  private async finalizeBackup(
    job: Pick<
      VercelJobRow,
      "id" | "kind" | "createdAt" | "includeObjects" | "isProtection"
    >,
    refs: ObjectRef[],
    objects: Array<{
      storageKey: string;
      sizeBytes: number;
      mimeType: string | null;
    }>,
    progress: VercelJobProgress,
  ): Promise<void> {
    const tables = await collectTableCounts(this.prisma).catch(() => ({}));
    const manifest = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      kind: job.kind,
      objects,
      tables,
      errors: progress.errors ?? [],
    };
    await this.prisma.backupJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        phase: "done",
        finishedAt: new Date(),
        objectCount: objects.length,
        manifest: manifest as never,
        progress: { ...progress, stage: "done" },
      },
    });
    await this.writeRedisState(
      job.id,
      { ...progress, stage: "done" },
      this.redisMetaFor(job),
    );
    this.logger.log(`Vercel 备份 ${job.id} 完成（对象 ${objects.length}）`);

    if (job.kind === "auto") {
      await this.prisma.backupSettings
        .updateMany({ data: { lastAutoBackupAt: new Date() } })
        .catch(() => undefined);
      // 手动备份无上限：仅自动备份按保留份数清理。
      await this.pruneRetention();
    }
    await this.wakePendingRestores(job.id);
  }

  /** 保护备份/备份完成后，唤醒引用它的 pending 回滚任务（按 progress.protectJobId 匹配）。 */
  private async wakePendingRestores(backupId: string): Promise<void> {
    const restores = await this.prisma.backupJob
      .findMany({
        where: { kind: "restore", status: "pending" },
        select: { id: true, progress: true },
      })
      .catch(() => null);
    for (const restore of restores ?? []) {
      if (this.protectJobIdOf(restore.progress) !== backupId) continue;
      await this.prisma.backupJob
        .update({
          where: { id: restore.id },
          data: {
            status: "running",
            phase: "restore/prepare",
            startedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }

  // ---- 回滚状态机（restore）-------------------------------------------------

  private async advanceRestore(
    job: Pick<
      VercelJobRow,
      | "id"
      | "kind"
      | "status"
      | "phase"
      | "progress"
      | "error"
      | "restoreFromId"
      | "createdAt"
      | "includeObjects"
      | "isProtection"
    >,
    progress: VercelJobProgress,
  ): Promise<void> {
    const stage = progress.stage || "";
    const neon = this.neon();

    // 链等待：保护备份尚未成功（pending 停在 initial，由 wakePendingRestores 唤醒）。
    if (job.status === "pending") return;

    if (stage === "") {
      // 校验来源备份分支存在。
      const source = await this.prisma.backupJob
        .findUnique({ where: { id: job.restoreFromId ?? "" } })
        .catch(() => null);
      if (!source?.neonBranchId || source.status !== "succeeded") {
        throw new Error("来源备份缺少 Neon 分支信息，无法回滚");
      }
      const { primaryId } = await neon.listBranches();
      if (!primaryId) throw new Error("Neon 项目中未找到主分支");
      const operationId = await neon.restoreBranch({
        targetBranchId: primaryId,
        sourceBranchId: source.neonBranchId,
        preserveUnderName: `pre-restore-${job.id}`,
      });
      const next: VercelJobProgress = {
        stage: "restore/wait",
        done: 0,
        total: 1,
        operationId,
        protectJobId: progress.protectJobId ?? null,
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        { phase: "restore/restore", progress: next as never },
        this.rowCreateOverrides(job),
      );
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "restore/wait") {
      // 预算感知等待：Neon 恢复操作可数分钟，一棒 45s 内等不完。每棒轮询
      // 一小段，未完成则心跳更新进度（updatedAt 前进触发接力），下一棒继续
      // 轮询；完成才进入 verify。旧实现 5 分钟整棒死等，函数 60s 被杀、
      // 无接力续跑，回滚行永久卡「还原数据库」。
      const finished = await neon.waitForOperation(
        progress.operationId ?? null,
        VERCEL_OPERATION_POLL_MS,
      );
      if (!finished) {
        const heartbeat: VercelJobProgress = {
          stage: "restore/wait",
          done: 0,
          total: 1,
          operationId: progress.operationId ?? null,
          protectJobId: progress.protectJobId ?? null,
        };
        await this.upsertJobRow(
          job.id,
          "restore",
          { phase: "restore/restore", progress: heartbeat as never },
          this.rowCreateOverrides(job),
        );
        await this.writeRedisState(job.id, heartbeat, this.redisMetaFor(job));
        return;
      }
      // waitForOperation 返回时主库已被替换成备份分支快照：此后任务行在
      // 旧库里被抹掉（快照里没有备份点之后创建的行），所有写入必须走
      // upsert 重建（见 upsertJobRow），否则 restore 行静默蒸发。
      const next: VercelJobProgress = {
        stage: "restore/verify",
        done: 0,
        total: 1,
        protectJobId: progress.protectJobId ?? null,
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        { phase: "restore/verify", progress: next as never },
        this.rowCreateOverrides(job),
      );
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "restore/verify") {
      // Neon 恢复会迁移 compute，旧连接可能陈旧：用独立连接验证。
      const client = new PrismaClient();
      try {
        await client.$queryRawUnsafe("SELECT 1");
        const userCount = (await client.user.count().catch(() => 0)) as number;
        if (userCount === 0) throw new Error("恢复后用户表为空，拒绝完成");
        const superAdmin = await client.user.findFirst({
          where: { systemRole: "super_admin", status: "active" },
          select: { username: true },
        });
        if (!superAdmin) throw new Error("恢复后没有正常状态的最高管理员");
      } finally {
        await client.$disconnect().catch(() => undefined);
      }
      const next: VercelJobProgress = {
        stage: "restore/objects",
        done: 0,
        total: 0,
        protectJobId: progress.protectJobId ?? null,
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        { phase: "restore/objects", progress: next as never },
        this.rowCreateOverrides(job),
      );
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "restore/objects") {
      // 从备份 manifest 拿对象清单回拷（无对象任务直接进 cleanup）。
      // 换库后源备份行回到快照时刻（执行中、无 manifest、可能无分支 id）：
      // 先修复（manifest 从 Redis 进度重建、分支 id 按 backup-<id> 命名找回），
      // 否则清单为空、源备份行永远卡在「执行中」。
      const source = await this.repairSourceBackupRow(job.restoreFromId ?? "");
      const manifest = source?.manifest as {
        objects?: Array<{
          storageKey: string;
          sizeBytes: number;
          mimeType: string | null;
        }>;
      } | null;
      const objects = manifest?.objects ?? [];
      let done = progress.done;
      const errors = progress.errors ?? [];
      if (objects.length > 0) {
        const backend = await this.storage.backendFor("r2");
        const batch = objects.slice(done, done + OBJECTS_PER_TICK);
        for (const obj of batch) {
          try {
            // 备份对象在 backup/<源备份 id>/ 前缀下（backup 阶段按备份行 id
            // 复制）；不能用回滚行自己的 id，否则永远找不到对象。
            const sourceKey = backupObjectKey(
              job.restoreFromId ?? "",
              obj.storageKey,
            );
            const existing = await backend
              .statObject(sourceKey)
              .catch(() => null);
            if (!existing) {
              errors.push(`备份对象缺失 ${obj.storageKey}`);
              done += 1;
              continue;
            }
            const current = await backend
              .statObject(obj.storageKey)
              .catch(() => null);
            if (current && current.size === obj.sizeBytes && obj.sizeBytes > 0)
              continue;
            await backend.copyObject(
              sourceKey,
              obj.storageKey,
              obj.mimeType ?? "application/octet-stream",
            );
            done += 1;
          } catch (caught) {
            errors.push(
              `回拷失败 ${obj.storageKey}: ${messageOfVercel(caught)}`,
            );
            done += 1;
          }
        }
      } else {
        done = 0;
      }
      const finished = objects.length === 0 || done >= objects.length;
      const next: VercelJobProgress = {
        stage: finished ? "restore/cleanup" : "restore/objects",
        done,
        total: objects.length,
        errors,
        protectJobId: progress.protectJobId ?? null,
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        {
          phase: finished ? "restore/cleanup" : "restore/objects",
          progress: next as never,
        },
        this.rowCreateOverrides(job),
      );
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "restore/cleanup") {
      // 清理 Neon 自动保存的旧主分支（preserve_under_name 命名）。
      try {
        const { branches } = await neon.listBranches();
        for (const branch of branches) {
          if (branch.name === `pre-restore-${job.id}`) {
            await neon.deleteBranch(branch.id);
          }
        }
      } catch (caught) {
        // 清理失败不阻塞完成：旧分支是回滚的最后防线，保留亦可。
        this.logger.warn(
          `Vercel 回滚 ${job.id} 清理旧分支失败: ${messageOfVercel(caught)}`,
        );
      }
      const next: VercelJobProgress = {
        stage: "done",
        done: progress.total,
        total: progress.total,
        protectJobId: progress.protectJobId ?? null,
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        {
          status: "succeeded",
          phase: "done",
          finishedAt: new Date(),
          progress: next as never,
        },
        this.rowCreateOverrides(job),
      );
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      // 保护备份行同样在备份点快照之外，被换库抹掉：重建为成功，让
      // 「回滚前自动备份」tab 保留这条记录。
      const protectId = progress.protectJobId;
      if (protectId) await this.repairProtectionRow(protectId);
      this.logger.log(`Vercel 回滚 ${job.id} 完成`);
    }
  }

  // ---- 换库后的行重建（Neon restoreBranch 会替换主库）----------------------

  /**
   * 回滚链建立时立即在 Redis 落下完整元数据：换库后 BackupJob 里备份点之后
   * 创建的行（回滚行/保护备份行）会被快照抹掉，重建行必须靠这份状态。
   * 在 startRestore 里调用，早于任何推进。
   */
  async armRestoreChain(
    jobId: string,
    restoreFromId: string,
    protectJobId: string,
    includeObjects: boolean,
  ): Promise<void> {
    await this.writeRedisState(
      jobId,
      { stage: "", done: 0, total: 0, protectJobId },
      { kind: "restore", restoreFromId, includeObjects, isProtection: false },
    );
  }

  /** 从 Redis 进度重建被换库抹掉的任务行；无状态/终态返回 null。 */
  private async recoverJobRow(jobId: string): Promise<VercelJobRow | null> {
    const state = await this.readRedisState(jobId);
    if (!state?.kind || !state.progress) return null;
    const stage = state.progress.stage ?? "";
    if (stage === "done" || stage === "failed" || stage === "") return null;
    const updatedAt = state.updatedAt ? new Date(state.updatedAt) : null;
    const row: VercelJobRow = {
      id: jobId,
      kind: state.kind,
      status: "running",
      phase: stage,
      neonBranchId: null,
      restoreFromId: state.restoreFromId ?? null,
      includeObjects: state.includeObjects ?? false,
      isProtection: state.isProtection ?? false,
      progress: state.progress,
      error: null,
      createdAt: updatedAt ?? new Date(),
      updatedAt: updatedAt ?? new Date(),
    };
    try {
      await this.prisma.backupJob.create({
        data: {
          id: jobId,
          kind: state.kind,
          status: "running",
          phase: stage,
          restoreFromId: state.restoreFromId ?? null,
          includeObjects: state.includeObjects ?? false,
          isProtection: state.isProtection ?? false,
          startedAt: updatedAt ?? new Date(),
          progress: state.progress as never,
        } as never,
      });
    } catch {
      // 竞争：另一实例已重建；取现有行，仍在执行中则继续推进。
      const existing = await this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null);
      return existing as unknown as VercelJobRow | null;
    }
    return row;
  }

  /** 读 Redis 任务状态（进度 + 元数据），无值/解析失败返回 null。 */
  private async readRedisState(
    jobId: string,
  ): Promise<VercelRedisJobState | null> {
    const client = await this.redis.getClient().catch(() => null);
    if (!client) return null;
    const raw = await client
      .get(`${JOB_LOCK_KEY_PREFIX}${jobId}`)
      .catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as VercelRedisJobState;
    } catch {
      return null;
    }
  }

  /**
   * 换库后行写入一律 upsert：update 会 P2025 打空（行已被快照抹掉/尚未重建），
   * create 侧用调用方提供的行元数据补齐（kind/restoreFromId/includeObjects 等）。
   */
  private async upsertJobRow(
    jobId: string,
    kind: "auto" | "manual" | "restore",
    updateData: Record<string, unknown>,
    createData: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.backupJob
      .upsert({
        where: { id: jobId },
        update: updateData as never,
        create: {
          id: jobId,
          kind,
          status: "running",
          createdById: null,
          ...createData,
          ...updateData,
        } as never,
      })
      .catch(() => undefined);
  }

  /** upsert 的 create 侧补齐：恢复/失败路径重试行时用。 */
  private rowCreateOverrides(job: {
    restoreFromId: string | null;
    includeObjects: boolean;
    isProtection: boolean;
  }): Record<string, unknown> {
    return {
      restoreFromId: job.restoreFromId ?? null,
      includeObjects: job.includeObjects,
      isProtection: job.isProtection,
    };
  }

  /**
   * 修复源备份行（回滚来源）：换库后它回到快照时刻（执行中、无 manifest、
   * 可能无分支 id）。manifest 从 Redis 进度重建（finalize 前的对象清单每块
   * 都写 Redis），分支 id 按 `backup-<id>` 命名从 Neon 找回。恢复后源备份
   * 以「成功」呈现，回拷清单与后续再回滚都可用。行完好（有 manifest 且
   * 成功）时原样返回。
   */
  private async repairSourceBackupRow(
    sourceId: string,
  ): Promise<VercelJobRow | null> {
    const row = await this.prisma.backupJob
      .findUnique({ where: { id: sourceId } })
      .catch(() => null);
    if (!row) return null;
    if (row.manifest && row.status === "succeeded") {
      return row as unknown as VercelJobRow;
    }
    const state = await this.readRedisState(sourceId);
    const objects = state?.progress?.objects ?? [];
    const manifest = {
      formatVersion: 1,
      exportedAt: state?.updatedAt ?? new Date().toISOString(),
      kind: row.kind,
      objects,
      tables: {},
      errors: [],
    };
    let neonBranchId: string | null = row.neonBranchId;
    if (!neonBranchId) {
      try {
        const { branches } = await this.neon().listBranches();
        const found = branches.find((b) => b.name === `backup-${sourceId}`);
        if (found) neonBranchId = found.id;
      } catch {
        // 分支 id 找回失败不阻塞：行仍标记成功，后续回滚会提示缺分支。
      }
    }
    await this.upsertJobRow(
      sourceId,
      row.kind as "auto" | "manual",
      {
        status: "succeeded",
        phase: "done",
        finishedAt: new Date(),
        objectCount: objects.length,
        ...(neonBranchId ? { neonBranchId } : {}),
        manifest: manifest as never,
        progress: {
          stage: "done",
          done: objects.length,
          total: objects.length,
          objects,
        } as never,
      },
      {
        restoreFromId: null,
        includeObjects: row.includeObjects,
        isProtection: row.isProtection,
      },
    );
    return this.prisma.backupJob
      .findUnique({ where: { id: sourceId } })
      .catch(() => null) as unknown as Promise<VercelJobRow | null>;
  }

  /** 保护备份行被换库抹掉后重建为成功（finalize 的 Redis 状态带对象清单）。 */
  private async repairProtectionRow(protectId: string): Promise<void> {
    const state = await this.readRedisState(protectId);
    const objects = state?.progress?.objects ?? [];
    const manifest = {
      formatVersion: 1,
      exportedAt: state?.updatedAt ?? new Date().toISOString(),
      kind: "manual",
      objects,
      tables: {},
      errors: [],
    };
    await this.upsertJobRow(
      protectId,
      "manual",
      {
        status: "succeeded",
        phase: "done",
        finishedAt: new Date(),
        objectCount: objects.length,
        manifest: manifest as never,
        progress: {
          stage: "done",
          done: objects.length,
          total: objects.length,
          objects,
        } as never,
      },
      {
        restoreFromId: null,
        includeObjects: state?.includeObjects ?? false,
        isProtection: true,
      },
    );
  }

  /** Redis 里存在、但 DB 行已被换库抹掉的执行中任务（每日 cron 兜底用）。 */
  private async listOrphanedInFlightJobs(
    dbIds: Set<string>,
  ): Promise<string[]> {
    const client = await this.redis.getClient().catch(() => null);
    if (!client) return [];
    const keys = await client.keys(`${JOB_LOCK_KEY_PREFIX}*`).catch(() => null);
    if (!keys?.length) return [];
    const orphaned: string[] = [];
    for (const key of keys) {
      const jobId = key.slice(JOB_LOCK_KEY_PREFIX.length);
      if (!jobId || dbIds.has(jobId)) continue;
      const state = await this.readRedisState(jobId);
      if (!state?.kind || !state.progress) continue;
      const stage = state.progress.stage ?? "";
      if (stage === "" || stage === "done" || stage === "failed") continue;
      orphaned.push(jobId);
    }
    return orphaned;
  }

  /**
   * 孤儿分支清扫：deleteBackupNow/pruneRetention 删除分支失败时只记日志、
   * 行照样删（无重试路径），失败回滚也会遗留 pre-restore-* 保留分支——这些
   * 分支在 Neon 上永久残留（占分支配额）。每天 cron/Run 触发：
   * - `backup-<jobId>`：对应行不存在 → 孤儿，删
   * - `pre-restore-<restoreId>`：对应行不存在或已终态（成功/失败）→ 孤儿，删；
   *   行仍在执行（pending/running）→ 保留（由回滚收尾阶段自行清理）
   * deleteBranch 幂等（404 视为成功），失败只记日志、下轮 tick 重试。
   */
  async reconcileOrphanedBranches(): Promise<void> {
    let branches: Array<{ id: string; name: string }>;
    try {
      ({ branches } = await this.neon().listBranches());
    } catch (caught) {
      this.logger.warn(`孤儿分支清扫：列出分支失败 ${messageOfVercel(caught)}`);
      return;
    }
    const backupIds = new Set<string>();
    const restoreIds = new Set<string>();
    for (const branch of branches) {
      if (branch.name.startsWith("backup-")) {
        backupIds.add(branch.name.slice("backup-".length));
      } else if (branch.name.startsWith("pre-restore-")) {
        restoreIds.add(branch.name.slice("pre-restore-".length));
      }
    }
    const existingRows = new Set<string>();
    const restoreStatuses = new Map<string, string>();
    if (backupIds.size) {
      const rows = await this.prisma.backupJob
        .findMany({
          where: { id: { in: [...backupIds] } },
          select: { id: true },
        })
        .catch(() => null);
      for (const row of rows ?? []) existingRows.add(row.id);
    }
    if (restoreIds.size) {
      const rows = await this.prisma.backupJob
        .findMany({
          where: { id: { in: [...restoreIds] } },
          select: { id: true, status: true },
        })
        .catch(() => null);
      for (const row of rows ?? []) restoreStatuses.set(row.id, row.status);
    }
    const deleted: string[] = [];
    for (const branch of branches) {
      let orphan = false;
      if (branch.name.startsWith("backup-")) {
        orphan = !existingRows.has(branch.name.slice("backup-".length));
      } else if (branch.name.startsWith("pre-restore-")) {
        const status = restoreStatuses.get(
          branch.name.slice("pre-restore-".length),
        );
        orphan =
          status === undefined || status === "succeeded" || status === "failed";
      }
      if (!orphan) continue;
      await this.neon()
        .deleteBranch(branch.id)
        .catch((caught) =>
          this.logger.warn(
            `孤儿分支删除失败 ${branch.name}: ${messageOfVercel(caught)}`,
          ),
        );
      deleted.push(branch.name);
    }
    if (deleted.length) {
      this.logger.log(`孤儿分支清扫：删除 ${deleted.join(", ")}`);
    }
  }

  // ---- 保留策略（Vercel：Neon 分支 + R2 前缀）--------------------------------

  private async pruneRetention(): Promise<void> {
    const kind = "auto";
    const settings = await this.prisma.backupSettings
      .findFirst()
      .catch(() => null);
    const limit = settings?.autoRetention ?? 7;
    const rows = await this.prisma.backupJob.findMany({
      where: { kind: { in: [kind, "restore"] } },
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        restoreFromId: true,
        neonBranchId: true,
        manifest: true,
      },
    });
    const expired = retentionCandidates(rows, limit);
    const neon = this.neon();
    for (const row of expired) {
      // 先删 R2 前缀对象（manifest 记录逐个删，无 listObjects 接口不枚举 bucket）。
      if (row.neonBranchId) {
        await neon
          .deleteBranch(row.neonBranchId)
          .catch((caught) =>
            this.logger.warn(
              `删除 Neon 分支失败 ${row.neonBranchId}: ${messageOfVercel(caught)}`,
            ),
          );
      }
      const manifest = row.manifest as {
        objects?: Array<{ storageKey: string }>;
      } | null;
      if (manifest?.objects?.length) {
        try {
          const backend = await this.storage.backendFor("r2");
          for (const obj of manifest.objects) {
            await backend
              .removeObject(backupObjectKey(row.id, obj.storageKey))
              .catch(() => undefined);
          }
        } catch {
          // R2 清理失败仅记日志，行仍删除（下次不再重试文件，分支已删）。
        }
      }
      await this.prisma.backupJob
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      this.logger.log(`按保留策略删除 Vercel 旧备份 #${row.id}`);
    }
  }

  /** 管理员硬删除单个备份：Neon 分支 + R2 前缀对象 + Redis 状态 + DB 行。 */
  async deleteBackupNow(jobId: string): Promise<void> {
    const row = await this.prisma.backupJob
      .findUnique({ where: { id: jobId } })
      .catch(() => null);
    if (row?.neonBranchId) {
      await this.neon()
        .deleteBranch(row.neonBranchId)
        .catch((caught) =>
          this.logger.warn(
            `删除 Neon 分支失败 ${row.neonBranchId}: ${messageOfVercel(caught)}`,
          ),
        );
    }
    const manifest = row?.manifest as {
      objects?: Array<{ storageKey: string }>;
    } | null;
    if (manifest?.objects?.length) {
      try {
        const backend = await this.storage.backendFor("r2");
        for (const obj of manifest.objects) {
          await backend
            .removeObject(backupObjectKey(jobId, obj.storageKey))
            .catch(() => undefined);
        }
      } catch {
        // R2 清理失败仅记日志，行仍删除。
      }
    }
    // 清掉 Redis 里的进度与 per-job 锁（同一 key）。
    const client = await this.redis.getClient().catch(() => null);
    if (client) {
      await client.del(`${JOB_LOCK_KEY_PREFIX}${jobId}`).catch(() => undefined);
    }
    await this.prisma.backupJob
      .delete({ where: { id: jobId } })
      .catch(() => undefined);
    this.logger.log(`管理员硬删除 Vercel 备份 #${jobId}`);
  }

  // ---- 基础设施 ---------------------------------------------------------------

  private neon(): NeonClient {
    const apiKey = this.config.get<string>("NEON_API_KEY")?.trim();
    const projectId = this.config.get<string>("NEON_PROJECT_ID")?.trim();
    if (!apiKey || !projectId) {
      throw new Error(
        "缺少 NEON_API_KEY 或 NEON_PROJECT_ID，Vercel 备份不可用",
      );
    }
    return new NeonClient(apiKey, projectId);
  }

  private parseProgress(progress: unknown): VercelJobProgress {
    const raw = progress as VercelJobProgress | null;
    return {
      stage: raw?.stage ?? "",
      done: Number(raw?.done ?? 0),
      total: Number(raw?.total ?? 0),
      operationId: raw?.operationId ?? null,
      objects: raw?.objects ?? undefined,
      errors: raw?.errors ?? undefined,
      // protectJobId 是回滚链标记：各阶段进度必须携带（换库后重建靠它）。
      protectJobId: raw?.protectJobId ?? null,
    };
  }

  /** per-job Redis NX 锁：防止多个 serverless 实例同时推进同一任务。 */
  private async withJobLock<T>(
    jobId: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const client = await this.redis.getClient().catch(() => null);
    if (client) {
      const acquired = await client.set(`${JOB_LOCK_KEY_PREFIX}${jobId}`, "1", {
        NX: true,
        PX: JOB_LOCK_TTL_MS,
      });
      if (acquired !== "OK") return undefined; // 其他实例正在推进。
      try {
        return await fn();
      } finally {
        await client
          .del(`${JOB_LOCK_KEY_PREFIX}${jobId}`)
          .catch(() => undefined);
      }
    }
    return fn();
  }

  /**
   * 进度双写 Redis（回滚替换主库期间 UI 从 Redis 读，TTL 7 天）。
   * meta 里的行元数据供换库后重建行使用（recoverJobRow/repairProtectionRow）。
   */
  private async writeRedisState(
    jobId: string,
    progress: VercelJobProgress,
    meta?: {
      kind?: "auto" | "manual" | "restore";
      restoreFromId?: string | null;
      includeObjects?: boolean;
      isProtection?: boolean;
    },
  ): Promise<void> {
    const client = await this.redis.getClient().catch(() => null);
    if (!client) return;
    await client
      .set(
        `liveboard:backup:job:${jobId}`,
        JSON.stringify({
          jobId,
          kind: meta?.kind,
          restoreFromId: meta?.restoreFromId ?? null,
          includeObjects: meta?.includeObjects ?? false,
          isProtection: meta?.isProtection ?? false,
          progress,
          updatedAt: new Date().toISOString(),
        }),
        { EX: 7 * 24 * 60 * 60 },
      )
      .catch(() => undefined);
  }
}

async function collectTableCounts(
  prisma: PrismaService,
): Promise<Record<string, number>> {
  const tables = (await prisma.$queryRaw<
    Array<{ table_name: string }>
  >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`) as Array<{
    table_name: string;
  }>;
  const counts: Record<string, number> = {};
  for (const row of tables) {
    if (
      [
        "PendingUpload",
        "ServerMetricSample",
        "BackupJob",
        "BackupSettings",
        "_prisma_migrations",
      ].includes(row.table_name)
    ) {
      continue;
    }
    const result = (await prisma
      .$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM "public"."${row.table_name}"`,
      )
      .catch(() => null)) as Array<{ count: number }> | null;
    counts[row.table_name] = Number(result?.[0]?.count ?? 0);
  }
  return counts;
}

function messageOfVercel(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 自身公开地址：Vercel 自动注入的生产域名优先，其次 API_HOST（去尾斜杠）。 */
function selfBaseUrl(): string | null {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;
  const host = process.env.API_HOST?.trim();
  if (host) return host.replace(/\/+$/, "");
  return null;
}
