/**
 * The semantic routing brain interface. Every model adapter (Haiku, Ollama,
 * or anything added later) implements `RouterProvider`, so the router is fully
 * hot-swappable — swap the adapter, the rest of the engine is untouched.
 */
import type { Action } from "@aos/shared";

/** The raw decision a provider returns, before validation/normalization. */
export interface RouterDecision {
  /** Action id the model chose (validated against the catalog by the IntentRouter). */
  actionId: string;
  /** Model-reported confidence, 0..1 (clamped downstream). */
  confidence: number;
  /** Extracted parameters keyed by name. */
  parameters: Record<string, unknown>;
  /** Optional rationale. */
  reasoning?: string;
}

export interface RouterProvider {
  /** Stable id matching the provider's entry in the model registry. */
  readonly id: string;
  /** Parse an utterance into a decision over the given action catalog. */
  route(input: string, catalog: readonly Action[]): Promise<RouterDecision>;
}
