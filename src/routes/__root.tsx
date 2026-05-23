import { useState } from "react";
import { createRootRoute, Outlet, useLocation, Link } from "@tanstack/react-router";
import { useTauriEvents } from "../hooks/useTauriEvents";
import { useRecordingStore } from "../stores/recording";
import { IconHome, IconAgent, IconActivity, IconSettings } from "../components/Icons";
import { SettingsDialog } from "../components/SettingsDialog";
import Agent from "../pages/Agent";

const NAV_ITEMS = [
  { label: "首页", to: "/", icon: IconHome },
  { label: "Agent", to: "/agent", icon: IconAgent },
  { label: "活动", to: "/activity", icon: IconActivity },
] as const;

function RootLayout() {
  useTauriEvents();

  const location = useLocation();
  const hotkeyStatus = useRecordingStore((state) => state.hotkeyStatus);
  const statusTone = hotkeyStatus.state === "recording" ? "recording" : "idle";
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isAgent = location.pathname === "/agent";

  return (
    <main className="flex h-screen min-w-0 bg-paper-surface">
      {/* Sidebar */}
      <aside className="flex h-screen w-[180px] shrink-0 flex-col justify-between bg-paper-surface px-2 py-4" data-tauri-drag-region>
        <div className="flex flex-col">
          <div className="flex h-10 items-center gap-2 px-2.5" data-tauri-drag-region>
            <span
              className={[
                "h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-300",
                statusTone === "recording"
                  ? "bg-[oklch(0.66_0.19_25)] shadow-[0_0_0_3px_oklch(0.94_0.02_30)]"
                  : "bg-paper-accent",
              ].join(" ")}
            />
            <span className="text-[0.84rem] font-semibold tracking-[-0.02em]">VoiceStream</span>
          </div>

          <nav className="mt-3 flex flex-col gap-0.5" aria-label="主导航">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  activeProps={{ className: "bg-paper-ink/[0.06] text-paper-ink font-medium" }}
                  inactiveProps={{ className: "text-paper-ink/55 hover:text-paper-ink hover:bg-paper-ink/[0.04]" }}
                  className="flex h-9 items-center gap-2.5 rounded px-2.5 text-[0.86rem] transition-[background-color,color] duration-150"
                >
                  <Icon className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 items-center gap-2.5 rounded px-2.5 text-[0.86rem] text-paper-ink/55 transition-[background-color,color] duration-150 hover:bg-paper-ink/[0.04] hover:text-paper-ink"
          >
            <IconSettings className="shrink-0" />
            <span>设置</span>
          </button>
        </div>
      </aside>

      {/* Content wrapper */}
      <div className="flex min-w-0 flex-1 flex-col p-[10px] pl-0">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-[#1a1717] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
          {/* Agent always mounted */}
          <div className={isAgent ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}>
            <div className="flex h-full w-full flex-col overflow-hidden px-8">
              <Agent />
            </div>
          </div>

          {/* Other routes mount/unmount normally */}
          {!isAgent && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
              <div className="w-full px-8 pb-12">
                <Outlet />
              </div>
            </div>
          )}
        </section>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
