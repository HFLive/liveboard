"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  Pencil,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  activateAiProviderConfig,
  createAiProviderConfig,
  deleteAiProviderConfig,
  getAiSettings,
  updateAiProviderConfig,
  updateAiSettings,
  type AiProviderConfig,
  type AiSettings,
} from "@/lib/api";
import { formatDateTime } from "@/lib/labels";
import { AdminSubnav } from "@/components/admin/AdminSubnav";

const providerOptions = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    description: "DeepSeek 开放平台",
    modelPlaceholder: "例如 deepseek-chat",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    description: "智谱大模型开放平台",
    modelPlaceholder: "填写控制台中的模型 ID",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    description: "OpenAI API",
    modelPlaceholder: "填写账户可用的模型 ID",
  },
  {
    id: "moonshot",
    label: "月之暗面 Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    description: "Moonshot AI 开放平台",
    modelPlaceholder: "填写控制台中的模型 ID",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    description: "SiliconFlow 模型服务",
    modelPlaceholder: "填写控制台中的模型 ID",
  },
] as const;

type ProviderId = (typeof providerOptions)[number]["id"] | "custom";

interface GlobalSettingsForm {
  enabled: boolean;
  maxContextFiles: string;
  maxContextChars: string;
  defaultCallLimit: string;
}

interface ProviderConfigForm {
  id: string | null;
  name: string;
  providerId: ProviderId;
  customBaseUrl: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
}

const emptyConfigForm: ProviderConfigForm = {
  id: null,
  name: "",
  providerId: "deepseek",
  customBaseUrl: "",
  model: "",
  apiKey: "",
  apiKeyConfigured: false,
  apiKeyPreview: "",
};

