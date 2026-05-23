import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { getErrorMessage, normalizePiMode } from "../lib/utils";
import { useLogsStore } from "./logs";
import type {
  SttSettingsView,
  SttProviderMeta,
  PiSettingsView,
  ShortcutSettingsView,
  LocalPiConfigView,
  AppSettingsView,
} from "../types";

interface SettingsState {
  sttSettings: SttSettingsView;
  sttProviders: SttProviderMeta[];
  piSettings: PiSettingsView;
  shortcutSettings: ShortcutSettingsView;
  localPi: LocalPiConfigView;
  apiKeyInput: string;
  settingsStatus: string;
  isTestingSettings: boolean;

  setSttSettings: (fn: (prev: SttSettingsView) => SttSettingsView) => void;
  setPiSettings: (fn: (prev: PiSettingsView) => PiSettingsView) => void;
  setShortcutSettings: (fn: (prev: ShortcutSettingsView) => ShortcutSettingsView) => void;
  setLocalPi: (v: LocalPiConfigView) => void;
  setApiKeyInput: (v: string) => void;
  setSettingsStatus: (v: string) => void;

  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  testSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  sttSettings: {
    provider: "aliyun-bailian",
    api_endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    model: "fun-asr-realtime",
    workspace_id: "",
    language: "",
    sample_rate: 16000,
    extra_config: "",
    has_api_key: false,
    api_key_hint: "",
  },
  sttProviders: [],
  piSettings: {
    mode: "dictation-fast",
    provider: "",
    model: "",
    reuse_process: true,
    prompt_template_key: "default",
    custom_prompt_template: "",
    provider_json: "",
  },
  shortcutSettings: {
    dictation_shortcut: DEFAULT_SHORTCUT,
    agent_shortcut: DEFAULT_AGENT_SHORTCUT,
  },
  localPi: {
    settings_path: "",
    models_path: "",
    default_provider: "",
    default_model: "",
    providers: [],
    raw_settings_json: "",
    raw_models_json: "",
  },
  apiKeyInput: "",
  settingsStatus: "未保存",
  isTestingSettings: false,

  setSttSettings: (fn) => set((s) => ({ sttSettings: fn(s.sttSettings) })),
  setPiSettings: (fn) => set((s) => ({ piSettings: fn(s.piSettings) })),
  setShortcutSettings: (fn) => set((s) => ({ shortcutSettings: fn(s.shortcutSettings) })),
  setLocalPi: (v) => set({ localPi: v }),
  setApiKeyInput: (v) => set({ apiKeyInput: v }),
  setSettingsStatus: (v) => set({ settingsStatus: v }),

  loadSettings: async () => {
    const addLog = useLogsStore.getState().addLog;
    try {
      const [settings, providers] = await Promise.all([
        invoke<AppSettingsView>("get_app_settings"),
        invoke<SttProviderMeta[]>("get_stt_providers"),
      ]);
      set({
        sttSettings: settings.stt,
        sttProviders: providers,
        piSettings: { ...settings.pi, mode: normalizePiMode(settings.pi.mode) },
        shortcutSettings: settings.shortcuts,
        localPi: settings.local_pi,
        settingsStatus: settings.stt.has_api_key ? "已保存到本地" : "未配置 API Key",
      });
    } catch (error) {
      addLog(`Load settings failed: ${getErrorMessage(error)}`);
    }
  },

  saveSettings: async () => {
    const addLog = useLogsStore.getState().addLog;
    const { sttSettings, piSettings, shortcutSettings, apiKeyInput } = get();
    try {
      const saved = await invoke<AppSettingsView>("save_app_settings", {
        settings: {
          stt: {
            provider: sttSettings.provider,
            api_key: apiKeyInput,
            api_endpoint: sttSettings.api_endpoint,
            model: sttSettings.model,
            workspace_id: sttSettings.workspace_id,
            language: sttSettings.language,
            sample_rate: sttSettings.sample_rate || null,
            extra_config: sttSettings.extra_config,
          },
          pi: {
            mode: normalizePiMode(piSettings.mode),
            provider: piSettings.provider,
            model: piSettings.model,
            reuse_process: piSettings.reuse_process,
            prompt_template_key: piSettings.prompt_template_key,
            custom_prompt_template: piSettings.custom_prompt_template,
            provider_json: piSettings.provider_json,
          },
          shortcuts: {
            agent_shortcut: shortcutSettings.agent_shortcut,
          },
        },
      });
      set({
        sttSettings: saved.stt,
        piSettings: { ...saved.pi, mode: normalizePiMode(saved.pi.mode) },
        shortcutSettings: saved.shortcuts,
        localPi: saved.local_pi,
        apiKeyInput: "",
        settingsStatus: "已保存到本地",
      });
      addLog("设置已保存");
    } catch (error) {
      const message = getErrorMessage(error);
      set({ settingsStatus: `保存失败：${message}` });
      addLog(`保存设置失败：${message}`);
    }
  },

  testSettings: async () => {
    const addLog = useLogsStore.getState().addLog;
    const { sttSettings, apiKeyInput } = get();
    set({ isTestingSettings: true, settingsStatus: "正在测试 STT 连接..." });
    try {
      const message = await invoke<string>("test_stt_settings", {
        settings: {
          provider: sttSettings.provider,
          api_key: apiKeyInput,
          api_endpoint: sttSettings.api_endpoint,
          model: sttSettings.model,
          workspace_id: sttSettings.workspace_id,
          language: sttSettings.language,
          sample_rate: sttSettings.sample_rate || null,
          extra_config: sttSettings.extra_config,
        },
      });
      set({ settingsStatus: message });
      addLog(message);
    } catch (error) {
      const message = getErrorMessage(error);
      set({ settingsStatus: `测试失败：${message}` });
      addLog(`测试设置失败：${message}`);
    } finally {
      set({ isTestingSettings: false });
    }
  },
}));
