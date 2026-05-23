import { useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import {
  AGENT_TERMINAL_BOTTOM_THRESHOLD,
  AGENT_TERMINAL_COLS,
  AGENT_TERMINAL_ROWS,
  DEFAULT_AGENT_SHORTCUT,
} from "../lib/constants";
import { getErrorMessage, formatTaskTime, statusLabel } from "../lib/utils";
import {
  mutedClass,
  ghostButtonClass,
  sectionHeadClass,
  sectionTitleClass,
  metaCardClass,
  fieldLabelClass,
} from "../lib/styles";
import { useAgentStore } from "../stores/agent";
import { useSettingsStore } from "../stores/settings";
import type { AgentSessionView, AgentTerminalOutputEvent, AgentTerminalStatusEvent } from "../types";

export default function Agent() {
  const terminal = useTerminal();
  const terminalWriteRef = useRef(terminal.write);
  const terminalFocusRef = useRef(terminal.focus);
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

  const getAgentTerminalNode = useCallback(
    () => terminalShellRef.current?.querySelector<HTMLElement>(".agent-terminal.wterm") ?? null,
    [],
  );

  const isAgentTerminalNearBottom = useCallback(() => {
    const terminalNode = getAgentTerminalNode();
    if (!terminalNode) return true;
    const distanceToBottom = terminalNode.scrollHeight - terminalNode.scrollTop - terminalNode.clientHeight;
    return distanceToBottom <= AGENT_TERMINAL_BOTTOM_THRESHOLD;
  }, [getAgentTerminalNode]);

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
    terminalWriteRef.current("\x1b[3J\x1b[H\x1b[2J");
  }, [setHasAgentTerminalPendingOutput, setIsAgentTerminalAtBottom, setTerminalResetKey]);

  const scrollAgentTerminalToBottom = useCallback(() => {
    if (scrollAgentTerminalFrameRef.current !== null) return;

    scrollAgentTerminalFrameRef.current = requestAnimationFrame(() => {
      scrollAgentTerminalFrameRef.current = null;
      const terminalNode = getAgentTerminalNode();
      if (!terminalNode) return;
      terminalNode.scrollTop = terminalNode.scrollHeight;
      if (!agentTerminalAtBottomRef.current) {
        agentTerminalAtBottomRef.current = true;
        setIsAgentTerminalAtBottom(true);
      }
      if (hasAgentTerminalPendingOutputRef.current) {
        hasAgentTerminalPendingOutputRef.current = false;
        setHasAgentTerminalPendingOutput(false);
      }
    });
  }, [getAgentTerminalNode, setHasAgentTerminalPendingOutput, setIsAgentTerminalAtBottom]);

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
    let unlistenAgentTerminalOutput: (() => void) | undefined;
    let unlistenAgentTerminalStatus: (() => void) | undefined;

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

  return (
    <div className="grid min-h-0 flex-1 gap-[24px] pt-7 pb-7">
      <section className="grid h-full min-h-0 grid-cols-[minmax(250px,0.36fr)_minmax(0,1fr)] gap-8 max-[960px]:grid-cols-1 max-[960px]:grid-rows-[minmax(128px,0.34fr)_minmax(280px,1fr)]">
        <div className="flex min-h-0 flex-col border-b border-paper-line pb-7">
          <div className={sectionHeadClass}>
            <div>
              <h3 className={sectionTitleClass}>Agent 任务</h3>
              <p className={`mt-1.5 ${mutedClass}`}>
                {agentTasks.length
                  ? `${agentTasks.length} 个任务`
                  : `按 ${shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT} 创建任务`}
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
                onClick={() => setSelectedAgentTaskId(task.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <strong className="min-w-0 break-words text-[0.95rem] font-semibold [line-height:1.35]">
                    {task.title}
                  </strong>
                  <span className="shrink-0 text-[0.75rem] text-paper-muted">
                    {statusLabel(task.status)}
                  </span>
                </div>
                <small className="text-[0.75rem] text-paper-muted">
                  {formatTaskTime(task.created_at_ms)}
                </small>
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
              <button
                className={ghostButtonClass}
                type="button"
                onClick={refreshAgentSession}
                disabled={!selectedAgentTask}
              >
                刷新
              </button>
              <button
                className={ghostButtonClass}
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
              <Terminal
                key={`${selectedAgentTask.id}-${terminalResetKey}`}
                ref={terminal.ref}
                className="agent-terminal"
                cols={AGENT_TERMINAL_COLS}
                rows={AGENT_TERMINAL_ROWS}
                cursorBlink
                onData={(data) => {
                  void invoke("write_agent_terminal", {
                    taskId: selectedAgentTask.id,
                    data,
                  }).catch((error) => {
                    setAgentTerminalStatus(`写入失败：${getErrorMessage(error)}`);
                  });
                }}
                onResize={(cols, rows) => {
                  void invoke("resize_agent_terminal", {
                    taskId: selectedAgentTask.id,
                    cols,
                    rows,
                  }).catch((error) => {
                    setAgentTerminalStatus(`调整终端尺寸失败：${getErrorMessage(error)}`);
                  });
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
                  <div className="agent-loading-wave" aria-hidden="true">
                    {Array.from({ length: 9 }, (_, index) => (
                      <span key={index} />
                    ))}
                  </div>
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
                  <strong className="mt-2 block text-[0.95rem] font-semibold">
                    {selectedAgentTaskStatus}
                  </strong>
                </div>
                <div className={metaCardClass}>
                  <span className={fieldLabelClass}>JSONL</span>
                  <strong className="mt-2 block text-[0.95rem] font-semibold">
                    {terminalLineCount}
                  </strong>
                </div>
                <div className={metaCardClass}>
                  <span className={fieldLabelClass}>事件</span>
                  <strong className="mt-2 block text-[0.95rem] font-semibold">
                    {selectedAgentTask.events.length}
                  </strong>
                </div>
              </div>

              <section className="border-b border-paper-line pb-5">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <span className={fieldLabelClass}>恢复指令</span>
                  <button
                    className={ghostButtonClass}
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
  );
}
