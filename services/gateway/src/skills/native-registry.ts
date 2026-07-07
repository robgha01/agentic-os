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
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoutedIntent } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import type { VaultAdapter } from "../memory/vault-adapter.js";
import type { MailProvider } from "../mail/mail-provider.js";
import type { LlmService } from "../llm/llm-service.js";
import { buildResultDocument, type SourceRef } from "../memory/document-builder.js";
import { dedupeRank, splitTags, stripVtt, type ResearchItem } from "./research-utils.js";

/** A research source the user has switched off (skipped by its fetcher). */
function sourceDisabled(id: string): boolean {
  return config.research.disabled.includes(id);
}

/**
 * Spawn a binary and capture stdout (for yt-dlp). Rejects on error/timeout/non-zero.
 *
 * We drive the platform shell explicitly (cmd /c on Windows) with our OWN arg
 * quoting rather than Node's flaky shell:true quoting — this resolves PATH
 * entries incl. pyenv-style shims AND keeps multi-word args (e.g. an ytsearch
 * query) intact. IMPORTANT: callers must keep `%` out of args — cmd.exe mangles
 * yt-dlp's `%(...)s` templates — so we use --dump-json + a literal -o base.
 */
function runCapture(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let settled = false;
    // Windows: run via cmd /c with the command + args as SEPARATE argv elements,
    // so Node does its (correct) per-arg quoting and cmd resolves PATH shims
    // (pyenv). POSIX: spawn the binary directly. Either way args pass intact.
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/d", "/s", "/c", bin, ...args], { shell: false })
        : spawn(bin, args, { shell: false });
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`spawn failed: ${e.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

/** Services the gateway injects into every native handler. */
export interface SkillServices {
  vault: VaultAdapter;
  /** Injected clock — keeps builds deterministic/testable. */
  nowIso: () => string;
  /** Configured mail backend; undefined when mail is disabled. */
  mail?: MailProvider;
  /** LLM completion (synthesis); undefined when no transport is usable. */
  llm?: LlmService;
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

// --- Shared research item model (see research-utils.ts for the pure helpers) --

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

// --- Polymarket (keyless gamma API) — prediction-market signal -------------

const fetchPolymarket: NativeHandler = async (ctx) => {
  if (sourceDisabled("polymarket")) return 0;
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 0;
  const terms = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const humanUrl = `https://polymarket.com/markets?_q=${encodeURIComponent(topic)}`;
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=120&order=volume&ascending=false",
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    const markets = (Array.isArray(raw) ? raw : []) as Array<{ question?: string; slug?: string; volume?: number | string }>;
    const items: ResearchItem[] = markets
      .filter((m) => m.question && (terms.length === 0 || terms.some((t) => m.question!.toLowerCase().includes(t))))
      .slice(0, 10)
      .map((m) => ({
        title: m.question!,
        url: m.slug ? `https://polymarket.com/event/${m.slug}` : humanUrl,
        score: Math.round(Number(m.volume ?? 0)),
        author: "Polymarket",
        source: "Polymarket",
      }));
    collect(ctx, items, { label: `Polymarket: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-polymarket: ${items.length} markets\n`);
  } catch (err) {
    collect(ctx, [], { label: `Polymarket: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-polymarket: failed (${(err as Error).message})\n`);
  }
  return 0;
};

// --- Web (keyless DuckDuckGo HTML search; fallback breadth) -----------------

const fetchWeb: NativeHandler = async (ctx) => {
  if (sourceDisabled("web")) return 0;
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 0;
  const humanUrl = `https://duckduckgo.com/?q=${encodeURIComponent(topic)}`;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(topic)}`, {
      headers: { "user-agent": "Mozilla/5.0 (agentic-os research)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items: ResearchItem[] = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    let rank = 0;
    while ((m = re.exec(html)) && items.length < 10) {
      rank++;
      let href = m[1]!;
      const um = href.match(/[?&]uddg=([^&]+)/);
      if (um) href = decodeURIComponent(um[1]!);
      const title = m[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (title && /^https?:/.test(href)) {
        items.push({ title, url: href, score: Math.max(1, 11 - rank), author: "Web", source: "Web" });
      }
    }
    collect(ctx, items, { label: `Web search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-web: ${items.length} results\n`);
  } catch (err) {
    collect(ctx, [], { label: `Web search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-web: failed (${(err as Error).message})\n`);
  }
  return 0;
};

// --- YouTube (yt-dlp search; binary dependency, no key) ---------------------

const fetchYouTube: NativeHandler = async (ctx) => {
  if (sourceDisabled("youtube")) return 0;
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 0;
  const humanUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}`;
  try {
    // --dump-json (not --print "%(...)") so no `%` reaches cmd.exe under shell:true.
    const out = await runCapture(
      "yt-dlp",
      [`ytsearch8:${topic}`, "--flat-playlist", "--dump-json", "--skip-download", "--no-warnings"],
      25000,
    );
    const items: ResearchItem[] = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { id?: string; title?: string; view_count?: number };
        } catch {
          return null;
        }
      })
      .filter((r): r is { id?: string; title?: string; view_count?: number } => Boolean(r?.id))
      .slice(0, 10)
      .map((r) => ({
        title: String(r.title ?? "(untitled)"),
        url: `https://www.youtube.com/watch?v=${r.id}`,
        score: Math.round(Number(r.view_count ?? 0)) || 1,
        author: "YouTube",
        source: "YouTube",
      }));

    // Transcript extraction: pull EN captions for the top few by views, strip to
    // text, attach as excerpts (folded into synthesis). One call per video with a
    // LITERAL -o base (no `%(...)s` template, which cmd.exe would mangle).
    const top = items.slice().sort((a, b) => b.score - a.score).slice(0, 4);
    if (top.length > 0) {
      const dir = mkdtempSync(join(tmpdir(), "aos-yt-"));
      try {
        for (const it of top) {
          const id = it.url.split("v=")[1];
          if (!id) continue;
          try {
            await runCapture(
              "yt-dlp",
              [
                "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "en.*,en",
                "--sub-format", "vtt", "--no-warnings", "-o", join(dir, id),
                `https://www.youtube.com/watch?v=${id}`,
              ],
              30000,
            );
          } catch {
            /* this video's captions unavailable — skip it */
          }
        }
        let got = 0;
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".vtt")) continue;
          const id = f.split(".")[0]!;
          const text = stripVtt(readFileSync(join(dir, f), "utf8")).slice(0, 1500);
          const item = items.find((it) => it.url.includes(id));
          if (item && text && !item.excerpt) {
            item.excerpt = text;
            got++;
          }
        }
        ctx.emit(`fetch-youtube: ${got} transcript(s) extracted\n`);
      } catch (e) {
        ctx.emit(`fetch-youtube: transcripts skipped (${(e as Error).message})\n`);
      } finally {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* temp cleanup best-effort */
        }
      }
    }

    collect(ctx, items, { label: `YouTube: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-youtube: ${items.length} videos\n`);
  } catch (err) {
    collect(ctx, [], { label: `YouTube: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-youtube: skipped (${(err as Error).message}); is yt-dlp installed?\n`);
  }
  return 0;
};

