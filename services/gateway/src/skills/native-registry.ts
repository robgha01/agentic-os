/**
 * Registry of in-gateway TypeScript skill handlers (execution kind "native").
 *
 * Native handlers receive a shared `context` bag (so composite pipeline steps
 * pass data between each other) and injected `services` (the vault adapter +
 * clock). A skill whose manifest names a handler not registered here fails fast.
 *
 * Phase 3a ships a real, keyless research pipeline:
 *   fetchHackerNews (public Algolia API) -> compileResearch (vault doc).
 */
import type { RoutedIntent } from "@aos/shared";
import type { VaultAdapter } from "../memory/vault-adapter.js";
import { buildResultDocument, type SourceRef } from "../memory/document-builder.js";

/** Services the gateway injects into every native handler. */
export interface SkillServices {
  vault: VaultAdapter;
  /** Injected clock — keeps builds deterministic/testable. */
  nowIso: () => string;
}

export interface NativeHandlerContext {
  intent: RoutedIntent;
  /** Convenience alias for intent.parameters. */
  params: Record<string, unknown>;
  /** Mutable bag shared across the steps of a composite skill. */
  context: Record<string, unknown>;
  services: SkillServices;
  /** Stream a chunk of output to the operation's event feed. */
  emit: (chunk: string) => void;
}

/** Returns an exit-code-like number (0 = success). */
export type NativeHandler = (ctx: NativeHandlerContext) => Promise<number>;

// --- Hacker News research pipeline ------------------------------------------

interface HnItem {
  title: string;
  url: string;
  points: number;
  author: string;
}

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  author: string | null;
}

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

/** Fetch recent Hacker News stories for a topic (public Algolia API, no key). */
const fetchHackerNews: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) {
    ctx.emit("fetch-hackernews: no topic provided\n");
    return 1;
  }

  const cutoff = Math.floor(Date.parse(ctx.services.nowIso()) / 1000) - THIRTY_DAYS_SEC;
  const apiUrl =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story` +
    `&query=${encodeURIComponent(topic)}` +
    `&numericFilters=created_at_i>${cutoff}&hitsPerPage=20`;
  const humanUrl = `https://hn.algolia.com/?query=${encodeURIComponent(topic)}&dateRange=pastMonth&type=story`;
  ctx.context.hnSearchUrl = humanUrl;

  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { hits?: AlgoliaHit[] };
    const items: HnItem[] = (data.hits ?? []).map((h) => ({
      title: h.title ?? "(untitled)",
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? 0,
      author: h.author ?? "unknown",
    }));
    items.sort((a, b) => b.points - a.points);
    ctx.context.hnItems = items;
    ctx.emit(`fetch-hackernews: ${items.length} stories for "${topic}"\n`);
    return 0;
  } catch (err) {
    // Network failure is non-fatal: the pipeline still produces a record that
    // cites the search URL, marked partial.
    ctx.context.hnItems = [];
    ctx.emit(`fetch-hackernews: fetch failed (${(err as Error).message}); continuing empty\n`);
    return 0;
  }
};

/** Compile fetched items into a contract-compliant research record in the vault. */
const compileResearch: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) {
    ctx.emit("compile-research: no topic provided\n");
    return 1;
  }

  const items = (ctx.context.hnItems as HnItem[] | undefined) ?? [];
  const searchUrl = (ctx.context.hnSearchUrl as string | undefined) ?? "https://hn.algolia.com/";
  const top = items.slice(0, 10);

  const tldr =
    items.length > 0
      ? `${items.length} Hacker News ${items.length === 1 ? "story" : "stories"} from the last 30 days mention "${topic}". Top: ${top[0]!.title}.`
      : `No Hacker News stories from the last 30 days matched "${topic}".`;

  const keyFindings =
    top.length > 0
      ? top.map((i) => `- [${i.title}](${i.url}) — ${i.points} points (${i.author})`).join("\n")
      : `- No recent Hacker News stories matched "${topic}".`;

  const sources: SourceRef[] = [
    ...top.map((i) => ({ label: i.title, url: i.url })),
    { label: `Hacker News search: ${topic}`, url: searchUrl },
  ];

  const built = buildResultDocument({
    type: "research",
    key: topic,
    title: `${topic} — last 30 days`,
    source: "last-30-days",
    tldr,
    sections: { "Key findings": keyFindings },
    sources,
    status: items.length > 0 ? "complete" : "partial",
    confidence: items.length >= 3 ? "medium" : "low",
    staleAfterMinutes: 1440,
    tags: [`topic/${topic.toLowerCase().replace(/\s+/g, "-")}`],
    inputs: { topic },
    now: ctx.services.nowIso(),
  });

  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.researchPath = path;
  ctx.emit(`compile-research: wrote ${path}\n`);
  return 0;
};

export const NATIVE_HANDLERS: Record<string, NativeHandler> = {
  fetchHackerNews,
  compileResearch,
  // inboxTriage: deferred — needs email credentials (Phase 3b)
};
