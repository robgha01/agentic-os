# HUD UX Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three HUD UX improvements — cap the notification orbit at 4 with an overflow tray, make the side panels drag-resizable, and refactor the layout into a page-aware "workspace" model that ships a swap-tray palette now and makes multi-page tabs a purely additive change later.

**Architecture:** Frontend only (`apps/hud`), no gateway/shared changes. The load-bearing move is a new pure `workspace.ts` model (registry-free, fully unit-tested) that `layout.ts` wraps with the widget registry + localStorage. The orbit cap and panel resize are independent view/state changes. A single implicit page renders today; the tab-bar UI (final task) is optional and additive.

**Tech Stack:** React 18 + TypeScript (strict ESM, `.js` import suffixes), Vite, vitest (node env — new `apps/hud/test/` suite for the pure helpers), CSS in `apps/hud/src/styles.css`.

## Global Constraints

- Branch: all work on `feat/hud-ux-enhancements` (already created); commit per task; do NOT push or merge unless asked.
- Commit trailer (project CLAUDE.md): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Verify before claiming a task done: `npm test`, `npm run typecheck -w @aos/hud`, and `npm run build -w @aos/hud` all pass.
- Imports between `.ts`/`.tsx` sources use the `.js` suffix (existing idiom). Match the surrounding comment density/style.
- No gateway or `@aos/shared` edits. No new runtime dependencies.
- Mobile breakpoint is `@media (max-width: 900px)` (the stage collapses to one column there) — panel resize must be inert below it.
- The particle-`Core` sphere must never be crushed: panel widths clamp per-panel AND against the viewport so the center keeps a minimum width.
- `_contract.ts` imports `SlotId` from `./layout.js` — that export MUST be preserved (re-export from `workspace.ts`).

## Design decisions (locked in discussion)

- **Failures stay as regular cards** (already red-styled) — no separate "dot" visual language, no auto-expiry. The orbit shows the 4 newest of ANY type; the rest live in the overflow tray.
- **Page-aware model ships now, single page shown.** A workspace holds `pages: Page[]`; today only one implicit "Main" page renders. Tabs (Task 6) are optional and additive — no storage migration when added.
- **Swap tray**: a persistent dock of benched widgets, each draggable onto any slot (occupied → swap; the displaced widget returns to the tray). The existing empty-slot "+ add widget" menu stays for discoverability.

---

### Task 1: HUD test harness for pure helpers

**Files:**
- Modify: `vitest.config.ts` (add `apps/hud/test` to `include`)
- Create: `apps/hud/test/smoke.test.ts` (proves the harness runs)

**Interfaces:**
- Produces: `npm test` now also runs `apps/hud/test/**/*.test.ts` in the node environment. Later tasks add `workspace.test.ts` and `panel-size.test.ts` here.

- [ ] **Step 1: Add the HUD test glob** — in `vitest.config.ts`, extend `include`:

```ts
    include: [
      "services/gateway/test/**/*.test.ts",
      "packages/shared/test/**/*.test.ts",
      "config/test/**/*.test.ts",
      "apps/hud/test/**/*.test.ts",
    ],
```

- [ ] **Step 2: Write the smoke test** — `apps/hud/test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("hud test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run it** — `npm test`
Expected: the existing 44 tests plus this 1 all pass (45 total).

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts apps/hud/test/smoke.test.ts
git commit -m "test(hud): add apps/hud/test to the vitest suite"
```

---

### Task 2: Cap the notification orbit at 4 + overflow tray (Q1)

**Files:**
- Modify: `apps/hud/src/useGateway.ts:91` (`MAX_CARDS` 8 → 24 — retain more so overflow is meaningful; nothing else changes)
- Modify: `apps/hud/src/components/ContextCards.tsx` (render 4 in corners, collapse the rest)
- Modify: `apps/hud/src/styles.css` (overflow pill + tray styles)

**Interfaces:**
- Consumes: `hud.taskCards` (newest-first `TaskCardView[]`), `hud.dismissCard`, `hud.clearCards` (unchanged).
- Produces: view-only change; no exported API.

- [ ] **Step 1: Raise the retained-card cap** — `useGateway.ts:91`:

```ts
const MAX_CARDS = 24;
```

(The orbit still shows only 4; the rest are reachable via the tray. 24 keeps the persisted set bounded.)

- [ ] **Step 2: Split visible vs overflow in `ContextCards.tsx`.** Replace the render body (the `return` starting at the current line 137) and drop the now-unused `STACK_GAP` constant and the `stack`/`offset`/`down` per-card math. The measured connector logic stays but iterates only the visible 4. New component body:

