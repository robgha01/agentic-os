/**
 * The "smart way" to pick a brain per task — the selection cascade.
 *
 * resolve(policy, ctx) runs:
 *   1. pin            → return it (explicit override wins).
 *   2. execTier none  → return null (deterministic, no LLM).
 *   3. privacy        → local-only restricts to local providers.
 *   4. availability   → drop unreachable providers (network/key/ollama).
 *   5. tier match     → keep providers that serve this execTier.
 *   6. budget         → drop providers exceeding latency/cost caps.
 *   7. fallback order → first survivor wins; log why for the audit trail.
 *
 * Throws a descriptive error if no provider survives, so the caller can surface
 * exactly which constraint eliminated everything.
 */
import type {
  ModelPolicy,
  ModelProfile,
  ModelRuntimeContext,
  ModelSelection,
  ProviderId,
} from "@aos/shared";
import { FALLBACK_ORDER, MODEL_REGISTRY } from "./models.config.js";

export interface SelectorOptions {
  registry?: readonly ModelProfile[];
  order?: readonly ProviderId[];
  /** Default budgets applied when the policy omits them. */
  defaults?: { maxLatencyMs?: number; maxCostUsd?: number };
}

/**
 * Resolve a policy to a concrete provider. Returns `null` when the task needs
 * no LLM (execTier "none").
 */
export function selectModel(
  policy: ModelPolicy,
  ctx: ModelRuntimeContext,
  opts: SelectorOptions = {},
): ModelSelection | null {
  const registry = opts.registry ?? MODEL_REGISTRY;
  const order = opts.order ?? FALLBACK_ORDER;

  // 1. Hard override.
  if (policy.pin) {
    const pinned = registry.find((p) => p.id === policy.pin);
    if (!pinned) throw new Error(`pinned provider "${policy.pin}" is not in the registry`);
    return { provider: pinned.id, model: pinned.model, reason: `pinned to ${pinned.id}` };
  }

  // 2. Deterministic skills need no model.
  if (policy.execTier === "none") return null;

  // 3..6 build the candidate set, tracking why each provider drops out.
  const maxLatency = policy.maxLatencyMs ?? opts.defaults?.maxLatencyMs;
  const maxCost = policy.maxCostUsd ?? opts.defaults?.maxCostUsd;

  const candidates = registry.filter((p) => {
    if (!p.tiers.includes(policy.execTier)) return false; // 5. tier
    if (policy.privacy === "local-only" && p.kind !== "local") return false; // 3. privacy
    if (!isAvailable(p, ctx)) return false; // 4. availability
    if (maxLatency !== undefined && p.typicalLatencyMs > maxLatency) return false; // 6. budget
    if (maxCost !== undefined && p.approxCostPer1kUsd > maxCost) return false; // 6. budget
    return true;
  });

  if (candidates.length === 0) {
    throw new Error(
      `no provider satisfies policy (tier=${policy.execTier}, privacy=${policy.privacy}` +
        `${maxLatency !== undefined ? `, maxLatencyMs=${maxLatency}` : ""}` +
        `${maxCost !== undefined ? `, maxCostUsd=${maxCost}` : ""})`,
    );
  }

  // 7. Fallback order.
  candidates.sort((a, b) => rank(order, a.id) - rank(order, b.id));
  const chosen = candidates[0]!;
  return {
    provider: chosen.id,
    model: chosen.model,
    reason: `tier=${policy.execTier}, privacy=${policy.privacy}; chose ${chosen.id} (${chosen.kind})`,
  };
}

function isAvailable(p: ModelProfile, ctx: ModelRuntimeContext): boolean {
  if (p.kind === "local") return ctx.ollamaReachable;
  // cloud
  return ctx.networkUp && ctx.anthropicKeyPresent;
}

function rank(order: readonly ProviderId[], id: ProviderId): number {
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}
