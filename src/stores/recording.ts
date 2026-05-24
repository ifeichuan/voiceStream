import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { getErrorMessage } from "../lib/utils";
import { useLogsStore } from "./logs";
import type { HotkeySessionEvent } from "../types";

interface RecordingState {
  isRecording: boolean;
  chunkCount: number;
  lastChunkInfo: string;
  sttStatus: string;
  partialTranscript: string;
  finalTranscript: string[];
  sessionBuffer: string[];
  hotkeyStatus: HotkeySessionEvent;
  audioLevel: number;

  setIsRecording: (v: boolean) => void;
  setChunkCount: (fn: (prev: number) => number) => void;
  setLastChunkInfo: (v: string) => void;
  setSttStatus: (v: string) => void;
  setPartialTranscript: (v: string) => void;
  setFinalTranscript: (fn: (prev: string[]) => string[]) => void;
  appendSessionBuffer: (text: string) => void;
  flushSessionBuffer: () => void;
  setHotkeyStatus: (v: HotkeySessionEvent) => void;
  setAudioLevel: (v: number) => void;

  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  playLatest: () => Promise<void>;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  isRecording: false,
  chunkCount: 0,
  lastChunkInfo: "尚未接收到音频。",
  sttStatus: "idle",
  partialTranscript: "",
  finalTranscript: [],
  sessionBuffer: [],
  audioLevel: 0,
  hotkeyStatus: {
    state: "idle",
    message: `Press ${DEFAULT_SHORTCUT} for dictation or ${DEFAULT_AGENT_SHORTCUT} for Agent`,
    shortcut: DEFAULT_SHORTCUT,
    purpose: "dictation",
  },

  setIsRecording: (v) => set({ isRecording: v }),
  setChunkCount: (fn) => set((s) => ({ chunkCount: fn(s.chunkCount) })),
  setLastChunkInfo: (v) => set({ lastChunkInfo: v }),
  setSttStatus: (v) => set({ sttStatus: v }),
  setPartialTranscript: (v) => set({ partialTranscript: v }),
  setFinalTranscript: (fn) => set((s) => ({ finalTranscript: fn(s.finalTranscript) })),
  appendSessionBuffer: (text) => set((s) => ({ sessionBuffer: [...s.sessionBuffer, text] })),
  flushSessionBuffer: () => set((s) => {
    if (s.sessionBuffer.length === 0) return s;
    const joined = s.sessionBuffer.join("");
    return {
      sessionBuffer: [],
      finalTranscript: [...s.finalTranscript, joined],
    };
  }),
  setHotkeyStatus: (v) => set({ hotkeyStatus: v }),
  setAudioLevel: (v) => set({ audioLevel: v }),

  startRecording: async () => {
    const addLog = useLogsStore.getState().addLog;
    try {
      const message = await invoke<string>("start_recording");
      set({
        isRecording: true,
        chunkCount: 0,
        lastChunkInfo: "等待接收音频...",
        partialTranscript: "",
        finalTranscript: [],
        sttStatus: "starting",
      });
      addLog(message);
    } catch (error) {
      addLog(`Start failed: ${getErrorMessage(error)}`);
    }
  },

  stopRecording: async () => {
    const addLog = useLogsStore.getState().addLog;
    try {
      const message = await invoke<string>("stop_recording");
      set({ isRecording: false });
      addLog(message);
    } catch (error) {
      addLog(`Stop failed: ${getErrorMessage(error)}`);
    }
  },

  playLatest: async () => {
    const addLog = useLogsStore.getState().addLog;
    try {
      const message = await invoke<string>("play_recorded");
      addLog(message);
    } catch (error) {
      addLog(`Play failed: ${getErrorMessage(error)}`);
    }
  },
}));
