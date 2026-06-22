/**
 * Skill manifest schema — the declarative blueprint every skill ships.
 *
 * A skill is a unit of work the OS can execute (deep research, inbox triage,
 * the Shape A ship-ticket pipeline, ...). Its manifest declares what actions
 * trigger it and — crucially — its `modelPolicy`, which the ModelSelector uses
 * to choose the execution brain. Manifests are validated at load time, so a
 * malformed skill fails fast rather than at dispatch.
 */
import { z } from "zod";
import { ModelPolicySchema } from "./models.js";

/** How a skill is executed once dispatched. */
export const SkillExecutionSchema = z.discriminatedUnion("kind", [
  /** Headless Claude Code invocation: `claude -p "<prompt>" ...`. */
  z.object({
    kind: z.literal("claude-headless"),
    /** Prompt template; `{{param}}` placeholders are filled from RoutedIntent params. */
    promptTemplate: z.string().min(1),
    /** Extra CLI args appended to the `claude -p` invocation. */
    args: z.array(z.string()).default([]),
  }),
  /** Arbitrary local process (scrapers, pipelines). */
  z.object({
    kind: z.literal("process"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
  /** In-gateway TypeScript handler resolved by id. */
  z.object({
    kind: z.literal("native"),
    handler: z.string().min(1),
  }),
]);
export type SkillExecution = z.infer<typeof SkillExecutionSchema>;

export const SkillManifestSchema = z.object({
  /** Stable id; conventionally matches the directory name under skills/. */
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Action ids (from the action registry) that dispatch to this skill. */
  triggers: z.array(z.string().min(1)).min(1),
  /** Declarative model policy consumed by the ModelSelector. */
  modelPolicy: ModelPolicySchema,
  execution: SkillExecutionSchema,
  /** Where this skill writes its output in the Obsidian vault, relative to vault root. */
  vaultOutput: z.string().optional(),
  /** Freshness window in minutes; the OS re-runs the skill if the vault record is older. */
  staleAfterMinutes: z.number().int().positive().optional(),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** Parse + validate an unknown value into a SkillManifest (throws on invalid). */
export function parseSkillManifest(input: unknown): SkillManifest {
  return SkillManifestSchema.parse(input);
}
