import { useMemo, useState } from "react";
import { useSettingsStore } from "../stores/settings";
import { PI_MODES, PROMPT_TEMPLATES, THINKING_LEVELS } from "../lib/constants";

export default function Pi() {
  const { piSettings, setPiSettings, localPi } = useSettingsStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedProvider = useMemo(
    () => localPi.providers.find((p) => p.id === piSettings.provider),
    [localPi.providers, piSettings.provider],
  );
  const nativeProviders = useMemo(
    () => localPi.providers.filter((p) => !p.base_url && !p.api),
    [localPi.providers],
  );
  const fileProviders = useMemo(
    () => localPi.providers.filter((p) => p.base_url || p.api),
    [localPi.providers],
  );
  const isManualProvider = useMemo(
    () => !piSettings.provider || !localPi.providers.some((p) => p.id === piSettings.provider),
    [localPi.providers, piSettings.provider],
  );

  const applyProviderFromLocal = (providerId: string) => {
    const provider = localPi.providers.find((item) => item.id === providerId);
    setPiSettings((prev) => ({
      ...prev,
      provider: providerId,
      model: provider?.models[0]?.id ?? "",
      provider_json:
        provider === undefined
          ? ""
          : provider.base_url && provider.api
            ? JSON.stringify(
                {
                  providers: {
                    [provider.id]: {
                      baseUrl: provider.base_url,
                      api: provider.api,
                      models: provider.models.map((m) => ({ id: m.id, name: m.name })),
                    },
                  },
                },
                null,
                2,
              )
            : "",
    }));
  };

  return (
    <div className="grid gap-12 pt-[2vh]">
      <section>
        <h3 className="text-base font-semibold tracking-[-0.03em]">Pi 整理</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">语音文本整理的模型与运行方式。</p>

        <div className="mt-8 grid gap-0">
          {/* Mode */}
          <div className="form-row">
            <span className="form-row-label">模式</span>
            <div className="form-row-control">
              <select
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                value={piSettings.mode}
                onChange={(e) => setPiSettings((prev) => ({ ...prev, mode: e.target.value }))}
              >
                {PI_MODES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Provider */}
          <div className="form-row">
            <span className="form-row-label">服务商</span>
            <div className="form-row-control">
              <select
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                value={isManualProvider ? "" : piSettings.provider}
                onChange={(e) => applyProviderFromLocal(e.target.value)}
              >
                <option value="">手动输入</option>
                {fileProviders.length > 0 && (
                  <optgroup label="本机 models.json">
                    {fileProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {nativeProviders.length > 0 && (
                  <optgroup label="Pi 原生可用">
                    {nativeProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.id}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {isManualProvider && piSettings.provider && (
                <input
                  className="mt-2 w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                  type="text"
                  value={piSettings.provider}
                  onChange={(e) => setPiSettings((prev) => ({ ...prev, provider: e.target.value }))}
                  placeholder="例如：github-copilot"
                />
              )}
            </div>
          </div>

          {/* Model */}
          <div className="form-row">
            <span className="form-row-label">模型</span>
            <div className="form-row-control">
              {selectedProvider && selectedProvider.models.length > 0 ? (
                <select
                  className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                  value={
                    selectedProvider.models.some((m) => m.id === piSettings.model)
                      ? piSettings.model
                      : ""
                  }
                  onChange={(e) =>
                    setPiSettings((prev) => ({ ...prev, model: e.target.value || prev.model }))
                  }
                >
                  {selectedProvider.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name !== model.id ? `${model.name} (${model.id})` : model.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                  type="text"
                  value={piSettings.model}
                  onChange={(e) => setPiSettings((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="qwen3.5-flash"
                />
              )}
            </div>
          </div>

          {/* Thinking level */}
          <div className="form-row">
            <span className="form-row-label">推理等级</span>
            <div className="form-row-control">
              <select
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                value={piSettings.thinking}
                onChange={(e) => setPiSettings((prev) => ({ ...prev, thinking: e.target.value }))}
              >
                {THINKING_LEVELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
          <div className="mt-6 grid gap-8">
            {/* Reuse process */}
            <div className="form-row">
              <span className="form-row-label">复用进程</span>
              <div className="form-row-control flex justify-end">
                <input
                  className="h-5 w-5 accent-paper-accent"
                  type="checkbox"
                  checked={piSettings.reuse_process}
                  onChange={(e) =>
                    setPiSettings((prev) => ({ ...prev, reuse_process: e.target.checked }))
                  }
                />
              </div>
            </div>

            {/* Prompt template */}
            <div className="grid gap-3">
              <span className="text-[0.86rem] text-paper-ink">预设模板</span>
              <select
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                value={piSettings.prompt_template_key}
                onChange={(e) =>
                  setPiSettings((prev) => ({ ...prev, prompt_template_key: e.target.value }))
                }
              >
                {PROMPT_TEMPLATES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Provider JSON override */}
            <div className="grid gap-3">
              <span className="text-[0.86rem] text-paper-ink">服务商 JSON 覆盖</span>
              <textarea
                className="min-h-[100px] w-full resize-y rounded border-b border-paper-line bg-transparent px-0 py-2 font-mono text-[0.82rem] leading-[1.65] text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                rows={8}
                value={piSettings.provider_json}
                onChange={(e) =>
                  setPiSettings((prev) => ({ ...prev, provider_json: e.target.value }))
                }
                placeholder='{"providers": {...}}'
              />
              <small className="text-[0.75rem] text-paper-muted">
                只写入应用设置，不会修改本机文件。
              </small>
            </div>

            {/* Local Pi reference (read-only) */}
            <div className="grid gap-4 pt-4">
              <p className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-paper-muted">
                本机参考（只读）
              </p>
              <div className="form-row">
                <span className="text-[0.82rem] text-paper-muted">默认服务商</span>
                <span className="text-[0.86rem] font-semibold">
                  {localPi.default_provider || "未设置"}
                </span>
              </div>
              <div className="form-row">
                <span className="text-[0.82rem] text-paper-muted">默认模型</span>
                <span className="text-[0.86rem] font-semibold">
                  {localPi.default_model || "未设置"}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
