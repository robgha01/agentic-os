/**
 * Voice sidecar lifecycle — spawn/track/kill the long-lived Python server. Unlike
 * run-process.ts (run-to-completion) this keeps the child alive and holds a ref
 * so it can be stopped. Start is idempotent (skips if /health is already up) and
 * stop only kills a child WE spawned — an externally-run sidecar is left alone.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { config } from "../../../../config/agentic-os.config.js";
import { sidecarHealth } from "./installer.js";
import { resolvePython, useShell, voiceDir } from "./env.js";

/**
 * The child env for a gateway-started sidecar. Critically, this bridges the
 * gateway's voice config (what the user picked in the HUD) into the sidecar's
 * OWN env vars — the sidecar selects its TTS/STT engine from env at startup, so
 * without this it silently loads its default (`kokoro`) instead of, say, the
 * `kokoro-onnx` the user chose, and synthesis fails against the wrong engine.
 */
function sidecarEnv(): NodeJS.ProcessEnv {
  const v = config.voice;
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    // Watchdog: self-exit if the gateway dies ungracefully (SIGKILL/crash).
    AGENTIC_OS_PARENT_PID: String(process.pid),
    AGENTIC_OS_TTS_PROVIDER: v.tts.provider,
    AGENTIC_OS_STT_PROVIDER: v.stt.provider,
    AGENTIC_OS_VOICE_PORT: String(config.ports.voice),
  };
  if (v.tts.voice) e.AGENTIC_OS_TTS_VOICE = v.tts.voice;
  if (v.tts.apiKeyEnv) e.AGENTIC_OS_TTS_API_KEY_ENV = v.tts.apiKeyEnv;
  if (v.stt.model) e.AGENTIC_OS_STT_MODEL = v.stt.model;
  if (v.stt.apiKeyEnv) e.AGENTIC_OS_STT_API_KEY_ENV = v.stt.apiKeyEnv;
  return e;
}

export interface SidecarActionResult {
  online: boolean;
  started?: boolean;
  stopped?: boolean;
  note?: string;
  error?: string;
}

let child: ChildProcess | null = null;

async function waitOnline(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await sidecarHealth()).online) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function startSidecar(): Promise<SidecarActionResult> {
  if ((await sidecarHealth()).online) return { online: true, started: false, note: "already running" };
  const { python } = resolvePython();
  if (!python) {
    return { online: false, error: "no Python found — set voice.pythonPath (pyenv/uv/conda) or create a venv in services/voice" };
  }
  try {
    child = spawn(python, ["server.py"], {
      cwd: voiceDir(),
      stdio: "ignore",
      shell: useShell(python),
      env: sidecarEnv(),
    });
    child.on("exit", () => {
      child = null;
    });
  } catch (e) {
    return { online: false, error: `spawn failed: ${String(e)}` };
  }
  const online = await waitOnline(20_000);
  return online
    ? { online: true, started: true }
    : { online: false, error: "sidecar spawned but did not become healthy (check its deps / log)" };
}

/** Kill the tree (Windows taskkill /T, else SIGKILL) — same shape as run-process. */
function killTree(c: ChildProcess): void {
  if (process.platform === "win32" && c.pid) {
    spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => c.kill("SIGKILL"));
  } else {
    c.kill("SIGKILL");
  }
}

export async function stopSidecar(): Promise<SidecarActionResult> {
  if (!child) {
    const online = (await sidecarHealth()).online;
    return {
      online,
      stopped: false,
      note: online
        ? "running but not started by the gateway — stop it where you launched it"
        : "not running",
    };
  }
  killTree(child);
  child = null;
  return { online: false, stopped: true };
}

/** Best-effort kill on gateway shutdown so we don't orphan the sidecar. */
export function stopSidecarChild(): void {
  if (child) killTree(child);
  child = null;
}
