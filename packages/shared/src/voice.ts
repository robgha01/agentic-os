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
