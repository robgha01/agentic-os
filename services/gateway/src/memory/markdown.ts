/**
 * Markdown + frontmatter primitives for the vault: parse/serialize YAML
 * frontmatter (via gray-matter), maintain the OS-owned managed block, and
 * append bullets under a heading (for the daily operations log).
 */
import matter from "gray-matter";
import { MANAGED_BEGIN, MANAGED_END } from "@aos/shared";

export interface ParsedDocument {
  /** Raw frontmatter object. */
  data: Record<string, unknown>;
  /** Body markdown (everything after frontmatter). */
  body: string;
}

export function parseDocument(content: string): ParsedDocument {
  const parsed = matter(content);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content };
}

export function serializeDocument(body: string, data: Record<string, unknown>): string {
  // Drop noise so the Properties block stays human-friendly: undefined values
  // (js-yaml can't dump them) and empty arrays/objects.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    clean[k] = v;
  }
  // Trailing newline keeps the file POSIX-clean.
  const out = matter.stringify(body.endsWith("\n") ? body : `${body}\n`, clean);
  return out.endsWith("\n") ? out : `${out}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the OS-owned managed block in `body` with `generated`, preserving any
 * human-authored content outside it. If no block exists yet, append one.
 */
export function replaceManagedBlock(body: string, generated: string): string {
  const block = `${MANAGED_BEGIN}\n${generated.trim()}\n${MANAGED_END}`;
  const re = new RegExp(`${escapeRegExp(MANAGED_BEGIN)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}`);
  if (re.test(body)) return body.replace(re, block);
  const human = body.trim();
  return human ? `${human}\n\n${block}\n` : `${block}\n`;
}

/** Extract the current managed-block contents, or "" if there is none. */
export function readManagedBlock(body: string): string {
  const re = new RegExp(`${escapeRegExp(MANAGED_BEGIN)}\\n([\\s\\S]*?)\\n${escapeRegExp(MANAGED_END)}`);
  const m = body.match(re);
  return m ? (m[1] ?? "").trim() : "";
}

/**
 * Append a bullet under `## <heading>` within a markdown string. The heading is
 * created at the end if absent. Used for the accumulating daily ops log.
 */
export function appendBulletUnderHeading(md: string, heading: string, bullet: string): string {
  const lines = md.split("\n");
  const headingLine = `## ${heading}`;
  const headingIdx = lines.findIndex((l) => l.trim() === headingLine);

  if (headingIdx === -1) {
    const base = md.trimEnd();
    return `${base}${base ? "\n\n" : ""}${headingLine}\n- ${bullet}\n`;
  }

  // Find the end of this section (next "## " heading or end of doc).
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").startsWith("## ")) {
      end = i;
      break;
    }
  }
  // Insert just before any trailing blank lines in the section.
  let insertAt = end;
  while (insertAt > headingIdx + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
  lines.splice(insertAt, 0, `- ${bullet}`);
  return lines.join("\n");
}
