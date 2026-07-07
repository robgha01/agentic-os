/**
 * Deterministic routing table — the regex/keyword path.
 *
 * Checked before any LLM call. The first matching rule (by descending priority)
 * wins and resolves instantly with confidence 1. Patterns are intentionally
 * tight: a regex match must be unambiguous, or it belongs on the semantic path.
 */

export interface RouteRule {
  /** Identifier for the rule (for logging/debugging). */
  id: string;
  /** The pattern tested against the raw (lowercased internally) utterance. */
  pattern: RegExp;
  /** Action id this rule resolves to; must exist in the action registry. */
  action: string;
  /** Higher wins when multiple rules match. */
  priority: number;
  /** Sample utterances this rule is meant to catch (doubles as documentation/tests). */
  examples: string[];
}

export const ROUTES: readonly RouteRule[] = [
  {
    id: "rundown",
    // Tight, unambiguous phrasings only — bare "brief"/"update" are too common
    // and would false-fire, so they're anchored ("morning brief", "daily update").
    pattern: /\b(rundown|run[\s-]?down|morning (?:brief|report|update)|daily (?:brief|update|rundown)|brief me)\b/i,
    action: "rundown",
    priority: 100,
    examples: ["give me the rundown", "rundown", "brief me", "morning report", "daily update", "morning brief"],
  },
  {
    id: "schedule",
    // Plain schedule asks. "rundown of today's schedule" still hits rundown
    // (priority 100) — and the morning report folds the schedule in anyway.
    pattern: /\b(my (?:schedule|calendar|agenda)|today'?s (?:schedule|agenda|meetings)|what'?s on (?:today|my calendar))\b/i,
    action: "schedule",
    priority: 95,
    examples: ["my schedule", "today's schedule", "what's on today", "my calendar"],
  },
  {
    id: "sync",
    pattern: /\b(sync|synchron[is]z?e|refresh everything)\b/i,
    action: "sync",
    priority: 90,
    examples: ["sync everything", "sync the vault", "synchronize"],
  },
  {
    id: "inbox-triage",
    // Email triage asks. Tight enough that a passing mention of "email" in a
    // longer sentence won't fire — it wants an inbox/triage-shaped request.
    pattern:
      /\b(triage (?:my )?(?:inbox|e-?mails?)|(?:check|go through|clear) (?:my )?(?:inbox|e-?mails?)|unread (?:e-?mails?|mail)|my inbox)\b/i,
    action: "inbox-triage",
    priority: 85,
    examples: ["triage my inbox", "check my email", "go through my inbox", "unread emails", "my inbox"],
  },
  {
    id: "last-30-days",
    pattern: /\b(last 30 days|deep[\s-]?research)\b/i,
    action: "last-30-days",
    priority: 80,
    examples: ["last 30 days on rust async", "deep research electric vehicles"],
  },
  {
    id: "ship-ticket",
    // Only fires when a ticket id is actually present — the id is required, and
    // the named group carries it through to the skill's parameters. A bare
    // "ship" with no id falls through to the semantic path (which can ask).
    pattern: /\b(?:ship|ship\s+ticket|jira)\s+(?<ticketId>[a-z]{2,}-\d+)\b/i,
    action: "ship-ticket",
    priority: 75,
    examples: ["ship SCA-431", "ship ticket SCA-431", "jira ABC-12"],
  },
] as const;