function normalizeProviderUrl(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function getProviderId(baseUrl: string): ProviderId {
  const normalized = normalizeProviderUrl(baseUrl);
  return (
    providerOptions.find(
      (provider) => normalizeProviderUrl(provider.baseUrl) === normalized,
    )?.id ?? "custom"
  );
}

function toConfigForm(config: AiProviderConfig): ProviderConfigForm {
  const providerId = getProviderId(config.baseUrl);
  return {
    id: config.id,
    name: config.name,
    providerId,
    customBaseUrl: providerId === "custom" ? config.baseUrl : "",
    model: config.model,
    apiKey: "",
    apiKeyConfigured: config.apiKeyConfigured,
    apiKeyPreview: config.apiKeyPreview,
  };
}

export function AiSettingsClient() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [globalForm, setGlobalForm] = useState<GlobalSettingsForm>({
    enabled: false,
    maxContextFiles: "6",
    maxContextChars: "12000",
    defaultCallLimit: "0",
  });
  const [configForm, setConfigForm] =
    useState<ProviderConfigForm>(emptyConfigForm);
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activating, setActivating] = useState(false);
  const selectedProvider = useMemo(
    () =>
      providerOptions.find((provider) => provider.id === configForm.providerId),
    [configForm.providerId],
  );
  const isActiveConfig = Boolean(
    configForm.id && configForm.id === settings?.activeConfigId,
  );

  function applySettings(result: AiSettings, selectedConfigId?: string | null) {
    setSettings(result);
    setGlobalForm({
      enabled: result.enabled,
      maxContextFiles: result.maxContextFiles.toString(),
      maxContextChars: result.maxContextChars.toString(),
      defaultCallLimit: result.defaultCallLimit.toString(),
    });

    const nextConfig =
      result.configs.find((config) => config.id === selectedConfigId) ??
      result.activeConfig ??
      result.configs[0];
    setConfigForm(nextConfig ? toConfigForm(nextConfig) : emptyConfigForm);
  }

  async function refreshSettings(selectedConfigId?: string | null) {
    const result = await getAiSettings();
    applySettings(result.settings, selectedConfigId);
    return result.settings;
  }

  useEffect(() => {
    refreshSettings().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "加载 AI 设置失败");
    });
  }, []);

  function openConfigEditor(config: AiProviderConfig) {
    setError(null);
    setMessage(null);
    setConfigForm(toConfigForm(config));
    setConfigModalOpen(true);
  }

  function startNewConfig() {
    setError(null);
    setMessage(null);
    setConfigForm({ ...emptyConfigForm });
    setConfigModalOpen(true);
  }

  function updateConfigForm(patch: Partial<ProviderConfigForm>) {
    setConfigForm((current) => ({ ...current, ...patch }));
  }

  async function onToggleAssistant(enabled: boolean) {
    setError(null);
    setMessage(null);

    if (enabled && !settings?.activeConfigId) {
      setError("请先添加并选择一个当前配置，再启用 AI 助手");
      return;
    }

    setSavingGlobal(true);
    try {
      const result = await updateAiSettings({
        enabled,
        maxContextFiles: Number(globalForm.maxContextFiles),
        maxContextChars: Number(globalForm.maxContextChars),
      });
      applySettings(result.settings, configForm.id);
      setMessage(enabled ? "AI 助手已启用" : "AI 助手已停用");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新 AI 助手失败");
    } finally {
      setSavingGlobal(false);
    }
  }

  async function onSaveCallLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const defaultCallLimit = Number(globalForm.defaultCallLimit);

    if (!Number.isInteger(defaultCallLimit) || defaultCallLimit < 0) {
      setError("默认调用限额需为不小于 0 的整数");
      return;
    }

    setSavingGlobal(true);
    try {
      const result = await updateAiSettings({ defaultCallLimit });
      applySettings(result.settings, configForm.id);
      setMessage("默认调用限额已保存");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "保存默认调用限额失败",
      );
    } finally {
      setSavingGlobal(false);
    }
  }

  async function onSaveGlobal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const maxContextFiles = Number(globalForm.maxContextFiles);
    const maxContextChars = Number(globalForm.maxContextChars);

    if (globalForm.enabled && !settings?.activeConfigId) {
      setError("请先保存并选择一个当前配置，再启用 AI 助手");
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

    setSavingGlobal(true);
    try {
      const result = await updateAiSettings({
        enabled: globalForm.enabled,
        maxContextFiles,
        maxContextChars,
      });
      applySettings(result.settings, configForm.id);
      setMessage("助手设置已保存");
      setContextModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存助手设置失败");
    } finally {
      setSavingGlobal(false);
    }
  }

  async function onSaveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const baseUrl =
      selectedProvider?.baseUrl ?? configForm.customBaseUrl.trim();
    const providerName = selectedProvider?.label ?? "其他兼容服务";

    if (!configForm.name.trim()) {
      setError("请输入配置名称");
      return;
    }

    if (!baseUrl) {
      setError("请输入其他兼容服务的 API 地址");
      return;
    }

    if (!configForm.model.trim()) {
      setError("请输入服务商提供的模型 ID");
      return;
    }

    if (!configForm.apiKeyConfigured && !configForm.apiKey.trim()) {
      setError("请输入 API Key");
      return;
    }

    setSavingConfig(true);
    try {
      let savedConfig: AiProviderConfig;
      if (configForm.id) {
        const result = await updateAiProviderConfig(configForm.id, {
          name: configForm.name.trim(),
          providerName,
          baseUrl,
          model: configForm.model.trim(),
          ...(configForm.apiKey.trim()
            ? { apiKey: configForm.apiKey.trim() }
            : {}),
        });
        savedConfig = result.config;
      } else {
        const result = await createAiProviderConfig({
          name: configForm.name.trim(),
          providerName,
          baseUrl,
          model: configForm.model.trim(),
          apiKey: configForm.apiKey.trim(),
        });
        savedConfig = result.config;
      }

      const wasFirstConfig = settings?.configs.length === 0;
      if (wasFirstConfig) {
        const result = await activateAiProviderConfig(savedConfig.id);
        applySettings(result.settings, savedConfig.id);
        setMessage("配置已保存并设为当前配置");
      } else {
        await refreshSettings(savedConfig.id);
        setMessage("配置已保存");
      }
      setConfigModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存配置失败");
    } finally {
      setSavingConfig(false);
    }
  }

  async function onActivateConfig(config: AiProviderConfig) {
    if (config.id === settings?.activeConfigId) {
      return;
    }

    setError(null);
    setMessage(null);
    setActivating(true);
    try {
      const result = await activateAiProviderConfig(config.id);
      applySettings(result.settings, config.id);
      setMessage(`已切换到“${config.name}”`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "切换配置失败");
    } finally {
      setActivating(false);
    }
  }

  async function onDeleteConfig() {
    if (!configForm.id || isActiveConfig) {
      return;
    }

    if (!window.confirm(`确定删除配置“${configForm.name}”吗？`)) {
      return;
    }

    setError(null);
    setMessage(null);
    try {
      await deleteAiProviderConfig(configForm.id);
      await refreshSettings();
      setMessage("配置已删除");
      setConfigModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除配置失败");
    }
  }

  return (
    <div className="workspace ai-settings-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">管理中心</p>
          <h1>AI 设置</h1>
          <p className="muted">管理模型配置与回答上下文范围。</p>
        </div>
      </header>

      <AdminSubnav />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="ai-settings-layout">
        <section className="ai-panel">
          <div className="panel-head">
            <div>
              <h2>
                <Bot aria-hidden="true" className="heading-icon" />
                AI 助手
                <span
                  className={
                    settings?.enabled
                      ? "ai-status-badge is-on"
                      : "ai-status-badge"
                  }
                >
                  {settings?.enabled ? "已启用" : "未启用"}
                </span>
              </h2>
            </div>
            <div className="ai-summary-actions">
              <button
                className="button secondary"
                onClick={() => setContextModalOpen(true)}
                type="button"
              >
                <Settings2 aria-hidden="true" className="button-icon" />
                回答范围
              </button>
              <label className="ai-compact-switch">
                <input
                  checked={globalForm.enabled}
                  disabled={savingGlobal}
                  onChange={(event) => onToggleAssistant(event.target.checked)}
                  type="checkbox"
                />
                <span>启用</span>
              </label>
            </div>
          </div>
          <p className="ai-assistant-current">
            {settings?.activeConfig
              ? `当前使用 ${settings.activeConfig.name} · ${settings.activeConfig.model || "未配置模型"}`
              : "选择一个模型配置后即可启用。"}
          </p>
          <form className="ai-call-limit-row" onSubmit={onSaveCallLimit}>
            <label className="label" htmlFor="ai-call-limit-input">
              默认调用限额
            </label>
            <input
              className="input"
              id="ai-call-limit-input"
              min={0}
              onChange={(event) =>
                setGlobalForm((current) => ({
                  ...current,
                  defaultCallLimit: event.target.value,
                }))
              }
              type="number"
              value={globalForm.defaultCallLimit}
            />
            <span className="muted">次/人</span>
            <button
              className="button secondary"
              disabled={savingGlobal}
              type="submit"
            >
              保存限额
            </button>
          </form>
          <p className="field-hint ai-call-limit-hint">
            每位成员的 AI 调用次数上限；在成员管理中编辑成员可设置例外。
          </p>
        </section>

        <section className="ai-panel">
          <div className="panel-head">
            <div>
              <h2>模型配置</h2>
            </div>
            <button className="button" onClick={startNewConfig} type="button">
              <Plus aria-hidden="true" className="button-icon" />
              添加配置
            </button>
          </div>

          <div className="ai-config-list">
            {settings?.configs.length ? (
              settings.configs.map((config) => {
                const active = config.id === settings.activeConfigId;
                return (
                  <article className="ai-config-row" key={config.id}>
                    <div className="ai-config-row-main">
                      <span
                        aria-hidden="true"
                        className={`ai-config-dot ${active ? "active" : ""}`}
                      />
                      <div>
                        <div className="ai-config-name">
                          <strong>{config.name}</strong>
                          {active ? <span>当前</span> : null}
                        </div>
                        <p>
                          {config.providerName} · {config.model || "未配置模型"}
                        </p>
                      </div>
                    </div>
                    <div className="ai-config-row-actions">
                      {!active ? (
                        <button
                          className="button secondary"
                          disabled={activating}
                          onClick={() => onActivateConfig(config)}
                          type="button"
                        >
                          {activating ? "切换中" : "设为当前"}
                        </button>
                      ) : null}
                      <button
                        aria-label={`编辑 ${config.name}`}
                        className="icon-button"
                        onClick={() => openConfigEditor(config)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="ai-config-empty">
                <p>还没有模型配置，添加后即可连接 AI 服务。</p>
                <button
                  className="button secondary"
                  onClick={startNewConfig}
                  type="button"
                >
                  添加第一个配置
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="ai-policy-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            AI 只检索提问用户有权限访问的文件；回答稳定性由系统统一设置为
            0.2。最近更新：{settings ? formatDateTime(settings.updatedAt) : "-"}
          </p>
        </div>
      </section>

      {contextModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-modal="true"
            aria-labelledby="ai-context-title"
            className="modal-panel ai-context-modal"
            onSubmit={onSaveGlobal}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <h2 id="ai-context-title">回答范围</h2>
                <p>控制每次问答最多读取的资料数量和文本长度。</p>
              </div>
              <button
                aria-label="关闭回答范围设置"
                className="icon-button"
                onClick={() => setContextModalOpen(false)}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="modal-body ai-context-fields">
              <label className="label">
                最大参考文件数
                <input
                  className="input"
                  max={20}
                  min={1}
                  onChange={(event) =>
                    setGlobalForm((current) => ({
                      ...current,
                      maxContextFiles: event.target.value,
                    }))
                  }
                  type="number"
                  value={globalForm.maxContextFiles}
                />
                <small className="field-hint">
                  单次问答最多引用 20 个文件。
                </small>
              </label>
              <label className="label">
                上下文字符上限
                <input
                  className="input"
                  max={40000}
                  min={1000}
                  onChange={(event) =>
                    setGlobalForm((current) => ({
                      ...current,
                      maxContextChars: event.target.value,
                    }))
                  }
                  step={1000}
                  type="number"
                  value={globalForm.maxContextChars}
                />
                <small className="field-hint">
                  较高的上限会增加模型调用成本。
                </small>
              </label>
            </div>
            <div className="modal-foot">
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setContextModalOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={savingGlobal}
                  type="submit"
                >
                  {savingGlobal ? "保存中" : "保存回答范围"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {configModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-modal="true"
            aria-labelledby="ai-config-title"
            className="modal-panel ai-config-modal"
            onSubmit={onSaveConfig}
            role="dialog"
          >
            <div className="modal-head ai-config-modal-head">
              <div>
                <div className="ai-config-modal-title">
                  <h2 id="ai-config-title">
                    {configForm.id ? "编辑模型配置" : "添加模型配置"}
                  </h2>
                  {isActiveConfig ? (
                    <span className="ai-active-badge">
                      <Check aria-hidden="true" />
                      当前配置
                    </span>
                  ) : null}
                </div>
                <p>保存连接信息；切换当前配置需要在配置列表中操作。</p>
              </div>
              <button
                aria-label="关闭模型配置"
                className="icon-button"
                onClick={() => setConfigModalOpen(false)}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="modal-body ai-config-fields">
              <label className="label">
                配置名称
                <input
                  className="input"
                  onChange={(event) =>
                    updateConfigForm({ name: event.target.value })
                  }
                  placeholder="例如 DeepSeek 主力配置"
                  required
                  value={configForm.name}
                />
              </label>

              <div className="ai-provider-grid">
                <label className="label">
                  AI 服务商
                  <select
                    className="select"
                    onChange={(event) =>
                      updateConfigForm({
                        providerId: event.target.value as ProviderId,
                      })
                    }
                    value={configForm.providerId}
                  >
                    {providerOptions.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                    <option value="custom">其他兼容服务</option>
                  </select>
                  <small className="field-hint">
                    {selectedProvider?.description ??
                      "支持 OpenAI Chat Completions 协议的服务"}
                  </small>
                </label>

                <label className="label">
                  模型 ID
                  <input
                    className="input"
                    onChange={(event) =>
                      updateConfigForm({ model: event.target.value })
                    }
                    placeholder={
                      selectedProvider?.modelPlaceholder ??
                      "填写服务商提供的模型 ID"
                    }
                    required
                    value={configForm.model}
                  />
                  <small className="field-hint">以服务商控制台显示为准。</small>
                </label>
              </div>

              {configForm.providerId === "custom" ? (
                <label className="label ai-custom-url-field">
                  API 地址
                  <input
                    className="input"
                    onChange={(event) =>
                      updateConfigForm({ customBaseUrl: event.target.value })
                    }
                    placeholder="https://example.com/v1"
                    required
                    type="url"
                    value={configForm.customBaseUrl}
                  />
                  <small className="field-hint">
                    填写基础地址，不包含 /chat/completions。
                  </small>
                </label>
              ) : (
                <div className="ai-managed-endpoint">
                  <span>API 地址由系统提供</span>
                  <code>{selectedProvider?.baseUrl}</code>
                </div>
              )}

              <label className="label">
                API Key
                <input
                  autoComplete="off"
                  className="input"
                  onChange={(event) =>
                    updateConfigForm({ apiKey: event.target.value })
                  }
                  placeholder={
                    configForm.apiKeyConfigured
                      ? `已配置：${configForm.apiKeyPreview}，留空则不修改`
                      : "请输入 API Key"
                  }
                  required={!configForm.apiKeyConfigured}
                  type="password"
                  value={configForm.apiKey}
                />
                <small className="field-hint">
                  密钥只保存在服务器中，页面不会显示完整内容。
                </small>
              </label>
            </div>

            <div className="modal-foot ai-config-modal-foot">
              <div>
                {configForm.id && !isActiveConfig ? (
                  <button
                    className="button danger"
                    onClick={onDeleteConfig}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" className="button-icon" />
                    删除配置
                  </button>
                ) : null}
              </div>
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setConfigModalOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={savingConfig}
                  type="submit"
                >
                  <Save aria-hidden="true" className="button-icon" />
                  {savingConfig ? "保存中" : "保存配置"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
