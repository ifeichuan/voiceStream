import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { WaveformAnimation } from "./components/WaveformAnimation";

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
  purpose: string;
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
  shortcuts: ShortcutSettingsView;
  local_pi: LocalPiConfigView;
}

interface ShortcutSettingsView {
  dictation_shortcut: string;
  agent_shortcut: string;
}

interface TimingEvent {
  session_id: number;
  stage: string;
  elapsed_ms: number;
  details: string;
}

interface AgentTaskEvent {
  timestamp_ms: number;
  kind: string;
  message: string;
}

interface AgentTask {
  id: string;
  title: string;
  transcript: string;
  status: "pending" | "running" | "completed" | "failed" | "interrupted" | "unknown";
  created_at_ms: number;
  updated_at_ms: number;
  session_path: string;
  events: AgentTaskEvent[];
  final_text: string;
  error_text: string;
}

interface AgentTaskUpdatedEvent {
  task: AgentTask;
}

interface AgentNotificationEvent {
  task_id: string;
  title: string;
  status: "completed" | "failed" | string;
  summary: string;
  display_text: string;
  spoken_text: string;
  channel: string;
  timestamp_ms: number;
}

interface AgentTerminalOutputEvent {
  task_id: string;
  data: number[];
}

interface AgentTerminalStatusEvent {
  task_id: string;
  status: string;
  message: string;
}

interface AgentSessionEntry {
  line: number;
  timestamp: string;
  entry_type: string;
  role: string;
  title: string;
  text: string;
  tool_name: string;
  is_error: boolean;
  raw: string;
}

interface AgentSessionView {
  task_id: string;
  session_path: string;
  resume_command: string;
  entries: AgentSessionEntry[];
  parse_errors: string[];
}

type NavKey = "overview" | "shortcuts" | "speech" | "pi" | "agent" | "activity";

const MAX_LOGS = 12;
const DEFAULT_SHORTCUT = "Cmd+Shift+Space";
const DEFAULT_AGENT_SHORTCUT = "Cmd+Shift+A";
const AGENT_TERMINAL_COLS = 104;
const AGENT_TERMINAL_ROWS = 36;
const AGENT_TERMINAL_BOTTOM_THRESHOLD = 24;
const MAX_AGENT_NOTIFICATIONS = 8;
const PI_MODES = [
  { value: "dictation-fast", label: "快速整理" },
  { value: "dictation-voice", label: "语音反馈" },
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
  { key: "shortcuts", label: "快捷键", meta: "全局" },
  { key: "speech", label: "语音识别", meta: "识别" },
  { key: "pi", label: "Pi", meta: "模型与映射" },
  { key: "agent", label: "Agent", meta: "任务" },
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
const shortcutDisplayClass =
  "min-h-11 border-b border-paper-line pt-2.5 pb-3 text-[1.12rem] font-semibold tracking-[-0.02em]";
const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);
const SUPPORTED_CODE_PATTERN =
  /^(Backquote|Backslash|BracketLeft|BracketRight|Pause|Comma|Digit[0-9]|Equal|Key[A-Z]|Minus|Period|Quote|Semicolon|Slash|Backspace|CapsLock|Enter|Space|Tab|Delete|End|Home|Insert|PageDown|PageUp|PrintScreen|ScrollLock|ArrowDown|ArrowLeft|ArrowRight|ArrowUp|NumLock|Numpad[0-9]|NumpadAdd|NumpadDecimal|NumpadDivide|NumpadEnter|NumpadEqual|NumpadMultiply|NumpadSubtract|Escape|F[1-9]|F1[0-9]|F2[0-4])$/;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizePiMode(mode: string) {
  return PI_MODES.some((option) => option.value === mode) ? mode : "dictation-fast";
}

function shortcutFromKeyboardEvent(event: KeyboardEvent) {
  if (MODIFIER_CODES.has(event.code)) {
    return { status: "继续按一个非修饰键。" };
  }

  if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    return { cancelled: true };
  }

  if (!SUPPORTED_CODE_PATTERN.test(event.code)) {
    return { status: "这个按键暂不支持，请换一个组合。" };
  }

  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push("Cmd");
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Option");
  if (event.shiftKey) modifiers.push("Shift");

  if (modifiers.length === 0) {
    return { status: "至少按住一个修饰键。" };
  }

  const key = event.code.startsWith("Key") ? event.code.slice(3) : event.code.startsWith("Digit") ? event.code.slice(5) : event.code;
  return { shortcut: [...modifiers, key].join("+") };
}

