import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SHORTCUT, DEFAULT_AGENT_SHORTCUT } from "../lib/constants";
import { shortcutFromKeyboardEvent } from "../lib/utils";
import {
  mutedClass,
  primaryButtonClass,
  ghostButtonClass,
  sectionClass,
  sectionHeadClass,
  sectionTitleClass,
  formGridClass,
  fieldClass,
  fieldLabelClass,
  shortcutDisplayClass,
} from "../lib/styles";

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
      <section className={sectionClass}>
        <div className={sectionHeadClass}>
          <div>
            <h3 className={sectionTitleClass}>全局快捷键</h3>
            <p className={`mt-1.5 ${mutedClass}`}>Agent 任务入口。</p>
          </div>
        </div>

        <div className={formGridClass}>
          <label className={fieldClass}>
            <span className={fieldLabelClass}>听写快捷键</span>
            <span className={shortcutDisplayClass}>
              {shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT}
            </span>
            <small className={mutedClass}>当前版本固定为听写入口。</small>
          </label>

          <div className={fieldClass}>
            <span className={fieldLabelClass}>Agent 快捷键</span>
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
            <small className={mutedClass}>{captureStatus}</small>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              setIsCapturing(true);
              setCaptureStatus("请按下新的 Agent 快捷键，Esc 取消。");
            }}
          >
            {isCapturing ? "等待按键" : "开始设置"}
          </button>
          <button
            type="button"
            className={ghostButtonClass}
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
            className={ghostButtonClass}
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
