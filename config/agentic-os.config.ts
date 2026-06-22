/**
 * Top-level Agentic OS configuration.
 *
 * Single source of truth for hot-swappable knobs: which provider the semantic
 * router defaults to, where Ollama and the Obsidian vault live, gateway/voice
 * ports, and default selection budgets. Everything reads from env with sane
 * fallbacks so the system runs out of the box and is overridable per machine.
 */

export interface AgenticOsConfig {
  router: {
    /** Default brain for the semantic routing path. */
    defaultProvider: "haiku" | "llama3";
    /**
     * How the cloud brain is reached:
     *  - "sdk"      : Anthropic Messages API (needs ANTHROPIC_API_KEY)
     *  - "headless" : a hidden `claude -p` Claude Code session (uses local CC auth)
     */
    transport: "sdk" | "headless";
    /** Below this confidence, the router yields the `unknown` action for clarification. */
    minConfidence: number;
  };
  claudeCode: {
    /** CLI binary for headless `claude -p` invocations. */
    bin: string;
  };
  anthropic: {
    /** Model id for the cheap/fast routing brain. */
    routerModel: string;
    /** Model id for heavy execution via headless `claude -p`. */
    heavyModel: string;
    /** Env var the API key is read from. */
    apiKeyEnv: string;
  };
  ollama: {
    baseUrl: string;
    /** Local model id used for routing/light tasks when running offline. */
    model: string;
  };
  vault: {
    /** Absolute or repo-relative path to the Obsidian vault root. */
    path: string;
  };
  ports: {
    gateway: number;
    voice: number;
  };
  budgets: {
    defaultMaxLatencyMs: number;
    defaultMaxCostUsd: number;
  };
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config: AgenticOsConfig = {
  router: {
    defaultProvider: env("AGENTIC_OS_ROUTER", "haiku") === "ollama" ? "llama3" : "haiku",
    transport: env("AGENTIC_OS_ROUTER_TRANSPORT", "sdk") === "headless" ? "headless" : "sdk",
    minConfidence: envNum("AGENTIC_OS_ROUTER_MIN_CONFIDENCE", 0.4),
  },
  claudeCode: {
    bin: env("AGENTIC_OS_CLAUDE_BIN", "claude"),
  },
  anthropic: {
    routerModel: env("AGENTIC_OS_ROUTER_MODEL", "claude-haiku-4-5"),
    heavyModel: env("AGENTIC_OS_HEAVY_MODEL", "claude-opus-4-8"),
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  ollama: {
    baseUrl: env("OLLAMA_BASE_URL", "http://localhost:11434"),
    model: env("OLLAMA_MODEL", "llama3:8b"),
  },
  vault: {
    path: env("AGENTIC_OS_VAULT_PATH", "./vault"),
  },
  ports: {
    gateway: envNum("AGENTIC_OS_GATEWAY_PORT", 7777),
    voice: envNum("AGENTIC_OS_VOICE_PORT", 7788),
  },
  budgets: {
    defaultMaxLatencyMs: envNum("AGENTIC_OS_MAX_LATENCY_MS", 8000),
    defaultMaxCostUsd: envNum("AGENTIC_OS_MAX_COST_USD", 0.05),
  },
};
