import { useState, useCallback } from "react";
import { useRecordingStore } from "../stores/recording";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { ShaderOrb } from "../components/ShaderOrb";

export default function Overview() {
  const { isRecording, finalTranscript, audioLevel } = useRecordingStore();
  const { shortcutSettings } = useSettingsStore();
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState("");

  const recentRecords = finalTranscript.slice(-5);

  const handleCollapseEnd = useCallback(() => {
    setStatus("collapsed — ready to hide window");
  }, []);

  const handleExpandEnd = useCallback(() => {
    setStatus("expanded — fully visible");
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-12 py-[2vh]">
      <div className="relative flex items-center justify-center">
        <ShaderOrb
          size={192}
          isActive={isRecording}
          audioLevel={audioLevel}
          collapsed={collapsed}
          collapsedSize={48}
          onCollapseEnd={handleCollapseEnd}
          onExpandEnd={handleExpandEnd}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => { setCollapsed((v) => !v); setStatus("animating..."); }}
          className="rounded-lg bg-paper-ink/10 px-4 py-2 text-sm text-paper-ink transition-colors hover:bg-paper-ink/20"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
        {status && (
          <span className="text-xs text-paper-muted">{status}</span>
        )}
      </div>

      <div className="w-full max-w-[28rem]">
        {recentRecords.length > 0 ? (
          <ul className="grid gap-1">
            {recentRecords.map((line, index) => (
              <li
                key={`${index}-${line.slice(0, 20)}`}
                className="list-item-alive cursor-default truncate rounded px-2 py-2 text-[0.88rem] text-paper-ink/70 hover:bg-paper-ink/[0.03] hover:text-paper-ink"
                title={line}
              >
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-[0.88rem] text-paper-muted">
            尚无语音记录
          </p>
        )}
      </div>

      <footer className="text-center text-[0.75rem] text-paper-muted/60">
        <span className="tabular-nums">
          {shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT} 听写
        </span>
        <span className="mx-3">·</span>
        <span className="tabular-nums">
          {shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT} Agent
        </span>
      </footer>
    </div>
  );
}
