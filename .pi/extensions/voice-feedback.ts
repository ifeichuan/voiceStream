import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile, spawn } from "node:child_process";

function killExistingSay(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("killall", ["say"], (error) => {
      if (!error) {
        resolve();
        return;
      }

      const code = typeof error.code === "number" ? error.code : undefined;
      if (code === 1) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function startSay(text: string): { pid: number | undefined } {
  const child = spawn("say", [text], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  return { pid: child.pid };
}

export default function voiceFeedbackExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "voice_feedback",
    label: "Voice Feedback",
    description: "Speak one short, content-aware sentence before responding.",
    promptSnippet: "Before responding, call this once with one short sentence that fits the current text.",
    promptGuidelines: [
      "Call this once near the start when audible feedback is useful.",
      "Use one short, natural sentence that fits the current text.",
      "Prefer a complete sentence rather than a fragment, usually around 8 to 20 Chinese characters.",
      "Do not repeat the full input or give a long summary.",
      "Call it before the main text output.",
      "Speech starts asynchronously and interrupts any previous say playback.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "Short text to speak aloud" }),
    }),
    async execute(_toolCallId, params) {
      const text = String(params.text || "").trim();
      if (!text) {
        return {
          content: [{ type: "text", text: "No speech played: empty text." }],
          details: { spoken: false, started: false, reason: "empty-text" },
        };
      }

      try {
        await killExistingSay();
        const { pid } = startSay(text);
        return {
          content: [{ type: "text", text: `Speech started: ${text}` }],
          details: { spoken: true, started: true, text, pid, interruptedPrevious: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Speech failed: ${message}` }],
          details: { spoken: false, started: false, error: message, text },
        };
      }
    },
  });
}
