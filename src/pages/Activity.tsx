import { useRecordingStore } from "../stores/recording";
import { useLogsStore } from "../stores/logs";
import { useSettingsStore } from "../stores/settings";
import { useAgentStore } from "../stores/agent";

export default function Activity() {
  const { partialTranscript, finalTranscript, lastChunkInfo } = useRecordingStore();
  const { logs } = useLogsStore();
  const { settingsStatus } = useSettingsStore();
  const agentNotifications = useAgentStore((state) => state.agentNotifications);

  return (
    <div className="grid gap-12 pt-[2vh]">
      <section>
        <h3 className="text-base font-semibold tracking-[-0.03em]">通知</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">VoiceStream 语音通知。</p>

        <div className="mt-6 grid gap-4">
          {agentNotifications.length === 0 && <div className="text-paper-muted">暂无通知。</div>}
          {agentNotifications.map((notification) => (
            <div
              key={`${notification.task_id}-${notification.timestamp_ms}`}
              className="grid gap-1 py-2"
            >
              <div className="flex items-baseline justify-between gap-4 max-[760px]:flex-col max-[760px]:items-start">
                <strong className="text-[0.88rem] font-semibold">
                  {notification.status === "failed" ? "失败" : "完成"} · {notification.title}
                </strong>
                <span className="shrink-0 text-[0.75rem] tabular-nums text-paper-muted">
                  {new Date(notification.timestamp_ms).toLocaleTimeString()}
                </span>
              </div>
              <p className="m-0 text-[0.82rem] text-paper-muted [line-height:1.55]">
                {notification.summary}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold tracking-[-0.03em]">转写</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">转写结果。</p>

        <div className="mt-6 min-h-[120px]">
          {finalTranscript.map((line, index) => (
            <div key={`${line}-${index}`} className="mt-2 text-[0.88rem] first:mt-0">
              {line}
            </div>
          ))}
          {partialTranscript && (
            <div className="mt-2 text-[0.88rem] text-paper-accent">{partialTranscript}</div>
          )}
          {finalTranscript.length === 0 && !partialTranscript && (
            <div className="text-[0.88rem] text-paper-muted">暂无转写结果。</div>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold tracking-[-0.03em]">日志</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">{settingsStatus}</p>

        <div className="mt-6 max-h-80 overflow-auto font-mono text-[0.82rem] leading-[1.65]">
          {logs.map((line, index) => (
            <div key={`${line}-${index}`} className="mt-2 first:mt-0">
              {line}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-baseline justify-between gap-4">
          <span className="text-[0.82rem] text-paper-muted">最近音频包</span>
          <span className="text-[0.88rem] font-semibold">{lastChunkInfo}</span>
        </div>
      </section>
    </div>
  );
}