```tsx
const VISIBLE = 4;

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

  // (measure() unchanged EXCEPT it loops `visible` instead of `cards`)
  const measure = useCallback(() => {
    const orbit = orbitRef.current;
    const core = orbit?.parentElement?.querySelector<HTMLElement>(".core");
    if (!orbit || !core) return;
    const o = orbit.getBoundingClientRect();
    const c = core.getBoundingClientRect();
    const cx = c.left + c.width / 2 - o.left;
    const cy = c.top + c.height / 2 - o.top;
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
      const hit = boxEntry(sx, sy, px, py, rx0, ry0, rx0 + r.width, ry0 + r.height) ?? { x: px, y: py };
      next.push({ id: card.id, x1: sx, y1: sy, x2: hit.x, y2: hit.y });
    }
    setSize({ w: o.width, h: o.height });
    setLinks(next);
  }, [visible]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

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
```

- [ ] **Step 3: Simplify `Card` (drop the `style`/stacking prop) and add `TrayRow`.** Replace the existing `Card` signature/usage — it no longer takes `style`:

```tsx
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
```

Update the import at the top of the file — remove `type CSSProperties` (no longer used), keep `useState`:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
```

- [ ] **Step 4: Styles** — in `styles.css`, replace the single `.orbit__clear` positioning with a controls row and add tray styles (put next to the existing `.orbit__clear` block ~line 259):

```css
.orbit__controls {
  position: absolute; top: -34px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 8px; align-items: center; white-space: nowrap;
}
.orbit__more, .orbit__clear {
  font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em;
  color: var(--mute); background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 999px; padding: 4px 12px; cursor: pointer;
}
.orbit__more:hover, .orbit__clear:hover { color: var(--ink); border-color: var(--magenta); }
.orbit__more--on { color: var(--ink); border-color: var(--magenta); }
.orbit__tray {
  position: absolute; top: 4px; left: 50%; transform: translateX(-50%);
  width: min(280px, 80%); max-height: 220px; overflow-y: auto; z-index: 4;
  display: flex; flex-direction: column; gap: 4px; padding: 8px;
  background: color-mix(in srgb, var(--panel-2) 92%, transparent);
  border: 1px solid var(--line); border-radius: 8px; backdrop-filter: blur(6px);
}
.otray__row { display: flex; align-items: center; gap: 6px; }
.otray__body {
  flex: 1; text-align: left; cursor: pointer; background: none; border: none; padding: 4px 6px; border-radius: 5px;
}
.otray__body:hover:not(:disabled) { background: rgba(255, 61, 154, 0.1); }
.otray__body:disabled { cursor: default; }
.otray__label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink); }
.otray__sub { display: block; font-size: 10px; color: var(--mute); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.otray__row[data-status="failed"] .otray__label { color: var(--danger); }
.otray__x { background: none; border: none; color: var(--mute); cursor: pointer; font-size: 10px; padding: 3px; }
.otray__x:hover { color: var(--danger); }
```

(The old `.orbit__clear { position: absolute; top: -34px; ... }` block's positioning is now provided by `.orbit__controls`; delete the `position/top/left/transform` lines from the old `.orbit__clear` rule but keep its font/color — or just replace the whole `.orbit__clear` rule with the shared one above.)

- [ ] **Step 5: Verify** — `npm run build -w @aos/hud && npm run typecheck -w @aos/hud` (green), then a browser check (claude-in-chrome per project CLAUDE.md): start gateway + HUD, invoke 6+ skills (or resend to accumulate cards), confirm exactly 4 cards orbit the ball cleanly, a "+N more" pill appears, and opening the tray lists the rest with working open/dismiss.

- [ ] **Step 6: Commit**

```bash
git add apps/hud/src/useGateway.ts apps/hud/src/components/ContextCards.tsx apps/hud/src/styles.css
git commit -m "feat(hud): cap the notification orbit at 4 with a +N overflow tray"
```

---

### Task 3: Page-aware workspace model (pure) + registry facade (Q3 base)

**Files:**
- Create: `apps/hud/src/workspace.ts` (pure model — no registry, no localStorage)
- Create: `apps/hud/test/workspace.test.ts`
- Modify: `apps/hud/src/layout.ts` (becomes the registry+storage facade over `workspace.ts`)

**Interfaces:**
- Produces (from `workspace.ts`):
  ```ts
  type SlotId = "left-top" | "left-mid" | "left-bottom" | "right-top" | "right-mid" | "right-bottom";
  const SLOTS: SlotId[];
  type PageSlots = Record<SlotId, WidgetId | null>;   // WidgetId = string
  interface Page { id: string; name: string; slots: PageSlots }
  interface Workspace { version: 5; activePageId: string; pages: Page[] }
  function emptySlots(): PageSlots
  function makePage(id: string, name: string, slots?: PageSlots): Page
  function defaultWorkspace(defaultSlots: PageSlots): Workspace
  function activePage(w: Workspace): Page
  function activeSlots(w: Workspace): PageSlots
  function moveWidget(w: Workspace, from: SlotId, to: SlotId): Workspace
  function placeWidget(w: Workspace, slot: SlotId, widget: WidgetId): Workspace
  function removeWidget(w: Workspace, slot: SlotId): Workspace
  function unplacedIds(w: Workspace, knownIds: readonly WidgetId[]): WidgetId[]
  function addPage(w: Workspace, id: string, name: string, slots?: PageSlots): Workspace
  function renamePage(w: Workspace, id: string, name: string): Workspace
  function removePage(w: Workspace, id: string): Workspace   // no-op if it'd leave 0 pages
  function setActivePage(w: Workspace, id: string): Workspace
  function migrate(rawNew: unknown, rawOldLayout: unknown, knownIds: readonly WidgetId[], defaultSlots: PageSlots): Workspace
  ```
- Produces (from `layout.ts`, registry-bound): `SlotId`, `SLOTS`, `PageSlots`, `Page`, `Workspace`, `DEFAULT_PAGE_SLOTS`, `loadWorkspace()`, `saveWorkspace(w)`, and re-exports of the pure mutators + `activeSlots`, `unplacedWidgets(w)` (registry-bound wrapper over `unplacedIds`).

- [ ] **Step 1: Write the failing tests** — `apps/hud/test/workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  activeSlots, addPage, defaultWorkspace, emptySlots, migrate, moveWidget,
  placeWidget, removePage, removeWidget, setActivePage, unplacedIds,
  type PageSlots, type Workspace,
} from "../src/workspace.js";

