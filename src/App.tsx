import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface AudioChunk {
  timestamp: number;
  sample_rate: number;
  channels: number;
  size: number;
}

interface HotkeySessionEvent {
  state: string;
  message: string;
  shortcut: string;
}

interface SttTranscriptEvent {
  text: string;
  is_final: boolean;
}

interface SttStatusEvent {
  provider: string;
  status: string;
}

interface SttSettingsView {
  provider: string;
  api_endpoint: string;
  model: string;
  workspace_id: string;
  has_api_key: boolean;
  api_key_hint: string;
}

interface LocalPiModelView {
  id: string;
  name: string;
}

interface LocalPiProviderView {
  id: string;
  base_url: string;
  api: string;
  has_api_key: boolean;
  models: LocalPiModelView[];
}

interface LocalPiConfigView {
  settings_path: string;
  models_path: string;
  default_provider: string;
  default_model: string;
  providers: LocalPiProviderView[];
  raw_settings_json: string;
  raw_models_json: string;
}

interface PiSettingsView {
  mode: string;
  provider: string;
  model: string;
  reuse_process: boolean;
  prompt_template_key: string;
  custom_prompt_template: string;
  provider_json: string;
}

interface AppSettingsView {
  stt: SttSettingsView;
  pi: PiSettingsView;
  local_pi: LocalPiConfigView;
}

interface TimingEvent {
  session_id: number;
  stage: string;
  elapsed_ms: number;
  details: string;
}

type NavKey = "overview" | "speech" | "pi" | "activity";

const MAX_LOGS = 12;
const DEFAULT_SHORTCUT = "Cmd+Shift+Space";
const PI_MODES = [
  { value: "dictation-fast", label: "快速整理" },
  { value: "dictation-voice", label: "语音反馈" },
  { value: "agent", label: "Agent 会话" },
];
const PROMPT_TEMPLATES = [
  { value: "default", label: "默认 · 最小整理" },
  { value: "light", label: "轻量 · 轻修正" },
  { value: "structured", label: "结构化 · 轻结构化" },
  { value: "official-lite", label: "官方感 · 简洁清晰" },
  { value: "list-friendly", label: "列表友好 · 1. 2. 3." },
  { value: "json-structured", label: "JSON 结构化 · 稳定解析" },
  { value: "tooluse-structured", label: "Tool Use 结构化 · 最稳" },
  { value: "custom", label: "自定义 · 手动模板" },
];
const NAV_ITEMS: Array<{ key: NavKey; label: string; meta: string }> = [
  { key: "overview", label: "概览", meta: "总览" },
  { key: "speech", label: "语音识别", meta: "识别" },
  { key: "pi", label: "Pi", meta: "模型与映射" },
  { key: "activity", label: "活动", meta: "日志" },
];

const kickerClass =
  "m-0 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-paper-accent";
const mutedClass = "text-paper-muted";
const primaryButtonClass =
  "min-h-10 rounded-full bg-paper-ink px-3.5 text-paper-surface transition duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55";
const ghostButtonClass =
  "min-h-10 rounded-full border border-paper-line bg-transparent px-3.5 text-paper-accent transition duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55";
const sectionClass = "border-b border-paper-line pb-7";
const sectionHeadClass = "mb-[18px] flex items-end justify-between gap-4";
const sectionTitleClass = "text-base font-semibold tracking-[-0.03em]";
const formGridClass = "grid grid-cols-2 gap-x-[22px] gap-y-[26px] max-[900px]:grid-cols-1";
const fieldClass = "grid gap-[9px]";
const fieldLabelClass =
  "block text-[0.76rem] font-semibold uppercase tracking-[0.12em] text-paper-muted";
const inputClass =
  "min-h-11 w-full rounded-none border-0 border-b border-paper-line bg-transparent px-0 pt-2.5 pb-3 text-paper-ink outline-none transition duration-150 focus:border-paper-accent";
const textareaClass =
  `${inputClass} min-h-[132px] resize-y font-mono text-[0.88rem] leading-[1.65]`;
