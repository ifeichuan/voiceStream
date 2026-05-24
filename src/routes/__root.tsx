import { useState, useEffect } from "react";
import { createRootRoute, Outlet, useLocation, Link } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
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
  const [accessibility, setAccessibility] = useState(true);

  const isAgent = location.pathname === "/agent";

  useEffect(() => {
    invoke<{ accessibility: boolean }>("check_permissions").then((status) => {
      setAccessibility(status.accessibility);
    });
    const interval = setInterval(() => {
      invoke<{ accessibility: boolean }>("check_permissions").then((status) => {
        setAccessibility(status.accessibility);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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
          {!accessibility && (
            <button
              type="button"
              onClick={() => invoke("open_accessibility_settings")}
              className="mb-1 flex items-center gap-2 rounded bg-[oklch(0.95_0.02_30)] px-2.5 py-2 text-left text-[0.78rem] text-[oklch(0.45_0.15_25)] transition-colors hover:bg-[oklch(0.92_0.03_30)] dark:bg-[oklch(0.25_0.04_30)] dark:text-[oklch(0.8_0.1_25)]"
            >
              <span className="shrink-0 text-[0.9rem]">⚠</span>
              <span className="leading-tight">需要辅助功能权限才能粘贴</span>
            </button>
          )}
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
      <div className="flex min-w-0 flex-1 flex-col  pl-0 pt-0 pr-8 pb-8">
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
