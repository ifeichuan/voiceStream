import { useState } from "react";
import { IconClose } from "./Icons";
import Speech from "../pages/Speech";
import Pi from "../pages/Pi";
import Shortcuts from "../pages/Shortcuts";
import { useSettingsStore } from "../stores/settings";

const TABS = [
  { key: "speech", label: "语音识别" },
  { key: "pi", label: "Pi" },
  { key: "shortcuts", label: "快捷键" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("speech");
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const testSettings = useSettingsStore((state) => state.testSettings);
  const isTestingSettings = useSettingsStore((state) => state.isTestingSettings);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-paper-ink/8"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative flex h-[min(80vh,600px)] w-[min(90vw,760px)] overflow-hidden rounded-lg border border-paper-line bg-paper-surface shadow-[0_24px_64px_rgba(0,0,0,0.12)]">
        {/* Left: nav */}
        <div className="flex w-[160px] shrink-0 flex-col justify-between border-r border-paper-line py-4 px-2">
          <div className="flex flex-col gap-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={[
                  "flex h-8 items-center rounded px-2.5 text-[0.82rem] transition-[background-color,color] duration-150",
                  activeTab === tab.key
                    ? "bg-paper-ink/[0.06] text-paper-ink font-medium"
                    : "text-paper-ink/55 hover:text-paper-ink hover:bg-paper-ink/[0.04]",
                ].join(" ")}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="flex flex-col gap-1.5 px-1">
            <button
              className="btn-ghost w-full text-[0.78rem]"
              onClick={testSettings}
              disabled={isTestingSettings}
            >
              {isTestingSettings ? "测试中…" : "测试 STT"}
            </button>
            <button className="btn-primary w-full text-[0.78rem]" onClick={saveSettings}>
              保存
            </button>
          </div>
        </div>

        {/* Right: content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-6 py-3">
            <h2 className="text-[0.88rem] font-semibold tracking-[-0.02em]">
              {TABS.find((t) => t.key === activeTab)?.label}
            </h2>
            <button
              className="flex h-7 w-7 items-center justify-center rounded text-paper-muted transition-colors hover:text-paper-ink"
              onClick={onClose}
              aria-label="关闭设置"
            >
              <IconClose />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {activeTab === "speech" && <Speech />}
            {activeTab === "pi" && <Pi />}
            {activeTab === "shortcuts" && <Shortcuts />}
          </div>
        </div>
      </div>
    </div>
  );
}
