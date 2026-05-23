import { useState } from "react";
import { useSettingsStore } from "../stores/settings";

export default function Speech() {
  const { sttSettings, setSttSettings, apiKeyInput, setApiKeyInput } = useSettingsStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="grid gap-12 pt-[2vh]">
      <section>
        <h3 className="text-base font-semibold tracking-[-0.03em]">语音识别</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">实时语音转文字服务配置。</p>

        <div className="mt-8 grid gap-0">
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
                  {sttSettings.api_key_hint}
                </small>
              )}
            </div>
          </div>

          {/* API Endpoint */}
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

            {/* Workspace ID */}
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
          </div>
        )}
      </section>
    </div>
  );
}
