/**
 * LLM completion service for skills that need to think (e.g. research synthesis).
 *
 * Honors the global Claude transport (config.router.transport):
 *  - "sdk"      : Anthropic Messages API (needs ANTHROPIC_API_KEY)
 *  - "headless" : a hidden `claude -p` session (uses local Claude Code login)
 *
 * Returns `undefined` from the factory when no transport is usable, so callers
 * degrade gracefully (skip synthesis) rather than fail.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ModelSelection } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import { runProcess } from "../util/run-process.js";

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
}

export interface LlmService {
  /** Transport id ("sdk" | "headless") — the engine that ran the completion. */
  readonly id: string;
  /** Concrete model string, for record provenance. */
  readonly model: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}

/** Anthropic Messages API. */
class AnthropicSdkLlm implements LlmService {
  readonly id = "sdk";
  private readonly client: Anthropic;
  constructor(public readonly model: string, apiKey?: string) {
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 1500,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
}

/** Hidden `claude -p` session. Plain-text output (no JSON envelope to parse). */
class ClaudeHeadlessLlm implements LlmService {
  readonly id = "headless";
  constructor(
    public readonly model: string,
    private readonly bin: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    // shell:true so Windows resolves the `claude.cmd` shim (npm global bin).
    const r = await runProcess(this.bin, ["-p", "--model", this.model], {
      stdin: full,
      shell: true,
      timeoutMs: this.timeoutMs,
    });
    if (r.spawnError) throw new Error(`failed to spawn "${this.bin}": ${r.spawnError}`);
    if (r.timedOut) {
      // Surface whatever it managed to emit before we killed it — a bare "timed
      // out" hides whether it hung with no output (login/hang) or was mid-answer.
      const tail = (r.stderr.trim() || r.stdout.trim()).slice(-600);
      console.error(`[llm:headless] claude -p timed out after ${this.timeoutMs}ms (model=${this.model}); captured tail:\n${tail || "(nothing — it produced no output before the timeout)"}`);
      throw new Error(
        tail
          ? `claude -p timed out after ${this.timeoutMs / 1000}s — last output: ${tail}`
          : `claude -p timed out after ${this.timeoutMs / 1000}s with no output (it likely hung before responding — check the local Claude Code login and that "${this.bin}" runs)`,
      );
    }
    const out = r.stdout.trim();
    if (r.code !== 0) {
      console.error(`[llm:headless] claude -p exited ${r.code} (model=${this.model}); stderr:\n${r.stderr.trim() || "(none)"}`);
      throw new Error(`claude -p exited ${r.code}: ${r.stderr.trim() || "(no stderr)"}`);
    }
    if (!out) throw new Error(`claude -p produced no output${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
    return out;
  }
}

/** Ollama-native (/api/chat) — any local Ollama-served model. */
class OllamaLlm implements LlmService {
  readonly id = "ollama";
  constructor(
    private readonly baseUrl: string,
    public readonly model: string,
    private readonly timeoutMs = 120_000,
  ) {}
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama: HTTP ${res.status} from ${this.baseUrl}/api/chat`);
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "").trim();
  }
}

/** OpenAI-compatible (/v1/chat/completions) — any OpenAI-standard server. */
class OpenAiLlm implements LlmService {
  readonly id = "openai";
  constructor(
    private readonly baseUrl: string,
    public readonly model: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 120_000,
  ) {}
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1500,
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`openai: HTTP ${res.status} from ${this.baseUrl}/chat/completions`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (data.choices?.[0]?.message?.content ?? "").trim();
  }
}

/**
 * Build the LLM for a resolved ModelSelection — the skill's chosen brain.
 * Returns undefined if that provider isn't actually usable (e.g. missing key),
 * so callers degrade gracefully.
 */
export function createLlmForSelection(selection: ModelSelection, cfg = config): LlmService | undefined {
  switch (selection.provider) {
    case "haiku":
    case "claude-code":
      if (cfg.router.transport === "headless") return new ClaudeHeadlessLlm(selection.model, cfg.claudeCode.bin);
      return cfg.anthropic.apiKey ? new AnthropicSdkLlm(selection.model, cfg.anthropic.apiKey) : undefined;
    case "ollama":
      return new OllamaLlm(cfg.ollama.baseUrl, selection.model);
    case "openai":
      return cfg.openai.apiKey ? new OpenAiLlm(cfg.openai.baseUrl, selection.model, cfg.openai.apiKey) : undefined;
    default:
      return undefined;
  }
}

/** Global default LLM (transport-based) — the fallback when a skill resolves no selection. */
export function createLlmService(cfg = config): LlmService | undefined {
  if (cfg.router.transport === "headless") {
    return new ClaudeHeadlessLlm(cfg.anthropic.heavyModel, cfg.claudeCode.bin);
  }
  // sdk transport: resolved key (env → encrypted config) or no synthesis.
  if (!cfg.anthropic.apiKey) return undefined;
  return new AnthropicSdkLlm(cfg.anthropic.heavyModel, cfg.anthropic.apiKey);
}
