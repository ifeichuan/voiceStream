import { useRecordingStore } from "../stores/recording";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";

export default function Overview() {
  const { isRecording, finalTranscript } = useRecordingStore();
  const { shortcutSettings } = useSettingsStore();

  const recentRecords = finalTranscript.slice(-5);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-12 py-[2vh]">
      {/* Dynamic visual element */}
      <div className="relative flex items-center justify-center">
        <svg
          width="160"
          height="160"
          viewBox="0 0 160 160"
          className="overflow-visible"
          aria-hidden="true"
        >
          {/* Outer ring - breathing */}
          <circle
            cx="80"
            cy="80"
            r="64"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className={[
              "text-paper-line transition-all duration-500",
              isRecording ? "overview-ring-active" : "overview-ring-idle",
            ].join(" ")}
          />
          {/* Inner ring */}
          <circle
            cx="80"
            cy="80"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={[
              "transition-all duration-500",
              isRecording ? "text-paper-accent overview-ring-active-inner" : "text-paper-muted/30 overview-ring-idle-inner",
            ].join(" ")}
          />
          {/* Center dot */}
          <circle
            cx="80"
            cy="80"
            r="4"
            fill="currentColor"
            className={[
              "transition-colors duration-300",
              isRecording ? "text-paper-accent" : "text-paper-muted",
            ].join(" ")}
          />
        </svg>
      </div>

      {/* Recent records */}
      <div className="w-full max-w-[28rem]">
        {recentRecords.length > 0 ? (
          <ul className="grid gap-2">
            {recentRecords.map((line, index) => (
              <li
                key={`${index}-${line.slice(0, 20)}`}
                className="group cursor-default truncate py-1.5 text-[0.88rem] text-paper-ink/80 transition-colors duration-150 hover:text-paper-ink"
                title={line}
              >
                <span className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap group-hover:whitespace-normal group-hover:overflow-visible">
                  {line}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-[0.88rem] text-paper-muted">
            尚无语音记录
          </p>
        )}
      </div>

      {/* Shortcut hints */}
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
