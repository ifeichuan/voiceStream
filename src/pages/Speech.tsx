import { useSettingsStore } from "../stores/settings";
import {
  mutedClass,
  sectionClass,
  sectionHeadClass,
  sectionTitleClass,
  formGridClass,
  fieldClass,
  fieldLabelClass,
  inputClass,
} from "../lib/styles";

export default function Speech() {
  const { sttSettings, setSttSettings, apiKeyInput, setApiKeyInput } = useSettingsStore();

  return (
    <div className="grid gap-[34px] pt-7">
      <section className={sectionClass}>
        <div className={sectionHeadClass}>
          <div>
            <h3 className={sectionTitleClass}>语音识别</h3>
            <p className={`mt-1.5 ${mutedClass}`}>实时识别。</p>
          </div>
        </div>

        <div className={formGridClass}>
          <label className={fieldClass}>
            <span className={fieldLabelClass}>API Key</span>
            <input
              className={inputClass}
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder={sttSettings.has_api_key ? "已保存到本地，留空则保持不变。" : "sk-..."}
            />
            {sttSettings.has_api_key && (
              <small className={mutedClass}>已保存：{sttSettings.api_key_hint}</small>
            )}
          </label>

          <label className={`${fieldClass} col-span-2 max-[900px]:col-span-1`}>
            <span className={fieldLabelClass}>API Endpoint</span>
            <input
              className={inputClass}
              type="text"
              value={sttSettings.api_endpoint}
              onChange={(event) =>
                setSttSettings((prev) => ({ ...prev, api_endpoint: event.target.value }))
              }
            />
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>模型</span>
            <input
              className={inputClass}
              type="text"
              value={sttSettings.model}
              onChange={(event) =>
                setSttSettings((prev) => ({ ...prev, model: event.target.value }))
              }
            />
          </label>

          <label className={fieldClass}>
            <span className={fieldLabelClass}>Workspace ID</span>
            <input
              className={inputClass}
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
