import { useSettingsStore } from "../stores/settings";

export default function Speech() {
  const { sttSettings, setSttSettings, apiKeyInput, setApiKeyInput } = useSettingsStore();

  return (
    <div className="grid gap-[34px] pt-7">
      <section className="section-divider">
        <div className="section-head">
          <div>
            <h3 className="section-title">语音识别</h3>
            <p className="mt-1.5 text-paper-muted">实时识别。</p>
          </div>
        </div>

        <div className="form-grid">
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
        </div>
      </section>
    </div>
  );
}