const IDS = ["a", "b", "c", "d"] as const;
const withA: PageSlots = { ...emptySlots(), "left-top": "a" };
const ws = (): Workspace => defaultWorkspace(withA);

describe("workspace core", () => {
  it("defaultWorkspace has one active page with the given slots", () => {
    const w = ws();
    expect(w.pages).toHaveLength(1);
    expect(w.activePageId).toBe(w.pages[0]!.id);
    expect(activeSlots(w)["left-top"]).toBe("a");
  });

  it("moveWidget swaps two slots on the active page", () => {
    const w = placeWidget(ws(), "right-top", "b");
    const moved = moveWidget(w, "left-top", "right-top");
    expect(activeSlots(moved)["left-top"]).toBe("b");
    expect(activeSlots(moved)["right-top"]).toBe("a");
  });

  it("placeWidget into an occupied slot displaces the occupant (which becomes unplaced)", () => {
    const w = placeWidget(ws(), "left-top", "b"); // b replaces a
    expect(activeSlots(w)["left-top"]).toBe("b");
    expect(unplacedIds(w, IDS)).toContain("a");
  });

  it("removeWidget empties a slot", () => {
    expect(activeSlots(removeWidget(ws(), "left-top"))["left-top"]).toBeNull();
  });

  it("unplacedIds returns known ids not on the active page", () => {
    expect(unplacedIds(ws(), IDS).sort()).toEqual(["b", "c", "d"]);
  });
});

describe("workspace pages (future-proofing)", () => {
  it("addPage appends and can be activated; slots are per-page", () => {
    let w = addPage(ws(), "p2", "Ops");
    w = setActivePage(w, "p2");
    expect(activeSlots(w)["left-top"]).toBeNull(); // fresh page
    expect(w.pages).toHaveLength(2);
  });

  it("removePage never leaves zero pages", () => {
    const only = ws();
    expect(removePage(only, only.pages[0]!.id).pages).toHaveLength(1);
  });

  it("removePage re-points activePageId when the active page is removed", () => {
    let w = addPage(ws(), "p2", "Ops");
    w = setActivePage(w, "p2");
    const after = removePage(w, "p2");
    expect(after.pages.some((p) => p.id === after.activePageId)).toBe(true);
    expect(after.activePageId).not.toBe("p2");
  });
});

