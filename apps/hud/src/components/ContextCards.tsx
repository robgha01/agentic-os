/**
 * Context cards — notifications for tasks that just ran, anchored around the
 * core and connected to it by a spoke.
 *
 * Each finished operation that produced a vault record spawns a card named
 * after the task's result; clicking it opens that result in the document
 * viewer. Failed tasks spawn a non-clickable error card. Cards fill the four
 * corners around the sphere (stacking when more than four are live); each has
 * an X to dismiss, and a top-center "clear all" flushes the set. Cards are
 * session-only — they appear as tasks complete and clear on reload.
 */
import type { CSSProperties } from "react";
import type { HudState, TaskCardView } from "../useGateway.js";

// Corner order: newest card takes top-right, then top-left, bottom-left,
// bottom-right — matching the HUD blueprint. Extra cards stack in the corners.
const CORNERS = ["tr", "tl", "bl", "br"] as const;
const STACK_GAP = 64; // px offset when a corner holds more than one card

export function ContextCards({ hud }: { hud: HudState }) {
  const cards = hud.taskCards;
  if (cards.length === 0) return null;

  return (
    <div className="orbit" aria-label="recent task notifications">
      <button className="orbit__clear" onClick={hud.clearCards}>
        clear all ×{cards.length}
      </button>
      {cards.map((c, i) => {
        const corner = CORNERS[i % CORNERS.length]!;
        const stack = Math.floor(i / CORNERS.length);
        const offset = stack * STACK_GAP;
        const down = corner === "tr" || corner === "tl";
        const style = down ? { marginTop: offset } : { marginBottom: offset };
        return (
          <Card key={c.id} card={c} corner={corner} style={style} hud={hud} />
        );
      })}
    </div>
  );
}

function Card({
  card: c,
  corner,
  style,
  hud,
}: {
  card: TaskCardView;
  corner: string;
  style: CSSProperties;
  hud: HudState;
}) {
  const clickable = c.status === "done" && Boolean(c.resultPath);
  const sub =
    c.status === "failed" ? (c.error ?? "failed") : c.resultType ? `${c.resultType} · open ↗` : "open ↗";
  return (
    <div className={`ccard ccard--${corner}`} style={style} data-status={c.status}>
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