const statCardClass = "border-b border-paper-line pb-[18px]";
const metaCardClass = "border-b border-paper-line pb-[18px]";
const rowClass =
  "flex items-baseline justify-between gap-4 border-b border-paper-line py-3.5 max-[760px]:flex-col max-[760px]:items-start";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function App() {
  const [activeNav, setActiveNav] = useState<NavKey>("overview");
  const [isRecording, setIsRecording] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [lastChunkInfo, setLastChunkInfo] = useState<string>("尚未接收到音频。");
  const [sttStatus, setSttStatus] = useState("idle");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState<string[]>([]);
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeySessionEvent>({
    state: "idle",
    message: `Press ${DEFAULT_SHORTCUT} to start`,
    shortcut: DEFAULT_SHORTCUT,
  });
  const [sttSettings, setSttSettings] = useState<SttSettingsView>({
    provider: "aliyun-bailian",
    api_endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    model: "fun-asr-realtime",
    workspace_id: "",
    has_api_key: false,
    api_key_hint: "",
  });
  const [piSettings, setPiSettings] = useState<PiSettingsView>({
    mode: "dictation-fast",
    provider: "",
    model: "",
    reuse_process: true,
    prompt_template_key: "default",
    custom_prompt_template: "",
    provider_json: "",
  });
  const [localPi, setLocalPi] = useState<LocalPiConfigView>({
    settings_path: "",
    models_path: "",
    default_provider: "",
    default_model: "",
    providers: [],
    raw_settings_json: "",
    raw_models_json: "",
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("未保存");
  const [isTestingSettings, setIsTestingSettings] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev.slice(-(MAX_LOGS - 1)), `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const selectedProvider = useMemo(
    () => localPi.providers.find((provider) => provider.id === piSettings.provider),
    [localPi.providers, piSettings.provider],
  );
  const nativeProviders = useMemo(
    () => localPi.providers.filter((provider) => !provider.base_url && !provider.api),
    [localPi.providers],
  );
  const fileProviders = useMemo(
    () => localPi.providers.filter((provider) => provider.base_url || provider.api),
    [localPi.providers],
  );
  const isManualProvider = useMemo(
    () => !piSettings.provider || !localPi.providers.some((provider) => provider.id === piSettings.provider),
    [localPi.providers, piSettings.provider],
  );

  useEffect(() => {
    let unlistenAudio: (() => void) | undefined;
    let unlistenStt: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenHotkey: (() => void) | undefined;
    let unlistenTiming: (() => void) | undefined;

    addLog("Ready");

    void invoke<AppSettingsView>("get_app_settings")
      .then((settings) => {
        setSttSettings(settings.stt);
        setPiSettings(settings.pi);
        setLocalPi(settings.local_pi);
        setSettingsStatus(settings.stt.has_api_key ? "已保存到本地" : "未配置 API Key");
      })
      .catch((error) => addLog(`Load settings failed: ${getErrorMessage(error)}`));

    void listen<AudioChunk>("audio-chunk", (event) => {
      const chunk = event.payload;
      setChunkCount((prev) => prev + 1);
      setLastChunkInfo(`${chunk.sample_rate} Hz · ${chunk.channels} ch · ${Math.round(chunk.size / 1024)} KB`);
    }).then((dispose) => {
      unlistenAudio = dispose;
    });

    void listen<SttTranscriptEvent>("stt-transcript", (event) => {
      const { text, is_final } = event.payload;
      if (is_final) {
        setFinalTranscript((prev) => [...prev, text]);
        setPartialTranscript("");
      } else {
        setPartialTranscript(text);
      }
    }).then((dispose) => {
      unlistenStt = dispose;
    });

    void listen<SttStatusEvent>("stt-status", (event) => {
      const nextStatus = `${event.payload.provider}: ${event.payload.status}`;
      setSttStatus(nextStatus);
      addLog(`STT ${nextStatus}`);
    }).then((dispose) => {
      unlistenStatus = dispose;
    });

    void listen<HotkeySessionEvent>("hotkey-session", (event) => {
      setHotkeyStatus(event.payload);
      setIsRecording(event.payload.state === "recording");
      addLog(`Hotkey ${event.payload.state}: ${event.payload.message}`);
    }).then((dispose) => {
      unlistenHotkey = dispose;
    });

    void listen<TimingEvent>("timing-log", (event) => {
      const { session_id, stage, elapsed_ms, details } = event.payload;
      addLog(details ? `Timing #${session_id} ${stage}: ${elapsed_ms} ms (${details})` : `Timing #${session_id} ${stage}: ${elapsed_ms} ms`);
    }).then((dispose) => {
      unlistenTiming = dispose;
    });

    return () => {
      unlistenAudio?.();
      unlistenStt?.();
      unlistenStatus?.();
      unlistenHotkey?.();
      unlistenTiming?.();
    };
  }, []);

  const startRecording = async () => {
    try {
      const message = await invoke<string>("start_recording");
      setIsRecording(true);
      setChunkCount(0);
      setLastChunkInfo("等待接收音频...");
      setPartialTranscript("");
      setFinalTranscript([]);
      setSttStatus("starting");
      addLog(message);
    } catch (error) {
      addLog(`Start failed: ${getErrorMessage(error)}`);
    }
  };

  const stopRecording = async () => {
    try {
      const message = await invoke<string>("stop_recording");
      setIsRecording(false);
      addLog(message);
    } catch (error) {
      addLog(`Stop failed: ${getErrorMessage(error)}`);
    }
  };

  const playLatest = async () => {
    try {
      const message = await invoke<string>("play_recorded");
      addLog(message);
    } catch (error) {
      addLog(`Play failed: ${getErrorMessage(error)}`);
    }
  };

  const saveSettings = async () => {
    try {
      const saved = await invoke<AppSettingsView>("save_app_settings", {
        settings: {
          stt: {
            api_key: apiKeyInput,
            api_endpoint: sttSettings.api_endpoint,
            model: sttSettings.model,
            workspace_id: sttSettings.workspace_id,
          },
          pi: {
            mode: piSettings.mode,
            provider: piSettings.provider,
            model: piSettings.model,
            reuse_process: piSettings.reuse_process,
            prompt_template_key: piSettings.prompt_template_key,
            custom_prompt_template: piSettings.custom_prompt_template,
            provider_json: piSettings.provider_json,
          },
        },
      });
      setSttSettings(saved.stt);
      setPiSettings(saved.pi);
      setLocalPi(saved.local_pi);
      setApiKeyInput("");
      setSettingsStatus("已保存到本地");
      addLog("设置已保存");
    } catch (error) {
      const message = getErrorMessage(error);
      setSettingsStatus(`保存失败：${message}`);
      addLog(`保存设置失败：${message}`);
    }
  };

  const testSettings = async () => {
    setIsTestingSettings(true);
    setSettingsStatus("正在测试 STT 连接...");
    try {
      const message = await invoke<string>("test_stt_settings", {
        settings: {
          api_key: apiKeyInput,
          api_endpoint: sttSettings.api_endpoint,
          model: sttSettings.model,
          workspace_id: sttSettings.workspace_id,
        },
      });
      setSettingsStatus(message);
      addLog(message);
    } catch (error) {
      const message = getErrorMessage(error);
      setSettingsStatus(`测试失败：${message}`);
      addLog(`测试设置失败：${message}`);
    } finally {
      setIsTestingSettings(false);
    }
  };

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
                      models: provider.models.map((model) => ({ id: model.id, name: model.name })),
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

  const statusTone = hotkeyStatus.state === "recording" ? "recording" : "idle";

  return (
    <main className="grid h-screen grid-cols-[248px_minmax(0,1fr)] bg-paper-surface max-[760px]:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="sticky top-0 flex h-screen flex-col justify-between overflow-hidden border-r border-paper-line bg-gradient-to-b from-paper-surface to-paper-surface-soft px-[18px] pt-[22px] pb-[18px]">
        <div className="grid gap-5">
          <div className="flex gap-2 py-[2px]" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
          </div>

          <div className="pr-2.5">
            <p className={kickerClass}>VoiceStream</p>
            <h1 className="mt-2.5 text-[clamp(1.85rem,2.2vw,2.4rem)] leading-[0.98] font-semibold tracking-[-0.07em]">
              语音设置
            </h1>
          </div>
        </div>

        <nav className="mt-2 grid content-start gap-[3px]" aria-label="设置导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={[
                "grid w-full gap-0.5 bg-transparent px-2.5 py-[11px] text-left text-inherit transition duration-150 hover:bg-paper-surface-soft",
                activeNav === item.key
                  ? "bg-[color-mix(in_oklch,var(--color-paper-surface-soft)_92%,var(--color-paper-accent)_8%)]"
                  : "",
              ].join(" ")}
              onClick={() => setActiveNav(item.key)}
            >
              <span className="text-[0.95rem] font-semibold">{item.label}</span>
              <small className="text-paper-muted">{item.meta}</small>
            </button>
          ))}
        </nav>

        <div className="mt-[22px] flex items-center gap-3 border-t border-paper-line pt-4">
          <span
            className={[
              "h-[9px] w-[9px] shrink-0 rounded-full",
              statusTone === "recording"
                ? "bg-[oklch(0.66_0.19_25)] shadow-[0_0_0_6px_oklch(0.94_0.02_30)]"
                : "bg-[oklch(0.7_0.012_65)]",
            ].join(" ")}
          />
          <div>
            <strong className="block text-[0.95rem] font-semibold">{hotkeyStatus.shortcut}</strong>
            <p className="mt-1 text-paper-muted [line-height:1.45]">{hotkeyStatus.message}</p>
          </div>
        </div>
      </aside>

      <section className="h-screen overflow-x-hidden overflow-y-auto bg-paper-surface px-[42px] pb-[52px] [scrollbar-gutter:stable] max-[760px]:px-[22px] max-[760px]:pb-10">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-paper-line bg-[color-mix(in_oklch,var(--color-paper-surface)_94%,white_6%)] py-[18px] pt-7 max-[760px]:flex-col max-[760px]:items-start">
          <div>
            <p className={kickerClass}>设置</p>
            <h2 className="mt-1.5 text-[clamp(1.6rem,1.9vw,2.1rem)] font-semibold tracking-[-0.06em]">
              {NAV_ITEMS.find((item) => item.key === activeNav)?.label}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button className={ghostButtonClass} onClick={testSettings} disabled={isTestingSettings}>
              {isTestingSettings ? "测试中…" : "测试 STT"}
            </button>
            <button className={primaryButtonClass} onClick={saveSettings}>
              保存设置
            </button>
          </div>
        </header>

        {activeNav === "overview" && (
          <div className="grid gap-[34px] pt-7">
            <section className="grid grid-cols-[minmax(0,1.25fr)_minmax(240px,0.75fr)] items-end gap-6 border-b border-paper-line pb-5 max-[900px]:grid-cols-1">
              <div>
                <p className={kickerClass}>概览</p>
                <h3 className="mt-2.5 text-[clamp(1.7rem,2vw,2.15rem)] leading-none font-semibold tracking-[-0.06em]">
                  语音输入设置
                </h3>
                <p className="mt-2.5 max-w-[34ch] text-[0.96rem] text-paper-muted [line-height:1.65]">
                  当前配置概览。
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button className={primaryButtonClass} onClick={isRecording ? stopRecording : startRecording}>
                  {isRecording ? "停止录音" : "开始录音"}
                </button>
                <button className={ghostButtonClass} onClick={playLatest} disabled={isRecording}>
                  播放最新录音
                </button>
              </div>
            </section>

            <section className="grid grid-cols-3 gap-5 max-[900px]:grid-cols-1">
              <article className={statCardClass}>
                <span className={fieldLabelClass}>状态</span>
                <strong className="mt-3 block text-[1.25rem] font-semibold tracking-[-0.045em]">
                  {isRecording ? "录音中" : "空闲"}
                </strong>
                <small className="text-paper-muted">{sttStatus}</small>
              </article>
              <article className={statCardClass}>
                <span className={fieldLabelClass}>音频包</span>
                <strong className="mt-3 block text-[1.25rem] font-semibold tracking-[-0.045em]">
                  {chunkCount}
                </strong>
                <small className="text-paper-muted">当前会话音频包数</small>
              </article>
              <article className={statCardClass}>
                <span className={fieldLabelClass}>Pi 路由</span>
                <strong className="mt-3 block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
                  {piSettings.provider || localPi.default_provider || "未设置"}
                </strong>
                <small className="text-paper-muted">{piSettings.model || localPi.default_model || "选择模型"}</small>
              </article>
            </section>

            <section className={sectionClass}>
              <div className={sectionHeadClass}>
                <div>
                  <h3 className={sectionTitleClass}>当前状态</h3>
                  <p className={`mt-1.5 ${mutedClass}`}>当前配置。</p>
                </div>
              </div>

              <div className="grid gap-0">
                <div className={rowClass}>
                  <span className={mutedClass}>语音 API Key</span>
                  <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">
                    {sttSettings.has_api_key ? sttSettings.api_key_hint : "未配置"}
                  </strong>
                </div>
                <div className={rowClass}>
                  <span className={mutedClass}>语音模型</span>
                  <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">{sttSettings.model}</strong>
                </div>
                <div className={rowClass}>
                  <span className={mutedClass}>整理模式</span>
                  <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">{piSettings.mode}</strong>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3.5 max-[760px]:flex-col max-[760px]:items-start">
                  <span className={mutedClass}>复用进程</span>
                  <strong className="block text-[1.25rem] font-semibold tracking-[-0.045em]">
                    {piSettings.reuse_process ? "已开启" : "已关闭"}
                  </strong>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeNav === "speech" && (
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
                  {sttSettings.has_api_key && <small className={mutedClass}>已保存：{sttSettings.api_key_hint}</small>}
                </label>

                <label className={`${fieldClass} col-span-2 max-[900px]:col-span-1`}>
                  <span className={fieldLabelClass}>API Endpoint</span>
                  <input
                    className={inputClass}
                    type="text"
                    value={sttSettings.api_endpoint}
                    onChange={(event) => setSttSettings((prev) => ({ ...prev, api_endpoint: event.target.value }))}
                  />
                </label>

                <label className={fieldClass}>
                  <span className={fieldLabelClass}>模型</span>
                  <input
                    className={inputClass}
                    type="text"
                    value={sttSettings.model}
                    onChange={(event) => setSttSettings((prev) => ({ ...prev, model: event.target.value }))}
                  />
                </label>

                <label className={fieldClass}>
                  <span className={fieldLabelClass}>Workspace ID</span>
                  <input
                    className={inputClass}
                    type="text"
                    value={sttSettings.workspace_id}
                    onChange={(event) => setSttSettings((prev) => ({ ...prev, workspace_id: event.target.value }))}
                    placeholder="可选"
                  />
                </label>
              </div>
            </section>
          </div>
        )}

        {activeNav === "pi" && (
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
                    onChange={(event) => setPiSettings((prev) => ({ ...prev, mode: event.target.value }))}
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
                    onChange={(event) => setPiSettings((prev) => ({ ...prev, reuse_process: event.target.checked }))}
                  />
                </label>

                <label className={fieldClass}>
                  <span className={fieldLabelClass}>Provider</span>
                  <select
                    className={inputClass}
                    value={isManualProvider ? "" : piSettings.provider}
                    onChange={(event) => applyProviderFromLocal(event.target.value)}
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
                      onChange={(event) => setPiSettings((prev) => ({ ...prev, provider: event.target.value }))}
                      placeholder="例如：github-copilot"
                    />
                  )}
                </label>

                <label className={fieldClass}>
                  <span className={fieldLabelClass}>模型</span>
                  {selectedProvider && selectedProvider.models.length > 0 ? (
                    <select
                      className={inputClass}
                      value={selectedProvider.models.some((m) => m.id === piSettings.model) ? piSettings.model : ""}
                      onChange={(event) => setPiSettings((prev) => ({ ...prev, model: event.target.value || prev.model }))}
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
                      onChange={(event) => setPiSettings((prev) => ({ ...prev, model: event.target.value }))}
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
                    onChange={(event) =>
                      setPiSettings((prev) => ({ ...prev, prompt_template_key: event.target.value }))
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
                    onChange={(event) =>
                      setPiSettings((prev) => ({ ...prev, custom_prompt_template: event.target.value }))
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
                    onChange={(event) => setPiSettings((prev) => ({ ...prev, provider_json: event.target.value }))}
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
        )}

        {activeNav === "activity" && (
          <div className="grid gap-8 pt-7">
            <section className={sectionClass}>
              <div className={sectionHeadClass}>
                <div>
                  <h3 className={sectionTitleClass}>转写</h3>
                  <p className={`mt-1.5 ${mutedClass}`}>转写结果。</p>
                </div>
              </div>

              <div className="min-h-[180px] border-b border-paper-line bg-transparent pb-3">
                {finalTranscript.map((line, index) => (
                  <div key={`${line}-${index}`} className="mt-2 first:mt-0">
                    {line}
                  </div>
                ))}
                {partialTranscript && <div className="mt-2 text-paper-accent">{partialTranscript}</div>}
                {finalTranscript.length === 0 && !partialTranscript && (
                  <div className="text-paper-muted">暂无转写结果。</div>
                )}
              </div>
            </section>

            <section className={sectionClass}>
              <div className={sectionHeadClass}>
                <div>
                  <h3 className={sectionTitleClass}>活动日志</h3>
                  <p className={`mt-1.5 ${mutedClass}`}>{settingsStatus}</p>
                </div>
              </div>

              <div className="max-h-80 overflow-auto border-b border-paper-line bg-transparent pb-3 font-mono text-[0.88rem] [line-height:1.6]">
                {logs.map((line, index) => (
                  <div key={`${line}-${index}`} className="mt-2 first:mt-0">
                    {line}
                  </div>
                ))}
              </div>

              <div className="flex items-baseline justify-between gap-4 py-3.5 max-[760px]:flex-col max-[760px]:items-start">
                <span className={mutedClass}>最近音频包</span>
                <strong className="block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
                  {lastChunkInfo}
                </strong>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
