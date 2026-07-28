"use client";

import { FormEvent, useEffect, useState } from "react";
import { Cloud, HardDrive, PlugZap } from "lucide-react";
import {
  getStorageSettings,
  StorageSettings,
  testStorageConnection,
  updateStorageSettings,
} from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { SkeletonRows } from "@/components/system/ProgressiveLoading";

type BackendChoice = "minio" | "oss";
type DownloadModeChoice = "proxy" | "direct";

export function StorageBackendClient() {
  useDocumentTitle("存储后端");

  const [settings, setSettings] = useState<StorageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<BackendChoice>("minio");
  const [downloadMode, setDownloadMode] = useState<DownloadModeChoice>("proxy");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [internal, setInternal] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getStorageSettings()
      .then((result) => {
        setSettings(result.storage);
        setBackend(result.storage.backend);
        setDownloadMode(result.storage.downloadMode);
        setRegion(result.storage.oss.region ?? "");
        setBucket(result.storage.oss.bucket ?? "");
        setEndpoint(result.storage.oss.endpoint ?? "");
        setInternal(
          result.storage.downloadMode === "direct"
            ? false
            : result.storage.oss.internal,
        );
        setAccessKeyId(result.storage.oss.accessKeyId ?? "");
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "加载存储设置失败"),
      )
      .finally(() => setLoading(false));
  }, []);

  async function onTestConnection() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      await testStorageConnection({
        region: region.trim(),
        bucket: bucket.trim(),
        endpoint: endpoint.trim(),
        internal,
        accessKeyId: accessKeyId.trim(),
        accessKeySecret: accessKeySecret.trim() || undefined,
      });
      setMessage("连接成功，OSS 读写探测通过");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    if (backend !== settings.backend) {
      const target = backend === "oss" ? "阿里云 OSS" : "服务器存储";
      const confirmed = window.confirm(
        `确定切换到${target}吗？切换只影响新上传的文件，已有文件仍从原存储读取，可以随时切回。`,
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateStorageSettings({
        backend,
        downloadMode,
        ...(backend === "oss"
          ? {
              oss: {
                region: region.trim(),
                bucket: bucket.trim(),
                endpoint: endpoint.trim(),
                internal,
                accessKeyId: accessKeyId.trim(),
                accessKeySecret: accessKeySecret.trim() || undefined,
              },
            }
          : {}),
      });
      setSettings(result.storage);
      setAccessKeySecret("");
      setMessage("存储设置已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存存储设置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace admin-workspace storage-backend-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>存储后端</h1>
          <p className="muted">
            选择上传文件保存在服务器本地存储还是阿里云对象存储。
          </p>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      {loading || !settings ? (
        <SkeletonRows count={4} />
      ) : (
        <div className="storage-backend-sections">
          <section className="storage-backend-section" aria-label="当前状态">
            <div className="panel-head">
              <div>
                <h2>当前状态</h2>
              </div>
            </div>
            <dl className="storage-backend-status">
              <div>
                <dt>当前后端</dt>
                <dd>
                  {settings.backend === "oss" ? "阿里云 OSS" : "服务器存储"}
                </dd>
              </div>
              <div>
                <dt>健康状态</dt>
                <dd
                  className={
                    settings.activeBackendHealthy
                      ? "storage-backend-ok"
                      : "storage-backend-down"
                  }
                >
                  {settings.activeBackendHealthy ? "正常" : "不可用"}
                </dd>
              </div>
              <div>
                <dt>下载方式</dt>
                <dd>
                  {settings.backend === "oss" &&
                  settings.downloadMode === "direct"
                    ? "签名直出"
                    : "服务器中转"}
                </dd>
              </div>
              <div>
                <dt>服务器存储</dt>
                <dd>
                  {settings.minio.endpoint} / {settings.minio.bucket}
                </dd>
              </div>
              <div className="storage-backend-distribution">
                <dt>文件分布</dt>
                <dd>
                  <span className="storage-backend-dist-item">
                    <HardDrive aria-hidden="true" />
                    服务器{" "}
                    <strong>{settings.fileDistribution.minio.count} 个</strong>
                    <small>
                      {formatFileSize(settings.fileDistribution.minio.bytes)}
                    </small>
                  </span>
                  <span className="storage-backend-dist-item">
                    <Cloud aria-hidden="true" />
                    阿里云 OSS{" "}
                    <strong>{settings.fileDistribution.oss.count} 个</strong>
                    <small>
                      {formatFileSize(settings.fileDistribution.oss.bytes)}
                    </small>
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <form onSubmit={(event) => void onSave(event)}>
            <section className="storage-backend-section">
              <div className="panel-head">
                <div>
                  <h2>存储后端</h2>
                  <p>
                    切换只影响新上传的文件；已有文件仍从原存储读取，删除和下载不受影响。
                  </p>
                </div>
              </div>
              <div className="storage-backend-choices">
                <label
                  className={`storage-backend-choice${
                    backend === "minio" ? " active" : ""
                  }`}
                >
                  <input
                    checked={backend === "minio"}
                    name="storage-backend"
                    onChange={() => setBackend("minio")}
                    type="radio"
                  />
                  <HardDrive aria-hidden="true" />
                  <span>
                    <strong>服务器存储</strong>
                    <small>
                      文件保存在本机 MinIO（{settings.minio.endpoint}
                      ），离线环境可用，无需额外配置。
                    </small>
                  </span>
                </label>
                <label
                  className={`storage-backend-choice${
                    backend === "oss" ? " active" : ""
                  }`}
                >
                  <input
                    checked={backend === "oss"}
                    name="storage-backend"
                    onChange={() => setBackend("oss")}
                    type="radio"
                  />
                  <Cloud aria-hidden="true" />
                  <span>
                    <strong>阿里云 OSS</strong>
                    <small>
                      文件保存在阿里云对象存储，减轻服务器磁盘与带宽压力，需要公网访问。
                    </small>
                  </span>
                </label>
              </div>
            </section>

            {backend === "oss" ? (
              <section className="storage-backend-section">
                <div className="panel-head">
                  <div>
                    <h2>阿里云 OSS 配置</h2>
                    <p>
                      Bucket
                      需提前在阿里云控制台创建并保持私有；保存时会执行真实读写探测，失败不会保存。
                    </p>
                  </div>
                </div>
                <details className="storage-backend-guide">
                  <summary>第一次用 OSS？查看完整开通教程</summary>
                  <div className="storage-backend-guide-body">
                    <h3>第 1 步：创建 Bucket</h3>
                    <ol>
                      <li>
                        登录阿里云，打开{" "}
                        <a
                          href="https://oss.console.aliyun.com"
                          rel="noreferrer"
                          target="_blank"
                        >
                          OSS 控制台
                        </a>
                        ，首次使用按页面提示开通对象存储服务。
                      </li>
                      <li>
                        点击「创建 Bucket」：名称全局唯一（例如
                        my-school-liveboard）；地域选离用户最近的，如果服务器是阿里云
                        ECS，务必选与 ECS
                        相同的地域，同地域才能使用免费内网流量。
                      </li>
                      <li>
                        存储类型选「标准存储」，读写权限必须选「私有」，其余保持默认，完成创建。
                      </li>
                    </ol>
                    <h3>第 2 步：创建专用 AccessKey（不要用主账号）</h3>
                    <ol>
                      <li>
                        打开{" "}
                        <a
                          href="https://ram.console.aliyun.com/users"
                          rel="noreferrer"
                          target="_blank"
                        >
                          RAM 控制台的用户列表
                        </a>
                        ，「创建用户」，访问方式只勾选「使用永久 AccessKey
                        访问」（OpenAPI 调用），不需要控制台登录。
                      </li>
                      <li>
                        创建成功后立即保存 AccessKey ID 和 AccessKey
                        Secret，Secret 只显示这一次。
                      </li>
                      <li>
                        在 RAM 控制台左侧菜单进入「权限管理 →
                        权限策略」，点「创建权限策略」，编辑器上方切到「脚本编辑」标签，粘贴下面的
                        JSON（已按你填写的 Bucket 名称生成），策略名例如
                        liveboard-oss-readwrite，保存策略：
                      </li>
                    </ol>
                    <pre>
                      <code>{`{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:DeleteObject",
        "oss:AbortMultipartUpload",
        "oss:ListParts"
      ],
      "Resource": ["acs:oss:*:*:${bucket.trim() || "<你的Bucket名>"}/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:GetBucketInfo", "oss:GetBucketLocation"],
      "Resource": ["acs:oss:*:*:${bucket.trim() || "<你的Bucket名>"}"]
    }
  ]
}`}</code>
                    </pre>
                    <ol start={4}>
                      <li>
                        回到「用户」列表打开刚创建的用户，进入「权限管理 →
                        新增授权」，在「自定义权限策略」标签下搜索刚保存的策略名，勾选后确认，授权完成。
                      </li>
                    </ol>
                    <h3>第 3 步：回本页填写并测试</h3>
                    <ol>
                      <li>
                        「地域」填 Bucket 概览页里访问域名（Endpoint）中的地域
                        ID：例如域名是 oss-cn-hangzhou.aliyuncs.com，地域就填
                        cn-hangzhou。
                      </li>
                      <li>
                        使用「服务器中转」且 ECS 与 Bucket
                        同地域时，可以勾选「使用内网 Endpoint」，服务器访问 OSS
                        不产生公网流量费；自定义 Endpoint 一般留空即可。
                      </li>
                      <li>
                        填完后先点「测试连接」，通过后再保存；保存时系统还会再做一次真实读写探测。
                      </li>
                    </ol>
                  </div>
                </details>
                <div className="storage-backend-form">
                  <label className="label">
                    地域
                    <input
                      className="input"
                      onChange={(event) => setRegion(event.target.value)}
                      placeholder="例如 cn-hangzhou"
                      value={region}
                    />
                  </label>
                  <label className="label">
                    Bucket 名称
                    <input
                      className="input"
                      onChange={(event) => setBucket(event.target.value)}
                      placeholder="在 OSS 控制台创建的 Bucket"
                      value={bucket}
                    />
                  </label>
                  <label className="label">
                    自定义 Endpoint（可选）
                    <input
                      className="input"
                      onChange={(event) => setEndpoint(event.target.value)}
                      placeholder={`留空使用 s3.oss-${region.trim() || "<地域>"}${
                        internal ? "-internal" : ""
                      }.aliyuncs.com`}
                      value={endpoint}
                    />
                  </label>
                  <label className="storage-backend-inline-check">
                    <input
                      aria-describedby="storage-internal-endpoint-hint"
                      checked={internal}
                      disabled={downloadMode === "direct"}
                      onChange={(event) => setInternal(event.target.checked)}
                      type="checkbox"
                    />
                    服务器与 OSS 同地域，使用内网 Endpoint（免流量费）
                  </label>
                  <small
                    className="field-hint storage-backend-inline-hint"
                    id="storage-internal-endpoint-hint"
                  >
                    {downloadMode === "direct"
                      ? "签名直出需要浏览器访问公网 Endpoint，不能使用内网 Endpoint。"
                      : "服务器通过内网访问 OSS，不产生 OSS 公网流量费；用户下载仍会占用服务器公网带宽。"}
                  </small>
                  <label className="label">
                    AccessKey ID
                    <input
                      autoComplete="off"
                      className="input"
                      onChange={(event) => setAccessKeyId(event.target.value)}
                      placeholder="仅拥有该 Bucket 读写权限的 RAM 用户"
                      value={accessKeyId}
                    />
                  </label>
                  <label className="label">
                    AccessKey Secret
                    <input
                      autoComplete="new-password"
                      className="input"
                      onChange={(event) =>
                        setAccessKeySecret(event.target.value)
                      }
                      placeholder={
                        settings.oss.secretConfigured
                          ? "已保存，留空保持不变"
                          : "加密保存，保存后不再显示"
                      }
                      type="password"
                      value={accessKeySecret}
                    />
                  </label>
                </div>
                <div className="storage-backend-test-row">
                  <button
                    className="button secondary"
                    disabled={testing}
                    onClick={() => void onTestConnection()}
                    type="button"
                  >
                    <PlugZap aria-hidden="true" className="button-icon" />
                    {testing ? "正在测试…" : "测试连接"}
                  </button>
                </div>
              </section>
            ) : null}

            {backend === "oss" ? (
              <section className="storage-backend-section">
                <div className="panel-head">
                  <div>
                    <h2>下载方式</h2>
                    <p>
                      签名直出让浏览器直接从对象存储下载，节省服务器带宽；签名地址
                      10 分钟内有效，仅对 OSS 中的文件生效，必须使用公网
                      Endpoint。
                    </p>
                  </div>
                </div>
                <div className="segmented-control storage-download-mode">
                  <button
                    className={downloadMode === "proxy" ? "active" : ""}
                    onClick={() => setDownloadMode("proxy")}
                    type="button"
                  >
                    服务器中转
                  </button>
                  <button
                    className={downloadMode === "direct" ? "active" : ""}
                    disabled={internal}
                    onClick={() => setDownloadMode("direct")}
                    type="button"
                  >
                    签名直出
                  </button>
                </div>
              </section>
            ) : null}

            <div className="storage-backend-actions">
              <button className="button" disabled={saving}>
                {saving ? "保存中" : "保存存储设置"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