// --- X / Twitter (recent search; needs a bearer token) ----------------------

const fetchX: NativeHandler = async (ctx) => {
  if (sourceDisabled("x")) return 0;
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 0;
  const token = config.x.bearerToken;
  if (!token) {
    ctx.emit("fetch-x: no X bearer token configured (set x.bearerToken); skipping\n");
    return 0;
  }
  const humanUrl = `https://twitter.com/search?q=${encodeURIComponent(topic)}&f=live`;
  try {
    const q = encodeURIComponent(`${topic} -is:retweet lang:en`);
    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=20&tweet.fields=public_metrics`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{ id: string; text: string; public_metrics?: { like_count?: number; retweet_count?: number } }>;
    };
    const items: ResearchItem[] = (data.data ?? []).map((t) => ({
      title: t.text.replace(/\s+/g, " ").slice(0, 140),
      url: `https://twitter.com/i/web/status/${t.id}`,
      score: (t.public_metrics?.like_count ?? 0) + (t.public_metrics?.retweet_count ?? 0),
      author: "X",
      source: "X",
    }));
    collect(ctx, items, { label: `X search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-x: ${items.length} posts\n`);
  } catch (err) {
    collect(ctx, [], { label: `X search: ${topic}`, url: humanUrl });
    ctx.emit(`fetch-x: failed (${(err as Error).message})\n`);
  }
  return 0;
};

