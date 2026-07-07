import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSpeaking, onSpeakingChange, speak, stopSpeaking } from "../src/audio-player.js";

/** Minimal stand-in for the DOM Audio element (the node test env has none). */
class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: { message: string } | null = null;
  src = "";
  paused = false;
  constructor(public url?: string) {
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

// play() resolves in a microtask, so emit(true) is deferred — let it settle.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeAudio.instances = [];
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
  stopSpeaking();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  stopSpeaking();
  vi.restoreAllMocks();
});

describe("audio-player — single voice channel", () => {
  it("marks speaking once playback starts", async () => {
    expect(isSpeaking()).toBe(false);
    speak("a.wav");
    await flush();
    expect(isSpeaking()).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("replaces the current clip instead of stacking a second voice", async () => {
    speak("a.wav");
    await flush();
    speak("b.wav");
    await flush();
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[0].paused).toBe(true); // the first was cut off
    expect(FakeAudio.instances[1].paused).toBe(false); // only the newest plays
    expect(isSpeaking()).toBe(true);
  });

  it("clears speaking exactly when the clip ends (no phantom waveform)", async () => {
    speak("a.wav");
    await flush();
    expect(isSpeaking()).toBe(true);
    FakeAudio.instances[0].onended?.();
    expect(isSpeaking()).toBe(false);
  });

  it("stopSpeaking interrupts immediately (barge-in)", async () => {
    speak("a.wav");
    await flush();
    stopSpeaking();
    expect(isSpeaking()).toBe(false);
    expect(FakeAudio.instances[0].paused).toBe(true);
  });

  it("notifies subscribers of both transitions", async () => {
    const seen: boolean[] = [];
    const off = onSpeakingChange((p) => seen.push(p));
    speak("a.wav");
    await flush();
    FakeAudio.instances[0].onended?.();
    off();
    expect(seen).toEqual([true, false]);
  });
});
