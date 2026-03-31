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
    description: "Speak a short status message out loud for immediate user feedback.",
    promptSnippet: "Speak a short status update aloud when immediate audible feedback would help.",
    promptGuidelines: [
      "Use this tool sparingly for short audible feedback.",
      "Prefer calling this tool once near the start of a task when the user benefits from immediate confirmation.",
      "When available, use it before the main text response if the task involves noticeable processing.",
      "Keep spoken text short, natural, and under 12 Chinese characters or a short English phrase when possible.",
      "This tool starts speech asynchronously and returns immediately.",
      "Each call stops any in-progress say playback before starting the new message.",
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
