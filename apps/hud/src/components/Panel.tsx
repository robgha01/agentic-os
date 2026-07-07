/**
 * A side panel of three drop slots. Each occupied slot shows a widget framed by
 * a draggable header; dragging a header onto another slot swaps them. A widget
 * can be removed back to the palette, and empty slots offer an "add widget"
 * menu listing every registered widget not currently placed.
 *
 * Widgets that declare options (see the registry) get a cogwheel in their header;
 * clicking it reveals an inline options form whose values persist per widget.
 */
import { useState } from "react";
import type { HudState } from "../useGateway.js";
import type { PageSlots, SlotId } from "../layout.js";
import { WIDGETS, hasOptions, type WidgetId } from "../widget-registry.js";
import {
  loadWidgetOptions,
  resolveOptions,
  saveWidgetOptions,
  type WidgetOptionField,
  type WidgetOptions,
} from "../widget-options.js";

interface PanelProps {
  side: "left" | "right";
  slots: SlotId[];
  layout: PageSlots;
  hud: HudState;
  unplaced: WidgetId[];
  onMove: (from: SlotId, to: SlotId) => void;
  onAdd: (slot: SlotId, widget: WidgetId) => void;
  onRemove: (slot: SlotId) => void;
}

export function Panel({ side, slots, layout, hud, unplaced, onMove, onAdd, onRemove }: PanelProps) {
  const [dragOver, setDragOver] = useState<SlotId | null>(null);
  const [openOpts, setOpenOpts] = useState<SlotId | null>(null);
  const [openAdd, setOpenAdd] = useState<SlotId | null>(null);
  const [opts, setOpts] = useState<Record<string, WidgetOptions>>({});

  const setOpt = (w: WidgetId, key: string, value: string | number | boolean) => {
    setOpts((prev) => {
      const next = { ...(prev[w] ?? loadWidgetOptions(w)), [key]: value };
      saveWidgetOptions(w, next);
      return { ...prev, [w]: next };
    });
  };
  const optsFor = (w: WidgetId) => resolveOptions(WIDGETS[w].options, opts[w] ?? loadWidgetOptions(w));

  return (
    <aside className={`panel panel--${side}`}>
      {slots.map((slot) => {
        const widget = layout[slot];
        const def = widget ? WIDGETS[widget] : null;
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
            {widget && def ? (
              <>
                <header
                  className="slot__head"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/slot", slot)}
                  title="Drag to rearrange"
                >
                  <span className="slot__titles">
                    <span className="slot__title">{def.name}</span>
                    {def.eyebrow ? <span className="slot__eyebrow">{def.eyebrow}</span> : null}
                  </span>
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
                    <button
                      className="slot__remove"
                      onClick={() => onRemove(slot)}
                      title="Remove widget (back to palette)"
                      aria-label="Remove widget"
                    >
                      ✕
                    </button>
                    <span className="slot__grip" aria-hidden>⠿</span>
                  </span>
                </header>
                {showOpts ? (
                  <WidgetOptionsPanel
                    fields={def.options!}
                    values={optsFor(widget)}
                    onChange={(k, v) => setOpt(widget, k, v)}
                  />
                ) : null}
                <div className="slot__body">{def.render(hud, optsFor(widget))}</div>
              </>
            ) : (
              <div className="slot__add">
                <button className="slot__addbtn" onClick={() => setOpenAdd((s) => (s === slot ? null : slot))}>
                  + add widget
                </button>
                {openAdd === slot ? (
                  <ul className="slot__menu">
                    {unplaced.length === 0 ? (
                      <li className="slot__menu-empty">all widgets placed</li>
                    ) : (
                      unplaced.map((id) => (
                        <li key={id}>
                          <button
                            onClick={() => {
                              onAdd(slot, id);
                              setOpenAdd(null);
                            }}
                          >
                            {WIDGETS[id].name}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
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
