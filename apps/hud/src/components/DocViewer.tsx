/**
 * Result viewer — opens a vault record and renders its markdown. The file is
 * already human-first (no frontmatter noise, no markers, no footer in the body),
 * so this just renders the title, a small properties strip, and the prose.
 */
import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { HudState } from "../useGateway.js";
import type { VaultDoc } from "../gateway.js";

marked.setOptions({ breaks: true, gfm: true });

// Reference/detail sections that start collapsed — the reader scans the TL;DR and
// lead section, then expands citations/findings on demand. Everything stays
// collapsible; only the default open/closed state differs.
const COLLAPSED_BY_DEFAULT = /^(key findings|findings|sources|related|references|citations|appendix)$/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Render a record body: everything before the first `## ` heading (title's
 * already stripped, so this is the TL;DR + any lead prose) renders normally;
 * each `## Section` becomes a collapsible <details>. Level-2 only — `###`
 * subheads inside a section are left to render as normal markdown.
 */
function renderCollapsibleBody(body: string): string {
  const lines = body.split("\n");
  const preamble: string[] = [];
  const sections: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      cur = { title: m[1]!, body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  const html: string[] = [];
  if (preamble.join("").trim()) html.push(marked.parse(preamble.join("\n")) as string);
  for (const s of sections) {
    const open = COLLAPSED_BY_DEFAULT.test(s.title.trim()) ? "" : " open";
    const inner = marked.parse(s.body.join("\n")) as string;
    html.push(
      `<details class="doc__section"${open}><summary>${escapeHtml(s.title)}</summary>` +
        `<div class="doc__section-body">${inner}</div></details>`,
    );
  }
  return html.join("\n");
}

export function DocViewer({ hud, path }: { hud: HudState; path: string }) {
  const [doc, setDoc] = useState<VaultDoc | null>(null);
  const [error, setError] = useState(false);

  // Depend on `path` + the stable fetchDoc callback only. Depending on the whole
  // `hud` object would re-run (and reset scroll) on every event-stream tick.
  const fetchDoc = hud.fetchDoc;
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(false);
    fetchDoc(path)
      .then((d) => alive && (d ? setDoc(d) : setError(true)))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [path, fetchDoc]);

  // Non-blocking panel: nothing dims/covers the HUD, so there's no click-outside
  // to close on. Esc closes instead.
  const closeDoc = hud.closeDoc;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDoc();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDoc]);

  // Memoized: the parent re-renders on every event-stream tick, and
  // parse+sanitize over a whole record is too heavy to redo each frame.
  const bodyHtml = useMemo(
    () =>
      doc
        ? DOMPurify.sanitize(
            // Strip the body's leading H1 — we already render the title above —
            // then render remaining `## ` sections as collapsible <details>.
            renderCollapsibleBody(doc.body.replace(/^\s*#\s+[^\n]*\n+/, "")),
            { ADD_ATTR: ["open"] },
          )
        : "",
    [doc],
  );

  const fm = doc?.frontmatter ?? {};
  const title = String(fm.title ?? path);
  const props = [
    fm.type ? `type · ${fm.type}` : null,
    fm.source ? `source · ${fm.source}` : null,
    fm.status ? `status · ${fm.status}` : null,
    fm.updated ? `updated · ${String(fm.updated).replace("T", " ").slice(0, 16)}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="docoverlay">
      <div className="docviewer">
        <header className="docviewer__head">
          <div className="docviewer__path">{path}</div>
          <div className="docviewer__actions">
            {doc ? (
              <button
                className="docviewer__speak"
                onClick={() => hud.send({ type: "speak", path })}
                title="Read the summary aloud"
              >
                🔊 Speak
              </button>
            ) : null}
            {doc?.obsidianUri ? (
              <a className="docviewer__obsidian" href={doc.obsidianUri}>
                Open in Obsidian ↗
              </a>
            ) : null}
            <button className="docviewer__close" onClick={hud.closeDoc} aria-label="Close">
              ✕
            </button>
          </div>
        </header>
        {error ? (
          <div className="empty">Couldn't load this record.</div>
        ) : !doc ? (
          <div className="empty">Loading…</div>
        ) : (
          <article className="doc">
            <h1 className="doc__title">{title}</h1>
            {props.length > 0 ? (
              <div className="doc__props">
                {props.map((p) => (
                  <span className="doc__prop" key={p}>{p}</span>
                ))}
              </div>
            ) : null}
            <div
              className="doc__body"
              // Sanitized: vault bodies contain LLM-synthesized text from scraped
              // web sources, so raw HTML must never reach the DOM.
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </article>
        )}
      </div>
    </div>
  );
}
