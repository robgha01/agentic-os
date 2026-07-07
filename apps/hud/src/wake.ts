/**
 * Wake-word detection behind a small provider abstraction (mirrors the TTS/STT
 * provider pattern). A concrete engine is resolved from config + availability +
 * device by `resolveWakeProvider`, with STT-based as the universal floor.
 *
 * Only the STT-based engine is implemented today; openWakeWord (sidecar) and
 * Porcupine (browser) are reserved slots — when they land they become new
 * detector functions selected here, with nothing above this module changing.
 */
import { startHandsFree } from "./vad.js";

export type WakeProvider = "stt" | "openwakeword" | "porcupine";

export interface WakeAvailability {
  openwakeword: boolean;
  porcupine: boolean;
}

/** Coarse "is this a phone/tablet" check for the device-aware `auto` policy. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Resolve the configured preference to a concrete, available engine. "auto"
 * prefers the best engine for the device (Porcupine on mobile, openWakeWord on
 * desktop) and always falls back to STT; an explicit choice is honored when
 * available, else also falls back to STT.
 */
export function resolveWakeProvider(
  pref: string,
  avail: WakeAvailability,
  mobile = isMobileDevice(),
): WakeProvider {
  const has = (p: WakeProvider) =>
    p === "stt" || (p === "openwakeword" && avail.openwakeword) || (p === "porcupine" && avail.porcupine);
  if (pref === "stt" || pref === "openwakeword" || pref === "porcupine") {
    return has(pref) ? pref : "stt";
  }
  // auto: device-aware order; first available wins (stt is always available).
  const order: WakeProvider[] = mobile
    ? ["porcupine", "openwakeword", "stt"]
    : ["openwakeword", "porcupine", "stt"];
  return order.find(has) ?? "stt";
}

/**
 * If `transcript` starts with the wake phrase, return the command remainder
 * ("" if the wake word was spoken alone), else null. Case- and
 * punctuation-tolerant; the command's original words are preserved.
 */
export function matchWake(transcript: string, wakeWord: string): string | null {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wake = wakeWord.trim().split(/\s+/).filter(Boolean);
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (wake.length === 0 || words.length < wake.length) return null;
  for (let i = 0; i < wake.length; i++) {
    if (clean(words[i]!) !== clean(wake[i]!)) return null;
  }
  return words.slice(wake.length).join(" ").trim();
}

export type WakeState = "listening" | "capturing" | "thinking";

export interface WakeOpts {
  wakeWord: string;
  transcribe: (blob: Blob) => Promise<{ text: string }>;
  onCommand: (text: string) => void;
  onState?: (state: WakeState) => void;
  /** Echo guard — return false while the OS is speaking so it isn't recorded. */
  isSpeaking: () => boolean;
}

export interface WakeHandle {
  stop: () => void;
}

/**
 * STT-based wake detection: hands-free VAD transcribes each utterance and acts
 * only when it begins with the wake phrase. "Hey Jarvis, what's the weather"
 * routes the remainder in one shot; "Hey Jarvis" alone arms the next utterance
 * as the command. No extra deps; any phrase works.
 */
export async function startSttWake(opts: WakeOpts): Promise<WakeHandle> {
  let armed = false;
  const hf = await startHandsFree({
    shouldCapture: () => !opts.isSpeaking(),
    onState: (_on, speaking) => opts.onState?.(speaking ? "capturing" : "listening"),
    onUtterance: async (blob) => {
      opts.onState?.("thinking");
      let text = "";
      try {
        text = (await opts.transcribe(blob)).text.trim();
      } catch {
        opts.onState?.("listening");
        return;
      }
      if (armed) {
        armed = false;
        if (text) opts.onCommand(text);
      } else {
        const cmd = matchWake(text, opts.wakeWord);
        if (cmd === null) {
          /* not addressed to us — ignore */
        } else if (cmd === "") {
          armed = true; // wake word alone → next utterance is the command
        } else {
          opts.onCommand(cmd);
        }
      }
      opts.onState?.("listening");
    },
  });
  return { stop: () => hf.stop() };
}

/**
 * Start wake detection with the given (already-resolved) engine. Only "stt" is
 * implemented; the others fall through to STT so the app never dead-ends.
 */
export async function startWake(provider: WakeProvider, opts: WakeOpts): Promise<WakeHandle> {
  switch (provider) {
    case "openwakeword":
    case "porcupine":
      // Reserved: fall back to STT until these engines ship.
      return startSttWake(opts);
    case "stt":
    default:
      return startSttWake(opts);
  }
}
