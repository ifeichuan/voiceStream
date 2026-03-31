import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface AudioChunk {
  timestamp: number;
  sample_rate: number;
  channels: number;
  size: number;
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

const MAX_LOGS = 12;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [lastChunkInfo, setLastChunkInfo] = useState<string>("No audio received yet.");
  const [sttStatus, setSttStatus] = useState("idle");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState<string[]>([]);
  const [sttSettings, setSttSettings] = useState<SttSettingsView>({
    provider: "aliyun-bailian",
    api_endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    model: "fun-asr-realtime",
    workspace_id: "",
    has_api_key: false,
    api_key_hint: "",
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("Not saved");
  const [isTestingSettings, setIsTestingSettings] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs((prev) => [
      ...prev.slice(-(MAX_LOGS - 1)),
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  useEffect(() => {
    let unlistenAudio: (() => void) | undefined;
    let unlistenStt: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    addLog("Ready");

    void invoke<SttSettingsView>("get_stt_settings")
      .then((settings) => {
        setSttSettings(settings);
        setSettingsStatus(settings.has_api_key ? "Saved locally" : "API key not configured");
      })
      .catch((error) => {
        addLog(`Load settings failed: ${getErrorMessage(error)}`);
      });

    void listen<AudioChunk>("audio-chunk", (event) => {
      const chunk = event.payload;
      setChunkCount((prev) => prev + 1);
      setLastChunkInfo(
        `${chunk.sample_rate} Hz · ${chunk.channels} ch · ${Math.round(chunk.size / 1024)} KB`,
      );
    })
      .then((dispose) => {
        unlistenAudio = dispose;
      })
      .catch((error) => {
        addLog(`Audio listener failed: ${getErrorMessage(error)}`);
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

    return () => {
      unlistenAudio?.();
      unlistenStt?.();
      unlistenStatus?.();
    };
  }, []);

  const startRecording = async () => {
    try {
      const message = await invoke<string>("start_recording");
      setIsRecording(true);
      setChunkCount(0);
      setLastChunkInfo("Waiting for incoming audio chunks...");
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
      const saved = await invoke<SttSettingsView>("save_stt_settings", {
        settings: {
          api_key: apiKeyInput,
          api_endpoint: sttSettings.api_endpoint,
          model: sttSettings.model,
          workspace_id: sttSettings.workspace_id,
        },
      });
      setSttSettings(saved);
      setApiKeyInput("");
      setSettingsStatus("Saved locally");
      addLog("STT settings saved");
    } catch (error) {
      const message = getErrorMessage(error);
      setSettingsStatus(`Save failed: ${message}`);
      addLog(`Save settings failed: ${message}`);
    }
  };

  const testSettings = async () => {
    setIsTestingSettings(true);
    setSettingsStatus("Testing connection...");

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
      setSettingsStatus(`Test failed: ${message}`);
      addLog(`Test settings failed: ${message}`);
    } finally {
      setIsTestingSettings(false);
    }
  };

  return (
    <main className="app">
      <section className="panel">
        <p className="eyebrow">VoiceStream</p>
        <h1>Minimal native recorder</h1>
        <p className="summary">
          Record from the default input, stop, then play the latest capture.
        </p>

        <div className="actions">
          <button onClick={isRecording ? stopRecording : startRecording}>
            {isRecording ? "Stop" : "Record"}
          </button>
          <button onClick={playLatest} disabled={isRecording}>
            Play Latest
          </button>
        </div>

        <dl className="stats">
          <div>
            <dt>Status</dt>
            <dd>{isRecording ? "Recording" : "Idle"}</dd>
          </div>
          <div>
            <dt>Chunks</dt>
            <dd>{chunkCount}</dd>
          </div>
          <div>
            <dt>Last Chunk</dt>
            <dd>{lastChunkInfo}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Log</h2>
        <div className="log">
          {logs.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Transcript</h2>
        <p className="summary">Aliyun Bailian STT status: {sttStatus}</p>
        <div className="transcript">
          {finalTranscript.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
          {partialTranscript && <div className="partial">{partialTranscript}</div>}
          {finalTranscript.length === 0 && !partialTranscript && (
            <div className="placeholder">No transcript yet.</div>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Settings</h2>
        <p className="summary">
          Provider: {sttSettings.provider}. Credentials are stored in the local app
          support directory and read by Rust at runtime.
        </p>

        <div className="settings-grid">
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder={sttSettings.has_api_key ? "Saved locally. Leave blank to keep it." : "sk-..."}
            />
            {sttSettings.has_api_key && (
              <small className="field-hint">Saved key: {sttSettings.api_key_hint}</small>
            )}
          </label>

          <label>
            <span>API Endpoint</span>
            <input
              type="text"
              value={sttSettings.api_endpoint}
              onChange={(event) =>
                setSttSettings((prev) => ({ ...prev, api_endpoint: event.target.value }))
              }
            />
          </label>

          <label>
            <span>Model</span>
            <input
              type="text"
              value={sttSettings.model}
              onChange={(event) =>
                setSttSettings((prev) => ({ ...prev, model: event.target.value }))
              }
            />
          </label>

          <label>
            <span>Workspace ID</span>
            <input
              type="text"
              value={sttSettings.workspace_id}
              onChange={(event) =>
                setSttSettings((prev) => ({ ...prev, workspace_id: event.target.value }))
              }
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="actions">
          <button onClick={saveSettings}>Save STT Settings</button>
          <button onClick={testSettings} disabled={isTestingSettings}>
            {isTestingSettings ? "Testing..." : "Test Connection"}
          </button>
        </div>

        <p className="summary">{settingsStatus}</p>
      </section>
    </main>
  );
}

export default App;
