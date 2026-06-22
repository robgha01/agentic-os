/**
 * Vault adapter — the read/write/freshness gateway to the Obsidian vault.
 *
 * Writes are managed-block-aware: the OS replaces only its own section, so a
 * human's notes in the same file survive. `created` is preserved across
 * rewrites; `updated` is bumped. `needsRefresh` powers the check-exists-or-
 * execute loop (the spec's self-refresh-when-stale behavior).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { VaultFrontmatterSchema, type DocumentType, type VaultFrontmatter } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import {
  appendBulletUnderHeading,
  parseDocument,
  readManagedBlock,
  replaceManagedBlock,
  serializeDocument,
} from "./markdown.js";
import { recordPath } from "./vault-paths.js";
import { buildResultDocument } from "./document-builder.js";

export interface FreshnessVerdict {
  exists: boolean;
  stale: boolean;
  path: string;
}

export interface VaultRecord {
  frontmatter: VaultFrontmatter;
  /** Full body (human content + managed block). */
  body: string;
  /** Just the OS-authored content from inside the managed block. */
  generated: string;
}

export class VaultAdapter {
  constructor(private readonly root: string = config.vault.path) {}

  pathFor(type: DocumentType, key: string): string {
    return recordPath(this.root, type, key);
  }

  exists(type: DocumentType, key: string): boolean {
    return existsSync(this.pathFor(type, key));
  }

  read(type: DocumentType, key: string): VaultRecord | null {
    const path = this.pathFor(type, key);
    if (!existsSync(path)) return null;
    const { data, body } = parseDocument(readFileSync(path, "utf8"));
    return {
      frontmatter: VaultFrontmatterSchema.parse(data),
      body,
      generated: readManagedBlock(body),
    };
  }

  /**
   * Write an OS-authored result. Replaces the managed block while preserving
   * any human content already in the file; keeps the original `created`.
   */
  writeGenerated(frontmatter: VaultFrontmatter, generated: string): string {
    const path = this.pathFor(frontmatter.type, frontmatter.id);

    let existingBody = "";
    let created = frontmatter.created;
    if (existsSync(path)) {
      const current = parseDocument(readFileSync(path, "utf8"));
      existingBody = current.body;
      if (typeof current.data.created === "string") created = current.data.created;
    }

    const body = replaceManagedBlock(existingBody, generated);
    const finalFm: VaultFrontmatter = { ...frontmatter, created };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeDocument(body, finalFm), "utf8");
    return path;
  }

  /** Does (type, key) need (re)generation? Missing or past its TTL => stale. */
  needsRefresh(type: DocumentType, key: string, nowMs: number = Date.now()): FreshnessVerdict {
    const path = this.pathFor(type, key);
    const record = this.read(type, key);
    if (!record) return { exists: false, stale: true, path };
    return {
      exists: true,
      stale: isStale(record.frontmatter.updated, record.frontmatter.staleAfterMinutes, nowMs),
      path,
    };
  }

  /**
   * Append one bullet to today's daily-note Operations log, creating the daily
   * note (with a valid contract) on first write. This is the data behind the
   * HUD's V.A.U.L.T. view.
   */
  appendDailyOperation(dateKey: string, line: string, nowIso: string): string {
    const existing = this.read("daily", dateKey);
    if (!existing) {
      const built = buildResultDocument({
        type: "daily",
        key: dateKey,
        title: `Daily — ${dateKey}`,
        source: "agentic-os",
        sections: { Operations: `- ${line}` },
        now: nowIso,
      });
      return this.writeGenerated(built.frontmatter, built.generated);
    }
    const updatedGenerated = appendBulletUnderHeading(existing.generated, "Operations", line);
    return this.writeGenerated(
      { ...existing.frontmatter, updated: nowIso },
      updatedGenerated,
    );
  }
}

/** Pure freshness check, exported for direct testing. */
export function isStale(
  updatedIso: string,
  staleAfterMinutes: number | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (staleAfterMinutes === undefined) return false; // never auto-stale
  const updatedMs = Date.parse(updatedIso);
  if (Number.isNaN(updatedMs)) return true; // unparseable => treat as stale
  return updatedMs + staleAfterMinutes * 60_000 < nowMs;
}
