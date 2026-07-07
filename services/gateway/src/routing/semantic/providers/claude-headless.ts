/**
 * Headless Claude Code routing adapter — an ALTERNATIVE transport for the same
 * brain. Instead of hitting the Anthropic Messages API over HTTP, it shells out
 * to a hidden `claude -p` session (Claude Code CLI) with `--model`, so the
 * router (or any light task) can run through the local Claude Code auth/session
 * rather than a raw API key.
 *
 * Same RouterProvider contract as the SDK adapter — fully interchangeable. The
 * `--model` flag accepts the same ids (e.g. claude-haiku-4-5), so this works
 * for Haiku and anything else `claude -p` supports.
 */
import type { Action, ProviderId } from "@aos/shared";
import { claudeSettingArgs } from "../../../util/claude-args.js";
import { runProcess } from "../../../util/run-process.js";
import { parseIntentJson, toRouterDecision } from "../parse.js";
import type { RouterDecision, RouterProvider } from "../provider.types.js";
import { JSON_RESPONSE_INSTRUCTION, buildRouterSystemPrompt } from "../prompt.js";

export interface ClaudeHeadlessOptions {
  /** Provider id this adapter reports as — keeps registry/selection semantics intact. */
  id?: ProviderId;
  /** CLI binary, default "claude". */
  bin?: string;
  /** Kill the session if it exceeds this. */
  timeoutMs?: number;
  /** `--setting-sources` scope, so global plugins/hooks don't load for routing. */
  settingSources?: string;
}

/** Envelope `claude -p --output-format json` prints on stdout. */
interface ClaudeCliResult {
  result?: string;
  is_error?: boolean;
}

export class ClaudeHeadlessProvider implements RouterProvider {
  readonly id: ProviderId;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly settingSources: string;

  constructor(
    private readonly model: string,
    opts: ClaudeHeadlessOptions = {},
  ) {
    this.id = opts.id ?? "haiku";
    this.bin = opts.bin ?? "claude";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.settingSources = opts.settingSources ?? "";
  }

  async route(input: string, catalog: readonly Action[]): Promise<RouterDecision> {
    const prompt = [
      buildRouterSystemPrompt(catalog),
      "",
      JSON_RESPONSE_INSTRUCTION,
      "",
      "USER REQUEST:",
      input,
    ].join("\n");

    const envelope = await this.runClaude(prompt);
    if (envelope.is_error || !envelope.result) {
      throw new Error("claude-headless: session returned an error or empty result");
    }

    const parsed = parseIntentJson(envelope.result);
    if (!parsed) {
      throw new Error(`claude-headless: result was not valid JSON intent: ${envelope.result.slice(0, 200)}`);
    }
    return toRouterDecision(parsed);
  }

  /** Spawn `claude -p --output-format json --model <model>`, prompt via stdin. */
  private async runClaude(prompt: string): Promise<ClaudeCliResult> {
    // shell:true resolves claude.cmd on Windows.
    const r = await runProcess(
      this.bin,
      ["-p", ...claudeSettingArgs(this.settingSources), "--output-format", "json", "--model", this.model],
      {
        stdin: prompt,
        shell: true,
        timeoutMs: this.timeoutMs,
      },
    );
    if (r.spawnError) throw new Error(`claude-headless: failed to spawn "${this.bin}": ${r.spawnError}`);
    if (r.timedOut) throw new Error(`claude-headless: timed out after ${this.timeoutMs}ms`);
    if (r.code !== 0) throw new Error(`claude-headless: exited ${r.code}: ${r.stderr.trim()}`);
    try {
      return JSON.parse(r.stdout) as ClaudeCliResult;
    } catch {
      throw new Error("claude-headless: could not parse CLI JSON envelope");
    }
  }
}
