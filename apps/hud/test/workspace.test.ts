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
