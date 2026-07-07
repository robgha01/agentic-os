import { describe, expect, it } from "vitest";
import { parseClientCommand, parseOsEvent } from "../src/events.js";

describe("parseClientCommand", () => {
  it("accepts a valid route command", () => {
    expect(parseClientCommand({ type: "route", input: "hello" })).toEqual({ type: "route", input: "hello" });
  });
  it("accepts invoke with optional params", () => {
    expect(parseClientCommand({ type: "invoke", skillId: "ai-wire" })).toEqual({ type: "invoke", skillId: "ai-wire" });
  });
  it("rejects an unknown type", () => {
    expect(parseClientCommand({ type: "drop-tables" })).toBeNull();
  });
  it("rejects a route command missing input", () => {
    expect(parseClientCommand({ type: "route" })).toBeNull();
  });
  it("rejects non-objects", () => {
    expect(parseClientCommand("route")).toBeNull();
  });
});

describe("parseOsEvent", () => {
  it("accepts operation.completed with a result", () => {
    const e = {
      type: "operation.completed", at: "2026-07-07T10:00:00Z", opId: "1", exitCode: 0,
      result: { path: "10-research/x.md", title: "X", type: "research" },
    };
    expect(parseOsEvent(e)).toEqual(e);
  });
  it("accepts a notification", () => {
    const e = { type: "notification", at: "2026-07-07T10:00:00Z", level: "info", message: "hi" };
    expect(parseOsEvent(e)).toEqual(e);
  });
  it("rejects a wrong-shaped event", () => {
    expect(parseOsEvent({ type: "operation.completed", at: "x" })).toBeNull();
  });
  it("rejects junk", () => {
    expect(parseOsEvent(42)).toBeNull();
  });
  it("tolerates provider ids it doesn't know (forward compatibility)", () => {
    const e = {
      type: "operation.started", at: "2026-07-07T10:00:00Z",
      op: { opId: "1", actionId: "a", skillId: null, selection: { provider: "some-future-provider", model: "m", reason: "r" } },
    };
    expect(parseOsEvent(e)).toEqual(e);
  });
});
