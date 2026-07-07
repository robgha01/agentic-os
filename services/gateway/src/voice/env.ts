/**
 * Python environment discovery for the voice sidecar — tooling-agnostic.
 *
 * Not everyone uses a venv (pyenv, uv, conda, or plain system Python are all
 * common), so we resolve the interpreter in order: an explicit `voice.pythonPath`
 * (any tool) → a project venv (which `uv venv` also creates) → a PATH python
 * (pyenv shims, conda-activated, system). We also report whether `uv` is around
 * so the UI can offer `uv pip install`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../../../config/agentic-os.config.js";

export const voiceDir = (): string => fileURLToPath(new URL("../../../../services/voice/", import.meta.url));

/** A bare command name (not an absolute path) needs the shell on Windows to
 *  resolve .exe / pyenv-win / py shims; an absolute path must NOT use the shell
 *  (spaces would break the unquoted shell string). */
export const useShell = (cmd: string): boolean => process.platform === "win32" && !isAbsolute(cmd);

export function venvPython(): string | null {
  const dir = voiceDir();
  const candidates =
    process.platform === "win32"
      ? [`${dir}.venv\\Scripts\\python.exe`, `${dir}venv\\Scripts\\python.exe`]
      : [`${dir}.venv/bin/python`, `${dir}venv/bin/python`];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function pathPython(): string | null {
  const names = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const n of names) {
    try {
      if (spawnSync(n, ["--version"], { stdio: "ignore", shell: true }).status === 0) return n;
    } catch {
      /* try next */
    }
  }
  return null;
}

export type PythonSource = "config" | "venv" | "path" | "none";

export interface PythonEnv {
  python: string | null; // resolved interpreter (absolute path or bare command)
  source: PythonSource;
  version: string | null; // e.g. "Python 3.12.3"
  uv: boolean; // `uv` available on PATH
  venv: boolean; // a project venv exists in services/voice
}

/** Resolve the interpreter to run/spawn: config → venv → PATH. */
export function resolvePython(): { python: string | null; source: PythonSource } {
  const configured = config.voice.pythonPath?.trim();
  if (configured) return { python: configured, source: "config" };
  const venv = venvPython();
  if (venv) return { python: venv, source: "venv" };
  const onPath = pathPython();
  if (onPath) return { python: onPath, source: "path" };
  return { python: null, source: "none" };
}

function versionOf(python: string): string | null {
  try {
    const r = spawnSync(python, ["--version"], { encoding: "utf8", shell: useShell(python) });
    if (r.status === 0) return (r.stdout || r.stderr || "").trim() || null;
  } catch {
    /* ignore */
  }
  return null;
}

function uvAvailable(): boolean {
  try {
    return spawnSync("uv", ["--version"], { stdio: "ignore", shell: true }).status === 0;
  } catch {
    return false;
  }
}

/** Full snapshot for the setup panel. */
export function detectEnv(): PythonEnv {
  const { python, source } = resolvePython();
  return {
    python,
    source,
    version: python ? versionOf(python) : null,
    uv: uvAvailable(),
    venv: venvPython() !== null,
  };
}
