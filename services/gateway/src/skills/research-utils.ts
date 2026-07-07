/**
 * Pure helpers for the research pipeline — no config or I/O imports, so they
 * are directly unit-testable.
 */

export interface ResearchItem {
  title: string;
  url: string;
  score: number;
  author: string;
  source: string;
  /** Optional extracted text (e.g. a YouTube transcript) folded into synthesis. */
  excerpt?: string;
}

/** Strip a WEBVTT caption file to plain sequential text (no timestamps/tags/dupes). */
export function stripVtt(vtt: string): string {
  const out: string[] = [];
  let prev = "";
  for (let line of vtt.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (/^WEBVTT/i.test(line) || /^(Kind|Language|NOTE)\b/i.test(line)) continue;
    if (line.includes("-->")) continue; // timestamp cue
    if (/^\d+$/.test(line)) continue; // cue index
    line = line.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(); // inline tags
    if (!line || line === prev) continue; // dedupe consecutive (auto-sub repeats)
    out.push(line);
    prev = line;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Split a trailing "TAGS: a, b, c" line off an LLM response, returning the body
 * without it plus up to 6 kebab-case tags. Lets the model categorize its own
 * result (per-result tags) without a second call.
 */
export function splitTags(text: string): { body: string; tags: string[] } {
  const m = text.match(/^[ \t>*-]*tags?\s*:\s*(.+)$/im);
  if (!m) return { body: text.trim(), tags: [] };
  const tags = (m[1] ?? "")
    .split(/[,#]/)
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .slice(0, 6);
  return { body: text.replace(m[0], "").trim(), tags };
}

/** Dedupe by url (highest score wins), rank by score descending, optionally cap. */
export function dedupeRank(items: ResearchItem[], limit?: number): ResearchItem[] {
  const byUrl = new Map<string, ResearchItem>();
  for (const it of items) {
    const prev = byUrl.get(it.url);
    if (!prev || prev.score < it.score) byUrl.set(it.url, it);
  }
  const ranked = [...byUrl.values()].sort((a, b) => b.score - a.score);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}
