/**
 * Voice sidecar lifecycle — spawn/track/kill the long-lived Python server. Unlike
 * run-process.ts (run-to-completion) this keeps the child alive and holds a ref
 * so it can be stopped. Start is idempotent (skips if /health is already up) and
 * stop only kills a child WE spawned — an externally-run sidecar is left alone.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { sidecarHealth } from "./installer.js";
import { resolvePython, useShell, voiceDir } from "./env.js";

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
    // Pass our PID so the sidecar's watchdog self-exits if the gateway dies
    // ungracefully (SIGKILL/crash), closing the orphan gap the shutdown hook can't.
    child = spawn(python, ["server.py"], {
      cwd: voiceDir(),
      stdio: "ignore",
      shell: useShell(python),
      env: { ...process.env, AGENTIC_OS_PARENT_PID: String(process.pid) },
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
