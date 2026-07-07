/** Thin proxy to the Python voice sidecar's TTS status/install endpoints. */
import { config } from "../../../../config/agentic-os.config.js";

export interface TtsInstallStatus {
  provider: string;
  installable: boolean;
  ready: boolean;
  missing: string[];
}

const base = () => config.voice.sidecarUrl;

export async function ttsStatus(provider?: string): Promise<TtsInstallStatus> {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  const res = await fetch(`${base()}/tts/status${q}`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`sidecar status ${res.status}`);
  return (await res.json()) as TtsInstallStatus;
}

/** Long-running: downloads model assets. 10-min ceiling. */
export async function installTts(provider = "kokoro-onnx"): Promise<TtsInstallStatus & { log?: string[] }> {
  const res = await fetch(`${base()}/tts/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error((await res.text()) || `sidecar install ${res.status}`);
  return (await res.json()) as TtsInstallStatus & { log?: string[] };
}
