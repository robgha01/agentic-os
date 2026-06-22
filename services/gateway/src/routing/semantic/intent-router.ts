/**
 * The semantic path orchestrator: hand an utterance + catalog to a
 * RouterProvider, then validate and normalize the raw decision into a
 * RoutedIntent. Invalid or low-confidence results collapse to `unknown` so the
 * dispatch layer always receives a catalog-valid action id.
 */
import type { Action, RoutedIntent } from "@aos/shared";
import type { RouterProvider } from "./provider.types.js";

export class IntentRouter {
  constructor(
    private readonly provider: RouterProvider,
    private readonly minConfidence: number,
  ) {}

  async route(input: string, catalog: readonly Action[]): Promise<RoutedIntent> {
    const ids = new Set(catalog.map((a) => a.id));
    const decision = await this.provider.route(input, catalog);

    const confidence = clamp01(decision.confidence);
    const valid = ids.has(decision.actionId);
    const belowBar = confidence < this.minConfidence;

    if (!valid || belowBar) {
      return {
        actionId: "unknown",
        source: "semantic",
        confidence,
        parameters: {},
        rawInput: input,
        reasoning: !valid
          ? `provider returned unknown action "${decision.actionId}"`
          : `confidence ${confidence.toFixed(2)} below threshold ${this.minConfidence}`,
      };
    }

    return {
      actionId: decision.actionId,
      source: "semantic",
      confidence,
      parameters: decision.parameters,
      rawInput: input,
      reasoning: decision.reasoning,
    };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
