/**
 * Scheduler — a global concurrency limit + FIFO queue in front of the dispatcher.
 *
 * Without this, every `route`/`invoke` ran immediately and unbounded, so a burst
 * of heavy `claude -p` skills would all spawn at once. The scheduler caps how
 * many operations run concurrently (config.tasks.maxConcurrent, read live) and
 * queues the rest. Each task gets its opId at submit time and emits
 * `operation.queued` so the HUD can show what's waiting; the dispatcher then
 * emits the normal `operation.started` → `operation.completed/failed` with the
 * same opId once it actually runs.
 */
import { randomUUID } from "node:crypto";
import { EventBus, now } from "../bus/event-bus.js";

interface QueuedTask {
  opId: string;
  label: string;
  kind: "route" | "invoke";
  run: (opId: string) => Promise<unknown>;
}

export class Scheduler {
  private readonly queue: QueuedTask[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly bus: EventBus,
    /** Read live so an Options change to the limit applies without restart. */
    private readonly limit: () => number,
  ) {}

  /** Enqueue a task; returns its opId. Emits `operation.queued`, then pumps. */
  submit(run: (opId: string) => Promise<unknown>, meta: { kind: "route" | "invoke"; label: string }): string {
    const opId = randomUUID();
    this.queue.push({ opId, run, kind: meta.kind, label: meta.label });
    this.bus.emit({ type: "operation.queued", at: now(), opId, label: meta.label, kind: meta.kind });
    this.pump();
    return opId;
  }

  /** Counts for diagnostics/health. */
  stats(): { running: number; queued: number; limit: number } {
    return { running: this.running.size, queued: this.queue.length, limit: this.limit() };
  }

  /** Start tasks while a slot is free. A task frees its slot when it settles. */
  private pump(): void {
    while (this.running.size < Math.max(1, this.limit()) && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running.add(task.opId);
      // run() resolves when the dispatcher's dispatch/invoke completes; finally
      // frees the slot even on throw so the queue can never wedge.
      void Promise.resolve(task.run(task.opId)).finally(() => {
        this.running.delete(task.opId);
        this.pump();
      });
    }
  }
}
