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
    if (!rows) return;
    for (const row of rows) {
      await this.withJobLock(row.id, () => this.advanceJob(row));
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
      const row = await this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null);
      if (!row) return;
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
  private async advanceJob(job: {
    id: string;
    kind: "auto" | "manual" | "restore";
    status: "pending" | "running" | "succeeded" | "failed";
    neonBranchId: string | null;
    restoreFromId: string | null;
    includeObjects: boolean;
    phase: string;
    progress: unknown;
    error: string | null;
    createdAt: Date;
  }): Promise<void> {
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
      await this.prisma.backupJob
        .update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: messageOfVercel(caught),
            finishedAt: new Date(),
            phase: job.phase || "failed",
          },
        })
        .catch(() => undefined);
      await this.writeRedisState(job.id, {
        ...progress,
        stage: "failed",
        errors: [...(progress.errors ?? []), messageOfVercel(caught)],
      }).catch(() => undefined);
    }
  }

  // ---- 备份状态机（auto / manual）------------------------------------------

  private async advanceBackup(
    job: {
      id: string;
      kind: "auto" | "manual" | "restore";
      phase: string;
      progress: unknown;
      error: string | null;
      createdAt: Date;
      includeObjects: boolean;
    },
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
      await this.writeRedisState(job.id, {
        stage: "branch",
        done: 0,
        total: 1,
        operationId,
      });
      return;
    }

    if (stage === "branch") {
      // 等待分支创建操作完成。
      await neon.waitForOperation(progress.operationId ?? null);
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
      await this.writeRedisState(job.id, {
        stage: "copy-objects",
        done: 0,
        total: objects.length,
        objects,
      });
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
      await this.writeRedisState(job.id, next);
      return;
    }

    if (stage === "finalize") {
      await this.finalizeBackup(job, [], progress.objects ?? [], progress);
    }
  }

  /** 备份收尾：manifest + 调度标记 + 保留策略 + 回滚链唤醒。 */
  private async finalizeBackup(
    job: { id: string; kind: "auto" | "manual" | "restore"; createdAt: Date },
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
    await this.writeRedisState(job.id, { ...progress, stage: "done" });
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
    job: {
      id: string;
      status: string;
      phase: string;
      progress: unknown;
      error: string | null;
      restoreFromId: string | null;
      createdAt: Date;
    },
    progress: VercelJobProgress,
  ): Promise<void> {
    const stage = progress.stage || "";
    const neon = this.neon();
    const row = this.prisma.backupJob;

    // 链等待：保护备份尚未成功（pending 停在 initial，由 wakePendingRestores 唤醒）。
    if (job.status === "pending") return;

    if (stage === "") {
      // 校验来源备份分支存在。
      const source = await row.findUnique({
        where: { id: job.restoreFromId ?? "" },
      });
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
      };
      await row.update({
        where: { id: job.id },
        data: { phase: "restore/restore", progress: next as never },
      });
      await this.writeRedisState(job.id, next);
      return;
    }

    if (stage === "restore/wait") {
      await neon.waitForOperation(progress.operationId ?? null);
      const next: VercelJobProgress = {
        stage: "restore/verify",
        done: 0,
        total: 1,
      };
      await row.update({
        where: { id: job.id },
        data: { phase: "restore/verify", progress: next as never },
      });
      await this.writeRedisState(job.id, next);
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
      };
      await row.update({
        where: { id: job.id },
        data: { phase: "restore/objects", progress: next as never },
      });
      await this.writeRedisState(job.id, next);
      return;
    }

    if (stage === "restore/objects") {
      // 从备份 manifest 拿对象清单回拷（无对象任务直接进 cleanup）。
      const source = await row.findUnique({
        where: { id: job.restoreFromId ?? "" },
      });
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
            const sourceKey = backupObjectKey(job.id, obj.storageKey);
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
      };
      await row.update({
        where: { id: job.id },
        data: {
          phase: finished ? "restore/cleanup" : "restore/objects",
          progress: next as never,
        },
      });
      await this.writeRedisState(job.id, next);
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
      };
      await row.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          phase: "done",
          finishedAt: new Date(),
          progress: next as never,
        },
      });
      await this.writeRedisState(job.id, next);
      this.logger.log(`Vercel 回滚 ${job.id} 完成`);
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

  /** 进度双写 Redis（回滚替换主库期间 UI 从 Redis 读，TTL 7 天）。 */
  private async writeRedisState(
    jobId: string,
    progress: VercelJobProgress,
  ): Promise<void> {
    const client = await this.redis.getClient().catch(() => null);
    if (!client) return;
    await client
      .set(
        `liveboard:backup:job:${jobId}`,
        JSON.stringify({
          jobId,
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
