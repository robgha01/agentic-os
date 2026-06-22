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
    private readonly mode: "text" | "voice",
    private readonly tts: TtsProvider,
  ) {}

  async say(text: string): Promise<void> {
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
            });
            return;
          }
        }
      } catch {
        // fall through to text
      }
    }
    // text mode, or voice unavailable -> graceful text fallback
    this.bus.emit({ type: "speech", at: now(), text, mode: "text" });
  }
}

/** Speaks the OS's user-facing notifications (info/warn — not internal errors). */
export class SpeechBridge {
  constructor(bus: EventBus, speaker: Speaker) {
    bus.subscribe((e: OsEvent) => {
      if (e.type === "notification" && e.level !== "error") {
        void speaker.say(e.message);
      }
    });
  }
}
