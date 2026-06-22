/**
 * Anthropic Haiku routing adapter — the default semantic brain.
 *
 * Uses the Messages API with a single forced tool (`route`) so the model is
 * required to return structured intent rather than prose. Model id comes from
 * config (claude-haiku-4-5), never hardcoded inline.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Action } from "@aos/shared";
import type { RouterDecision, RouterProvider } from "../provider.types.js";
import { buildRouterSystemPrompt } from "../prompt.js";

export class AnthropicHaikuProvider implements RouterProvider {
  readonly id = "haiku";
  private readonly client: Anthropic;

  constructor(
    private readonly model: string,
    apiKey?: string,
  ) {
    // The SDK reads ANTHROPIC_API_KEY from env when apiKey is omitted.
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async route(input: string, catalog: readonly Action[]): Promise<RouterDecision> {
    const actionIds = catalog.map((a) => a.id);

    const routeTool: Anthropic.Tool = {
      name: "route",
      description: "Select the single best action for the user's request.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: actionIds, description: "Chosen action id." },
          confidence: { type: "number", description: "Confidence from 0 to 1." },
          parameters: {
            type: "object",
            additionalProperties: true,
            description: "Extracted parameters keyed by name.",
          },
          reasoning: { type: "string", description: "One-sentence rationale." },
        },
        required: ["action", "confidence"],
      },
    };

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildRouterSystemPrompt(catalog),
      tools: [routeTool],
      tool_choice: { type: "tool", name: "route" },
      messages: [{ role: "user", content: input }],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("anthropic-haiku: model did not return a tool_use block");
    }

    const inp = block.input as {
      action?: unknown;
      confidence?: unknown;
      parameters?: unknown;
      reasoning?: unknown;
    };

    return {
      actionId: String(inp.action ?? "unknown"),
      confidence: typeof inp.confidence === "number" ? inp.confidence : 0.5,
      parameters:
        inp.parameters && typeof inp.parameters === "object"
          ? (inp.parameters as Record<string, unknown>)
          : {},
      reasoning: typeof inp.reasoning === "string" ? inp.reasoning : undefined,
    };
  }
}
