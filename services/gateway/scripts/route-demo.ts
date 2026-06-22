/**
 * Routing + model-selection smoke demo. Run with: `npm run route-demo -w @aos/gateway`.
 *
 * Offline-safe: the regex path and the model-selection cascade always run. The
 * semantic path only fires if a brain is actually reachable (Anthropic key,
 * headless `claude`, or a live Ollama daemon) — otherwise it's clearly skipped.
 */
import type { ModelPolicy, ModelRuntimeContext } from "@aos/shared";
import { config } from "../../../config/agentic-os.config.js";
import { Router, selectRouterProvider } from "../src/routing/router.js";
import { selectModel } from "../src/models/model-selector.js";

async function probeOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const runtime: ModelRuntimeContext = {
    networkUp: true,
    anthropicKeyPresent: Boolean(process.env[config.anthropic.apiKeyEnv]),
    ollamaReachable: await probeOllama(),
    openaiConfigured: Boolean(config.openai.apiKey),
    transport: config.router.transport,
    disabled: [],
  };

  console.log("=== Agentic OS — routing engine smoke demo ===");
  console.log("router default :", config.router.defaultProvider);
  console.log("router transport:", config.router.transport);
  console.log("runtime        :", runtime);
  console.log("active brain   :", selectRouterProvider(runtime).id, "\n");

  const router = new Router({ runtime });

  // --- Deterministic path (no LLM) ---
  console.log("--- regex path ---");
  for (const input of ["give me the rundown", "sync everything", "morning report"]) {
    const intent = router.matchRegex(input);
    console.log(
      `"${input}" -> ${intent?.actionId ?? "<no match>"} [${intent?.source}]`,
    );
  }

  // --- Semantic path (only if a brain is reachable) ---
  console.log("\n--- semantic path ---");
  const freeform = "what's been happening with rust async over the past month?";
  const headlessViable = config.router.transport === "headless" && runtime.networkUp;
  const brainReachable =
    runtime.ollamaReachable ||
    headlessViable ||
    (config.router.transport === "sdk" && runtime.anthropicKeyPresent);

  if (!brainReachable) {
    console.log(`skipped (no brain reachable) — would route: "${freeform}"`);
    console.log("  set ANTHROPIC_API_KEY, or AGENTIC_OS_ROUTER_TRANSPORT=headless,");
    console.log("  or run Ollama with AGENTIC_OS_ROUTER=ollama.");
  } else {
    try {
      const intent = await router.route(freeform);
      console.log(`"${freeform}" ->`, intent);
    } catch (err) {
      console.log("semantic route failed:", (err as Error).message);
    }
  }

  // --- Model-selection cascade ---
  console.log("\n--- model selector ---");
  const cases: Array<{ label: string; policy: ModelPolicy }> = [
    { label: "light + local-only (privacy forces Ollama)", policy: { execTier: "light", privacy: "local-only" } },
    { label: "light + cloud-ok (default)", policy: { execTier: "light", privacy: "cloud-ok" } },
    { label: "heavy + cloud-ok (claude -p)", policy: { execTier: "heavy", privacy: "cloud-ok" } },
    { label: "pin claude-code (bypasses cascade)", policy: { execTier: "light", privacy: "cloud-ok", pin: "claude-code" } },
    { label: "none (deterministic, no LLM)", policy: { execTier: "none", privacy: "cloud-ok" } },
  ];
  // Make all providers reachable so the cascade's own logic is what's exercised.
  const selectorCtx: ModelRuntimeContext = {
    networkUp: true,
    anthropicKeyPresent: true,
    ollamaReachable: true,
    openaiConfigured: true,
    transport: "sdk",
    disabled: [],
  };
  for (const { label, policy } of cases) {
    try {
      const sel = selectModel(policy, selectorCtx);
      console.log(`${label}\n  -> ${sel ? `${sel.provider} (${sel.model}) — ${sel.reason}` : "no model needed"}`);
    } catch (err) {
      console.log(`${label}\n  -> ERROR: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
