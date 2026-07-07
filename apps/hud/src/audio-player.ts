/**
 * The HUD's single voice output. One physical voice, no backlog:
 *
 * - **Announcements** (result auto-announce, spoken notifications) play only if
 *   the floor is free (`announceIfIdle`). If something is already speaking, the
 *   new one is NOT queued — it surfaces as an unheard card the user can click to
 *   hear. Audio is linear and un-skippable, so a deep queue is worse UX than
 *   letting the user pull what they want from the cards.
 * - **On-demand** (`speakNow`, the "Speak this record" button / card) interrupts
 *   whatever is playing and speaks immediately.
 * - **Barge-in** (`stopSpeaking`) cuts the current clip — when the user starts
 *   talking, the OS yields the floor.
 *
 * Subscribers observe real play/ended/error transitions, so the "speaking"
 * indicator tracks actual audio rather than a guessed timer.
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

/** Detach handlers and stop an element without triggering its end callbacks. */
function teardown(audio: HTMLAudioElement): void {
  audio.onended = audio.onerror = null;
  audio.pause();
  audio.src = "";
}

function start(url: string): void {
  const audio = new Audio(url);
  current = audio;
  const done = () => {
    if (current !== audio) return; // already replaced/stopped — ignore stale event
    current = null;
    emit(false);
  };
  audio.onended = done;
  audio.onerror = () => {
    console.warn("[voice] audio playback failed:", audio.error?.message ?? "unknown");
    done();
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
      done();
    });
}

/**
 * Play an OS announcement only if nothing is speaking. Returns whether it
 * started — a `false` means the caller should surface it as an unheard card
 * instead of forcing it through the one voice.
 */
export function announceIfIdle(url: string): boolean {
  if (current) return false;
  start(url);
  return true;
}

/**
 * On-demand playback (Speak button / card): interrupt whatever is playing and
 * speak this now.
 */
export function speakNow(url: string): void {
  if (current) {
    teardown(current);
    current = null;
  }
  start(url);
}

/** Stop the current clip (barge-in / take the floor). */
export function stopSpeaking(): void {
  if (current) {
    teardown(current);
    current = null;
  }
  emit(false);
}
