import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { MAX_AGENT_NOTIFICATIONS } from "../lib/constants";
import { getErrorMessage } from "../lib/utils";
import { useLogsStore } from "./logs";
import type { AgentTask, AgentSessionView, AgentNotificationEvent } from "../types";

type ValueOrUpdater<T> = T | ((prev: T) => T);

function resolveValue<T>(next: ValueOrUpdater<T>, prev: T): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
}

interface AgentState {
  agentTasks: AgentTask[];
  selectedAgentTaskId: string;
  agentSession: AgentSessionView | null;
  agentSessionStatus: string;
  agentTerminalStatus: string;
  isAgentTerminalLoading: boolean;
  activeTerminalTaskId: string;
  terminalResetKey: number;
  isAgentTerminalAtBottom: boolean;
  hasAgentTerminalPendingOutput: boolean;
  isAgentDetailOpen: boolean;
  agentNotifications: AgentNotificationEvent[];

  setAgentTasks: (next: ValueOrUpdater<AgentTask[]>) => void;
  setSelectedAgentTaskId: (next: ValueOrUpdater<string>) => void;
  setAgentSession: (v: AgentSessionView | null) => void;
  setAgentSessionStatus: (v: string) => void;
  setAgentTerminalStatus: (v: string) => void;
  setIsAgentTerminalLoading: (v: boolean) => void;
  setActiveTerminalTaskId: (v: string) => void;
  setTerminalResetKey: (next: ValueOrUpdater<number>) => void;
  setIsAgentTerminalAtBottom: (v: boolean) => void;
  setHasAgentTerminalPendingOutput: (v: boolean) => void;
  setIsAgentDetailOpen: (v: boolean) => void;
  upsertAgentNotification: (notification: AgentNotificationEvent) => void;

  loadAgentTasks: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  agentTasks: [],
  selectedAgentTaskId: "",
  agentSession: null,
  agentSessionStatus: "选择任务后读取本地 session。",
  agentTerminalStatus: "选择任务后连接终端。",
  isAgentTerminalLoading: false,
  activeTerminalTaskId: "",
  terminalResetKey: 0,
  isAgentTerminalAtBottom: true,
  hasAgentTerminalPendingOutput: false,
  isAgentDetailOpen: false,
  agentNotifications: [],

  setAgentTasks: (next) => set((s) => ({ agentTasks: resolveValue(next, s.agentTasks) })),
  setSelectedAgentTaskId: (next) =>
    set((s) => ({ selectedAgentTaskId: resolveValue(next, s.selectedAgentTaskId) })),
  setAgentSession: (v) => set({ agentSession: v }),
  setAgentSessionStatus: (v) => set({ agentSessionStatus: v }),
  setAgentTerminalStatus: (v) => set({ agentTerminalStatus: v }),
  setIsAgentTerminalLoading: (v) => set({ isAgentTerminalLoading: v }),
  setActiveTerminalTaskId: (v) => set({ activeTerminalTaskId: v }),
  setTerminalResetKey: (next) =>
    set((s) => ({ terminalResetKey: resolveValue(next, s.terminalResetKey) })),
  setIsAgentTerminalAtBottom: (v) => set({ isAgentTerminalAtBottom: v }),
  setHasAgentTerminalPendingOutput: (v) => set({ hasAgentTerminalPendingOutput: v }),
  setIsAgentDetailOpen: (v) => set({ isAgentDetailOpen: v }),
  upsertAgentNotification: (notification) =>
    set((s) => ({
      agentNotifications: [
        notification,
        ...s.agentNotifications.filter((item) => item.task_id !== notification.task_id),
      ]
        .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
        .slice(0, MAX_AGENT_NOTIFICATIONS),
    })),

  loadAgentTasks: async () => {
    const addLog = useLogsStore.getState().addLog;
    try {
      const tasks = await invoke<AgentTask[]>("get_agent_tasks");
      set((s) => ({
        agentTasks: tasks,
        selectedAgentTaskId: s.selectedAgentTaskId || tasks[0]?.id || "",
      }));
    } catch (error) {
      addLog(`Load agent tasks failed: ${getErrorMessage(error)}`);
    }
  },
}));
