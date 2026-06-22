/**
 * Widget layout — the panels are drag-arrangeable. Six slots (top/middle/bottom
 * on each side) each hold one widget (or nothing). A default layout ships; the
 * user's arrangement persists to localStorage.
 */
export type WidgetId = "vitals" | "operations" | "deck" | "vault" | "schedule" | "audio";

export type SlotId =
  | "left-top"
  | "left-mid"
  | "left-bottom"
  | "right-top"
  | "right-mid"
  | "right-bottom";

export const SLOTS: SlotId[] = ["left-top", "left-mid", "left-bottom", "right-top", "right-mid", "right-bottom"];

export type Layout = Record<SlotId, WidgetId | null>;

export const WIDGET_TITLES: Record<WidgetId, string> = {
  vitals: "System status",
  operations: "Operations",
  deck: "Command deck",
  vault: "V.A.U.L.T. feed",
  schedule: "Schedule",
  audio: "Audio I/O",
};

export const DEFAULT_LAYOUT: Layout = {
  "left-top": "vitals",
  "left-mid": "operations",
  "left-bottom": "audio",
  "right-top": "deck",
  "right-mid": "vault",
  "right-bottom": "schedule",
};

// v2: added the Audio I/O widget to the default layout.
const STORAGE_KEY = "aos.hud.layout.v2";

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<Layout>;
    // Merge over defaults so new slots/widgets survive upgrades.
    return { ...DEFAULT_LAYOUT, ...parsed };
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
