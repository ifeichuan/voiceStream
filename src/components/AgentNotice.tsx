import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useAgentStore } from "../stores/agent";
import type { AgentNotificationEvent } from "../types";
import { Markdown } from "./Markdown";

const AUTO_DISMISS_MS = 8000;

type AgentNoticeDialog = {
  notification: AgentNotificationEvent;
  body: string;
};

function notificationKey(notification: AgentNotificationEvent): string {
  return `${notification.task_id}-${notification.timestamp_ms}`;
}

function notificationTone(status: string): {
  label: string;
  icon: string;
  className: string;
} {
  if (status === "failed") {
    return {
      label: "Agent 失败",
      icon: "!",
      className: "border-[oklch(0.76_0.13_32)]/35 bg-[oklch(0.98_0.018_32)] text-[oklch(0.42_0.16_32)] dark:bg-[oklch(0.25_0.04_32)] dark:text-[oklch(0.82_0.11_32)]",
    };
  }

  if (status === "needs_attention") {
    return {
      label: "Agent 需要回应",
      icon: "?",
      className: "border-[oklch(0.72_0.13_78)]/40 bg-[oklch(0.98_0.022_78)] text-[oklch(0.42_0.12_78)] dark:bg-[oklch(0.24_0.045_78)] dark:text-[oklch(0.82_0.12_78)]",
    };
  }

  if (status === "completed") {
    return {
      label: "Agent 完成",
      icon: "✓",
      className: "border-[oklch(0.72_0.12_155)]/35 bg-[oklch(0.98_0.018_155)] text-[oklch(0.34_0.12_155)] dark:bg-[oklch(0.22_0.04_155)] dark:text-[oklch(0.78_0.11_155)]",
    };
  }

  return {
    label: "Agent 通知",
    icon: "•",
    className: "border-paper-line bg-paper-surface-soft text-paper-ink",
  };
}