// --- Synthesis (grounded, LLM) ---------------------------------------------

const synthesizeResearch: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  const items = (ctx.context.researchItems as ResearchItem[] | undefined) ?? [];

  if (!ctx.services.llm) {
    ctx.emit("synthesize-research: no LLM transport configured; skipping synthesis\n");
    return 0;
  }
  if (items.length === 0) {
    ctx.emit("synthesize-research: no items to synthesize\n");
    return 0;
  }

  // Dedupe + rank, then number items so the model can cite them by [n].
  const ranked = dedupeRank(items, 25);
  const corpus = ranked
    .map(
      (it, i) =>
        `[${i + 1}] (${it.source}, score ${it.score}) ${it.title} — ${it.url}` +
        (it.excerpt ? `\n    transcript: ${it.excerpt}` : ""),
    )
    .join("\n");

  const system =
    "You synthesize community signal into a grounded brief. Use ONLY the provided items — do not add outside or prior knowledge. Cite every claim with its [n] index. If the items are thin or off-topic for the requested topic, say so plainly. Be concise and high-contrast.";
  const prompt = [
    `Topic: ${topic}`,
    `Window: last 30 days`,
    `Items:`,
    corpus,
    ``,
    `Write GitHub-flavored markdown using these BOLD labels (do NOT use # headings):`,
    `**Signal** — 2–4 sentences on what the community is actually discussing about "${topic}" right now, grounded in the items.`,
    `**Rising** — then a bulleted list of what's gaining traction, each citing [n].`,
    `**Friction** — then a bulleted list of criticism / failures / losing traction, each citing [n]. If none appear in the items, write "Not evident in the last 30 days of items."`,
    ``,
    `Do not use markdown headings. Every claim must trace to an item. Do not invent sources.`,
    `On the very last line, output "TAGS:" then 3–6 short kebab-case topic tags (comma-separated, no # prefix) capturing the themes.`,
  ].join("\n");

  try {
    const out = await ctx.services.llm.complete(prompt, { system, maxTokens: 1200 });
    if (out && out.trim()) {
      const { body, tags } = splitTags(out.trim());
      ctx.context.synthesis = body;
      ctx.context.synthTags = tags;
      // Record which brain produced the analysis, for the doc's provenance.
      ctx.context.synthModel = `${ctx.services.llm.model} (${ctx.services.llm.id})`;
      ctx.emit(`synthesize-research: synthesized via ${ctx.services.llm.id} (${body.length} chars, ${tags.length} tags)\n`);
    } else {
      ctx.emit(`synthesize-research: LLM (${ctx.services.llm.id}) returned empty; continuing without synthesis\n`);
    }
  } catch (err) {
    ctx.emit(`synthesize-research: failed (${(err as Error).message}); continuing without synthesis\n`);
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
  const items = dedupeRank(all);
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

  // Lead with the grounded synthesis when available, then the raw findings.
  const synthesis = typeof ctx.context.synthesis === "string" ? ctx.context.synthesis.trim() : "";
  const sections: Record<string, string> = synthesis
    ? { Analysis: synthesis, "Key findings": keyFindings }
    : { "Key findings": keyFindings };

  const now = ctx.services.nowIso();
  const dateKey = (now.split("T")[0] ?? now).slice(0, 10);
  const title = `${topic} — last 30 days`;
  const built = buildResultDocument({
    type: "research",
    key: topic,
    title,
    source: "last-30-days",
    tldr,
    sections,
    sources,
    status: items.length > 0 ? "complete" : "partial",
    confidence: items.length >= 5 && sourcesUsed.length > 1 ? "high" : items.length >= 3 ? "medium" : "low",
    staleAfterMinutes: 1440,
    tags: [
      `topic/${topic.toLowerCase().replace(/\s+/g, "-")}`,
      ...((ctx.context.synthTags as string[] | undefined) ?? []).map((t) => `topic/${t}`),
    ],
    inputs: { topic },
    // Provenance: which model synthesised the analysis (if any).
    model: typeof ctx.context.synthModel === "string" ? ctx.context.synthModel : undefined,
    // Backlink to the day's note so Obsidian's graph connects the node.
    links: [dateKey],
    now,
  });

  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.researchPath = path;
  ctx.context.result = { path: ctx.services.vault.toRelative(path), title, type: "research" };
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
  const title = `Inbox triage — ${dateKey}`;
  const built = buildResultDocument({
    type: "inbox",
    key: dateKey,
    title,
    source: "inbox-triage",
    tldr: `${messages.length} unread; ${actionable.length} likely need a reply.`,
    sections: { "Action items": actionItems, "By sender": senderLines },
    status: "complete",
    confidence: "medium",
    staleAfterMinutes: 60,
    tags: ["inbox", `mail/${mail.id}`],
    inputs: { provider: mail.id },
    // Backlink to the day's note so Obsidian's graph connects the node.
    links: [dateKey],
    now: ctx.services.nowIso(),
  });

  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.result = { path: ctx.services.vault.toRelative(path), title, type: "inbox" };
  ctx.emit(`inbox-triage: ${messages.length} unread, ${actionable.length} actionable -> ${path}\n`);
  return 0;
};

