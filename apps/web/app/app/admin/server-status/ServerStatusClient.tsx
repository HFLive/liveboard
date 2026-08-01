"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerMetricPoint, ServerStatusSummary } from "@liveboard/shared";
import { Cpu, Database, MemoryStick, RefreshCw } from "lucide-react";
import { getServerStatus } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

const ranges = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
] as const;

type MetricKey = "cpuUsagePercent" | "memoryUsagePercent" | "diskUsagePercent";

export function ServerStatusClient() {
  const [rangeHours, setRangeHours] = useState(24);
  const [status, setStatus] = useState<ServerStatusSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle("运行状态");

  const loadStatus = useCallback(
    async (showRefreshing = false) => {
      if (showRefreshing) setRefreshing(true);
      try {
        const result = await getServerStatus(rangeHours);
        setStatus(result);
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "加载服务器状态失败",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rangeHours],
  );

  useEffect(() => {
    setLoading(true);
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const serverlessStatus = status?.mode === "serverless" ? status : null;
  const hostStatus = status?.mode === "host" ? status : null;

  const chartPoints = useMemo(() => {
    if (!hostStatus) return [];
    const currentPoint: ServerMetricPoint = {
      sampledAt: hostStatus.current.sampledAt,
      cpuUsagePercent: hostStatus.current.cpuUsagePercent,
      memoryUsagePercent: hostStatus.current.memory.usagePercent,
      diskUsagePercent: hostStatus.current.disk.usagePercent,
    };
    const points = hostStatus.history.filter(
      (point) => point.sampledAt !== currentPoint.sampledAt,
    );
    return [...points, currentPoint];
  }, [hostStatus]);

  return (
    <div className="workspace admin-workspace admin-page admin-page--standard server-status-page">
      <AdminPageHeader
        category="系统与服务"
        description="查看 CPU、内存和磁盘用量。"
        title="运行状态"
      />

      {error ? <p className="error-text">{error}</p> : null}

      {serverlessStatus ? (
        <section aria-label="托管依赖状态" className="server-metric-grid">
          <ServerlessDependencyCard
            label="PostgreSQL"
            state={serverlessStatus.dependencies.postgres}
          />
          <ServerlessDependencyCard
            label="Redis"
            state={serverlessStatus.dependencies.redis}
          />
          <ServerlessDependencyCard
            label="R2"
            state={serverlessStatus.dependencies.r2}
          />
          <div className="serverless-note">
            当前环境由 Vercel Serverless 托管，不展示临时实例的 CPU、内存或
            磁盘容量。
            {serverlessStatus.region ? (
              <span>
                Region：{serverlessStatus.region}
                {serverlessStatus.deploymentId
                  ? ` · ${serverlessStatus.deploymentId}`
                  : ""}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {hostStatus ? (
        <>
          <section aria-label="当前资源占用" className="server-metric-grid">
            <MetricCard
              detail="实时采样"
              icon={Cpu}
              label="CPU"
              loading={loading}
              percent={hostStatus.current.cpuUsagePercent}
            />
            <MetricCard
              detail={`${formatBytes(hostStatus.current.memory.usedBytes)} / ${formatBytes(
                hostStatus.current.memory.totalBytes,
              )}`}
              icon={MemoryStick}
              label="内存"
              loading={loading}
              percent={hostStatus.current.memory.usagePercent}
            />
            <MetricCard
              detail={`${formatBytes(hostStatus.current.disk.usedBytes)} / ${formatBytes(
                hostStatus.current.disk.totalBytes,
              )}`}
              icon={Database}
              label="磁盘"
              loading={loading}
              percent={hostStatus.current.disk.usagePercent}
            />
          </section>

          <section className="server-trend-section">
            <div className="server-trend-head">
              <div>
                <h2>占用率趋势</h2>
                <p className="muted">
                  每 {hostStatus.sampleIntervalSeconds} 秒采样，保留{" "}
                  {Math.round(hostStatus.retentionHours / 24)} 天。
                </p>
              </div>
              <div className="server-trend-actions">
                <div aria-label="趋势时间范围" className="segmented">
                  {ranges.map((range) => (
                    <button
                      aria-pressed={rangeHours === range.hours}
                      className={
                        rangeHours === range.hours ? "active" : undefined
                      }
                      key={range.hours}
                      onClick={() => setRangeHours(range.hours)}
                      type="button"
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
                <button
                  aria-label="刷新服务器状态"
                  className="icon-button subtle"
                  disabled={refreshing}
                  onClick={() => void loadStatus(true)}
                  title="刷新"
                  type="button"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={refreshing ? "spinning" : undefined}
                  />
                </button>
              </div>
            </div>

            <div className="server-chart-legend" aria-label="图例">
              <span className="cpu">CPU</span>
              <span className="memory">内存</span>
              <span className="disk">磁盘</span>
            </div>

            {loading && !hostStatus ? (
              <div className="skeleton server-chart-skeleton" />
            ) : (
              <UsageChart hours={rangeHours} points={chartPoints} />
            )}

            <p className="server-sampled-at">
              {`当前值采样于 ${formatSampleTime(hostStatus.current.sampledAt)}`}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  percent,
  detail,
  icon: Icon,
  loading,
}: {
  label: string;
  percent?: number;
  detail?: string;
  icon: typeof Cpu;
  loading: boolean;
}) {
  const normalized = Math.min(100, Math.max(0, percent ?? 0));

  return (
    <article className="server-metric">
      <div className="server-metric-label">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </div>
      {loading && percent === undefined ? (
        <div className="skeleton server-metric-skeleton" />
      ) : (
        <>
          <strong>{formatPercent(normalized)}</strong>
          <div
            aria-label={`${label}占用 ${formatPercent(normalized)}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={normalized}
            className="server-meter"
            role="progressbar"
          >
            <span style={{ width: `${normalized}%` }} />
          </div>
          <small>{detail ?? "—"}</small>
        </>
      )}
    </article>
  );
}

function UsageChart({
  points,
  hours,
}: {
  points: ServerMetricPoint[];
  hours: number;
}) {
  const width = 760;
  const height = 260;
  const plot = { left: 44, right: 744, top: 18, bottom: 220 };
  const latestPoint = points.at(-1);
  const endTime =
    latestPoint !== undefined ? Date.parse(latestPoint.sampledAt) : Date.now();
  const startTime = endTime - hours * 60 * 60 * 1_000;
  const visiblePoints = points.filter(
    (point) => Date.parse(point.sampledAt) >= startTime,
  );
  const historyDuration =
    visiblePoints.length > 1
      ? Date.parse(visiblePoints.at(-1)?.sampledAt ?? "") -
        Date.parse(visiblePoints[0]?.sampledAt ?? "")
      : 0;
  const metrics: Array<{ key: MetricKey; className: string }> = [
    { key: "cpuUsagePercent", className: "cpu" },
    { key: "memoryUsagePercent", className: "memory" },
    { key: "diskUsagePercent", className: "disk" },
  ];

  return (
    <div className="server-chart-wrap">
      <svg
        aria-label={`最近 ${hours} 小时 CPU、内存和磁盘占用率曲线`}
        className="server-chart"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 25, 50, 75, 100].map((value) => {
          const y = plot.bottom - (value / 100) * (plot.bottom - plot.top);
          return (
            <g className="server-chart-grid" key={value}>
              <line x1={plot.left} x2={plot.right} y1={y} y2={y} />
              <text x={plot.left - 8} y={y + 4}>
                {value}%
              </text>
            </g>
          );
        })}
        {metrics.map((metric) => (
          <path
            className={`server-chart-line ${metric.className}`}
            d={buildPath(visiblePoints, metric.key, startTime, endTime, plot)}
            key={metric.key}
          />
        ))}
        <text className="server-chart-time" x={plot.left} y={height - 12}>
          {formatChartTime(startTime, hours)}
        </text>
        <text className="server-chart-time end" x={plot.right} y={height - 12}>
          {formatChartTime(endTime, hours)}
        </text>
      </svg>
      {visiblePoints.length < 2 || historyDuration < 60_000 ? (
        <p className="server-chart-empty">正在积累历史数据，稍后将形成曲线。</p>
      ) : null}
    </div>
  );
}

function buildPath(
  points: ServerMetricPoint[],
  key: MetricKey,
  startTime: number,
  endTime: number,
  plot: { left: number; right: number; top: number; bottom: number },
) {
  const duration = Math.max(1, endTime - startTime);
  return points
    .map((point, index) => {
      const timestamp = Date.parse(point.sampledAt);
      const x =
        plot.left +
        ((timestamp - startTime) / duration) * (plot.right - plot.left);
      const value = Math.min(100, Math.max(0, point[key]));
      const y = plot.bottom - (value / 100) * (plot.bottom - plot.top);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex >= 3 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatSampleTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatChartTime(value: number, hours: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: hours >= 24 ? "2-digit" : undefined,
    day: hours >= 24 ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ServerlessDependencyCard({
  label,
  state,
}: {
  label: string;
  state: "ok" | "unavailable";
}) {
  return (
    <article className="server-metric">
      <div className="server-metric-label">
        <Database aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong
        className={
          state === "ok"
            ? "serverless-dependency-ok"
            : "serverless-dependency-down"
        }
      >
        {state === "ok" ? "正常" : "不可用"}
      </strong>
    </article>
  );
}
