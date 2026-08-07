"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Database,
  Loader2,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import {
  deleteBackupJob,
  dismissBackupJobError,
  getBackupInfo,
  listBackupJobs,
  startBackupRestore,
  startManualBackup,
  updateBackupSettings,
  type BackupInfo,
  type BackupJobSummary,
  type BackupSettings,
} from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

const PHASE_LABELS: Record<string, string> = {
  prepare: "准备",
  dump: "导出数据库",
  objects: "复制对象",
  "restore/prepare": "准备",
  "restore/drop-schema": "清空数据库",
  "restore/restore": "还原数据库",
  "restore/migrate-deploy": "补齐迁移",
  "restore/objects": "回拷对象",
  "restore/verify": "校验",
  done: "完成",
};

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? (phase || "等待");
}

const KIND_LABELS: Record<string, string> = {
  auto: "自动",
  manual: "手动",
  restore: "回滚",
};

type BackupListTab = "backups" | "restores" | "protections";

const LIST_TABS: Array<{ key: BackupListTab; label: string }> = [
  { key: "backups", label: "备份" },
  { key: "restores", label: "回滚记录" },
  { key: "protections", label: "回滚前自动备份" },
];

const LIST_EMPTY_HINTS: Record<BackupListTab, string> = {
  backups: "还没有备份记录。开启自动备份或点击「立即备份」。",
  restores: "暂无回滚记录。从备份执行回滚后，操作记录会出现在这里。",
  protections: "暂无回滚前自动备份。每次回滚前都会自动创建一次保护备份。",
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function dumpSizeLabel(job: BackupJobSummary): string {
  const bytes = job.dumpSizeBytes ? Number(job.dumpSizeBytes) : 0;
  return bytes > 0 ? formatBytes(bytes) : "";
}

export function BackupClient() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [jobs, setJobs] = useState<BackupJobSummary[]>([]);
  // 设置表单状态（未加载前为 null，避免用默认值覆盖真实设置）。
  const [form, setForm] = useState<BackupSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [dismissingJob, setDismissingJob] = useState<string | null>(null);
  // 回滚确认对话框。
  const [restoreTarget, setRestoreTarget] = useState<BackupJobSummary | null>(
    null,
  );
  const [confirmInput, setConfirmInput] = useState("");
  const [restoring, setRestoring] = useState(false);
  // 删除备份确认对话框。
  const [deleteTarget, setDeleteTarget] = useState<BackupJobSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 列表分类：备份 / 回滚记录 / 回滚前自动备份。
  const [listTab, setListTab] = useState<BackupListTab>("backups");
  const pollTimer = useRef<number | null>(null);
  const pollInFlight = useRef(false);

  const anyRunning = jobs.some(
    (job) => job.status === "running" || job.status === "pending",
  );

  const backupJobs = jobs.filter(
    (job) => job.kind !== "restore" && !job.isProtection,
  );
  const restoreJobs = jobs.filter((job) => job.kind === "restore");
  const protectionJobs = jobs.filter((job) => job.isProtection);
  const listCounts: Record<BackupListTab, number> = {
    backups: backupJobs.length,
    restores: restoreJobs.length,
    protections: protectionJobs.length,
  };
  const visibleJobs =
    listTab === "backups"
      ? backupJobs
      : listTab === "restores"
        ? restoreJobs
        : protectionJobs;

  const refresh = useCallback(async () => {
    const [infoResult, jobsResult] = await Promise.allSettled([
      getBackupInfo(),
      listBackupJobs(),
    ]);
    if (infoResult.status === "fulfilled") {
      setInfo(infoResult.value.info);
      // 首次加载后把服务端设置灌入表单；之后保留用户编辑中的值。
      setForm((current) => current ?? infoResult.value.info.settings);
      setLoadError(null);
    } else {
      setLoadError(
        infoResult.reason instanceof Error
          ? `无法加载备份信息：${infoResult.reason.message}`
          : "无法加载备份信息",
      );
    }
    if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.jobs);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有任务运行时轮询；全部结束后停表。慢周期下用 in-flight 标记跳过本轮，
  // 避免请求叠加乱序覆盖（回滚腾空窗口期服务器最脆弱）。
  // starting/restoring 期间也轮询：手动备份与回滚请求在后端实际执行
  // （短预算），任务行创建后立即出现在列表并展示进度，不必等请求返回
  // 或手动刷新。
  useEffect(() => {
    if (!anyRunning && !starting && !restoring) return;
    pollTimer.current = window.setInterval(() => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      void refresh().finally(() => {
        pollInFlight.current = false;
      });
    }, 4000);
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, [anyRunning, starting, restoring, refresh]);

  const unavailable = info !== null && !info.supported;

  async function onSaveSettings() {
    if (!form) return;
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      // 只提交可编辑字段：lastAutoBackupAt 是服务端维护的调度标记，
      // 后端 DTO 白名单会拒绝未知属性（forbidNonWhitelisted）。
      const result = await updateBackupSettings({
        enabled: form.enabled,
        scheduleHour: form.scheduleHour,
        scheduleMinute: form.scheduleMinute,
        scheduleWeekday: form.scheduleWeekday,
        autoRetention: form.autoRetention,
        includeObjects: form.includeObjects,
      });
      setForm(result.settings);
      setMessage("备份设置已保存");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存设置失败");
    } finally {
      setSaving(false);
    }
  }

  async function onStartBackup() {
    setError(null);
    setMessage(null);
    setStarting(true);
    try {
      await startManualBackup({});
      setMessage("手动备份已开始，完成后可在下方列表中查看。");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动备份失败");
    } finally {
      setStarting(false);
    }
  }

  async function onRestore() {
    if (!restoreTarget) return;
    setError(null);
    setMessage(null);
    const expected = info?.confirmPhrase ?? "CONFIRM-RESTORE";
    if (confirmInput.trim() !== expected) {
      setError(`确认语不正确，请输入 ${expected} 以继续`);
      return;
    }
    setRestoring(true);
    try {
      await startBackupRestore(restoreTarget.id, {
        confirm: confirmInput.trim(),
      });
      setMessage(
        "回滚已开始：先自动创建一次保护备份，随后从所选备份恢复。期间站点进入只读维护模式。",
      );
      setRestoreTarget(null);
      setConfirmInput("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动回滚失败");
    } finally {
      setRestoring(false);
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setError(null);
    setMessage(null);
    setDeleting(true);
    try {
      await deleteBackupJob(deleteTarget.id);
      setMessage(`备份 ${deleteTarget.id.slice(0, 8)} 已删除`);
      setDeleteTarget(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除备份失败");
    } finally {
      setDeleting(false);
    }
  }

  async function onDismiss(jobId: string) {
    setDismissingJob(jobId);
    try {
      await dismissBackupJobError(jobId);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清除报错失败");
    } finally {
      setDismissingJob(null);
    }
  }

  function setField<K extends keyof BackupSettings>(
    key: K,
    value: BackupSettings[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div className="workspace admin-workspace admin-page admin-page--focused backup-page">
      <AdminPageHeader
        category="系统与服务"
        title="备份与回滚"
        description="自动/手动备份数据库与文件，出错时可从备份点恢复。"
      />

      {loadError ? <p className="error-text">{loadError}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      {info && info.deploymentTarget === "vercel" && info.supported && (
        <p className="backup-platform-hint">
          Vercel 环境：数据库备份使用 Neon 分支快照，文件备份复制到 R2
          的备份前缀；自动备份频率受 Vercel 计划限制（Hobby 每日一次）。
        </p>
      )}

      {unavailable ? (
        <section className="backup-notice-panel">
          <ShieldAlert aria-hidden="true" />
          <div>
            <strong>备份功能当前不可用</strong>
            <p>{info?.unavailableReason ?? "备份功能不可用"}</p>
          </div>
        </section>
      ) : (
        <section className="backup-layout">
          <div className="backup-sections">
            {/* 备份设置 */}
            <section
              className="backup-section"
              aria-labelledby="backup-settings-title"
            >
              <div className="panel-head">
                <div>
                  <h2 id="backup-settings-title">
                    <Settings2 aria-hidden="true" className="heading-icon" />
                    备份设置
                  </h2>
                  <p className="muted">
                    自动备份按设置的间隔运行，超过保留份数时自动删除最旧的备份。
                  </p>
                </div>
              </div>
              {form && (
                <div className="backup-setting-list">
                  <label className="backup-setting-row backup-setting-toggle">
                    <span className="backup-setting-copy">
                      <span className="backup-setting-title">
                        <strong>启用自动备份</strong>
                      </span>
                      <small>
                        上次自动备份：
                        {form.lastAutoBackupAt
                          ? formatDateTime(form.lastAutoBackupAt)
                          : "尚未执行过"}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setField("enabled", e.target.checked)}
                    />
                  </label>

                  <div className="backup-setting-row">
                    <span className="backup-setting-copy">
                      <span className="backup-setting-title">
                        <strong>自动备份时间</strong>
                      </span>
                      <small>
                        每天或每周的固定时刻执行；首次开启不会立即备份，按设定时刻到点执行，当天已过则从下一周期开始
                      </small>
                    </span>
                    <div className="backup-schedule-control">
                      <select
                        className="select"
                        value={
                          form.scheduleWeekday == null ? "daily" : "weekly"
                        }
                        onChange={(e) =>
                          setField(
                            "scheduleWeekday",
                            e.target.value === "daily"
                              ? null
                              : (form.scheduleWeekday ?? 1),
                          )
                        }
                        aria-label="备份频率"
                      >
                        <option value="daily">每天</option>
                        <option value="weekly">每周</option>
                      </select>
                      {form.scheduleWeekday != null && (
                        <select
                          className="select"
                          value={form.scheduleWeekday}
                          onChange={(e) =>
                            setField("scheduleWeekday", Number(e.target.value))
                          }
                          aria-label="星期"
                        >
                          {WEEKDAY_LABELS.map((label, day) => (
                            <option key={day} value={day}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        className="select"
                        value={form.scheduleHour}
                        onChange={(e) =>
                          setField("scheduleHour", Number(e.target.value))
                        }
                        aria-label="时"
                      >
                        {HOUR_OPTIONS.map((hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                      <span className="backup-schedule-colon">:</span>
                      <select
                        className="select"
                        value={form.scheduleMinute}
                        onChange={(e) =>
                          setField("scheduleMinute", Number(e.target.value))
                        }
                        aria-label="分"
                      >
                        {MINUTE_OPTIONS.map((minute) => (
                          <option key={minute} value={minute}>
                            {String(minute).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="backup-setting-row">
                    <span className="backup-setting-copy">
                      <span className="backup-setting-title">
                        <strong>自动备份保留份数</strong>
                      </span>
                      <small>
                        超过后自动删除最旧的自动备份；手动备份无数量上限
                      </small>
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={form.autoRetention}
                      onChange={(e) =>
                        setField("autoRetention", Number(e.target.value))
                      }
                      className="backup-retention-input"
                    />
                  </div>

                  <label className="backup-setting-row backup-setting-toggle">
                    <span className="backup-setting-copy">
                      <span className="backup-setting-title">
                        <strong>同时备份文件对象</strong>
                      </span>
                      <small>
                        备份数据库外，还把存储中引用的文件复制进备份包；备份体积与耗时随之增加
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.includeObjects}
                      onChange={(e) =>
                        setField("includeObjects", e.target.checked)
                      }
                    />
                  </label>

                  <div className="backup-settings-actions">
                    <button
                      className="button secondary"
                      disabled={saving}
                      onClick={() => void onSaveSettings()}
                    >
                      {saving ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        "保存设置"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 备份列表 */}
            <section
              className="backup-section"
              aria-labelledby="backup-jobs-title"
            >
              <div className="panel-head backup-panel-head">
                <div>
                  <h2 id="backup-jobs-title">
                    <Archive aria-hidden="true" className="heading-icon" />
                    备份列表
                  </h2>
                </div>
                <button
                  className="button secondary small"
                  disabled={starting || anyRunning}
                  onClick={() => void onStartBackup()}
                >
                  {starting ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Database size={16} />
                  )}
                  立即备份
                </button>
              </div>
              <div
                className="backup-list-tabs"
                role="tablist"
                aria-label="备份列表分类"
              >
                {LIST_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={listTab === tab.key}
                    className="backup-list-tab"
                    onClick={() => setListTab(tab.key)}
                  >
                    {tab.label}
                    <span className="backup-tab-count">
                      {listCounts[tab.key]}
                    </span>
                  </button>
                ))}
              </div>
              {anyRunning && (
                <p className="backup-running-hint">
                  有任务正在执行，列表每 4
                  秒自动刷新；回滚期间站点进入只读维护模式。
                </p>
              )}
              <div className="backup-jobs-list">
                {visibleJobs.length === 0 && (
                  <p className="backup-empty-hint">
                    {LIST_EMPTY_HINTS[listTab]}
                  </p>
                )}
                {visibleJobs.map((job) => {
                  const running =
                    job.status === "running" || job.status === "pending";
                  const progress = job.progress;
                  return (
                    <div className="backup-job-row" key={job.id}>
                      <div className="backup-job-head">
                        <span className="backup-kind">
                          {job.isProtection
                            ? "回滚前自动备份"
                            : (KIND_LABELS[job.kind] ?? job.kind)}
                        </span>
                        <span className="backup-id">#{job.id.slice(0, 8)}</span>
                        <span
                          className={`backup-status backup-status-${job.status}`}
                        >
                          {job.status === "running" && (
                            <Loader2 className="spin" size={16} />
                          )}
                          {job.status === "succeeded" && (
                            <CheckCircle2 size={16} />
                          )}
                          {job.status === "failed" && <XCircle size={16} />}
                          {job.status === "pending" && <Loader2 size={16} />}
                          {statusLabel(job.status)}
                        </span>
                        <span className="backup-time">
                          {formatDateTime(job.createdAt ?? job.startedAt ?? "")}
                        </span>
                        {job.restoreFromId && (
                          <span className="backup-restore-source">
                            来源备份 #{job.restoreFromId.slice(0, 8)}
                          </span>
                        )}
                        <span className="backup-meta">
                          {job.includeObjects ? "含文件" : "仅数据库"}
                          {dumpSizeLabel(job) && ` · ${dumpSizeLabel(job)}`}
                          {job.objectCount != null &&
                            ` · ${job.objectCount} 个对象`}
                        </span>
                      </div>
                      {running && (
                        <div className="backup-progress">
                          <span>{phaseLabel(job.phase)}</span>
                          {progress && progress.total > 0 && (
                            <div className="backup-progress-bar">
                              <div
                                className="backup-progress-fill"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.round(
                                      (progress.done / progress.total) * 100,
                                    ),
                                  )}%`,
                                }}
                              />
                            </div>
                          )}
                          {progress && progress.total > 0 && (
                            <span>
                              {progress.done}/{progress.total}
                            </span>
                          )}
                        </div>
                      )}
                      {job.error && (
                        <div className="backup-error-row">
                          <p className="backup-error">{job.error}</p>
                          <button
                            className="button secondary small"
                            disabled={dismissingJob === job.id}
                            onClick={() => void onDismiss(job.id)}
                          >
                            {dismissingJob === job.id && (
                              <Loader2 className="spin" size={14} />
                            )}
                            知道了
                          </button>
                        </div>
                      )}
                      {!running &&
                        job.status === "succeeded" &&
                        job.kind !== "restore" && (
                          <div className="backup-job-actions">
                            <button
                              className="button secondary small"
                              disabled={anyRunning}
                              onClick={() => {
                                setError(null);
                                setConfirmInput("");
                                setRestoreTarget(job);
                              }}
                            >
                              <RotateCcw size={14} />
                              从该备份回滚
                            </button>
                            <button
                              className="button danger small"
                              disabled={anyRunning}
                              onClick={() => {
                                setError(null);
                                setDeleteTarget(job);
                              }}
                              title="永久删除该备份"
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </div>
                        )}
                      {running &&
                        job.kind !== "restore" &&
                        info?.deploymentTarget === "vercel" && (
                          <div className="backup-job-actions">
                            <button
                              className="button danger small"
                              onClick={() => {
                                setError(null);
                                setDeleteTarget(job);
                              }}
                              title="删除该备份任务（等待中/执行中，内容会被完整清理）"
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </section>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>删除备份</h2>
              <button
                className="icon-button subtle"
                onClick={() => setDeleteTarget(null)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <p className="backup-dialog-desc">
                将永久删除 <strong>#{deleteTarget.id.slice(0, 8)}</strong>（
                {formatDateTime(deleteTarget.createdAt ?? "")}）的数据库备份
                {deleteTarget.includeObjects ? "与文件对象" : ""}。
                <strong>此操作不可恢复</strong>，删除后无法再从此备份回滚。
              </p>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                >
                  取消
                </button>
                <button
                  className="button danger"
                  disabled={deleting}
                  onClick={() => void onDelete()}
                >
                  {deleting && <Loader2 className="spin" size={16} />}
                  删除备份
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {restoreTarget && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-panel backup-confirm-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <h2>从备份回滚</h2>
              <button
                className="icon-button subtle"
                onClick={() => setRestoreTarget(null)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body">
              <p className="backup-dialog-desc">
                将把 <strong>#{restoreTarget.id.slice(0, 8)}</strong>（
                {formatDateTime(restoreTarget.createdAt ?? "")}） 的数据库（
                {restoreTarget.includeObjects ? "含" : "不含"}文件对象）
                恢复到当前站点。<strong>当前全部数据将被该备份覆盖</strong>；
                回滚前会自动创建一次保护备份。
              </p>
              <label className="backup-confirm-field">
                <span>
                  请输入确认语{" "}
                  <code className="backup-dialog-phrase">
                    {info?.confirmPhrase ?? "CONFIRM-RESTORE"}
                  </code>{" "}
                  以确认：
                </span>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="输入确认语"
                  className="input"
                />
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={restoring}
                  onClick={() => setRestoreTarget(null)}
                >
                  取消
                </button>
                <button
                  className="button danger"
                  disabled={restoring}
                  onClick={() => void onRestore()}
                >
                  {restoring && <Loader2 className="spin" size={16} />}
                  确认回滚
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "等待中",
    running: "进行中",
    succeeded: "成功",
    failed: "失败",
  };
  return labels[status] ?? status;
}
