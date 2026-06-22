/**
 * Vault adapter — the read/write/freshness gateway to the Obsidian vault.
 *
 * By default (config.vault.managedBlocks = false) records are clean, human-first
 * files: frontmatter + body, no marker comments, regeneration overwrites. With
 * managed blocks on, the OS only replaces its own marked section so hand-edits
 * survive. `needsRefresh` powers the check-exists-or-execute loop.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  DOCUMENT_CONTRACTS,
  VaultFrontmatterSchema,
  type DocumentType,
  type VaultFrontmatter,
} from "@aos/shared";
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
  /** Full body. */
  body: string;
  /** OS-authored content (managed-block contents, or the whole body when clean). */
  generated: string;
}

export interface VaultSummary {
  type: string;
  key: string;
  title: string;
  updated: string;
  /** Path relative to the vault root, e.g. "10-research/bitcoin.md". */
  path: string;
}

export class VaultAdapter {
  constructor(
    private readonly root: string = config.vault.path,
    private readonly managed: boolean = config.vault.managedBlocks,
  ) {}

  pathFor(type: DocumentType, key: string): string {
    return recordPath(this.root, type, key);
  }

  exists(type: DocumentType, key: string): boolean {
    return existsSync(this.pathFor(type, key));
  }

  private toRecord(body: string, data: Record<string, unknown>): VaultRecord {
    return {
      frontmatter: VaultFrontmatterSchema.parse(data),
      body,
      generated: this.managed ? readManagedBlock(body) : body,
    };
  }

  read(type: DocumentType, key: string): VaultRecord | null {
    const path = this.pathFor(type, key);
    if (!existsSync(path)) return null;
    const { data, body } = parseDocument(readFileSync(path, "utf8"));
    return this.toRecord(body, data);
  }

  /** Read a record by its vault-relative path (used by the HUD doc viewer). */
  readByPath(relPath: string): { frontmatter: VaultFrontmatter; body: string } | null {
    const path = join(this.root, relPath);
    // Confine to the vault root — reject traversal.
    if (relative(this.root, path).startsWith("..")) return null;
    if (!existsSync(path)) return null;
    const { data, body } = parseDocument(readFileSync(path, "utf8"));
    return {
      frontmatter: VaultFrontmatterSchema.parse(data),
      body: this.managed ? readManagedBlock(body) : body,
    };
  }

  /** Most-recently-updated records across all record folders. */
  listRecent(limit = 30): VaultSummary[] {
    const out: VaultSummary[] = [];
    const folders = new Set(Object.values(DOCUMENT_CONTRACTS).map((c) => c.folder));
    for (const folder of folders) {
      const dir = join(this.root, folder);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        try {
          const { data } = parseDocument(readFileSync(join(dir, file), "utf8"));
          out.push({
            type: String(data.type ?? "?"),
            key: String(data.id ?? file.replace(/\.md$/, "")),
            title: String(data.title ?? file),
            updated: String(data.updated ?? data.created ?? ""),
            path: `${folder}/${file}`,
          });
        } catch {
          /* skip unreadable */
        }
      }
    }
    out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
    return out.slice(0, limit);
  }

  /**
   * Write an OS-authored result. With managed blocks on, preserves human content
   * and the original `created`; otherwise writes a clean file (full overwrite).
   */
  writeGenerated(frontmatter: VaultFrontmatter, generated: string): string {
    const path = this.pathFor(frontmatter.type, frontmatter.id);

    let created = frontmatter.created;
    let body = generated;
    if (this.managed) {
      let existingBody = "";
      if (existsSync(path)) {
        const current = parseDocument(readFileSync(path, "utf8"));
        existingBody = current.body;
        if (typeof current.data.created === "string") created = current.data.created;
      }
      body = replaceManagedBlock(existingBody, generated);
    } else if (existsSync(path)) {
      // Preserve original created date across clean overwrites.
      const current = parseDocument(readFileSync(path, "utf8"));
      if (typeof current.data.created === "string") created = current.data.created;
    }

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

  /** Append one bullet to today's daily-note Operations log (the V.A.U.L.T. feed). */
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
    return this.writeGenerated({ ...existing.frontmatter, updated: nowIso }, updatedGenerated);
  }
}

/** Pure freshness check, exported for direct testing. */
export function isStale(
  updatedIso: string,
  staleAfterMinutes: number | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (staleAfterMinutes === undefined) return false;
  const updatedMs = Date.parse(updatedIso);
  if (Number.isNaN(updatedMs)) return true;
  return updatedMs + staleAfterMinutes * 60_000 < nowMs;
}
