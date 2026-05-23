import { useSettingsStore } from "../stores/settings";
import type { SttProviderMeta } from "../types";

export default function Speech() {
  const { sttSettings, sttProviders, setSttSettings, apiKeyInput, setApiKeyInput } =
    useSettingsStore();

  const currentMeta: SttProviderMeta | undefined = sttProviders.find(
    (p) => p.id === sttSettings.provider
  );

  const handleProviderChange = (providerId: string) => {
    const meta = sttProviders.find((p) => p.id === providerId);
    setSttSettings((prev) => ({
      ...prev,
      provider: providerId,
      api_endpoint: meta?.default_endpoint ?? prev.api_endpoint,
      model: meta?.default_model ?? prev.model,
      sample_rate: meta?.default_sample_rate ?? prev.sample_rate,
    }));
  };

  const showEndpoint = currentMeta?.needs_endpoint ?? true;
  const showModel = currentMeta?.needs_model ?? true;
  const showWorkspaceId = currentMeta?.needs_workspace_id ?? false;

  return (
    <div className="grid gap-[34px] pt-7">
      <section className="section-divider">
        <div className="section-head">
          <div>
            <h3 className="section-title">语音识别</h3>
            <p className="mt-1.5 text-paper-muted">实时识别引擎配置。</p>
          </div>
        </div>

        <div className="form-grid">
          <label className="field col-span-2 max-[900px]:col-span-1">
            <span className="field-label">Provider</span>
            <select
              className="input"
              value={sttSettings.provider}
              onChange={(event) => handleProviderChange(event.target.value)}
            >
              {sttProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">API Key</span>
            <input
              className="input"
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder={sttSettings.has_api_key ? "已保存到本地，留空则保持不变。" : "sk-..."}
            />
            {sttSettings.has_api_key && (
              <small className="text-paper-muted">已保存：{sttSettings.api_key_hint}</small>
            )}
          </label>

          {showEndpoint && (
            <label className="field col-span-2 max-[900px]:col-span-1">
              <span className="field-label">API Endpoint</span>
              <input
                className="input"
                type="text"
                value={sttSettings.api_endpoint}
                onChange={(event) =>
                  setSttSettings((prev) => ({ ...prev, api_endpoint: event.target.value }))
                }
              />
            </label>
          )}

          {showModel && (
            <label className="field">
              <span className="field-label">模型</span>
              <input
                className="input"
                type="text"
                value={sttSettings.model}
                onChange={(event) =>
                  setSttSettings((prev) => ({ ...prev, model: event.target.value }))
                }
              />
            </label>
          )}

          {showWorkspaceId && (
            <label className="field">
              <span className="field-label">Workspace ID</span>
              <input
                className="input"
                type="text"
                value={sttSettings.workspace_id}
                onChange={(event) =>
                  setSttSettings((prev) => ({ ...prev, workspace_id: event.target.value }))
                }
                placeholder="可选"
              />
            </label>
          )}

          <label className="field">
            <span className="field-label">语言</span>
            <input
              className="input"
              type="text"
              value={sttSettings.language}
              onChange={(event) =>
                setSttSettings((prev) => ({ ...prev, language: event.target.value }))
              }
              placeholder="自动检测"
            />
          </label>

          <label className="field">
            <span className="field-label">采样率</span>
            <input
              className="input"
              type="number"
              value={sttSettings.sample_rate}
              onChange={(event) =>
                setSttSettings((prev) => ({
                  ...prev,
                  sample_rate: parseInt(event.target.value, 10) || 16000,
                }))
              }
            />
          </label>
        </div>
      </section>
    </div>
  );
}