// --- AI Wire (themed intel brief: fetch -> synthesize bullets -> intel record) --

// Kept concise: the fetchers do full-text AND search, so a long phrase matches
// nothing. "AI" over the 30-day window returns plenty; synthesis curates it.
const AI_WIRE_TOPIC = "AI";

const aiWire: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim() || AI_WIRE_TOPIC;
  ctx.params.topic = topic; // the fetch handlers read params.topic

  // Reuse the keyless fetchers to populate ctx.context.researchItems.
  await fetchHackerNews(ctx);
  await fetchReddit(ctx);

  const items = (ctx.context.researchItems as ResearchItem[] | undefined) ?? [];
  const ranked = dedupeRank(items, 25);

  // Synthesize concise wire headlines (grounded in the items) when an LLM is up.
  let wire = "";
  let model: string | undefined;
  let aiTags: string[] = [];
  if (ctx.services.llm && ranked.length > 0) {
    const corpus = ranked
      .map((it, i) => `[${i + 1}] (${it.source}, score ${it.score}) ${it.title} — ${it.url}`)
      .join("\n");
    const system =
      "You write a terse AI-industry intel wire. Use ONLY the provided items. Each line is one tight headline-style bullet (max ~22 words) on a distinct, important development. No preamble, no markdown headings.";
    const prompt = [
      `Theme: ${topic}`,
      `Items:`,
      corpus,
      ``,
      `Write 5–8 markdown bullets ("- "), most important first. Each must trace to an item; cite none inline. Skip off-theme items. No headings, no intro.`,
      `On the very last line, output "TAGS:" then 3–6 short kebab-case topic tags (comma-separated, no # prefix) for the themes covered.`,
    ].join("\n");
    try {
      const out = await ctx.services.llm.complete(prompt, { system, maxTokens: 700 });
      if (out && out.trim()) {
        const split = splitTags(out.trim());
        wire = split.body;
        aiTags = split.tags;
        model = `${ctx.services.llm.model} (${ctx.services.llm.id})`;
        ctx.emit(`ai-wire: synthesized ${wire.split("\n").filter((l) => l.trim().startsWith("-")).length} bullets, ${aiTags.length} tags via ${ctx.services.llm.id}\n`);
      }
    } catch (err) {
      ctx.emit(`ai-wire: synthesis failed (${(err as Error).message}); falling back to top headlines\n`);
    }
  }

  // Fallback: raw top headlines as the wire.
  if (!wire) {
    wire =
      ranked.length > 0
        ? ranked.slice(0, 8).map((i) => `- [${i.title}](${i.url}) — ${i.score} · ${i.source}`).join("\n")
        : `- No fresh AI-industry signal in the last 30 days.`;
  }

  const now = ctx.services.nowIso();
  const dateKey = (now.split("T")[0] ?? now).slice(0, 10);
  const top = ranked[0];
  const tldr = top
    ? `${ranked.length} AI-industry signals; lead: ${top.title}.`
    : `No fresh AI-industry signal today.`;
  const sources: SourceRef[] = ranked.slice(0, 12).map((i) => ({ label: `${i.title} (${i.source})`, url: i.url }));

  const title = `AI Wire — ${dateKey}`;
  const built = buildResultDocument({
    type: "intel",
    key: dateKey,
    title,
    source: "ai-wire",
    tldr,
    sections: { Wire: wire },
    sources,
    status: ranked.length > 0 ? "complete" : "partial",
    confidence: ranked.length >= 8 ? "high" : ranked.length >= 3 ? "medium" : "low",
    staleAfterMinutes: 180,
    tags: ["ai-wire", ...aiTags.map((t) => `topic/${t}`)],
    inputs: { topic },
    model,
    links: [dateKey],
    now,
  });
  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.result = { path: ctx.services.vault.toRelative(path), title, type: "intel" };
  ctx.emit(`ai-wire: ${ranked.length} items -> ${path}\n`);
  return 0;
};

