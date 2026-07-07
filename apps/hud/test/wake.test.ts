import { describe, expect, it } from "vitest";
import { matchWake, resolveWakeProvider } from "../src/wake.js";

describe("matchWake", () => {
  it("routes the command after the wake phrase (one shot)", () => {
    expect(matchWake("Hey Jarvis, what's the weather?", "hey jarvis")).toBe("what's the weather?");
  });
  it("returns empty string when the wake word is spoken alone (arm next)", () => {
    expect(matchWake("Hey Jarvis.", "hey jarvis")).toBe("");
  });
  it("ignores utterances that don't start with the wake phrase", () => {
    expect(matchWake("what's the weather", "hey jarvis")).toBeNull();
  });
  it("is case- and punctuation-tolerant on the trigger", () => {
    expect(matchWake("HEY, JARVIS! open the vault", "hey jarvis")).toBe("open the vault");
  });
  it("supports a custom multi-word phrase", () => {
    expect(matchWake("okay aurora dim the lights", "okay aurora")).toBe("dim the lights");
  });
  it("preserves the command's original casing", () => {
    expect(matchWake("hey jarvis Open Notes", "hey jarvis")).toBe("Open Notes");
  });
});

describe("resolveWakeProvider", () => {
  const none = { openwakeword: false, porcupine: false };

  it("falls back to stt when nothing else is available (auto)", () => {
    expect(resolveWakeProvider("auto", none, false)).toBe("stt");
    expect(resolveWakeProvider("auto", none, true)).toBe("stt");
  });
  it("honors an explicit choice when available", () => {
    expect(resolveWakeProvider("openwakeword", { openwakeword: true, porcupine: false })).toBe("openwakeword");
  });
  it("falls back to stt when an explicit choice is unavailable", () => {
    expect(resolveWakeProvider("porcupine", none)).toBe("stt");
  });
  it("auto prefers openWakeWord on desktop", () => {
    expect(resolveWakeProvider("auto", { openwakeword: true, porcupine: true }, false)).toBe("openwakeword");
  });
  it("auto prefers Porcupine on mobile", () => {
    expect(resolveWakeProvider("auto", { openwakeword: true, porcupine: true }, true)).toBe("porcupine");
  });
});
