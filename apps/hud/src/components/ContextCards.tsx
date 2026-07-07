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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HudState, TaskCardView } from "../useGateway.js";

// Newest card takes top-right, then top-left, bottom-left, bottom-right —
// matching the HUD blueprint. Only the 4 newest orbit the ball; the rest
// collapse into the overflow tray.
const CORNERS = ["tr", "tl", "bl", "br"] as const;
const VISIBLE = 4;

interface Link {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Where the segment from (sx,sy) toward (ex,ey) first enters the rectangle
 * (rx0,ry0)-(rx1,ry1) — so the connector ends on the card's edge instead of
 * running behind it to the centre. Liang-Barsky clip; null if it never enters.
 */
function boxEntry(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
): { x: number; y: number } | null {
  const dx = ex - sx;
  const dy = ey - sy;
  const p = [-dx, dx, -dy, dy];
  const q = [sx - rx0, rx1 - sx, sy - ry0, ry1 - sy];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return null;
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return { x: sx + t0 * dx, y: sy + t0 * dy };
}

export function ContextCards({ hud }: { hud: HudState }) {
  const cards = hud.taskCards;
  const visible = cards.slice(0, VISIBLE);
  const overflow = cards.slice(VISIBLE);
  const [trayOpen, setTrayOpen] = useState(false);

  const orbitRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const setCardRef = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  // Draw a line from the sphere's edge to each visible card centre, measured
  // from the live DOM so it stays attached at any viewport size.
  const measure = useCallback(() => {
    const orbit = orbitRef.current;
    const core = orbit?.parentElement?.querySelector<HTMLElement>(".core");
    if (!orbit || !core) return;
    const o = orbit.getBoundingClientRect();
    const c = core.getBoundingClientRect();
    const cx = c.left + c.width / 2 - o.left;
    const cy = c.top + c.height / 2 - o.top;
    // The particle sphere's drawn radius is min(w,h)*0.32 (see Core.tsx), i.e.
    // 0.64 of the half-box. Start the line a little OUTSIDE that edge so it
    // reads as reaching toward the ball, not stuck to it.
    const radius = (Math.min(c.width, c.height) / 2) * 0.64;
    const startR = radius + 16;
    const next: Link[] = [];
    for (const card of visible) {
      const el = cardRefs.current.get(card.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const rx0 = r.left - o.left;
      const ry0 = r.top - o.top;
      const px = rx0 + r.width / 2;
      const py = ry0 + r.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const sx = cx + (dx / dist) * startR;
      const sy = cy + (dy / dist) * startR;
      // End the line on the card's near edge, not behind it at the centre.
      const hit = boxEntry(sx, sy, px, py, rx0, ry0, rx0 + r.width, ry0 + r.height) ?? { x: px, y: py };
      next.push({ id: card.id, x1: sx, y1: sy, x2: hit.x, y2: hit.y });
    }
    setSize({ w: o.width, h: o.height });
    setLinks(next);
  }, [visible]);

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
          <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </svg>
      <div className="orbit__controls">
        {overflow.length > 0 ? (
          <button
            className={`orbit__more ${trayOpen ? "orbit__more--on" : ""}`}
            onClick={() => setTrayOpen((v) => !v)}
            aria-expanded={trayOpen}
          >
            +{overflow.length} more
          </button>
        ) : null}
        <button className="orbit__clear" onClick={hud.clearCards}>
          clear all ×{cards.length}
        </button>
      </div>
      {visible.map((c, i) => {
        const corner = CORNERS[i % CORNERS.length]!;
        return <Card key={c.id} card={c} corner={corner} hud={hud} setRef={setCardRef} />;
      })}
      {trayOpen && overflow.length > 0 ? (
        <div className="orbit__tray" role="list" aria-label="older notifications">
          {overflow.map((c) => (
            <TrayRow key={c.id} card={c} hud={hud} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Card({
  card: c,
  corner,
  hud,
  setRef,
}: {
  card: TaskCardView;
  corner: string;
  hud: HudState;
  setRef: (id: number, el: HTMLDivElement | null) => void;
}) {
  const clickable = c.status === "done" && Boolean(c.resultPath);
  const sub =
    c.status === "failed" ? (c.error ?? "failed") : c.resultType ? `${c.resultType} · open ↗` : "open ↗";
  return (
    <div className={`ccard ccard--${corner}`} data-status={c.status} ref={(el) => setRef(c.id, el)}>
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

/** One row in the overflow tray — same click/dismiss behavior, list layout. */
function TrayRow({ card: c, hud }: { card: TaskCardView; hud: HudState }) {
  const clickable = c.status === "done" && Boolean(c.resultPath);
  const sub = c.status === "failed" ? (c.error ?? "failed") : c.resultType ?? "open ↗";
  return (
    <div className="otray__row" data-status={c.status} role="listitem">
      <button
        className="otray__body"
        onClick={() => clickable && hud.openDoc(c.resultPath!)}
        disabled={!clickable}
        title={clickable ? `Open ${c.label}` : c.error}
      >
        <span className="otray__label">{c.label}</span>
        <span className="otray__sub">{sub}</span>
      </button>
      <button className="otray__x" onClick={() => hud.dismissCard(c.id)} aria-label={`Dismiss ${c.label}`}>
        ✕
      </button>
    </div>
  );
}