// --- Calendar / schedule (Outlook via the mail provider) --------------------

/** Today's agenda from the mail provider's calendar, or null if unavailable. */
async function fetchTodayAgenda(ctx: NativeHandlerContext): Promise<{ count: number; agenda: string } | null> {
  const mail = ctx.services.mail;
  if (!mail?.listEvents) return null;
  const now = ctx.services.nowIso();
  const day = (now.split("T")[0] ?? now).slice(0, 10);
  try {
    const events = await mail.listEvents(`${day}T00:00:00Z`, `${day}T23:59:59Z`, 25);
    if (events.length === 0) return { count: 0, agenda: "- No meetings today." };
    const agenda = events
      .map((e) => {
        const t = e.allDay ? "all day" : (e.start.split("T")[1] ?? "").slice(0, 5);
        const loc = e.location ? ` @ ${e.location}` : "";
        return `- ${t} — ${e.subject}${loc}`;
      })
      .join("\n");
    return { count: events.length, agenda };
  } catch (err) {
    ctx.emit(`schedule: calendar fetch failed (${(err as Error).message})\n`);
    return null;
  }
}

const scheduleBrief: NativeHandler = async (ctx) => {
  const mail = ctx.services.mail;
  if (!mail?.listEvents) {
    ctx.emit("schedule: no calendar provider (set mail.provider=outlook and sign in with Calendars.Read)\n");
    return 1;
  }
  const agenda = await fetchTodayAgenda(ctx);
  if (!agenda) return 1;

  const now = ctx.services.nowIso();
  const dateKey = (now.split("T")[0] ?? now).slice(0, 10);
  let tldr = agenda.count > 0 ? `${agenda.count} meeting(s) on today's calendar.` : "No meetings today.";
  let model: string | undefined;
  if (ctx.services.llm && agenda.count > 0) {
    try {
      const out = (
        await ctx.services.llm.complete(
          `Today's agenda:\n${agenda.agenda}\n\nIn ONE spoken sentence, summarize the day's schedule (load, busiest stretch, key meetings).`,
          { system: "You are a concise, spoken-friendly scheduler. One sentence, no markdown.", maxTokens: 200 },
        )
      ).trim();
      if (out) {
        tldr = out.split("\n")[0]!.replace(/^[-*#>\s]+/, "").trim();
        model = `${ctx.services.llm.model} (${ctx.services.llm.id})`;
      }
    } catch {
      /* keep the templated tldr */
    }
  }

  const title = `Schedule — ${dateKey}`;
  const built = buildResultDocument({
    type: "schedule",
    key: dateKey,
    title,
    source: "schedule",
    tldr,
    sections: { Agenda: agenda.agenda },
    status: "complete",
    confidence: agenda.count > 0 ? "high" : "low",
    staleAfterMinutes: 120,
    tags: ["schedule"],
    inputs: {},
    model,
    links: [dateKey],
    now,
  });
  const path = ctx.services.vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.result = { path: ctx.services.vault.toRelative(path), title, type: "schedule" };
  ctx.emit(`schedule: ${agenda.count} events -> ${path}\n`);
  return 0;
};

// --- Morning report (daily brief synthesized from the vault) ----------------

const morningReport: NativeHandler = async (ctx) => {
  const now = ctx.services.nowIso();
  const dateKey = (now.split("T")[0] ?? now).slice(0, 10);
  const vault = ctx.services.vault;

  // Today's operations log (from the daily note) + recent records as raw material.
  const daily = vault.read("daily", dateKey);
  const opsLog = daily ? daily.generated.trim() : "";
  const recent = vault.listRecent(12).filter((r) => r.type !== "daily" && r.type !== "report");
  const recentLines = recent.length
    ? recent.map((r) => `- **${r.type}** — ${r.title}`).join("\n")
    : "- No records yet.";

  // Today's calendar (folded in when the mail provider has it).
  const agenda = await fetchTodayAgenda(ctx);

  let tldr = "";
  let brief = "";
  let model: string | undefined;
  if (ctx.services.llm) {
    const system = "You are the user's concise, spoken-friendly morning briefer. No fluff, no headings.";
    const prompt = [
      `Date: ${dateKey}`,
      ...(agenda ? [`Today's schedule:`, agenda.agenda, ``] : []),
      `Today's operation log:`,
      opsLog || "(nothing logged yet)",
      ``,
      `Recent vault records:`,
      recentLines,
      ``,
      `Write a morning brief. The FIRST line is ONE spoken-summary sentence of what matters today.`,
      `Then a blank line, then 3–6 short markdown bullets ("- ") of highlights drawn from the log/records. No headings.`,
    ].join("\n");
    try {
      const out = (await ctx.services.llm.complete(prompt, { system, maxTokens: 700 })).trim();
      if (out) {
        const lines = out.split("\n");
        const firstIdx = lines.findIndex((l) => l.trim());
        tldr = (lines[firstIdx] ?? "").replace(/^[-*#>\s]+/, "").trim();
        brief = lines.slice(firstIdx + 1).join("\n").trim();
        model = `${ctx.services.llm.model} (${ctx.services.llm.id})`;
        ctx.emit(`morning-report: synthesized via ${ctx.services.llm.id}\n`);
      }
    } catch (err) {
      ctx.emit(`morning-report: synthesis failed (${(err as Error).message}); using a templated brief\n`);
    }
  }

  if (!tldr) tldr = `Morning report for ${dateKey}: ${recent.length} recent record(s)${opsLog ? "" : ", no activity logged yet"}.`;
  if (!brief) brief = recentLines;

  const title = `Morning Report — ${dateKey}`;
  const built = buildResultDocument({
    type: "report",
    key: dateKey,
    title,
    source: "morning-report",
    tldr,
    sections: {
      Brief: brief,
      ...(agenda ? { Schedule: agenda.agenda } : {}),
      Recent: recentLines,
    },
    status: "complete",
    confidence: recent.length > 0 ? "medium" : "low",
    staleAfterMinutes: 720, // ~half a day: a repeat "rundown" the same morning serves the cached brief
    tags: ["report"],
    inputs: {},
    model,
    links: [dateKey],
    now,
  });
  const path = vault.writeGenerated(built.frontmatter, built.generated);
  ctx.context.result = { path: vault.toRelative(path), title, type: "report" };
  ctx.emit(`morning-report: ${recent.length} recent records -> ${path}\n`);
  return 0;
};

export const NATIVE_HANDLERS: Record<string, NativeHandler> = {
  fetchHackerNews,
  fetchReddit,
  fetchPolymarket,
  fetchWeb,
  fetchYouTube,
  fetchX,
  synthesizeResearch,
  compileResearch,
  inboxTriage,
  aiWire,
  morningReport,
  scheduleBrief,
};
