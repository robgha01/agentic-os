/**
 * Action catalog — the route targets both routing paths resolve into.
 *
 * Seeded with the spec's deterministic keywords ("rundown", "sync") plus the
 * skill-backed actions (deep research, inbox triage, and the Shape A
 * ship-ticket pipeline reframed as a skill). `unknown` is the fallback the
 * semantic path yields when nothing matches confidently.
 */
import type { Action } from "@aos/shared";

export const ACTION_REGISTRY: readonly Action[] = [
  {
    id: "rundown",
    description:
      "Produce the morning rundown / daily brief: synthesize schedule, telemetry, and tracked tasks from the Obsidian vault into a spoken+written summary.",
    keywords: ["rundown", "brief", "morning report"],
  },
  {
    id: "sync",
    description:
      "Synchronize state: refresh vault records, pull latest telemetry, and reconcile tracking data. A maintenance/refresh operation, not analysis.",
    keywords: ["sync", "synchronize", "refresh"],
  },
  {
    id: "last-30-days",
    description:
      "Run the 'Last 30 Days' deep-research pipeline: scrape high-signal platforms (Reddit, X, YouTube transcripts, Hacker News, repos) and compile a deep contextual brief on a topic.",
    keywords: ["last 30 days", "deep research", "research"],
    parameters: [
      { name: "topic", type: "string", description: "The subject to research.", required: true },
    ],
  },
  {
    id: "inbox-triage",
    description:
      "Triage the email inbox: classify, summarize, and surface action items from unread mail.",
    keywords: ["inbox", "triage", "email"],
  },
  {
    id: "ship-ticket",
    description:
      "Run the Jira ticket pipeline (the legacy Shape A flow as a skill): branch, implement, submit, and ship a referenced ticket.",
    keywords: ["ship", "ticket", "jira"],
    parameters: [
      { name: "ticketId", type: "string", description: "Jira ticket id, e.g. SCA-431.", required: true },
    ],
  },
  {
    id: "unknown",
    description:
      "No confident match. Use when the request does not clearly correspond to any other action; the OS will ask the user to clarify.",
  },
] as const;

/** Set of valid action ids, for fast membership checks during validation. */
export const ACTION_IDS: ReadonlySet<string> = new Set(
  ACTION_REGISTRY.map((a) => a.id),
);

export function isKnownAction(id: string): boolean {
  return ACTION_IDS.has(id);
}
