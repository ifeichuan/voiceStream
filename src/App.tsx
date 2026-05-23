import { NavLink, Outlet, useLocation } from "react-router-dom";
import { DEFAULT_AGENT_SHORTCUT, DEFAULT_SHORTCUT, NAV_ITEMS } from "./lib/constants";
import { kickerClass, primaryButtonClass, ghostButtonClass } from "./lib/styles";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useRecordingStore } from "./stores/recording";
import { useSettingsStore } from "./stores/settings";

function App() {
  useTauriEvents();

  const location = useLocation();
  const isAgentRoute = location.pathname === "/agent";
  const hotkeyStatus = useRecordingStore((state) => state.hotkeyStatus);
  const shortcutSettings = useSettingsStore((state) => state.shortcutSettings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const testSettings = useSettingsStore((state) => state.testSettings);
  const isTestingSettings = useSettingsStore((state) => state.isTestingSettings);
  const statusTone = hotkeyStatus.state === "recording" ? "recording" : "idle";
  const currentNav =
    NAV_ITEMS.find((item) => item.path === location.pathname) ??
    NAV_ITEMS.find((item) => item.key === "overview");

  return (
    <main className="grid h-screen grid-cols-[248px_minmax(0,1fr)] bg-paper-surface max-[760px]:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="sticky top-0 flex h-screen flex-col justify-between overflow-hidden border-r border-paper-line bg-gradient-to-b from-paper-surface to-paper-surface-soft px-[18px] pt-[22px] pb-[18px]">
        <div className="grid gap-5">
          <div className="flex gap-2 py-[2px]" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]" />
          </div>

          <div className="pr-2.5">
            <p className={kickerClass}>VoiceStream</p>
            <h1 className="mt-2.5 text-[clamp(1.85rem,2.2vw,2.4rem)] leading-[0.98] font-semibold tracking-[-0.07em]">
              语音设置
            </h1>
          </div>
        </div>

        <nav className="mt-2 grid content-start gap-[3px]" aria-label="设置导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) =>
                [
                  "grid w-full gap-0.5 bg-transparent px-2.5 py-[11px] text-left text-inherit no-underline transition duration-150 hover:bg-paper-surface-soft",
                  isActive
                    ? "bg-[color-mix(in_oklch,var(--color-paper-surface-soft)_92%,var(--color-paper-accent)_8%)]"
                    : "",
                ].join(" ")
              }
            >
              <span className="text-[0.95rem] font-semibold">{item.label}</span>
              <small className="text-paper-muted">{item.meta}</small>
            </NavLink>
          ))}
        </nav>

        <div className="mt-[22px] flex items-center gap-3 border-t border-paper-line pt-4">
          <span
            className={[
              "h-[9px] w-[9px] shrink-0 rounded-full",
              statusTone === "recording"
                ? "bg-[oklch(0.66_0.19_25)] shadow-[0_0_0_6px_oklch(0.94_0.02_30)]"
                : "bg-[oklch(0.7_0.012_65)]",
            ].join(" ")}
          />
          <div>
            <strong className="block text-[0.95rem] font-semibold">快捷键</strong>
            <p className="mt-1 text-paper-muted [line-height:1.45]">
              听写 {shortcutSettings.dictation_shortcut || DEFAULT_SHORTCUT}
              <br />
              Agent {shortcutSettings.agent_shortcut || DEFAULT_AGENT_SHORTCUT}
            </p>
          </div>
        </div>
      </aside>

      <section
        className={[
          "flex h-screen flex-col overflow-x-hidden bg-paper-surface px-[42px] max-[760px]:px-[22px]",
          isAgentRoute
            ? "overflow-hidden pb-0"
            : "overflow-y-auto pb-[52px] [scrollbar-gutter:stable] max-[760px]:pb-10",
        ].join(" ")}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-paper-line bg-[color-mix(in_oklch,var(--color-paper-surface)_94%,white_6%)] py-[18px] pt-7 max-[760px]:flex-col max-[760px]:items-start">
          <div>
            <p className={kickerClass}>设置</p>
            <h2 className="mt-1.5 text-[clamp(1.6rem,1.9vw,2.1rem)] font-semibold tracking-[-0.06em]">
              {currentNav?.label ?? "概览"}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button className={ghostButtonClass} onClick={testSettings} disabled={isTestingSettings}>
              {isTestingSettings ? "测试中…" : "测试 STT"}
            </button>
            <button className={primaryButtonClass} onClick={saveSettings}>
              保存设置
            </button>
          </div>
        </header>

        <Outlet />
      </section>
    </main>
  );
}

export default App;
