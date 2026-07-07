/**
 * The HUD's single voice channel. The OS has one mouth: `speak()` stops whatever
 * is already playing before starting the next clip, so repeated "Speak" clicks
 * and overlapping announcements never stack into a chorus. Subscribers observe
 * real playback transitions (play → ended/error/stop), so the "speaking"
 * indicator tracks actual audio instead of a guessed timer.
 */
type Listener = (playing: boolean) => void;

let current: HTMLAudioElement | null = null;
let playing = false;
const listeners = new Set<Listener>();

function emit(next: boolean): void {
  if (next === playing) return;
  playing = next;
  for (const l of listeners) l(playing);
}

/** Whether a clip is playing right now. */
export function isSpeaking(): boolean {
  return playing;
}

/** Subscribe to playing/stopped transitions; returns an unsubscribe. */
export function onSpeakingChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stop any current playback immediately (barge-in / interrupt / replace). */
export function stopSpeaking(): void {
  const audio = current;
  current = null;
  if (audio) {
    audio.onended = audio.onerror = null;
    audio.pause();
    audio.src = "";
  }
  emit(false);
}

/** Play `url` as the single active voice, replacing anything already playing. */
export function speak(url: string): void {
  stopSpeaking();
  const audio = new Audio(url);
  current = audio;
  const clear = () => {
    if (current === audio) {
      current = null;
      emit(false);
    }
  };
  audio.onended = clear;
  audio.onerror = () => {
    console.warn("[voice] audio playback failed:", audio.error?.message ?? "unknown");
    clear();
  };
  audio
    .play()
    .then(() => {
      if (current === audio) emit(true);
    })
    .catch((err) => {
      // Autoplay may be blocked until the first user gesture — surface it, and
      // don't leave a phantom "speaking" state behind.
      console.warn("[voice] audio playback blocked:", err?.message ?? err);
      clear();
    });
}
