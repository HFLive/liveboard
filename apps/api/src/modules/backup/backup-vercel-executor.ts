import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import {
  collectObjectRefs,
  type ObjectRef,
} from "../migration/migration-engine";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { retentionCandidates } from "./backup-schedule";
import { NeonClient } from "./neon.client";
import { StorageService } from "../storage/storage.service";

/**
 * Vercel 备份/回滚的分块执行器（Serverless 无持久盘、函数 60s 超时）：
 * 备份 = Neon Snapshot + R2 对象复制到 backup/ 前缀；
 * 回滚 = Neon Snapshot finalized restore + R2 回拷。
 *
 * 每个 tick 推进一块（创建分支/等待操作/复制 ≤20 个对象/收尾），任务进度
 * 写 BackupJob 行（progress JSON）+ Redis 双份（回滚替换主库期间从 Redis
 * 重建被快照抹掉的任务行）。所有阶段幂等：断点重进不会损坏（分支操作由 Neon 保证原子，
 * 对象复制大小一致则跳过）。
 *
 * 约束：Neon Free 只允许一个手动 Snapshot；创建 Snapshot 的来源必须是默认
 * 根分支。回滚会瞬时创建一个新分支，验证成功后删除 Neon 标记的旧分支。
 */

interface VercelJobProgress {
  stage: string;
  done: number;
  total: number;
  operationId?: string | null;
  /** Neon 单个 API 调用可能返回多条异步操作，必须全部完成后才能推进。 */
  operationIds?: string[];
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
  /** restore POST 发出前保存的意图，用唯一保存分支确认超时请求是否已生效。 */
  preserveUnderName?: string | null;
  restoreRequestStartedAt?: string | null;
  /** Snapshot restore 的原目标、恢复后分支（收尾只删除明确的原目标）。 */
  targetBranchId?: string | null;
  restoredBranchId?: string | null;
  replacedBranchId?: string | null;
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
/** Neon Free 当前每个项目最多 10 个分支（含主分支与所有备份/瞬态分支）。 */
export const NEON_FREE_BRANCH_LIMIT = 10;
/** Snapshot finalized restore 会瞬时创建新分支并保留被替换的旧分支。 */
export const NEON_RESTORE_REQUIRED_FREE_BRANCHES = 1;
/** Neon Free 当前只允许一个手动 Snapshot。 */
export const NEON_FREE_MANUAL_SNAPSHOT_LIMIT = 1;
const JOB_LOCK_TTL_MS = 60_000;
/**
 * 任务进度与互斥锁必须使用不同的 key。旧实现两者都写
 * `liveboard:backup:job:<id>`：armRestoreChain 先写进度后，withJobLock 的
 * SET NX 永远失败，保护备份完成后的回滚本体因此无法进入状态机；普通任务
 * 在锁内写进度后，finally DEL 还会误删刚写入的恢复状态。
 */
const JOB_STATE_KEY_PREFIX = "liveboard:backup:job:";
const JOB_LOCK_KEY_PREFIX = "liveboard:backup:lock:";
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
/** 给 Nest 冷启动留足时间；目标端点一进入控制器就会立即 accepted。 */
const CONTINUATION_ACCEPT_TIMEOUT_MS = 10_000;

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
    private readonly maintenance: MaintenanceService,
  ) {}

  /** 免费版容量与拓扑预检；必须在创建 BackupJob 行之前调用。 */
  async assertBranchCapacity(
    operation: "backup" | "restore",
    backupKind: "auto" | "manual" = "manual",
  ): Promise<void> {
    // 回滚换库期间 Redis 是唯一不会随数据库快照倒退的状态源，必须 fail
    // closed；不能像本地开发那样在无 Redis 时继续执行。
    const redisClient = await this.redis.getClient();
    if (!redisClient) {
      throw new ServiceUnavailableException("Vercel 备份需要可用的 Redis");
    }
    await this.reconcileOrphanedSnapshots();
    await this.reconcileOrphanedBranches();
    const neon = this.neon();
    const { branches, primaryId } = await neon.listBranches();
    const primary = branches.find((branch) => branch.id === primaryId);
    if (!primaryId || !primary) {
      throw new ConflictException("Neon 项目中未找到默认分支");
    }
    if (primary.parent_id) {
      throw new ConflictException(
        "当前 Neon 默认分支不是根分支，Snapshot 备份已安全停用。请先按迁移文档把生产数据迁到新的 Neon 项目根分支；旧式分支回滚会继续制造无法删除的祖先分支。",
      );
    }
    if (operation === "backup") {
      const snapshots = await neon.listSnapshots();
      if (snapshots.length < NEON_FREE_MANUAL_SNAPSHOT_LIMIT) return;
      if (backupKind === "manual") {
        throw new ConflictException(
          "Neon 免费版只允许 1 个手动 Snapshot。请先在备份列表删除现有备份，再创建新的手动备份。",
        );
      }
      // 自动备份只轮换应用自身上一份成功的自动 Snapshot，绝不覆盖管理员
      // 手工备份或控制台中未知来源的 Snapshot。
      const snapshotIds = snapshots.map((snapshot) => snapshot.id);
      const rows = await this.prisma.backupJob.findMany({
        where: {
          neonBranchId: { in: snapshotIds },
          kind: "auto",
          status: "succeeded",
        },
        select: { id: true, neonBranchId: true },
      });
      const replaceable = rows.find((row) =>
        snapshotIds.includes(row.neonBranchId ?? ""),
      );
      if (!replaceable || snapshots.length > 1) {
        throw new ConflictException(
          "Neon 免费版的唯一 Snapshot 不是可轮换的自动备份；已跳过本次自动备份，请在管理页确认并删除旧备份后重试。",
        );
      }
      await this.deleteBackupNow(replaceable.id);
      return;
    }
    const required = NEON_RESTORE_REQUIRED_FREE_BRANCHES;
    const available = Math.max(0, NEON_FREE_BRANCH_LIMIT - branches.length);
    if (available >= required) return;

    const operationLabel = operation === "restore" ? "回滚" : "备份";
    throw new ConflictException(
      `Neon 免费版每个项目最多 ${NEON_FREE_BRANCH_LIMIT} 个分支；当前已有 ${branches.length} 个，${operationLabel}至少需要 ${required} 个空位。请先在 Neon 控制台确认并清理无用的旧式分支。`,
    );
  }

  /**
   * Vercel 没有持久状态文件，启动互斥必须同时看 DB 与 Redis。后者覆盖 Neon
   * 换库后任务行暂时消失的窗口，避免 cron/另一个函数实例又创建新任务并
   * 继续消耗免费版分支配额。
   */
  async findInFlightJobId(): Promise<string | null> {
    const row = await this.prisma.backupJob
      .findFirst({
        where: { status: { in: ["pending", "running"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      .catch(() => null);
    if (row?.id) return row.id;

    const { activeJobIds } = await this.activeRedisJobReferences();
    return activeJobIds.values().next().value ?? null;
  }

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
   * 最多等 10s（覆盖免费实例冷启动）确认下一棒 accepted，不等待其完成；URL 或密钥缺失时
   * 记录错误并由每日 cron 兜底。同一任务的并发由 per-job Redis 锁串行化。
   */
  private async scheduleContinuation(jobId: string): Promise<void> {
    const base = selfBaseUrl();
    const secret = process.env.CRON_SECRET?.trim();
    if (!base || !secret) {
      this.logger.error(
        `Vercel 任务 ${jobId} 无法接力：${!base ? "缺少自身公开地址" : "缺少 CRON_SECRET"}`,
      );
      return;
    }
    await fetch(
      `${base}/internal/cron/backup?jobId=${encodeURIComponent(jobId)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(CONTINUATION_ACCEPT_TIMEOUT_MS),
      },
    )
      .then((response) => {
        if (!response.ok) {
          this.logger.error(
            `Vercel 任务 ${jobId} 接力端点返回 HTTP ${response.status}`,
          );
        }
      })
      .catch((caught) =>
        this.logger.error(
          `Vercel 任务 ${jobId} 接力请求失败: ${messageOfVercel(caught)}`,
        ),
      );
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
      const { branches, primaryId } = await neon.listBranches();
      const primary = branches.find((branch) => branch.id === primaryId);
      if (!primaryId || !primary || primary.parent_id) {
        throw new Error(
          "Neon Snapshot 只能从默认根分支创建，请先完成生产库迁移",
        );
      }
      const intent: VercelJobProgress = {
        stage: "snapshot/requesting",
        done: 0,
        total: 1,
      };
      await row.update({
        where: { id: job.id },
        data: {
          status: "running",
          phase: "create-snapshot",
          progress: intent as never,
        },
      });
      await this.writeRedisState(job.id, intent, this.redisMetaFor(job));
      let created: Awaited<ReturnType<NeonClient["createSnapshot"]>>;
      try {
        created = await neon.createSnapshot(primaryId, `backup-${job.id}`);
      } catch (caught) {
        if (!isUncertainNeonMutation(caught)) throw caught;
        this.logger.warn(
          `Vercel 备份 ${job.id} 创建 Snapshot 的结果待确认：${messageOfVercel(caught)}`,
        );
        return;
      }
      const next: VercelJobProgress = {
        stage: "snapshot",
        done: 0,
        total: 1,
        operationId: created.operationId,
        operationIds: created.operationIds,
      };
      await row.update({
        where: { id: job.id },
        data: {
          neonBranchId: created.snapshotId,
          progress: next as never,
        },
      });
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "snapshot/requesting") {
      const snapshot = (await neon.listSnapshots()).find(
        (item) => item.name === `backup-${job.id}`,
      );
      if (!snapshot) {
        await sleep(1500);
        return;
      }
      const next: VercelJobProgress = {
        stage: "snapshot",
        done: 0,
        total: 1,
      };
      await row.update({
        where: { id: job.id },
        data: { neonBranchId: snapshot.id, progress: next as never },
      });
      await this.writeRedisState(job.id, next, this.redisMetaFor(job));
      return;
    }

    if (stage === "snapshot") {
      const finished = await neon.waitForOperation(
        progress.operationIds ?? progress.operationId ?? null,
        VERCEL_OPERATION_POLL_MS,
      );
      if (!finished) {
        const heartbeat: VercelJobProgress = {
          stage: "snapshot",
          done: 0,
          total: 1,
          operationId: progress.operationId ?? null,
          operationIds: progress.operationIds,
        };
        await this.prisma.backupJob
          .update({
            where: { id: job.id },
            data: { phase: "create-snapshot", progress: heartbeat as never },
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
      databaseResource: "neon_snapshot",
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

    if (stage === "") {
      // 校验来源 Snapshot 存在。
      const source = await this.prisma.backupJob
        .findUnique({ where: { id: job.restoreFromId ?? "" } })
        .catch(() => null);
      if (!source?.neonBranchId || source.status !== "succeeded") {
        throw new Error("来源备份缺少 Neon Snapshot 信息，无法回滚");
      }
      const { branches, primaryId } = await neon.listBranches();
      if (!primaryId) throw new Error("Neon 项目中未找到默认分支");
      const primary = branches.find((branch) => branch.id === primaryId);
      if (!primary || primary.parent_id) {
        throw new Error("当前 Neon 默认分支不是根分支，已拒绝旧式依赖链回滚");
      }
      // 先把非幂等 POST 的意图写进 DB + Redis，再调用 Neon。Vercel/Neon
      // 免费实例冷启动时可能出现「Neon 已接受请求，但 20s 内响应没回来」；
      // 若换库发生在响应丢失后，靠这份状态和唯一 preserve 分支继续确认，
      // 绝不能把同一个 restore POST 再发一次。
      const intent: VercelJobProgress = {
        stage: "restore/requesting",
        done: 0,
        total: 1,
        targetBranchId: primaryId,
        restoreRequestStartedAt: new Date().toISOString(),
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        { phase: "restore/requesting", error: null, progress: intent as never },
        this.rowCreateOverrides(job),
      );
      await this.writeRedisState(job.id, intent, this.redisMetaFor(job));
      // Neon 一旦接受 restore，当前写入可能随快照被覆盖。维护状态放 Redis，
      // 不随主库替换倒退；只有整条恢复链完成后才关闭。放在意图双写之后，
      // 这样 Redis 落盘失败时不会留下“尚未发请求却永久只读”的站点。
      await this.maintenance.setSystemEnabled(
        true,
        `正在从备份 #${(job.restoreFromId ?? "").slice(0, 8)} 回滚`,
      );

      let operationId: string | null;
      let operationIds: string[];
      let restoredBranchId: string;
      let replacedBranchId: string | null;
      try {
        ({
          operationId,
          operationIds,
          branchId: restoredBranchId,
          replacedBranchId,
        } = await neon.restoreSnapshot({
          snapshotId: source.neonBranchId,
          targetBranchId: primaryId,
        }));
      } catch (caught) {
        if (!isUncertainNeonMutation(caught)) {
          // Neon 明确返回 4xx 时 restore 没有被接受，可以安全退出只读模式。
          // 网络错误/超时以及 5xx 仍 fail closed：请求可能已在服务端生效，
          // 必须保持维护状态并靠后续状态核对确认，不能贸然恢复写入。
          if (isDefinitiveNeonRejection(caught)) {
            await this.maintenance.setSystemEnabled(false);
          }
          throw caught;
        }
        const message = messageOfVercel(caught);
        // 保持 running/requesting 与维护模式；下一棒只查询唯一分支标记，
        // 不重发 POST。错误同时写 DB，管理页能明确展示“结果待确认”。
        await this.upsertJobRow(
          job.id,
          "restore",
          { status: "running", phase: "restore/requesting", error: message },
          this.rowCreateOverrides(job),
        );
        this.logger.warn(`Vercel 回滚 ${job.id} 请求结果待确认：${message}`);
        return;
      }
      const next: VercelJobProgress = {
        stage: "restore/wait",
        done: 0,
        total: 1,
        operationId,
        operationIds,
        targetBranchId: primaryId,
        restoredBranchId,
        replacedBranchId,
      };
      // POST 返回时换库可能已经使原连接/任务行失效。Redis 中的 requesting
      // 意图已是安全兜底；先尽力升级为带 operation ids 的 wait，再尽力写
      // 新数据库。任一后写失败都不能把已接受的回滚误标 failed。
      await this.writeRedisState(job.id, next, this.redisMetaFor(job)).catch(
        (caught) =>
          this.logger.warn(
            `Vercel 回滚 ${job.id} 保存 Neon operation 到 Redis 失败，将按 requesting 标记确认：${messageOfVercel(caught)}`,
          ),
      );
      await this.upsertJobRow(
        job.id,
        "restore",
        { phase: "restore/restore", error: null, progress: next as never },
        this.rowCreateOverrides(job),
      ).catch((caught) =>
        this.logger.warn(
          `Vercel 回滚 ${job.id} 保存 Neon operation 到数据库失败，将从 Redis 重建：${messageOfVercel(caught)}`,
        ),
      );
      return;
    }

    if (stage === "restore/requesting") {
      // 上一棒没拿到响应：用 Neon 的 restored_from/restored_as 元数据确认，
      // 绝不重放非幂等 restore POST。
      const source = await this.prisma.backupJob
        .findUnique({ where: { id: job.restoreFromId ?? "" } })
        .catch(() => null);
      const sourceSnapshotId =
        source?.neonBranchId ??
        (await neon.listSnapshots()).find(
          (snapshot) => snapshot.name === `backup-${job.restoreFromId ?? ""}`,
        )?.id;
      const { branches } = await neon.listBranches();
      const restored = branches.find(
        (branch) =>
          branch.restored_from === sourceSnapshotId &&
          branch.restored_as === progress.targetBranchId,
      );
      if (restored) {
        const next: VercelJobProgress = {
          stage: "restore/verify",
          done: 0,
          total: 1,
          targetBranchId: progress.targetBranchId ?? null,
          restoredBranchId: restored.id,
          replacedBranchId: restored.restored_as ?? null,
        };
        await this.upsertJobRow(
          job.id,
          "restore",
          { phase: "restore/verify", error: null, progress: next as never },
          this.rowCreateOverrides(job),
        );
        await this.writeRedisState(job.id, next, this.redisMetaFor(job));
        return;
      }

      // 标记尚未出现时维持只读并短暂轮询；不更新状态可避免无限自调用。
      // 当前请求预算耗尽后停止接力，交由每日 cron 再确认，管理员也能从
      // 明确错误得知不能直接重新发起回滚。
      await sleep(1500);
      return;
    }

    if (stage === "restore/wait") {
      // 预算感知等待：Neon 恢复操作可数分钟，一棒 45s 内等不完。每棒轮询
      // 一小段，未完成则心跳更新进度（updatedAt 前进触发接力），下一棒继续
      // 轮询；完成才进入 verify。旧实现 5 分钟整棒死等，函数 60s 被杀、
      // 无接力续跑，回滚行永久卡「还原数据库」。
      const finished = await neon.waitForOperation(
        progress.operationIds ?? progress.operationId ?? null,
        VERCEL_OPERATION_POLL_MS,
      );
      if (!finished) {
        const heartbeat: VercelJobProgress = {
          stage: "restore/wait",
          done: 0,
          total: 1,
          operationId: progress.operationId ?? null,
          operationIds: progress.operationIds,
          targetBranchId: progress.targetBranchId ?? null,
          restoredBranchId: progress.restoredBranchId ?? null,
          replacedBranchId: progress.replacedBranchId ?? null,
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
        targetBranchId: progress.targetBranchId ?? null,
        restoredBranchId: progress.restoredBranchId ?? null,
        replacedBranchId: progress.replacedBranchId ?? null,
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
        targetBranchId: progress.targetBranchId ?? null,
        restoredBranchId: progress.restoredBranchId ?? null,
        replacedBranchId: progress.replacedBranchId ?? null,
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
            if (
              current &&
              current.size === obj.sizeBytes &&
              obj.sizeBytes > 0
            ) {
              // 幂等续跑：目标对象已与备份一致也算完成这一项。旧实现直接
              // continue 却不递增 done，会反复处理同一批对象并永久接力。
              done += 1;
              continue;
            }
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
        targetBranchId: progress.targetBranchId ?? null,
        restoredBranchId: progress.restoredBranchId ?? null,
        replacedBranchId: progress.replacedBranchId ?? null,
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
      // 只删除 Snapshot restore 响应/元数据明确标记为被替换的旧目标分支。
      // 不按名称猜测，不触碰默认分支、恢复后分支或有子分支的旧式祖先。
      try {
        const { branches, primaryId } = await neon.listBranches();
        const replaced = progress.replacedBranchId;
        const canDelete =
          replaced &&
          replaced !== primaryId &&
          replaced !== progress.restoredBranchId &&
          branches.some((branch) => branch.id === replaced) &&
          !branches.some((branch) => branch.parent_id === replaced);
        if (canDelete) await neon.deleteBranch(replaced);
      } catch (caught) {
        // 清理失败不阻塞完成：旧分支是回滚的最后防线，保留亦可。
        this.logger.warn(
          `Vercel 回滚 ${job.id} 清理旧分支失败: ${messageOfVercel(caught)}`,
        );
      }
      // 先确保 Redis 维护状态关闭成功，再把任务落 succeeded；若 Redis 暂时
      // 不可用则保留 running/cleanup，下一棒重试，普通写操作继续 fail closed。
      try {
        await this.maintenance.setSystemEnabled(false);
      } catch (caught) {
        // 数据已恢复但只读状态尚未可靠关闭：不能把任务落终态，也不能抛给
        // 通用失败处理（否则下一次不会重试）。仅用 DB 心跳保留 cleanup，
        // Redis 恢复后的下一棒再次关闭维护模式。
        await this.upsertJobRow(
          job.id,
          "restore",
          {
            status: "running",
            phase: "restore/cleanup",
            error: `恢复已完成，等待关闭维护模式：${messageOfVercel(caught)}`,
            progress: progress as never,
          },
          this.rowCreateOverrides(job),
        );
        return;
      }
      const next: VercelJobProgress = {
        stage: "done",
        done: progress.total,
        total: progress.total,
        targetBranchId: progress.targetBranchId ?? null,
        restoredBranchId: progress.restoredBranchId ?? null,
        replacedBranchId: progress.replacedBranchId ?? null,
      };
      await this.upsertJobRow(
        job.id,
        "restore",
        {
          status: "succeeded",
          phase: "done",
          error: null,
          finishedAt: new Date(),
          progress: next as never,
        },
        this.rowCreateOverrides(job),
      );
      // DB 已确认成功且维护模式已关闭，终态 Redis 仅用于展示/清扫提示；此时
      // 写失败不能把已完成的数据回滚误标 failed。DB 终态会覆盖旧 Redis 进度。
      await this.writeRedisState(job.id, next, this.redisMetaFor(job)).catch(
        (caught) =>
          this.logger.warn(
            `Vercel 回滚 ${job.id} 终态写入 Redis 失败: ${messageOfVercel(caught)}`,
          ),
      );
      this.logger.log(`Vercel 回滚 ${job.id} 完成`);
    }
  }

  // ---- 换库后的行重建（Snapshot restore 会替换主库）------------------------

  /**
   * 回滚链建立时立即在 Redis 落下完整元数据：换库后 BackupJob 里备份点之后
   * 创建的回滚行会被 Snapshot 中的旧数据库状态抹掉，重建必须靠这份状态。
   * 在 startRestore 里调用，早于任何推进。
   */
  async armRestoreChain(
    jobId: string,
    restoreFromId: string,
    protectJobId: string | null,
    includeObjects: boolean,
  ): Promise<void> {
    await this.writeRedisState(
      jobId,
      {
        stage: "",
        done: 0,
        total: 0,
        ...(protectJobId ? { protectJobId } : {}),
      },
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
      .get(`${JOB_STATE_KEY_PREFIX}${jobId}`)
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
      databaseResource: "neon_snapshot",
      exportedAt: state?.updatedAt ?? new Date().toISOString(),
      kind: row.kind,
      objects,
      tables: {},
      errors: [],
    };
    let neonBranchId: string | null = row.neonBranchId;
    if (!neonBranchId) {
      try {
        const snapshots = await this.neon().listSnapshots();
        const found = snapshots.find(
          (snapshot) => snapshot.name === `backup-${sourceId}`,
        );
        if (found) neonBranchId = found.id;
      } catch {
        // Snapshot id 找回失败不阻塞：后续回滚会明确提示缺少资源。
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
      databaseResource: "neon_snapshot",
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
    const keys = await client
      .keys(`${JOB_STATE_KEY_PREFIX}*`)
      .catch(() => null);
    if (!keys?.length) return [];
    const orphaned: string[] = [];
    for (const key of keys) {
      const jobId = key.slice(JOB_STATE_KEY_PREFIX.length);
      if (!jobId || dbIds.has(jobId)) continue;
      const state = await this.readRedisState(jobId);
      if (!state?.kind || !state.progress) continue;
      const stage = state.progress.stage ?? "";
      if (stage === "" || stage === "done" || stage === "failed") continue;
      // DB 已明确落终态时，以 DB 为准。stale 兜底可能先把行标 failed，Redis
      // 仍保留最后一次运行进度；若把它当换库孤儿重建，会让已失败的回滚复活。
      const persisted = await this.prisma.backupJob
        .findUnique({ where: { id: jobId }, select: { status: true } })
        .catch(() => null);
      if (persisted?.status === "succeeded" || persisted?.status === "failed") {
        continue;
      }
      orphaned.push(jobId);
    }
    return orphaned;
  }

  /**
   * 孤儿分支清扫：deleteBackupNow/pruneRetention 删除分支失败时只记日志、
   * 行照样删（无重试路径），失败回滚也会遗留 pre-restore-* 保留分支——这些
   * 分支在 Neon 上永久残留（占分支配额）。每天 cron/Run 触发：
   * - `backup-<jobId>`：对应行不存在或任务已失败 → 不可用于回滚，删分支
   * - `pre-restore-<restoreId>`：对应行不存在或已终态（成功/失败）→ 孤儿，删；
   *   行仍在执行（pending/running）→ 保留（由回滚收尾阶段自行清理）
   * - 根分支（parent_id 为空，恢复时被保留的最早默认分支）不可删，跳过；
   *   先删叶子（backup-*）再删父（pre-restore-*）——Neon 不允许删除仍有
   *   子分支的分支
   * deleteBranch 幂等（404 视为成功），失败只记日志、下轮 tick 重试。
   */
  async reconcileOrphanedBranches(): Promise<void> {
    let branches: Array<{
      id: string;
      name: string;
      parent_id?: string | null;
    }>;
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
    const backupStatuses = new Map<string, string>();
    const restoreStatuses = new Map<string, string>();
    // Neon 换库后，restore/保护备份行会暂时从 DB 消失，随后才从 Redis
    // 重建。清扫必须把 Redis 中仍活跃的任务与其保护备份视为“有引用”，
    // 否则会在重建前误删最后恢复点。
    const { activeJobIds, activeProtectionIds } =
      await this.activeRedisJobReferences();
    if (backupIds.size) {
      const rows = await this.prisma.backupJob
        .findMany({
          where: { id: { in: [...backupIds] } },
          select: { id: true, status: true },
        })
        .catch(() => null);
      for (const row of rows ?? []) backupStatuses.set(row.id, row.status);
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
    const orphans: Array<{ id: string; name: string }> = [];
    for (const branch of branches) {
      if (!branch.parent_id) continue; // 根分支不可删（Neon 平台规则）。
      let orphan = false;
      if (branch.name.startsWith("backup-")) {
        const jobId = branch.name.slice("backup-".length);
        const status = backupStatuses.get(jobId);
        orphan =
          (status === undefined || status === "failed") &&
          !activeJobIds.has(jobId) &&
          !activeProtectionIds.has(jobId);
      } else if (branch.name.startsWith("pre-restore-")) {
        const restoreId = branch.name.slice("pre-restore-".length);
        const status = restoreStatuses.get(restoreId);
        orphan =
          !activeJobIds.has(restoreId) &&
          (status === undefined ||
            status === "succeeded" ||
            status === "failed");
      }
      if (orphan) orphans.push({ id: branch.id, name: branch.name });
    }
    // 先删叶子（backup-*）再删父（pre-restore-*），否则父分支删除被拒。
    orphans.sort((a, b) => {
      const aIsBackup = a.name.startsWith("backup-") ? 0 : 1;
      const bIsBackup = b.name.startsWith("backup-") ? 0 : 1;
      return aIsBackup - bIsBackup;
    });
    const deleted: string[] = [];
    for (const branch of orphans) {
      const removed = await this.neon()
        .deleteBranch(branch.id)
        .then(() => true)
        .catch((caught) => {
          this.logger.warn(
            `孤儿分支删除失败 ${branch.name}: ${messageOfVercel(caught)}`,
          );
          return false;
        });
      if (removed) deleted.push(branch.name);
    }
    if (deleted.length) {
      this.logger.log(`孤儿分支清扫：删除 ${deleted.join(", ")}`);
    }
  }

  /** 清理 createSnapshot 响应丢失或失败任务留下的应用 Snapshot。 */
  async reconcileOrphanedSnapshots(): Promise<void> {
    const neon = this.neon();
    const snapshots = await neon.listSnapshots().catch((caught) => {
      this.logger.warn(`孤儿 Snapshot 清扫失败: ${messageOfVercel(caught)}`);
      return [];
    });
    const candidates = snapshots.filter((snapshot) =>
      snapshot.name.startsWith("backup-"),
    );
    if (!candidates.length) return;
    const ids = candidates.map((snapshot) =>
      snapshot.name.slice("backup-".length),
    );
    const rows = await this.prisma.backupJob
      .findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true },
      })
      .catch(() => []);
    const statusById = new Map(rows.map((row) => [row.id, row.status]));
    const { activeJobIds } = await this.activeRedisJobReferences();
    for (const snapshot of candidates) {
      const jobId = snapshot.name.slice("backup-".length);
      const status = statusById.get(jobId);
      if (
        activeJobIds.has(jobId) ||
        status === "pending" ||
        status === "running" ||
        status === "succeeded"
      ) {
        continue;
      }
      await neon
        .deleteSnapshot(snapshot.id)
        .then((deleted) =>
          neon.waitForOperation(deleted.operationIds, VERCEL_OPERATION_POLL_MS),
        )
        .catch((caught) =>
          this.logger.warn(
            `孤儿 Snapshot 删除失败 ${snapshot.name}: ${messageOfVercel(caught)}`,
          ),
        );
    }
  }

  /** Redis 中仍需保留 Neon 分支的活跃任务，以及活跃回滚引用的保护备份。 */
  private async activeRedisJobReferences(): Promise<{
    activeJobIds: Set<string>;
    activeProtectionIds: Set<string>;
  }> {
    const activeJobIds = new Set<string>();
    const activeProtectionIds = new Set<string>();
    const protectionByRestore = new Map<string, string>();
    const client = await this.redis.getClient().catch(() => null);
    if (!client) return { activeJobIds, activeProtectionIds };
    const keys = await client
      .keys(`${JOB_STATE_KEY_PREFIX}*`)
      .catch(() => null);
    for (const key of keys ?? []) {
      const jobId = key.slice(JOB_STATE_KEY_PREFIX.length);
      if (!jobId) continue;
      const state = await this.readRedisState(jobId);
      if (!state?.kind || !state.progress) continue;
      const stage = state.progress.stage ?? "";
      if (stage === "done" || stage === "failed") continue;
      activeJobIds.add(jobId);
      if (state.kind === "restore") {
        const protectId = this.protectJobIdOf(state.progress);
        if (protectId) protectionByRestore.set(jobId, protectId);
      }
    }
    // DB 的明确终态覆盖 Redis 里的旧运行快照。换库窗口中行会缺失而不是变成
    // 终态，因此这个过滤不会误伤真正需要从 Redis 恢复的任务。
    if (activeJobIds.size) {
      const terminalRows = await this.prisma.backupJob
        .findMany({
          where: {
            id: { in: [...activeJobIds] },
            status: { in: ["succeeded", "failed"] },
          },
          select: { id: true },
        })
        .catch(() => null);
      for (const row of terminalRows ?? []) activeJobIds.delete(row.id);
    }
    for (const [restoreId, protectId] of protectionByRestore) {
      if (activeJobIds.has(restoreId)) activeProtectionIds.add(protectId);
    }
    return { activeJobIds, activeProtectionIds };
  }

  // ---- 保留策略（Vercel：Neon Snapshot + R2 前缀）----------------------------

  private async deleteNeonBackupResource(row: {
    id: string;
    neonBranchId: string | null;
    manifest: unknown;
  }): Promise<void> {
    const neon = this.neon();
    const snapshots = await neon.listSnapshots().catch(() => []);
    const snapshot = snapshots.find(
      (item) =>
        item.id === row.neonBranchId || item.name === `backup-${row.id}`,
    );
    const manifest = row.manifest as { databaseResource?: string } | null;
    if (snapshot || manifest?.databaseResource === "neon_snapshot") {
      const snapshotId = snapshot?.id ?? row.neonBranchId;
      if (snapshotId) {
        const deleted = await neon.deleteSnapshot(snapshotId);
        const finished = await neon.waitForOperation(
          deleted.operationIds,
          VERCEL_OPERATION_POLL_MS,
        );
        if (!finished) {
          throw new Error("Neon Snapshot 仍在删除中，请稍后重试");
        }
      }
      return;
    }
    // 发布前遗留行仍可能指向旧式 backup-* 分支；只保留兼容清理能力，
    // 新任务永远不会创建这种分支。
    if (row.neonBranchId) await neon.deleteBranch(row.neonBranchId);
  }

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
    for (const row of expired) {
      let externalCleanupSucceeded = true;
      if (row.neonBranchId) {
        await this.deleteNeonBackupResource(row).catch((caught) => {
          externalCleanupSucceeded = false;
          this.logger.warn(
            `删除 Neon 备份资源失败 ${row.neonBranchId}: ${messageOfVercel(caught)}`,
          );
        });
      }
      const manifest = row.manifest as {
        objects?: Array<{ storageKey: string }>;
      } | null;
      if (manifest?.objects?.length) {
        try {
          const backend = await this.storage.backendFor("r2");
          for (const obj of manifest.objects) {
            await backend.removeObject(backupObjectKey(row.id, obj.storageKey));
          }
        } catch (caught) {
          externalCleanupSucceeded = false;
          this.logger.warn(
            `删除 R2 备份对象失败 ${row.id}: ${messageOfVercel(caught)}`,
          );
        }
      }
      // 外部资源没清干净时保留 DB 行，下次保留策略/管理员删除可继续重试。
      if (!externalCleanupSucceeded) continue;
      await this.prisma.backupJob
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      this.logger.log(`按保留策略删除 Vercel 旧备份 #${row.id}`);
    }
  }

  /** 管理员硬删除单个备份：Neon Snapshot/旧分支 + R2 + Redis + DB 行。 */
  async deleteBackupNow(jobId: string): Promise<void> {
    const row = await this.prisma.backupJob
      .findUnique({ where: { id: jobId } })
      .catch(() => null);
    if (row) {
      await this.deleteNeonBackupResource(row);
    } else {
      // 非幂等 createSnapshot 超时后可能尚未写回 DB，按确定性名称找回。
      const snapshot = (
        await this.neon()
          .listSnapshots()
          .catch(() => [])
      ).find((item) => item.name === `backup-${jobId}`);
      if (snapshot) {
        const neon = this.neon();
        const deleted = await neon.deleteSnapshot(snapshot.id);
        const finished = await neon.waitForOperation(
          deleted.operationIds,
          VERCEL_OPERATION_POLL_MS,
        );
        if (!finished) {
          throw new Error("Neon Snapshot 仍在删除中，请稍后重试");
        }
      }
    }
    const manifest = row?.manifest as {
      objects?: Array<{ storageKey: string }>;
    } | null;
    const inFlight = row?.progress as {
      objects?: Array<{ storageKey: string }>;
    } | null;
    const objects = manifest?.objects ?? inFlight?.objects ?? [];
    if (objects.length) {
      const backend = await this.storage.backendFor("r2");
      for (const obj of objects) {
        await backend.removeObject(backupObjectKey(jobId, obj.storageKey));
      }
    }
    // 清掉 Redis 里的进度与 per-job 锁（两者使用独立 key）。
    const client = await this.redis.getClient().catch(() => null);
    if (client) {
      await Promise.all([
        client.del(`${JOB_STATE_KEY_PREFIX}${jobId}`).catch(() => undefined),
        client.del(`${JOB_LOCK_KEY_PREFIX}${jobId}`).catch(() => undefined),
      ]);
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
      operationIds: raw?.operationIds ?? undefined,
      objects: raw?.objects ?? undefined,
      errors: raw?.errors ?? undefined,
      // protectJobId 是回滚链标记：各阶段进度必须携带（换库后重建靠它）。
      protectJobId: raw?.protectJobId ?? null,
      preserveUnderName: raw?.preserveUnderName ?? null,
      restoreRequestStartedAt: raw?.restoreRequestStartedAt ?? null,
      targetBranchId: raw?.targetBranchId ?? null,
      restoredBranchId: raw?.restoredBranchId ?? null,
      replacedBranchId: raw?.replacedBranchId ?? null,
    };
  }

  /** per-job Redis NX 锁：防止多个 serverless 实例同时推进同一任务。 */
  private async withJobLock<T>(
    jobId: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const client = await this.redis.getClient();
    if (!client) {
      throw new ServiceUnavailableException("Vercel 备份需要可用的 Redis");
    }
    const acquired = await client.set(`${JOB_LOCK_KEY_PREFIX}${jobId}`, "1", {
      NX: true,
      PX: JOB_LOCK_TTL_MS,
    });
    if (acquired !== "OK") return undefined; // 其他实例正在推进。
    try {
      return await fn();
    } finally {
      await client.del(`${JOB_LOCK_KEY_PREFIX}${jobId}`).catch(() => undefined);
    }
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
    const client = await this.redis.getClient();
    if (!client) {
      throw new ServiceUnavailableException("Vercel 备份需要可用的 Redis");
    }
    await client.set(
      `${JOB_STATE_KEY_PREFIX}${jobId}`,
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
    );
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

function isUncertainNeonMutation(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    (caught as { neonMutationUncertain?: unknown }).neonMutationUncertain ===
      true
  );
}

function isDefinitiveNeonRejection(caught: unknown): boolean {
  if (typeof caught !== "object" || caught === null) return false;
  const status = (caught as { status?: unknown }).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 自身公开地址：生产域名优先，其次部署域名（函数运行时必定注入），最后
 * API_HOST。曾线上翻车：项目改名/重建后 VERCEL_PROJECT_PRODUCTION_URL
 * 缺失 → selfBaseUrl 返回 null → 接力续跑静默跳过（scheduleContinuation
 * 里 `if (!base || !secret) return`）→ 链条在请求内预算（20s）后断裂，
 * 任务永久「进行中」。
 */
function selfBaseUrl(): string | null {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;
  // VERCEL_URL = 当前部署专属域名（liveboard-<hash>-*.vercel.app），
  // 服务器函数运行时始终存在；自调用打到部署域名同样可达。
  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment}`;
  const host = process.env.API_HOST?.trim();
  if (host) return host.replace(/\/+$/, "");
  return null;
}
