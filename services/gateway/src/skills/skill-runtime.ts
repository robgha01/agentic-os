/**
 * Skill runtime — executes a dispatched skill and streams its output onto the
 * event bus as operation.output / .completed / .failed events.
 *
 * Execution kinds:
 *  - claude-headless : spawn a hidden `claude -p` session (model from selection)
 *  - process         : spawn an arbitrary local command (scrapers, pipelines)
 *  - native          : invoke an in-gateway TypeScript handler (gets services +
 *                      a shared context bag)
 *  - composite       : run an ordered list of sub-skills, threading one shared
 *                      context so steps pass data between each other
 *
 * The op lifecycle (completed/failed) is emitted once, at the top level — sub-
 * steps only stream output under the same opId.
 */
import type { ModelSelection, OperationResult, RoutedIntent, SkillManifest } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import { EventBus, now } from "../bus/event-bus.js";
import { createLlmForSelection } from "../llm/llm-service.js";
import { runProcess } from "../util/run-process.js";
import { NATIVE_HANDLERS, type SkillServices } from "./native-registry.js";
import type { SkillLoader } from "./skill-loader.js";

/** Fill `{{param}}` placeholders from the routed intent's parameters. */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

interface StepResult {
  ok: boolean;
  exitCode: number | null;
  error?: string;
}

export class SkillRuntime {
  constructor(
    private readonly bus: EventBus,
    private readonly loader: SkillLoader,
    private readonly services: SkillServices,
  ) {}

  /** Run a skill to completion, emitting the op lifecycle once. */
  async execute(
    skill: SkillManifest,
    intent: RoutedIntent,
    selection: ModelSelection | null,
    opId: string,
  ): Promise<void> {
    const context: Record<string, unknown> = {};
    // Use the skill-selected brain for this op's LLM work; fall back to the
    // globally-injected default when the policy resolved no selection.
    const services = this.servicesFor(selection);
    const result = await this.runOne(skill, intent, selection, context, opId, services);
    if (result.ok) this.complete(opId, result.exitCode, context.result as OperationResult | undefined);
    else this.fail(opId, result.error ?? `exit ${result.exitCode}`);
  }

  /** Per-op services with the LLM resolved from the selection (or the default). */
  private servicesFor(selection: ModelSelection | null): SkillServices {
    if (!selection) return this.services;
    const llm = createLlmForSelection(selection) ?? this.services.llm;
    return { ...this.services, llm };
  }

  /** Execute one skill (recursively for composites). Streams output; no lifecycle. */
  private async runOne(
    skill: SkillManifest,
    intent: RoutedIntent,
    selection: ModelSelection | null,
    context: Record<string, unknown>,
    opId: string,
    services: SkillServices,
  ): Promise<StepResult> {
    const exec = skill.execution;

    switch (exec.kind) {
      case "claude-headless": {
        const model = selection?.model ?? config.anthropic.heavyModel;
        const prompt = renderTemplate(exec.promptTemplate, intent.parameters);
        // shell:true so Windows resolves the `claude.cmd` shim; prompt via stdin, never argv.
        return this.spawnCollect(opId, config.claudeCode.bin, ["-p", "--model", model, ...exec.args], {
          stdin: prompt,
          shell: true,
          timeoutMs: exec.timeoutMs,
        });
      }

      case "process": {
        const args = exec.args.map((a) => renderTemplate(a, intent.parameters));
        return this.spawnCollect(opId, exec.command, args, { timeoutMs: exec.timeoutMs });
      }

      case "native": {
        const handler = NATIVE_HANDLERS[exec.handler];
        if (!handler) {
          return { ok: false, exitCode: null, error: `no native handler registered for "${exec.handler}"` };
        }
        try {
          const code = await handler({
            intent,
            params: intent.parameters,
            context,
            services,
            emit: (chunk) => this.output(opId, "stdout", chunk),
          });
          return { ok: code === 0, exitCode: code };
        } catch (err) {
          return { ok: false, exitCode: null, error: (err as Error).message };
        }
      }

      case "composite": {
        for (const stepId of exec.steps) {
          const step = this.loader.get(stepId);
          if (!step) return { ok: false, exitCode: null, error: `composite step "${stepId}" not found` };
          this.output(opId, "stdout", `▸ step: ${step.id}\n`);
          const r = await this.runOne(step, intent, selection, context, opId, services);
          if (!r.ok) {
            return { ok: false, exitCode: r.exitCode, error: `step "${step.id}" failed: ${r.error ?? `exit ${r.exitCode}`}` };
          }
        }
        return { ok: true, exitCode: 0 };
      }
    }
  }

  /** Skills may run long (a headless ship-ticket implements a whole change). */
  private static readonly DEFAULT_SKILL_TIMEOUT_MS = 15 * 60_000;

  /** Spawn a child, stream its stdio to the bus, resolve with a StepResult. */
  private async spawnCollect(
    opId: string,
    command: string,
    args: string[],
    opts: { stdin?: string; timeoutMs?: number; shell?: boolean } = {},
  ): Promise<StepResult> {
    const r = await runProcess(command, args, {
      stdin: opts.stdin,
      shell: opts.shell,
      timeoutMs: opts.timeoutMs ?? SkillRuntime.DEFAULT_SKILL_TIMEOUT_MS,
      onOutput: (stream, chunk) => this.output(opId, stream, chunk),
    });
    if (r.spawnError) return { ok: false, exitCode: null, error: `failed to spawn "${command}": ${r.spawnError}` };
    if (r.timedOut) return { ok: false, exitCode: null, error: `"${command}" timed out and was killed` };
    return { ok: r.code === 0, exitCode: r.code };
  }

  private output(opId: string, stream: "stdout" | "stderr", chunk: string): void {
    this.bus.emit({ type: "operation.output", at: now(), opId, stream, chunk });
  }

  private complete(opId: string, exitCode: number | null, result?: OperationResult): void {
    this.bus.emit({ type: "operation.completed", at: now(), opId, exitCode, ...(result ? { result } : {}) });
  }

  private fail(opId: string, error: string): void {
    this.bus.emit({ type: "operation.failed", at: now(), opId, error });
  }
}
