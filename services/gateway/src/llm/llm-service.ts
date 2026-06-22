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
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../../../config/agentic-os.config.js";

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
}

export interface LlmService {
  readonly id: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}

/** Anthropic Messages API. */
class AnthropicSdkLlm implements LlmService {
  readonly id = "sdk";
  private readonly client: Anthropic;
  constructor(private readonly model: string, apiKey?: string) {
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

interface ClaudeCliResult {
  result?: string;
  is_error?: boolean;
}

/** Hidden `claude -p` session. */
class ClaudeHeadlessLlm implements LlmService {
  readonly id = "headless";
  constructor(
    private readonly model: string,
    private readonly bin: string,
    private readonly timeoutMs = 120_000,
  ) {}

  complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, ["-p", "--model", this.model, "--output-format", "json"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`claude -p timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`failed to spawn "${this.bin}": ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${stderr.trim()}`));
        try {
          const env = JSON.parse(stdout) as ClaudeCliResult;
          if (env.is_error || !env.result) return reject(new Error("claude -p returned no result"));
          resolve(env.result.trim());
        } catch {
          reject(new Error("claude -p output was not valid JSON"));
        }
      });

      child.stdin.write(full);
      child.stdin.end();
    });
  }
}

export function createLlmService(
  cfg = config,
  env: NodeJS.ProcessEnv = process.env,
): LlmService | undefined {
  if (cfg.router.transport === "headless") {
    return new ClaudeHeadlessLlm(cfg.anthropic.heavyModel, cfg.claudeCode.bin);
  }
  const key = env[cfg.anthropic.apiKeyEnv];
  if (!key) return undefined; // sdk transport but no key -> no synthesis
  return new AnthropicSdkLlm(cfg.anthropic.heavyModel, key);
}
