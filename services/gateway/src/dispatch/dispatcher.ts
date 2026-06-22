/**
 * Dispatcher — the spine that turns an utterance into a running operation.
 *
 *   route(input) -> RoutedIntent
 *     -> find the skill bound to intent.actionId
 *        -> run the model-selection cascade on its policy
 *           -> hand off to the SkillRuntime
 *
 * Every step emits onto the bus, so the HUD and audit log observe the full
 * lifecycle. Actions with no bound skill (e.g. "rundown" before its skill
 * exists) resolve to a notification rather than an error.
 */
import { randomUUID } from "node:crypto";
import type {
  ModelRuntimeContext,
  ModelSelection,
  RoutedIntent,
  SkillManifest,
} from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import { EventBus, now } from "../bus/event-bus.js";
import { selectModel } from "../models/model-selector.js";
import type { Router } from "../routing/router.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import { SkillRuntime } from "../skills/skill-runtime.js";

export class Dispatcher {
  private readonly runtimeExec: SkillRuntime;

  constructor(
    private readonly router: Router,
    private readonly loader: SkillLoader,
    private readonly bus: EventBus,
    private readonly runtime: ModelRuntimeContext,
    runtimeExec?: SkillRuntime,
  ) {
    this.runtimeExec = runtimeExec ?? new SkillRuntime(bus);
  }

  /**
   * Natural-language path: resolve an utterance through the router, then run
   * the bound skill. Returns the operation id.
   */
  async dispatch(input: string): Promise<string> {
    const intent = await this.router.route(input);
    this.bus.emit({ type: "routing.resolved", at: now(), intent });

    const opId = randomUUID();
    const skill = this.loader.forAction(intent.actionId);

    // No skill bound — acknowledge and stop (not an error).
    if (!skill) {
      this.startOp(opId, intent.actionId, null, null);
      this.bus.emit({
        type: "notification",
        at: now(),
        level: intent.actionId === "unknown" ? "info" : "warn",
        message:
          intent.actionId === "unknown"
            ? `No confident match for "${intent.rawInput}".`
            : `No skill bound to action "${intent.actionId}" yet.`,
      });
      this.bus.emit({ type: "operation.completed", at: now(), opId, exitCode: 0 });
      return opId;
    }

    await this.runSkill(skill, intent, opId);
    return opId;
  }

  /**
   * Deterministic path: invoke a skill directly by id (command-deck buttons,
   * voice shortcuts, or composition by other skills). Bypasses the router.
   *
   * `requireDeck` gates user-facing invokes: a skill must be surfaced as "deck"
   * and have its required presentation inputs satisfied. Internal composition
   * calls leave it false.
   */
  async invoke(
    skillId: string,
    params: Record<string, unknown> = {},
    opts: { requireDeck?: boolean } = {},
  ): Promise<string> {
    const opId = randomUUID();
    const skill = this.loader.get(skillId);

    if (!skill) {
      this.startOp(opId, skillId, null, null);
      this.bus.emit({ type: "operation.failed", at: now(), opId, error: `unknown skill "${skillId}"` });
      return opId;
    }

    if (opts.requireDeck) {
      if (!skill.surfaces.includes("deck")) {
        this.startOp(opId, skill.id, skill.id, null);
        this.bus.emit({
          type: "operation.failed",
          at: now(),
          opId,
          error: `skill "${skillId}" is not invokable from the command deck`,
        });
        return opId;
      }
      const missing = (skill.presentation?.inputs ?? [])
        .filter((i) => i.required && (params[i.name] === undefined || params[i.name] === ""))
        .map((i) => i.name);
      if (missing.length > 0) {
        this.startOp(opId, skill.id, skill.id, null);
        this.bus.emit({
          type: "operation.failed",
          at: now(),
          opId,
          error: `missing required input(s): ${missing.join(", ")}`,
        });
        return opId;
      }
    }

    const intent: RoutedIntent = {
      actionId: skill.triggers[0] ?? skill.id,
      source: "direct",
      confidence: 1,
      parameters: params,
      rawInput: `invoke:${skillId}`,
    };
    this.bus.emit({ type: "routing.resolved", at: now(), intent });
    await this.runSkill(skill, intent, opId);
    return opId;
  }

  /** Shared tail: model-selection cascade -> runtime, with event emission. */
  private async runSkill(skill: SkillManifest, intent: RoutedIntent, opId: string): Promise<void> {
    let selection: ModelSelection | null;
    try {
      selection = selectModel(skill.modelPolicy, this.runtime, {
        defaults: {
          maxLatencyMs: config.budgets.defaultMaxLatencyMs,
          maxCostUsd: config.budgets.defaultMaxCostUsd,
        },
      });
    } catch (err) {
      this.startOp(opId, intent.actionId, skill.id, null);
      this.bus.emit({ type: "operation.failed", at: now(), opId, error: (err as Error).message });
      return;
    }

    this.startOp(opId, intent.actionId, skill.id, selection);
    await this.runtimeExec.execute(skill, intent, selection, opId);
  }

  private startOp(
    opId: string,
    actionId: string,
    skillId: string | null,
    selection: ModelSelection | null,
  ): void {
    this.bus.emit({ type: "operation.started", at: now(), op: { opId, actionId, skillId, selection } });
  }
}
