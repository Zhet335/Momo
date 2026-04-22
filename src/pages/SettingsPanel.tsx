import { useEffect, useMemo, useRef, useState } from "react";

type ApiProvider = "zhipu" | "openai" | "deepseek" | "qwen" | "moonshot" | "custom";

type AppSettings = {
  transcriptDirectory: string;
  apiProvider?: ApiProvider;
  apiBaseUrl?: string;
  apiModel?: string;
  apiKey?: string;
  todoFilePath?: string;
  memoryFilePath?: string;
};

const providerOptions: Array<{ value: ApiProvider; label: string; baseUrl: string; model: string }> = [
  { value: "zhipu", label: "智谱 Zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { value: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { value: "qwen", label: "通义千问 Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { value: "moonshot", label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { value: "custom", label: "自定义兼容 API", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }
];

function getProviderPreset(provider: ApiProvider) {
  return providerOptions.find((item) => item.value === provider) || providerOptions[0];
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draftDirectory, setDraftDirectory] = useState("");
  const [apiProvider, setApiProvider] = useState<ApiProvider>("zhipu");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiModel, setApiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const hasLoadedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const currentProviderPreset = useMemo(() => getProviderPreset(apiProvider), [apiProvider]);

  useEffect(() => {
    let mounted = true;

    void window.desktopPet.getSettings().then((nextSettings) => {
      if (!mounted) {
        return;
      }

      const provider = (nextSettings.apiProvider || "zhipu") as ApiProvider;
      const preset = getProviderPreset(provider);
      setSettings(nextSettings);
      setDraftDirectory(nextSettings.transcriptDirectory || "");
      setApiProvider(provider);
      setApiBaseUrl(nextSettings.apiBaseUrl || preset.baseUrl);
      setApiModel(nextSettings.apiModel || preset.model);
      setApiKey(nextSettings.apiKey || "");
      hasLoadedRef.current = true;
    });

    return () => {
      mounted = false;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const persistSettings = async () => {
    if (!draftDirectory.trim()) {
      setStatus("请先选择一个保存目录。");
      return;
    }

    if (!apiBaseUrl.trim() || !apiModel.trim()) {
      setStatus("请填写 API Base URL 和模型名称。");
      return;
    }

    setIsSaving(true);
    setStatus("正在自动保存...");

    try {
      const nextSettings = await window.desktopPet.updateSettings({
        transcriptDirectory: draftDirectory.trim(),
        apiProvider,
        apiBaseUrl: apiBaseUrl.trim(),
        apiModel: apiModel.trim(),
        apiKey: apiKey.trim()
      });
      setSettings(nextSettings);
      setStatus("已自动保存。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "自动保存失败，请稍后再试。");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!hasLoadedRef.current) {
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void persistSettings();
    }, 500);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [draftDirectory, apiProvider, apiBaseUrl, apiModel, apiKey]);

  const handleBrowse = async () => {
    const nextDirectory = await window.desktopPet.pickTranscriptDirectory();
    if (nextDirectory) {
      setDraftDirectory(nextDirectory);
      setStatus("正在自动保存...");
    }
  };

  const applyProviderPreset = (provider: ApiProvider) => {
    const preset = getProviderPreset(provider);
    setApiBaseUrl(preset.baseUrl);
    setApiModel(preset.model);
  };

  return (
    <main className="settings-shell">
      <section className="settings-card">
        <div className="settings-heading">
          <div className="settings-heading-row window-drag-handle">
            <div>
              <p className="settings-kicker">Momo Settings</p>
              <h1>设置面板</h1>
            </div>
            <button
              type="button"
              className="settings-close"
              onClick={() => {
                void window.desktopPet.closeSettings();
              }}
              aria-label="关闭设置面板"
            >
              ×
            </button>
          </div>
          <p className="settings-copy">设置项会在输入后自动保存，API 配置已放到底部区域。</p>
        </div>

        <section className="settings-content">
          <label className="settings-field">
            <span>对话文件目录</span>
            <input
              value={draftDirectory}
              onChange={(event) => setDraftDirectory(event.target.value)}
              placeholder="选择用于保存 markdown 对话记录的目录"
            />
          </label>

          <div className="settings-actions">
            <button type="button" className="secondary-button" onClick={() => void handleBrowse()} disabled={isSaving}>
              选择目录
            </button>
          </div>

          <div className="settings-footer">
            <p>当前目录</p>
            <code>{settings?.transcriptDirectory || draftDirectory || "未设置"}</code>
            <p>待办文件</p>
            <code>{settings?.todoFilePath || "未生成"}</code>
            <p>记忆文件</p>
            <code>{settings?.memoryFilePath || "未生成"}</code>
            {status ? <p className="settings-status">{status}</p> : null}
          </div>

          <section className="settings-group settings-group--api">
            <div className="settings-group-heading">
              <strong>API 配置</strong>
              <p>这里设置 Momo 实际调用的模型服务，修改后会自动保存。</p>
            </div>

            <label className="settings-field">
              <span>API 提供商</span>
              <select
                className="settings-select"
                value={apiProvider}
                onChange={(event) => {
                  const nextProvider = event.target.value as ApiProvider;
                  setApiProvider(nextProvider);
                  applyProviderPreset(nextProvider);
                }}
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="settings-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => applyProviderPreset(apiProvider)}
                disabled={isSaving}
              >
                应用 {currentProviderPreset.label} 预设
              </button>
            </div>

            <label className="settings-field">
              <span>API Base URL</span>
              <input
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder="例如 https://api.openai.com/v1"
              />
            </label>

            <label className="settings-field">
              <span>模型</span>
              <input
                value={apiModel}
                onChange={(event) => setApiModel(event.target.value)}
                placeholder="例如 gpt-4o-mini / glm-4-flash"
              />
            </label>

            <label className="settings-field">
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="输入后会保存到本地 settings.json"
              />
            </label>
          </section>
        </section>
      </section>
    </main>
  );
}
