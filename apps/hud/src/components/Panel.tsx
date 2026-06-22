/**
 * A side panel of three drop slots. Each occupied slot shows a widget framed by
 * a draggable header; dragging a header onto another slot swaps them. Empty
 * slots are valid drop targets and quietly invite a widget.
 */
import { useState } from "react";
import type { HudState } from "../useGateway.js";
import { WIDGET_TITLES, type Layout, type SlotId } from "../layout.js";
import { renderWidget } from "./widgets.js";

interface PanelProps {
  side: "left" | "right";
  slots: SlotId[];
  layout: Layout;
  hud: HudState;
  onMove: (from: SlotId, to: SlotId) => void;
}

export function Panel({ side, slots, layout, hud, onMove }: PanelProps) {
  const [dragOver, setDragOver] = useState<SlotId | null>(null);

  return (
    <aside className={`panel panel--${side}`}>
      {slots.map((slot) => {
        const widget = layout[slot];
        return (
          <section
            key={slot}
            className={`slot ${dragOver === slot ? "slot--over" : ""} ${widget ? "" : "slot--empty"}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(slot);
            }}
            onDragLeave={() => setDragOver((s) => (s === slot ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const from = e.dataTransfer.getData("text/slot") as SlotId;
              if (from) onMove(from, slot);
            }}
          >
            {widget ? (
              <>
                <header
                  className="slot__head"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/slot", slot)}
                  title="Drag to rearrange"
                >
                  <span className="slot__title">{WIDGET_TITLES[widget]}</span>
                  <span className="slot__grip" aria-hidden>⠿</span>
                </header>
                <div className="slot__body">{renderWidget(widget, hud)}</div>
              </>
            ) : (
              <div className="slot__placeholder">drop a widget</div>
            )}
          </section>
        );
      })}
    </aside>
  );
}
