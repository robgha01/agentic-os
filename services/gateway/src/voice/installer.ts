/**
 * kokoro-onnx model-file provisioning — owned by the gateway, NOT the sidecar.
 *
 * Downloading two files from a fixed URL needs no Python, and the gateway is the
 * always-on service, so status/install work even when the voice sidecar isn't
 * running (the sidecar is only needed later, to actually synthesize speech). The
 * gateway writes into the SAME models dir the sidecar reads (same env vars +
 * default), so an installed model is immediately usable once the sidecar starts.
 *
 * The release URL is hardcoded — never sourced from config/request (SSRF guard).
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../../../../config/agentic-os.config.js";

const RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/";

/** Default: <repo>/services/voice/models/<file>, overridable via the same env
 *  vars the Python sidecar honors, so both sides resolve identical paths. */
function assetPath(filename: string, envVar: string): string {
  const override = process.env[envVar];
  if (override) return override;
  return fileURLToPath(new URL(`../../../../services/voice/models/${filename}`, import.meta.url));
}

interface Asset { filename: string; path: string }
function assets(): Asset[] {
  return [
    { filename: "kokoro-v1.0.onnx", path: assetPath("kokoro-v1.0.onnx", "AGENTIC_OS_TTS_KOKORO_ONNX_MODEL") },
    { filename: "voices-v1.0.bin", path: assetPath("voices-v1.0.bin", "AGENTIC_OS_TTS_KOKORO_ONNX_VOICES") },
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export interface TtsInstallStatus {
  provider: string;
  installable: boolean;
  ready: boolean;
  missing: string[];
}

export async function ttsStatus(provider = "kokoro-onnx"): Promise<TtsInstallStatus> {
  if (provider !== "kokoro-onnx") {
    return { provider, installable: false, ready: true, missing: [] };
  }
  const missing: string[] = [];
  for (const a of assets()) if (!(await exists(a.path))) missing.push(a.filename);
  return { provider: "kokoro-onnx", installable: true, ready: missing.length === 0, missing };
}

/** Download any missing assets. Idempotent; each write goes to a .part then is
 *  atomically renamed so an interrupted download never looks complete. */
export async function installTts(
  provider = "kokoro-onnx",
  onProgress?: (msg: string) => void,
): Promise<TtsInstallStatus> {
  if (provider !== "kokoro-onnx") throw new Error("only kokoro-onnx is installable");
  for (const a of assets()) {
    if (await exists(a.path)) {
      onProgress?.(`${a.filename}: already present`);
      continue;
    }
    await mkdir(dirname(a.path), { recursive: true });
    onProgress?.(`${a.filename}: downloading…`);
    const res = await fetch(RELEASE + a.filename, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download ${a.filename} failed (${res.status})`);
    const tmp = `${a.path}.part`;
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmp));
    await rename(tmp, a.path);
    onProgress?.(`${a.filename}: done`);
  }
  return ttsStatus(provider);
}

// --- misaki G2P (a Python package) — MUST run in the sidecar's own interpreter,
// so unlike the model files these proxy to the sidecar rather than acting locally.

export interface MisakiStatus {
  installed: boolean;
  error?: string;
}

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
