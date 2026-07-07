/**
 * TTS provider descriptors — the declarative source of truth for how each
 * text-to-speech engine appears in the HUD's Voice settings. Adding a provider
 * = one entry here (+ its class in the Python sidecar's tts.py). The gateway
 * stays engine-agnostic; only the HUD reads these for provider-specific UI.
 */
export const TTS_PROVIDER_IDS = ["kokoro", "kokoro-onnx", "openai", "elevenlabs"] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

export interface TtsProviderCapability {
  id: TtsProviderId;
  label: string; // human name for the dropdown/badge
  kind: "local" | "cloud"; // local = no key; cloud = key in sidecar env
  keyEnv?: string; // cloud only: the env var the sidecar reads the key from
  installable?: boolean; // has downloadable assets → readiness + Download button
  voiceLabel: string; // engines name voices differently
  voicePlaceholder?: string;
}

export const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderCapability> = {
  kokoro: { id: "kokoro", label: "Kokoro (torch)", kind: "local", voiceLabel: "Voice", voicePlaceholder: "af_heart" },
  "kokoro-onnx": { id: "kokoro-onnx", label: "Kokoro (ONNX)", kind: "local", installable: true, voiceLabel: "Voice", voicePlaceholder: "af_heart" },
  openai: { id: "openai", label: "OpenAI", kind: "cloud", keyEnv: "OPENAI_API_KEY", voiceLabel: "Voice", voicePlaceholder: "alloy" },
  elevenlabs: { id: "elevenlabs", label: "ElevenLabs", kind: "cloud", keyEnv: "ELEVENLABS_API_KEY", voiceLabel: "Voice ID", voicePlaceholder: "Rachel" },
};

/** Look up a descriptor, tolerating unknown ids from a newer gateway. */
export function ttsProvider(id: string): TtsProviderCapability | undefined {
  return (TTS_PROVIDERS as Record<string, TtsProviderCapability>)[id];
}

// --- Guided setup: compose the minimal pip install for a chosen engine set ----

export const STT_PROVIDER_IDS = ["faster-whisper", "openai", "none"] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

export interface VoiceEngineChoice {
  tts: TtsProviderId;
  stt: SttProviderId;
}

/** The sidecar server itself — always needed regardless of engine choice. */
const SIDECAR_BASE = ["fastapi", "uvicorn[standard]", "python-multipart", "soundfile", "numpy"];
const TTS_DEPS: Record<TtsProviderId, string[]> = {
  kokoro: ["kokoro>=0.9"],
  "kokoro-onnx": ["kokoro-onnx", "onnxruntime"],
  openai: ["openai"],
  elevenlabs: ["elevenlabs"],
};
const STT_DEPS: Record<SttProviderId, string[]> = {
  "faster-whisper": ["faster-whisper"],
  openai: ["openai"],
  none: [],
};

/** Minimal pip package set for a given engine choice (deduped, base first). */
export function voiceSetupPackages(c: VoiceEngineChoice): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...SIDECAR_BASE, ...TTS_DEPS[c.tts], ...STT_DEPS[c.stt]]) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export type VoiceInstallTool = "pip" | "uv";

/** The install command for a choice, using pip (default) or uv (`uv pip install`).
 *  The package set is identical — only the front-end tool differs. */
export function voiceSetupCommand(c: VoiceEngineChoice, tool: VoiceInstallTool = "pip"): string {
  const pkgs = voiceSetupPackages(c).join(" ");
  return tool === "uv" ? `uv pip install ${pkgs}` : `pip install ${pkgs}`;
}
