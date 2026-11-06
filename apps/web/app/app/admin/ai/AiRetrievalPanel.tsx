"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Database, Pencil, RefreshCw, X } from "lucide-react";
import type { AiRetrievalSettingsSummary } from "@liveboard/shared";
import {
  getAiRetrievalSettings,
  updateAiRetrievalSettings,
  syncAiRetrieval,
} from "@/lib/api";
import {
  FeedbackNotice,
  useFeedbackNotice,
} from "@/components/system/FeedbackNotice";
import { SkeletonRows } from "@/components/system/ProgressiveLoading";

const providers = [
  { name: "OpenAI", url: "https://api.openai.com/v1" },
  { name: "硅基流动", url: "https://api.siliconflow.cn/v1" },
  { name: "其他兼容服务", url: "" },
] as const;

export function AiRetrievalPanel() {
  const [settings, setSettings] = useState<AiRetrievalSettingsSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useFeedbackNotice();
  const [message, setMessage] = useFeedbackNotice();
  const [form, setForm] = useState<{
    enabled: boolean;
    providerName: string;
    baseUrl: string;
    model: string;
    apiKey: string;
  }>({
    enabled: false,
    providerName: "OpenAI",
    baseUrl: providers[0].url,
    model: "",
    apiKey: "",
  });

  useEffect(() => {
    let cancelled = false;
    getAiRetrievalSettings()
      .then(({ retrieval }) => {
        if (cancelled) return;
        setSettings(retrieval);
        setSyncing(retrieval.indexing);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "加载语义检索设置失败",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  useEffect(() => {
    if (!syncing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { retrieval } = await getAiRetrievalSettings();
        if (cancelled) return;
        setSettings(retrieval);
        if (
          !retrieval.enabled ||
          (!retrieval.indexing && retrieval.pendingDocuments === 0)
        ) {
          setSyncing(false);
          return;
        }
        if (!retrieval.indexing) await syncAiRetrieval();
        if (!cancelled) timer = setTimeout(poll, 3000);
      } catch (error) {
        if (!cancelled) {
          setSyncing(false);
          setError(error instanceof Error ? error.message : "读取索引进度失败");
        }
      }
    }
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [syncing, setError]);

  function edit() {
    const provider = providers.find(
      (provider) => provider.url === settings?.baseUrl && provider.url,
    );
    setForm({
      enabled: settings?.enabled ?? false,
      providerName:
        provider?.name ?? (settings?.baseUrl ? "其他兼容服务" : "OpenAI"),
      baseUrl: settings?.baseUrl || providers[0].url,
      model: settings?.model ?? "",
      apiKey: "",
    });
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { retrieval } = await updateAiRetrievalSettings(form);
      setSettings(retrieval);
      setForm((value) => ({ ...value, apiKey: "" }));
      setEditing(false);
      setSyncing(retrieval.enabled);
      setMessage(
        retrieval.enabled
          ? "语义检索已保存，正在同步文档索引"
          : "已关闭语义检索，继续使用关键词检索",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存语义检索设置失败");
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    try {
      setError(null);
      await syncAiRetrieval(true);
      setSyncing(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "启动索引同步失败");
    }
  }

  return (
    <section className="ai-panel" aria-labelledby="ai-retrieval-title">
      <FeedbackNotice notice={error} tone="error" />
      <FeedbackNotice notice={message} tone="success" />
      <div className="panel-head">
        <div>
          <h2 id="ai-retrieval-title">资料检索</h2>
          <p>结合关键词和语义查找在线文档中的相关段落。</p>
        </div>
      </div>
      {loading ? (
        <SkeletonRows compact count={2} />
      ) : (
        <div className="ai-setting-list">
          <div className="ai-setting-row">
            <div className="ai-setting-copy">
              <div className="ai-setting-title">
                <Database aria-hidden="true" />
                <strong>语义检索</strong>
              </div>
              <p>
                {settings?.enabled
                  ? settings.model + " · " + settings.dimensions + " 维"
                  : "尚未开启，当前使用关键词检索"}
              </p>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={edit}
              disabled={!settings}
            >
              <Pencil aria-hidden="true" />
              配置向量模型
            </button>
          </div>
          {settings?.enabled && (
            <div className="ai-setting-row">
              <div className="ai-setting-copy">
                <div className="ai-setting-title">
                  <RefreshCw aria-hidden="true" />
                  <strong>文档索引</strong>
                </div>
                <p aria-live="polite">
                  已完成 {settings.indexedDocuments} / {settings.totalDocuments}{" "}
                  篇 · {settings.indexedChunks} 个片段
                  {settings.pendingDocuments > 0
                    ? " · 待处理 " + settings.pendingDocuments + " 篇"
                    : ""}
                  {settings.failedDocuments > 0
                    ? " · 失败 " + settings.failedDocuments + " 篇"
                    : ""}
                </p>
                {settings.failedDocuments > 0 && (
                  <p>
                    {settings.lastError || "部分文档索引失败"}，可重新同步。
                  </p>
                )}
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={sync}
                disabled={syncing}
              >
                {syncing
                  ? "同步中…"
                  : settings.failedDocuments > 0
                    ? "重试并同步"
                    : "同步索引"}
              </button>
            </div>
          )}
        </div>
      )}
      {editing && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-panel ai-config-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-embedding-title"
            onSubmit={save}
          >
            <div className="modal-head">
              <div>
                <h2 id="ai-embedding-title">配置向量模型</h2>
                <p>向量模型负责检索资料，回答继续使用当前聊天模型。</p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭向量模型设置"
                type="button"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body ai-config-fields">
              <label className="ai-compact-switch">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                开启语义检索
              </label>
              <div className="ai-provider-grid">
                <label className="label">
                  向量服务商
                  <select
                    className="select"
                    value={form.providerName}
                    onChange={(event) => {
                      const provider = providers.find(
                        (provider) => provider.name === event.target.value,
                      )!;
                      setForm({
                        ...form,
                        providerName: provider.name,
                        baseUrl: provider.url,
                        apiKey: "",
                      });
                    }}
                  >
                    {providers.map((provider) => (
                      <option key={provider.name}>{provider.name}</option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  Embedding 模型 ID
                  <input
                    className="input"
                    value={form.model}
                    required={form.enabled}
                    maxLength={200}
                    placeholder="填写服务商提供的向量模型 ID"
                    onChange={(event) =>
                      setForm({ ...form, model: event.target.value })
                    }
                  />
                </label>
              </div>
              {form.providerName === "其他兼容服务" ? (
                <label className="label">
                  API 地址
                  <input
                    className="input"
                    type="url"
                    required={form.enabled}
                    value={form.baseUrl}
                    maxLength={2000}
                    placeholder="https://example.com/v1"
                    onChange={(event) =>
                      setForm({ ...form, baseUrl: event.target.value })
                    }
                  />
                </label>
              ) : (
                <div className="ai-managed-endpoint">
                  <span>API 地址</span>
                  <code>{form.baseUrl}</code>
                </div>
              )}
              <label className="label">
                API Key
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={form.apiKey}
                  maxLength={4096}
                  required={
                    form.enabled &&
                    (!settings?.apiKeyConfigured ||
                      form.baseUrl !== settings.baseUrl)
                  }
                  placeholder={
                    settings?.apiKeyConfigured &&
                    form.baseUrl === settings.baseUrl
                      ? "留空保留已保存的密钥"
                      : "输入向量服务 API Key"
                  }
                  onChange={(event) =>
                    setForm({ ...form, apiKey: event.target.value })
                  }
                />
              </label>
              <p className="field-hint">
                开启后会将在线文档内容发送至所选向量服务建立索引。更换模型会重建索引；PDF、Word
                等上传附件暂不参与检索。
              </p>
            </div>
            <div className="modal-foot">
              <button className="button" type="submit" disabled={saving}>
                {saving
                  ? "验证并保存中…"
                  : form.enabled
                    ? "验证并保存"
                    : "保存设置"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
