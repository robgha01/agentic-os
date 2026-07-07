/**
 * HTTP client for the running Python voice sidecar — the gateway's calls that
 * cross the wire to :7788. Kept separate from installer.ts (gateway-local model
 * downloads) and sidecar.ts (process lifecycle): this module is purely "talk to
 * the sidecar over HTTP". Everything here degrades gracefully when the sidecar
 * is absent — the gateway stays up and falls back to text.
 */
import { config } from "../../../../config/agentic-os.config.js";

const sidecar = () => config.voice.sidecarUrl;

export interface SidecarHealth {
  online: boolean;
  tts?: string;
  stt?: string;
}

/** Is the Python voice sidecar reachable? Reports its configured engines too. */
export async function sidecarHealth(): Promise<SidecarHealth> {
  try {
    const res = await fetch(`${sidecar()}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { online: false };
    const d = (await res.json()) as { tts?: string; stt?: string };
    return { online: true, tts: d.tts, stt: d.stt };
  } catch {
    return { online: false };
  }
}

/**
 * Forward a mic recording to the sidecar's /stt and return the transcript. The
 * sidecar decodes (ffmpeg → WAV) and runs the configured STT engine. `mime` is
 * the browser's recording type so we can name the part with a matching ext.
 */
export async function transcribeAudio(audio: Buffer, mime?: string): Promise<{ text: string }> {
  const ext = mime?.includes("wav") ? "wav" : mime?.includes("ogg") ? "ogg" : mime?.includes("mp4") ? "mp4" : "webm";
  const form = new FormData();
  form.append("audio", new Blob([audio], { type: mime || "application/octet-stream" }), `clip.${ext}`);
  const res = await fetch(`${sidecar()}/stt`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error((await res.text()) || `sidecar /stt ${res.status}`);
  return (await res.json()) as { text: string };
}

export interface MisakiStatus {
  installed: boolean;
  error?: string;
}

/** misaki G2P status — the package lives in the sidecar's own interpreter. */
export async function misakiStatus(): Promise<MisakiStatus> {
  const res = await fetch(`${sidecar()}/deps/misaki/status`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`sidecar status ${res.status}`);
  return (await res.json()) as MisakiStatus;
}

/** Long-running: pip-installs misaki into the sidecar's venv. 10-min ceiling. */
export async function installMisaki(): Promise<MisakiStatus & { ok?: boolean; log?: string[] }> {
  const res = await fetch(`${sidecar()}/deps/misaki/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error((await res.text()) || `sidecar install ${res.status}`);
  return (await res.json()) as MisakiStatus & { ok?: boolean; log?: string[] };
}
