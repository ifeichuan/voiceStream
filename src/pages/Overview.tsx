import { useRecordingStore } from "../stores/recording";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { ShaderOrb } from "../components/ShaderOrb";

export default function Overview() {
  const { isRecording, finalTranscript, audioLevel } = useRecordingStore();
  const { shortcutSettings } = useSettingsStore();

  const recentRecords = finalTranscript.slice(-5);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-12 py-[2vh]">
      <div className="relative flex items-center justify-center">
        <ShaderOrb
          size={192}
          isActive={isRecording}
          audioLevel={audioLevel}
        />
      </div>

      <div className="w-full max-w-[28rem]">
        {recentRecords.length > 0 ? (
          <ul className="grid gap-2">
            {recentRecords.map((line, index) => (
              <li
                key={`${index}-${line.slice(0, 20)}`}
                className="cursor-default truncate py-1.5 text-[0.88rem] text-paper-ink/80 transition-colors duration-150 hover:text-paper-ink"
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
