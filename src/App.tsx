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
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs((prev) => [
      ...prev.slice(-(MAX_LOGS - 1)),
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    addLog("Ready");

    void listen<AudioChunk>("audio-chunk", (event) => {
      const chunk = event.payload;
      setChunkCount((prev) => prev + 1);
      setLastChunkInfo(
        `${chunk.sample_rate} Hz · ${chunk.channels} ch · ${Math.round(chunk.size / 1024)} KB`,
      );
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error) => {
        addLog(`Audio listener failed: ${getErrorMessage(error)}`);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const startRecording = async () => {
    try {
      const message = await invoke<string>("start_recording");
      setIsRecording(true);
      setChunkCount(0);
      setLastChunkInfo("Waiting for incoming audio chunks...");
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
    </main>
  );
}

export default App;
