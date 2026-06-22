/**
 * Provider registry + selection ordering — the static half of the model layer.
 *
 * Adding a model = add a ModelProfile here and an adapter. The selector reads
 * `tiers`, `kind`, and the cost/latency fields; `FALLBACK_ORDER` breaks ties.
 */
import type { ModelProfile, ProviderId } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";

export const MODEL_REGISTRY: readonly ModelProfile[] = [
  {
    id: "haiku",
    kind: "cloud",
    model: config.anthropic.routerModel, // claude-haiku-4-5
    tiers: ["light"],
    typicalLatencyMs: 700,
    approxCostPer1kUsd: 0.001,
  },
  {
    id: "ollama",
    kind: "local",
    model: config.ollama.model, // e.g. llama3:8b — any local Ollama model
    tiers: ["light", "heavy"],
    typicalLatencyMs: 1500,
    approxCostPer1kUsd: 0,
  },
  {
    id: "openai",
    kind: "cloud", // "cloud" by selection semantics; may point at a LOCAL OpenAI-compatible server
    model: config.openai.model, // any OpenAI-compatible model
    tiers: ["light", "heavy"],
    typicalLatencyMs: 1200,
    approxCostPer1kUsd: 0.005,
  },
  {
    id: "claude-code",
    kind: "cloud",
    model: config.anthropic.heavyModel, // claude-opus-4-8, driven via `claude -p`
    tiers: ["heavy"],
    typicalLatencyMs: 5000,
    approxCostPer1kUsd: 0.02,
  },
];

/**
 * Tie-break / fallback order when multiple providers survive the cascade
 * (lower = preferred). Configurable via models.fallbackOrder; unknown ids are
 * dropped and any registry providers omitted from config are appended.
 */
export const FALLBACK_ORDER: readonly ProviderId[] = (() => {
  const ids = MODEL_REGISTRY.map((p) => p.id);
  const configured = config.models.fallbackOrder.filter((id): id is ProviderId =>
    (ids as string[]).includes(id),
  );
  const rest = ids.filter((id) => !configured.includes(id));
  return [...configured, ...rest];
})();
