/**
 * Vault document contract — the canonical shape of every record the OS writes
 * to the Obsidian vault.
 *
 * Each file is the SOURCE OF TRUTH for what an AI task produced, and must read
 * well for a human or an LLM with no outside context. That means two things:
 *   1. Provenance frontmatter — what task produced it, when, with which model,
 *      from which inputs, how confident, and whether it's complete.
 *   2. A fixed, self-contained body — title, a standalone TL;DR, the required
 *      sections for its type, and cited sources.
 *
 * The OS only authors content inside the managed block; anything a human writes
 * outside it survives regeneration.
 */
import { z } from "zod";

/** The kinds of records the vault holds. */
export const DOCUMENT_TYPES = ["research", "knowledge", "ticket", "telemetry", "daily"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Did the producing task finish cleanly? */
export const VaultStatusSchema = z.enum(["complete", "partial", "failed"]);
export type VaultStatus = z.infer<typeof VaultStatusSchema>;

/** The producing task's self-assessed reliability. */
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Frontmatter present on every vault record. */
export const VaultFrontmatterSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().min(1),
  /** Stable key for the record (e.g. "rust-async" or a date for daily notes). */
  id: z.string().min(1),
  created: z.string(),
  updated: z.string(),
  /** The skill/action/agent that produced this record. */
  source: z.string().min(1),
  status: VaultStatusSchema.default("complete"),
  confidence: ConfidenceSchema.optional(),
  /** TTL in minutes; powers the check-exists-or-execute loop. Omit = never auto-stale. */
  staleAfterMinutes: z.number().int().positive().optional(),
  tags: z.array(z.string()).default([]),
  /** What the task was asked — the inputs that produced this result. */
  inputs: z.record(z.unknown()).default({}),
  /** Concrete model that produced the record, for auditability. */
  model: z.string().optional(),
  /** Obsidian wikilink targets, for the knowledge graph. */
  links: z.array(z.string()).default([]),
});
export type VaultFrontmatter = z.infer<typeof VaultFrontmatterSchema>;

/** Per-type structural rules enforced when building a record. */
export interface DocumentContract {
  /** Numbered folder the record lives in. */
  folder: string;
  /** Whether a standalone TL;DR is mandatory (true for result docs). */
  requireTldr: boolean;
  /** Section headings that must be present and non-empty. */
  requiredSections: string[];
}

export const DOCUMENT_CONTRACTS: Record<DocumentType, DocumentContract> = {
  research: { folder: "10-research", requireTldr: true, requiredSections: ["Key findings", "Sources"] },
  knowledge: { folder: "20-knowledge", requireTldr: true, requiredSections: ["Summary"] },
  ticket: { folder: "30-tickets", requireTldr: true, requiredSections: ["Summary", "Outcome"] },
  telemetry: { folder: "40-telemetry", requireTldr: false, requiredSections: ["Metrics"] },
  daily: { folder: "01-daily", requireTldr: false, requiredSections: ["Operations"] },
};

/** Markers delimiting OS-authored content. Everything outside is the human's. */
export const MANAGED_BEGIN = "<!-- aos:begin generated -->";
export const MANAGED_END = "<!-- aos:end generated -->";
