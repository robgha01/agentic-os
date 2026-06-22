/**
 * Floating context cards — the four panels anchored to the corners around the
 * core (per the HUD blueprint). Local cards open the newest matching vault
 * record in the document viewer; external cards open a URL. Each has an X to
 * dismiss; a top-center "clear all" flushes the visible set (session-only —
 * they return on reload).
 */
import { useState } from "react";
import type { HudState } from "../useGateway.js";

type Corner = "tl" | "tr" | "bl" | "br";

interface CardDef {
  id: string;
  label: string;
  corner: Corner;
  kind: "doc" | "link";
  docType?: string;
  url?: string;
  hint: string;
}

const CARDS: CardDef[] = [
  { id: "morning-report", label: "Morning Report", corner: "tl", kind: "doc", docType: "daily", hint: "latest daily log" },
  { id: "inbox-brief", label: "Inbox Brief", corner: "tr", kind: "doc", docType: "inbox", hint: "email triage" },
  { id: "inbox", label: "Inbox", corner: "bl", kind: "link", url: "https://outlook.office.com/mail/", hint: "open mailbox" },
  { id: "source", label: "Source", corner: "br", kind: "link", url: "https://www.anthropic.com", hint: "reference" },
];

export function ContextCards({ hud }: { hud: HudState }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = CARDS.filter((c) => !hidden.has(c.id));
  if (visible.length === 0) return null;

  const newestOf = (type?: string) => hud.records.find((r) => r.type === type);

  const activate = (c: CardDef) => {
    if (c.kind === "link" && c.url) {
      window.open(c.url, "_blank", "noopener,noreferrer");
      return;
    }
    const rec = newestOf(c.docType);
    if (rec) hud.openDoc(rec.path);
    else if (c.id === "inbox-brief") hud.send({ type: "invoke", skillId: "inbox-triage" });
  };

  const dismiss = (id: string) =>
    setHidden((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });

  return (
    <>
      <button className="cards__clear" onClick={() => setHidden(new Set(CARDS.map((c) => c.id)))}>
        clear all ×{visible.length}
      </button>
      {visible.map((c) => {
        const rec = c.kind === "doc" ? newestOf(c.docType) : undefined;
        const sub =
          c.kind === "link"
            ? c.hint
            : rec
              ? rec.title
              : c.id === "inbox-brief"
                ? "run triage →"
                : "none yet";
        return (
          <div key={c.id} className={`ccard ccard--${c.corner}`}>
            <button className="ccard__body" onClick={() => activate(c)} title={sub}>
              <span className="ccard__label">{c.label}</span>
              <span className="ccard__sub">{sub}</span>
            </button>
            <button className="ccard__x" onClick={() => dismiss(c.id)} aria-label={`Dismiss ${c.label}`}>
              ✕
            </button>
          </div>
        );
      })}
    </>
  );
}
