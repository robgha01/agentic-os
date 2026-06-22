/**
 * Document builder — turns a task result into a contract-compliant record.
 *
 * This is where "properly written, source-of-truth" is enforced: the builder
 * validates the type's contract (TL;DR required? all required sections present
 * and non-empty?) and assembles a self-contained body — title, standalone
 * TL;DR, sections in a stable order, cited sources, and a human-readable
 * provenance footer that mirrors the frontmatter.
 *
 * Throws on contract violations so a malformed result never reaches the vault.
 */
import {
  DOCUMENT_CONTRACTS,
  VaultFrontmatterSchema,
  type Confidence,
  type DocumentType,
  type VaultFrontmatter,
  type VaultStatus,
} from "@aos/shared";

export interface SourceRef {
  label: string;
  url: string;
}

export interface ResultDocumentInput {
  type: DocumentType;
  /** Stable key (slugged for the filename; date string for daily notes). */
  key: string;
  title: string;
  /** The skill/action/agent that produced this. */
  source: string;
  /** Standalone one-paragraph summary. Required for result-doc types. */
  tldr?: string;
  /** Heading -> markdown body. Insertion order is preserved in the document. */
  sections: Record<string, string>;
  sources?: SourceRef[];
  status?: VaultStatus;
  confidence?: Confidence;
  staleAfterMinutes?: number;
  tags?: string[];
  inputs?: Record<string, unknown>;
  model?: string;
  links?: string[];
  /** ISO timestamp; injected by the caller so builds are deterministic/testable. */
  now: string;
}

export interface BuiltDocument {
  frontmatter: VaultFrontmatter;
  /** The OS-authored body that goes inside the managed block. */
  generated: string;
}

export function buildResultDocument(input: ResultDocumentInput): BuiltDocument {
  const contract = DOCUMENT_CONTRACTS[input.type];

  // --- Contract validation -------------------------------------------------
  if (contract.requireTldr && !nonEmpty(input.tldr)) {
    throw new Error(`document "${input.key}" (${input.type}) requires a TL;DR`);
  }
  for (const required of contract.requiredSections) {
    // A "Sources" requirement is also satisfied by the cited-sources list.
    const satisfiedBySources =
      required === "Sources" && (input.sources?.length ?? 0) > 0;
    if (!nonEmpty(input.sections[required]) && !satisfiedBySources) {
      throw new Error(
        `document "${input.key}" (${input.type}) is missing required section "${required}"`,
      );
    }
  }

  // --- Body assembly (required sections first, then any extras) ------------
  const parts: string[] = [`# ${input.title}`];
  if (nonEmpty(input.tldr)) parts.push(`> **TL;DR** — ${input.tldr!.trim()}`);

  const ordered = [
    ...contract.requiredSections,
    ...Object.keys(input.sections).filter((k) => !contract.requiredSections.includes(k)),
  ];
  for (const heading of ordered) {
    const content = input.sections[heading];
    if (!nonEmpty(content)) continue;
    parts.push(`## ${heading}\n\n${content!.trim()}`);
  }

  if (input.sources && input.sources.length > 0) {
    const list = input.sources.map((s) => `- [${s.label}](${s.url})`).join("\n");
    parts.push(`## Sources\n\n${list}`);
  }

  const status: VaultStatus = input.status ?? "complete";
  const footerBits = [
    `Produced by \`${input.source}\``,
    input.model ? `model ${input.model}` : null,
    input.now,
    `status: ${status}`,
    input.confidence ? `confidence: ${input.confidence}` : null,
  ].filter(Boolean);
  parts.push(`---\n_${footerBits.join(" · ")}._`);

  // --- Frontmatter ---------------------------------------------------------
  const frontmatter = VaultFrontmatterSchema.parse({
    type: input.type,
    title: input.title,
    id: input.key,
    created: input.now,
    updated: input.now,
    source: input.source,
    status,
    confidence: input.confidence,
    staleAfterMinutes: input.staleAfterMinutes,
    tags: input.tags ?? [],
    inputs: input.inputs ?? {},
    model: input.model,
    links: input.links ?? [],
  });

  return { frontmatter, generated: parts.join("\n\n") };
}

function nonEmpty(s: string | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}
