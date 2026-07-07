/**
 * Page-aware workspace model — the HUD's layout data structure, kept PURE (no
 * widget registry, no localStorage) so it is fully unit-testable and so adding
 * multi-page tabs later is additive. A Workspace holds one or more Pages; each
 * Page is the familiar six-slot grid. `layout.ts` wires this to the registry +
 * localStorage.
 */

export type WidgetId = string;

export type SlotId =
  | "left-top"
  | "left-mid"
  | "left-bottom"
  | "right-top"
  | "right-mid"
  | "right-bottom";

export const SLOTS: SlotId[] = ["left-top", "left-mid", "left-bottom", "right-top", "right-mid", "right-bottom"];

export type PageSlots = Record<SlotId, WidgetId | null>;
export interface Page { id: string; name: string; slots: PageSlots }
export interface Workspace { version: 5; activePageId: string; pages: Page[] }

export function emptySlots(): PageSlots {
  return {
    "left-top": null, "left-mid": null, "left-bottom": null,
    "right-top": null, "right-mid": null, "right-bottom": null,
  };
}

export function makePage(id: string, name: string, slots: PageSlots = emptySlots()): Page {
  return { id, name, slots: { ...emptySlots(), ...slots } };
}

export function defaultWorkspace(defaultSlots: PageSlots): Workspace {
  const page = makePage("main", "Main", defaultSlots);
  return { version: 5, activePageId: page.id, pages: [page] };
}

export function activePage(w: Workspace): Page {
  return w.pages.find((p) => p.id === w.activePageId) ?? w.pages[0]!;
}
export function activeSlots(w: Workspace): PageSlots {
  return activePage(w).slots;
}

/** Return a workspace with the active page's slots transformed by `fn`. */
function withActiveSlots(w: Workspace, fn: (s: PageSlots) => PageSlots): Workspace {
  const active = activePage(w);
  return {
    ...w,
    pages: w.pages.map((p) => (p.id === active.id ? { ...p, slots: fn(p.slots) } : p)),
  };
}

export function moveWidget(w: Workspace, from: SlotId, to: SlotId): Workspace {
  if (from === to) return w;
  return withActiveSlots(w, (s) => ({ ...s, [to]: s[from], [from]: s[to] }));
}

/**
 * Place `widget` in `slot`; any occupant is displaced (becomes unplaced). If the
 * widget already sits in another slot on this page, that slot is cleared (a move,
 * so a page never shows the same widget twice).
 */
export function placeWidget(w: Workspace, slot: SlotId, widget: WidgetId): Workspace {
  return withActiveSlots(w, (s) => {
    const next = { ...s };
    for (const k of SLOTS) if (next[k] === widget) next[k] = null;
    next[slot] = widget;
    return next;
  });
}

export function removeWidget(w: Workspace, slot: SlotId): Workspace {
  return withActiveSlots(w, (s) => ({ ...s, [slot]: null }));
}

export function unplacedIds(w: Workspace, knownIds: readonly WidgetId[]): WidgetId[] {
  const placed = new Set(SLOTS.map((k) => activeSlots(w)[k]).filter(Boolean));
  return knownIds.filter((id) => !placed.has(id));
}

export function addPage(w: Workspace, id: string, name: string, slots: PageSlots = emptySlots()): Workspace {
  return { ...w, pages: [...w.pages, makePage(id, name, slots)] };
}
export function renamePage(w: Workspace, id: string, name: string): Workspace {
  return { ...w, pages: w.pages.map((p) => (p.id === id ? { ...p, name } : p)) };
}
export function removePage(w: Workspace, id: string): Workspace {
  if (w.pages.length <= 1) return w; // never zero pages
  const pages = w.pages.filter((p) => p.id !== id);
  const activePageId = w.activePageId === id ? pages[0]!.id : w.activePageId;
  return { ...w, pages, activePageId };
}
export function setActivePage(w: Workspace, id: string): Workspace {
  return w.pages.some((p) => p.id === id) ? { ...w, activePageId: id } : w;
}

/** Keep only slot keys with a known widget id; everything else becomes null. */
function sanitizeSlots(raw: unknown, knownIds: readonly WidgetId[]): PageSlots {
  const out = emptySlots();
  if (raw && typeof raw === "object") {
    for (const k of SLOTS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && knownIds.includes(v)) out[k] = v;
    }
  }
  return out;
}

/**
 * Resolve the stored workspace: a valid v5 blob → sanitized; else a legacy v4
 * flat layout → wrapped as a single "Main" page; else the default workspace.
 * Never throws; never loses a valid arrangement.
 */
export function migrate(
  rawNew: unknown,
  rawOldLayout: unknown,
  knownIds: readonly WidgetId[],
  defaultSlots: PageSlots,
): Workspace {
  const nw = rawNew as Partial<Workspace> | null;
  if (nw && typeof nw === "object" && Array.isArray(nw.pages) && nw.pages.length > 0) {
    const pages = nw.pages.map((p, i) => makePage(
      typeof p?.id === "string" ? p.id : `p${i}`,
      typeof p?.name === "string" ? p.name : `Page ${i + 1}`,
      sanitizeSlots(p?.slots, knownIds),
    ));
    const activePageId = pages.some((p) => p.id === nw.activePageId) ? nw.activePageId! : pages[0]!.id;
    return { version: 5, activePageId, pages };
  }
  if (rawOldLayout && typeof rawOldLayout === "object") {
    return defaultWorkspace(sanitizeSlots(rawOldLayout, knownIds));
  }
  return defaultWorkspace(defaultSlots);
}
