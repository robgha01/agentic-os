/**
 * Ollama routing adapter — the 100%-local semantic brain (e.g. Llama 3 8B).
 *
 * Talks to a local Ollama daemon's /api/chat endpoint with `format: "json"` so
 * the model returns a parseable object. Same catalog/prompt shape as the Haiku
 * adapter, so the two are interchangeable behind RouterProvider.
 */
import type { Action } from "@aos/shared";
import { parseIntentJson, toRouterDecision } from "../parse.js";
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

    const parsed = parseIntentJson(content);
    if (!parsed) throw new Error(`ollama: response was not valid JSON: ${content.slice(0, 200)}`);
    return toRouterDecision(parsed);
  }
}
