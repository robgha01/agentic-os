/**
 * Result viewer — opens a vault record and renders its markdown. The file is
 * already human-first (no frontmatter noise, no markers, no footer in the body),
 * so this just renders the title, a small properties strip, and the prose.
 */
import { useEffect, useState } from "react";
import { marked } from "marked";
import type { HudState } from "../useGateway.js";
import type { VaultDoc } from "../gateway.js";

marked.setOptions({ breaks: true, gfm: true });

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

  const fm = doc?.frontmatter ?? {};
  const title = String(fm.title ?? path);
  const props = [
    fm.type ? `type · ${fm.type}` : null,
    fm.source ? `source · ${fm.source}` : null,
    fm.status ? `status · ${fm.status}` : null,
    fm.updated ? `updated · ${String(fm.updated).replace("T", " ").slice(0, 16)}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="overlay" onClick={hud.closeDoc}>
      <div className="docviewer" onClick={(e) => e.stopPropagation()}>
        <header className="docviewer__head">
          <div className="docviewer__path">{path}</div>
          <div className="docviewer__actions">
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
              // Strip the body's leading H1 — we already render the title above.
              dangerouslySetInnerHTML={{ __html: marked.parse(doc.body.replace(/^\s*#\s+[^\n]*\n+/, "")) as string }}
            />
          </article>
        )}
      </div>
    </div>
  );
}
