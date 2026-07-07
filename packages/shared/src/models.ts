/**
 * Model-selection contracts — the declarative "smart way" to pick a brain
 * (Haiku / Ollama Llama 3 / Claude Code / none) per task.
 *
 * A skill declares a `ModelPolicy`; the gateway's ModelSelector resolves it to
 * a concrete provider at call time using availability, tier, budget, and
 * privacy constraints. Adding a model = one adapter + one registry entry.
 */
import { z } from "zod";

/**
 * Concrete providers the OS knows how to drive — the single source of truth for
 * provider ids (imported everywhere a list/enum is needed; never re-typed).
 * Extend the registry to add more.
 *  - haiku       : cheap/fast Anthropic model (router default + light skill tier)
 *  - claude-code : strong Anthropic model via headless `claude -p` (no API key)
 *  - ollama      : any local Ollama-served model (native /api/chat)
 *  - openai      : any OpenAI-compatible endpoint (local or remote; key + baseUrl)
 */
export const PROVIDER_IDS = ["haiku", "ollama", "openai", "claude-code"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const ProviderIdSchema = z.enum(PROVIDER_IDS);

/**
 * Providers the router BRAIN can use — the subset above minus `claude-code`
 * (heavy Opus is a skill-execution tier, never the routing brain).
 */
export const ROUTER_PROVIDER_IDS = ["haiku", "ollama", "openai"] as const;
export type RouterProviderId = (typeof ROUTER_PROVIDER_IDS)[number];

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
  pin: ProviderIdSchema.optional(),
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

/** Live signals the selector consults to drop unconfigured/unreachable providers. */
export interface ModelRuntimeContext {
  ollamaReachable: boolean;
  networkUp: boolean;
  anthropicKeyPresent: boolean;
  /** OpenAI-compatible endpoint has a key configured. */
  openaiConfigured: boolean;
  /** How Anthropic is reached: "headless" needs no key, "sdk" needs one. */
  transport: "sdk" | "headless";
  /** Providers the user has switched off — never selected, even if ready. */
  disabled: ProviderId[];
}

/** Per-provider readiness for the HUD ("can I actually use this right now?"). */
export interface ProviderReadiness {
  id: ProviderId;
  label: string;
  kind: "cloud" | "local";
  /** Required setup is present (key/login). */
  configured: boolean;
  /** Live/likely reachable right now. */
  reachable: boolean;
  /** User switch — off providers are never selected. */
  enabled: boolean;
  model: string;
}

/** The selector's verdict. `null` from selectModel means "no LLM needed". */
export interface ModelSelection {
  provider: ProviderId;
  model: string;
  /** Human-readable explanation of why this provider won, for the audit trail. */
  reason: string;
}
