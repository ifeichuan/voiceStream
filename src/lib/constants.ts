export const MAX_LOGS = 12;
export const DEFAULT_SHORTCUT = "Cmd+Shift+Space";
export const DEFAULT_AGENT_SHORTCUT = "Cmd+Shift+A";
export const MAX_AGENT_NOTIFICATIONS = 8;
export const AGENT_TERMINAL_COLS = 104;
export const AGENT_TERMINAL_ROWS = 36;
export const AGENT_TERMINAL_BOTTOM_THRESHOLD = 24;

export const PI_MODES = [
  { value: "dictation-fast", label: "快速整理" },
] as const;

export const THINKING_LEVELS = [
  { value: "", label: "默认（模型自身）" },
  { value: "off", label: "关闭" },
  { value: "minimal", label: "最低" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "最高" },
] as const;

export const PROMPT_TEMPLATES = [
  { value: "default", label: "默认 · 最小整理" },
  { value: "light", label: "轻量 · 轻修正" },
  { value: "structured", label: "结构化 · 轻结构化" },
  { value: "official-lite", label: "官方感 · 简洁清晰" },
  { value: "list-friendly", label: "列表友好 · 1. 2. 3." },
  { value: "typeless", label: "Typeless · 英文风格" },
] as const;

export const NAV_ITEMS = [
  { key: "overview", label: "概览", meta: "总览", path: "/", icon: "◉" },
  { key: "shortcuts", label: "快捷键", meta: "全局", path: "/shortcuts", icon: "⌘" },
  { key: "speech", label: "语音识别", meta: "识别", path: "/speech", icon: "◗" },
  { key: "pi", label: "Pi", meta: "模型与映射", path: "/pi", icon: "π" },
  { key: "agent", label: "Agent", meta: "任务", path: "/agent", icon: "▷" },
  { key: "activity", label: "活动", meta: "日志", path: "/activity", icon: "≡" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

export const SUPPORTED_CODE_PATTERN =
  /^(Backquote|Backslash|BracketLeft|BracketRight|Pause|Comma|Digit[0-9]|Equal|Key[A-Z]|Minus|Period|Quote|Semicolon|Slash|Backspace|CapsLock|Enter|Space|Tab|Delete|End|Home|Insert|PageDown|PageUp|PrintScreen|ScrollLock|ArrowDown|ArrowLeft|ArrowRight|ArrowUp|NumLock|Numpad[0-9]|NumpadAdd|NumpadDecimal|NumpadDivide|NumpadEnter|NumpadEqual|NumpadMultiply|NumpadSubtract|Escape|F[1-9]|F1[0-9]|F2[0-4])$/;
