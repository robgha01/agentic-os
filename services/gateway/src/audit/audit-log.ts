/**
 * Audit logger — subscribes to the bus and writes a structured line per event.
 * Phase 2 logs to the console; Phase 5 will additionally append operations to
 * the Obsidian vault (the data behind the HUD's V.A.U.L.T. view).
 */
import type { OsEvent } from "@aos/shared";
import type { EventBus } from "../bus/event-bus.js";

export class AuditLogger {
  constructor(bus: EventBus) {
    bus.subscribe((e) => this.log(e));
  }

  private log(e: OsEvent): void {
    switch (e.type) {
      case "routing.resolved":
        console.log(`[audit] route ${e.intent.actionId} (${e.intent.source}, conf=${e.intent.confidence.toFixed(2)}) <- "${e.intent.rawInput}"`);
        break;
      case "operation.started":
        console.log(`[audit] op ${e.op.opId} start action=${e.op.actionId} skill=${e.op.skillId ?? "<none>"} model=${e.op.selection?.model ?? "<none>"}`);
        break;
      case "operation.output":
        // Output is high-volume; keep audit terse (trim trailing newline).
        console.log(`[audit] op ${e.opId} ${e.stream}: ${e.chunk.replace(/\n$/, "")}`);
        break;
      case "operation.completed":
        console.log(`[audit] op ${e.opId} done exit=${e.exitCode}`);
        break;
      case "operation.failed":
        console.error(`[audit] op ${e.opId} FAILED: ${e.error}`);
        break;
      case "notification":
        console.log(`[audit] note(${e.level}): ${e.message}`);
        break;
      case "metric":
        console.log(`[audit] metric ${e.name}=${e.value}`);
        break;
    }
  }
}
