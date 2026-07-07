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