function statusLabel(status: AgentTask["status"]) {
  switch (status) {
    case "pending":
      return "等待中";
    case "running":
      return "执行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "interrupted":
      return "已中断";
    default:
      return "未知";
  }
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
    message: `Press ${DEFAULT_SHORTCUT} for dictation or ${DEFAULT_AGENT_SHORTCUT} for Agent`,
    shortcut: DEFAULT_SHORTCUT,
    purpose: "dictation",
  });
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [selectedAgentTaskId, setSelectedAgentTaskId] = useState<string>("");
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
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettingsView>({
    dictation_shortcut: DEFAULT_SHORTCUT,
    agent_shortcut: DEFAULT_AGENT_SHORTCUT,
  });
  const [isCapturingAgentShortcut, setIsCapturingAgentShortcut] = useState(false);
  const [shortcutCaptureStatus, setShortcutCaptureStatus] = useState("保存设置后生效。");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("未保存");
  const [isTestingSettings, setIsTestingSettings] = useState(false);
  const [agentSession, setAgentSession] = useState<AgentSessionView | null>(null);
  const [isAgentTerminalLoading, setIsAgentTerminalLoading] = useState(false);
  const [agentSessionStatus, setAgentSessionStatus] = useState("选择任务后读取本地 session。");
  const [agentTerminalStatus, setAgentTerminalStatus] = useState("选择任务后连接终端。");
  const [activeTerminalTaskId, setActiveTerminalTaskId] = useState("");
  const [terminalResetKey, setTerminalResetKey] = useState(0);
  const [isAgentTerminalAtBottom, setIsAgentTerminalAtBottom] = useState(true);
  const [hasAgentTerminalPendingOutput, setHasAgentTerminalPendingOutput] = useState(false);
  const [isAgentDetailOpen, setIsAgentDetailOpen] = useState(false);
  const [agentNotifications, setAgentNotifications] = useState<AgentNotificationEvent[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const terminal = useTerminal();
  const terminalWriteRef = useRef(terminal.write);
  const terminalFocusRef = useRef(terminal.focus);
  const terminalShellRef = useRef<HTMLDivElement | null>(null);
  const agentTerminalAtBottomRef = useRef(true);
  const agentTerminalReadyRef = useRef(false);
  const pendingAgentTerminalOutputRef = useRef<Uint8Array[]>([]);
  const agentTerminalLoadTimeoutRef = useRef<number | null>(null);
  const selectedAgentTaskIdRef = useRef("");

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

  const selectedAgentTask = useMemo(
    () => agentTasks.find((task) => task.id === selectedAgentTaskId) ?? agentTasks[0],
    [agentTasks, selectedAgentTaskId],
  );
  const terminalLineCount = agentSession?.entries.length ?? 0;
  const selectedAgentTaskStatus = selectedAgentTask ? statusLabel(selectedAgentTask.status) : "未选择";
  const selectedAgentTaskStatusText = selectedAgentTask
    ? `${selectedAgentTaskStatus} · ${activeTerminalTaskId === selectedAgentTask.id ? agentTerminalStatus : "终端未连接"}`
    : "选择任务后连接终端。";
  const shouldShowAgentTerminalJumpButton =
    Boolean(selectedAgentTask) &&
    !isAgentTerminalLoading &&
    (!isAgentTerminalAtBottom || hasAgentTerminalPendingOutput);

  const clearAgentTerminalLoadTimeout = useCallback(() => {
    if (agentTerminalLoadTimeoutRef.current === null) return;
    window.clearTimeout(agentTerminalLoadTimeoutRef.current);
    agentTerminalLoadTimeoutRef.current = null;
  }, []);

  const beginAgentTerminalLoading = useCallback((waitingMessage: string) => {
    clearAgentTerminalLoadTimeout();
    agentTerminalReadyRef.current = false;
    pendingAgentTerminalOutputRef.current = [];
    setIsAgentTerminalLoading(true);

    agentTerminalLoadTimeoutRef.current = window.setTimeout(() => {
      setAgentTerminalStatus(waitingMessage);
    }, 8000);
  }, [clearAgentTerminalLoadTimeout]);

  const finishAgentTerminalLoading = useCallback(() => {
    clearAgentTerminalLoadTimeout();
    setIsAgentTerminalLoading(false);
  }, [clearAgentTerminalLoadTimeout]);

  const getAgentTerminalNode = useCallback(
    () => terminalShellRef.current?.querySelector<HTMLElement>(".agent-terminal.wterm") ?? null,
    [],
  );

  const isAgentTerminalNearBottom = useCallback(() => {
    const terminalNode = getAgentTerminalNode();
    if (!terminalNode) return true;
    const distanceToBottom =
      terminalNode.scrollHeight - terminalNode.scrollTop - terminalNode.clientHeight;
    return distanceToBottom <= AGENT_TERMINAL_BOTTOM_THRESHOLD;
  }, [getAgentTerminalNode]);

  const syncAgentTerminalScrollState = useCallback(() => {
    const isAtBottom = isAgentTerminalNearBottom();
    agentTerminalAtBottomRef.current = isAtBottom;
    setIsAgentTerminalAtBottom(isAtBottom);
    if (isAtBottom) {
      setHasAgentTerminalPendingOutput(false);
    }
  }, [isAgentTerminalNearBottom]);

  const resetAgentTerminalView = useCallback(() => {
    setTerminalResetKey((prev) => prev + 1);
    agentTerminalReadyRef.current = false;
    pendingAgentTerminalOutputRef.current = [];
    agentTerminalAtBottomRef.current = true;
    setIsAgentTerminalAtBottom(true);
    setHasAgentTerminalPendingOutput(false);
    terminalWriteRef.current("\x1b[3J\x1b[H\x1b[2J");
  }, []);

  const scrollAgentTerminalToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const terminalNode = getAgentTerminalNode();
        if (!terminalNode) return;
        terminalNode.scrollTop = terminalNode.scrollHeight;
        agentTerminalAtBottomRef.current = true;
        setIsAgentTerminalAtBottom(true);
        setHasAgentTerminalPendingOutput(false);
      });
    });
  }, [getAgentTerminalNode]);

  const followAgentTerminalIfPinned = useCallback(() => {
    if (agentTerminalAtBottomRef.current) {
      scrollAgentTerminalToBottom();
      return;
    }

    setHasAgentTerminalPendingOutput(true);
  }, [scrollAgentTerminalToBottom]);

  const flushPendingAgentTerminalOutput = useCallback(() => {
    if (!agentTerminalReadyRef.current || pendingAgentTerminalOutputRef.current.length === 0) {
      return false;
    }

    for (const chunk of pendingAgentTerminalOutputRef.current) {
      terminalWriteRef.current(chunk);
    }
    pendingAgentTerminalOutputRef.current = [];
    finishAgentTerminalLoading();
    scrollAgentTerminalToBottom();
    return true;
  }, [finishAgentTerminalLoading, scrollAgentTerminalToBottom]);

  useEffect(() => {
    selectedAgentTaskIdRef.current = selectedAgentTask?.id ?? "";
  }, [selectedAgentTask?.id]);

  useEffect(() => {
    terminalWriteRef.current = terminal.write;
    terminalFocusRef.current = terminal.focus;
  }, [terminal.write, terminal.focus]);

  useEffect(() => {
    if (!isCapturingAgentShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const result = shortcutFromKeyboardEvent(event);
      if (result.cancelled) {
        setIsCapturingAgentShortcut(false);
        setShortcutCaptureStatus("已取消设置。");
        return;
      }

      if (result.shortcut) {
        setShortcutSettings((prev) => ({ ...prev, agent_shortcut: result.shortcut ?? prev.agent_shortcut }));
        setIsCapturingAgentShortcut(false);
        setShortcutCaptureStatus("已捕获，保存设置后生效。");
        return;
      }

      setShortcutCaptureStatus(result.status ?? "继续按快捷键。");
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isCapturingAgentShortcut]);

  useEffect(() => {
    if (!isAgentDetailOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAgentDetailOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAgentDetailOpen]);

  useEffect(() => {
    let unlistenAudio: (() => void) | undefined;
    let unlistenStt: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenHotkey: (() => void) | undefined;
    let unlistenTiming: (() => void) | undefined;
    let unlistenAgentTask: (() => void) | undefined;
    let unlistenAgentNotification: (() => void) | undefined;
    let unlistenAgentTerminalOutput: (() => void) | undefined;
    let unlistenAgentTerminalStatus: (() => void) | undefined;

    addLog("Ready");

    void invoke<AgentTask[]>("get_agent_tasks")
      .then((tasks) => {
        setAgentTasks(tasks);
        setSelectedAgentTaskId((prev) => {
          const next = prev || tasks[0]?.id || "";
          selectedAgentTaskIdRef.current = next;
          return next;
        });
      })
      .catch((error) => addLog(`Load agent tasks failed: ${getErrorMessage(error)}`));

    void invoke<AppSettingsView>("get_app_settings")
      .then((settings) => {
        setSttSettings(settings.stt);
        setPiSettings({ ...settings.pi, mode: normalizePiMode(settings.pi.mode) });
        setShortcutSettings(settings.shortcuts);
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

    void listen<AgentTaskUpdatedEvent>("agent-task-updated", (event) => {
      const task = event.payload.task;
      setAgentTasks((prev) => {
        const rest = prev.filter((item) => item.id !== task.id);
        return [task, ...rest].sort((a, b) => b.created_at_ms - a.created_at_ms);
      });
      setSelectedAgentTaskId((prev) => {
        if (prev) return prev;
        selectedAgentTaskIdRef.current = task.id;
        return task.id;
      });
      addLog(`Agent ${task.status}: ${task.title}`);
    }).then((dispose) => {
      unlistenAgentTask = dispose;
    });

    void listen<AgentNotificationEvent>("agent-notification", (event) => {
      const notification = event.payload;
      setAgentNotifications((prev) =>
        [notification, ...prev.filter((item) => item.task_id !== notification.task_id)]
          .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
          .slice(0, MAX_AGENT_NOTIFICATIONS),
      );
      addLog(`Notify ${notification.status}: ${notification.display_text}`);
    }).then((dispose) => {
      unlistenAgentNotification = dispose;
    });

    void listen<AgentTerminalOutputEvent>("agent-terminal-output", (event) => {
      const { task_id, data } = event.payload;
      if (task_id !== selectedAgentTaskIdRef.current) return;
      const shouldFollowOutput = agentTerminalAtBottomRef.current;
      const chunk = new Uint8Array(data);
      if (agentTerminalReadyRef.current) {
        terminalWriteRef.current(chunk);
        finishAgentTerminalLoading();
      } else {
        pendingAgentTerminalOutputRef.current.push(chunk);
      }
      if (shouldFollowOutput) {
        scrollAgentTerminalToBottom();
      } else {
        setHasAgentTerminalPendingOutput(true);
      }
    }).then((dispose) => {
      unlistenAgentTerminalOutput = dispose;
    });

    void listen<AgentTerminalStatusEvent>("agent-terminal-status", (event) => {
      const { task_id, status, message } = event.payload;
      if (task_id !== selectedAgentTaskIdRef.current) return;
      setAgentTerminalStatus(message || status);
    }).then((dispose) => {
      unlistenAgentTerminalStatus = dispose;
    });

    return () => {
      clearAgentTerminalLoadTimeout();
      unlistenAudio?.();
      unlistenStt?.();
      unlistenStatus?.();
      unlistenHotkey?.();
      unlistenTiming?.();
      unlistenAgentTask?.();
      unlistenAgentNotification?.();
      unlistenAgentTerminalOutput?.();
      unlistenAgentTerminalStatus?.();
    };
  }, [clearAgentTerminalLoadTimeout, finishAgentTerminalLoading, scrollAgentTerminalToBottom]);

  useEffect(() => {
    if (activeNav !== "agent") {
      finishAgentTerminalLoading();
      setActiveTerminalTaskId("");
      setAgentTerminalStatus("切换到 Agent 后连接终端。");
      return;
    }

    if (!selectedAgentTask?.id) {
      setAgentSession(null);
      finishAgentTerminalLoading();
      setAgentSessionStatus("选择任务后读取本地 session。");
      setAgentTerminalStatus("选择任务后连接终端。");
      setActiveTerminalTaskId("");
      resetAgentTerminalView();
      return;
    }

    let cancelled = false;
    const taskId = selectedAgentTask.id;
    setAgentSession(null);
    setAgentSessionStatus("正在读取 session...");
    setAgentTerminalStatus("正在连接 PTY...");
    setActiveTerminalTaskId(taskId);
    resetAgentTerminalView();
    beginAgentTerminalLoading("PTY 已连接，正在等待终端输出...");

    void invoke<void>("start_agent_terminal", {
      taskId,
      cols: AGENT_TERMINAL_COLS,
      rows: AGENT_TERMINAL_ROWS,
    })
      .then(() => {
        if (cancelled) return;
        setAgentTerminalStatus("PTY 已连接。");
        terminalFocusRef.current();
        scrollAgentTerminalToBottom();
      })
      .catch((error) => {
        if (cancelled) return;
        finishAgentTerminalLoading();
        setAgentTerminalStatus(`PTY 连接失败：${getErrorMessage(error)}`);
      });

    void invoke<AgentSessionView>("get_agent_session", { taskId })
      .then((session) => {
        if (cancelled) return;
        setAgentSession(session);
        setAgentSessionStatus(
          session.entries.length > 0
            ? `已读取 ${session.entries.length} 条 JSONL 记录。`
            : "这个 session 文件还没有可渲染内容。",
        );
        scrollAgentTerminalToBottom();
      })
      .catch((error) => {
        if (cancelled) return;
        setAgentSession(null);
        finishAgentTerminalLoading();
        setAgentSessionStatus(`读取 session 失败：${getErrorMessage(error)}`);
      });

    return () => {
      cancelled = true;
      void invoke("stop_agent_terminal", { taskId });
    };
  }, [
    activeNav,
    beginAgentTerminalLoading,
    finishAgentTerminalLoading,
    resetAgentTerminalView,
    scrollAgentTerminalToBottom,
    selectedAgentTask?.id,
  ]);

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
      setSttSettings(saved.stt);
      setPiSettings({ ...saved.pi, mode: normalizePiMode(saved.pi.mode) });
      setShortcutSettings(saved.shortcuts);
      setIsCapturingAgentShortcut(false);
      setShortcutCaptureStatus("快捷键已保存并生效。");
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

  const refreshAgentSession = async () => {
    if (!selectedAgentTask) return;

    const taskId = selectedAgentTask.id;
    setAgentSession(null);
    setAgentSessionStatus("正在刷新 session...");
    setAgentTerminalStatus("正在重新连接 PTY...");
    setActiveTerminalTaskId(taskId);
    resetAgentTerminalView();
    beginAgentTerminalLoading("PTY 已连接，正在等待终端输出...");
    try {
      await invoke<void>("start_agent_terminal", {
        taskId,
        cols: AGENT_TERMINAL_COLS,
        rows: AGENT_TERMINAL_ROWS,
      });
      if (selectedAgentTaskIdRef.current !== taskId) return;
      setAgentTerminalStatus("PTY 已连接。");
      terminalFocusRef.current();
      scrollAgentTerminalToBottom();

      const session = await invoke<AgentSessionView>("get_agent_session", { taskId });
      if (selectedAgentTaskIdRef.current !== taskId) return;
      setAgentSession(session);
      setAgentSessionStatus(
        session.entries.length > 0
          ? `已读取 ${session.entries.length} 条 JSONL 记录。`
          : "这个 session 文件还没有可渲染内容。",
      );
      scrollAgentTerminalToBottom();
    } catch (error) {
      if (selectedAgentTaskIdRef.current !== taskId) return;
      finishAgentTerminalLoading();
      setAgentSessionStatus(`刷新 session 失败：${getErrorMessage(error)}`);
      setAgentTerminalStatus(`PTY 连接失败：${getErrorMessage(error)}`);
    }
  };

  const copyResumeCommand = async () => {
    if (!agentSession?.resume_command) return;
    try {
      await navigator.clipboard.writeText(agentSession.resume_command);
      setAgentSessionStatus("已复制恢复指令。");
    } catch (error) {
      setAgentSessionStatus(`复制失败：${getErrorMessage(error)}`);
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
  const formatTaskTime = (timestamp: number) =>
    timestamp ? new Date(timestamp).toLocaleString() : "未知时间";

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
              onClick={() => {
                if (item.key === "agent" && activeNav === "agent") {
                  void refreshAgentSession();
                  return;
                }
                setActiveNav(item.key);
              }}
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
            <strong className="block text-[0.95rem] font-semibold">快捷键</strong>
            <p className="mt-1 text-paper-muted [line-height:1.45]">
              听写 {shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT}
              <br />
              Agent {shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT}
            </p>
          </div>
        </div>
      </aside>

      <section
        className={[
          "flex h-screen flex-col overflow-x-hidden bg-paper-surface px-[42px] max-[760px]:px-[22px]",
          activeNav === "agent"
            ? "overflow-hidden pb-0"
            : "overflow-y-auto pb-[52px] [scrollbar-gutter:stable] max-[760px]:pb-10",
        ].join(" ")}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-paper-line bg-[color-mix(in_oklch,var(--color-paper-surface)_94%,white_6%)] py-[18px] pt-7 max-[760px]:flex-col max-[760px]:items-start">
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

        {activeNav === "shortcuts" && (
          <div className="grid gap-[34px] pt-7">
            <section className={sectionClass}>
              <div className={sectionHeadClass}>
                <div>
                  <h3 className={sectionTitleClass}>全局快捷键</h3>
                  <p className={`mt-1.5 ${mutedClass}`}>Agent 任务入口。</p>
                </div>
              </div>

              <div className={formGridClass}>
                <label className={fieldClass}>
                  <span className={fieldLabelClass}>听写快捷键</span>
                  <span className={shortcutDisplayClass}>{shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT}</span>
                  <small className={mutedClass}>当前版本固定为听写入口。</small>
                </label>

                <div className={fieldClass}>
                  <span className={fieldLabelClass}>Agent 快捷键</span>
                  <button
                    className={[
                      "min-h-11 border-b px-0 pt-2.5 pb-3 text-left text-[1.12rem] font-semibold tracking-[-0.02em] transition duration-150",
                      isCapturingAgentShortcut
                        ? "border-paper-accent text-paper-accent"
                        : "border-paper-line text-paper-ink hover:border-paper-accent",
                    ].join(" ")}
                    type="button"
                    onClick={() => {
                      setIsCapturingAgentShortcut(true);
                      setShortcutCaptureStatus("请按下新的 Agent 快捷键，Esc 取消。");
                    }}
                  >
                    {isCapturingAgentShortcut
                      ? "正在等待按键..."
                      : shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT}
                  </button>
                  <small className={mutedClass}>{shortcutCaptureStatus}</small>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={() => {
                    setIsCapturingAgentShortcut(true);
                    setShortcutCaptureStatus("请按下新的 Agent 快捷键，Esc 取消。");
                  }}
                >
                  {isCapturingAgentShortcut ? "等待按键" : "开始设置"}
                </button>
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => {
                    setIsCapturingAgentShortcut(false);
                    setShortcutCaptureStatus("已取消设置。");
                  }}
                  disabled={!isCapturingAgentShortcut}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => {
                    setIsCapturingAgentShortcut(false);
                    setShortcutSettings((prev) => ({ ...prev, agent_shortcut: DEFAULT_AGENT_SHORTCUT }));
                    setShortcutCaptureStatus("已恢复默认，保存设置后生效。");
                  }}
                >
                  恢复默认
                </button>
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

        {activeNav === "agent" && (
          <div className="grid min-h-0 flex-1 gap-[24px] pt-7 pb-7">
            <section className="grid h-full min-h-0 grid-cols-[minmax(250px,0.36fr)_minmax(0,1fr)] gap-8 max-[960px]:grid-cols-1 max-[960px]:grid-rows-[minmax(128px,0.34fr)_minmax(280px,1fr)]">
              <div className="flex min-h-0 flex-col border-b border-paper-line pb-7">
                <div className={sectionHeadClass}>
                  <div>
                    <h3 className={sectionTitleClass}>Agent 任务</h3>
                    <p className={`mt-1.5 ${mutedClass}`}>
                      {agentTasks.length ? `${agentTasks.length} 个任务` : `按 ${shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT} 创建任务`}
                    </p>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 content-start gap-2 overflow-auto pr-1">
                  {agentTasks.length === 0 && (
                    <div className="border-b border-paper-line py-4 text-paper-muted">暂无 Agent 任务。</div>
                  )}
                  {agentTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={[
                        "grid w-full gap-2 border-b border-paper-line bg-transparent py-3.5 text-left transition duration-150 hover:text-paper-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-accent",
                        selectedAgentTask?.id === task.id ? "text-paper-accent" : "",
                      ].join(" ")}
                      onClick={() => {
                        selectedAgentTaskIdRef.current = task.id;
                        setSelectedAgentTaskId(task.id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <strong className="min-w-0 break-words text-[0.95rem] font-semibold [line-height:1.35]">{task.title}</strong>
                        <span className="shrink-0 text-[0.75rem] text-paper-muted">{statusLabel(task.status)}</span>
                      </div>
                      <small className="text-[0.75rem] text-paper-muted">{formatTaskTime(task.created_at_ms)}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-paper-line pb-7">
                <div className={`${sectionHeadClass} max-[760px]:flex-col max-[760px]:items-start`}>
                  <div className="min-w-0">
                    <h3 className="max-w-[72ch] truncate text-base font-semibold tracking-[-0.03em]">
                      {selectedAgentTask?.title || "会话"}
                    </h3>
                    <p className={`mt-1.5 ${mutedClass}`}>{selectedAgentTaskStatusText}</p>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    <button className={ghostButtonClass} type="button" onClick={refreshAgentSession} disabled={!selectedAgentTask}>
                      刷新
                    </button>
                    <button className={ghostButtonClass} type="button" onClick={() => setIsAgentDetailOpen(true)} disabled={!selectedAgentTask}>
                      详情
                    </button>
                  </div>
                </div>

                {!selectedAgentTask && <div className="text-paper-muted">选择一个任务查看会话。</div>}
                {selectedAgentTask && (
                  <div ref={terminalShellRef} className="relative min-h-0 flex-1 overflow-hidden">
                    <Terminal
                      key={`${selectedAgentTask.id}-${terminalResetKey}`}
                      ref={terminal.ref}
                      className="agent-terminal"
                      cols={AGENT_TERMINAL_COLS}
                      rows={AGENT_TERMINAL_ROWS}
                      cursorBlink
                      onData={(data) => {
                        if (!selectedAgentTask?.id) return;
                        void invoke("write_agent_terminal", {
                          taskId: selectedAgentTask.id,
                          data,
                        }).catch((error) => {
                          setAgentTerminalStatus(`写入失败：${getErrorMessage(error)}`);
                        });
                        followAgentTerminalIfPinned();
                      }}
                      onResize={(cols, rows) => {
                        if (!selectedAgentTask?.id) return;
                        void invoke("resize_agent_terminal", {
                          taskId: selectedAgentTask.id,
                          cols,
                          rows,
                        }).catch((error) => {
                          setAgentTerminalStatus(`调整终端尺寸失败：${getErrorMessage(error)}`);
                        });
                        followAgentTerminalIfPinned();
                      }}
                      onReady={() => {
                        agentTerminalReadyRef.current = true;
                        flushPendingAgentTerminalOutput();
                        terminalFocusRef.current();
                        scrollAgentTerminalToBottom();
                      }}
                      onScroll={syncAgentTerminalScrollState}
                      onError={(error) => {
                        finishAgentTerminalLoading();
                        setAgentTerminalStatus(`终端初始化失败：${getErrorMessage(error)}`);
                      }}
                    />
                    {isAgentTerminalLoading && (
                      <div
                        className="absolute inset-px z-10 grid place-items-center bg-[color-mix(in_oklch,var(--color-paper-surface)_72%,transparent)]"
                        role="status"
                        aria-live="polite"
                        aria-label="正在加载 Agent 会话"
                      >
                        <WaveformAnimation />
                      </div>
                    )}
                    {shouldShowAgentTerminalJumpButton && (
                      <button
                        type="button"
                        aria-label={hasAgentTerminalPendingOutput ? "有新输出，滚动到底部" : "滚动到底部"}
                        className="absolute bottom-6 left-1/2 z-10 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full border border-paper-line bg-paper-surface text-lg font-semibold text-paper-accent shadow-[0_12px_32px_color-mix(in_oklch,var(--color-paper-ink)_14%,transparent)] transition-[opacity,transform] duration-150 hover:-translate-y-0.5 active:scale-[0.96]"
                        onClick={scrollAgentTerminalToBottom}
                      >
                        <span aria-hidden="true" className="leading-none">↓</span>
                        {hasAgentTerminalPendingOutput && (
                          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-paper-accent" />
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {isAgentDetailOpen && selectedAgentTask && (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--color-paper-ink)_16%,transparent)] px-5 py-6"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setIsAgentDetailOpen(false);
                }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="agent-detail-title"
                  className="max-h-[min(760px,calc(100vh-48px))] w-[min(900px,calc(100vw-40px))] overflow-auto border border-paper-line bg-paper-surface px-6 py-5 shadow-[0_24px_80px_color-mix(in_oklch,var(--color-paper-ink)_18%,transparent)]"
                >
                  <div className="flex items-start justify-between gap-5 border-b border-paper-line pb-4">
                    <div className="min-w-0">
                      <h3 id="agent-detail-title" className="truncate text-base font-semibold tracking-[-0.03em]">
                        {selectedAgentTask.title}
                      </h3>
                      <p className={`mt-1.5 ${mutedClass}`}>{agentSessionStatus}</p>
                    </div>
                    <button className={ghostButtonClass} type="button" onClick={() => setIsAgentDetailOpen(false)}>
                      关闭
                    </button>
                  </div>

                  <div className="grid gap-7 py-5">
                    <div className="grid grid-cols-3 gap-5 max-[760px]:grid-cols-1">
                      <div className={metaCardClass}>
                        <span className={fieldLabelClass}>状态</span>
                        <strong className="mt-2 block text-[0.95rem] font-semibold">{selectedAgentTaskStatus}</strong>
                      </div>
                      <div className={metaCardClass}>
                        <span className={fieldLabelClass}>JSONL</span>
                        <strong className="mt-2 block text-[0.95rem] font-semibold">{terminalLineCount}</strong>
                      </div>
                      <div className={metaCardClass}>
                        <span className={fieldLabelClass}>事件</span>
                        <strong className="mt-2 block text-[0.95rem] font-semibold">{selectedAgentTask.events.length}</strong>
                      </div>
                    </div>

                    <section className="border-b border-paper-line pb-5">
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <span className={fieldLabelClass}>恢复指令</span>
                        <button className={ghostButtonClass} type="button" onClick={copyResumeCommand} disabled={!agentSession?.resume_command}>
                          复制
                        </button>
                      </div>
                      <code className="block break-all font-mono text-[0.8rem] text-paper-muted [line-height:1.6]">
                        {agentSession?.resume_command || "pi --session <session-path>"}
                      </code>
                    </section>

                    <section className="border-b border-paper-line pb-5">
                      <span className={fieldLabelClass}>任务输入</span>
                      <p className="mt-3 whitespace-pre-wrap text-[0.9rem] text-paper-muted [line-height:1.65]">
                        {selectedAgentTask.transcript}
                      </p>
                    </section>

                    <section className="border-b border-paper-line pb-5">
                      <span className={fieldLabelClass}>执行日志</span>
                      <div className="mt-3 max-h-64 overflow-auto font-mono text-[0.78rem] text-paper-muted [line-height:1.6]">
                        {selectedAgentTask.events.length === 0 && <div>暂无事件。</div>}
                        {selectedAgentTask.events.map((event, index) => (
                          <div key={`${event.timestamp_ms}-${event.kind}-${index}`} className="border-b border-paper-line py-2 first:pt-0">
                            <span>{new Date(event.timestamp_ms).toLocaleTimeString()}</span>{" "}
                            <strong>{event.kind}</strong> · {event.message}
                          </div>
                        ))}
                      </div>
                    </section>

                    {agentSession?.parse_errors.length ? (
                      <section className="border-b border-paper-line pb-5">
                        <span className={fieldLabelClass}>解析失败</span>
                        <div className="mt-3 grid gap-2 font-mono text-[0.78rem] text-[oklch(0.56_0.2_28)]">
                          {agentSession.parse_errors.map((error, index) => (
                            <div key={`${error}-${index}`}>{error}</div>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {selectedAgentTask.error_text && (
                      <section className="border-b border-paper-line pb-5">
                        <span className={fieldLabelClass}>错误</span>
                        <div className="mt-3 whitespace-pre-wrap text-[0.86rem] text-[oklch(0.56_0.2_28)] [line-height:1.65]">
                          {selectedAgentTask.error_text}
                        </div>
                      </section>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {activeNav === "activity" && (
          <div className="grid gap-8 pt-7">
            <section className={sectionClass}>
              <div className={sectionHeadClass}>
                <div>
                  <h3 className={sectionTitleClass}>Notify Channel</h3>
                  <p className={`mt-1.5 ${mutedClass}`}>VoiceStream 语音通知。</p>
                </div>
              </div>

              <div className="grid gap-3 border-b border-paper-line pb-3">
                {agentNotifications.length === 0 && (
                  <div className="text-paper-muted">暂无通知。</div>
                )}
                {agentNotifications.map((notification) => (
                  <div
                    key={`${notification.task_id}-${notification.timestamp_ms}`}
                    className="grid gap-1 border-b border-paper-line py-3 first:pt-0 last:border-b-0"
                  >
                    <div className="flex items-baseline justify-between gap-4 max-[760px]:flex-col max-[760px]:items-start">
                      <strong className="text-[0.95rem] font-semibold">
                        {notification.status === "failed" ? "失败" : "完成"} · {notification.title}
                      </strong>
                      <span className="shrink-0 text-[0.75rem] text-paper-muted">
                        {new Date(notification.timestamp_ms).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="m-0 text-[0.86rem] text-paper-muted [line-height:1.55]">
                      {notification.summary}
                    </p>
                    <small className="text-[0.75rem] text-paper-muted">
                      {notification.channel} · {notification.spoken_text}
                    </small>
                  </div>
                ))}
              </div>
            </section>

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
