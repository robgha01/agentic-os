/**
 * Text-to-speech providers — the hot-swappable synthesis backend.
 *
 * The gateway only knows two: `none` (text mode — no audio) and `sidecar`
 * (delegates to the optional Python voice sidecar, which itself runs local
 * engines like Kokoro or cloud APIs with the user's keys). Keeping all engine/
 * key complexity in the sidecar means the gateway never holds a voice key and
 * degrades to text whenever the sidecar is absent.
 */
import { config } from "../../../../config/agentic-os.config.js";

export interface TtsSynthesis {
  audioUrl: string;
  provider: string;
}

export interface TtsProvider {
  readonly id: string;
  /** Cheap reachability check; false short-circuits to text fallback. */
  available(): Promise<boolean>;
  /** Synthesize audio for `text`, or null if it couldn't. */
  synthesize(text: string): Promise<TtsSynthesis | null>;
}

/** Text mode: no audio, ever. */
export class NoneTtsProvider implements TtsProvider {
  readonly id = "none";
  async available(): Promise<boolean> {
    return false;
  }
  async synthesize(): Promise<null> {
    return null;
  }
}

/** Delegates synthesis to the Python voice sidecar over HTTP. */
export class SidecarTtsProvider implements TtsProvider {
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly voice?: string,
  ) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(800) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async synthesize(text: string): Promise<TtsSynthesis | null> {
    try {
      const res = await fetch(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: this.voice }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { audioUrl?: string };
      return data.audioUrl ? { audioUrl: data.audioUrl, provider: this.id } : null;
    } catch {
      return null;
    }
  }
}

/** Build the TTS provider implied by config: None in text mode, else the sidecar. */
export function createTtsProvider(voiceConfig = config.voice): TtsProvider {
  if (voiceConfig.mode === "text") return new NoneTtsProvider();
  return new SidecarTtsProvider(voiceConfig.tts.provider, voiceConfig.sidecarUrl, voiceConfig.tts.voice);
}
