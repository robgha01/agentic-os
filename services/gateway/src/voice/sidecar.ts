/**
 * Voice sidecar lifecycle — spawn/track/kill the long-lived Python server. Unlike
 * run-process.ts (run-to-completion) this keeps the child alive and holds a ref
 * so it can be stopped. Start is idempotent (skips if /health is already up) and
 * stop only kills a child WE spawned — an externally-run sidecar is left alone.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sidecarHealth } from "./installer.js";

export interface SidecarActionResult {
  online: boolean;
  started?: boolean;
  stopped?: boolean;
  note?: string;
  error?: string;
}

const voiceDir = () => fileURLToPath(new URL("../../../../services/voice/", import.meta.url));

/** The venv python if the user created one, else null (they must set it up first). */
export function sidecarPython(): string | null {
  const dir = voiceDir();
  const candidates =
    process.platform === "win32"
      ? [`${dir}.venv\\Scripts\\python.exe`, `${dir}venv\\Scripts\\python.exe`]
      : [`${dir}.venv/bin/python`, `${dir}venv/bin/python`];
  return candidates.find((p) => existsSync(p)) ?? null;
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
  const py = sidecarPython();
  if (!py) return { online: false, error: "no venv found in services/voice — run the setup command first" };
  try {
    child = spawn(py, ["server.py"], { cwd: voiceDir(), stdio: "ignore", shell: false });
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
