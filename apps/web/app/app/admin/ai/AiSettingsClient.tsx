"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, Save } from "lucide-react";
import { getAiSettings, updateAiSettings, type AiSettings } from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { AdminSubnav } from "@/components/admin/AdminSubnav";

export function AiSettingsClient() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    providerName: "OpenAI Compatible",
    baseUrl: "",
    model: "",
    apiKey: "",
    temperature: "0.2",
    maxContextFiles: "6",
    maxContextChars: "12000",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAiSettings()
      .then((result) => {
        setSettings(result.settings);
        setForm({
          enabled: result.settings.enabled,
          providerName: result.settings.providerName,
          baseUrl: result.settings.baseUrl,
          model: result.settings.model,
          apiKey: "",
          temperature: result.settings.temperature.toString(),
          maxContextFiles: result.settings.maxContextFiles.toString(),
          maxContextChars: result.settings.maxContextChars.toString(),
        });
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "加载 AI 设置失败");
      });
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const temperature = Number(form.temperature);
    const maxContextFiles = Number(form.maxContextFiles);
    const maxContextChars = Number(form.maxContextChars);

    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      setError("温度需要在 0 到 2 之间");
      return;
    }

    if (!Number.isInteger(maxContextFiles) || maxContextFiles < 1) {
      setError("最大参考文件数至少为 1");
      return;
    }

    if (!Number.isInteger(maxContextChars) || maxContextChars < 1000) {
      setError("上下文长度至少为 1000 字符");
      return;
    }

    setSaving(true);

    try {
      const result = await updateAiSettings({
        enabled: form.enabled,
        providerName: form.providerName,
        baseUrl: form.baseUrl,
        model: form.model,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        temperature,
        maxContextFiles,
        maxContextChars,
      });
      setSettings(result.settings);
      setForm((current) => ({ ...current, apiKey: "" }));
      setMessage("AI 设置已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存 AI 设置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>AI 设置</h1>
          <p className="muted">配置模型服务、访问凭证与回答上下文范围。</p>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="workbench ai-settings-layout">
        <form
          className="workbench-main form ai-settings-form"
          onSubmit={onSubmit}
        >
          <div className="panel-head">
            <div>
              <h2>
                <Bot aria-hidden="true" className="heading-icon" />
                模型服务
              </h2>
              <p className="muted">
                支持 OpenAI Chat Completions 兼容接口。DeepSeek 可填写
                <code>https://api.deepseek.com</code>。
              </p>
            </div>
          </div>

          <label className="switch-row">
            <input
              checked={form.enabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>
              <strong>启用 AI 助手</strong>
              <small>启用后，用户可以在 AI 页面发起资料问答。</small>
            </span>
          </label>

          <div className="form-grid admin-ai-grid">
            <label className="label">
              服务名称
              <input
                className="input"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    providerName: event.target.value,
                  }))
                }
                value={form.providerName}
              />
            </label>
            <label className="label">
              模型
              <input
                className="input"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
                placeholder="例如 deepseek-v4-flash / deepseek-v4-pro / qwen-plus"
                value={form.model}
              />
            </label>
          </div>

          <label className="label">
            API 地址
            <input
              className="input"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
              }
              placeholder="https://api.deepseek.com"
              value={form.baseUrl}
            />
          </label>

          <label className="label">
            API Key
            <input
              className="input"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              placeholder={
                settings?.apiKeyConfigured
                  ? `已配置：${settings.apiKeyPreview}，留空则不修改`
                  : "请输入 API Key"
              }
              type="password"
              value={form.apiKey}
            />
          </label>

          <div className="form-grid admin-ai-grid three">
            <label className="label">
              温度
              <input
                className="input"
                max={2}
                min={0}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    temperature: event.target.value,
                  }))
                }
                step={0.1}
                type="number"
                value={form.temperature}
              />
            </label>
            <label className="label">
              最大参考文件数
              <input
                className="input"
                min={1}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    maxContextFiles: event.target.value,
                  }))
                }
                type="number"
                value={form.maxContextFiles}
              />
            </label>
            <label className="label">
              上下文字符
              <input
                className="input"
                min={1000}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    maxContextChars: event.target.value,
                  }))
                }
                step={1000}
                type="number"
                value={form.maxContextChars}
              />
            </label>
          </div>

          <div className="form-actions">
            <button className="button" disabled={saving} type="submit">
              <Save aria-hidden="true" className="button-icon" />
              {saving ? "保存中" : "保存设置"}
            </button>
          </div>
        </form>

        <aside className="workbench-side sticky-panel">
          <section className="action-panel">
            <h2>当前状态</h2>
            <div className="status-list">
              <span>
                <small>状态</small>
                <strong>{settings?.enabled ? "已启用" : "未启用"}</strong>
              </span>
              <span>
                <small>服务</small>
                <strong>{settings?.providerName || "-"}</strong>
              </span>
              <span>
                <small>Key</small>
                <strong>
                  {settings?.apiKeyConfigured
                    ? settings.apiKeyPreview
                    : "未配置"}
                </strong>
              </span>
              <span>
                <small>更新时间</small>
                <strong>
                  {settings ? formatDateTime(settings.updatedAt) : "-"}
                </strong>
              </span>
            </div>
          </section>

          <section className="action-panel">
            <h2>回答范围</h2>
            <p className="muted">
              AI
              只会检索提问用户有权限访问的文件内容。没有权限的草稿、文件夹和文件不会进入上下文。
            </p>
          </section>
        </aside>
      </section>
    </div>
  );
}
