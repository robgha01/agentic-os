/**
 * Registry of in-gateway TypeScript skill handlers (execution kind "native").
 *
 * Native handlers receive a shared `context` bag (so composite pipeline steps
 * pass data between each other) and injected `services` (the vault adapter +
 * clock + optional mail). A skill whose manifest names a handler not registered
 * here fails fast.
 *
 * Research pipeline (keyless): fetchHackerNews + fetchReddit append to a shared
 * item list, then compileResearch writes one cited research record.
 */
import type { RoutedIntent } from "@aos/shared";
import type { VaultAdapter } from "../memory/vault-adapter.js";
import type { MailProvider } from "../mail/mail-provider.js";
import { buildResultDocument, type SourceRef } from "../memory/document-builder.js";

/** Services the gateway injects into every native handler. */
export interface SkillServices {
  vault: VaultAdapter;
  /** Injected clock — keeps builds deterministic/testable. */
  nowIso: () => string;
  /** Configured mail backend; undefined when mail is disabled. */
  mail?: MailProvider;
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

// --- Shared research item model --------------------------------------------

interface ResearchItem {
  title: string;
  url: string;
  score: number;
  author: string;
  source: string;
}

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

/** Push items + a search-link source onto the shared context. */
function collect(ctx: NativeHandlerContext, items: ResearchItem[], source: SourceRef): void {
  const existing = (ctx.context.researchItems as ResearchItem[] | undefined) ?? [];
  ctx.context.researchItems = [...existing, ...items];
  const sources = (ctx.context.searchSources as SourceRef[] | undefined) ?? [];
  ctx.context.searchSources = [...sources, source];
}

// --- Hacker News (public Algolia API, no key) ------------------------------

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  author: string | null;
}

const fetchHackerNews: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 1;

  const cutoff = Math.floor(Date.parse(ctx.services.nowIso()) / 1000) - THIRTY_DAYS_SEC;
  const apiUrl =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story` +
    `&query=${encodeURIComponent(topic)}&numericFilters=created_at_i>${cutoff}&hitsPerPage=20`;
  const humanUrl = `https://hn.algolia.com/?query=${encodeURIComponent(topic)}&dateRange=pastMonth&type=story`;

  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { hits?: AlgoliaHit[] };
    const items: ResearchItem[] = (data.hits ?? []).map((h) => ({
      title: h.title ?? "(untitled)",
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      score: h.points ?? 0,
      author: h.author ?? "unknown",
      source: "Hacker News",
    }));
    collect(ctx, items, { label: `Hacker News search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-hackernews: ${items.length} stories\n`);
  } catch (err) {
    collect(ctx, [], { label: `Hacker News search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-hackernews: failed (${(err as Error).message})\n`);
  }
  return 0;
};

// --- Reddit (public .json, no key) -----------------------------------------

interface RedditChild {
  data?: { title?: string; permalink?: string; url?: string; ups?: number; author?: string };
}

