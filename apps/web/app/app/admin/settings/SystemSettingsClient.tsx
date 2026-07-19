"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Clock, Globe2, Save } from "lucide-react";
import {
  getSystemSettings,
  type SystemSettings,
  updateSystemSettings,
} from "@/lib/api";
import { formatDateTime, setAppTimeZone } from "@/lib/labels";
import { AdminSubnav } from "@/components/admin/AdminSubnav";

const fallbackTimeZones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
];

const quickTimeZones = [
  { value: "Asia/Shanghai", label: "上海" },
  { value: "Asia/Hong_Kong", label: "香港" },
  { value: "Asia/Tokyo", label: "东京" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "伦敦" },
  { value: "America/New_York", label: "纽约" },
  { value: "America/Los_Angeles", label: "洛杉矶" },
];

function getAvailableTimeZones(currentTimeZone: string) {
  const intlWithValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const supported = intlWithValues.supportedValuesOf?.("timeZone") ?? [];
  const zones = new Set([...fallbackTimeZones, ...supported, currentTimeZone]);

  return Array.from(zones)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function getTimeZonePreview(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date());
  } catch {
    return "无效时区";
  }
}

function getTimeZoneOffset(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());

    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function formatTimeZoneLabel(timeZone: string) {
  const offset = getTimeZoneOffset(timeZone);
  return offset ? `${timeZone} (${offset})` : timeZone;
}

export function SystemSettingsClient() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [timeZone, setTimeZone] = useState("Asia/Shanghai");
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timeZoneOptions = useMemo(
    () => getAvailableTimeZones(timeZone),
    [timeZone],
  );

  useEffect(() => {
    getSystemSettings()
      .then((result) => {
        setSettings(result.settings);
        setTimeZone(result.settings.timeZone);
        setAppTimeZone(result.settings.timeZone);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载系统设置失败");
      });
  }, []);

  useEffect(() => {
    function refreshPreview() {
      setPreview(getTimeZonePreview(timeZone));
    }

    refreshPreview();
    const timer = window.setInterval(refreshPreview, 60_000);

    return () => window.clearInterval(timer);
  }, [timeZone]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      const result = await updateSystemSettings({ timeZone });
      setSettings(result.settings);
      setTimeZone(result.settings.timeZone);
      setAppTimeZone(result.settings.timeZone);
      setMessage("系统设置已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存系统设置失败");
    }
  }

  return (
    <div className="workspace admin-workspace system-settings-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>系统设置</h1>
          <p className="muted">维护全站时区与统一的时间显示规则。</p>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="workbench ai-settings-layout system-settings-layout">
        <form
          className="workbench-main form system-settings-form"
          onSubmit={onSubmit}
        >
          <div className="panel-head">
            <div>
              <h2>
                <Globe2 aria-hidden="true" className="heading-icon" />
                网站时区
              </h2>
              <p className="muted">
                统一所有页面的日期、更新时间和论坛时间显示。
              </p>
            </div>
          </div>

          <div className="timezone-setting-card">
            <div className="timezone-field-group">
              <span className="timezone-field-label">常用时区</span>
              <div className="timezone-quick-list" aria-label="常用时区">
                {quickTimeZones.map((option) => (
                  <button
                    aria-pressed={timeZone === option.value}
                    className={`timezone-chip ${
                      timeZone === option.value ? "active" : ""
                    }`}
                    key={option.value}
                    onClick={() => setTimeZone(option.value)}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <small>{getTimeZoneOffset(option.value)}</small>
                  </button>
                ))}
              </div>
            </div>

            <label className="timezone-field-group">
              <span className="timezone-field-label">全部时区</span>
              <select
                className="select timezone-select"
                onChange={(event) => setTimeZone(event.target.value)}
                value={timeZone}
              >
                {timeZoneOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatTimeZoneLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="settings-preview-panel">
            <div>
              <span>当前预览</span>
              <strong>{preview}</strong>
            </div>
            <Clock aria-hidden="true" />
          </div>

          <div className="system-settings-actions">
            <p className="muted">保存后，全站的新页面将使用所选时区。</p>
            <button className="button" type="submit">
              <Save aria-hidden="true" className="button-icon" />
              保存设置
            </button>
          </div>
        </form>

        <aside className="action-panel quiet system-settings-side">
          <h2>设置状态</h2>
          <dl className="settings-status-list">
            <div>
              <dt>工作区</dt>
              <dd>{settings?.workspaceName ?? "-"}</dd>
            </div>
            <div>
              <dt>当前时区</dt>
              <dd>{settings?.timeZone ?? "-"}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{settings ? formatDateTime(settings.updatedAt) : "-"}</dd>
            </div>
          </dl>
          <p className="muted">
            保存后，新打开或刷新的页面会使用该时区；当前页面的时间预览会立即更新。
          </p>
        </aside>
      </section>
    </div>
  );
}
