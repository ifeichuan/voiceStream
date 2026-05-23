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
    <div className="grid gap-8 pt-7">
      <section className="section-divider">
        <div className="section-head">
          <div>
            <h3 className="section-title">Notify Channel</h3>
            <p className="mt-1.5 text-paper-muted">VoiceStream 语音通知。</p>
          </div>
        </div>

        <div className="grid gap-3 border-b border-paper-line pb-3">
          {agentNotifications.length === 0 && <div className="text-paper-muted">暂无通知。</div>}
          {agentNotifications.map((notification) => (
            <div
              key={`${notification.task_id}-${notification.timestamp_ms}`}
              className="grid gap-1 border-b border-paper-line py-3 first:pt-0 last:border-b-0"
            >
              <div className="flex items-baseline justify-between gap-4 max-[760px]:flex-col max-[760px]:items-start">
                <strong className="text-[0.95rem] font-semibold">
                  {notification.status === "failed" ? "失败" : "完成"} · {notification.title}
                </strong>
                <span className="shrink-0 text-[0.75rem] text-paper-muted">
                  {new Date(notification.timestamp_ms).toLocaleTimeString()}
                </span>
              </div>
              <p className="m-0 text-[0.86rem] text-paper-muted [line-height:1.55]">
                {notification.summary}
              </p>
              <small className="text-[0.75rem] text-paper-muted">
                {notification.channel} · {notification.spoken_text}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="section-divider">
        <div className="section-head">
          <div>
            <h3 className="section-title">转写</h3>
            <p className="mt-1.5 text-paper-muted">转写结果。</p>
          </div>
        </div>

        <div className="min-h-[180px] border-b border-paper-line bg-transparent pb-3">
          {finalTranscript.map((line, index) => (
            <div key={`${line}-${index}`} className="mt-2 first:mt-0">
              {line}
            </div>
          ))}
          {partialTranscript && <div className="mt-2 text-paper-accent">{partialTranscript}</div>}
          {finalTranscript.length === 0 && !partialTranscript && (
            <div className="text-paper-muted">暂无转写结果。</div>
          )}
        </div>
      </section>

      <section className="section-divider">
        <div className="section-head">
          <div>
            <h3 className="section-title">活动日志</h3>
            <p className="mt-1.5 text-paper-muted">{settingsStatus}</p>
          </div>
        </div>

        <div className="max-h-80 overflow-auto border-b border-paper-line bg-transparent pb-3 font-mono text-[0.88rem] [line-height:1.6]">
          {logs.map((line, index) => (
            <div key={`${line}-${index}`} className="mt-2 first:mt-0">
              {line}
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-4 py-3.5 max-[760px]:flex-col max-[760px]:items-start">
          <span className="text-paper-muted">最近音频包</span>
          <strong className="block break-words text-[1.25rem] font-semibold tracking-[-0.045em]">
            {lastChunkInfo}
          </strong>
        </div>
      </section>
    </div>
  );
}
