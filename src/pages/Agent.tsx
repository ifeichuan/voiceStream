import { useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import {
  AGENT_TERMINAL_BOTTOM_THRESHOLD,
  AGENT_TERMINAL_COLS,
  AGENT_TERMINAL_ROWS,
  DEFAULT_AGENT_SHORTCUT,
} from "../lib/constants";
import { getErrorMessage, formatTaskTime, statusLabel } from "../lib/utils";
import { WaveformAnimation } from "../components/WaveformAnimation";
import { useAgentStore } from "../stores/agent";
import { useSettingsStore } from "../stores/settings";
import type { AgentSessionView, AgentTerminalOutputEvent, AgentTerminalStatusEvent } from "../types";

export default function Agent() {
  const xtermRef = useRef<XTerm | null>(null);
  const terminalShellRef = useRef<HTMLDivElement | null>(null);
  const agentTerminalAtBottomRef = useRef(true);
  const agentTerminalReadyRef = useRef(false);
  const pendingAgentTerminalOutputRef = useRef<Uint8Array[]>([]);
  const agentTerminalLoadTimeoutRef = useRef<number | null>(null);
  const scrollAgentTerminalFrameRef = useRef<number | null>(null);
  const selectedAgentTaskIdRef = useRef("");
  const hasAgentTerminalPendingOutputRef = useRef(false);
  const isAgentTerminalLoadingRef = useRef(false);

  const agentTasks = useAgentStore((state) => state.agentTasks);
  const selectedAgentTaskId = useAgentStore((state) => state.selectedAgentTaskId);
  const agentSession = useAgentStore((state) => state.agentSession);
  const agentSessionStatus = useAgentStore((state) => state.agentSessionStatus);
  const agentTerminalStatus = useAgentStore((state) => state.agentTerminalStatus);
  const isAgentTerminalLoading = useAgentStore((state) => state.isAgentTerminalLoading);
  const activeTerminalTaskId = useAgentStore((state) => state.activeTerminalTaskId);
  const terminalResetKey = useAgentStore((state) => state.terminalResetKey);
  const isAgentTerminalAtBottom = useAgentStore((state) => state.isAgentTerminalAtBottom);
  const hasAgentTerminalPendingOutput = useAgentStore(
    (state) => state.hasAgentTerminalPendingOutput,
  );
  const isAgentDetailOpen = useAgentStore((state) => state.isAgentDetailOpen);
  const setSelectedAgentTaskId = useAgentStore((state) => state.setSelectedAgentTaskId);
  const setAgentSession = useAgentStore((state) => state.setAgentSession);
  const setAgentSessionStatus = useAgentStore((state) => state.setAgentSessionStatus);
  const setAgentTerminalStatus = useAgentStore((state) => state.setAgentTerminalStatus);
  const setIsAgentTerminalLoading = useAgentStore((state) => state.setIsAgentTerminalLoading);
  const setActiveTerminalTaskId = useAgentStore((state) => state.setActiveTerminalTaskId);
  const setTerminalResetKey = useAgentStore((state) => state.setTerminalResetKey);
  const setIsAgentTerminalAtBottom = useAgentStore((state) => state.setIsAgentTerminalAtBottom);
  const setHasAgentTerminalPendingOutput = useAgentStore(
    (state) => state.setHasAgentTerminalPendingOutput,
  );
  const setIsAgentDetailOpen = useAgentStore((state) => state.setIsAgentDetailOpen);
  const shortcutSettings = useSettingsStore((state) => state.shortcutSettings);

  useEffect(() => {
    hasAgentTerminalPendingOutputRef.current = hasAgentTerminalPendingOutput;
  }, [hasAgentTerminalPendingOutput]);

  useEffect(() => {
    isAgentTerminalLoadingRef.current = isAgentTerminalLoading;
  }, [isAgentTerminalLoading]);

  const selectedAgentTask = useMemo(
    () => agentTasks.find((task) => task.id === selectedAgentTaskId) ?? agentTasks[0],
    [agentTasks, selectedAgentTaskId],
  );
  const terminalLineCount = agentSession?.entries.length ?? 0;
  const selectedAgentTaskStatus = selectedAgentTask ? statusLabel(selectedAgentTask.status) : "未选择";
  const selectedAgentTaskStatusText = selectedAgentTask
    ? `${selectedAgentTaskStatus} · ${
        activeTerminalTaskId === selectedAgentTask.id ? agentTerminalStatus : "终端未连接"
      }`
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

  const finishAgentTerminalLoading = useCallback(() => {
    clearAgentTerminalLoadTimeout();
    if (!isAgentTerminalLoadingRef.current) return;
    isAgentTerminalLoadingRef.current = false;
    setIsAgentTerminalLoading(false);
  }, [clearAgentTerminalLoadTimeout, setIsAgentTerminalLoading]);

  const beginAgentTerminalLoading = useCallback(
    (waitingMessage: string) => {
      clearAgentTerminalLoadTimeout();
      agentTerminalReadyRef.current = false;
      pendingAgentTerminalOutputRef.current = [];
      isAgentTerminalLoadingRef.current = true;
      setIsAgentTerminalLoading(true);

      agentTerminalLoadTimeoutRef.current = window.setTimeout(() => {
        setAgentTerminalStatus(waitingMessage);
      }, 8000);
    },
    [clearAgentTerminalLoadTimeout, setAgentTerminalStatus, setIsAgentTerminalLoading],
  );

  const getAgentTerminalViewport = useCallback(
    () => terminalShellRef.current?.querySelector<HTMLElement>(".xterm-viewport") ?? null,
    [],
  );

  const isAgentTerminalNearBottom = useCallback(() => {
    const viewport = getAgentTerminalViewport();
    if (!viewport) return true;
    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return distanceToBottom <= AGENT_TERMINAL_BOTTOM_THRESHOLD;
  }, [getAgentTerminalViewport]);

  const syncAgentTerminalScrollState = useCallback(() => {
    const isAtBottom = isAgentTerminalNearBottom();
    if (agentTerminalAtBottomRef.current !== isAtBottom) {
      agentTerminalAtBottomRef.current = isAtBottom;
      setIsAgentTerminalAtBottom(isAtBottom);
    }
    if (isAtBottom && hasAgentTerminalPendingOutputRef.current) {
      hasAgentTerminalPendingOutputRef.current = false;
      setHasAgentTerminalPendingOutput(false);
    }
  }, [isAgentTerminalNearBottom, setHasAgentTerminalPendingOutput, setIsAgentTerminalAtBottom]);

  const resetAgentTerminalView = useCallback(() => {
    setTerminalResetKey((prev) => prev + 1);
    agentTerminalReadyRef.current = false;
    pendingAgentTerminalOutputRef.current = [];
    if (!agentTerminalAtBottomRef.current) {
      setIsAgentTerminalAtBottom(true);
    }
    agentTerminalAtBottomRef.current = true;
    if (hasAgentTerminalPendingOutputRef.current) {
      hasAgentTerminalPendingOutputRef.current = false;
      setHasAgentTerminalPendingOutput(false);
    }
    xtermRef.current?.clear();
  }, [setHasAgentTerminalPendingOutput, setIsAgentTerminalAtBottom, setTerminalResetKey]);

  const scrollAgentTerminalToBottom = useCallback(() => {
    if (scrollAgentTerminalFrameRef.current !== null) return;

    scrollAgentTerminalFrameRef.current = requestAnimationFrame(() => {
      scrollAgentTerminalFrameRef.current = null;
      const term = xtermRef.current;
      if (!term) return;
      term.scrollToBottom();
      if (!agentTerminalAtBottomRef.current) {
        agentTerminalAtBottomRef.current = true;
        setIsAgentTerminalAtBottom(true);
      }
      if (hasAgentTerminalPendingOutputRef.current) {
        hasAgentTerminalPendingOutputRef.current = false;
        setHasAgentTerminalPendingOutput(false);
      }
    });
  }, [setHasAgentTerminalPendingOutput, setIsAgentTerminalAtBottom]);

  const flushPendingAgentTerminalOutput = useCallback(() => {
    if (!agentTerminalReadyRef.current || pendingAgentTerminalOutputRef.current.length === 0) {
      return false;
    }

    const term = xtermRef.current;
    if (!term) return false;
    for (const chunk of pendingAgentTerminalOutputRef.current) {
      term.write(chunk);
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
    let unlistenAgentTerminalOutput: (() => void) | undefined;
    let unlistenAgentTerminalStatus: (() => void) | undefined;

    void listen<AgentTerminalOutputEvent>("agent-terminal-output", (event) => {
      const { task_id, data } = event.payload;
      if (task_id !== selectedAgentTaskIdRef.current) return;
      const shouldFollowOutput = agentTerminalAtBottomRef.current;
      const chunk = new Uint8Array(data);
      if (agentTerminalReadyRef.current && xtermRef.current) {
        xtermRef.current.write(chunk, () => {
          finishAgentTerminalLoading();
          if (shouldFollowOutput) {
            xtermRef.current?.scrollToBottom();
          }
        });
      } else {
        pendingAgentTerminalOutputRef.current.push(chunk);
      }
      if (!shouldFollowOutput && !hasAgentTerminalPendingOutputRef.current) {
        hasAgentTerminalPendingOutputRef.current = true;
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
      unlistenAgentTerminalOutput?.();
      unlistenAgentTerminalStatus?.();
    };
  }, [finishAgentTerminalLoading, scrollAgentTerminalToBottom, setAgentTerminalStatus, setHasAgentTerminalPendingOutput]);

  useEffect(() => {
    return () => {
      if (scrollAgentTerminalFrameRef.current !== null) {
        cancelAnimationFrame(scrollAgentTerminalFrameRef.current);
        scrollAgentTerminalFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isAgentDetailOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAgentDetailOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAgentDetailOpen, setIsAgentDetailOpen]);

  useEffect(() => {
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
        xtermRef.current?.focus();
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
      clearAgentTerminalLoadTimeout();
      void invoke("stop_agent_terminal", { taskId });
    };
  }, [
    beginAgentTerminalLoading,
    clearAgentTerminalLoadTimeout,
    finishAgentTerminalLoading,
    resetAgentTerminalView,
    scrollAgentTerminalToBottom,
    selectedAgentTask?.id,
    setActiveTerminalTaskId,
    setAgentSession,
    setAgentSessionStatus,
    setAgentTerminalStatus,
  ]);

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
      xtermRef.current?.focus();
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

  return (
    <div className="grid min-h-0 flex-1 gap-[24px] p-6 pl-0 ">
      <section className="grid h-full min-h-0 grid-cols-[minmax(250px,0.36fr)_minmax(0,1fr)] gap-8 max-[960px]:grid-cols-1 max-[960px]:grid-rows-[1fr]">
        <div className="flex min-h-0 flex-col max-[960px]:hidden">
          <div className="mb-3 px-2">
            <h3 className="text-[0.82rem] font-semibold tracking-[-0.02em]">Agent 任务</h3>
            <p className="mt-1 text-[0.75rem] text-paper-muted">
              {agentTasks.length
                ? `${agentTasks.length} 个任务`
                : `按 ${shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT} 创建任务`}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
            {agentTasks.length === 0 && (
              <div className="px-2 py-3 text-[0.82rem] text-paper-muted">暂无 Agent 任务。</div>
            )}
            {agentTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={[
                  "grid w-full gap-1 rounded px-2 py-2 text-left transition-[background-color,color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-accent",
                  selectedAgentTask?.id === task.id
                    ? "bg-paper-ink/[0.06] text-paper-ink"
                    : "text-paper-ink/80 hover:bg-paper-ink/[0.03]",
                ].join(" ")}
                onClick={() => setSelectedAgentTaskId(task.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <strong className="min-w-0 truncate text-[0.84rem] font-medium [line-height:1.4]">
                    {task.title}
                  </strong>
                  <span className="shrink-0 text-[0.72rem] text-paper-muted">
                    {statusLabel(task.status)}
                  </span>
                </div>
                <small className="text-[0.72rem] text-paper-muted">
                  {formatTaskTime(task.created_at_ms)}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-paper-line ">
          <div className="section-head max-[760px]:flex-col max-[760px]:items-start">
            <div className="min-w-0">
              <h3 className="max-w-[72ch] truncate text-base font-semibold tracking-[-0.03em]">
                {selectedAgentTask?.title || "会话"}
              </h3>
              <p className="mt-1.5 text-paper-muted">{selectedAgentTaskStatusText}</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                className="btn-ghost"
                type="button"
                onClick={refreshAgentSession}
                disabled={!selectedAgentTask}
              >
                刷新
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setIsAgentDetailOpen(true)}
                disabled={!selectedAgentTask}
              >
                详情
              </button>
            </div>
          </div>

          {!selectedAgentTask && <div className="text-paper-muted">选择一个任务查看会话。</div>}
          {selectedAgentTask && (
            <div ref={terminalShellRef} className="relative min-h-0 flex-1 overflow-hidden">
              <XTermContainer
                key={`${selectedAgentTask.id}-${terminalResetKey}`}
                taskId={selectedAgentTask.id}
                xtermRef={xtermRef}
                onReady={() => {
                  agentTerminalReadyRef.current = true;
                  flushPendingAgentTerminalOutput();
                  xtermRef.current?.focus();
                  scrollAgentTerminalToBottom();
                }}
                onScroll={syncAgentTerminalScrollState}
                onError={(error) => {
                  finishAgentTerminalLoading();
                  setAgentTerminalStatus(`终端初始化失败：${getErrorMessage(error)}`);
                }}
                setAgentTerminalStatus={setAgentTerminalStatus}
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
                  <span aria-hidden="true" className="leading-none">
                    ↓
                  </span>
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
                <p className="mt-1.5 text-paper-muted">{agentSessionStatus}</p>
              </div>
              <button className="btn-ghost" type="button" onClick={() => setIsAgentDetailOpen(false)}>
                关闭
              </button>
            </div>

            <div className="grid gap-7 py-5">
              <div className="grid grid-cols-3 gap-5 max-[760px]:grid-cols-1">
                <div className="meta-card">
                  <span className="field-label">状态</span>
                  <strong className="mt-2 block text-[0.95rem] font-semibold">
                    {selectedAgentTaskStatus}
                  </strong>
                </div>
                <div className="meta-card">
                  <span className="field-label">JSONL</span>
                  <strong className="mt-2 block text-[0.95rem] font-semibold">
                    {terminalLineCount}
                  </strong>
                </div>
                <div className="meta-card">
                  <span className="field-label">事件</span>
                  <strong className="mt-2 block text-[0.95rem] font-semibold">
                    {selectedAgentTask.events.length}
                  </strong>
                </div>
              </div>

              <section className="border-b border-paper-line pb-5">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <span className="field-label">恢复指令</span>
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={copyResumeCommand}
                    disabled={!agentSession?.resume_command}
                  >
                    复制
                  </button>
                </div>
                <code className="block break-all font-mono text-[0.8rem] text-paper-muted [line-height:1.6]">
                  {agentSession?.resume_command || "pi --session <session-path>"}
                </code>
              </section>

              <section className="border-b border-paper-line pb-5">
                <span className="field-label">任务输入</span>
                <p className="mt-3 whitespace-pre-wrap text-[0.9rem] text-paper-muted [line-height:1.65]">
                  {selectedAgentTask.transcript}
                </p>
              </section>

              <section className="border-b border-paper-line pb-5">
                <span className="field-label">执行日志</span>
                <div className="mt-3 max-h-64 overflow-auto font-mono text-[0.78rem] text-paper-muted [line-height:1.6]">
                  {selectedAgentTask.events.length === 0 && <div>暂无事件。</div>}
                  {selectedAgentTask.events.map((event, index) => (
                    <div
                      key={`${event.timestamp_ms}-${event.kind}-${index}`}
                      className="border-b border-paper-line py-2 first:pt-0"
                    >
                      <span>{new Date(event.timestamp_ms).toLocaleTimeString()}</span>{" "}
                      <strong>{event.kind}</strong> · {event.message}
                    </div>
                  ))}
                </div>
              </section>

              {agentSession?.parse_errors.length ? (
                <section className="border-b border-paper-line pb-5">
                  <span className="field-label">解析失败</span>
                  <div className="mt-3 grid gap-2 font-mono text-[0.78rem] text-[oklch(0.56_0.2_28)]">
                    {agentSession.parse_errors.map((error, index) => (
                      <div key={`${error}-${index}`}>{error}</div>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedAgentTask.error_text && (
                <section className="border-b border-paper-line pb-5">
                  <span className="field-label">错误</span>
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
  );
}

const XTERM_LIGHT_THEME = {
  background: "#f9f8f8",
  foreground: "#201d1d",
  cursor: "#4a4444",
  cursorAccent: "#f9f8f8",
  selectionBackground: "#007aff33",
  black: "#2a2626",
  red: "#c43d37",
  green: "#3a8c2e",
  yellow: "#8a7a2e",
  blue: "#3366cc",
  magenta: "#8844aa",
  cyan: "#2e8a8a",
  white: "#e6e3e3",
  brightBlack: "#7a7575",
  brightRed: "#e05550",
  brightGreen: "#4caa3e",
  brightYellow: "#b8a83e",
  brightBlue: "#5588ee",
  brightMagenta: "#aa66cc",
  brightCyan: "#44aaaa",
  brightWhite: "#fdfcfc",
};

const XTERM_DARK_THEME = {
  background: "#2a2626",
  foreground: "#fdfcfc",
  cursor: "#c8a050",
  cursorAccent: "#2a2626",
  selectionBackground: "#007aff44",
  black: "#2a2626",
  red: "#e06560",
  green: "#6abf5a",
  yellow: "#c8b84a",
  blue: "#6699dd",
  magenta: "#bb88dd",
  cyan: "#55bbbb",
  white: "#e6e3e3",
  brightBlack: "#7a7575",
  brightRed: "#f07870",
  brightGreen: "#7ad06a",
  brightYellow: "#ddd05a",
  brightBlue: "#88bbff",
  brightMagenta: "#cc99ee",
  brightCyan: "#66cccc",
  brightWhite: "#fdfcfc",
};

function getXtermTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? XTERM_DARK_THEME
    : XTERM_LIGHT_THEME;
}

interface XTermContainerProps {
  taskId: string;
  xtermRef: React.MutableRefObject<XTerm | null>;
  onReady: () => void;
  onScroll: () => void;
  onError: (error: unknown) => void;
  setAgentTerminalStatus: (status: string) => void;
}

function XTermContainer({ taskId, xtermRef, onReady, onScroll, onError, setAgentTerminalStatus }: XTermContainerProps) {
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onReady, onScroll, onError, setAgentTerminalStatus });
  callbacksRef.current = { onReady, onScroll, onError, setAgentTerminalStatus };

  useEffect(() => {
    const el = containerElRef.current;
    if (!el) return;

    const term = new XTerm({
      cols: AGENT_TERMINAL_COLS,
      rows: AGENT_TERMINAL_ROWS,
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: "var(--font-mono)",
      theme: getXtermTheme(),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(fitAddon);
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";

    try {
      term.open(el);
      xtermRef.current = term;

      term.onData((data) => {
        void invoke("write_agent_terminal", { taskId, data }).catch((error) => {
          callbacksRef.current.setAgentTerminalStatus(`写入失败：${getErrorMessage(error)}`);
        });
      });

      term.onScroll(() => callbacksRef.current.onScroll());

      const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const onThemeChange = () => { term.options.theme = getXtermTheme(); };
      themeQuery.addEventListener("change", onThemeChange);

      let fitRaf = 0;
      const doFit = () => {
        if (fitRaf) return;
        fitRaf = requestAnimationFrame(() => {
          fitRaf = 0;
          if (el.clientWidth > 0 && el.clientHeight > 0) {
            const dims = fitAddon.proposeDimensions();
            if (dims && dims.cols > 0 && dims.rows > 0) {
              fitAddon.fit();
              void invoke("resize_agent_terminal", {
                taskId,
                cols: term.cols,
                rows: term.rows,
              }).catch((error) => {
                callbacksRef.current.setAgentTerminalStatus(`调整终端尺寸失败：${getErrorMessage(error)}`);
              });
            }
          }
        });
      };

      const resizeObserver = new ResizeObserver(doFit);
      resizeObserver.observe(el);

      callbacksRef.current.onReady();

      return () => {
        resizeObserver.disconnect();
        if (fitRaf) cancelAnimationFrame(fitRaf);
        themeQuery.removeEventListener("change", onThemeChange);
        term.dispose();
        if (xtermRef.current === term) {
          xtermRef.current = null;
        }
      };
    } catch (err) {
      callbacksRef.current.onError(err);
      return () => {
        term.dispose();
        if (xtermRef.current === term) {
          xtermRef.current = null;
        }
      };
    }
  }, [taskId, xtermRef]);

  return (
    <div
      ref={containerElRef}
      className="agent-terminal absolute inset-0"
      role="textbox"
      aria-label="Terminal"
      aria-multiline="true"
      aria-roledescription="terminal"
    />
  );
}
