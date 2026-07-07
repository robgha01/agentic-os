/**
 * Speaker — the OS's mouth. `say(text)` always emits a `speech` event carrying
 * the text (the "spoken-as-text" content). In voice mode it also tries to
 * synthesize audio via the TTS provider; if that's unavailable or fails, it
 * silently falls back to a text-mode speech event. Voice is purely additive.
 *
 * SpeechBridge turns the OS's user-facing notifications into spoken output so
 * that, even in text mode, typing yields a spoken-as-text reply.
 */
import type { OsEvent } from "@aos/shared";
import { EventBus, now } from "../bus/event-bus.js";
import type { TtsProvider } from "./tts-provider.js";

export class Speaker {
  constructor(
    private readonly bus: EventBus,
    private mode: "text" | "voice",
    private tts: TtsProvider,
  ) {}

  /** Apply a config change in place (no restart). */
  reconfigure(mode: "text" | "voice", tts: TtsProvider): void {
    this.mode = mode;
    this.tts = tts;
  }

  /**
   * `onDemand` marks user-initiated playback (the Speak button) so the HUD
   * plays it immediately; `path` names the source record so the HUD can mark
   * its card unheard when it skips an announcement (voice already busy).
   */
  async say(text: string, opts: { onDemand?: boolean; path?: string; quiet?: boolean } = {}): Promise<void> {
    // `quiet` = best-effort speech (a bonus to some other action, e.g. opening a
    // card): still try to play, but don't nag when audio is unavailable.
    const nag = opts.onDemand && !opts.quiet;
    if (this.mode === "voice") {
      try {
        if (await this.tts.available()) {
          const synth = await this.tts.synthesize(text);
          if (synth) {
            this.bus.emit({
              type: "speech",
              at: now(),
              text,
              mode: "voice",
              audioUrl: synth.audioUrl,
              provider: synth.provider,
              onDemand: opts.onDemand,
              path: opts.path,
            });
            return;
          }
        }
        // voice mode but the sidecar/engine couldn't produce audio
        if (nag) this.note("Couldn't synthesize speech — is the voice sidecar running? Showing text.");
      } catch {
        if (nag) this.note("Voice synthesis errored — showing text.");
      }
    } else if (nag) {
      // The user explicitly asked to hear this, but voice output is off.
      this.note("Voice output is off (text mode) — turn on Voice output in Audio I/O to hear results.");
    }
    // text mode, or voice unavailable -> graceful text fallback
    this.bus.emit({ type: "speech", at: now(), text, mode: "text", onDemand: opts.onDemand, path: opts.path });
  }

  private note(message: string): void {
    // `speak: false` so this reason isn't itself spoken (there's no audio anyway).
    this.bus.emit({ type: "notification", at: now(), level: "info", message, speak: false });
  }
}

/** Speaks the OS's user-facing notifications (info/warn — not internal errors). */
export class SpeechBridge {
  constructor(bus: EventBus, speaker: Speaker) {
    bus.subscribe((e: OsEvent) => {
      // Speak user-facing notices, unless one opts out (speak: false) — e.g. the
      // "served from cache" notice, which the result auto-announce already covers.
      if (e.type === "notification" && e.level !== "error" && e.speak !== false) {
        void speaker.say(e.message);
      }
    });
  }
}
