import { describe, expect, it } from "vitest";
import { dedupeRank, splitTags, stripVtt, type ResearchItem } from "../src/skills/research-utils.js";

const item = (url: string, score: number): ResearchItem => ({
  title: url, url, score, author: "a", source: "s",
});

describe("dedupeRank", () => {
  it("keeps the highest-scored duplicate and sorts descending", () => {
    const out = dedupeRank([item("u1", 5), item("u2", 9), item("u1", 7)]);
    expect(out.map((i) => [i.url, i.score])).toEqual([["u2", 9], ["u1", 7]]);
  });
  it("applies the limit after ranking", () => {
    expect(dedupeRank([item("a", 1), item("b", 3), item("c", 2)], 2).map((i) => i.url)).toEqual(["b", "c"]);
  });
});

describe("splitTags", () => {
  it("splits a trailing TAGS line into kebab tags", () => {
    const { body, tags } = splitTags("Insight.\nTAGS: LLM Ops, agents, Model  Routing");
    expect(body).toBe("Insight.");
    expect(tags).toEqual(["llm-ops", "agents", "model-routing"]);
  });
  it("returns the body untouched when no TAGS line exists", () => {
    expect(splitTags("just text")).toEqual({ body: "just text", tags: [] });
  });
  it("caps at 6 tags", () => {
    expect(splitTags("x\nTAGS: a,b,c,d,e,f,g,h").tags).toHaveLength(6);
  });
});

describe("stripVtt", () => {
  it("strips headers, cues, inline tags, and consecutive duplicates", () => {
    const vtt = [
      "WEBVTT", "Kind: captions", "",
      "1", "00:00:00.000 --> 00:00:02.000", "Hello <b>world</b>",
      "2", "00:00:02.000 --> 00:00:04.000", "Hello world", "next line",
    ].join("\n");
    expect(stripVtt(vtt)).toBe("Hello world next line");
  });
});
