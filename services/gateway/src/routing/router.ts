/**
 * The routing engine front door.
 *
 * Resolution order per the spec:
 *   1. Deterministic path — regex table (instant, no LLM, confidence 1).
 *   2. Semantic path — IntentRouter over the configured/available brain.
 *
 * The semantic brain is constructed from runtime availability so the engine
 * degrades gracefully: Haiku by default, Ollama when offline or forced.
 */
import type { Action, ModelRuntimeContext, RoutedIntent } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import { ACTION_REGISTRY } from "../actions/registry.js";
import { ROUTES, type RouteRule } from "./routes.config.js";
import { IntentRouter } from "./semantic/intent-router.js";
import type { RouterProvider } from "./semantic/provider.types.js";
import { AnthropicHaikuProvider } from "./semantic/providers/anthropic-haiku.js";
import { ClaudeHeadlessProvider } from "./semantic/providers/claude-headless.js";
import { OllamaProvider } from "./semantic/providers/ollama.js";
import { OpenAiProvider } from "./semantic/providers/openai.js";

export class Router {
  private readonly catalog: readonly Action[];
  private readonly rules: readonly RouteRule[];
  private readonly intentRouter: IntentRouter;

  constructor(opts?: {
    catalog?: readonly Action[];
    rules?: readonly RouteRule[];
    provider?: RouterProvider;
    minConfidence?: number;
    runtime?: ModelRuntimeContext;
  }) {
    this.catalog = opts?.catalog ?? ACTION_REGISTRY;
    this.rules = [...(opts?.rules ?? ROUTES)].sort((a, b) => b.priority - a.priority);
    const provider =
      opts?.provider ?? selectRouterProvider(opts?.runtime ?? probeRuntime());
    this.intentRouter = new IntentRouter(
      provider,
      opts?.minConfidence ?? config.router.minConfidence,
    );
  }

  /** Try the regex table; return a RoutedIntent on a hit, else null. */
  matchRegex(input: string): RoutedIntent | null {
    for (const rule of this.rules) {
      if (rule.pattern.test(input)) {
        return {
          actionId: rule.action,
          source: "regex",
          confidence: 1,
          parameters: {},
          rawInput: input,
        };
      }
    }
    return null;
  }

  /** Full resolution: regex first, then semantic fallback. */
  async route(input: string): Promise<RoutedIntent> {
    return this.matchRegex(input) ?? this.intentRouter.route(input, this.catalog);
  }
}

/**
 * Choose the router brain from config (default provider + transport) and live
 * availability. The cloud brain can be reached two ways:
 *   - "headless": a hidden `claude -p` session — needs the CLI + network, not an
 *     API key (uses local Claude Code auth).
 *   - "sdk": the Anthropic Messages API — needs ANTHROPIC_API_KEY + network.
 */
export function selectRouterProvider(runtime: ModelRuntimeContext): RouterProvider {
  const headless = config.router.transport === "headless";
  const haikuReady = runtime.networkUp && (headless || runtime.anthropicKeyPresent);

  const build: Record<"haiku" | "ollama" | "openai", () => RouterProvider> = {
    haiku: () =>
      headless
        ? new ClaudeHeadlessProvider(config.anthropic.routerModel, { id: "haiku", bin: config.claudeCode.bin })
        : new AnthropicHaikuProvider(config.anthropic.routerModel, config.anthropic.apiKey),
    ollama: () => new OllamaProvider(config.ollama.baseUrl, config.ollama.model),
    openai: () => new OpenAiProvider(config.openai.baseUrl, config.openai.model, config.openai.apiKey),
  };
  const off = (id: "haiku" | "ollama" | "openai") => runtime.disabled.includes(id);
  const ready: Record<"haiku" | "ollama" | "openai", boolean> = {
    haiku: haikuReady && !off("haiku"),
    ollama: runtime.ollamaReachable && !off("ollama"),
    openai: runtime.networkUp && runtime.openaiConfigured && !off("openai"),
  };

  // Prefer the configured brain; if it isn't ready, fall to the first that is.
  const preferred = config.router.defaultProvider;
  const order: ("haiku" | "ollama" | "openai")[] = [preferred, "haiku", "ollama", "openai"];
  for (const id of order) {
    if (ready[id]) return build[id]();
  }
  // Nothing ready: return the configured brain's transport so the call surfaces
  // a clear error rather than guessing.
  return build[preferred]();
}

/** Cheap synchronous probe of routing-brain availability from the environment. */
export function probeRuntime(): ModelRuntimeContext {
  return {
    networkUp: true,
    anthropicKeyPresent: Boolean(config.anthropic.apiKey),
    // Real reachability is async; the demo script overrides this with a live probe.
    ollamaReachable: false,
    openaiConfigured: Boolean(config.openai.apiKey),
    transport: config.router.transport,
    disabled: config.models.disabled as import("@aos/shared").ProviderId[],
  };
}
