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
import type { ModelRuntimeContext, ModelSelection } from "@aos/shared";
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

  /** Resolve and run an utterance end-to-end. Returns the operation id. */
  async dispatch(input: string): Promise<string> {
    const intent = await this.router.route(input);
    this.bus.emit({ type: "routing.resolved", at: now(), intent });

    const opId = randomUUID();
    const skill = this.loader.forAction(intent.actionId);

    // No skill bound — acknowledge and stop (not an error).
    if (!skill) {
      this.bus.emit({
        type: "operation.started",
        at: now(),
        op: { opId, actionId: intent.actionId, skillId: null, selection: null },
      });
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

    // Run the model-selection cascade.
    let selection: ModelSelection | null;
    try {
      selection = selectModel(skill.modelPolicy, this.runtime, {
        defaults: {
          maxLatencyMs: config.budgets.defaultMaxLatencyMs,
          maxCostUsd: config.budgets.defaultMaxCostUsd,
        },
      });
    } catch (err) {
      this.bus.emit({
        type: "operation.started",
        at: now(),
        op: { opId, actionId: intent.actionId, skillId: skill.id, selection: null },
      });
      this.bus.emit({ type: "operation.failed", at: now(), opId, error: (err as Error).message });
      return opId;
    }

    this.bus.emit({
      type: "operation.started",
      at: now(),
      op: { opId, actionId: intent.actionId, skillId: skill.id, selection },
    });

    // Fire-and-stream. Callers that need completion can await dispatch().
    await this.runtimeExec.execute(skill, intent, selection, opId);
    return opId;
  }
}
