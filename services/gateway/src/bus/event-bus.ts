/**
 * Event bus — the gateway's internal pub/sub. Every subsystem (router,
 * dispatcher, skill runtime) emits `OsEvent`s here; the WS server and audit
 * logger subscribe. A listener throwing never breaks the emit loop.
 */
import type { OsEvent } from "@aos/shared";

export type EventListener = (event: OsEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: OsEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[event-bus] listener threw:", err);
      }
    }
  }
}

/** Current ISO-8601 timestamp, for stamping events at emit time. */
export function now(): string {
  return new Date().toISOString();
}
