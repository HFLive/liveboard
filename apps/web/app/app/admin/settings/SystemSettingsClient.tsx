"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Clock,
  Globe2,
  ImageUp,
  LockKeyhole,
  Power,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import {
  apiResourceUrl,
  configureHttpAccess,
  disableHttps,
  enableHttps,
  getHttpsStatus,
  getSystemSettings,
  resetSystemFavicon,
  setHttpsAutoRenew,
  type FaviconVariant,
  type HttpsStatus,
  type SystemSettings,
  updateSystemSettings,
  uploadSystemFavicon,
} from "@/lib/api";
import { formatDateTime, setAppTimeZone } from "@/lib/labels";
import { waitForWebReady } from "@/lib/waitForWebReady";
import { setAppIconSettings } from "@/components/app-shell/AppSettingsProvider";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SkeletonRows } from "@/components/system/ProgressiveLoading";

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

const faviconVariants: Array<{
  key: FaviconVariant;
  title: string;
  description: string;
  optional: boolean;
}> = [
  {
    key: "default",
    title: "默认图标",
    description: "浅色或深色版本未设置时使用。",
    optional: false,
  },
  {
    key: "light",
    title: "浅色界面",
    description: "用于浅色背景；未设置时使用默认图标。",
    optional: true,
  },
  {
    key: "dark",
    title: "深色界面",
    description: "用于深色背景；未设置时使用默认图标。",
    optional: true,
  },
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

function faviconUrlForVariant(
  settings: SystemSettings | null,
  variant: FaviconVariant,
) {
  if (!settings) return null;
  if (variant === "light") return settings.faviconLightUrl;
  if (variant === "dark") return settings.faviconDarkUrl;
  return settings.faviconUrl;
}

export function SystemSettingsClient() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [timeZone, setTimeZone] = useState("Asia/Shanghai");
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFavicon, setUploadingFavicon] =
    useState<FaviconVariant | null>(null);
  const [resettingFavicon, setResettingFavicon] =
    useState<FaviconVariant | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [httpsStatus, setHttpsStatus] = useState<HttpsStatus | null>(null);
  const [httpsDomain, setHttpsDomain] = useState("");
  const [httpsEmail, setHttpsEmail] = useState("");
  const [httpHost, setHttpHost] = useState("");
  const [httpAliases, setHttpAliases] = useState("");
  const [loadingHttps, setLoadingHttps] = useState(true);
  const [enablingHttps, setEnablingHttps] = useState(false);
  const [disablingHttps, setDisablingHttps] = useState(false);
  const [updatingAutoRenew, setUpdatingAutoRenew] = useState(false);
  const [savingHttpAccess, setSavingHttpAccess] = useState(false);
  const [protocolSwitchTarget, setProtocolSwitchTarget] = useState<
    string | null
  >(null);
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
      })
      .finally(() => setLoadingSettings(false));
  }, []);

  useEffect(() => {
    getHttpsStatus()
      .then((result) => {
        setHttpsStatus(result.https);
        const primaryHost =
          result.https.httpPrimaryHost ??
          result.https.httpHost ??
          result.https.domain;
        const allowedHosts = result.https.httpAllowedHosts ?? [];
        if (primaryHost) {
          setHttpHost(primaryHost);
          setHttpAliases(
            allowedHosts.filter((host) => host !== primaryHost).join("\n"),
          );
        }
        if (result.https.domain) {
          setHttpsDomain(result.https.domain);
        } else if (primaryHost) {
          setHttpsDomain(primaryHost);
        } else if (window.location.hostname !== "localhost") {
          setHttpHost(window.location.hostname);
          if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(window.location.hostname)) {
            setHttpsDomain(window.location.hostname);
          }
        }
      })
      .catch((caught) => {
        setError(
          caught instanceof Error ? caught.message : "加载 HTTPS 状态失败",
        );
      })
      .finally(() => setLoadingHttps(false));
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

  async function onFaviconChange(
    file: File | undefined,
    variant: FaviconVariant,
  ) {
    if (!file) return;
    setUploadingFavicon(variant);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadSystemFavicon(file, variant);
      setSettings(result.settings);
      setAppIconSettings(result.settings);
      setMessage(
        variant === "default"
          ? "默认网站图标已更新"
          : `${variant === "light" ? "浅色" : "深色"}界面图标已更新`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "网站图标上传失败");
    } finally {
      setUploadingFavicon(null);
    }
  }

  async function onFaviconReset(variant: FaviconVariant) {
    const label =
      variant === "default"
        ? "默认图标"
        : `${variant === "light" ? "浅色" : "深色"}界面图标`;
    if (!window.confirm(`确定移除${label}吗？`)) return;
    setResettingFavicon(variant);
    setError(null);
    setMessage(null);
    try {
      const result = await resetSystemFavicon(variant);
      setSettings(result.settings);
      setAppIconSettings(result.settings);
      setMessage(`${label}已移除`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "网站图标重置失败");
    } finally {
      setResettingFavicon(null);
    }
  }

  async function onEnableHttps(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !window.confirm(
        `确定为 ${httpsDomain.trim()} 签发证书并将网站切换到 HTTPS 吗？`,
      )
    ) {
      return;
    }

    setEnablingHttps(true);
    setError(null);
    setMessage(null);
    setProtocolSwitchTarget(null);
    try {
      const result = await enableHttps({
        domain: httpsDomain,
        email: httpsEmail,
      });
      setHttpsStatus(result.https);
      const enabledPrimary =
        result.https.httpPrimaryHost ??
        result.https.httpHost ??
        result.https.domain;
      if (enabledPrimary) {
        setHttpHost(enabledPrimary);
        setHttpAliases(
          (result.https.httpAllowedHosts ?? [])
            .filter((host) => host !== enabledPrimary)
            .join("\n"),
        );
      }
      if (!result.https.domain) {
        throw new Error("HTTPS 已启用，但服务器没有返回网站域名");
      }
      const enabledDomain = result.https.domain;
      const target = `https://${enabledDomain}/app/admin/settings`;
      setMessage("HTTPS 已启用，正在等待 Web 服务恢复后切换到安全地址");
      const ready = await waitForWebReady(new URL(target).origin);
      if (!ready) {
        setProtocolSwitchTarget(target);
        setError(
          "HTTPS 已成功启用，但等待 Web 服务恢复超时。请稍后通过下方安全地址重试。",
        );
        return;
      }
      window.location.replace(target);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "HTTPS 配置失败");
    } finally {
      setEnablingHttps(false);
    }
  }

  async function onDisableHttps() {
    const fallbackHost =
      httpsStatus?.httpPrimaryHost ?? httpsStatus?.httpHost ?? "";
    if (!fallbackHost) {
      setError("请填写停用后用于 HTTP 访问的域名或公网 IPv4");
      return;
    }
    if (
      !window.confirm(
        `确定停用 HTTPS 并切换到 http://${fallbackHost} 吗？停用后需要重新登录。`,
      )
    ) {
      return;
    }

    setDisablingHttps(true);
    setError(null);
    setMessage(null);
    try {
      const result = await disableHttps();
      setHttpsStatus(result.https);
      setMessage("HTTPS 已停用，正在重新载入服务并切换到 HTTP");
      window.setTimeout(() => {
        window.location.replace(`http://${fallbackHost}/app/admin/settings`);
      }, 12_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "停用 HTTPS 失败");
    } finally {
      setDisablingHttps(false);
    }
  }

  async function onSaveHttpAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const primaryHost = httpHost.trim();
    if (!primaryHost) {
      setError("请填写首选 HTTP 访问地址");
      return;
    }
    const allowedHosts = Array.from(
      new Set(
        [
          primaryHost,
          ...httpAliases.split(/[,\n]/),
          ...(!httpsStatus?.enabled && window.location.hostname !== "localhost"
            ? [window.location.hostname]
            : []),
        ]
          .map((host) => host.trim())
          .filter(Boolean),
      ),
    );

    setSavingHttpAccess(true);
    setError(null);
    setMessage(null);
    setProtocolSwitchTarget(null);
    try {
      const result = await configureHttpAccess({
        primaryHost,
        allowedHosts,
      });
      setHttpsStatus(result.https);
      const savedPrimary =
        result.https.httpPrimaryHost ?? result.https.httpHost ?? primaryHost;
      setHttpHost(savedPrimary);
      setHttpAliases(
        (result.https.httpAllowedHosts ?? [])
          .filter((host) => host !== savedPrimary)
          .join("\n"),
      );

      if (result.https.enabled) {
        setMessage("HTTP 降级设置已保存，当前 HTTPS 不受影响");
        return;
      }

      const target = `http://${savedPrimary}/app/admin/settings`;
      setMessage("HTTP 访问设置已保存，正在等待服务重新载入");
      const ready = await waitForWebReady(new URL(target).origin);
      if (!ready) {
        setProtocolSwitchTarget(target);
        setError(
          "HTTP 配置已经保存，但等待 Web 服务恢复超时。请稍后通过下方地址重试。",
        );
        return;
      }
      window.location.replace(target);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "保存 HTTP 访问设置失败",
      );
    } finally {
      setSavingHttpAccess(false);
    }
  }

  async function onAutoRenewChange(enabled: boolean) {
    if (
      !enabled &&
      httpsStatus?.subjectType === "ip" &&
      !window.confirm(
        "IP HTTPS 证书只有约 6 天有效期。关闭自动续期后网站很快会出现证书错误，仍要关闭吗？",
      )
    ) {
      return;
    }
    setUpdatingAutoRenew(true);
    setError(null);
    setMessage(null);
    try {
      const result = await setHttpsAutoRenew(enabled);
      setHttpsStatus(result.https);
      setMessage(enabled ? "自动续期已开启" : "自动续期已关闭");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "更新自动续期设置失败",
      );
    } finally {
      setUpdatingAutoRenew(false);
    }
  }

  return (
    <div className="workspace admin-workspace admin-page admin-page--focused system-settings-page">
      <AdminPageHeader
        category="系统与服务"
        description="设置时区、HTTPS 和网站图标。"
        title="系统设置"
      />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}
      {protocolSwitchTarget ? (
        <p className="muted">
          <a href={protocolSwitchTarget}>打开 HTTPS 管理页面</a>
        </p>
      ) : null}

      <section className="workbench system-settings-layout">
        <div className="workbench-main system-settings-sections">
          {loadingSettings ? (
            <SkeletonRows count={7} />
          ) : (
            <>
              <form
                className="form system-setting-section timezone-setting-section"
                onSubmit={onSubmit}
              >
                <div className="panel-head">
                  <div>
                    <h2>
                      <Globe2 aria-hidden="true" className="heading-icon" />
                      网站时区
                    </h2>
                    <p className="muted">控制全站日期和时间显示。</p>
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
                  <button className="button" type="submit">
                    <Save aria-hidden="true" className="button-icon" />
                    保存时区
                  </button>
                </div>
              </form>

              <section
                aria-labelledby="https-setting-title"
                className="system-setting-section https-setting-section"
              >
                <div className="panel-head">
                  <div>
                    <h2 id="https-setting-title">
                      <LockKeyhole
                        aria-hidden="true"
                        className="heading-icon"
                      />
                      HTTPS
                    </h2>
                    <p className="muted">
                      为域名或公网 IPv4 配置证书并自动续期。
                    </p>
                  </div>
                </div>

                {loadingHttps ? (
                  <SkeletonRows count={3} />
                ) : httpsStatus?.enabled ? (
                  <div className="https-enabled-panel">
                    <ShieldCheck aria-hidden="true" />
                    <div>
                      <strong>HTTPS 已启用</strong>
                      <p>
                        <a
                          href={`https://${httpsStatus.domain}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {httpsStatus.domain}
                        </a>
                      </p>
                      <p className="muted">
                        {httpsStatus.subjectType === "ip"
                          ? "公网 IPv4 短证书"
                          : "域名证书"}
                        ，有效期至{" "}
                        {httpsStatus.expiresAt
                          ? formatDateTime(httpsStatus.expiresAt)
                          : "未知"}
                        {httpsStatus.autoRenewEnabled
                          ? "；系统已开启自动续期"
                          : "；自动续期已关闭"}
                        {httpsStatus.challengeType === "tls-alpn-01"
                          ? "，续期验证时 HTTPS 可能短暂不可用。"
                          : "。"}
                      </p>
                      {httpsStatus.subjectType === "ip" ? (
                        <p className="muted">
                          IP 证书使用 Let&apos;s Encrypt shortlived
                          profile，有效期约 6 天，建议始终开启自动续期。
                        </p>
                      ) : null}
                      {httpsStatus.lastError ? (
                        <p className="error-text">{httpsStatus.lastError}</p>
                      ) : null}
                      <div className="https-management-controls">
                        <label className="https-renew-control">
                          <span>
                            <strong>自动续期</strong>
                            <small>证书到期前自动更新</small>
                          </span>
                          <input
                            aria-label="自动续期"
                            checked={httpsStatus.autoRenewEnabled}
                            disabled={updatingAutoRenew || disablingHttps}
                            onChange={(event) =>
                              void onAutoRenewChange(event.target.checked)
                            }
                            type="checkbox"
                          />
                        </label>
                        <div className="https-disable-controls">
                          <span>
                            <strong>停用后切换到</strong>
                            <small>
                              http://
                              {httpsStatus.httpPrimaryHost ??
                                httpsStatus.httpHost ??
                                "尚未配置"}
                            </small>
                          </span>
                          <button
                            className="button danger"
                            disabled={
                              disablingHttps ||
                              updatingAutoRenew ||
                              savingHttpAccess ||
                              !(
                                httpsStatus.httpPrimaryHost ??
                                httpsStatus.httpHost
                              )
                            }
                            onClick={() => void onDisableHttps()}
                            type="button"
                          >
                            <Power aria-hidden="true" className="button-icon" />
                            {disablingHttps ? "正在停用" : "停用 HTTPS"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : httpsStatus?.available ? (
                  <form
                    className="https-enable-form"
                    onSubmit={(event) => void onEnableHttps(event)}
                  >
                    <label>
                      <span>网站域名或公网 IPv4</span>
                      <input
                        autoCapitalize="none"
                        autoComplete="url"
                        disabled={enablingHttps}
                        onChange={(event) => setHttpsDomain(event.target.value)}
                        placeholder="board.example.com 或 8.166.143.156"
                        required
                        spellCheck={false}
                        value={httpsDomain}
                      />
                    </label>
                    <label>
                      <span>证书通知邮箱</span>
                      <input
                        autoComplete="email"
                        disabled={enablingHttps}
                        onChange={(event) => setHttpsEmail(event.target.value)}
                        placeholder="admin@example.com"
                        required
                        type="email"
                        value={httpsEmail}
                      />
                    </label>
                    <div className="https-enable-actions">
                      <p className="muted">
                        域名需指向本服务器。IPv4 证书约 6
                        天有效，建议开启自动续期；失败时保留原入口。
                      </p>
                      <button
                        className="button"
                        disabled={enablingHttps}
                        type="submit"
                      >
                        <LockKeyhole
                          aria-hidden="true"
                          className="button-icon"
                        />
                        {enablingHttps ? "正在签发并配置" : "检查并启用 HTTPS"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="https-unavailable-panel">
                    <strong>当前部署不支持面板配置 HTTPS</strong>
                    <p className="muted">
                      需要使用包含 HTTPS
                      助手的生产安装包；开发环境不支持此功能。
                    </p>
                  </div>
                )}
                {httpsStatus?.available && !loadingHttps ? (
                  <form
                    className="http-access-form"
                    onSubmit={(event) => void onSaveHttpAccess(event)}
                  >
                    <div className="http-access-heading">
                      <div>
                        <strong>
                          {httpsStatus.enabled
                            ? "HTTP 降级设置"
                            : "HTTP 访问设置"}
                        </strong>
                        <p className="muted">
                          {httpsStatus.enabled
                            ? "设置停用 HTTPS 后使用的地址，不影响当前证书。"
                            : "设置默认 HTTP 地址和其他允许访问的地址。"}
                        </p>
                      </div>
                    </div>
                    <div className="http-access-fields">
                      <label>
                        <span>首选 HTTP 地址</span>
                        <div className="http-host-input">
                          <span>http://</span>
                          <input
                            autoCapitalize="none"
                            disabled={savingHttpAccess || disablingHttps}
                            onChange={(event) =>
                              setHttpHost(event.target.value)
                            }
                            placeholder="8.166.143.156"
                            required
                            spellCheck={false}
                            value={httpHost}
                          />
                        </div>
                      </label>
                      <label>
                        <span>其他允许地址</span>
                        <textarea
                          autoCapitalize="none"
                          disabled={savingHttpAccess || disablingHttps}
                          onChange={(event) =>
                            setHttpAliases(event.target.value)
                          }
                          placeholder={
                            "board.example.com\n每行一个域名或公网 IPv4"
                          }
                          rows={3}
                          spellCheck={false}
                          value={httpAliases}
                        />
                      </label>
                    </div>
                    <div className="http-access-actions">
                      <p className="muted">
                        最多 8 个地址；未知 Host 不会自动放行。
                      </p>
                      <button
                        className="button secondary"
                        disabled={savingHttpAccess || disablingHttps}
                        type="submit"
                      >
                        <Save aria-hidden="true" className="button-icon" />
                        {savingHttpAccess
                          ? "正在验证并保存"
                          : httpsStatus.enabled
                            ? "保存降级设置"
                            : "应用 HTTP 设置"}
                      </button>
                    </div>
                  </form>
                ) : null}
              </section>

              <section
                aria-labelledby="favicon-setting-title"
                className="system-setting-section favicon-setting-section"
              >
                <div className="panel-head">
                  <div>
                    <h2 id="favicon-setting-title">
                      <ImageUp aria-hidden="true" className="heading-icon" />
                      网站图标
                    </h2>
                    <p className="muted">
                      用于浏览器标签页、收藏夹和站内品牌标识。
                    </p>
                  </div>
                </div>

                <div className="favicon-variant-list">
                  {faviconVariants.map((variant) => {
                    const configuredUrl = faviconUrlForVariant(
                      settings,
                      variant.key,
                    );
                    const previewUrl =
                      configuredUrl ??
                      (variant.key === "default"
                        ? null
                        : (settings?.faviconUrl ?? null));
                    const busy =
                      uploadingFavicon !== null || resettingFavicon !== null;

                    return (
                      <div className="favicon-setting-card" key={variant.key}>
                        <div
                          aria-label={`${variant.title}预览`}
                          className={`favicon-preview ${
                            variant.key === "dark" ? "is-dark" : ""
                          }`.trim()}
                        >
                          {previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={apiResourceUrl(previewUrl)} />
                          ) : (
                            <Globe2 aria-hidden="true" />
                          )}
                        </div>
                        <div className="favicon-setting-copy">
                          <strong>
                            {variant.title}
                            {variant.optional ? <small>可选</small> : null}
                          </strong>
                          <p className="muted">
                            {configuredUrl
                              ? variant.description
                              : variant.key === "default"
                                ? "未上传时显示内置 LB 标记。"
                                : variant.description}
                          </p>
                        </div>
                        <div className="favicon-setting-actions">
                          <label className="button secondary favicon-upload-button">
                            <ImageUp
                              aria-hidden="true"
                              className="button-icon"
                            />
                            {uploadingFavicon === variant.key
                              ? "上传中"
                              : configuredUrl
                                ? "替换"
                                : "上传"}
                            <input
                              accept=".ico,image/x-icon,image/png,image/jpeg,image/webp"
                              aria-label={`上传${variant.title}`}
                              disabled={busy}
                              onChange={(event) => {
                                void onFaviconChange(
                                  event.target.files?.[0],
                                  variant.key,
                                );
                                event.currentTarget.value = "";
                              }}
                              type="file"
                            />
                          </label>
                          {configuredUrl ? (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => void onFaviconReset(variant.key)}
                              type="button"
                            >
                              <RotateCcw
                                aria-hidden="true"
                                className="button-icon"
                              />
                              {resettingFavicon === variant.key
                                ? "移除中"
                                : "移除"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
