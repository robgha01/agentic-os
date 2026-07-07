/**
 * Layout facade — binds the pure `workspace.ts` model to the widget registry and
 * localStorage. Six slots per page; the default page is derived from each
 * widget's `defaultSlot`. Persists (and migrates the legacy v4 flat layout) so
 * existing users keep their arrangement.
 */
import { ALL_WIDGET_IDS, WIDGETS } from "./widget-registry.js";
import {
  emptySlots, migrate, unplacedIds,
  type PageSlots, type Page, type SlotId, type Workspace, type WidgetId,
} from "./workspace.js";

export type { SlotId, PageSlots, Page, Workspace, WidgetId };
export {
  SLOTS, activePage, activeSlots, moveWidget, placeWidget, removeWidget,
  addPage, renamePage, removePage, setActivePage,
} from "./workspace.js";

/** Default page slots from each widget's declared `defaultSlot`. */
export const DEFAULT_PAGE_SLOTS: PageSlots = (() => {
  const slots = emptySlots();
  for (const id of ALL_WIDGET_IDS) {
    const slot = WIDGETS[id]!.defaultSlot;
    if (slot && slots[slot] === null) slots[slot] = id;
  }
  return slots;
})();

const NEW_KEY = "aos.hud.workspace.v5";
const OLD_KEY = "aos.hud.layout.v4";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadWorkspace(): Workspace {
  return migrate(readJson(NEW_KEY), readJson(OLD_KEY), ALL_WIDGET_IDS, DEFAULT_PAGE_SLOTS);
}

export function saveWorkspace(w: Workspace): void {
  try {
    localStorage.setItem(NEW_KEY, JSON.stringify(w));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/** Registry-bound convenience: widget ids not on the active page (the tray). */
export function unplacedWidgets(w: Workspace): WidgetId[] {
  return unplacedIds(w, ALL_WIDGET_IDS);
}