export function AgentNotice() {
  const navigate = useNavigate();
  const agentNotifications = useAgentStore((state) => state.agentNotifications);
  const agentTasks = useAgentStore((state) => state.agentTasks);
  const setSelectedAgentTaskId = useAgentStore((state) => state.setSelectedAgentTaskId);
  const setIsAgentDetailOpen = useAgentStore((state) => state.setIsAgentDetailOpen);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<AgentNoticeDialog | null>(null);
  const [shownDialogKeys, setShownDialogKeys] = useState<Set<string>>(() => new Set());

  const activeNotice = useMemo(
    () => agentNotifications.find((notification) => !dismissedKeys.has(notificationKey(notification))),
    [agentNotifications, dismissedKeys],
  );

  useEffect(() => {
    if (!activeNotice || activeNotice.status === "needs_attention") return;
    const key = notificationKey(activeNotice);
    const timer = window.setTimeout(() => {
      setDismissedKeys((prev) => new Set(prev).add(key));
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [activeNotice]);

  useEffect(() => {
    const notice = agentNotifications.find(
      (notification) =>
        (notification.status === "completed" || notification.status === "failed") &&
        !shownDialogKeys.has(notificationKey(notification)),
    );
    if (!notice) return;

    const task = agentTasks.find((item) => item.id === notice.task_id);
    const body =
      notice.status === "failed"
        ? task?.error_text || notice.summary || notice.display_text || notice.title
        : task?.final_text || notice.summary || notice.display_text || notice.title;
    const key = notificationKey(notice);
    setDialog({ notification: notice, body });
    setShownDialogKeys((prev) => new Set(prev).add(key));
    setDismissedKeys((prev) => new Set(prev).add(key));
  }, [agentNotifications, agentTasks, shownDialogKeys]);

  if (!activeNotice && !dialog) return null;

  const closeDialog = () => setDialog(null);

  const openDialogTask = (notification: AgentNotificationEvent) => {
    setSelectedAgentTaskId(notification.task_id);
    setIsAgentDetailOpen(true);
    void navigate({ to: "/agent" });
    closeDialog();
  };

  const dismiss = () => {
    if (!activeNotice) return;
    setDismissedKeys((prev) => new Set(prev).add(notificationKey(activeNotice)));
  };

  const openTask = () => {
    if (!activeNotice) return;
    if (activeNotice.status === "needs_attention") {
      void invoke("show_ask_overlay").catch(() => {
        setSelectedAgentTaskId(activeNotice.task_id);
        void navigate({ to: "/agent" });
      });
    } else {
      setSelectedAgentTaskId(activeNotice.task_id);
      setIsAgentDetailOpen(true);
      void navigate({ to: "/agent" });
    }
    dismiss();
  };

  const tone = activeNotice ? notificationTone(activeNotice.status) : null;
  const summary = activeNotice
    ? activeNotice.summary || activeNotice.display_text || activeNotice.title
    : "";

  return (
    <>
      {dialog && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[color-mix(in_oklch,var(--color-paper-ink)_18%,transparent)] px-5 py-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-answer-title"
            className="max-h-[min(720px,calc(100vh-48px))] w-[min(720px,calc(100vw-40px))] overflow-hidden border border-paper-line bg-paper-surface shadow-[0_24px_80px_color-mix(in_oklch,var(--color-paper-ink)_18%,transparent)]"
          >
            <div className="flex items-start justify-between gap-5 border-b border-paper-line px-5 py-4">
              <div className="min-w-0">
                <p className="kicker">
                  {dialog.notification.status === "failed" ? "Agent 失败" : "Agent 回答"}
                </p>
                <h2 id="agent-answer-title" className="mt-2 truncate text-base font-semibold tracking-[-0.03em]">
                  {dialog.notification.title}
                </h2>
              </div>
              <button className="btn-ghost min-h-9 px-3 text-[0.78rem]" type="button" onClick={closeDialog}>
                关闭
              </button>
            </div>
            <div className="max-h-[calc(min(720px,100vh-48px)-128px)] overflow-auto px-5 py-4">
              <Markdown>{dialog.body}</Markdown>
            </div>
            <div className="flex justify-end gap-2 border-t border-paper-line px-5 py-3">
              <button
                className="btn-ghost min-h-9 px-3 text-[0.78rem]"
                type="button"
                onClick={() => openDialogTask(dialog.notification)}
              >
                查看任务
              </button>
            </div>
          </section>
        </div>
      )}

      {activeNotice && tone && (
        <aside
          className={[
            "fixed right-10 bottom-8 z-50 w-[min(360px,calc(100vw-2rem))] rounded-xl border px-4 py-3 shadow-[0_18px_54px_rgba(0,0,0,0.16)] backdrop-blur-xl",
            "motion-safe:animate-[agent-notice-in_180ms_ease-out]",
            tone.className,
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-current/10 text-[0.74rem] font-bold tabular-nums">
              {tone.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[0.78rem] font-semibold tracking-[-0.02em]">{tone.label}</p>
                <time className="shrink-0 text-[0.68rem] opacity-60 tabular-nums">
                  {new Date(activeNotice.timestamp_ms).toLocaleTimeString()}
                </time>
              </div>
              <p className="mt-1 truncate text-[0.86rem] font-medium tracking-[-0.02em]">{activeNotice.title}</p>
              <p className="mt-1 line-clamp-2 text-[0.75rem] leading-5 opacity-72">{summary}</p>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded px-2.5 py-1.5 text-[0.74rem] font-medium opacity-65 transition-opacity hover:opacity-100"
                >
                  稍后
                </button>
                <button
                  type="button"
                  onClick={openTask}
                  className="rounded bg-paper-ink px-2.5 py-1.5 text-[0.74rem] font-semibold text-paper-surface transition-transform active:scale-95"
                >
                  {activeNotice.status === "needs_attention" ? "去回应" : "查看任务"}
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
