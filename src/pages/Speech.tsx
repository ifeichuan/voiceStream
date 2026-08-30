import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settings";
import type { SttProviderMeta } from "../types";

/** 每行一个热词 ↔ JSON 数组（weight 统一 4）互转 */
function linesToHotWordsJson(text: string): string {
  const words = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return JSON.stringify(words.map((w) => ({ text: w, weight: 4 })));
}

function hotWordsJsonToLines(json: string): string {
  if (!json.trim()) return "";
  try {
    const items = JSON.parse(json);
    if (!Array.isArray(items)) return "";
    return items
      .map((item) => (typeof item === "string" ? item : item?.text ?? ""))
      .filter((w: string) => w.length > 0)
      .join("\n");
  } catch {
    return "";
  }
}

export default function Speech() {
  const {
    sttSettings,
    sttProviders,
    setSttSettings,
    audioSettings,
    setAudioSettings,
    apiKeyInput,
    setApiKeyInput,
  } = useSettingsStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hotWordsText, setHotWordsText] = useState(() =>
    hotWordsJsonToLines(sttSettings.hot_words)
  );

  // 设置加载后同步热词文本区
  useEffect(() => {
    setHotWordsText(hotWordsJsonToLines(sttSettings.hot_words));
  }, [sttSettings.hot_words]);

  const applyHotWords = (text: string) => {
    setHotWordsText(text);
    setSttSettings((prev) => ({ ...prev, hot_words: linesToHotWordsJson(text) }));
  };

  const restoreDefaultHotWords = async () => {
    try {
      const json = await invoke<string>("get_default_stt_hot_words");
      setHotWordsText(hotWordsJsonToLines(json));
      setSttSettings((prev) => ({ ...prev, hot_words: json }));
    } catch {
      setHotWordsText("");
    }
  };

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
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">麦克风</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">
          听写时抵消本机扬声器漏进麦克风的声音。
        </p>

        <div className="mt-8 grid gap-0">
          <div className="form-row">
            <span className="form-row-label">抑制扬声器声音</span>
            <div className="form-row-control flex justify-end">
              <input
                className="h-5 w-5 accent-paper-accent"
                type="checkbox"
                checked={audioSettings.suppress_speaker_audio}
                onChange={(e) =>
                  setAudioSettings((prev) => ({
                    ...prev,
                    suppress_speaker_audio: e.target.checked,
                  }))
                }
              />
            </div>
          </div>
        </div>
        <p className="mt-2 text-[0.75rem] leading-snug text-paper-muted">
          使用 macOS 语音处理消除回声。若识别变差，关闭后即回退为原声采集。保存后生效。
        </p>
      </section>

      <section>
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">语音识别</h3>
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

      {/* Hot words & context */}
      <section>
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">热词与上下文</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">
          热词提升特定词汇的识别率；上下文把近期听写文本带给引擎，辅助同音词与英文纠错。
        </p>

        <div className="mt-8 grid gap-0">
          {/* Hot words */}
          <div className="form-row items-start">
            <span className="form-row-label pt-2">热词表</span>
            <div className="form-row-control">
              <textarea
                className="h-44 w-full resize-y rounded border border-paper-line bg-transparent px-3 py-2 text-[0.86rem] leading-relaxed text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                value={hotWordsText}
                onChange={(e) => applyHotWords(e.target.value)}
                placeholder={"每行一个热词\n例如：\nyyds\n内卷\nChatGPT"}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <small className="text-[0.75rem] leading-snug text-paper-muted">
                  每行一个词；纯中文不超过 10 字，英文或中英混合按空格分词不超过 5 词。
                </small>
                <button
                  type="button"
                  className="shrink-0 rounded border border-paper-line px-2.5 py-1 text-[0.75rem] text-paper-muted transition-colors duration-150 hover:text-paper-ink"
                  onClick={restoreDefaultHotWords}
                >
                  恢复默认
                </button>
              </div>
            </div>
          </div>

          {/* Context window */}
          <div className="form-row">
            <span className="form-row-label">上下文窗口</span>
            <div className="form-row-control">
              <input
                className="w-full rounded border-0 border-b border-paper-line bg-transparent px-0 py-2 text-right text-paper-ink outline-none transition duration-150 focus:border-paper-accent"
                type="number"
                min={0}
                max={480}
                value={sttSettings.context_minutes}
                onChange={(e) =>
                  setSttSettings((prev) => ({
                    ...prev,
                    context_minutes: Math.max(0, parseInt(e.target.value, 10) || 0),
                  }))
                }
              />
              <small className="mt-1 block text-right text-[0.75rem] text-paper-muted">
                分钟；识别时携带近 N 分钟内的历史听写文本，填 0 关闭
              </small>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