describe("migrate", () => {
  it("wraps a legacy v4 flat layout into a single Main page", () => {
    const legacy = { "left-top": "a", "right-top": "zzz-unknown" };
    const w = migrate(null, legacy, IDS, emptySlots());
    expect(w.pages).toHaveLength(1);
    expect(activeSlots(w)["left-top"]).toBe("a");
    expect(activeSlots(w)["right-top"]).toBeNull(); // unknown id dropped
  });

  it("loads a valid v5 workspace and drops unknown widget ids", () => {
    const saved: Workspace = {
      version: 5, activePageId: "p1",
      pages: [{ id: "p1", name: "Main", slots: { ...emptySlots(), "left-top": "a", "left-mid": "gone" } }],
    };
    const w = migrate(saved, null, IDS, emptySlots());
    expect(activeSlots(w)["left-top"]).toBe("a");
    expect(activeSlots(w)["left-mid"]).toBeNull();
  });

  it("falls back to a default workspace when both sources are empty", () => {
    const w = migrate(null, null, IDS, withA);
    expect(activeSlots(w)["left-top"]).toBe("a");
  });

  it("repairs a workspace whose activePageId points nowhere", () => {
    const broken = { version: 5, activePageId: "ghost", pages: [{ id: "p1", name: "Main", slots: emptySlots() }] };
    const w = migrate(broken, null, IDS, emptySlots());
    expect(w.activePageId).toBe("p1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- workspace` → cannot resolve `../src/workspace.js`.

- [ ] **Step 3: Implement `apps/hud/src/workspace.ts`:**

```ts
/**
 * Page-aware workspace model — the HUD's layout data structure, kept PURE (no
 * widget registry, no localStorage) so it is fully unit-testable and so adding
 * multi-page tabs later is additive. A Workspace holds one or more Pages; each
 * Page is the familiar six-slot grid. `layout.ts` wires this to the registry +
 * localStorage; only ONE page is surfaced in the UI today.
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

/** Place `widget` in `slot`; any occupant is displaced (becomes unplaced). If the
 *  widget already sits in another slot on this page, that slot is cleared (a move). */
export function placeWidget(w: Workspace, slot: SlotId, widget: WidgetId): Workspace {
  return withActiveSlots(w, (s) => {
    const next = { ...s };
    for (const k of SLOTS) if (next[k] === widget) next[k] = null; // no dupes on a page
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

/** Drop widget ids no longer in the registry from a page's slots. */
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
 */
export function migrate(
  rawNew: unknown,
  rawOldLayout: unknown,
  knownIds: readonly WidgetId[],
  defaultSlots: PageSlots,
): Workspace {
  // v5
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
  // legacy v4 flat layout
  if (rawOldLayout && typeof rawOldLayout === "object") {
    return defaultWorkspace(sanitizeSlots(rawOldLayout, knownIds));
  }
  // fresh
  return defaultWorkspace(defaultSlots);
}
```

- [ ] **Step 4: Run tests** — `npm test -- workspace` → all pass.

- [ ] **Step 5: Rewrite `apps/hud/src/layout.ts` as the registry+storage facade.** Replace the whole file:

```ts
/**
 * Layout facade — binds the pure `workspace.ts` model to the widget registry and
 * localStorage. Six slots per page; the default page is derived from each
 * widget's `defaultSlot`. Persists (and migrates the legacy v4 flat layout) so
 * existing users keep their arrangement.
 */
import { ALL_WIDGET_IDS, WIDGETS } from "./widget-registry.js";
import {
  defaultWorkspace, emptySlots, migrate, unplacedIds,
  type PageSlots, type Page, type SlotId, type Workspace, type WidgetId,
} from "./workspace.js";

export type { SlotId, PageSlots, Page, Workspace, WidgetId };
export { SLOTS, activePage, activeSlots, moveWidget, placeWidget, removeWidget, addPage, renamePage, removePage, setActivePage } from "./workspace.js";

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
```

- [ ] **Step 6: Typecheck** — `npm run typecheck -w @aos/hud`. This WILL error in `App.tsx` and `Panel.tsx` (they still use the old `Layout`/`loadLayout`/`saveLayout` API). That's expected — Task 4 rewires them. To keep this task independently green, do the minimal App/Panel adaptation now: see Step 7.

- [ ] **Step 7: Minimal rewire so the build passes (full tray comes in Task 4).** In `App.tsx`, swap the layout wiring to the workspace API but keep behavior identical (single page):

```tsx
import { loadWorkspace, saveWorkspace, moveWidget, placeWidget, removeWidget, activeSlots, unplacedWidgets, type SlotId, type Workspace } from "./layout.js";
import type { WidgetId } from "./widget-registry.js";
```

```tsx
  const [ws, setWs] = useState<Workspace>(() => loadWorkspace());
  const commit = useCallback((next: Workspace) => { saveWorkspace(next); setWs(next); }, []);

  const onMove = useCallback((from: SlotId, to: SlotId) => commit(moveWidget(ws, from, to)), [ws, commit]);
  const onAdd = useCallback((slot: SlotId, widget: WidgetId) => commit(placeWidget(ws, slot, widget)), [ws, commit]);
  const onRemove = useCallback((slot: SlotId) => commit(removeWidget(ws, slot)), [ws, commit]);

  const slots = activeSlots(ws);
  const unplaced = unplacedWidgets(ws);
```

Pass `slots` (a `PageSlots`) to each `<Panel ... layout={slots} ... />` (Panel already indexes `layout[slot]`, so a `PageSlots` is drop-in). Update `Panel.tsx`'s `PanelProps.layout` type from `Layout` to `PageSlots`:

```tsx
import type { PageSlots, SlotId } from "../layout.js";
// ...
  layout: PageSlots;
```

- [ ] **Step 8: Verify** — `npm test && npm run typecheck -w @aos/hud && npm run build -w @aos/hud` all green. Browser check: existing layout still loads, drag-rearrange still works, a previously-saved v4 layout is preserved (migrated).

- [ ] **Step 9: Commit**

```bash
git add apps/hud/src/workspace.ts apps/hud/test/workspace.test.ts apps/hud/src/layout.ts apps/hud/src/App.tsx apps/hud/src/components/Panel.tsx
git commit -m "feat(hud): page-aware workspace model (single page today), migrating the v4 layout"
```

---

### Task 4: Persistent swap-tray palette (Q3-B)

**Files:**
- Create: `apps/hud/src/components/WidgetTray.tsx`
- Modify: `apps/hud/src/App.tsx` (render the tray; pass `onAdd`)
- Modify: `apps/hud/src/components/Panel.tsx` (accept a widget-id drop onto any slot)
- Modify: `apps/hud/src/styles.css` (tray styles)

**Interfaces:**
- Consumes: `unplaced: WidgetId[]`, `onAdd(slot, widget)` (= `placeWidget`), `WIDGETS[id].name`.
- Produces: a dockable tray; drag transfers `dataTransfer.setData("text/widget", id)`.

- [ ] **Step 1: Create `WidgetTray.tsx`:**

```tsx
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
```

- [ ] **Step 2: Accept a widget drop in `Panel.tsx`.** In the slot `onDrop`, handle both a slot-move and a tray widget-place:

```tsx
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const fromSlot = e.dataTransfer.getData("text/slot") as SlotId;
              const widget = e.dataTransfer.getData("text/widget") as WidgetId;
              if (fromSlot) onMove(fromSlot, slot);
              else if (widget) onAdd(slot, widget);
            }}
```

(`onAdd` and `WidgetId` are already in `PanelProps`/imports.)

- [ ] **Step 3: Render the tray in `App.tsx`** — inside the `.dash` div, after `<CommandBar />` (so it floats at the bottom):

```tsx
          <CommandBar hud={hud} />
          <WidgetTray unplaced={unplaced} />
```

Add the import: `import { WidgetTray } from "./components/WidgetTray.js";`

- [ ] **Step 4: Styles** — append to `styles.css`:

```css
.wtray { position: absolute; left: 12px; bottom: 64px; z-index: 5; font-family: var(--mono); }
.wtray__toggle {
  font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--mute);
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer;
}
.wtray__toggle:hover { color: var(--ink); border-color: var(--magenta); }
.wtray__list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wtray__chip {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink);
  background: color-mix(in srgb, var(--panel-2) 90%, transparent); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 10px; cursor: grab;
}
.wtray__chip:hover { border-color: var(--magenta); }
```

- [ ] **Step 5: Verify** — `npm run build -w @aos/hud && npm run typecheck -w @aos/hud`, then browser check: with all 6 slots full, open the tray, drag a benched widget onto an occupied slot → it swaps in and the old one appears in the tray. Empty-slot "+ add widget" menu still works.

- [ ] **Step 6: Commit**

```bash
git add apps/hud/src/components/WidgetTray.tsx apps/hud/src/App.tsx apps/hud/src/components/Panel.tsx apps/hud/src/styles.css
git commit -m "feat(hud): persistent swap-tray palette — drag a benched widget onto any slot"
```

---

### Task 5: Horizontal drag-resize of the side panels (Q2)

**Files:**
- Create: `apps/hud/src/panel-size.ts` (pure clamp + persistence)
- Create: `apps/hud/test/panel-size.test.ts`
- Create: `apps/hud/src/components/PanelResizer.tsx`
- Modify: `apps/hud/src/App.tsx` (widths state, CSS vars, resizers)
- Modify: `apps/hud/src/styles.css` (grid uses vars; resizer handle; disable < 900px)

**Interfaces:**
- Produces:
  ```ts
  interface PanelWidths { left: number; right: number }
  const MIN_PANEL = 220, MAX_PANEL = 520, CENTER_MIN = 360;
  const DEFAULT_WIDTHS: PanelWidths;
  function clampPanel(px: number): number;
  function clampAgainstViewport(px: number, otherPanelPx: number, viewportPx: number): number;
  function loadPanelWidths(): PanelWidths;
  function savePanelWidths(w: PanelWidths): void;
  ```

- [ ] **Step 1: Write the failing tests** — `apps/hud/test/panel-size.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampAgainstViewport, clampPanel, MAX_PANEL, MIN_PANEL } from "../src/panel-size.js";

describe("clampPanel", () => {
  it("clamps below the minimum", () => expect(clampPanel(50)).toBe(MIN_PANEL));
  it("clamps above the maximum", () => expect(clampPanel(9999)).toBe(MAX_PANEL));
  it("passes a value in range", () => expect(clampPanel(320)).toBe(320));
});

describe("clampAgainstViewport", () => {
  it("keeps the center at least CENTER_MIN wide", () => {
    // viewport 1000, other panel 300, center min 360 → this panel ≤ 340
    expect(clampAgainstViewport(500, 300, 1000)).toBe(340);
  });
  it("still honors the per-panel min", () => {
    expect(clampAgainstViewport(50, 300, 1000)).toBe(MIN_PANEL);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- panel-size` → module not found.

- [ ] **Step 3: Implement `apps/hud/src/panel-size.ts`:**

```ts
/**
 * Side-panel widths — pure clamp helpers + localStorage persistence. The center
 * (the particle Core) must never be crushed, so a panel is clamped per-panel AND
 * against the viewport so `CENTER_MIN` px always remain for the stage's middle.
 */
export interface PanelWidths { left: number; right: number }

export const MIN_PANEL = 220;
export const MAX_PANEL = 520;
export const CENTER_MIN = 360;
export const DEFAULT_WIDTHS: PanelWidths = { left: 300, right: 340 };

export function clampPanel(px: number): number {
  return Math.max(MIN_PANEL, Math.min(MAX_PANEL, Math.round(px)));
}

/** Clamp a panel so the center keeps CENTER_MIN given the other panel + viewport. */
export function clampAgainstViewport(px: number, otherPanelPx: number, viewportPx: number): number {
  const maxForCenter = viewportPx - otherPanelPx - CENTER_MIN;
  return Math.max(MIN_PANEL, Math.min(clampPanel(px), maxForCenter));
}

const KEY = "aos.hud.panelWidths.v1";

export function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WIDTHS };
    const p = JSON.parse(raw) as Partial<PanelWidths>;
    return {
      left: clampPanel(typeof p.left === "number" ? p.left : DEFAULT_WIDTHS.left),
      right: clampPanel(typeof p.right === "number" ? p.right : DEFAULT_WIDTHS.right),
    };
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

export function savePanelWidths(w: PanelWidths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
```

- [ ] **Step 4: Run tests** — `npm test -- panel-size` → pass.

- [ ] **Step 5: Create `PanelResizer.tsx`** — a thin drag handle that reports pixel deltas:

```tsx
/**
 * A vertical drag handle between a side panel and the center stage. Reports the
 * live pointer x while dragging; the parent clamps it into a panel width. Inert
 * on touch/keyboard-only and below the mobile breakpoint (the parent hides it).
 */
import { useCallback, useRef } from "react";

export function PanelResizer({ side, onResize }: { side: "left" | "right"; onResize: (clientX: number) => void }) {
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) onResize(e.clientX);
  }, [onResize]);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      className={`resizer resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
```

- [ ] **Step 6: Wire widths + resizers into `App.tsx`.** Add imports:

```tsx
import { clampAgainstViewport, loadPanelWidths, savePanelWidths, type PanelWidths } from "./panel-size.js";
import { PanelResizer } from "./components/PanelResizer.js";
```

State + handlers:

```tsx
  const [widths, setWidths] = useState<PanelWidths>(() => loadPanelWidths());

  const resizeLeft = useCallback((clientX: number) => {
    setWidths((w) => {
      const next = { ...w, left: clampAgainstViewport(clientX, w.right, window.innerWidth) };
      savePanelWidths(next);
      return next;
    });
  }, []);
  const resizeRight = useCallback((clientX: number) => {
    setWidths((w) => {
      const next = { ...w, right: clampAgainstViewport(window.innerWidth - clientX, w.left, window.innerWidth) };
      savePanelWidths(next);
      return next;
    });
  }, []);
```

Drive the grid via CSS custom properties and drop the resizers between panel and center. Replace the `<main className="stage">…</main>` block:

```tsx
          <main
            className="stage"
            style={{ ["--panel-left" as string]: `${widths.left}px`, ["--panel-right" as string]: `${widths.right}px` }}
          >
            <Panel side="left" slots={["left-top", "left-mid", "left-bottom"]} layout={slots} hud={hud} unplaced={unplaced} onMove={onMove} onAdd={onAdd} onRemove={onRemove} />
            <PanelResizer side="left" onResize={resizeLeft} />

            <section className="center">
              {/* unchanged center content */}
            </section>

            <PanelResizer side="right" onResize={resizeRight} />
            <Panel side="right" slots={["right-top", "right-mid", "right-bottom"]} layout={slots} hud={hud} unplaced={unplaced} onMove={onMove} onAdd={onAdd} onRemove={onRemove} />
          </main>
```

- [ ] **Step 7: Styles** — the stage grid now has 5 columns (panel, resizer, center, resizer, panel). Replace `.stage`:

```css
.stage {
  display: grid;
  grid-template-columns: var(--panel-left, 300px) 6px 1fr 6px var(--panel-right, 340px);
  min-height: 0;
}
.resizer { cursor: col-resize; background: transparent; touch-action: none; }
.resizer:hover, .resizer:active { background: color-mix(in srgb, var(--magenta) 40%, transparent); }
```

And in the `@media (max-width: 900px)` block, collapse the resizers + single column:

```css
@media (max-width: 900px) {
  .stage { grid-template-columns: 1fr; grid-auto-rows: min-content; overflow: auto; }
  .resizer { display: none; }
  .panel { grid-template-rows: none; }
  .panel--left, .panel--right { border: none; border-bottom: 1px solid var(--line); }
  .center { min-height: 50vh; }
}
```

- [ ] **Step 8: Verify** — `npm test && npm run typecheck -w @aos/hud && npm run build -w @aos/hud`. Browser check with the `chrome-devtools` MCP if available (real viewport emulation) else `claude-in-chrome`: drag each inner edge — panel resizes, the ball never collapses below the center minimum, width persists across reload, and at ≤900px the handles disappear and the layout stacks.

- [ ] **Step 9: Commit**

```bash
git add apps/hud/src/panel-size.ts apps/hud/test/panel-size.test.ts apps/hud/src/components/PanelResizer.tsx apps/hud/src/App.tsx apps/hud/src/styles.css
git commit -m "feat(hud): drag-resizable side panels with viewport clamp + persistence"
```

---

### Task 6 (OPTIONAL — confirm before building): Tab bar for multiple pages (Q3-C)

Only build this if the user green-lights surfacing multiple dashboard pages now. The model already supports it (Task 3), so this is purely additive UI.

**Files:**
- Create: `apps/hud/src/components/TabBar.tsx`
- Modify: `apps/hud/src/App.tsx` (render the tab bar; page CRUD handlers)
- Modify: `apps/hud/src/styles.css` (tab styles)

**Interfaces:**
- Consumes: `ws.pages`, `ws.activePageId`, and `addPage`/`renamePage`/`removePage`/`setActivePage` from `layout.js`.

- [ ] **Step 1: Create `TabBar.tsx`:**

```tsx
/**
 * Dashboard tabs — switch, add, rename (double-click), and remove pages. Each
 * page is its own six-slot arrangement. A single page hides its own remove
 * control so the workspace always has at least one page.
 */
import { useState } from "react";
import type { Page } from "../layout.js";

export function TabBar({
  pages, activeId, onSelect, onAdd, onRename, onRemove,
}: {
  pages: Page[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="tabs" role="tablist">
      {pages.map((p) => (
        <div key={p.id} className={`tab ${p.id === activeId ? "tab--on" : ""}`}>
          {editing === p.id ? (
            <input
              className="tab__edit"
              autoFocus
              defaultValue={p.name}
              onBlur={(e) => { onRename(p.id, e.target.value.trim() || p.name); setEditing(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          ) : (
            <button className="tab__btn" role="tab" aria-selected={p.id === activeId}
              onClick={() => onSelect(p.id)} onDoubleClick={() => setEditing(p.id)}>
              {p.name}
            </button>
          )}
          {pages.length > 1 ? (
            <button className="tab__x" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`}>✕</button>
          ) : null}
        </div>
      ))}
      <button className="tab__add" onClick={onAdd} aria-label="Add page">＋</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `App.tsx`.** Import `addPage, renamePage, removePage, setActivePage` from `./layout.js` and `TabBar`. Page id generation uses the browser crypto:

```tsx
  const onSelectPage = useCallback((id: string) => commit(setActivePage(ws, id)), [ws, commit]);
  const onAddPage = useCallback(() => commit(addPage(ws, crypto.randomUUID(), `Page ${ws.pages.length + 1}`)), [ws, commit]);
  const onRenamePage = useCallback((id: string, name: string) => commit(renamePage(ws, id, name)), [ws, commit]);
  const onRemovePage = useCallback((id: string) => commit(removePage(ws, id)), [ws, commit]);
```

Render `<TabBar pages={ws.pages} activeId={ws.activePageId} onSelect={onSelectPage} onAdd={onAddPage} onRename={onRenamePage} onRemove={onRemovePage} />` just inside the `.dash` div, above `<main className="stage">`. Adjust `.dash` grid to add a tab row: `grid-template-rows: auto 1fr 56px;`.

- [ ] **Step 3: Styles** — append tab styles (match the existing chip idiom):

```css
.tabs { display: flex; align-items: center; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--line); }
.tab { display: flex; align-items: center; }
.tab__btn, .tab__add {
  font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em;
  color: var(--mute); background: none; border: 1px solid transparent; border-radius: 6px; padding: 4px 10px; cursor: pointer;
}
.tab--on .tab__btn { color: var(--ink); border-color: var(--line); background: var(--panel-2); }
.tab__btn:hover, .tab__add:hover { color: var(--ink); }
.tab__x { background: none; border: none; color: var(--mute); cursor: pointer; font-size: 9px; padding: 2px 4px; }
.tab__x:hover { color: var(--danger); }
.tab__edit { font-family: var(--mono); font-size: 10px; width: 90px; background: var(--void); color: var(--ink); border: 1px solid var(--magenta); border-radius: 6px; padding: 3px 8px; }
```

- [ ] **Step 4: Verify** — `npm test && npm run typecheck -w @aos/hud && npm run build -w @aos/hud`. Browser: add a page, arrange different widgets on it, switch tabs (each keeps its own layout + widths are shared), rename via double-click, remove a page (the last one can't be removed), reload → pages persist.

- [ ] **Step 5: Commit**

```bash
git add apps/hud/src/components/TabBar.tsx apps/hud/src/App.tsx apps/hud/src/styles.css
git commit -m "feat(hud): dashboard tabs — multiple named pages over the workspace model"
```

---

## Final verification (after the chosen tasks)

- [ ] `npm test` — full suite green (gateway + shared + config + HUD).
- [ ] `npm run typecheck -w @aos/hud` and `npm run build -w @aos/hud` — green.
- [ ] Browser smoke: orbit caps at 4 with a working tray; panels resize + persist and never crush the ball; swap tray moves benched widgets in/out; a pre-existing v4 layout survived the migration.
- [ ] `git log --oneline main..HEAD` — one self-contained commit per task.

## Self-review notes

- **Spec coverage:** Q1 → Task 2; Q2 → Task 5; Q3 base/model → Task 3; Q3 swap tray → Task 4; Q3 tabs (future-proof, optional) → Task 6. Test harness → Task 1.
- **Migration safety:** `migrate()` never throws and never loses a valid arrangement (v5 → sanitized, v4 → wrapped, else default); unknown widget ids are dropped exactly as the old `loadLayout` did.
- **The Core is protected:** `clampAgainstViewport` guarantees `CENTER_MIN` px for the stage middle regardless of panel drags.
- **No gateway/shared churn:** every change is under `apps/hud` plus the one-line vitest include.
