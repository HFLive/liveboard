import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { requireSuperAdmin } from "../../common/require-super-admin";
import { PrismaService } from "../prisma/prisma.service";
import {
  readJobState,
  writeJobState,
  STALE_PENDING_MS,
  STALE_RUNNING_MS,
  type MigrationJobFileState,
  type MigrationJobStatus,
} from "../migration/migration-job-file";
import {
  backupDataPaths,
  ensureBackupDirs,
  type BackupDataPaths,
} from "./backup-dirs";
import {
  BackupVercelExecutor,
  VERCEL_ADVANCE_BUDGET_MS,
} from "./backup-vercel-executor";
import {
  initialLastAutoBackupAt,
  RETENTION_MAX,
  RETENTION_MIN,
  SCHEDULE_HOUR_MAX,
  SCHEDULE_HOUR_MIN,
  SCHEDULE_MINUTE_MAX,
  SCHEDULE_MINUTE_MIN,
  SCHEDULE_WEEKDAY_MAX,
  SCHEDULE_WEEKDAY_MIN,
  retentionCandidates,
  shouldRunAutoBackup,
  vercelFireWindowMs,
} from "./backup-schedule";

export type BackupJobKind = "auto" | "manual" | "restore";
export type BackupJobStatus = MigrationJobStatus;

export interface BackupJobProgress {
  done: number;
  total: number;
  label?: string;
}

/** 状态文件的 kind（避免与迁移的 export/import 冲突，见 migration-job-file.ts）。 */
export type BackupFileJobKind = "auto_backup" | "manual_backup" | "restore";

export interface BackupJobSummary {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStatus;
  phase: string;
  progress: BackupJobProgress | null;
  backupPath: string | null;
  restoreFromId: string | null;
  neonBranchId: string | null;
  /** BigInt 序列化为字符串（Prisma BigInt 直接 JSON.stringify 会抛错）。 */
  dumpSizeBytes: string | null;
  objectCount: number | null;
  includeObjects: boolean;
  /** 回滚前自动创建的保护备份（UI 显示「回滚前自动备份」）。 */
  isProtection: boolean;
  manifest: unknown;
  error: string | null;
  createdBy: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
}

export interface BackupSettingsDto {
  enabled: boolean;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleWeekday: number | null;
  autoRetention: number;
  includeObjects: boolean;
  lastAutoBackupAt: string | null;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettingsDto = {
  enabled: false,
  scheduleHour: 3,
  scheduleMinute: 0,
  scheduleWeekday: null,
  autoRetention: 7,
  includeObjects: true,
  lastAutoBackupAt: null,
};

/** Vercel 下 Neon 分支数量保守上限（Free 计划 10 分支/项目，含主分支与瞬态）。 */
export const VERGEL_MAX_BACKUP_BRANCHES = 8;

/** Prisma P2021（表不存在）：回滚腾空窗口（DROP SCHEMA）期间 User/BackupJob 表被删。 */
function isTableMissingError(caught: unknown): boolean {
  const error = caught as { code?: unknown; message?: unknown };
  return (
    error?.code === "P2021" ||
    (typeof error?.message === "string" &&
      error.message.includes("does not exist"))
  );
}

function jobKindToFileKind(kind: BackupJobKind): BackupFileJobKind {
  return kind === "auto"
    ? "auto_backup"
    : kind === "manual"
      ? "manual_backup"
      : "restore";
}

function fileKindToJobKind(kind: string | undefined): BackupJobKind {
  // 兼容两种输入：状态文件的文件 kind（auto_backup/manual_backup）与
  // DB 行的任务 kind（auto/manual）；识别不出的缺省按 restore 处理
  // （restore 行无状态文件时也只可能是它）。
  if (kind === "auto_backup" || kind === "auto") return "auto";
  if (kind === "manual_backup" || kind === "manual") return "manual";
  return "restore";
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly paths: BackupDataPaths;
  /**
   * 本进程正在运行的备份/回滚任务（互斥锁）。启动任务前同步置位以关闭并发竞态，
   * spawnScript 成功后替换为真实 jobId，子进程 exit 时清空；"starting" 是
   * 异步校验期间占位的哨兵值。
   */
  private runningJobId: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vercelExecutor: BackupVercelExecutor,
  ) {
    this.paths = backupDataPaths(config);
  }

  // ---- 生命周期与调度 -------------------------------------------------------

