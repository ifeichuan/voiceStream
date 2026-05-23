import { useMemo } from "react";
import { useSettingsStore } from "../stores/settings";
import { PI_MODES, PROMPT_TEMPLATES } from "../lib/constants";
import {
  mutedClass,
  ghostButtonClass,
  sectionClass,
  sectionHeadClass,
  sectionTitleClass,
  formGridClass,
  fieldClass,
  fieldLabelClass,
  inputClass,
  textareaClass,
  metaCardClass,
} from "../lib/styles";

export default function Pi() {
  const { piSettings, setPiSettings, localPi } = useSettingsStore();

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

  const applyLocalPiDefaults = () => {
    setPiSettings((prev) => ({
      ...prev,
      provider: localPi.default_provider || prev.provider,
      model: localPi.default_model || prev.model,
    }));
  };

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

  const useNativePiConfig = () => {
    setPiSettings((prev) => ({
      ...prev,
      provider: "",
      model: "",
      provider_json: "",
    }));
  };

  return (
    <div className="grid gap-[34px] pt-7">
      <section className={sectionClass}>
        <div className={`${sectionHeadClass} max-[760px]:flex-col max-[760px]:items-start`}>
          <div>
            <h3 className={sectionTitleClass}>Pi</h3>
            <p className={`mt-1.5 ${mutedClass}`}>模型与运行方式。</p>
          </div>
          <div className="flex gap-2.5">
            <button className={ghostButtonClass} type="button" onClick={applyLocalPiDefaults}>
              使用本机默认值
            </button>
            <button className={ghostButtonClass} type="button" onClick={useNativePiConfig}>
              跟随本机 Pi（清空覆盖）
            </button>
          </div>
        </div>

        <div className={formGridClass}>
          <label className={fieldClass}>
            <span className={fieldLabelClass}>模式</span>
            <select
              className={inputClass}
              value={piSettings.mode}
              onChange={(e) => setPiSettings((prev) => ({ ...prev, mode: e.target.value }))}
            >
              {PI_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>复用进程</span>
            <input
              className="mt-2.5 h-5 min-h-5 w-5 accent-paper-accent"
              type="checkbox"
              checked={piSettings.reuse_process}
              onChange={(e) => setPiSettings((prev) => ({ ...prev, reuse_process: e.target.checked }))}
            />
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>Provider</span>
            <select
              className={inputClass}
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
                <optgroup label="Pi 原生可用（CLI）">
                  {nativeProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.id}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {isManualProvider && (
              <input
                className={inputClass}
                type="text"
                value={piSettings.provider}
                onChange={(e) => setPiSettings((prev) => ({ ...prev, provider: e.target.value }))}
                placeholder="例如：github-copilot"
              />
            )}
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>模型</span>
            {selectedProvider && selectedProvider.models.length > 0 ? (
              <select
                className={inputClass}
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
                className={inputClass}
                type="text"
                value={piSettings.model}
                onChange={(e) => setPiSettings((prev) => ({ ...prev, model: e.target.value }))}
                placeholder="qwen3.5-flash"
              />
            )}
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <div className={sectionHeadClass}>
          <div>
            <h3 className={sectionTitleClass}>本机 Pi</h3>
            <p className={`mt-1.5 ${mutedClass}`}>本机配置映射。</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5 max-[900px]:grid-cols-1">
          <div className={metaCardClass}>
            <span className={fieldLabelClass}>settings.json</span>
            <strong className="mt-3 block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
              {localPi.settings_path || "未找到"}
            </strong>
          </div>
          <div className={metaCardClass}>
            <span className={fieldLabelClass}>models.json</span>
            <strong className="mt-3 block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
              {localPi.models_path || "未找到"}
            </strong>
          </div>
          <div className={metaCardClass}>
            <span className={fieldLabelClass}>默认 Provider</span>
            <strong className="mt-3 block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
              {localPi.default_provider || "未设置"}
            </strong>
          </div>
          <div className={metaCardClass}>
            <span className={fieldLabelClass}>默认模型</span>
            <strong className="mt-3 block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
              {localPi.default_model || "未设置"}
            </strong>
          </div>
        </div>

        <div className="grid gap-0">
          {fileProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={[
                "flex w-full items-baseline justify-between gap-5 border-b border-paper-line bg-transparent py-4 text-left transition duration-150 hover:-translate-y-px max-[760px]:flex-col max-[760px]:items-start",
                piSettings.provider === provider.id ? "text-paper-accent" : "",
              ].join(" ")}
              onClick={() => applyProviderFromLocal(provider.id)}
            >
              <div>
                <strong className="block text-base font-semibold">{provider.id}</strong>
                <p className="mt-1 break-all text-paper-muted">{provider.base_url || "无 baseUrl"}</p>
              </div>
              <span>{provider.models.length} 个模型</span>
            </button>
          ))}

          {nativeProviders.length > 0 && (
            <div className="mt-4 border-t border-paper-line pt-3">
              <p className={fieldLabelClass}>Pi 原生可用 Provider（CLI）</p>
              {nativeProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={[
                    "flex w-full items-baseline justify-between gap-5 border-b border-paper-line bg-transparent py-4 text-left transition duration-150 hover:-translate-y-px max-[760px]:flex-col max-[760px]:items-start",
                    piSettings.provider === provider.id ? "text-paper-accent" : "",
                  ].join(" ")}
                  onClick={() => applyProviderFromLocal(provider.id)}
                >
                  <div>
                    <strong className="block text-base font-semibold">{provider.id}</strong>
                    <p className="mt-1 break-all text-paper-muted">来自 pi --list-models</p>
                  </div>
                  <span>{provider.models.length} 个模型</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className={sectionClass}>
        <div className={sectionHeadClass}>
          <div>
            <h3 className={sectionTitleClass}>模板与覆盖</h3>
            <p className={`mt-1.5 ${mutedClass}`}>编辑这里，不直接改本机文件。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-y-[26px]">
          <label className={fieldClass}>
            <span className={fieldLabelClass}>预设</span>
            <select
              className={inputClass}
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
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>提示词模板</span>
            <textarea
              className={textareaClass}
              rows={11}
              value={piSettings.custom_prompt_template}
              onChange={(e) =>
                setPiSettings((prev) => ({ ...prev, custom_prompt_template: e.target.value }))
              }
              placeholder="{text}"
            />
            <small className={mutedClass}>用于覆盖默认模板。</small>
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>Provider JSON 覆盖</span>
            <textarea
              className={textareaClass}
              rows={12}
              value={piSettings.provider_json}
              onChange={(e) =>
                setPiSettings((prev) => ({ ...prev, provider_json: e.target.value }))
              }
              placeholder='{"providers": {...}}'
            />
            <small className={mutedClass}>只写入应用设置，不会修改 ~/.pi/agent/models.json。</small>
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <div className={sectionHeadClass}>
          <div>
            <h3 className={sectionTitleClass}>本机文件参考</h3>
            <p className={`mt-1.5 ${mutedClass}`}>只读，用于对照。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-y-[26px]">
          <label className={fieldClass}>
            <span className={fieldLabelClass}>~/.pi/agent/settings.json（只读）</span>
            <textarea className={textareaClass} rows={8} value={localPi.raw_settings_json} readOnly />
          </label>
          <label className={fieldClass}>
            <span className={fieldLabelClass}>~/.pi/agent/models.json（只读）</span>
            <textarea className={textareaClass} rows={14} value={localPi.raw_models_json} readOnly />
          </label>
        </div>
      </section>
    </div>
  );
}
