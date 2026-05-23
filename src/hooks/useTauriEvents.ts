import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLogsStore } from "../stores/logs";
import { useRecordingStore } from "../stores/recording";
import { useAgentStore } from "../stores/agent";
import { useSettingsStore } from "../stores/settings";
import type {
  AudioChunk,
  SttTranscriptEvent,
  SttStatusEvent,
  HotkeySessionEvent,
  TimingEvent,
  AgentTaskUpdatedEvent,
  AgentNotificationEvent,
} from "../types";

/**
 * Subscribes to app-wide Tauri backend events once at shell mount and dispatches into stores.
 * Agent terminal PTY events stay inside the Agent page, matching the legacy implementation.
 */
export function useTauriEvents() {
  useEffect(() => {
    const addLog = useLogsStore.getState().addLog;

    let unlistenAudio: (() => void) | undefined;
    let unlistenStt: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenHotkey: (() => void) | undefined;
    let unlistenTiming: (() => void) | undefined;
    let unlistenAgentTask: (() => void) | undefined;
    let unlistenAgentNotification: (() => void) | undefined;

    addLog("Ready");

    void useAgentStore.getState().loadAgentTasks();
    void useSettingsStore.getState().loadSettings();

    void listen<AudioChunk>("audio-chunk", (event) => {
      const chunk = event.payload;
      useRecordingStore.getState().setChunkCount((prev) => prev + 1);
      useRecordingStore.getState().setLastChunkInfo(
        `${chunk.sample_rate} Hz · ${chunk.channels} ch · ${Math.round(chunk.size / 1024)} KB`,
      );
    }).then((dispose) => {
      unlistenAudio = dispose;
    });

    void listen<SttTranscriptEvent>("stt-transcript", (event) => {
      const { text, is_final } = event.payload;
      if (is_final) {
        useRecordingStore.getState().setFinalTranscript((prev) => [...prev, text]);
        useRecordingStore.getState().setPartialTranscript("");
      } else {
        useRecordingStore.getState().setPartialTranscript(text);
      }
    }).then((dispose) => {
      unlistenStt = dispose;
    });

    void listen<SttStatusEvent>("stt-status", (event) => {
      const nextStatus = `${event.payload.provider}: ${event.payload.status}`;
      useRecordingStore.getState().setSttStatus(nextStatus);
      useLogsStore.getState().addLog(`STT ${nextStatus}`);
    }).then((dispose) => {
      unlistenStatus = dispose;
    });

    void listen<HotkeySessionEvent>("hotkey-session", (event) => {
      useRecordingStore.getState().setHotkeyStatus(event.payload);
      useRecordingStore.getState().setIsRecording(event.payload.state === "recording");
      useLogsStore.getState().addLog(`Hotkey ${event.payload.state}: ${event.payload.message}`);
    }).then((dispose) => {
      unlistenHotkey = dispose;
    });

    void listen<TimingEvent>("timing-log", (event) => {
      const { session_id, stage, elapsed_ms, details } = event.payload;
      useLogsStore.getState().addLog(
        details
          ? `Timing #${session_id} ${stage}: ${elapsed_ms} ms (${details})`
          : `Timing #${session_id} ${stage}: ${elapsed_ms} ms`,
      );
    }).then((dispose) => {
      unlistenTiming = dispose;
    });

    void listen<AgentTaskUpdatedEvent>("agent-task-updated", (event) => {
      const task = event.payload.task;
      useAgentStore.getState().setAgentTasks((prev) => {
        const rest = prev.filter((item) => item.id !== task.id);
        return [task, ...rest].sort((a, b) => b.created_at_ms - a.created_at_ms);
      });
      useAgentStore.getState().setSelectedAgentTaskId((prev) => prev || task.id);
      useLogsStore.getState().addLog(`Agent ${task.status}: ${task.title}`);
    }).then((dispose) => {
      unlistenAgentTask = dispose;
    });

    void listen<AgentNotificationEvent>("agent-notification", (event) => {
      const notification = event.payload;
      useAgentStore.getState().upsertAgentNotification(notification);
      useLogsStore.getState().addLog(`Notify ${notification.status}: ${notification.display_text}`);
    }).then((dispose) => {
      unlistenAgentNotification = dispose;
    });

    return () => {
      unlistenAudio?.();
      unlistenStt?.();
      unlistenStatus?.();
      unlistenHotkey?.();
      unlistenTiming?.();
      unlistenAgentTask?.();
      unlistenAgentNotification?.();
    };
  }, []);
}
