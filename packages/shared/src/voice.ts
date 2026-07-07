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

// --- Wake-word providers -----------------------------------------------------

export const WAKE_PROVIDER_IDS = ["auto", "stt", "openwakeword", "porcupine"] as const;
export type WakeProviderId = (typeof WAKE_PROVIDER_IDS)[number];

export interface WakeProviderDescriptor {
  id: WakeProviderId;
  label: string;
  /** Where the engine runs — informs the device-aware `auto` policy. */
  kind: "auto" | "sidecar" | "browser";
  /** No setup: ships with the sidecar / resolves automatically. */
  bundled: boolean;
  /** pip package(s) to install into the sidecar, if any. */
  install?: string;
  /** Secret key required, if any (e.g. Picovoice access key). */
  keyName?: string;
  /** One-line human setup note (shown in Options). */
  setup: string;
  /** Implemented today, or a reserved slot for a future engine. */
  available: boolean;
}

/** Descriptor per wake engine — drives the Options setup hints/instructions, so
 *  a new engine adds no conditionals in the UI. STT is bundled (no setup); the
 *  others declare their install command or key requirement. */
export const WAKE_PROVIDERS: Record<WakeProviderId, WakeProviderDescriptor> = {
  auto: {
    id: "auto",
    label: "Auto (best available)",
    kind: "auto",
    bundled: true,
    setup: "Picks the best engine for your device — openWakeWord/Porcupine when set up, STT-based otherwise.",
    available: true,
  },
  stt: {
    id: "stt",
    label: "STT-based (any phrase)",
    kind: "sidecar",
    bundled: true,
    setup: "No setup — reuses the sidecar's speech-to-text, so any wake phrase works.",
    available: true,
  },
  openwakeword: {
    id: "openwakeword",
    label: "openWakeWord (local)",
    kind: "sidecar",
    bundled: false,
    install: "pip install openwakeword",
    setup: "Local wake model in the sidecar — fixed phrase set (hey jarvis, hey mycroft, hey rhasspy, alexa). Engine coming soon.",
    available: false,
  },
  porcupine: {
    id: "porcupine",
    label: "Porcupine (browser)",
    kind: "browser",
    bundled: false,
    keyName: "picovoice.accessKey",
    setup: "Runs in the browser — best on phones / in a crowd. Needs a free Picovoice access key. Engine coming soon.",
    available: false,
  },
};

export function wakeProvider(id: string): WakeProviderDescriptor | undefined {
  return WAKE_PROVIDERS[id as WakeProviderId];
}
