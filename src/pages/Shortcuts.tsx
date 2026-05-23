import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { shortcutFromKeyboardEvent } from "../lib/utils";

export default function Shortcuts() {
  const { shortcutSettings, setShortcutSettings } = useSettingsStore();
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStatus, setCaptureStatus] = useState("保存设置后生效。");

  useEffect(() => {
    if (!isCapturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const result = shortcutFromKeyboardEvent(event);
      if (result.cancelled) {
        setIsCapturing(false);
        setCaptureStatus("已取消设置。");
        return;
      }

      if (result.shortcut) {
        setShortcutSettings((prev) => ({ ...prev, agent_shortcut: result.shortcut ?? prev.agent_shortcut }));
        setIsCapturing(false);
        setCaptureStatus("已捕获，保存设置后生效。");
        return;
      }

      setCaptureStatus(result.status ?? "继续按快捷键。");
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isCapturing, setShortcutSettings]);

  return (
    <div className="grid gap-[34px] pt-7">
      <section className="section-divider">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">听写快捷键</span>
            <span className="shortcut-display">
              {shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT}
            </span>
            <small className="text-paper-muted">当前版本固定为听写入口。</small>
          </label>

          <div className="field">
            <span className="field-label">Agent 快捷键</span>
            <button
              className={[
                "min-h-11 border-b px-0 pt-2.5 pb-3 text-left text-[1.12rem] font-semibold tracking-[-0.02em] transition duration-150",
                isCapturing
                  ? "border-paper-accent text-paper-accent"
                  : "border-paper-line text-paper-ink hover:border-paper-accent",
              ].join(" ")}
              type="button"
              onClick={() => {
                setIsCapturing(true);
                setCaptureStatus("请按下新的 Agent 快捷键，Esc 取消。");
              }}
            >
              {isCapturing
                ? "正在等待按键..."
                : shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT}
            </button>
            <small className="text-paper-muted">{captureStatus}</small>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setIsCapturing(true);
              setCaptureStatus("请按下新的 Agent 快捷键，Esc 取消。");
            }}
          >
            {isCapturing ? "等待按键" : "开始设置"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setIsCapturing(false);
              setCaptureStatus("已取消设置。");
            }}
            disabled={!isCapturing}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setIsCapturing(false);
              setShortcutSettings((prev) => ({ ...prev, agent_shortcut: DEFAULT_AGENT_SHORTCUT }));
              setCaptureStatus("已恢复默认，保存设置后生效。");
            }}
          >
            恢复默认
          </button>
        </div>
      </section>
    </div>
  );
}