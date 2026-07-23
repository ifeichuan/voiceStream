import { useCallback, useEffect, useRef, useState } from "react";
import { useRecordingStore } from "../stores/recording";
import { useLogsStore } from "../stores/logs";
import { useSettingsStore } from "../stores/settings";
import { useAgentStore } from "../stores/agent";
import { useDictationStore } from "../stores/dictation";

export default function Activity() {
  const { partialTranscript, finalTranscript, lastChunkInfo } = useRecordingStore();
  const { logs } = useLogsStore();
  const { settingsStatus } = useSettingsStore();
  const agentNotifications = useAgentStore((state) => state.agentNotifications);
  const { records, totalCount, searchQuery, isLoading, hasMore, loadMore, setSearchQuery, deleteRecord } =
    useDictationStore();

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSearchQuery(value);
      }, 300);
    },
    [setSearchQuery],
  );

  const handleDelete = useCallback(
    (id: number) => {
      void deleteRecord(id);
    },
    [deleteRecord],
  );

  return (
    <div className="grid gap-12 pt-[2vh]">
      <section>
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">通知</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">SpeakMore 语音通知。</p>

        <div className="mt-6 grid gap-4">
          {agentNotifications.length === 0 && <div className="text-paper-muted">暂无通知。</div>}
          {agentNotifications.map((notification) => (
            <div
              key={`${notification.task_id}-${notification.timestamp_ms}`}
              className="list-item-alive grid gap-1 rounded px-2 py-2.5 hover:bg-paper-ink/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-4 max-[760px]:flex-col max-[760px]:items-start">
                <strong className="text-[0.88rem] font-semibold">
                  {notification.status === "failed"
                    ? "失败"
                    : notification.status === "needs_attention"
                      ? "需要回应"
                      : "完成"} · {notification.title}
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
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">听写历史</h3>
            <p className="mt-1.5 text-[0.86rem] text-paper-muted">
              共 {totalCount} 条记录
            </p>
          </div>
        </div>

        <div className="mt-4">
          <input
            type="text"
            value={localQuery}
            onChange={handleSearchChange}
            placeholder="搜索历史记录..."
            className="w-full rounded bg-paper-ink/[0.04] px-3 py-2 text-[0.86rem] text-paper-ink placeholder:text-paper-muted/60 outline-none transition-colors focus:bg-paper-ink/[0.06]"
          />
        </div>

        <div className="mt-4 grid gap-2">
          {records.length === 0 && !isLoading && (
            <div className="text-[0.88rem] text-paper-muted">
              {searchQuery ? "无匹配结果。" : "暂无听写历史。"}
            </div>
          )}
          {records.map((record) => (
            <div
              key={record.id}
              className="group list-item-alive grid gap-1 rounded px-2 py-2.5 hover:bg-paper-ink/[0.03]"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="m-0 min-w-0 flex-1 text-[0.88rem] text-paper-ink [line-height:1.55]">
                  {record.optimized_text ?? record.raw_text}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[0.75rem] tabular-nums text-paper-muted">
                    {new Date(record.created_at * 1000).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(record.id)}
                    className="rounded p-1 text-paper-muted/40 opacity-0 transition-opacity hover:text-paper-danger group-hover:opacity-100"
                    title="删除"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {record.optimized_text && record.raw_text !== record.optimized_text && (
                <p className="m-0 text-[0.78rem] text-paper-muted/70 [line-height:1.5]">
                  原文: {record.raw_text}
                </p>
              )}
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={isLoading}
              className="mt-2 rounded bg-paper-ink/[0.04] px-3 py-2 text-[0.84rem] text-paper-muted transition-colors hover:bg-paper-ink/[0.07] disabled:opacity-50"
            >
              {isLoading ? "加载中..." : "加载更多"}
            </button>
          )}
        </div>
      </section>

      <section>
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">转写</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">当前会话转写结果。</p>

        <div className="mt-6 min-h-[120px]">
          {finalTranscript.map((line, index) => (
            <div key={`${line}-${index}`} className="list-item-alive mt-1 rounded px-2 py-1.5 text-[0.88rem] first:mt-0 hover:bg-paper-ink/[0.03]">
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
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">日志</h3>
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
