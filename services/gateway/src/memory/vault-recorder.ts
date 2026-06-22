/**
 * Vault recorder — bridges the live event bus to durable storage. It watches
 * operation lifecycle events and appends a one-line entry per completed/failed
 * operation to today's daily-note Operations log, which is exactly the "latest
 * operations in Obsidian storage" the HUD's V.A.U.L.T. view renders.
 */
import type { OperationDescriptor, OsEvent } from "@aos/shared";
import type { EventBus } from "../bus/event-bus.js";
import type { VaultAdapter } from "./vault-adapter.js";

export class VaultRecorder {
  private readonly inflight = new Map<string, OperationDescriptor>();

  constructor(
    private readonly bus: EventBus,
    private readonly vault: VaultAdapter,
  ) {
    this.bus.subscribe((e) => this.handle(e));
  }

  private handle(e: OsEvent): void {
    if (e.type === "operation.started") {
      this.inflight.set(e.op.opId, e.op);
      return;
    }
    if (e.type === "operation.completed" || e.type === "operation.failed") {
      const op = this.inflight.get(e.opId);
      this.inflight.delete(e.opId);
      const action = op?.actionId ?? "?";
      const skill = op?.skillId ?? "—";
      const verdict =
        e.type === "operation.completed" ? `ok (exit ${e.exitCode})` : `FAILED: ${e.error}`;
      const line = `\`${e.at}\` **${action}** [${skill}] — ${verdict}`;
      try {
        this.vault.appendDailyOperation(dateKey(e.at), line, e.at);
      } catch (err) {
        console.error("[vault-recorder] failed to record op:", (err as Error).message);
      }
    }
  }
}

/** YYYY-MM-DD from an ISO timestamp (UTC). */
function dateKey(iso: string): string {
  return (iso.split("T")[0] ?? iso).slice(0, 10);
}
