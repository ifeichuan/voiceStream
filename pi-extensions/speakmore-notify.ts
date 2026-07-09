import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
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
  const configured = process.env.SPEAKMORE_NOTIFY_INBOX?.trim();
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
  return process.env.SPEAKMORE_NOTIFY_AUTO_SAY !== "0";
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
    source: "speakmore-notify",
    status: "completed",
    title,
    summary,
    spokenText: `Agent 任务已完成：${truncate(summary, 92)}`,
    timestamp: new Date().toISOString(),
    cwd: typeof cwd === "string" ? cwd : undefined,
  };
}

/**
 * Extract the full conversation from an agent_end event as text.
 * Includes user + assistant messages so the model has context.
 */
function buildConversationText(event: unknown): string {
  const messages = messagesFromEvent(event);
  const parts: string[] = [];

  for (const msg of messages) {
    const role = messageRole(msg);
    if (role !== "user" && role !== "assistant") continue;

    const text = extractText(asRecord(msg)?.content ?? msg);
    if (text.trim()) {
      parts.push(
        role === "user" ? `用户：${text}` : `Assistant：${text}`,
      );
    }
  }

  return parts.join("\n\n");
}

/**
 * Use pi's own model to generate a concise Chinese summary of the conversation.
 * Returns null if the model or API key is unavailable (falls back to truncation).
 */
async function generateAISummary(
  event: unknown,
  model: any,
  modelRegistry: any,
): Promise<string | null> {
  const conversationText = buildConversationText(event);
  if (!conversationText.trim()) return null;
  if (!model) return null;

  const auth = await modelRegistry?.getApiKeyAndHeaders?.(model);
  if (!auth?.ok || !auth.apiKey) return null;

  try {
    const summaryMessages = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: [
              "请为以下对话生成一段简洁的中文摘要（不超过 120 字）。",
              "摘要应包含：任务目标、关键发现或结果、下一步建议。",
              "直接输出摘要，不要加任何前缀或格式。",
              "",
              "<conversation>",
              truncate(conversationText, 4000),
              "</conversation>",
            ].join("\n"),
          },
        ],
        timestamp: Date.now(),
      },
    ];

    const response = await complete(
      model,
      { messages: summaryMessages },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 512,
      },
    );

    const summary = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    if (summary) return summary;
  } catch (_error) {
    // Ignore failures; fallback to text truncation
  }

  return null;
}

export default function speakmoreNotifyExtension(pi: ExtensionAPI) {
  // ── register tool: summarize_session ──
  // Lets the LLM explicitly request a summary + speech at the end of a task.
  pi.registerTool({
    name: "summarize_session",
    label: "Summarize Session",
    description:
      "Generate a concise Chinese summary of the full conversation and speak it aloud. " +
      "Call this at the end of a task. The summary includes task goal, key results, and next steps.",
    promptSnippet: "Summarize task results and speak them aloud",
    promptGuidelines: [
      "Use summarize_session at the end of a task to provide spoken feedback.",
      "Do not call a separate speech tool — summarize_session handles summary + speech.",
    ],
    parameters: Type.Object({
      text: Type.String({
        description: "The full assistant output to summarize and speak aloud.",
      }),
    }),
    async execute(_toolCallId, params) {
      const input = params as { text: string };
      const raw = input.text?.trim() || "";
      if (!raw) {
        return {
          content: [{ type: "text", text: "未提供文本，无法生成摘要。" }],
          details: { spoken: false, reason: "empty-text" },
        };
      }

      // Truncate for speech (keep it short for TTS)
      const summaryText = truncate(raw, 120);
      const spoken = `Agent 任务已完成：${summaryText}`;
      await speak(spoken);

      return {
        content: [{ type: "text", text: `已生成摘要并朗读：${summaryText}` }],
        details: { spoken: true, summary: summaryText, spokenText: spoken },
      };
    },
  });

  // ── record user prompts for title context ──
  pi.on("message_end", async (event) => {
    const message = asRecord(event)?.message;
    if (messageRole(message) !== "user") return;

    const prompt = extractText(asRecord(message)?.content ?? message);
    if (prompt) lastUserPrompt = truncate(prompt, 96);
  });

  // ── agent_end: generate a true AI summary and speak it ──
  pi.on("agent_end", async (event, ctx) => {
    // 1. Try to generate a real AI summary using pi's current model
    let spokenText: string;

    if (shouldAutoSay()) {
      const aiSummary = await generateAISummary(event, ctx.model, ctx.modelRegistry);
      if (aiSummary) {
        spokenText = `Agent 任务已完成：${truncate(aiSummary, 96)}`;
      } else {
        // Fallback: text-truncation-based summary (original behavior)
        const rawText = finalAssistantText(event) || "Agent 已完成，等待下一步输入。";
        spokenText = `Agent 任务已完成：${truncate(rawText, 92)}`;
      }
    } else {
      spokenText = "";
    }

    // 2. Write to inbox channel (always uses truncated text for compact storage)
    const notification = buildNotification(event, ctx);
    appendInbox(ctx, notification);

    // 3. Speak the summary aloud
    if (spokenText) {
      await speak(spokenText);
    }
  });
}
