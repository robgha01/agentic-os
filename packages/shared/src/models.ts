/**
 * Model-selection contracts — the declarative "smart way" to pick a brain
 * (Haiku / Ollama Llama 3 / Claude Code / none) per task.
 *
 * A skill declares a `ModelPolicy`; the gateway's ModelSelector resolves it to
 * a concrete provider at call time using availability, tier, budget, and
 * privacy constraints. Adding a model = one adapter + one registry entry.
 */
import { z } from "zod";

/** Concrete providers the OS knows how to drive. Extend the registry to add more. */
export type ProviderId = "haiku" | "llama3" | "claude-code";

/**
 * How much "brain" a task needs:
 *  - none  : deterministic, no LLM call
 *  - light : cheap/fast model (intent parsing, classification, short transforms)
 *  - heavy : strong model via headless `claude -p` (implementation, deep reasoning)
 */
export const ModelExecTierSchema = z.enum(["none", "light", "heavy"]);
export type ModelExecTier = z.infer<typeof ModelExecTierSchema>;

/** Privacy constraint. `local-only` forces a local provider regardless of default. */
export const ModelPrivacySchema = z.enum(["local-only", "cloud-ok"]);
export type ModelPrivacy = z.infer<typeof ModelPrivacySchema>;

/** Declarative per-skill model policy. The single source of truth for selection. */
export const ModelPolicySchema = z.object({
  execTier: ModelExecTierSchema,
  privacy: ModelPrivacySchema.default("cloud-ok"),
  /** Upper bound on acceptable provider latency, in ms. */
  maxLatencyMs: z.number().int().positive().optional(),
  /** Upper bound on acceptable per-call cost, in USD. */
  maxCostUsd: z.number().nonnegative().optional(),
  /** Hard override — bypasses the entire cascade and uses exactly this provider. */
  pin: z.enum(["haiku", "llama3", "claude-code"]).optional(),
});
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

/** Static capability/cost profile for one provider. Lives in models.config.ts. */
export interface ModelProfile {
  id: ProviderId;
  kind: "cloud" | "local";
  /** Concrete model identifier passed to the adapter. */
  model: string;
  /** Which exec tiers this provider is allowed to serve. */
  tiers: ModelExecTier[];
  /** Rough latency for budget filtering, in ms. */
  typicalLatencyMs: number;
  /** Rough cost per 1k tokens, in USD (0 for local). */
  approxCostPer1kUsd: number;
}

/** Live signals the selector consults to drop unreachable providers. */
export interface ModelRuntimeContext {
  ollamaReachable: boolean;
  networkUp: boolean;
  anthropicKeyPresent: boolean;
}

/** The selector's verdict. `null` from selectModel means "no LLM needed". */
export interface ModelSelection {
  provider: ProviderId;
  model: string;
  /** Human-readable explanation of why this provider won, for the audit trail. */
  reason: string;
}
