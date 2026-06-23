/**
 * A side panel of three drop slots. Each occupied slot shows a widget framed by
 * a draggable header; dragging a header onto another slot swaps them. Empty
 * slots are valid drop targets and quietly invite a widget.
 *
 * Widgets that implement the options interface (see widget-options.ts) get a
 * cogwheel in their header; clicking it reveals an inline options panel whose
 * values persist per widget and are passed into the widget's render.
 */
import { useState } from "react";
import type { HudState } from "../useGateway.js";
import { WIDGET_TITLES, type Layout, type SlotId, type WidgetId } from "../layout.js";
import {
  WIDGET_OPTIONS,
  hasOptions,
  loadWidgetOptions,
  resolveOptions,
  saveWidgetOptions,
  type WidgetOptionField,
  type WidgetOptions,
} from "../widget-options.js";
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
  const [openOpts, setOpenOpts] = useState<SlotId | null>(null);
  const [opts, setOpts] = useState<Record<string, WidgetOptions>>(() => {
    const o: Record<string, WidgetOptions> = {};
    for (const s of slots) {
      const w = layout[s];
      if (w && hasOptions(w)) o[w] = loadWidgetOptions(w);
    }
    return o;
  });

  const setOpt = (w: WidgetId, key: string, value: string | number | boolean) => {
    setOpts((prev) => {
      const next = { ...(prev[w] ?? loadWidgetOptions(w)), [key]: value };
      saveWidgetOptions(w, next);
      return { ...prev, [w]: next };
    });
  };

  return (
    <aside className={`panel panel--${side}`}>
      {slots.map((slot) => {
        const widget = layout[slot];
        const optionable = widget ? hasOptions(widget) : false;
        const showOpts = optionable && openOpts === slot;
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
                  <span className="slot__tools">
                    {optionable ? (
                      <button
                        className={`slot__cog ${showOpts ? "slot__cog--on" : ""}`}
                        onClick={() => setOpenOpts((s) => (s === slot ? null : slot))}
                        title="Widget options"
                        aria-label="Widget options"
                        aria-expanded={showOpts}
                      >
                        ⚙
                      </button>
                    ) : null}
                    <span className="slot__grip" aria-hidden>⠿</span>
                  </span>
                </header>
                {showOpts && widget ? (
                  <WidgetOptionsPanel
                    fields={WIDGET_OPTIONS[widget]!}
                    values={resolveOptions(widget, opts[widget])}
                    onChange={(k, v) => setOpt(widget, k, v)}
                  />
                ) : null}
                <div className="slot__body">{renderWidget(widget, hud, resolveOptions(widget, opts[widget]))}</div>
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

/** Inline options form for a widget — renders the declared fields generically. */
function WidgetOptionsPanel({
  fields,
  values,
  onChange,
}: {
  fields: WidgetOptionField[];
  values: WidgetOptions;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  return (
    <div className="wopts">
      {fields.map((f) => (
        <label className="wopts__row" key={f.key}>
          <span className="wopts__key">{f.label}</span>
          {f.type === "toggle" ? (
            <button
              className={`wopts__toggle ${values[f.key] ? "wopts__toggle--on" : ""}`}
              role="switch"
              aria-checked={Boolean(values[f.key])}
              onClick={() => onChange(f.key, !values[f.key])}
            >
              <span className="wopts__knob" />
            </button>
          ) : f.type === "select" ? (
            <select className="wopts__input" value={String(values[f.key])} onChange={(e) => onChange(f.key, e.target.value)}>
              {(f.choices ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <input
              className="wopts__input"
              type={f.type === "number" ? "number" : "text"}
              value={String(values[f.key] ?? "")}
              placeholder={f.placeholder}
              onChange={(e) => onChange(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}