const fetchReddit: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 1;

  const apiUrl =
    `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}` +
    `&sort=top&t=month&limit=15&type=link`;
  const humanUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(topic)}&sort=top&t=month`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "user-agent": "agentic-os/0.1 (research skill)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { children?: RedditChild[] } };
    const items: ResearchItem[] = (data.data?.children ?? [])
      .map((c) => c.data)
      .filter((d): d is NonNullable<RedditChild["data"]> => Boolean(d?.title))
      .map((d) => ({
        title: d.title ?? "(untitled)",
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url ?? humanUrl,
        score: d.ups ?? 0,
        author: d.author ?? "unknown",
        source: "Reddit",
      }));
    collect(ctx, items, { label: `Reddit search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-reddit: ${items.length} posts\n`);
  } catch (err) {
    collect(ctx, [], { label: `Reddit search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-reddit: failed (${(err as Error).message})\n`);
  }
  return 0;
};

// --- Compile -> vault record ------------------------------------------------

const compileResearch: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 1;

  const all = (ctx.context.researchItems as ResearchItem[] | undefined) ?? [];
  const searchSources = (ctx.context.searchSources as SourceRef[] | undefined) ?? [];

  // Dedupe by url, strongest first.
  const byUrl = new Map<string, ResearchItem>();
  for (const it of all) if (!byUrl.has(it.url) || (byUrl.get(it.url)!.score < it.score)) byUrl.set(it.url, it);
  const items = [...byUrl.values()].sort((a, b) => b.score - a.score);
  const top = items.slice(0, 12);

  const sourcesUsed = [...new Set(items.map((i) => i.source))];
  const tldr =
    items.length > 0
      ? `${items.length} items from the last 30 days about "${topic}" across ${sourcesUsed.join(" + ") || "no sources"}. Top: ${top[0]!.title}.`
      : `No recent activity found about "${topic}".`;

  const keyFindings =
    top.length > 0
      ? top.map((i) => `- [${i.title}](${i.url}) — ${i.score} · ${i.source}`).join("\n")
      : `- Nothing matched "${topic}" in the last 30 days.`;

  const sources: SourceRef[] = [
    ...top.map((i) => ({ label: `${i.title} (${i.source})`, url: i.url })),
    ...searchSources,
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
    confidence: items.length >= 5 && sourcesUsed.length > 1 ? "high" : items.length >= 3 ? "medium" : "low",
    staleAfterMinutes: 1440,
    tags: [`topic/${topic.toLowerCase().replace(/\s+/g, "-")}`],
    inputs: { topic },
    now: ctx.services.nowIso(),
  });

  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.researchPath = path;
  ctx.emit(`compile-research: ${items.length} items -> ${path}\n`);
  return 0;
};

// --- Inbox triage (Outlook / Microsoft 365 via Graph) -----------------------

/** Heuristic: does this message likely want a reply? */
function likelyNeedsReply(subject: string, snippet: string, flagged: boolean): boolean {
  if (flagged) return true;
  const hay = `${subject} ${snippet}`.toLowerCase();
  return /\?|please|can you|could you|action required|reply|review|approve|sign|deadline|by (mon|tue|wed|thu|fri|today|tomorrow)/.test(hay);
}

const inboxTriage: NativeHandler = async (ctx) => {
  const mail = ctx.services.mail;
  if (!mail) {
    ctx.emit("inbox-triage: no mail provider configured (set AGENTIC_OS_MAIL_PROVIDER)\n");
    return 1;
  }

  let messages;
  try {
    messages = await mail.listUnread(50);
  } catch (err) {
    ctx.emit(`inbox-triage: fetch failed (${(err as Error).message})\n`);
    return 1;
  }

  const actionable = messages.filter((m) => likelyNeedsReply(m.subject, m.snippet, m.flagged));
  const link = (m: { subject: string; webLink?: string }) =>
    m.webLink ? `[${m.subject}](${m.webLink})` : m.subject;
  const actionItems =
    actionable.length > 0
      ? actionable.map((m) => `- **${m.from}** — ${link(m)}`).join("\n")
      : "- Nothing flagged as needing a reply.";

  const bySender = new Map<string, number>();
  for (const m of messages) bySender.set(m.from, (bySender.get(m.from) ?? 0) + 1);
  const senderLines =
    [...bySender.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `- ${s}: ${n}`).join("\n") ||
    "- (no unread mail)";

  const dateKey = (ctx.services.nowIso().split("T")[0] ?? ctx.services.nowIso()).slice(0, 10);
  const built = buildResultDocument({
    type: "inbox",
    key: dateKey,
    title: `Inbox triage — ${dateKey}`,
    source: "inbox-triage",
    tldr: `${messages.length} unread; ${actionable.length} likely need a reply.`,
    sections: { "Action items": actionItems, "By sender": senderLines },
    status: "complete",
    confidence: "medium",
    staleAfterMinutes: 60,
    tags: ["inbox", `mail/${mail.id}`],
    inputs: { provider: mail.id },
    now: ctx.services.nowIso(),
  });

  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.emit(`inbox-triage: ${messages.length} unread, ${actionable.length} actionable -> ${path}\n`);
  return 0;
};

export const NATIVE_HANDLERS: Record<string, NativeHandler> = {
  fetchHackerNews,
  fetchReddit,
  compileResearch,
  inboxTriage,
};
