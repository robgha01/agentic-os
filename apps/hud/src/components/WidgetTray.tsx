/**
 * Widget tray — a persistent dock of every widget not on the active page. Each
 * chip is draggable onto any panel slot (occupied → swap; the displaced widget
 * returns here). Collapsible so it stays out of the way when unused.
 */
import { useState } from "react";
import { WIDGETS, type WidgetId } from "../widget-registry.js";

export function WidgetTray({ unplaced }: { unplaced: WidgetId[] }) {
  const [open, setOpen] = useState(false);
  if (unplaced.length === 0) return null;
  return (
    <div className={`wtray ${open ? "wtray--open" : ""}`}>
      <button className="wtray__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        widgets ·{unplaced.length}
      </button>
      {open ? (
        <ul className="wtray__list">
          {unplaced.map((id) => (
            <li
              key={id}
              className="wtray__chip"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/widget", id)}
              title={`Drag ${WIDGETS[id]!.name} onto a slot`}
            >
              {WIDGETS[id]!.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
