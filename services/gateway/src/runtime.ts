/**
 * Live detection of model-runtime availability — used at gateway boot to build
 * the router brain and seed the dispatcher's selection context.
 */
import type { ModelRuntimeContext, ProviderId, ProviderReadiness } from "@aos/shared";
import { config } from "../../../config/agentic-os.config.js";

export async function detectRuntime(): Promise<ModelRuntimeContext> {
  let ollamaReachable = false;
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    ollamaReachable = res.ok;
  } catch {
    ollamaReachable = false;
  }

  return {
    networkUp: true,
    anthropicKeyPresent: Boolean(config.anthropic.apiKey),
    ollamaReachable,
    openaiConfigured: Boolean(config.openai.apiKey),
    transport: config.router.transport,
    disabled: config.models.disabled as ProviderId[],
  };
}

/**
 * Per-provider readiness for the HUD — "is this set up and usable right now?".
 * Pure (no probes): reuses the detected runtime context.
 */
export function providerReadiness(ctx: ModelRuntimeContext): ProviderReadiness[] {
  const anthropicConfigured = ctx.transport === "headless" || ctx.anthropicKeyPresent;
  const anthropicReady = ctx.networkUp && anthropicConfigured;
  const en = (id: ProviderId) => !ctx.disabled.includes(id);
  return [
    { id: "haiku", label: "Haiku", kind: "cloud", configured: anthropicConfigured, reachable: anthropicReady, enabled: en("haiku"), model: config.anthropic.routerModel },
    { id: "claude-code", label: "Claude (headless)", kind: "cloud", configured: anthropicConfigured, reachable: anthropicReady, enabled: en("claude-code"), model: config.anthropic.heavyModel },
    { id: "openai", label: "OpenAI-compatible", kind: "cloud", configured: ctx.openaiConfigured, reachable: ctx.networkUp && ctx.openaiConfigured, enabled: en("openai"), model: config.openai.model },
    { id: "ollama", label: "Ollama (local)", kind: "local", configured: true, reachable: ctx.ollamaReachable, enabled: en("ollama"), model: config.ollama.model },
  ];
}
