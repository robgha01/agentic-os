import { describe, expect, it } from "vitest";
import { isStale } from "../src/memory/vault-adapter.js";

const T0 = Date.parse("2026-07-07T10:00:00Z");

describe("isStale", () => {
  it("is fresh inside the window", () => {
    expect(isStale("2026-07-07T09:30:00Z", 60, T0)).toBe(false);
  });
  it("is stale past the window", () => {
    expect(isStale("2026-07-07T08:00:00Z", 60, T0)).toBe(true);
  });
  it("never goes stale without a window", () => {
    expect(isStale("2000-01-01T00:00:00Z", undefined, T0)).toBe(false);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(isStale("not-a-date", 60, T0)).toBe(true);
  });
});
