/**
 * 备份调度的纯函数（无 IO，便于单测）。两平台（self_hosted / vercel）共用：
 * 无论调度入口是进程内 setInterval 还是 Vercel cron 打端点，最终都调用
 * shouldRunAutoBackup 决定"现在该不该跑"，保证逻辑一致。
 *
 * 语义：自动备份按固定时刻执行（每天 HH:MM 或每周 weekday HH:MM），
 * 严格到点——首次启用当天不执行，从下一个调度时刻开始。
 */

export const SCHEDULE_HOUR_MIN = 0;
export const SCHEDULE_HOUR_MAX = 23;
export const SCHEDULE_MINUTE_MIN = 0;
export const SCHEDULE_MINUTE_MAX = 59;
/** 每周调度固定使用「每 7 天」周期；0-6 对应 JS Date.getDay()（0=周日）。 */
export const SCHEDULE_WEEKDAY_MIN = 0;
export const SCHEDULE_WEEKDAY_MAX = 6;
export const RETENTION_MIN = 1;
export const RETENTION_MAX = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface BackupScheduleState {
  enabled: boolean;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleWeekday: number | null;
  lastAutoBackupAt: Date | string | null;
}

/**
 * 当前周期（今天或本周）内的调度时刻。weekday 为 null 时是今天 HH:MM；
 * 否则是本周该 weekday 的 HH:MM（可能在过去 = 本周期已到点，可能在未来）。
 */
export function periodFireTime(
  settings: Pick<
    BackupScheduleState,
    "scheduleHour" | "scheduleMinute" | "scheduleWeekday"
  >,
  now: Date,
): Date {
  const fire = new Date(now);
  fire.setSeconds(0, 0);
  fire.setHours(settings.scheduleHour, settings.scheduleMinute, 0, 0);
  if (settings.scheduleWeekday != null) {
    fire.setDate(now.getDate() + (settings.scheduleWeekday - now.getDay()));
  }
  return fire;
}

/**
 * 到点后的触发窗口：超过视为错过（跳过，不补跑）。
 * 覆盖 tick（60s）与 Vercel cron 的正常延迟，避免把「到点延迟执行」误判为错过。
 */
export const SCHEDULE_FIRE_WINDOW_MS = 10 * 60 * 1000;

/**
 * 自动备份调度判定（严格到点，错过跳过）：
 * - 未启用 → 不跑；
 * - 当前周期还没到调度时刻 → 不跑；
 * - 本周期调度点已过超过触发窗口 → 错过，跳过（停机恢复后不补跑）；
 * - 从未跑过（lastAutoBackupAt 为空）→ 不跑。首次启用由 updateSettings
 *   把 lastAutoBackupAt 置为本周期调度点（视为本班已跑），从下一周期开始；
 * - 到点窗口内且上次备份早于本周期调度点 → 跑。
 */
export function shouldRunAutoBackup(
  settings: BackupScheduleState,
  now: Date,
): boolean {
  if (!settings.enabled) return false;
  const fire = periodFireTime(settings, now);
  const elapsed = now.getTime() - fire.getTime();
  if (elapsed < 0 || elapsed > SCHEDULE_FIRE_WINDOW_MS) return false;
  if (settings.lastAutoBackupAt == null) return false;
  const last = new Date(settings.lastAutoBackupAt).getTime();
  if (!Number.isFinite(last)) return false;
  return last < fire.getTime();
}

/**
 * 首次启用自动备份时把 lastAutoBackupAt 置为调度基点，使「严格到点」成立：
 * - 本周期到点已过（fire ≤ now）：视为本班已跑，从下一周期开始；
 * - 本周期到点未到（fire > now）：置为上一周期调度点，到点即跑第一班。
 * 返回要写入的 lastAutoBackupAt（字符串 ISO）。
 */
export function initialLastAutoBackupAt(
  settings: Pick<
    BackupScheduleState,
    "scheduleHour" | "scheduleMinute" | "scheduleWeekday"
  >,
  now: Date,
): string {
  const fire = periodFireTime(settings, now);
  const periodMs = settings.scheduleWeekday == null ? DAY_MS : WEEK_MS;
  const base =
    fire.getTime() > now.getTime() ? fire.getTime() - periodMs : fire.getTime();
  return new Date(base).toISOString();
}

export interface RetentionJobRow {
  id: string;
  /** restore 行参与引用保护，但不参与候选（见 retentionCandidates 注释）。 */
  kind: "auto" | "manual" | "restore";
  status: string;
  createdAt: Date;
  restoreFromId: string | null;
}

/**
 * 保留策略：返回应删除的旧备份行（按 createdAt 升序，超出 limit 的最旧者）。
 * 调用方应传入「目标 kind 的备份行 + restore 行」（restore 行用于构建引用保护，
 * 自身不参与候选）。
 * - 候选仅成功备份（kind !== "restore"）；
 * - 被 pending/running 的 restore 任务引用的行跳过（回滚进行中不能删来源备份）。
 * 手动备份无上限：调用方只对自动备份传 limit（见 pruneRetention）。
 */
export function retentionCandidates<T extends RetentionJobRow>(
  rows: T[],
  limit: number,
): T[] {
  const sorted = [...rows]
    .filter((r) => r.kind !== "restore" && r.status === "succeeded")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const protectedIds = new Set(
    rows
      .filter((r) => r.restoreFromId && r.status !== "failed")
      .map((r) => r.restoreFromId!),
  );
  const expired = sorted.slice(0, Math.max(0, sorted.length - limit));
  return expired.filter((r) => !protectedIds.has(r.id));
}
