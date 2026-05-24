import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";

interface RpcTerminalConfig {
  model?: string;
  provider?: string;
  thinking?: string;
  system_prompt?: string;
  no_extensions?: boolean;
  no_skills?: boolean;
  no_prompt_templates?: boolean;
  no_themes?: boolean;
  extensions?: string[];
  cols?: number;
  rows?: number;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

export default function RpcTerminal() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [running, setRunning] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [timings, setTimings] = useState<{ event_type: string; elapsed_ms: number; details: string }[]>([]);

  const [model, setModel] = useState("deepseek/deepseek-v4-flash");
  const [thinking, setThinking] = useState("off");
  const [systemPrompt, setSystemPrompt] = useState(
    "你是语音输入法的文本整理助手。只做最小必要整理，只输出最终文本。"
  );
  const [noExtensions, setNoExtensions] = useState(true);
  const [noSkills, setNoSkills] = useState(true);
  const [noPromptTemplates, setNoPromptTemplates] = useState(true);
  const [noThemes, setNoThemes] = useState(true);

  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      cols: 120,
      rows: 30,
      scrollback: 10000,
      allowProposedApi: true,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#1a1717",
        foreground: "#e8e0dc",
        cursor: "#e8e0dc",
      },
    });

    const fit = new FitAddon();
    const unicode = new Unicode11Addon();
    term.loadAddon(fit);
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";
    term.open(termRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(termRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ data: number[] }>("rpc-terminal-output", (event) => {
      if (xtermRef.current) {
        xtermRef.current.write(new Uint8Array(event.payload.data));
      }
    });

    const unlistenStatus = listen<{ status: string; message: string }>(
      "rpc-terminal-status",
      (event) => {
        setRunning(event.payload.status === "running");
        if (xtermRef.current) {
          xtermRef.current.writeln(`\r\n[${event.payload.status}] ${event.payload.message}`);
        }
      }
    );

    const unlistenTiming = listen<{ event_type: string; elapsed_ms: number; details: string }>(
      "rpc-terminal-timing",
      (event) => {
        setTimings((prev) => [...prev.slice(-19), event.payload]);
      }
    );

    return () => {
      unlisten.then((f) => f());
      unlistenStatus.then((f) => f());
      unlistenTiming.then((f) => f());
    };
  }, []);

  const handleStart = useCallback(async () => {
    const config: RpcTerminalConfig = {
      model: model || undefined,
      thinking: thinking || undefined,
      system_prompt: systemPrompt || undefined,
      no_extensions: noExtensions,
      no_skills: noSkills,
      no_prompt_templates: noPromptTemplates,
      no_themes: noThemes,
      cols: fitRef.current ? xtermRef.current?.cols : 120,
      rows: fitRef.current ? xtermRef.current?.rows : 30,
    };

    try {
      xtermRef.current?.clear();
      xtermRef.current?.writeln(`[starting] model=${config.model} thinking=${config.thinking}`);
      await invoke("start_rpc_terminal", { config });
      setRunning(true);
    } catch (e) {
      xtermRef.current?.writeln(`\r\n[error] ${e}`);
    }
  }, [model, thinking, systemPrompt, noExtensions, noSkills, noPromptTemplates, noThemes]);

  const handleStop = useCallback(async () => {
    await invoke("stop_rpc_terminal");
    setRunning(false);
  }, []);

  const sendJson = useCallback(
    async (json: string) => {
      if (!running) return;
      try {
        if (json.includes('"type":"prompt"')) {
          setTimings([]);
        }
        await invoke("write_rpc_terminal", { data: json + "\n" });
        xtermRef.current?.writeln(`\r\n>>> ${json}`);
      } catch (e) {
        xtermRef.current?.writeln(`\r\n[write error] ${e}`);
      }
    },
    [running]
  );

  const sendPrompt = useCallback(() => {
    if (!messageText.trim()) return;
    const json = JSON.stringify({ id: `p-${Date.now()}`, type: "prompt", message: messageText });
    sendJson(json);
    setMessageText("");
  }, [messageText, sendJson]);

  const sendNewSession = useCallback(() => {
    sendJson(JSON.stringify({ id: `s-${Date.now()}`, type: "new_session" }));
  }, [sendJson]);

  const sendGetMessages = useCallback(() => {
    sendJson(JSON.stringify({ id: `m-${Date.now()}`, type: "get_messages" }));
  }, [sendJson]);

  return (
    <div className="flex h-full flex-col gap-3 py-6">
      <h2 className="text-lg font-semibold">Pi RPC Terminal</h2>

      {/* Config */}
      <div className="flex flex-wrap items-end gap-3 text-[0.8rem]">
        <label className="flex flex-col gap-1">
          <span className="text-paper-ink/50">Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-7 w-52 rounded border border-paper-ink/10 bg-paper-surface px-2 text-[0.8rem]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-paper-ink/50">Thinking</span>
          <select
            value={thinking}
            onChange={(e) => setThinking(e.target.value)}
            className="h-7 rounded border border-paper-ink/10 bg-paper-surface px-2 text-[0.8rem]"
          >
            {THINKING_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={noExtensions} onChange={(e) => setNoExtensions(e.target.checked)} />
          <span>no-ext</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={noSkills} onChange={(e) => setNoSkills(e.target.checked)} />
          <span>no-skills</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={noPromptTemplates} onChange={(e) => setNoPromptTemplates(e.target.checked)} />
          <span>no-tpl</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={noThemes} onChange={(e) => setNoThemes(e.target.checked)} />
          <span>no-themes</span>
        </label>

        <button
          onClick={running ? handleStop : handleStart}
          className={`h-7 rounded px-3 text-[0.8rem] font-medium text-white ${running ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"}`}
        >
          {running ? "Stop" : "Start"}
        </button>
      </div>

      {/* System prompt */}
      <textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="System prompt..."
        rows={2}
        className="w-full resize-none rounded border border-paper-ink/10 bg-paper-surface px-2 py-1.5 text-[0.8rem]"
      />

      {/* Message composer */}
      <div className="flex items-center gap-2">
        <input
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendPrompt()}
          placeholder="Message text..."
          className="h-7 min-w-0 flex-1 rounded border border-paper-ink/10 bg-paper-surface px-2 text-[0.8rem]"
        />
        <button onClick={sendPrompt} disabled={!running} className="h-7 rounded bg-blue-600 px-3 text-[0.8rem] font-medium text-white disabled:opacity-40">
          Send Prompt
        </button>
        <button onClick={sendNewSession} disabled={!running} className="h-7 rounded bg-paper-ink/10 px-2 text-[0.8rem] disabled:opacity-40">
          new_session
        </button>
        <button onClick={sendGetMessages} disabled={!running} className="h-7 rounded bg-paper-ink/10 px-2 text-[0.8rem] disabled:opacity-40">
          get_messages
        </button>
      </div>

      {/* Timing panel */}
      {timings.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[0.75rem] font-mono">
          {timings.map((t, i) => (
            <span key={i} className="rounded bg-paper-ink/5 px-1.5 py-0.5">
              <span className="font-medium text-blue-600">{t.event_type}</span>
              <span className="text-paper-ink/50"> {t.elapsed_ms}ms</span>
              {t.details && <span className="text-paper-ink/40"> ({t.details})</span>}
            </span>
          ))}
        </div>
      )}

      {/* Terminal */}
      <div ref={termRef} className="min-h-0 flex-1 overflow-hidden rounded border border-paper-ink/10" />
    </div>
  );
}
