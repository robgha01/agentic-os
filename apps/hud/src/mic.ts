/**
 * Push-to-talk mic capture. `startRecording()` opens the mic (prompting for
 * permission once) and records; `stopRecording()` ends the clip and resolves the
 * recorded Blob (or null if nothing was captured or the press was too short to
 * be intentional). One recording at a time; the mic stream is released after
 * each clip so the browser's recording indicator turns off between utterances.
 */
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;

export function isRecording(): boolean {
  return recorder?.state === "recording";
}

export async function startRecording(): Promise<void> {
  if (recorder) return; // already recording
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  const rec = new MediaRecorder(stream);
  recorder = rec;
  startedAt = performance.now();
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start();
}

/** Stop and resolve the recorded clip. Returns null if nothing was captured or
 *  the hold was shorter than `minMs` (an accidental tap, not speech). */
export async function stopRecording(minMs = 300): Promise<Blob | null> {
  const rec = recorder;
  const s = stream;
  recorder = null;
  stream = null;
  const release = () => s?.getTracks().forEach((t) => t.stop());
  if (!rec || rec.state === "inactive") {
    release();
    return null;
  }
  const tooShort = performance.now() - startedAt < minMs;
  const blob = await new Promise<Blob | null>((resolve) => {
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || chunks[0]!.type }) : null);
    try {
      rec.stop();
    } catch {
      resolve(null);
    }
  });
  release();
  return tooShort ? null : blob;
}
