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
  disableHttps,
  enableHttps,
  getHttpsStatus,
  getSystemSettings,
  resetSystemFavicon,
  setHttpsAutoRenew,
  type HttpsStatus,
  type SystemSettings,
  updateSystemSettings,
  uploadSystemFavicon,
} from "@/lib/api";
import { formatDateTime, setAppTimeZone } from "@/lib/labels";
import { setAppFavicon } from "@/components/app-shell/AppSettingsProvider";
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
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [resettingFavicon, setResettingFavicon] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [httpsStatus, setHttpsStatus] = useState<HttpsStatus | null>(null);
  const [httpsDomain, setHttpsDomain] = useState("");
  const [httpsEmail, setHttpsEmail] = useState("");
  const [httpHost, setHttpHost] = useState("");
  const [loadingHttps, setLoadingHttps] = useState(true);
  const [enablingHttps, setEnablingHttps] = useState(false);
  const [disablingHttps, setDisablingHttps] = useState(false);
  const [updatingAutoRenew, setUpdatingAutoRenew] = useState(false);
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
        if (result.https.domain) {
          setHttpsDomain(result.https.domain);
          setHttpHost(result.https.domain);
        } else if (result.https.httpHost) {
          setHttpHost(result.https.httpHost);
          setHttpsDomain(result.https.httpHost);
        } else if (
          window.location.hostname !== "localhost" &&
          !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(window.location.hostname)
        ) {
          setHttpsDomain(window.location.hostname);
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

  async function onFaviconChange(file: File | undefined) {
    if (!file) return;
    setUploadingFavicon(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadSystemFavicon(file);
      setSettings(result.settings);
      setAppFavicon(result.settings.faviconUrl);
      setMessage("网站图标已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "网站图标上传失败");
    } finally {
      setUploadingFavicon(false);
    }
  }

  async function onFaviconReset() {
    if (!window.confirm("确定恢复浏览器默认图标吗？")) return;
    setResettingFavicon(true);
    setError(null);
    setMessage(null);
    try {
      const result = await resetSystemFavicon();
      setSettings(result.settings);
      setAppFavicon(null);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "网站图标重置失败");
    } finally {
      setResettingFavicon(false);
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
    try {
      const result = await enableHttps({
        domain: httpsDomain,
        email: httpsEmail,
      });
      setHttpsStatus(result.https);
      setHttpHost(result.https.domain ?? "");
      setMessage("HTTPS 已启用，正在重新载入服务并切换到安全地址");
      if (!result.https.domain) {
        throw new Error("HTTPS 已启用，但服务器没有返回网站域名");
      }
      const enabledDomain = result.https.domain;
      window.setTimeout(() => {
        window.location.replace(`https://${enabledDomain}/app/admin/settings`);
      }, 12_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "HTTPS 配置失败");
    } finally {
      setEnablingHttps(false);
    }
  }

  async function onDisableHttps() {
    const fallbackHost = httpHost.trim();
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
      const result = await disableHttps({ httpHost: fallbackHost });
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
    <div className="workspace admin-workspace system-settings-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>系统设置</h1>
          <p className="muted">管理网站时区、HTTPS 和浏览器标签页图标。</p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

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
                  <p className="muted">
                    仅保存网站时区，不影响下方的网站图标。
                  </p>
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
                      自动尝试 ACME HTTP-01；TCP 80 无法验证时改用基于 TCP 443
                      的 TLS-ALPN-01，不绑定域名服务商。
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
                            <small>定时检查并在证书接近到期时自动更新</small>
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
                          <label>
                            <span>停用后的 HTTP 访问地址</span>
                            <input
                              autoCapitalize="none"
                              disabled={disablingHttps}
                              onChange={(event) =>
                                setHttpHost(event.target.value)
                              }
                              placeholder="8.166.143.156"
                              spellCheck={false}
                              value={httpHost}
                            />
                          </label>
                          <button
                            className="button danger"
                            disabled={disablingHttps || updatingAutoRenew}
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
                        域名需指向本服务器；公网 IPv4 将使用约 6
                        天有效期的短证书。TCP 80 可达时优先使用 HTTP
                        验证，否则自动通过 TCP 443 验证；配置失败会恢复原入口。
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
                      请先使用包含 HTTPS
                      助手的新版生产安装包升级服务器。开发环境不会操作本机
                      Nginx。
                    </p>
                  </div>
                )}
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
                      统一浏览器标签页和收藏夹中的网站标识，上传或恢复后立即生效。
                    </p>
                  </div>
                </div>

                <div className="favicon-setting-card">
                  <div className="favicon-preview" aria-label="当前网站图标">
                    {settings?.faviconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={apiResourceUrl(settings.faviconUrl)} />
                    ) : (
                      <Globe2 aria-hidden="true" />
                    )}
                  </div>
                  <div className="favicon-setting-copy">
                    <strong>
                      {settings?.faviconUrl
                        ? "当前使用自定义图标"
                        : "当前使用浏览器默认图标"}
                    </strong>
                    <p className="muted">
                      支持 ICO、PNG、JPEG 和 WebP，文件不超过 1MB。
                    </p>
                  </div>
                  <div className="favicon-setting-actions">
                    <label className="button secondary favicon-upload-button">
                      <ImageUp aria-hidden="true" className="button-icon" />
                      {uploadingFavicon ? "上传中" : "上传并替换"}
                      <input
                        accept=".ico,image/x-icon,image/png,image/jpeg,image/webp"
                        disabled={uploadingFavicon || resettingFavicon}
                        onChange={(event) => {
                          void onFaviconChange(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    {settings?.faviconUrl ? (
                      <button
                        className="button secondary"
                        disabled={uploadingFavicon || resettingFavicon}
                        onClick={() => void onFaviconReset()}
                        type="button"
                      >
                        <RotateCcw aria-hidden="true" className="button-icon" />
                        {resettingFavicon ? "重置中" : "恢复默认"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

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
              <dt>HTTPS</dt>
              <dd>
                {httpsStatus?.enabled
                  ? httpsStatus.domain
                  : httpsStatus?.available
                    ? "未启用"
                    : "不可用"}
              </dd>
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