  /** 自托管：常驻 tick（每分钟），驱动自动备份调度与 stale 兜底；Vercel 跳过。 */
  onApplicationBootstrap(): void {
    if (this.isVercelDeployment()) return;
    this.tickTimer = setInterval(() => void this.tick(), 60_000);
    this.tickTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private isVercelDeployment(): boolean {
    return this.config.get<string>("DEPLOYMENT_TARGET") === "vercel";
  }

  /**
   * 统一的调度 tick（self_hosted 由进程内 setInterval 触发，Vercel 由
   * vercel.json crons 打 internal/cron/backup 端点触发，见 backup.controller）。
   * 干两件事：自动备份判定 + stale 兜底解锁。Vercel 的分块任务推进在
   * backup-vercel-executor 中（阶段 4）。
   */
  async tick(): Promise<{ ran: boolean; reason?: string }> {
    try {
      await this.reconcileStaleJobStates();
      await this.reconcileOrphanedRestores();
    } catch (caught) {
      this.logger.warn(`tick 兜底失败: ${messageOf(caught)}`);
    }
    if (this.isVercelDeployment()) {
      // Vercel：自动备份创建与分块推进都由 cron 驱动。cron 最小每日一次，
      // 判定用周期宽窗口（到点后的任何一次 tick 都算窗口内，同周期只跑
      // 一次）；到点则先创建自动备份任务，随后与存量任务一起推进。
      const settings = await this.getSettingsRow().catch(() => null);
      if (
        settings &&
        shouldRunAutoBackup(settings, new Date(), vercelFireWindowMs(settings))
      ) {
        try {
          await this.startAutoBackup(null);
        } catch (caught) {
          this.logger.warn(`Vercel 自动备份启动失败: ${messageOf(caught)}`);
        }
      }
      // 分块推进（backup-vercel-executor 状态机）：新建任务与存量任务
      // 各推进一块；请求内创建的任务已由 startAutoBackup 推进到完成。
      await this.vercelExecutor
        .advance()
        .catch((caught) =>
          this.logger.warn(`Vercel 任务推进失败: ${messageOf(caught)}`),
        );
      return { ran: false, reason: "vercel-executor" };
    }
    const settings = await this.getSettingsRow().catch(() => null);
    if (!settings || !shouldRunAutoBackup(settings, new Date())) {
      return { ran: false, reason: "not-scheduled" };
    }
    try {
      await this.startAutoBackup(null);
      return { ran: true };
    } catch (caught) {
      this.logger.warn(`自动备份启动失败: ${messageOf(caught)}`);
      return { ran: false, reason: messageOf(caught) };
    }
  }

  // ---- 互斥锁 ---------------------------------------------------------------

  /** 同步抢占互斥锁：已有任务（含正在启动的）则拒绝，无任务则置哨兵占位。 */
  private reserveJobLock(): void {
    if (this.runningJobId) {
      throw new ConflictException(
        "已有备份或回滚任务正在执行，请等待其完成后再启动新任务",
      );
    }
    this.runningJobId = "starting";
  }

  private releaseJobLock(): void {
    this.runningJobId = null;
  }

  /**
   * 文件级互斥检查：任务真实进度以状态文件为准（回滚会重建 BackupJob 表），
   * 同时扫描 backup-jobs/ 与迁移的 jobs/ 两个目录，发现 pending/running 即拒绝。
   * 备份↔迁移双向防护：迁移导入（DROP SCHEMA）期间不能备份（打出不一致快照），
   * 备份/回滚期间也不能导入。检查前先对 stale 状态做兜底清理。
   */
  private async assertNoRunningJobInFiles(): Promise<void> {
    await this.reconcileStaleJobStates();
    const states = await this.readAllStateFiles();
    for (const [jobId, state] of states) {
      if (state.status === "running" || state.status === "pending") {
        throw new ConflictException(
          `已有任务 #${jobId}（${state.kind}）正在执行或等待启动，请等待其完成后再启动新任务`,
        );
      }
    }
  }

  /**
   * TTL 兜底：把超过阈值仍未更新的 pending/running 状态文件落为 failed，
   * 解锁后续任务。阈值保守（见 migration-job-file.ts 常量注释）。
   */
  private async reconcileStaleJobStates(): Promise<void> {
    const now = Date.now();
    for (const [jobId, state] of await this.readAllStateFiles()) {
      if (state.status !== "pending" && state.status !== "running") continue;
      const maxAge =
        state.status === "pending" ? STALE_PENDING_MS : STALE_RUNNING_MS;
      const updatedAt = state.updatedAt
        ? new Date(state.updatedAt).getTime()
        : NaN;
      const age = Number.isFinite(updatedAt) ? now - updatedAt : Infinity;
      if (age < maxAge) continue;
      this.logger.warn(
        `备份任务 ${jobId} 状态文件失联（${state.status}，updatedAt=${state.updatedAt}），已自动解锁落为 failed`,
      );
      await writeJobState(this.paths.backupJobsDir, jobId, {
        status: "failed",
        error:
          state.status === "pending"
            ? "备份进程未能启动，已自动解锁"
            : "备份进程失联，已自动解锁",
        finishedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  /**
   * 子进程退出后，若状态文件仍停留在 pending/running（进程异常退出、从未写入
   * 终态），落为 failed，避免 stale 状态把后续任务永久锁死。
   */
  private async failStuckJobState(
    jobId: string,
    exitCode: number | null,
  ): Promise<void> {
    const state = await readJobState(this.paths.backupJobsDir, jobId);
    if (!state) return;
    if (state.status === "pending" || state.status === "running") {
      await writeJobState(this.paths.backupJobsDir, jobId, {
        status: "failed",
        error: `备份进程异常退出（exit=${exitCode ?? "null"}）`,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * 回滚链兜底：restore 任务行在保护备份 spawn 前就落库（pending），若服务重启
   * 中断了链（保护备份已成功但 restore 未 spawn，或根本没 spawn），restore 行
   * 会永久停在 pending 且无状态文件。回滚是显式确认的稀有操作，不自动恢复，
   * 落 failed 提示可重新发起，避免误操作。
   */
  private async reconcileOrphanedRestores(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PENDING_MS);
    const rows = await this.prisma.backupJob
      .findMany({
        where: {
          kind: "restore",
          status: "pending",
          createdAt: { lt: staleBefore },
        },
      })
      .catch(() => null);
    if (!rows) return;
    for (const row of rows) {
      const state = await readJobState(this.paths.backupJobsDir, row.id);
      if (state) continue; // 有状态文件说明链正在执行或已被处理。
      await this.prisma.backupJob
        .update({
          where: { id: row.id },
          data: {
            status: "failed",
            error: "服务重启中断了回滚流程，未执行任何改动，可重新发起",
          },
        })
        .catch(() => undefined);
      this.logger.warn(
        `回滚任务 ${row.id} 失去链（pending 且无状态文件），已落 failed`,
      );
    }
  }

  // ---- 部署形态与降级 ---------------------------------------------------------

  private assertBackupSupported(): void {
    if (this.isVercelDeployment()) {
      const configured =
        process.env.NEON_API_KEY?.trim() && process.env.NEON_PROJECT_ID?.trim();
      if (!configured) {
        throw new ServiceUnavailableException(
          "Vercel 备份需要配置 NEON_API_KEY 与 NEON_PROJECT_ID 环境变量",
        );
      }
      return;
    }
    if (!ensureBackupDirs(this.paths)) {
      throw new ServiceUnavailableException(
        "无法访问备份数据目录，请检查 MIGRATION_DATA_DIR 挂载",
      );
    }
  }

  /**
   * 状态类接口的鉴权：正常返回 "admin"。回滚腾空窗口（DROP SCHEMA → pg_restore）
   * 期间 User 表不存在，任何 DB 查询都报 P2021；此时若确有回滚任务在运行，返回
   * "degraded"，由调用方降级为纯状态文件读取，避免前端轮询整条链路 500。
   */
  private async authorizeForStateRead(
    userId: string | null,
  ): Promise<"admin" | "degraded"> {
    try {
      await requireSuperAdmin(this.prisma, userId);
      return "admin";
    } catch (caught) {
      if (isTableMissingError(caught) && (await this.hasRunningRestoreJob())) {
        return "degraded";
      }
      throw caught;
    }
  }

  /** 状态文件里是否存在运行中的回滚任务（回滚窗口的唯一可信信号）。 */
  private async hasRunningRestoreJob(): Promise<boolean> {
    for (const state of (await this.readAllStateFiles()).values()) {
      if (
        state.kind === "restore" &&
        (state.status === "running" || state.status === "pending")
      ) {
        return true;
      }
    }
    return false;
  }

  // ---- 设置 ---------------------------------------------------------------

  private async getSettingsRow() {
    return this.prisma.backupSettings.findFirst().catch(() => null);
  }

  async getSettings(): Promise<BackupSettingsDto> {
    const row = await this.getSettingsRow();
    if (!row) return DEFAULT_BACKUP_SETTINGS;
    return {
      enabled: row.enabled,
      scheduleHour: row.scheduleHour,
      scheduleMinute: row.scheduleMinute,
      scheduleWeekday: row.scheduleWeekday,
      autoRetention: row.autoRetention,
      includeObjects: row.includeObjects,
      lastAutoBackupAt: row.lastAutoBackupAt?.toISOString() ?? null,
    };
  }

  async updateSettings(
    userId: string | null,
    input: {
      enabled?: boolean;
      scheduleHour?: number;
      scheduleMinute?: number;
      scheduleWeekday?: number | null;
      autoRetention?: number;
      includeObjects?: boolean;
    },
  ): Promise<BackupSettingsDto> {
    if (this.isVercelDeployment()) this.assertBackupSupported();
    const user = await requireSuperAdmin(this.prisma, userId);
    const next: BackupSettingsDto = {
      ...(await this.getSettings()),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.scheduleHour !== undefined
        ? { scheduleHour: input.scheduleHour }
        : {}),
      ...(input.scheduleMinute !== undefined
        ? { scheduleMinute: input.scheduleMinute }
        : {}),
      ...(input.scheduleWeekday !== undefined
        ? { scheduleWeekday: input.scheduleWeekday }
        : {}),
      ...(input.autoRetention !== undefined
        ? { autoRetention: input.autoRetention }
        : {}),
      ...(input.includeObjects !== undefined
        ? { includeObjects: input.includeObjects }
        : {}),
    };
    if (
      !Number.isInteger(next.scheduleHour) ||
      next.scheduleHour < SCHEDULE_HOUR_MIN ||
      next.scheduleHour > SCHEDULE_HOUR_MAX ||
      !Number.isInteger(next.scheduleMinute) ||
      next.scheduleMinute < SCHEDULE_MINUTE_MIN ||
      next.scheduleMinute > SCHEDULE_MINUTE_MAX ||
      (next.scheduleWeekday != null &&
        (!Number.isInteger(next.scheduleWeekday) ||
          next.scheduleWeekday < SCHEDULE_WEEKDAY_MIN ||
          next.scheduleWeekday > SCHEDULE_WEEKDAY_MAX))
    ) {
      throw new BadRequestException(
        `自动备份时间无效：时 ${SCHEDULE_HOUR_MIN}–${SCHEDULE_HOUR_MAX}，分 ${SCHEDULE_MINUTE_MIN}–${SCHEDULE_MINUTE_MAX}，星期 ${SCHEDULE_WEEKDAY_MIN}–${SCHEDULE_WEEKDAY_MAX}（或留空=每天）`,
      );
    }
    if (
      !Number.isInteger(next.autoRetention) ||
      next.autoRetention < RETENTION_MIN ||
      next.autoRetention > RETENTION_MAX
    ) {
      throw new BadRequestException(
        `自动备份保留份数需在 ${RETENTION_MIN}–${RETENTION_MAX} 之间`,
      );
    }
    // 首次启用：把 lastAutoBackupAt 置为调度基点，严格到点（当天不执行）。
    // 只有从未备份过（lastAutoBackupAt 为空）才需要置位；关闭再开启保留旧值。
    // lastAutoBackupAt 平时是服务端维护的标记（不随保存刷新），仅本次置位时写库。
    let lastToWrite: Date | null = null;
    if (next.enabled && next.lastAutoBackupAt == null) {
      next.lastAutoBackupAt = initialLastAutoBackupAt(next, new Date());
      lastToWrite = new Date(next.lastAutoBackupAt);
    }
    const workspace = await this.prisma.workspace.findFirst({
      select: { id: true },
    });
    if (!workspace) throw new ServiceUnavailableException("工作区未初始化");
    await this.prisma.backupSettings.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        ...next,
        lastAutoBackupAt: next.lastAutoBackupAt
          ? new Date(next.lastAutoBackupAt)
          : null,
        updatedById: user.id,
      },
      update: {
        enabled: next.enabled,
        scheduleHour: next.scheduleHour,
        scheduleMinute: next.scheduleMinute,
        scheduleWeekday: next.scheduleWeekday,
        autoRetention: next.autoRetention,
        includeObjects: next.includeObjects,
        ...(lastToWrite ? { lastAutoBackupAt: lastToWrite } : {}),
        updatedById: user.id,
      },
    });
    return next;
  }

  // ---- 功能信息 -------------------------------------------------------------

  private confirmPhrase(): string {
    return (
      process.env.BACKUP_RESTORE_CONFIRM_PHRASE?.trim() || "CONFIRM-RESTORE"
    );
  }

  async getInfo(userId: string | null) {
    // 回滚腾空窗口期间 DB 不可用，按降级只返回低敏感展示信息。
    const mode = await this.authorizeForStateRead(userId);
    const vercel = this.isVercelDeployment();
    const neonConfigured = Boolean(
      process.env.NEON_API_KEY?.trim() && process.env.NEON_PROJECT_ID?.trim(),
    );
    const base = {
      deploymentTarget: vercel ? "vercel" : "self_hosted",
      supported: vercel ? neonConfigured : ensureBackupDirs(this.paths),
      unavailableReason: vercel
        ? neonConfigured
          ? null
          : "Vercel 备份需要配置 NEON_API_KEY 与 NEON_PROJECT_ID 环境变量"
        : ensureBackupDirs(this.paths)
          ? null
          : "无法访问备份数据目录，请检查 MIGRATION_DATA_DIR 挂载",
      defaults: {
        autoRetention: DEFAULT_BACKUP_SETTINGS.autoRetention,
        schedule: {
          hour: DEFAULT_BACKUP_SETTINGS.scheduleHour,
          minute: DEFAULT_BACKUP_SETTINGS.scheduleMinute,
          weekday: DEFAULT_BACKUP_SETTINGS.scheduleWeekday,
        },
      },
    };
    if (mode === "degraded") return base;
    return {
      ...base,
      settings: await this.getSettings(),
      confirmPhrase: this.confirmPhrase(),
      vercelLimits: vercel
        ? { maxBackupBranches: VERGEL_MAX_BACKUP_BRANCHES }
        : undefined,
    };
  }

  // ---- 状态查询 -------------------------------------------------------------

  async listJobs(userId: string | null): Promise<BackupJobSummary[]> {
    const mode = await this.authorizeForStateRead(userId);
    const stateFiles = await this.readAllStateFiles();
    // 回滚腾空窗口期间 DB 不可用：仅返回状态文件里的任务（进度仍在更新）。
    if (mode === "degraded") {
      const summaries: BackupJobSummary[] = [];
      for (const [id, state] of stateFiles) {
        summaries.push(await this.mergeJob(id, state, null));
      }
      return summaries.sort((a, b) =>
        (b.createdAt ?? b.updatedAt ?? "").localeCompare(
          a.createdAt ?? a.updatedAt ?? "",
        ),
      );
    }
    const rows = await this.prisma.backupJob
      .findMany({ orderBy: { createdAt: "desc" }, take: 50 })
      .catch(() => null);
    const byId = new Map(rows?.map((row) => [row.id, row]) ?? []);
    const ids = new Set<string>();
    for (const row of rows ?? []) ids.add(row.id);
    for (const file of stateFiles.values()) ids.add(file.jobId);
    const summaries: BackupJobSummary[] = [];
    for (const id of ids) {
      summaries.push(
        await this.mergeJob(
          id,
          stateFiles.get(id) ?? null,
          byId.get(id) ?? null,
        ),
      );
    }
    return summaries.sort((a, b) =>
      (b.createdAt ?? b.updatedAt ?? "").localeCompare(
        a.createdAt ?? a.updatedAt ?? "",
      ),
    );
  }

  async getJob(
    userId: string | null,
    jobId: string,
  ): Promise<BackupJobSummary> {
    const mode = await this.authorizeForStateRead(userId);
    if (mode === "degraded") {
      const state = await readJobState(this.paths.backupJobsDir, jobId);
      if (!state) throw new NotFoundException("备份任务不存在");
      return this.mergeJob(jobId, state, null);
    }
    const [state, row] = await Promise.all([
      readJobState(this.paths.backupJobsDir, jobId),
      this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null),
    ]);
    if (!state && !row) throw new NotFoundException("备份任务不存在");
    return this.mergeJob(jobId, state, row);
  }

  /** 清除失败任务的报错信息（"已读/知道了"），照抄 migration.service 模式。 */
  async dismissJobError(
    userId: string | null,
    jobId: string,
  ): Promise<BackupJobSummary> {
    const mode = await this.authorizeForStateRead(userId);
    const [state, row] = await Promise.all([
      readJobState(this.paths.backupJobsDir, jobId),
      mode === "degraded"
        ? Promise.resolve(null)
        : this.prisma.backupJob
            .findUnique({ where: { id: jobId } })
            .catch(() => null),
    ]);
    if (!state && !row) throw new NotFoundException("备份任务不存在");
    const status = state?.status ?? row?.status;
    if (status === "running" || status === "pending") {
      throw new BadRequestException("任务仍在运行中，不能清除报错信息");
    }
    if (state) {
      await writeJobState(this.paths.backupJobsDir, jobId, { error: null });
    }
    if (row) {
      await this.prisma.backupJob
        .update({ where: { id: jobId }, data: { error: null } })
        .catch(() => undefined);
    }
    const freshState = await readJobState(this.paths.backupJobsDir, jobId);
    const freshRow =
      mode === "degraded"
        ? null
        : await this.prisma.backupJob
            .findUnique({ where: { id: jobId } })
            .catch(() => null);
    return this.mergeJob(jobId, freshState, freshRow ?? row);
  }

  /**
   * 管理员硬删除单个备份（含内容、状态文件与记录，不可恢复）。
   * 回滚记录、执行中的任务、被排队/执行中回滚引用的备份不可删。
   * 自托管：rm 目录 + 状态文件 + DB 行；Vercel：executor 清理 Neon 分支与 R2 对象。
   */
  async deleteBackup(jobId: string): Promise<{ deleted: true }> {
    const [state, row] = await Promise.all([
      readJobState(this.paths.backupJobsDir, jobId),
      this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null),
    ]);
    if (!state && !row) throw new NotFoundException("备份任务不存在");
    // 状态文件缺省时（Vercel 无持久盘）必须回退到 DB 行的 kind，
    // 不能把未知 kind 默认成 restore（否则所有删除都被误判为回滚记录）。
    const kind = fileKindToJobKind(state?.kind ?? row?.kind) as BackupJobKind;
    if (kind === "restore") {
      throw new BadRequestException("回滚记录是操作日志，不能删除");
    }
    const status = state?.status ?? row?.status;
    // Vercel：允许删除等待中/执行中的任务——pending 尚未产生任何资源，
    // running 由 deleteBackupNow 全量清理（Neon 分支、R2 对象、Redis 锁）。
    // 自托管有本地子进程与文件级互斥，维持原限制，等任务结束再删。
    if (
      !this.isVercelDeployment() &&
      (status === "pending" || status === "running")
    ) {
      throw new ConflictException("备份正在执行中，请等待其完成后删除");
    }
    // 引用保护：正在排队/执行的回滚不能丢失来源备份。
    const referenced = await this.prisma.backupJob
      .findFirst({
        where: {
          kind: "restore",
          status: { in: ["pending", "running"] },
          restoreFromId: jobId,
        },
        select: { id: true },
      })
      .catch(() => null);
    if (referenced) {
      throw new ConflictException(
        "该备份正被回滚任务引用，删除会破坏回滚，已取消",
      );
    }
    if (this.isVercelDeployment()) {
      await this.vercelExecutor.deleteBackupNow(jobId);
    } else {
      await this.removeBackupFiles(jobId);
      await this.prisma.backupJob
        .delete({ where: { id: jobId } })
        .catch(() => undefined);
    }
    this.logger.log(`管理员硬删除备份 #${jobId}`);
    return { deleted: true };
  }

  // ---- 任务启动 -------------------------------------------------------------

  /**
   * 接力续跑入口：self-invocation 打 internal/cron/backup?jobId=<id> 时
   * 只推进指定任务（不跑整轮 tick），让手动备份/回滚链逐棒推进到完成。
   * 自托管任务由常驻 tick 驱动，不接受该入口。
   */
  async continueVercelJob(jobId: string): Promise<{ continued: boolean }> {
    if (!this.isVercelDeployment()) return { continued: false };
    await this.vercelExecutor.advanceUntilFinished(jobId);
    return { continued: true };
  }

  /** 手动备份：立即创建一个 manual 任务并 spawn 执行。 */
  async startManualBackup(
    userId: string | null,
    options: { includeObjects?: boolean },
  ): Promise<BackupJobSummary> {
    this.reserveJobLock();
    let spawned = false;
    try {
      this.assertBackupSupported();
      const user = await requireSuperAdmin(this.prisma, userId);
      await this.assertNoRunningJobInFiles();
      const settings = await this.getSettings();
      const includeObjects =
        options.includeObjects !== undefined
          ? options.includeObjects
          : settings.includeObjects;
      const job = await this.createJobRow(user.id, "manual", includeObjects);
      if (this.isVercelDeployment()) {
        // Vercel：不 spawn，创建后立即在请求内分块推进到完成（预算内，
        // 见 backup-vercel-executor.advanceUntilFinished），不再等每日 cron。
        spawned = true;
        await this.vercelExecutor
          .advanceUntilFinished(job.id)
          .catch((caught) =>
            this.logger.warn(`Vercel 手动备份推进失败: ${messageOf(caught)}`),
          );
        return await this.loadJob(job.id);
      }
      this.spawnScript(
        "backup-run",
        [
          "--job-id",
          job.id,
          "--kind",
          "manual",
          includeObjects ? "--include-objects" : "--no-objects",
          "--concurrency",
          "4",
        ],
        job.id,
      );
      spawned = true;
      return await this.loadJob(job.id);
    } catch (caught) {
      if (!spawned) this.releaseJobLock();
      throw caught;
    }
  }

  /**
   * 从备份回滚。先自动创建一次 manual 级保护备份（回滚前的最后防线），
   * 保护备份成功后由 spawnRestoreChain 链式启动 restore 任务。
   * 互斥锁覆盖整条链（保护备份 → 回滚），期间拒绝任何新任务启动。
   */
  async startRestore(
    userId: string | null,
    backupId: string,
    options: { confirm: string; includeObjects?: boolean },
  ): Promise<{ preBackup: BackupJobSummary; restore: BackupJobSummary }> {
    this.reserveJobLock();
    let chainArmed = false;
    try {
      this.assertBackupSupported();
      const user = await requireSuperAdmin(this.prisma, userId);
      const expectedConfirm = this.confirmPhrase();
      if (!options.confirm || options.confirm.trim() !== expectedConfirm) {
        throw new BadRequestException(
          `请输入确认语 ${expectedConfirm} 以确认从备份回滚`,
        );
      }
      const backup = await this.prisma.backupJob.findUnique({
        where: { id: backupId },
      });
      if (!backup || (backup.kind !== "auto" && backup.kind !== "manual")) {
        throw new NotFoundException("备份不存在");
      }
      if (backup.status !== "succeeded") {
        throw new BadRequestException("只能从成功的备份回滚");
      }
      if (!this.isVercelDeployment()) {
        // 自托管：备份内容必须完整存在（manifest + dump），否则回滚会在半途失败。
        if (!ensureBackupDirs(this.paths)) {
          throw new ServiceUnavailableException(
            "无法访问备份数据目录，请检查挂载",
          );
        }
        await stat(
          path.join(this.paths.backupsDir, backupId, "manifest.json"),
        ).catch(() => {
          throw new BadRequestException("备份文件缺失，无法回滚");
        });
        await this.assertNoRunningJobInFiles();
      }
      const settings = await this.getSettings();
      const preInclude = settings.includeObjects;
      const restoreInclude =
        options.includeObjects !== undefined
          ? options.includeObjects
          : backup.includeObjects;
      // 保护备份任务（manual）先落库；restore 任务行同时落库（pending），
      // UI 可展示整条链；保护备份失败时由 reconcileOrphanedRestores 落 failed。
      const preBackup = await this.createJobRow(
        user.id,
        "manual",
        preInclude,
        true, // isProtection：UI 显示「回滚前自动备份」
      );
      const restoreRow = await this.prisma.backupJob.create({
        data: {
          kind: "restore",
          status: "pending",
          restoreFromId: backupId,
          includeObjects: restoreInclude,
          createdById: user.id,
        },
        select: { id: true },
      });
      chainArmed = true;
      if (!this.isVercelDeployment()) {
        this.spawnRestoreChain(
          preBackup.id,
          backupId,
          restoreRow.id,
          preInclude,
          restoreInclude,
          options.confirm.trim(),
        );
      } else {
        // Vercel：链由 executor 推进（保护备份完成后 wakePendingRestores
        // 唤醒回滚）。两条任务在请求内立即推进，共享同一预算（合计不超
        // Vercel 函数 60s 上限）；预算耗尽自动接力续跑（self-invocation），
        // 直至完成，断链时由每日 cron 兜底。
        this.logger.log(
          `Vercel 回滚链已建立：保护备份 ${preBackup.id} → 回滚 ${restoreRow.id}`,
        );
        const chainDeadline = Date.now() + VERCEL_ADVANCE_BUDGET_MS;
        await this.vercelExecutor
          .advanceUntilFinished(preBackup.id, chainDeadline)
          .catch((caught) =>
            this.logger.warn(`Vercel 保护备份推进失败: ${messageOf(caught)}`),
          );
        await this.vercelExecutor
          .advanceUntilFinished(restoreRow.id, chainDeadline)
          .catch((caught) =>
            this.logger.warn(`Vercel 回滚推进失败: ${messageOf(caught)}`),
          );
      }
      return {
        preBackup: await this.loadJob(preBackup.id),
        restore: await this.loadJob(restoreRow.id),
      };
    } catch (caught) {
      if (!chainArmed) this.releaseJobLock();
      throw caught;
    }
  }

  /**
   * 回滚链：spawn 保护备份；其成功结束后 spawn 回滚任务。锁由 spawnScript
   * 的 onExit 在链全部结束后释放。保护备份失败时链中止（restore 行由
   * reconcileOrphanedRestores 兜底落 failed）。
   */
  private spawnRestoreChain(
    preBackupId: string,
    backupId: string,
    restoreJobId: string,
    preInclude: boolean,
    restoreInclude: boolean,
    confirm: string,
  ): void {
    this.spawnScript(
      "backup-run",
      [
        "--job-id",
        preBackupId,
        "--kind",
        "manual",
        "--protect",
        preInclude ? "--include-objects" : "--no-objects",
        "--concurrency",
        "4",
      ],
      preBackupId,
      async (code) => {
        const state = await readJobState(this.paths.backupJobsDir, preBackupId);
        if (code !== 0 || state?.status !== "succeeded") {
          this.logger.warn(
            `保护备份 ${preBackupId} 失败，回滚链中止（restore ${restoreJobId} 等待兜底）`,
          );
          return;
        }
        this.logger.log(
          `保护备份 ${preBackupId} 成功，启动回滚 ${restoreJobId}`,
        );
        this.runningJobId = restoreJobId;
        this.spawnScript(
          "backup-restore",
          [
            "--job-id",
            restoreJobId,
            "--backup",
            backupId,
            "--confirm",
            confirm,
            restoreInclude ? "--include-objects" : "--no-objects",
            "--concurrency",
            "4",
          ],
          restoreJobId,
        );
      },
    );
  }

  /** 自动备份（tick 触发）：不关联用户，成功后更新 lastAutoBackupAt。 */
  private async startAutoBackup(userId: string | null): Promise<void> {
    this.reserveJobLock();
    let spawned = false;
    try {
      this.assertBackupSupported();
      if (userId) await requireSuperAdmin(this.prisma, userId);
      await this.assertNoRunningJobInFiles();
      const settings = await this.getSettings();
      const job = await this.createJobRow(
        userId,
        "auto",
        settings.includeObjects,
      );
      if (this.isVercelDeployment()) {
        // Vercel：不 spawn，创建后立即在请求内分块推进到完成（预算内）。
        spawned = true;
        await this.vercelExecutor
          .advanceUntilFinished(job.id)
          .catch((caught) =>
            this.logger.warn(`Vercel 自动备份推进失败: ${messageOf(caught)}`),
          );
        return;
      }
      this.spawnScript(
        "backup-run",
        [
          "--job-id",
          job.id,
          "--kind",
          "auto",
          settings.includeObjects ? "--include-objects" : "--no-objects",
          "--concurrency",
          "4",
        ],
        job.id,
      );
      spawned = true;
    } catch (caught) {
      if (!spawned) this.releaseJobLock();
      throw caught;
    }
  }

  // ---- 内部实现 -------------------------------------------------------------

  private async createJobRow(
    userId: string | null,
    kind: BackupJobKind,
    includeObjects: boolean,
    isProtection = false,
  ): Promise<{ id: string }> {
    const row = await this.prisma.backupJob.create({
      data: {
        kind,
        status: "pending",
        includeObjects,
        isProtection,
        createdById: userId ?? null,
      },
      select: { id: true },
    });
    await writeJobState(this.paths.backupJobsDir, row.id, {
      kind: jobKindToFileKind(kind),
      status: "pending",
      phase: "prepare",
      startedAt: new Date().toISOString(),
      includeObjects,
      ...(isProtection ? { isProtection: true } : {}),
    }).catch(() => undefined);
    return row;
  }

  private spawnScript(
    script: "backup-run" | "backup-restore",
    args: string[],
    jobId: string,
    onExit?: (exitCode: number | null) => Promise<void>,
  ) {
    const apiRoot = path.resolve(__dirname, "..", "..", "..");
    const scriptPath = path.join(apiRoot, "scripts", `${script}.ts`);
    const tsx = path.join(apiRoot, "node_modules", ".bin", "tsx");
    // 锁替换为真实 jobId；子进程 exit/error 时清锁。
    this.runningJobId = jobId;
    let child: ChildProcess;
    try {
      child = spawn(tsx, [scriptPath, ...args], {
        env: process.env,
        stdio: "inherit",
        detached: true,
      });
    } catch (caught) {
      this.logger.error(`无法启动备份脚本 ${script}: ${messageOf(caught)}`);
      throw new ServiceUnavailableException(
        "无法启动备份脚本，请检查 API 镜像内是否包含 tsx 与 scripts 目录",
      );
    }
    const releaseLock = () => {
      if (this.runningJobId === jobId) this.runningJobId = null;
    };
    child.on("error", (err) => {
      this.logger.error(`备份脚本 ${script} 启动失败: ${err.message}`);
      releaseLock();
      void this.failStuckJobState(jobId, null).catch((caught) =>
        this.logger.warn(`处理启动失败状态失败: ${messageOf(caught)}`),
      );
    });
    child.on("exit", (code) => {
      this.logger.log(`备份任务 ${jobId}（${script}）结束，exit=${code}`);
      void (async () => {
        await this.reconcileJobFromState(jobId).catch((caught) =>
          this.logger.warn(`回写备份任务记录失败: ${messageOf(caught)}`),
        );
        // 回滚会把 BackupJob 表还原成备份点快照：除刚结束的任务行外，源备份
        // 停在 dump 时的 pending、保护备份行整个消失，都是陈旧快照；按状态文件
        // 全量重放幂等修正（状态文件是回滚窗口期间唯一准确的信息源）。
        const doneState = await readJobState(
          this.paths.backupJobsDir,
          jobId,
        ).catch(() => null);
        if (doneState && fileKindToJobKind(doneState.kind) === "restore") {
          await this.reconcileAllJobsFromState().catch((caught) =>
            this.logger.warn(
              `回滚后任务记录全量重放失败: ${messageOf(caught)}`,
            ),
          );
        }
        await this.failStuckJobState(jobId, code).catch((caught) =>
          this.logger.warn(`处理异常退出状态失败: ${messageOf(caught)}`),
        );
        await this.onBackupFinished(jobId).catch((caught) =>
          this.logger.warn(
            `备份收尾（保留策略/调度更新）失败: ${messageOf(caught)}`,
          ),
        );
        if (onExit) {
          // 回滚链：保护备份结束后由 onExit 决定是否启动回滚；
          // 链期间保持锁，全部结束后才释放。
          await onExit(code).catch((caught) =>
            this.logger.warn(`回滚链处理失败: ${messageOf(caught)}`),
          );
        }
        releaseLock();
      })();
    });
    child.unref();
  }

  /**
   * 备份任务终态收尾：auto 备份成功后更新 lastAutoBackupAt，并触发保留策略
   * 清理（手动备份无上限，不清理）。
   */
  private async onBackupFinished(jobId: string): Promise<void> {
    const state = await readJobState(this.paths.backupJobsDir, jobId);
    if (!state || state.status !== "succeeded") return;
    const kind = fileKindToJobKind(state.kind);
    if (kind === "restore") return;
    if (kind !== "auto") return;
    const settings = await this.getSettings();
    await this.prisma.backupSettings
      .updateMany({ data: { lastAutoBackupAt: new Date() } })
      .catch(() => undefined);
    await this.pruneRetention(settings.autoRetention);
  }

  /** 保留策略：删除超出 limit 的最旧成功自动备份（先删文件再删行）。 */
  private async pruneRetention(limit: number): Promise<void> {
    const kind = "auto";
    // 查询需包含 restore 行：retentionCandidates 用它们构建「回滚中引用保护」。
    const rows = await this.prisma.backupJob.findMany({
      where: { kind: { in: [kind, "restore"] } },
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        restoreFromId: true,
      },
    });
    const expired = retentionCandidates(rows, limit);
    for (const row of expired) {
      await this.removeBackupFiles(row.id).catch(() => undefined);
      await this.prisma.backupJob
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      this.logger.log(`按保留策略删除旧备份 #${row.id}`);
    }
  }

  /** 删除备份内容目录与状态文件（自托管路径；Vercel 由 executor 清理 R2/Neon）。 */
  private async removeBackupFiles(jobId: string): Promise<void> {
    await rm(path.join(this.paths.backupsDir, jobId), {
      recursive: true,
      force: true,
    });
    await rm(path.join(this.paths.backupJobsDir, `${jobId}.json`), {
      force: true,
    });
  }

  /** 子进程结束后把状态文件回写到 BackupJob 行（回滚的初始行已被腾空重建）。 */
  private async reconcileJobFromState(jobId: string): Promise<void> {
    const state = await readJobState(this.paths.backupJobsDir, jobId);
    if (!state) return;
    const kind = fileKindToJobKind(state.kind);
    const { backupPath, manifest, ...rest } = state as MigrationJobFileState & {
      backupPath?: string | null;
    };
    await this.prisma.backupJob
      .upsert({
        where: { id: jobId },
        create: {
          id: jobId,
          kind,
          status: state.status,
          phase: state.phase,
          progress: state.progress as never,
          manifest: state.manifest as never,
          error: state.error,
          includeObjects: state.includeObjects ?? false,
          isProtection: state.isProtection ?? false,
          restoreFromId: state.restoreFromId ?? null,
          startedAt: state.startedAt ? new Date(state.startedAt) : null,
          finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
          createdById: null,
        },
        update: {
          status: state.status,
          phase: state.phase,
          progress: state.progress as never,
          manifest: state.manifest as never,
          error: state.error,
          // 状态文件缺字段时不动行内旧值（旧格式状态文件无这三个键）。
          ...(state.includeObjects !== undefined
            ? { includeObjects: state.includeObjects }
            : {}),
          ...(state.isProtection !== undefined
            ? { isProtection: state.isProtection }
            : {}),
          ...(state.restoreFromId !== undefined
            ? { restoreFromId: state.restoreFromId }
            : {}),
          finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
        },
      })
      .catch((caught) => {
        this.logger.warn(
          `回写备份任务记录失败（可能为回滚腾空窗口）: ${messageOf(caught)}`,
        );
      });
  }

  /**
   * 回滚结束后按状态文件全量重放任务记录：BackupJob 表被还原成备份点快照后，
   * 期间新建的行（restore、保护备份）消失、源备份停在 dump 时的旧状态，只有
   * 状态文件始终准确。逐个 upsert 幂等修正，失败只记日志不阻断。
   */
  private async reconcileAllJobsFromState(): Promise<void> {
    const states = await this.readAllStateFiles();
    for (const jobId of states.keys()) {
      await this.reconcileJobFromState(jobId).catch((caught) =>
        this.logger.warn(
          `重放备份任务记录失败 #${jobId}: ${messageOf(caught)}`,
        ),
      );
    }
  }

  private async loadJob(jobId: string): Promise<BackupJobSummary> {
    const [state, row] = await Promise.all([
      readJobState(this.paths.backupJobsDir, jobId),
      this.prisma.backupJob
        .findUnique({ where: { id: jobId } })
        .catch(() => null),
    ]);
    if (!state && !row) throw new NotFoundException("备份任务不存在");
    return this.mergeJob(jobId, state, row);
  }

  private async readAllStateFiles(): Promise<
    Map<string, MigrationJobFileState>
  > {
    const map = new Map<string, MigrationJobFileState>();
    try {
      const entries = await readdir(this.paths.backupJobsDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const state = await readJobState(
          this.paths.backupJobsDir,
          entry.name.replace(/\.json$/, ""),
        );
        if (state) map.set(state.jobId, state);
      }
    } catch {
      // 目录不存在时返回空。
    }
    return map;
  }

  private async mergeJob(
    jobId: string,
    state: MigrationJobFileState | null,
    row: {
      id: string;
      kind: string;
      status: string;
      phase: string;
      backupPath: string | null;
      restoreFromId: string | null;
      neonBranchId: string | null;
      dumpSizeBytes: bigint | null;
      objectCount: number | null;
      includeObjects: boolean;
      isProtection: boolean;
      manifest: unknown;
      error: string | null;
      createdById: string | null;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
      updatedAt: Date;
    } | null,
  ): Promise<BackupJobSummary> {
    return {
      id: jobId,
      kind: fileKindToJobKind(state?.kind ?? row?.kind) as BackupJobKind,
      status: (state?.status ?? row?.status ?? "pending") as BackupJobStatus,
      phase: state?.phase ?? row?.phase ?? "",
      progress: state?.progress ?? null,
      backupPath: row?.backupPath ?? null,
      restoreFromId: state?.restoreFromId ?? row?.restoreFromId ?? null,
      neonBranchId: row?.neonBranchId ?? null,
      dumpSizeBytes:
        row?.dumpSizeBytes != null ? String(row.dumpSizeBytes) : null,
      objectCount: row?.objectCount ?? null,
      includeObjects: state?.includeObjects ?? row?.includeObjects ?? false,
      isProtection: state?.isProtection ?? row?.isProtection ?? false,
      manifest: state?.manifest ?? row?.manifest ?? null,
      error: state?.error ?? row?.error ?? null,
      createdBy: row?.createdById ?? null,
      createdAt: row?.createdAt?.toISOString() ?? state?.startedAt ?? null,
      startedAt: state?.startedAt ?? row?.startedAt?.toISOString() ?? null,
      finishedAt: state?.finishedAt ?? row?.finishedAt?.toISOString() ?? null,
      updatedAt: state?.updatedAt ?? row?.updatedAt?.toISOString() ?? null,
    };
  }
}

export function messageOf(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return String(caught);
}
