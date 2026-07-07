/**
 * Hands-free voice capture with energy-based voice-activity detection — Web
 * Audio only, no extra deps. Opens the mic and records each spoken utterance:
 * a clip starts when your voice rises above the noise floor and ends after a
 * short trailing silence, handing the finished clip to `onUtterance`. Keeps
 * listening until `stop()`.
 *
 * `shouldCapture` gates new clips (default always) — the caller passes
 * `() => !isSpeaking()` so the OS's own TTS coming out the speakers doesn't get
 * recorded and routed back as a command (echo/feedback guard).
 */
export interface HandsFreeHandle {
  stop: () => void;
}

export interface HandsFreeOpts {
  onUtterance: (blob: Blob) => void;
  /** listening = mic open; speaking = an utterance is currently being recorded. */
  onState?: (listening: boolean, speaking: boolean) => void;
  /** Return false to suppress capturing right now (e.g. while the OS is talking). */
  shouldCapture?: () => boolean;
}

const THRESHOLD = 0.015; // RMS energy floor for "voice" (0..1)
const START_FRAMES = 3; // consecutive loud ticks before a clip begins
const SILENCE_MS = 800; // trailing quiet that ends an utterance
const TICK_MS = 50;

export async function startHandsFree(opts: HandsFreeOpts): Promise<HandsFreeHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let voiceFrames = 0;
  let silenceStart = 0;
  let stopped = false;

  const rms = (): number => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    return Math.sqrt(sum / buf.length);
  };

  const beginClip = () => {
    chunks = [];
    const rec = new MediaRecorder(stream);
    recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.start();
    opts.onState?.(true, true);
  };

  const endClip = () => {
    const rec = recorder;
    recorder = null;
    silenceStart = 0;
    opts.onState?.(true, false);
    if (!rec) return;
    rec.onstop = () => {
      if (chunks.length) opts.onUtterance(new Blob(chunks, { type: rec.mimeType || chunks[0]!.type }));
    };
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  };

  const timer = window.setInterval(() => {
    if (stopped) return;
    const level = rms();
    const now = performance.now();
    if (level > THRESHOLD && (opts.shouldCapture?.() ?? true)) {
      voiceFrames++;
      silenceStart = 0;
      if (!recorder && voiceFrames >= START_FRAMES) beginClip();
    } else {
      voiceFrames = 0;
      if (recorder) {
        if (silenceStart === 0) silenceStart = now;
        else if (now - silenceStart > SILENCE_MS) endClip();
      }
    }
  }, TICK_MS);

  opts.onState?.(true, false);

  return {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      if (recorder) {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
        recorder = null;
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      opts.onState?.(false, false);
    },
  };
}
