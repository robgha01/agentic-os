/**
 * Ollama routing adapter — the 100%-local semantic brain (e.g. Llama 3 8B).
 *
 * Talks to a local Ollama daemon's /api/chat endpoint with `format: "json"` so
 * the model returns a parseable object. Same catalog/prompt shape as the Haiku
 * adapter, so the two are interchangeable behind RouterProvider.
 */
import type { Action } from "@aos/shared";
import type { RouterDecision, RouterProvider } from "../provider.types.js";
import { JSON_RESPONSE_INSTRUCTION, buildRouterSystemPrompt } from "../prompt.js";

interface OllamaChatResponse {
  message?: { content?: string };
}

export class OllamaProvider implements RouterProvider {
  readonly id = "ollama";

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async route(input: string, catalog: readonly Action[]): Promise<RouterDecision> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: `${buildRouterSystemPrompt(catalog)}\n\n${JSON_RESPONSE_INSTRUCTION}`,
          },
          { role: "user", content: input },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama: HTTP ${res.status} from ${this.baseUrl}/api/chat`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content;
    if (!content) throw new Error("ollama: empty response content");

    let parsed: {
      action?: unknown;
      confidence?: unknown;
      parameters?: unknown;
      reasoning?: unknown;
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("ollama: response was not valid JSON");
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
