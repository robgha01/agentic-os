import { describe, it, expect } from "vitest";
import { TTS_PROVIDER_IDS, TTS_PROVIDERS, ttsProvider } from "../src/voice.js";

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
