import { useState } from "react";
import { useSettingsStore } from "../stores/settings";
import type { SttProviderMeta } from "../types";

export default function Speech() {
  const { sttSettings, sttProviders, setSttSettings, apiKeyInput, setApiKeyInput } =
    useSettingsStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    <div className="grid gap-12 pt-[2vh]">
      <section>
        <h3 className="text-base font-semibold tracking-[-0.03em]">语音识别</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">实时识别引擎配置。</p>

        <div className="mt-8 grid gap-0">
          {/* Provider */}
          <div className="form-row">
            <span className="form-row-label">服务商</span>
            <div className="form-row-control">
              <select
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                value={sttSettings.provider}
                onChange={(e) => handleProviderChange(e.target.value)}
              >
                {sttProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* API Key */}
          <div className="form-row">
            <span className="form-row-label">密钥</span>
            <div className="form-row-control">
              <input
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={sttSettings.has_api_key ? "已保存，留空保持不变" : "sk-..."}
              />
              {sttSettings.has_api_key && (
                <small className="mt-1 block text-right text-[0.75rem] text-paper-muted">
                  已保存：{sttSettings.api_key_hint}
                </small>
              )}
            </div>
          </div>

          {/* API Endpoint */}
          {showEndpoint && (
            <div className="form-row">
              <span className="form-row-label">服务地址</span>
              <div className="form-row-control">
                <input
                  className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                  type="text"
                  value={sttSettings.api_endpoint}
                  onChange={(e) =>
                    setSttSettings((prev) => ({ ...prev, api_endpoint: e.target.value }))
                  }
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Advanced options */}
      <section>
        <button
          type="button"
          className="flex min-h-10 min-w-10 items-center gap-2 rounded bg-transparent text-[0.86rem] text-paper-muted transition-colors duration-150 hover:text-paper-ink active:scale-[0.96]"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
        >
          <span className="text-[0.75rem]">{showAdvanced ? "▾" : "▸"}</span>
          更多选项
        </button>

        {showAdvanced && (
          <div className="mt-4 grid gap-0">
            {/* Model */}
            {showModel && (
              <div className="form-row">
                <span className="form-row-label">模型</span>
                <div className="form-row-control">
                  <input
                    className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                    type="text"
                    value={sttSettings.model}
                    onChange={(e) =>
                      setSttSettings((prev) => ({ ...prev, model: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            {/* Workspace ID */}
            {showWorkspaceId && (
              <div className="form-row">
                <span className="form-row-label">工作区</span>
                <div className="form-row-control">
                  <input
                    className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                    type="text"
                    value={sttSettings.workspace_id}
                    onChange={(e) =>
                      setSttSettings((prev) => ({ ...prev, workspace_id: e.target.value }))
                    }
                    placeholder="可选"
                  />
                </div>
              </div>
            )}

            {/* Language */}
            <div className="form-row">
              <span className="form-row-label">语言</span>
              <div className="form-row-control">
                <input
                  className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                  type="text"
                  value={sttSettings.language}
                  onChange={(e) =>
                    setSttSettings((prev) => ({ ...prev, language: e.target.value }))
                  }
                  placeholder="自动检测"
                />
              </div>
            </div>

            {/* Sample Rate */}
            <div className="form-row">
              <span className="form-row-label">采样率</span>
              <div className="form-row-control">
                <input
                  className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                  type="number"
                  value={sttSettings.sample_rate}
                  onChange={(e) =>
                    setSttSettings((prev) => ({
                      ...prev,
                      sample_rate: parseInt(e.target.value, 10) || 16000,
                    }))
                  }
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
