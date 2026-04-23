import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function dictationEmitExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "emit_optimized_text",
    label: "Emit Optimized Text",
    description: "Return structured dictation optimization result.",
    promptSnippet:
      "When optimizing dictation text, call this tool exactly once to return the final result.",
    promptGuidelines: [
      "Call once per request.",
      "Put the final user-facing text into optimized.",
      "Use format=list only if content is clearly list-like.",
      "Do not include explanations.",
    ],
    parameters: Type.Object({
      optimized: Type.String({ description: "Final optimized text" }),
      format: Type.Union([Type.Literal("paragraph"), Type.Literal("list")]),
      items: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "ok" }],
        details: {
          optimized: String((params as Record<string, unknown>).optimized ?? ""),
          format: String((params as Record<string, unknown>).format ?? "paragraph"),
          items: Array.isArray((params as Record<string, unknown>).items)
            ? ((params as Record<string, unknown>).items as unknown[]).map((v) => String(v))
            : [],
        },
      };
    },
  });
}
