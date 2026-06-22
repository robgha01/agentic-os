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
import { spawn } from "node:child_process";
import type { ModelSelection, RoutedIntent, SkillManifest } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import { EventBus, now } from "../bus/event-bus.js";
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
    const result = await this.runOne(skill, intent, selection, context, opId);
    if (result.ok) this.complete(opId, result.exitCode);
    else this.fail(opId, result.error ?? `exit ${result.exitCode}`);
  }

  /** Execute one skill (recursively for composites). Streams output; no lifecycle. */
  private async runOne(
    skill: SkillManifest,
    intent: RoutedIntent,
    selection: ModelSelection | null,
    context: Record<string, unknown>,
    opId: string,
  ): Promise<StepResult> {
    const exec = skill.execution;

    switch (exec.kind) {
      case "claude-headless": {
        const model = selection?.model ?? config.anthropic.heavyModel;
        const prompt = renderTemplate(exec.promptTemplate, intent.parameters);
        return this.spawnCollect(opId, config.claudeCode.bin, ["-p", "--model", model, ...exec.args], prompt);
      }

      case "process": {
        const args = exec.args.map((a) => renderTemplate(a, intent.parameters));
        return this.spawnCollect(opId, exec.command, args);
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
            services: this.services,
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
          const r = await this.runOne(step, intent, selection, context, opId);
          if (!r.ok) {
            return { ok: false, exitCode: r.exitCode, error: `step "${step.id}" failed: ${r.error ?? `exit ${r.exitCode}`}` };
          }
        }
        return { ok: true, exitCode: 0 };
      }
    }
  }

  /** Spawn a child, stream its stdio to the bus, resolve with a StepResult. */
  private spawnCollect(
    opId: string,
    command: string,
    args: string[],
    stdin?: string,
  ): Promise<StepResult> {
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

      child.stdout.on("data", (d: Buffer) => this.output(opId, "stdout", d.toString()));
      child.stderr.on("data", (d: Buffer) => this.output(opId, "stderr", d.toString()));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, exitCode: null, error: `failed to spawn "${command}": ${err.message}` });
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        resolve({ ok: code === 0, exitCode: code });
      });

      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    });
  }

  private output(opId: string, stream: "stdout" | "stderr", chunk: string): void {
    this.bus.emit({ type: "operation.output", at: now(), opId, stream, chunk });
  }

  private complete(opId: string, exitCode: number | null): void {
    this.bus.emit({ type: "operation.completed", at: now(), opId, exitCode });
  }

  private fail(opId: string, error: string): void {
    this.bus.emit({ type: "operation.failed", at: now(), opId, error });
  }
}
