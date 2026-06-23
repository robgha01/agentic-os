/**
 * Widget layout — the panels are drag-arrangeable. Six slots (top/middle/bottom
 * on each side) each hold one widget (or nothing). The default layout is derived
 * from each widget's `defaultSlot` in the registry; the user's arrangement
 * persists to localStorage. Widgets with no slot live in the add-widget palette.
 */
import { ALL_WIDGET_IDS, WIDGETS, type WidgetId } from "./widget-registry.js";

export type { WidgetId };

export type SlotId =
  | "left-top"
  | "left-mid"
  | "left-bottom"
  | "right-top"
  | "right-mid"
  | "right-bottom";

export const SLOTS: SlotId[] = ["left-top", "left-mid", "left-bottom", "right-top", "right-mid", "right-bottom"];

export type Layout = Record<SlotId, WidgetId | null>;

/** Built from each widget's declared `defaultSlot`. */
export const DEFAULT_LAYOUT: Layout = (() => {
  const layout: Layout = {
    "left-top": null,
    "left-mid": null,
    "left-bottom": null,
    "right-top": null,
    "right-mid": null,
    "right-bottom": null,
  };
  for (const id of ALL_WIDGET_IDS) {
    const slot = WIDGETS[id].defaultSlot;
    if (slot && layout[slot] === null) layout[slot] = id;
  }
  return layout;
})();

// v4: registry-derived layout + add-widget palette.
const STORAGE_KEY = "aos.hud.layout.v4";

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<Layout>;
    // Merge over defaults, dropping any unknown widget ids (renamed/removed).
    const merged = { ...DEFAULT_LAYOUT, ...parsed };
    for (const slot of SLOTS) {
      const w = merged[slot];
      if (w && !(w in WIDGETS)) merged[slot] = null;
    }
    return merged;
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/** Move/swap the widget in `from` into `to` (and vice-versa). Returns new layout. */
export function moveWidget(layout: Layout, from: SlotId, to: SlotId): Layout {
  if (from === to) return layout;
  return { ...layout, [to]: layout[from], [from]: layout[to] };
}

/** Widget ids not currently placed in any slot — the add-widget palette. */
export function unplacedWidgets(layout: Layout): WidgetId[] {
  const placed = new Set(SLOTS.map((s) => layout[s]).filter(Boolean));
  return ALL_WIDGET_IDS.filter((id) => !placed.has(id));
}
