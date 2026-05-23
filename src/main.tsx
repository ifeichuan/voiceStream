import { useState } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import App from "./App";
import LegacyApp from "./LegacyApp";
import Overview from "./pages/Overview";
import Shortcuts from "./pages/Shortcuts";
import Speech from "./pages/Speech";
import Pi from "./pages/Pi";
import Agent from "./pages/Agent";
import Activity from "./pages/Activity";

const REFACTOR_MODE_KEY = "voicestream.refactorMode";

function RefactoredRoutes() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Overview />} />
          <Route path="shortcuts" element={<Shortcuts />} />
          <Route path="speech" element={<Speech />} />
          <Route path="pi" element={<Pi />} />
          <Route path="agent" element={<Agent />} />
          <Route path="activity" element={<Activity />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function RefactorToggleRoot() {
  const [useRefactor, setUseRefactor] = useState(() => {
    return localStorage.getItem(REFACTOR_MODE_KEY) !== "legacy";
  });

  const toggleMode = () => {
    setUseRefactor((current) => {
      const next = !current;
      localStorage.setItem(REFACTOR_MODE_KEY, next ? "refactor" : "legacy");
      return next;
    });
  };

  return (
    <>
      <div className="fixed right-3 bottom-3 z-[9999] max-w-[280px] border border-paper-line bg-paper-surface px-3 py-2 text-[0.76rem] text-paper-ink shadow-[0_18px_54px_color-mix(in_oklch,var(--color-paper-ink)_16%,transparent)]">
        <div className="font-semibold tracking-[-0.02em]">
          临时重构测试开关 · {useRefactor ? "新版" : "旧版"}
        </div>
        <p className="mt-1 mb-2 text-paper-muted [line-height:1.45]">
          仅用于本轮回归测试，验证完成后删除。
        </p>
        <button
          type="button"
          className="min-h-8 rounded-full border border-paper-line bg-transparent px-3 text-paper-accent transition duration-150 hover:-translate-y-px"
          onClick={toggleMode}
        >
          切到{useRefactor ? "旧版" : "新版"}
        </button>
      </div>
      {useRefactor ? <RefactoredRoutes /> : <LegacyApp />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<RefactorToggleRoot />);
