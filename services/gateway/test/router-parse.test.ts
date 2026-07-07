import { describe, expect, it } from "vitest";
import { extractJsonObject, parseIntentJson, toRouterDecision } from "../src/routing/semantic/parse.js";

describe("extractJsonObject", () => {
  it("returns a clean object unchanged", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("pulls the object out of surrounding prose", () => {
    expect(extractJsonObject('Sure! Here is the intent:\n{"action":"sync"}\nHope that helps.')).toBe(
      '{"action":"sync"}',
    );
  });

  it("pulls the object out of a markdown code fence", () => {
    const fenced = '```json\n{"action":"rundown","confidence":0.9}\n```';
    expect(extractJsonObject(fenced)).toBe('{"action":"rundown","confidence":0.9}');
  });

  it("ignores braces inside string values", () => {
    expect(extractJsonObject('{"reasoning":"use the { char }"}')).toBe('{"reasoning":"use the { char }"}');
  });

  it("handles nested objects", () => {
    expect(extractJsonObject('noise {"parameters":{"topic":"cats"}} tail')).toBe(
      '{"parameters":{"topic":"cats"}}',
    );
  });

  it("returns null when there's no complete object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject('{"unterminated":')).toBeNull();
  });
});

describe("parseIntentJson", () => {
  it("parses prose-wrapped and fenced JSON that a bare JSON.parse would reject", () => {
    expect(parseIntentJson('Here you go:\n{"action":"schedule"}')).toEqual({ action: "schedule" });
    expect(parseIntentJson('```json\n{"action":"unknown"}\n```')).toEqual({ action: "unknown" });
  });

  it("returns null on genuinely unparseable text", () => {
    expect(parseIntentJson("totally not json")).toBeNull();
  });
});

describe("toRouterDecision", () => {
  it("normalizes a full intent", () => {
    expect(
      toRouterDecision({ action: "last-30-days", confidence: 0.8, parameters: { topic: "cats" }, reasoning: "r" }),
    ).toEqual({ actionId: "last-30-days", confidence: 0.8, parameters: { topic: "cats" }, reasoning: "r" });
  });

  it("fills defaults for missing/invalid fields", () => {
    expect(toRouterDecision({})).toEqual({
      actionId: "unknown",
      confidence: 0.5,
      parameters: {},
      reasoning: undefined,
    });
  });
});
