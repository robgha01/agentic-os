/**
 * Skill runtime — executes a dispatched skill and streams its output onto the
 * event bus as operation.output / .completed / .failed events.
 *
 * Three execution kinds:
 *  - claude-headless : spawn a hidden `claude -p` session (model from selection)
 *  - process         : spawn an arbitrary local command (scrapers, pipelines)
 *  - native          : invoke an in-gateway TypeScript handler
 */
import { spawn } from "node:child_process";
import type { ModelSelection, RoutedIntent, SkillManifest } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import { EventBus, now } from "../bus/event-bus.js";
import { NATIVE_HANDLERS } from "./native-registry.js";

/** Fill `{{param}}` placeholders from the routed intent's parameters. */
export function renderTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export class SkillRuntime {
  constructor(private readonly bus: EventBus) {}

  /** Run a skill to completion, emitting events. Resolves when the op ends. */
  async execute(
    skill: SkillManifest,
    intent: RoutedIntent,
    selection: ModelSelection | null,
    opId: string,
  ): Promise<void> {
    const exec = skill.execution;

    switch (exec.kind) {
      case "claude-headless": {
        const model =
          selection?.model ?? config.anthropic.heavyModel; // selection drives the model
        const prompt = renderTemplate(exec.promptTemplate, intent.parameters);
        await this.spawnStreaming(
          opId,
          config.claudeCode.bin,
          ["-p", "--model", model, ...exec.args],
          prompt,
        );
        return;
      }

      case "process": {
        const args = exec.args.map((a) => renderTemplate(a, intent.parameters));
        await this.spawnStreaming(opId, exec.command, args);
        return;
      }

      case "native": {
        const handler = NATIVE_HANDLERS[exec.handler];
        if (!handler) {
          this.fail(opId, `no native handler registered for "${exec.handler}"`);
          return;
        }
        try {
          const code = await handler({
            intent,
            emit: (chunk) => this.output(opId, "stdout", chunk),
          });
          this.complete(opId, code);
        } catch (err) {
          this.fail(opId, (err as Error).message);
        }
        return;
      }
    }
  }

  /** Spawn a child process, stream stdio to the bus, emit completed/failed. */
  private spawnStreaming(
    opId: string,
    command: string,
    args: string[],
    stdin?: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

      child.stdout.on("data", (d: Buffer) => this.output(opId, "stdout", d.toString()));
      child.stderr.on("data", (d: Buffer) => this.output(opId, "stderr", d.toString()));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        this.fail(opId, `failed to spawn "${command}": ${err.message}`);
        resolve();
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        this.complete(opId, code);
        resolve();
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
