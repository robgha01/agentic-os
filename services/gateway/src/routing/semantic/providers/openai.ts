/**
 * OpenAI-compatible routing adapter — any server speaking the OpenAI Chat
 * Completions API (OpenAI, Azure, OpenRouter, Together, Groq, or a LOCAL server
 * like LM Studio / vLLM / llama.cpp). Same catalog/prompt shape as the other
 * adapters, so it's interchangeable behind RouterProvider.
 *
 * Uses JSON response mode and parses the assistant message into a RouterDecision.
 */
import type { Action } from "@aos/shared";
import type { RouterDecision, RouterProvider } from "../provider.types.js";
import { JSON_RESPONSE_INSTRUCTION, buildRouterSystemPrompt } from "../prompt.js";

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
}

export class OpenAiProvider implements RouterProvider {
  readonly id = "openai";

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {}

  async route(input: string, catalog: readonly Action[]): Promise<RouterDecision> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${buildRouterSystemPrompt(catalog)}\n\n${JSON_RESPONSE_INSTRUCTION}` },
          { role: "user", content: input },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`openai: HTTP ${res.status} from ${this.baseUrl}/chat/completions`);
    }

    const data = (await res.json()) as OpenAiChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("openai: empty response content");

    let parsed: { action?: unknown; confidence?: unknown; parameters?: unknown; reasoning?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("openai: response was not valid JSON");
    }

    return {
      actionId: String(parsed.action ?? "unknown"),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      parameters:
        parsed.parameters && typeof parsed.parameters === "object"
          ? (parsed.parameters as Record<string, unknown>)
          : {},
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  }
}
