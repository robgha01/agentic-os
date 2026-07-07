import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceIfIdle, isSpeaking, onSpeakingChange, speakNow, stopSpeaking } from "../src/audio-player.js";

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
  /** Simulate the clip finishing on its own. */
  end(): void {
    this.onended?.();
  }
}

// play() resolves in a microtask, so emit(true) is deferred — let it settle.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const at = (i: number) => FakeAudio.instances[i];

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

describe("audio-player — announce if idle (no queue)", () => {
  it("plays an announcement when the voice is free", async () => {
    expect(announceIfIdle("a.wav")).toBe(true);
    await flush();
    expect(isSpeaking()).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("skips (returns false) when something is already speaking — never queues", async () => {
    announceIfIdle("a.wav");
    await flush();
    expect(announceIfIdle("b.wav")).toBe(false); // caller surfaces an unheard card instead
    await flush();
    expect(FakeAudio.instances).toHaveLength(1); // b never played
  });

  it("frees up once the clip ends, so the next announcement can speak", async () => {
    announceIfIdle("a.wav");
    await flush();
    at(0).end();
    expect(isSpeaking()).toBe(false);
    expect(announceIfIdle("b.wav")).toBe(true);
    await flush();
    expect(at(1).url).toBe("b.wav");
  });
});

describe("audio-player — on-demand (Speak) and barge-in", () => {
  it("speakNow interrupts a playing announcement", async () => {
    announceIfIdle("a.wav");
    await flush();
    speakNow("d.wav");
    await flush();
    expect(at(0).paused).toBe(true); // announcement cut off
    expect(at(1).url).toBe("d.wav");
    expect(at(1).paused).toBe(false);
    expect(isSpeaking()).toBe(true);
  });

  it("spamming Speak never stacks a second voice", async () => {
    speakNow("d1.wav");
    await flush();
    speakNow("d2.wav");
    await flush();
    expect(at(0).paused).toBe(true);
    expect(at(1).paused).toBe(false);
    expect(FakeAudio.instances).toHaveLength(2);
  });

  it("stopSpeaking cuts the current clip (barge-in)", async () => {
    announceIfIdle("a.wav");
    await flush();
    stopSpeaking();
    expect(isSpeaking()).toBe(false);
    expect(at(0).paused).toBe(true);
  });

  it("notifies subscribers of both transitions", async () => {
    const seen: boolean[] = [];
    const off = onSpeakingChange((p) => seen.push(p));
    announceIfIdle("a.wav");
    await flush();
    at(0).end();
    off();
    expect(seen).toEqual([true, false]);
  });
});
