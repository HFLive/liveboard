"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Package,
  Power,
  ShieldAlert,
  TriangleAlert,
  Upload,
  XCircle,
} from "lucide-react";
import {
  dismissMigrationJobError,
  downloadMigrationExport,
  getAdminMaintenance,
  getMigrationInfo,
  listMigrationIncoming,
  listMigrationJobs,
  setMaintenanceEnabled,
  startMigrationExport,
  startMigrationImport,
  uploadMigrationPackage,
  type IncomingPackage,
  type MigrationInfo,
  type MigrationJobSummary,
} from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

const PHASE_LABELS: Record<string, string> = {
  prepare: "准备",
  dump: "导出数据库",
  objects: "打包对象",
  "import/prepare": "准备",
  "import/drop-schema": "清空目标库",
  "import/restore": "还原数据库",
  "import/resolve": "标记迁移历史",
  "import/wipe-secrets": "抹除密钥",
  "import/objects": "写入对象",
  done: "完成",
};

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? (phase || "等待");
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function MigrationClient() {
  const [info, setInfo] = useState<MigrationInfo | null>(null);
  const [maintenance, setMaintenance] = useState<{
    enabled: boolean;
    reason: string | null;
  } | null>(null);
  const [incoming, setIncoming] = useState<IncomingPackage[]>([]);
  const [jobs, setJobs] = useState<MigrationJobSummary[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [pushToR2, setPushToR2] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dismissingJob, setDismissingJob] = useState<string | null>(null);
  const [starting, setStarting] = useState<"export" | "import" | null>(null);
  const [togglingMaintenance, setTogglingMaintenance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollInFlight = useRef(false);

  const anyRunning = jobs.some(
    (job) => job.status === "running" || job.status === "pending",
  );

  const refresh = useCallback(async () => {
    const [infoResult, maintenanceResult, incomingResult, jobsResult] =
      await Promise.allSettled([
        getMigrationInfo(),
        getAdminMaintenance(),
        listMigrationIncoming(),
        listMigrationJobs(),
      ]);
    if (infoResult.status === "fulfilled") {
      setInfo(infoResult.value.info);
      setLoadError(null);
    } else {
      // 加载失败不再静默吞掉：403/5xx 时给出明确提示，避免页面看似"没有数据"。
      setLoadError(
        infoResult.reason instanceof Error
          ? `无法加载迁移信息：${infoResult.reason.message}`
          : "无法加载迁移信息",
      );
    }
    if (maintenanceResult.status === "fulfilled")
      setMaintenance(maintenanceResult.value.maintenance);
    if (incomingResult.status === "fulfilled") {
      const packages = incomingResult.value.packages;
      setIncoming(packages);
      // 选中的迁移包若已被移除（导入完成/服务器清理），清空选择，避免残留的
      // 旧值让导入按钮保持可用、触发对已不存在来源的导入。
      setSelectedPackage((current) =>
        current && !packages.some((p) => p.name === current) ? "" : current,
      );
    }
    if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.jobs);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有任务运行时轮询；全部结束后停表。慢周期下用 in-flight 标记跳过本轮，
  // 避免请求叠加乱序覆盖（导入窗口期服务器最脆弱）。
  useEffect(() => {
    if (!anyRunning) return;
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
  }, [anyRunning, refresh]);

  async function onStartExport() {
    setError(null);
    setMessage(null);
    setStarting("export");
    try {
      await startMigrationExport({
        includeObjects: !pushToR2,
        pushToR2,
      });
      setMessage(
        pushToR2
          ? "导出已开始：对象将直推目标 R2，完成后包内不含对象。导出期间站点进入只读维护模式。"
          : "导出已开始。导出期间站点将进入只读维护模式，完成后自动恢复。",
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动导出失败");
    } finally {
      setStarting(null);
    }
  }

  async function onStartImport() {
    setError(null);
    setMessage(null);
    if (!selectedPackage) {
      setError("请先在下方选择一个迁移包");
      return;
    }
    if (confirmInput.trim() !== (info?.confirmPhrase ?? "CONFIRM-IMPORT")) {
      setError("确认语不正确，请输入下方显示的确认语以继续");
      return;
    }
    setStarting("import");
    try {
      await startMigrationImport({
        source: selectedPackage,
        confirm: confirmInput.trim(),
      });
      setMessage("导入已开始。导入期间站点不可用；完成后需重新登录。");
      setSelectedPackage("");
      setConfirmInput("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "启动导入失败");
    } finally {
      setStarting(null);
    }
  }

  async function onUploadPackage(file: File | undefined) {
    if (!file) return;
    setError(null);
    setMessage(null);
    setUploading(true);
    try {
      const result = await uploadMigrationPackage(file);
      setMessage(`迁移包已上传：${result.package.name}`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "迁移包上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function onDownload(name: string) {
    setError(null);
    setDownloading(name);
    try {
      const blob = await downloadMigrationExport(name);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 延后撤销 blob URL，避免 Safari/Firefox 在下载尚未读取 blob 时中断。
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出包下载失败");
    } finally {
      // 只在仍等于当前 name 时清空：并发下载互不提前清掉彼此的"下载中…"。
      setDownloading((current) => (current === name ? null : current));
    }
  }

  async function onDismissError(jobId: string) {
    setError(null);
    setMessage(null);
    setDismissingJob(jobId);
    try {
      await dismissMigrationJobError(jobId);
      setMessage("已清除报错信息");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清除报错信息失败");
    } finally {
      setDismissingJob(null);
    }
  }

  async function onToggleMaintenance() {
    setError(null);
    setMessage(null);
    const next = !(maintenance?.enabled ?? false);
    if (next) {
      if (
        !window.confirm(
          "开启维护模式后，全站将拒绝普通用户的写入操作（只读），最高管理员不受影响。确认开启吗？",
        )
      ) {
        return;
      }
    } else if (
      !window.confirm("关闭维护模式后，站点恢复正常读写。确认关闭吗？")
    ) {
      return;
    }
    setTogglingMaintenance(true);
    try {
      const result = await setMaintenanceEnabled(
        next,
        reasonInput || undefined,
      );
      setMaintenance(result.maintenance);
      if (!next) setReasonInput("");
      setMessage(next ? "维护模式已开启" : "维护模式已关闭");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "切换维护模式失败");
    } finally {
      setTogglingMaintenance(false);
    }
  }

  const maintenanceOn = Boolean(maintenance?.enabled);
  const isVercel = info?.deploymentTarget === "vercel";
  const unavailable = info !== null && info !== undefined && !info.available;

  return (
    <div className="workspace admin-workspace admin-page admin-page--focused migration-page">
      <AdminPageHeader
        category="系统与服务"
        description="把当前服务器的课堂、文档、论坛、用户与文件打包导出，或从迁移包导入到本服务器。"
        title="数据迁移"
      />

      {loadError ? <p className="error-text">{loadError}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      {isVercel ? (
        <section className="migration-unavailable-panel">
          <ShieldAlert aria-hidden="true" />
          <div>
            <strong>Vercel 部署不支持后台迁移</strong>
            <p className="muted">
              请使用服务器端命令行脚本（apps/api/scripts/migrate-export.ts /
              migrate-import.ts）完成迁移，参见
              docs/migrate-any-direction-design.md。
            </p>
          </div>
        </section>
      ) : null}

      {unavailable && !isVercel ? (
        <section className="migration-unavailable-panel">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>迁移数据目录不可用</strong>
            <p className="muted">
              请确认迁移数据目录已挂载（docker-compose 的
              <code>/opt/liveboard/migration</code>，容器内{" "}
              <code>/data/migration</code>）， 且 API 进程有写入权限。
            </p>
          </div>
        </section>
      ) : null}

      <section className="workbench migration-layout">
        <div className="workbench-main migration-sections">
          {/* 维护模式开关 */}
          <section
            className="migration-section maintenance-toggle-section"
            aria-labelledby="maintenance-title"
          >
            <div className="panel-head">
              <div>
                <h2 id="maintenance-title">
                  <Power aria-hidden="true" className="heading-icon" />
                  维护/只读模式
                </h2>
                <p className="muted">
                  导出与导入期间会自动开启。开启后普通用户只能读，最高管理员不受影响。
                </p>
              </div>
            </div>
            {maintenance === null ? null : (
              <div className="maintenance-toggle-body">
                <div
                  className={`maintenance-state ${maintenanceOn ? "on" : "off"}`}
                >
                  <span className="maintenance-dot" />
                  <strong>
                    {maintenanceOn ? "维护中（只读）" : "正常运行"}
                  </strong>
                  {maintenanceOn && maintenance.reason ? (
                    <small>：{maintenance.reason}</small>
                  ) : null}
                </div>
                {isVercel ? null : (
                  <div className="maintenance-toggle-controls">
                    <label className="maintenance-reason-field">
                      <span>原因（可选）</span>
                      <input
                        disabled={maintenanceOn || togglingMaintenance}
                        onChange={(event) => setReasonInput(event.target.value)}
                        placeholder="例如：升级服务器"
                        value={reasonInput}
                      />
                    </label>
                    <button
                      className={`button ${maintenanceOn ? "secondary" : ""}`}
                      disabled={togglingMaintenance || isVercel}
                      onClick={() => void onToggleMaintenance()}
                      type="button"
                    >
                      {maintenanceOn ? "关闭维护模式" : "开启维护模式"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 导出 */}
          <section
            className="migration-section export-section"
            aria-labelledby="export-title"
          >
            <div className="panel-head">
              <div>
                <h2 id="export-title">
                  <Package aria-hidden="true" className="heading-icon" />
                  导出（搬到另一台服务器）
                </h2>
                <p className="muted">
                  一键打包数据库与全部文件。导出期间站点自动进入只读维护模式，完成后恢复。
                  源服务器数据全程不变，可随时回滚。
                </p>
              </div>
            </div>
            <div className="export-body">
              {info?.pushToR2Available && !isVercel ? (
                <label className="export-push-toggle">
                  <input
                    checked={pushToR2}
                    disabled={starting !== null}
                    onChange={(event) => setPushToR2(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    对象直推目标
                    R2（server→vercel：包内不含对象，需在源服务器配置{" "}
                    <code>TARGET_R2_*</code>）
                  </span>
                </label>
              ) : null}
              <button
                className="button"
                disabled={starting !== null || unavailable || isVercel}
                onClick={() => void onStartExport()}
                type="button"
              >
                {starting === "export" ? (
                  <Loader2 aria-hidden="true" className="button-icon spin" />
                ) : (
                  <Download aria-hidden="true" className="button-icon" />
                )}
                {starting === "export" ? "正在开始导出" : "开始导出迁移包"}
              </button>
              <p className="muted export-hint">
                大包请从服务器目录取走：
                <code>{info?.dataDir ?? "/data/migration"}/exports/</code>
                （scp/sftp），再把包放到新服务器的
                <code>incoming/</code> 目录完成导入。
              </p>
              <div className="export-result-list">
                {jobs
                  .filter((job) => job.kind === "export")
                  .slice(0, 3)
                  .map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onDownload={onDownload}
                      downloading={downloading}
                      dismissing={dismissingJob}
                      onDismissError={onDismissError}
                    />
                  ))}
              </div>
            </div>
          </section>

          {/* 导入 */}
          <section
            className="migration-section import-section"
            aria-labelledby="import-title"
          >
            <div className="panel-head">
              <div>
                <h2 id="import-title">
                  <FileArchive aria-hidden="true" className="heading-icon" />
                  导入（从迁移包恢复）
                </h2>
                <p className="muted">
                  导入会<strong>彻底清空本服务器的全部数据</strong>
                  再还原迁移包，且不做自动备份。
                  请确认这是目标服务器、数据可以放弃后再执行。
                  {info
                    ? ` 文件将写入目标存储后端：${info.targetBackend}。`
                    : ""}
                </p>
              </div>
            </div>
            <div className="import-body">
              <div className="import-upload-row">
                <label className="button secondary import-upload-button">
                  <Upload aria-hidden="true" className="button-icon" />
                  {uploading ? "上传中…" : "上传小包（≤100MB）"}
                  <input
                    accept=".tar"
                    disabled={uploading || unavailable || isVercel}
                    onChange={(event) => {
                      void onUploadPackage(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
                <p className="muted">
                  大包请先 scp/sftp 到服务器{" "}
                  <code>{info?.dataDir ?? "/data/migration"}/incoming/</code>，
                  刷新后即可选择。
                </p>
              </div>

              <div className="import-package-list">
                <span className="import-package-label">选择迁移包</span>
                {incoming.length === 0 ? (
                  <p className="muted">
                    incoming 目录为空，先上传或放入一个迁移包。
                  </p>
                ) : (
                  incoming.map((item) => (
                    <label className="import-package-option" key={item.name}>
                      <input
                        checked={selectedPackage === item.name}
                        disabled={!item.hasManifest || unavailable || isVercel}
                        name="migration-package"
                        onChange={() => setSelectedPackage(item.name)}
                        type="radio"
                      />
                      <span className="import-package-name">{item.name}</span>
                      <span className="muted import-package-meta">
                        {item.type === "tar" ? "tar" : "目录"} ·{" "}
                        {formatBytes(item.sizeBytes)}
                        {!item.hasManifest ? "（缺少 manifest，不可导入）" : ""}
                      </span>
                    </label>
                  ))
                )}
              </div>

              <label className="import-confirm-field">
                <span>
                  确认语：请输入{" "}
                  <code>{info?.confirmPhrase ?? "CONFIRM-IMPORT"}</code>{" "}
                  以确认清空并导入
                </span>
                <input
                  autoComplete="off"
                  disabled={starting !== null || unavailable || isVercel}
                  onChange={(event) => setConfirmInput(event.target.value)}
                  placeholder={info?.confirmPhrase ?? "CONFIRM-IMPORT"}
                  spellCheck={false}
                  value={confirmInput}
                />
              </label>

              <div className="import-actions">
                <p className="muted">
                  <TriangleAlert aria-hidden="true" className="inline-icon" />
                  导入期间本服务器不可用；完成后所有用户需要重新登录（会话不迁移）。
                </p>
                <button
                  className="button danger"
                  disabled={
                    starting !== null ||
                    unavailable ||
                    isVercel ||
                    !selectedPackage ||
                    confirmInput.trim() !==
                      (info?.confirmPhrase ?? "CONFIRM-IMPORT")
                  }
                  onClick={() => void onStartImport()}
                  type="button"
                >
                  {starting === "import" ? (
                    <Loader2 aria-hidden="true" className="button-icon spin" />
                  ) : (
                    <ArrowLeftRight
                      aria-hidden="true"
                      className="button-icon"
                    />
                  )}
                  {starting === "import" ? "正在开始导入" : "清空并导入"}
                </button>
              </div>
            </div>
          </section>

          {/* 最近任务 */}
          <section
            className="migration-section jobs-section"
            aria-labelledby="jobs-title"
          >
            <div className="panel-head">
              <div>
                <h2 id="jobs-title">最近任务</h2>
                <p className="muted">导出与导入任务的状态与进度。</p>
              </div>
            </div>
            <div className="jobs-list">
              {jobs.length === 0 ? (
                <p className="muted">暂无迁移任务。</p>
              ) : (
                jobs
                  .slice(0, 10)
                  .map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onDownload={onDownload}
                      downloading={downloading}
                      dismissing={dismissingJob}
                      onDismissError={onDismissError}
                    />
                  ))
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function JobRow({
  job,
  onDownload,
  downloading,
  dismissing,
  onDismissError,
}: {
  job: MigrationJobSummary;
  onDownload: (name: string) => void;
  downloading: string | null;
  dismissing: string | null;
  onDismissError: (jobId: string) => void;
}) {
  const running = job.status === "running" || job.status === "pending";
  const progress = job.progress;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : running
        ? null
        : job.status === "succeeded"
          ? 100
          : 0;

  return (
    <div className={`job-row job-${job.status}`}>
      <div className="job-row-head">
        <span className="job-kind">
          {job.kind === "export" ? "导出" : "导入"}
        </span>
        <span className={`job-status job-status-${job.status}`}>
          {job.status === "succeeded" ? (
            <CheckCircle2 aria-hidden="true" className="job-status-icon" />
          ) : job.status === "failed" ? (
            <XCircle aria-hidden="true" className="job-status-icon" />
          ) : (
            <Loader2 aria-hidden="true" className="job-status-icon spin" />
          )}
          {job.status === "succeeded"
            ? "成功"
            : job.status === "failed"
              ? "失败"
              : job.status === "pending"
                ? "排队中"
                : running
                  ? phaseLabel(job.phase)
                  : "未知"}
        </span>
        <span className="muted job-time">
          {job.startedAt ? formatDateTime(job.startedAt) : ""}
          {job.finishedAt ? ` → ${formatDateTime(job.finishedAt)}` : ""}
        </span>
      </div>
      {percent !== null && running ? (
        <div className="job-progress">
          <div className="job-progress-bar">
            <div
              className="job-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="muted">
            {progress?.done ?? 0}/{progress?.total ?? 0}
            {progress?.label ? ` · ${progress.label}` : ""}
          </span>
        </div>
      ) : null}
      {job.error ? (
        <div className="job-error-row">
          <p className="error-text job-error">{job.error}</p>
          <button
            className="button secondary small"
            disabled={dismissing === job.id}
            onClick={() => onDismissError(job.id)}
            type="button"
          >
            {dismissing === job.id ? "清除中…" : "清除报错"}
          </button>
        </div>
      ) : null}
      {job.status === "succeeded" &&
      job.kind === "export" &&
      job.packageName ? (
        <div className="job-download">
          <span className="muted">迁移包：</span>
          <code>{job.packageName}</code>
          <button
            className="button secondary small"
            disabled={downloading === job.packageName}
            onClick={() => void onDownload(job.packageName!)}
            type="button"
          >
            <Download aria-hidden="true" className="button-icon" />
            {downloading === job.packageName ? "下载中…" : "浏览器下载"}
          </button>
          <span className="muted">（大包建议从服务器目录取）</span>
        </div>
      ) : null}
    </div>
  );
}
