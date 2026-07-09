import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AgentAskPromptEvent } from "../types";

type Mode = "select" | "edit";

export default function AskOverlay() {
  const [prompt, setPrompt] = useState<AgentAskPromptEvent | null>(null);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("请选择一个选项。");
  const [mode, setMode] = useState<Mode>("select");
  const [editText, setEditText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void invoke<AgentAskPromptEvent | null>("get_pending_ask_prompt")
      .then((next) => {
        setPrompt(next);
        const firstOption = next?.questions[0]?.options[0]?.label ?? "";
        setSelected(firstOption);
        if (!next?.questions[0]?.options?.length) {
          setMode("edit");
          setStatus("输入自定义回复后提交。");
        }
      })
      .catch(() => setStatus("读取问题失败。"));

    let unlisten: (() => void) | undefined;
    void listen<AgentAskPromptEvent>("agent-ask-prompt", (event) => {
      setPrompt(event.payload);
      const firstOption = event.payload.questions[0]?.options[0]?.label ?? "";
      setSelected(firstOption);
      const hasOptions = (event.payload.questions[0]?.options?.length ?? 0) > 0;
      setMode(hasOptions ? "select" : "edit");
      setEditText("");
      setStatus(hasOptions ? "请选择一个选项。" : "输入自定义回复后提交。");
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const question = prompt?.questions[0];
  const options = question?.options ?? [];
  const selectedOption = useMemo(
    () => options.find((option) => option.label === selected),
    [options, selected],
  );

  const switchToEdit = () => {
    const initial = selected
      ? `${selected}${selectedOption?.description ? ` — ${selectedOption.description}` : ""}`
      : "";
    setEditText(initial);
    setMode("edit");
    setStatus("输入自定义回复后提交。");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const switchToSelect = () => {
    setMode("select");
    setStatus("请选择一个选项。");
  };

  const submit = async () => {
    if (!prompt || !question || submitting) return;

    if (mode === "edit") {
      const text = editText.trim();
      if (!text) {
        setStatus("请输入回复内容。");
        return;
      }
      setSubmitting(true);
      setStatus("正在提交...");
      try {
        await invoke("submit_ask_prompt_answer", {
          taskId: prompt.task_id,
          answer: `${question.question}\n${text}`,
        });
      } catch (e) {
        setStatus(`提交失败：${e}`);
        setSubmitting(false);
      }
      return;
    }

    if (!selected) {
      setStatus("请选择一个选项。");
      return;
    }
    setSubmitting(true);
    setStatus("正在提交...");
    try {
      const description = selectedOption?.description ? ` — ${selectedOption.description}` : "";
      await invoke("submit_ask_prompt_answer", {
        taskId: prompt.task_id,
        answer: `${question.question}\n${selected}${description}`,
      });
    } catch (e) {
      setStatus(`提交失败：${e}`);
      setSubmitting(false);
    }
  };

  if (!prompt || !question) {
    return (
      <main className="grid h-screen place-items-center bg-transparent px-4">
        <section className="w-full rounded-2xl border border-paper-line bg-paper-surface px-5 py-4 text-paper-ink shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <p className="text-sm text-paper-muted">暂无待回应问题。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid h-screen place-items-center bg-transparent px-4" data-tauri-drag-region>
      <section className="w-full rounded-2xl border border-paper-line bg-paper-surface px-5 py-4 text-paper-ink shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker">{question.header || "Agent 提问"}</p>
            <h1 className="mt-2 text-base font-semibold tracking-[-0.03em]">{question.question}</h1>
            <p className="mt-1 text-[0.78rem] text-paper-muted">{prompt.title}</p>
          </div>
          {options.length > 0 && (
            <button
              type="button"
              onClick={mode === "select" ? switchToEdit : switchToSelect}
              className="btn-ghost shrink-0 text-[0.75rem]"
            >
              {mode === "select" ? "修改模式" : "选择模式"}
            </button>
          )}
        </div>

        {mode === "select" && (
          <div className="mt-4 grid gap-2">
            {options.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setSelected(option.label)}
                className={[
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected === option.label
                    ? "border-paper-accent bg-paper-accent/10"
                    : "border-paper-line bg-transparent hover:bg-paper-ink/[0.04]",
                ].join(" ")}
              >
                <span className="block text-[0.86rem] font-semibold">{option.label}</span>
                {option.description && (
                  <span className="mt-1 block text-[0.75rem] leading-5 text-paper-muted">
                    {option.description}
                  </span>
                )}
              </button>
            ))}
            {options.length === 0 && (
              <div className="rounded-lg border border-paper-line px-3 py-3 text-[0.82rem] text-paper-muted">
                这个问题没有结构化选项，切换到修改模式自由输入。
              </div>
            )}
          </div>
        )}

        {mode === "edit" && (
          <div className="mt-4">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="输入自定义回复..."
              className="w-full resize-none rounded-lg border border-paper-line bg-transparent px-3 py-2.5 text-[0.86rem] text-paper-ink outline-none placeholder:text-paper-muted/60 focus:border-paper-accent"
              rows={4}
            />
            <p className="mt-1.5 text-[0.7rem] text-paper-muted">⌘+Enter 快速提交</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="truncate text-[0.75rem] text-paper-muted">{status}</p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || (mode === "select" ? !selected : !editText.trim())}
            className="btn-primary min-h-9 px-3 text-[0.78rem] font-semibold"
          >
            {submitting ? "提交中..." : mode === "select" ? "提交选择" : "提交回复"}
          </button>
        </div>
      </section>
    </main>
  );
}
