import { describe, it, expect } from "vitest";
import {
  TTS_PROVIDER_IDS,
  TTS_PROVIDERS,
  ttsProvider,
  voiceSetupCommand,
  voiceSetupPackages,
} from "../src/voice.js";

describe("tts provider descriptors", () => {
  it("every id has a descriptor whose id matches its key", () => {
    for (const id of TTS_PROVIDER_IDS) {
      expect(TTS_PROVIDERS[id].id).toBe(id);
    }
    expect(Object.keys(TTS_PROVIDERS).sort()).toEqual([...TTS_PROVIDER_IDS].sort());
  });
  it("only kokoro-onnx is installable; cloud providers declare a keyEnv", () => {
    expect(TTS_PROVIDERS["kokoro-onnx"].installable).toBe(true);
    expect(TTS_PROVIDERS["kokoro"].installable).toBeFalsy();
    expect(TTS_PROVIDERS["openai"].keyEnv).toBe("OPENAI_API_KEY");
    expect(TTS_PROVIDERS["elevenlabs"].kind).toBe("cloud");
  });
  it("ttsProvider returns undefined for an unknown id (forward-compat)", () => {
    expect(ttsProvider("nope")).toBeUndefined();
    expect(ttsProvider("kokoro")?.kind).toBe("local");
  });
});

describe("voice setup command", () => {
  it("kokoro-onnx TTS, no STT → onnx deps, NO torch/whisper", () => {
    const pkgs = voiceSetupPackages({ tts: "kokoro-onnx", stt: "none" });
    expect(pkgs).toEqual(expect.arrayContaining(["fastapi", "kokoro-onnx", "onnxruntime"]));
    expect(pkgs).not.toContain("kokoro>=0.9");
    expect(pkgs).not.toContain("faster-whisper");
  });
  it("torch kokoro + whisper → the heavy set", () => {
    const pkgs = voiceSetupPackages({ tts: "kokoro", stt: "faster-whisper" });
    expect(pkgs).toEqual(expect.arrayContaining(["kokoro>=0.9", "faster-whisper"]));
  });
  it("command is a single deduped pip line", () => {
    const cmd = voiceSetupCommand({ tts: "openai", stt: "openai" });
    expect(cmd.startsWith("pip install ")).toBe(true);
    expect(cmd.match(/\bopenai\b/g)?.length).toBe(1); // deduped across TTS+STT
  });
});
