import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFile, spawn } from "node:child_process";

type JsonRecord = Record<string, unknown>;

let lastUserPrompt = "";

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  const chars = Array.from(compactWhitespace(value));
  if (chars.length <= maxLength) return chars.join("");
  return `${chars.slice(0, maxLength).join("")}…`;
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return compactWhitespace(value.map((item) => extractText(item, depth + 1)).filter(Boolean).join(" "));
  }

  const record = asRecord(value);
  if (!record) return "";

  for (const key of ["text", "content", "summary", "message", "title"]) {
    const text = extractText(record[key], depth + 1);
    if (text) return text;
  }

  return "";
}

function messageRole(message: unknown): string {
  const record = asRecord(message);
  return typeof record?.role === "string" ? record.role : "";
}

function messagesFromEvent(event: unknown): unknown[] {
  const record = asRecord(event);
  return Array.isArray(record?.messages) ? record.messages : [];
}

function finalAssistantText(event: unknown): string {
  const messages = messagesFromEvent(event);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (messageRole(message) === "assistant") {
      const text = extractText(asRecord(message)?.content ?? message);
      if (text) return text;
    }
  }

  return extractText(event);
}

function defaultInboxPath(cwd: string | undefined): string {
  return join(cwd || process.cwd(), ".pi", "notify-channel.jsonl");
}

function notifyInboxPath(ctx: unknown): string {
  const configured = process.env.VOICESTREAM_NOTIFY_INBOX?.trim();
  if (configured) return configured;

  const cwd = asRecord(ctx)?.cwd;
  return defaultInboxPath(typeof cwd === "string" ? cwd : undefined);
}

function appendInbox(ctx: unknown, payload: JsonRecord): void {
  const path = notifyInboxPath(ctx);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function shouldAutoSay(): boolean {
  return process.env.VOICESTREAM_NOTIFY_AUTO_SAY !== "0";
}

function killExistingSay(): Promise<void> {
  return new Promise((resolve) => {
    execFile("killall", ["say"], () => resolve());
  });
}

async function speak(text: string): Promise<void> {
  const spoken = truncate(text, 96);
  if (!spoken || !shouldAutoSay()) return;

  await killExistingSay();
  const child = spawn("say", [spoken], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function buildNotification(event: unknown, ctx: unknown): JsonRecord {
  const summary = truncate(finalAssistantText(event) || "Agent 已完成，等待下一步输入。", 160);
  const title = truncate(lastUserPrompt || "Agent 任务", 64);
  const cwd = asRecord(ctx)?.cwd;

  return {
    version: 1,
    source: "voicestream-notify",
    status: "completed",
    title,
    summary,
    spokenText: `Agent 任务已完成：${truncate(summary, 92)}`,
    timestamp: new Date().toISOString(),
    cwd: typeof cwd === "string" ? cwd : undefined,
  };
}

export default function voicestreamNotifyExtension(pi: ExtensionAPI) {
  pi.on("message_end", async (event) => {
    const message = asRecord(event)?.message;
    if (messageRole(message) !== "user") return;

    const prompt = extractText(asRecord(message)?.content ?? message);
    if (prompt) lastUserPrompt = truncate(prompt, 96);
  });

  pi.on("agent_end", async (event, ctx) => {
    const notification = buildNotification(event, ctx);
    appendInbox(ctx, notification);
    await speak(String(notification.spokenText || notification.summary || ""));
  });
}
