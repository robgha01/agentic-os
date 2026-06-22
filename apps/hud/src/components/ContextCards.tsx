/**
 * Context cards — notifications for tasks that just ran, connected to the core
 * by a drawn line.
 *
 * Each finished operation that produced a vault record spawns a card named
 * after the task's result; clicking it opens that result in the document
 * viewer. Failed tasks spawn a non-clickable error card. Cards fill the four
 * corners around the sphere (stacking when more than four are live), and an SVG
 * layer draws a line from the sphere's edge to each card so they read as
 * anchored to the ball. Each card has an X to dismiss; a top-center "clear all"
 * flushes the set. Cards are session-only — they appear as tasks complete and
 * clear on reload.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { HudState, TaskCardView } from "../useGateway.js";

// Newest card takes top-right, then top-left, bottom-left, bottom-right —
// matching the HUD blueprint. Extra cards stack within a corner.
const CORNERS = ["tr", "tl", "bl", "br"] as const;
const STACK_GAP = 64; // px offset when a corner holds more than one card

interface Link {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function ContextCards({ hud }: { hud: HudState }) {
  const cards = hud.taskCards;
  const orbitRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const setCardRef = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  // Draw a line from the sphere's edge to each card centre, measured from the
  // live DOM so it stays attached at any viewport size.
  const measure = useCallback(() => {
    const orbit = orbitRef.current;
    const core = orbit?.parentElement?.querySelector<HTMLElement>(".core");
    if (!orbit || !core) return;
    const o = orbit.getBoundingClientRect();
    const c = core.getBoundingClientRect();
    const cx = c.left + c.width / 2 - o.left;
    const cy = c.top + c.height / 2 - o.top;
    // The particle sphere's drawn radius is min(w,h)*0.32 (see Core.tsx), i.e.
    // 0.64 of the half-box — match it so the line lands on the visible edge.
    const radius = (Math.min(c.width, c.height) / 2) * 0.64; // sphere surface
    const next: Link[] = [];
    for (const card of cards) {
      const el = cardRefs.current.get(card.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const px = r.left + r.width / 2 - o.left;
      const py = r.top + r.height / 2 - o.top;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy) || 1;
      next.push({ id: card.id, x1: cx + (dx / dist) * radius, y1: cy + (dy / dist) * radius, x2: px, y2: py });
    }
    setSize({ w: o.width, h: o.height });
    setLinks(next);
  }, [cards]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Recompute on any layout change (window + stage resize).
  useEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(orbit);
    if (orbit.parentElement) ro.observe(orbit.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  if (cards.length === 0) return null;

  return (
    <div className="orbit" ref={orbitRef} aria-label="recent task notifications">
      <svg className="orbit__links" width={size.w} height={size.h} aria-hidden="true">
        {links.map((l) => (
          <g key={l.id}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
            <circle cx={l.x1} cy={l.y1} r="2.5" />
          </g>
        ))}
      </svg>
      <button className="orbit__clear" onClick={hud.clearCards}>
        clear all ×{cards.length}
      </button>
      {cards.map((c, i) => {
        const corner = CORNERS[i % CORNERS.length]!;
        const stack = Math.floor(i / CORNERS.length);
        const offset = stack * STACK_GAP;
        const down = corner === "tr" || corner === "tl";
        const style: CSSProperties = down ? { marginTop: offset } : { marginBottom: offset };
        return <Card key={c.id} card={c} corner={corner} style={style} hud={hud} setRef={setCardRef} />;
      })}
    </div>
  );
}

function Card({
  card: c,
  corner,
  style,
  hud,
  setRef,
}: {
  card: TaskCardView;
  corner: string;
  style: CSSProperties;
  hud: HudState;
  setRef: (id: number, el: HTMLDivElement | null) => void;
}) {
  const clickable = c.status === "done" && Boolean(c.resultPath);
  const sub =
    c.status === "failed" ? (c.error ?? "failed") : c.resultType ? `${c.resultType} · open ↗` : "open ↗";
  return (
    <div
      className={`ccard ccard--${corner}`}
      style={style}
      data-status={c.status}
      ref={(el) => setRef(c.id, el)}
    >
      <button
        className="ccard__body"
        onClick={() => clickable && hud.openDoc(c.resultPath!)}
        disabled={!clickable}
        title={clickable ? `Open ${c.label}` : c.error}
      >
        <span className="ccard__label">{c.label}</span>
        <span className="ccard__sub">{sub}</span>
      </button>
      <button className="ccard__x" onClick={() => hud.dismissCard(c.id)} aria-label={`Dismiss ${c.label}`}>
        ✕
      </button>
    </div>
  );
}
