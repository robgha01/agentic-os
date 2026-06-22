/**
 * Skill manifest schema — the declarative blueprint every skill ships.
 *
 * A skill is a unit of work the OS can execute (deep research, inbox triage,
 * the Shape A ship-ticket pipeline, ...). Its manifest declares:
 *  - what actions trigger it (`triggers`),
 *  - its `modelPolicy` (consumed by the ModelSelector to choose a brain),
 *  - and WHERE users can invoke it (`surfaces`) — which is how we distinguish a
 *    user-invokable skill (command-deck button and/or natural language) from an
 *    internal "sub-skill" that only other skills call (`surfaces: []`).
 *
 * Manifests are validated at load time, so a malformed skill fails fast.
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
  /** Ordered pipeline of sub-skill ids, sharing an in-memory context. */
  z.object({
    kind: z.literal("composite"),
    steps: z.array(z.string().min(1)).min(1),
  }),
]);
export type SkillExecution = z.infer<typeof SkillExecutionSchema>;

/** Where a user can invoke a skill. `deck` = command-deck button; `nl` = voice/typed. */
export const SkillSurfaceSchema = z.enum(["deck", "nl"]);
export type SkillSurface = z.infer<typeof SkillSurfaceSchema>;

/** One input a command-deck button collects before invoking the skill. */
export const SkillInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  label: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

/** How a skill renders in the command-deck widget. Required when "deck" is a surface. */
export const SkillPresentationSchema = z.object({
  label: z.string().min(1),
  /** Icon name the HUD maps to a glyph. */
  icon: z.string().optional(),
  /** Group/section the card sorts under in the deck. */
  group: z.string().optional(),
  /** Inputs the button collects (drives the param form). */
  inputs: z.array(SkillInputSchema).default([]),
});
export type SkillPresentation = z.infer<typeof SkillPresentationSchema>;

export const SkillManifestSchema = z
  .object({
    /** Stable id; conventionally matches the directory name under skills/. */
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    /** Action ids (from the action registry) that dispatch to this skill. */
    triggers: z.array(z.string().min(1)).min(1),
    /**
     * Where users can invoke this skill:
     *  - includes "deck" -> renders as a command-deck button (needs `presentation`)
     *  - includes "nl"   -> reachable by voice/typed routing
     *  - []              -> internal sub-skill; only other skills invoke it
     */
    surfaces: z.array(SkillSurfaceSchema).default(["nl"]),
    presentation: SkillPresentationSchema.optional(),
    /** Declarative model policy consumed by the ModelSelector. */
    modelPolicy: ModelPolicySchema,
    execution: SkillExecutionSchema,
    /** Where this skill writes its output in the Obsidian vault, relative to vault root. */
    vaultOutput: z.string().optional(),
    /** Freshness window in minutes; the OS re-runs the skill if the vault record is older. */
    staleAfterMinutes: z.number().int().positive().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.surfaces.includes("deck") && !m.presentation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'skills with the "deck" surface must declare a `presentation`',
        path: ["presentation"],
      });
    }
  });
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** Parse + validate an unknown value into a SkillManifest (throws on invalid). */
export function parseSkillManifest(input: unknown): SkillManifest {
  return SkillManifestSchema.parse(input);
}

/** The public, HUD-facing descriptor for one command-deck card. */
export interface SkillCard {
  skillId: string;
  label: string;
  icon?: string;
  group?: string;
  inputs: SkillInput[];
}
