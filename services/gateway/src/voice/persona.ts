/**
 * Persona — the OS's spoken personality, kept in one place.
 *
 * Centralizes user-facing phrasings so the system varies what it says instead
 * of repeating one canned line. Everything here is mode-agnostic: the text is
 * synthesized in voice mode and shown as a subtitle in text mode, so a little
 * life in the copy lands either way. Keep lines short — they're read aloud.
 */

// Rotate through variants so consecutive utterances of the same kind differ.
// A tiny per-key cursor, not randomness — deterministic and test-friendly.
const cursors = new Map<string, number>();
function rotate(key: string, variants: readonly string[]): string {
  const i = (cursors.get(key) ?? 0) % variants.length;
  cursors.set(key, i + 1);
  return variants[i]!;
}

/** Reset the rotation state — for tests. */
export function resetPersona(): void {
  cursors.clear();
}

/** Short, spoken-friendly names of what the OS can actually do. */
const CAPABILITIES = [
  "the morning rundown",
  "today's schedule",
  "inbox triage",
  "a deep-research brief on a topic",
  "shipping a Jira ticket",
] as const;

/** Two rotating suggestions, phrased as "X or Y". */
function suggestions(): string {
  const n = CAPABILITIES.length;
  const i = (cursors.get("caps") ?? 0) % n;
  cursors.set("caps", i + 2);
  return `${CAPABILITIES[i]!} or ${CAPABILITIES[(i + 1) % n]!}`;
}

/**
 * Spoken response when an utterance maps to no command. Says so plainly, then
 * points at a couple of things the OS *can* do so the dead end still helps.
 */
export function unroutable(input: string): string {
  const quoted = input.trim();
  const lead = rotate("unroutable", [
    `I didn't catch a command in "${quoted}".`,
    `I'm not sure how to run "${quoted}".`,
    `"${quoted}" didn't map to anything I do yet.`,
    `Hmm — "${quoted}" doesn't match a command.`,
  ]);
  return `${lead} You could try ${suggestions()}.`;
}

/**
 * Spoken line for an action that resolved but has no skill wired up yet —
 * honest about the gap rather than silent.
 */
export function unbound(actionId: string): string {
  return rotate("unbound", [
    `I know how to "${actionId}", but that one isn't wired up yet.`,
    `"${actionId}" is on the map but not built out yet.`,
  ]);
}
