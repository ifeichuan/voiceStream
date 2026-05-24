import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { shortcutFromKeyboardEvent } from "../lib/utils";

export default function Shortcuts() {
  const { shortcutSettings, setShortcutSettings } = useSettingsStore();
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStatus, setCaptureStatus] = useState("");

  useEffect(() => {
    if (!isCapturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const result = shortcutFromKeyboardEvent(event);
      if (result.cancelled) {
        setIsCapturing(false);
        setCaptureStatus("已取消。");
        return;
      }

      if (result.shortcut) {
        setShortcutSettings((prev) => ({ ...prev, agent_shortcut: result.shortcut ?? prev.agent_shortcut }));
        setIsCapturing(false);
        setCaptureStatus("已捕获，保存后生效。");
        return;
      }

      setCaptureStatus(result.status ?? "继续按键…");
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isCapturing, setShortcutSettings]);

  return (
    <div className="grid gap-12 pt-[2vh]">
      <section>
        <h3 className="section-dot text-base font-semibold tracking-[-0.03em]">快捷键</h3>
        <p className="mt-1.5 text-[0.86rem] text-paper-muted">全局快捷键设置。</p>

        <div className="mt-8 grid gap-0">
          {/* Dictation shortcut */}
          <div className="form-row">
            <span className="form-row-label">听写</span>
            <span className="tabular-nums text-[1rem] font-semibold tracking-[-0.02em]">
              {shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT}
            </span>
          </div>

          {/* Agent shortcut */}
          <div className="form-row">
            <span className="form-row-label">Agent</span>
            <div className="flex items-center gap-3">
              <span
                className={[
                  "tabular-nums text-[1rem] font-semibold tracking-[-0.02em]",
                  isCapturing ? "text-paper-accent" : "",
                ].join(" ")}
              >
                {isCapturing
                  ? "等待按键…"
                  : shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT}
              </span>
              <button
                type="button"
                className="min-h-9 min-w-9 rounded bg-transparent px-2.5 text-[0.82rem] text-paper-muted transition-colors duration-150 hover:text-paper-ink active:scale-[0.96]"
                onClick={() => {
                  if (isCapturing) {
                    setIsCapturing(false);
                    setCaptureStatus("已取消。");
                  } else {
                    setIsCapturing(true);
                    setCaptureStatus("请按下新快捷键，Esc 取消。");
                  }
                }}
              >
                {isCapturing ? "取消" : "修改"}
              </button>
            </div>
          </div>
        </div>

        {captureStatus && (
          <p className="mt-4 text-[0.82rem] text-paper-muted">{captureStatus}</p>
        )}

        {/* Reset */}
        <div className="mt-8">
          <button
            type="button"
            className="min-h-10 min-w-10 rounded bg-transparent px-0 text-[0.86rem] text-paper-muted transition-colors duration-150 hover:text-paper-ink active:scale-[0.96]"
            onClick={() => {
              setIsCapturing(false);
              setShortcutSettings((prev) => ({ ...prev, agent_shortcut: DEFAULT_AGENT_SHORTCUT }));
              setCaptureStatus("已恢复默认，保存后生效。");
            }}
          >
            恢复默认
          </button>
        </div>
      </section>
    </div>
  );
}
