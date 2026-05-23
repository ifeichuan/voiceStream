import { MODIFIER_CODES, PI_MODES, SUPPORTED_CODE_PATTERN } from "./constants";
import type { AgentTask } from "../types";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function normalizePiMode(mode: string): string {
  return PI_MODES.some((option) => option.value === mode) ? mode : "dictation-fast";
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): {
  shortcut?: string;
  cancelled?: boolean;
  status?: string;
} {
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

  const key = event.code.startsWith("Key")
    ? event.code.slice(3)
    : event.code.startsWith("Digit")
      ? event.code.slice(5)
      : event.code;
  return { shortcut: [...modifiers, key].join("+") };
}

export function statusLabel(status: AgentTask["status"]): string {
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

export function formatTaskTime(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "未知时间";
}
