/**
 * Action contracts — the programmatic actions that both routing paths
 * (deterministic regex + semantic LLM) resolve user input into.
 *
 * An `Action` is the canonical, model-agnostic description of something the OS
 * can do. The routing engine never executes; it produces a `RoutedIntent` that
 * the gateway's dispatch layer hands to the skill runtime.
 */

/** Which path produced an intent. `direct` = a command-deck button / invoke (no routing). */
export type RouteSource = "regex" | "semantic" | "direct";

/** A single parameter an action can accept, surfaced to the semantic router. */
export interface ActionParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

/** Canonical description of one thing the OS can do. */
export interface Action {
  /** Stable identifier, e.g. "rundown". Used as the route target and skill key. */
  id: string;
  /** Human/LLM-facing description. Drives semantic routing — keep it precise. */
  description: string;
  /** Optional regex-path hints (not authoritative; routes.config.ts owns patterns). */
  keywords?: string[];
  /** Parameters the action accepts, advertised to the semantic router. */
  parameters?: ActionParameter[];
}

/** The resolved outcome of routing a single utterance. */
export interface RoutedIntent {
  /** Resolved action id; guaranteed to exist in the active catalog. */
  actionId: string;
  /** Which path resolved it. */
  source: RouteSource;
  /** 0..1. Regex/direct matches are reported as 1; semantic matches carry model confidence. */
  confidence: number;
  /** Extracted/structured parameters keyed by name. */
  parameters: Record<string, unknown>;
  /** The original text that was routed. */
  rawInput: string;
  /** Free-text rationale (semantic path only). */
  reasoning?: string;
}
