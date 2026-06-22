/**
 * Top-level Agentic OS configuration.
 *
 * Resolution precedence for every key: **env var → config file → built-in
 * default**. Env vars are overrides (dev / power users); the config file
 * (config/config-store.ts → ~/.agentic-os/config.json) is the source of truth a
 * packaged executable relies on with no env. Secrets (anthropic.apiKey,
 * mail.token) resolve the same way but are stored encrypted in the file.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getValue } from "./config-store.js";

// Repo root resolved from this file's location (<root>/config/agentic-os.config.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** env override → config file → fallback (string). */
function cfg(fileKey: string, envName: string, fallback: string): string {
  const e = process.env[envName];
  if (e !== undefined && e !== "") return e;
  const v = getValue(fileKey);
  return v !== undefined ? v : fallback;
}
function cfgNum(fileKey: string, envName: string, fallback: number): number {
  const s = cfg(fileKey, envName, String(fallback));
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
/** Optional value (no default): env override → config file → undefined. */
function cfgOpt(fileKey: string, envName: string): string | undefined {
  const e = process.env[envName];
  if (e !== undefined && e !== "") return e;
  return getValue(fileKey);
}
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export interface AgenticOsConfig {
  router: {
    defaultProvider: "haiku" | "llama3";
    transport: "sdk" | "headless";
    minConfidence: number;
  };
  claudeCode: { bin: string };
  anthropic: {
    routerModel: string;
    heavyModel: string;
    /** Env var name checked for the key override. */
    apiKeyEnv: string;
    /** Resolved API key (env → encrypted config file), or undefined. */
    apiKey?: string;
  };
  ollama: { baseUrl: string; model: string };
  vault: { path: string; managedBlocks: boolean };
  ports: { gateway: number; voice: number };
  budgets: { defaultMaxLatencyMs: number; defaultMaxCostUsd: number };
  voice: {
    mode: "text" | "voice";
    stt: { provider: string; model?: string; apiKeyEnv?: string };
    tts: { provider: string; voice?: string; apiKeyEnv?: string };
    sidecarUrl: string;
  };
  mail: {
    provider: "none" | "outlook" | "gmail" | "imap";
    tokenSource: "device-code" | "command" | "env";
    /** Env var name a static token override is read from. */
    tokenEnv: string;
    /** Resolved static token (env → encrypted config file), used by tokenSource "env". */
    token?: string;
    tokenCommand: string;
    clientId: string;
    tenant: string;
    scopes: string;
    tokenStorePath: string;
    graphBaseUrl: string;
  };
}

const voicePort = cfgNum("ports.voice", "AGENTIC_OS_VOICE_PORT", 7788);
const mailTokenEnvName = cfg("mail.tokenEnv", "AGENTIC_OS_MAIL_TOKEN_ENV", "AGENTIC_OS_MAIL_TOKEN");

export const config: AgenticOsConfig = {
  router: {
    defaultProvider: oneOf(
      cfg("router.defaultProvider", "AGENTIC_OS_ROUTER", "haiku") === "ollama"
        ? "llama3"
        : cfg("router.defaultProvider", "AGENTIC_OS_ROUTER", "haiku"),
      ["haiku", "llama3"],
      "haiku",
    ),
    transport: oneOf(cfg("router.transport", "AGENTIC_OS_ROUTER_TRANSPORT", "sdk"), ["sdk", "headless"], "sdk"),
    minConfidence: cfgNum("router.minConfidence", "AGENTIC_OS_ROUTER_MIN_CONFIDENCE", 0.4),
  },
  claudeCode: {
    bin: cfg("claudeCode.bin", "AGENTIC_OS_CLAUDE_BIN", "claude"),
  },
  anthropic: {
    routerModel: cfg("anthropic.routerModel", "AGENTIC_OS_ROUTER_MODEL", "claude-haiku-4-5"),
    heavyModel: cfg("anthropic.heavyModel", "AGENTIC_OS_HEAVY_MODEL", "claude-opus-4-8"),
    apiKeyEnv: "ANTHROPIC_API_KEY",
    apiKey: cfgOpt("anthropic.apiKey", "ANTHROPIC_API_KEY"),
  },
  ollama: {
    baseUrl: cfg("ollama.baseUrl", "OLLAMA_BASE_URL", "http://localhost:11434"),
    model: cfg("ollama.model", "OLLAMA_MODEL", "llama3:8b"),
  },
  vault: {
    path: cfg("vault.path", "AGENTIC_OS_VAULT_PATH", join(REPO_ROOT, "vault")),
    managedBlocks: cfg("vault.managedBlocks", "AGENTIC_OS_VAULT_MANAGED_BLOCKS", "false") === "true",
  },
  ports: {
    gateway: cfgNum("ports.gateway", "AGENTIC_OS_GATEWAY_PORT", 7777),
    voice: voicePort,
  },
  budgets: {
    defaultMaxLatencyMs: cfgNum("budgets.maxLatencyMs", "AGENTIC_OS_MAX_LATENCY_MS", 8000),
    defaultMaxCostUsd: cfgNum("budgets.maxCostUsd", "AGENTIC_OS_MAX_COST_USD", 0.05),
  },
  voice: {
    mode: oneOf(cfg("voice.mode", "AGENTIC_OS_VOICE_MODE", "text"), ["text", "voice"], "text"),
    stt: {
      provider: cfg("voice.stt.provider", "AGENTIC_OS_STT_PROVIDER", "faster-whisper"),
      model: cfgOpt("voice.stt.model", "AGENTIC_OS_STT_MODEL"),
      apiKeyEnv: cfgOpt("voice.stt.apiKeyEnv", "AGENTIC_OS_STT_API_KEY_ENV"),
    },
    tts: {
      provider: cfg("voice.tts.provider", "AGENTIC_OS_TTS_PROVIDER", "kokoro"),
      voice: cfgOpt("voice.tts.voice", "AGENTIC_OS_TTS_VOICE"),
      apiKeyEnv: cfgOpt("voice.tts.apiKeyEnv", "AGENTIC_OS_TTS_API_KEY_ENV"),
    },
    sidecarUrl: cfg("voice.sidecarUrl", "AGENTIC_OS_VOICE_SIDECAR_URL", `http://localhost:${voicePort}`),
  },
  mail: {
    provider: oneOf(
      cfg("mail.provider", "AGENTIC_OS_MAIL_PROVIDER", "none"),
      ["none", "outlook", "gmail", "imap"],
      "none",
    ),
    tokenSource: oneOf(
      cfg("mail.tokenSource", "AGENTIC_OS_MAIL_TOKEN_SOURCE", "device-code"),
      ["device-code", "command", "env"],
      "device-code",
    ),
    tokenEnv: mailTokenEnvName,
    // env (named by tokenEnv) → encrypted config file ("mail.token")
    token: process.env[mailTokenEnvName] || getValue("mail.token"),
    tokenCommand: cfg(
      "mail.tokenCommand",
      "AGENTIC_OS_MAIL_TOKEN_COMMAND",
      "az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv",
    ),
    clientId: cfg("mail.clientId", "AGENTIC_OS_MAIL_CLIENT_ID", "14d82eec-204b-4c2f-b7e8-296a70dab67e"),
    tenant: cfg("mail.tenant", "AGENTIC_OS_MAIL_TENANT", "common"),
    scopes: cfg("mail.scopes", "AGENTIC_OS_MAIL_SCOPES", "https://graph.microsoft.com/Mail.Read offline_access"),
    tokenStorePath: cfg("mail.tokenStorePath", "AGENTIC_OS_MAIL_TOKEN_STORE", join(homedir(), ".agentic-os", "mail-token.json")),
    graphBaseUrl: cfg("mail.graphBaseUrl", "AGENTIC_OS_GRAPH_BASE_URL", "https://graph.microsoft.com/v1.0"),
  },
};
