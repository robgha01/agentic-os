/**
 * OS event contracts — the wire format between the gateway and the HUD.
 *
 * The gateway emits `OsEvent`s onto its event bus; the WebSocket server
 * broadcasts them to connected HUD clients. Clients send `ClientCommand`s back
 * (e.g. a typed/spoken request to route). Shared here so the HUD (Phase 4) and
 * the gateway speak exactly the same types.
 */
import type { RoutedIntent } from "./actions.js";
import type { ModelSelection } from "./models.js";

/** The vault record an operation produced — lets the HUD link a result card to its doc. */
export interface OperationResult {
  /** Vault-relative path, e.g. "10-research/bitcoin.md" (opens in the doc viewer). */
  path: string;
  /** Human title, used as the notification card's label. */
  title: string;
  /** Document type ("research" | "inbox" | "daily" | ...). */
  type: string;
}

/** Identity + selection context for one dispatched operation. */
export interface OperationDescriptor {
  opId: string;
  actionId: string;
  /** The skill bound to the action, or null when no skill is bound. */
  skillId: string | null;
  /** The model chosen for this op, or null (deterministic / no skill). */
  selection: ModelSelection | null;
}

/** Everything the gateway can announce. `at` is an ISO-8601 timestamp. */
export type OsEvent =
  | { type: "routing.resolved"; at: string; intent: RoutedIntent }
  | { type: "operation.started"; at: string; op: OperationDescriptor }
  | {
      type: "operation.output";
      at: string;
      opId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | { type: "operation.completed"; at: string; opId: string; exitCode: number | null; result?: OperationResult }
  | { type: "operation.failed"; at: string; opId: string; error: string }
  | { type: "notification"; at: string; level: "info" | "warn" | "error"; message: string }
  | { type: "metric"; at: string; name: string; value: number }
  /**
   * The OS "saying" something to the user. `text` is always present (the
   * spoken-as-text content); in voice mode `audioUrl` points to synthesized
   * audio the HUD plays. `mode` reflects what was actually produced — a voice
   * request that falls back to text reports `mode: "text"`.
   */
  | { type: "speech"; at: string; text: string; mode: "text" | "voice"; audioUrl?: string; provider?: string }
  /**
   * A sign-in is needed (e.g. Outlook device-code). The HUD renders this as a
   * "finish login" prompt — open `verificationUri` and enter `userCode`.
   */
  | { type: "auth.prompt"; at: string; service: string; verificationUri: string; userCode: string; message: string; expiresAt: string }
  | { type: "auth.resolved"; at: string; service: string; ok: boolean };

export type OsEventType = OsEvent["type"];

/** Commands a HUD/voice client can send to the gateway. */
export type ClientCommand =
  /** Free text (typed/spoken) -> routed through the intent router. */
  | { type: "route"; input: string }
  /** Deterministic command-deck button -> invoke a skill by id, no routing. */
  | { type: "invoke"; skillId: string; params?: Record<string, unknown> }
  /** Speak a vault record aloud — the OS reads its spoken core (TL;DR blockquote). */
  | { type: "speak"; path: string }
  | { type: "ping" };
