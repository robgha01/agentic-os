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
    id: "llama3",
    kind: "local",
    model: config.ollama.model, // llama3:8b
    tiers: ["light"],
    typicalLatencyMs: 1500,
    approxCostPer1kUsd: 0,
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

/** Tie-break order when multiple providers survive the cascade. Lower = preferred. */
export const FALLBACK_ORDER: readonly ProviderId[] = ["haiku", "llama3", "claude-code"];
