import { create } from "zustand";
import { MAX_LOGS } from "../lib/constants";

interface LogsState {
  logs: string[];
  addLog: (message: string) => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  logs: [],
  addLog: (message) =>
    set((state) => ({
      logs: [...state.logs.slice(-(MAX_LOGS - 1)), `[${new Date().toLocaleTimeString()}] ${message}`],
    })),
}));
