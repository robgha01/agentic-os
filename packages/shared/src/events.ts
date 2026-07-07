/**
 * OS event contracts — the wire format between the gateway and the HUD.
 *
 * The gateway emits `OsEvent`s onto its event bus; the WebSocket server
 * broadcasts them to connected HUD clients. Clients send `ClientCommand`s back
 * (e.g. a typed/spoken request to route). Shared here so the HUD (Phase 4) and
 * the gateway speak exactly the same types.
 */
import { z } from "zod";
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
  /** Accepted into the queue but not yet running (concurrency limit). */
  | { type: "operation.queued"; at: string; opId: string; label: string; kind: "route" | "invoke" }
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
  | { type: "notification"; at: string; level: "info" | "warn" | "error"; message: string; speak?: boolean }
  | { type: "metric"; at: string; name: string; value: number }
  /**
   * The OS "saying" something to the user. `text` is always present (the
   * spoken-as-text content); in voice mode `audioUrl` points to synthesized
   * audio the HUD plays. `mode` reflects what was actually produced — a voice
   * request that falls back to text reports `mode: "text"`.
   *
   * `onDemand` marks user-initiated playback (the "Speak this record" button):
   * it plays immediately, interrupting anything. Absent/false = an OS
   * announcement (result auto-announce, spoken notification), which the HUD
   * speaks only if the voice is free — otherwise it surfaces as an unheard
   * card. `path` is the source vault record (announcements only), so the HUD
   * can mark the matching card unheard when it skips speaking it.
   */
  | { type: "speech"; at: string; text: string; mode: "text" | "voice"; audioUrl?: string; provider?: string; onDemand?: boolean; path?: string }
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

// --- Runtime validation (the wire is untrusted on both ends) -----------------

// `source` (ROUTE_SOURCES) and `provider` (PROVIDER_IDS) are the canonical sets,
// but on the wire they stay permissive strings so a HUD bundle keeps rendering
// events from a newer gateway that added a route source or provider id — the HUD
// treats them as display/provenance strings only, never branching on them.
const RoutedIntentSchema = z.object({
  actionId: z.string(),
  source: z.string(),
  confidence: z.number(),
  parameters: z.record(z.unknown()),
  rawInput: z.string(),
  reasoning: z.string().optional(),
}) as unknown as z.ZodType<RoutedIntent>;

const ModelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reason: z.string(),
}) as unknown as z.ZodType<ModelSelection>;

const OperationResultSchema: z.ZodType<OperationResult> = z.object({
  path: z.string(),
  title: z.string(),
  type: z.string(),
});

const OperationDescriptorSchema: z.ZodType<OperationDescriptor> = z.object({
  opId: z.string(),
  actionId: z.string(),
  skillId: z.string().nullable(),
  selection: ModelSelectionSchema.nullable(),
});

export const OsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("routing.resolved"), at: z.string(), intent: RoutedIntentSchema }),
  z.object({ type: z.literal("operation.queued"), at: z.string(), opId: z.string(), label: z.string(), kind: z.enum(["route", "invoke"]) }),
  z.object({ type: z.literal("operation.started"), at: z.string(), op: OperationDescriptorSchema }),
  z.object({ type: z.literal("operation.output"), at: z.string(), opId: z.string(), stream: z.enum(["stdout", "stderr"]), chunk: z.string() }),
  z.object({ type: z.literal("operation.completed"), at: z.string(), opId: z.string(), exitCode: z.number().nullable(), result: OperationResultSchema.optional() }),
  z.object({ type: z.literal("operation.failed"), at: z.string(), opId: z.string(), error: z.string() }),
  z.object({ type: z.literal("notification"), at: z.string(), level: z.enum(["info", "warn", "error"]), message: z.string(), speak: z.boolean().optional() }),
  z.object({ type: z.literal("metric"), at: z.string(), name: z.string(), value: z.number() }),
  z.object({ type: z.literal("speech"), at: z.string(), text: z.string(), mode: z.enum(["text", "voice"]), audioUrl: z.string().optional(), provider: z.string().optional(), onDemand: z.boolean().optional(), path: z.string().optional() }),
  z.object({ type: z.literal("auth.prompt"), at: z.string(), service: z.string(), verificationUri: z.string(), userCode: z.string(), message: z.string(), expiresAt: z.string() }),
  z.object({ type: z.literal("auth.resolved"), at: z.string(), service: z.string(), ok: z.boolean() }),
]) as unknown as z.ZodType<OsEvent>;

export const ClientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("route"), input: z.string().min(1) }),
  z.object({ type: z.literal("invoke"), skillId: z.string().min(1), params: z.record(z.unknown()).optional() }),
  z.object({ type: z.literal("speak"), path: z.string().min(1) }),
  z.object({ type: z.literal("ping") }),
]) as unknown as z.ZodType<ClientCommand>;

/** Validate an inbound event frame; null when it isn't a well-formed OsEvent. */
export function parseOsEvent(input: unknown): OsEvent | null {
  const r = OsEventSchema.safeParse(input);
  return r.success ? r.data : null;
}

/** Validate an inbound client command; null when it isn't well formed. */
export function parseClientCommand(input: unknown): ClientCommand | null {
  const r = ClientCommandSchema.safeParse(input);
  return r.success ? r.data : null;
}
