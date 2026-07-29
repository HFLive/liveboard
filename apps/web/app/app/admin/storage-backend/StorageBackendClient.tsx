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
type UploadModeChoice = "relay" | "direct";

export function StorageBackendClient() {
  useDocumentTitle("存储后端");

  const [settings, setSettings] = useState<StorageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<BackendChoice>("minio");
  const [downloadMode, setDownloadMode] = useState<DownloadModeChoice>("proxy");
  const [uploadMode, setUploadMode] = useState<UploadModeChoice>("relay");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [internal, setInternal] = useState(false);
  const [internalEndpoint, setInternalEndpoint] = useState("");
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
        setUploadMode(result.storage.uploadMode);
        setRegion(result.storage.oss.region ?? "");
        setBucket(result.storage.oss.bucket ?? "");
        setEndpoint(result.storage.oss.endpoint ?? "");
        setInternal(result.storage.oss.internal);
        setInternalEndpoint(result.storage.oss.internalEndpoint ?? "");
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
        uploadMode,
        ...(backend === "oss"
          ? {
              oss: {
                region: region.trim(),
                bucket: bucket.trim(),
                endpoint: endpoint.trim(),
                internal,
                internalEndpoint: internalEndpoint.trim(),
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
                <dt>上传方式</dt>
                <dd>
                  {settings.backend === "oss" &&
                  settings.uploadMode === "direct"
                    ? "签名直入"
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
                  <h2>OSS 设置</h2>
                  <p>
                    选择文件保存在本机存储还是阿里云 OSS，并填写 OSS
                    连接参数。Bucket
                    需提前在阿里云控制台创建并保持私有；保存时会执行真实读写探测，失败不会保存。
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
              {backend === "oss" ? (
                <>
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
                          ECS 与 Bucket 同地域时，建议在下方启用「内网
                          Endpoint」，服务器与 OSS
                          之间的读写不产生公网流量费；自定义 Endpoint
                          一般留空即可。
                        </li>
                        <li>
                          填完后先点「测试连接」，通过后再保存；保存时系统还会再做一次真实读写探测。
                        </li>
                      </ol>
                      <h3>第 4 步：配置跨域 CORS（仅「签名直入」需要）</h3>
                      <ol>
                        <li>
                          在 Bucket 详情页左侧菜单进入「数据安全 →
                          跨域设置」，点「创建规则」。
                        </li>
                        <li>
                          「来源」填本站完整地址（例如
                          https://liveboard.example.com，不带结尾斜杠）；「允许
                          Methods」勾选 POST；「允许 Headers」填 *；「暴露
                          Headers」填 ETag；其余默认，保存规则。
                        </li>
                        <li>
                          不配置跨域也不影响使用：签名直入上传失败时会自动回退服务器中转，只是仍然占用服务器带宽。
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
                        placeholder={`留空使用 s3.oss-${
                          region.trim() || "<地域>"
                        }.aliyuncs.com`}
                        value={endpoint}
                      />
                    </label>
                    <div className="storage-backend-internal-group">
                      <label className="storage-backend-inline-check">
                        <input
                          aria-describedby="storage-internal-endpoint-hint"
                          checked={internal}
                          onChange={(event) =>
                            setInternal(event.target.checked)
                          }
                          type="checkbox"
                        />
                        启用内网 Endpoint（服务器与 OSS 同地域时免流量费）
                      </label>
                      {internal ? (
                        <label className="label">
                          自定义内网 Endpoint（可选）
                          <input
                            className="input"
                            onChange={(event) =>
                              setInternalEndpoint(event.target.value)
                            }
                            placeholder={`留空使用 s3.oss-${
                              region.trim() || "<地域>"
                            }-internal.aliyuncs.com`}
                            value={internalEndpoint}
                          />
                        </label>
                      ) : null}
                      <small
                        className="field-hint storage-backend-inline-hint"
                        id="storage-internal-endpoint-hint"
                      >
                        服务器与 OSS
                        之间的读写（中转上传/下载、文件预览、直入确认与清理）都走内网；签名直出与签名直入的地址仍走公网
                        Endpoint，浏览器才能访问。
                      </small>
                    </div>
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
                </>
              ) : null}
            </section>

            <section className="storage-backend-section">
              <div className="panel-head">
                <div>
                  <h2>上传设置</h2>
                  <p>
                    服务器中转由服务器接力上传（浏览器 → 服务器 →
                    存储），稳定但占用服务器带宽；签名直入让浏览器直传
                    OSS，不占服务器带宽，需要 Bucket
                    配置跨域（CORS），直传失败会自动回退中转。
                  </p>
                </div>
              </div>
              {backend === "oss" ? (
                <div>
                  <div className="segmented-control storage-download-mode">
                    <button
                      className={uploadMode === "relay" ? "active" : ""}
                      onClick={() => setUploadMode("relay")}
                      type="button"
                    >
                      服务器中转
                    </button>
                    <button
                      className={uploadMode === "direct" ? "active" : ""}
                      onClick={() => setUploadMode("direct")}
                      type="button"
                    >
                      签名直入
                    </button>
                  </div>
                  {uploadMode === "direct" ? (
                    <small className="field-hint storage-backend-inline-hint">
                      需要在 OSS 控制台为 Bucket
                      配置跨域规则：来源填本站地址，允许 Methods 勾选 POST，允许
                      Headers 填
                      *；未配置时上传会自动回退服务器中转。配置步骤见上方 OSS
                      教程第 4 步。
                    </small>
                  ) : null}
                </div>
              ) : (
                <p className="field-hint">
                  当前使用服务器存储，文件直接写入本机 MinIO，没有额外选项。
                </p>
              )}
            </section>

            <section className="storage-backend-section">
              <div className="panel-head">
                <div>
                  <h2>下载设置</h2>
                  <p>
                    签名直出让浏览器直接从对象存储下载，不占服务器带宽；签名地址
                    10 分钟内有效，仅对 OSS
                    中的文件生效，服务器存储的文件始终由服务器中转。
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
                  onClick={() => setDownloadMode("direct")}
                  type="button"
                >
                  签名直出
                </button>
              </div>
            </section>

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
