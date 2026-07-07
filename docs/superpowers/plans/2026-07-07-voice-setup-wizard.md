# Guided Voice Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided "Set up voice" panel that, from the chosen engines, shows the exact lean install command, live readiness (sidecar / models / misaki), and one-click actions — including gateway-managed **start/stop of the voice sidecar**.

**Architecture:** Reuse what exists (sidecar health, TTS model download, misaki install — all gateway-proxied). Add (1) a shared, engine-aware pip-command composer, (2) a gateway sidecar **process manager** (spawn-and-track a long-lived child, start/stop with a health poll), and (3) a HUD setup panel. No app-run pip/venv — the user runs one tailored command once; the app handles the rest. That keeps it cross-platform-robust.

**Tech Stack:** TS strict ESM (`@aos/shared`, `@aos/gateway`, `@aos/hud`), zod, React 18, `node:child_process`, vitest.

## Global Constraints

- No app-executed `pip`/`venv` — the wizard *composes and displays* the command; the human runs it. (Auto-pip is explicitly out of scope for this plan.)
- The sidecar child is spawned with `shell:false`, an explicit venv-python path, and `cwd = services/voice`. Kill the whole tree on stop (Windows `taskkill /T`, like `run-process.ts`).
- `start` is idempotent: if `/health` is already online, do not spawn a second process.
- `stop` only kills a child THIS gateway spawned; an externally-started sidecar is reported, not killed.
- Package lists live in one shared place (no duplicated dep strings). Release/command strings are code constants, never from requests.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- `packages/shared/src/voice.ts` — **extend**: `STT_PROVIDER_IDS`, dep sets, `voiceSetupPackages()`, `voiceSetupCommand()`.
- `packages/shared/test/voice.test.ts` — **extend**: command composition cases.
- `services/gateway/src/voice/sidecar.ts` — **new**: `sidecarPython()`, `startSidecar()`, `stopSidecar()`, `stopSidecarChild()` (shutdown hook).
- `services/gateway/src/bus/ws-server.ts` — **modify**: `POST /voice/sidecar/start|stop` (gated, notifications).
- `services/gateway/src/index.ts` (or the gateway entrypoint) — **modify**: kill the sidecar child on gateway shutdown.
- `apps/hud/src/gateway.ts` — **modify**: `SidecarActionResult` + `startSidecar()`/`stopSidecar()`.
- `apps/hud/src/useGateway.ts` — **modify**: expose them.
- `apps/hud/src/components/VoiceSetup.tsx` — **new**: the guided panel.
- `apps/hud/src/components/VoiceOptions.tsx` — **modify**: render `<VoiceSetup/>`, add `none` STT option.
- `apps/hud/src/styles.css` — **modify**: setup-panel styles.
- `services/voice/README.md` — **modify**: guided setup + per-engine deps.

---

### Task 1: Shared engine-aware setup command

**Files:** extend `packages/shared/src/voice.ts`; test in `packages/shared/test/voice.test.ts`.

**Interfaces:**
- Produces: `STT_PROVIDER_IDS` (`["faster-whisper","openai","none"]`), `type SttProviderId`, `interface VoiceEngineChoice { tts: TtsProviderId; stt: SttProviderId }`, `voiceSetupPackages(c): string[]`, `voiceSetupCommand(c): string`.

- [ ] **Step 1: Failing test**

```ts
import { voiceSetupCommand, voiceSetupPackages } from "../src/voice.js";

describe("voice setup command", () => {
  it("kokoro-onnx TTS, no STT → onnx deps, NO torch/whisper", () => {
    const pkgs = voiceSetupPackages({ tts: "kokoro-onnx", stt: "none" });
    expect(pkgs).toEqual(expect.arrayContaining(["fastapi", "kokoro-onnx", "onnxruntime"]));
    expect(pkgs).not.toContain("kokoro>=0.9");
    expect(pkgs).not.toContain("faster-whisper");
  });
  it("torch kokoro + whisper → the heavy set", () => {
    const pkgs = voiceSetupPackages({ tts: "kokoro", stt: "faster-whisper" });
    expect(pkgs).toEqual(expect.arrayContaining(["kokoro>=0.9", "faster-whisper"]));
  });
  it("command is a single deduped pip line", () => {
    const cmd = voiceSetupCommand({ tts: "openai", stt: "openai" });
    expect(cmd.startsWith("pip install ")).toBe(true);
    expect(cmd.match(/\bopenai\b/g)?.length).toBe(1); // deduped across TTS+STT
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** (append to `voice.ts`)

```ts
export const STT_PROVIDER_IDS = ["faster-whisper", "openai", "none"] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

export interface VoiceEngineChoice {
  tts: TtsProviderId;
  stt: SttProviderId;
}

/** Sidecar server itself — always needed. */
const SIDECAR_BASE = ["fastapi", "uvicorn[standard]", "python-multipart", "soundfile", "numpy"];
const TTS_DEPS: Record<TtsProviderId, string[]> = {
  kokoro: ["kokoro>=0.9"],
  "kokoro-onnx": ["kokoro-onnx", "onnxruntime"],
  openai: ["openai"],
  elevenlabs: ["elevenlabs"],
};
const STT_DEPS: Record<SttProviderId, string[]> = {
  "faster-whisper": ["faster-whisper"],
  openai: ["openai"],
  none: [],
};

/** The minimal pip package set for a given engine choice (deduped, base first). */
export function voiceSetupPackages(c: VoiceEngineChoice): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...SIDECAR_BASE, ...TTS_DEPS[c.tts], ...STT_DEPS[c.stt]]) {
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

export function voiceSetupCommand(c: VoiceEngineChoice): string {
  return `pip install ${voiceSetupPackages(c).join(" ")}`;
}
```

- [ ] **Step 4:** run tests → PASS; `npm run typecheck -w @aos/gateway`.
- [ ] **Step 5: Commit** `feat(shared): engine-aware voice setup command composition`.

---

### Task 2: Gateway sidecar process manager

**Files:** create `services/gateway/src/voice/sidecar.ts`; modify `ws-server.ts` + the gateway entrypoint.

**Interfaces:**
- Produces: `interface SidecarActionResult { online: boolean; started?: boolean; stopped?: boolean; note?: string; error?: string }`, `startSidecar()`, `stopSidecar()`, `stopSidecarChild()` (sync-ish, for shutdown).
- Consumes: `sidecarHealth()` from `installer.js`; `config.voice.sidecarUrl`.

- [ ] **Step 1: Implement `sidecar.ts`**

```ts
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
    child.on("exit", () => { child = null; });
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
    return { online, stopped: false, note: online ? "running but not started by the gateway — stop it where you launched it" : "not running" };
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
```

- [ ] **Step 2: Routes in `ws-server.ts`** (after the misaki routes; reuse `json`, `originOk`, `now`, `this.bus`)

```ts
import { startSidecar, stopSidecar } from "../voice/sidecar.js"; // add to the existing voice import group

if (req.method === "POST" && (url.pathname === "/voice/sidecar/start" || url.pathname === "/voice/sidecar/stop")) {
  if (!originOk(req.headers.origin)) return json(res, { ok: false, error: "forbidden origin" }, 403);
  const starting = url.pathname.endsWith("/start");
  void (starting ? startSidecar() : stopSidecar()).then(
    (r) => {
      this.bus.emit({ type: "notification", at: now(), level: r.error ? "error" : "info",
        message: r.error ? `Voice sidecar: ${r.error}` : starting ? (r.online ? "Voice sidecar online." : "Voice sidecar did not start.") : "Voice sidecar stopped." });
      json(res, r);
    },
    (e) => json(res, { online: false, error: String(e) }, 503),
  );
  return;
}
```

- [ ] **Step 3: Shutdown hook** — in the gateway entrypoint (where `GatewayServer` is constructed / signals handled), call `stopSidecarChild()` on `SIGINT`/`SIGTERM`/close so a gateway exit doesn't orphan the sidecar. (Find the existing shutdown path; if none, add `process.once("SIGINT", …)`.)

- [ ] **Step 4: Typecheck** `npm run typecheck -w @aos/gateway` clean.
- [ ] **Step 5: Manual smoke** (best effort — the sidecar venv may not exist here): `curl -X POST localhost:7777/voice/sidecar/start` → with no venv, expect `{online:false,error:"no venv found…"}`. Document this in the completion report if the venv is absent.
- [ ] **Step 6: Commit** `feat(gateway): start/stop the voice sidecar as a managed child`.

---

### Task 3: HUD client + hook wiring

**Files:** `apps/hud/src/gateway.ts`, `apps/hud/src/useGateway.ts`.

**Interfaces:** Produces `hud.startSidecar()`, `hud.stopSidecar()` returning `SidecarActionResult`.

- [ ] **Step 1: gateway.ts** — add the type + methods mirroring `getMisakiStatus`/`installMisaki`:

```ts
export interface SidecarActionResult { online: boolean; started?: boolean; stopped?: boolean; note?: string; error?: string }

async startSidecar(): Promise<SidecarActionResult> {
  const res = await fetch(`${HTTP_BASE}/voice/sidecar/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return (await res.json()) as SidecarActionResult;
}
async stopSidecar(): Promise<SidecarActionResult> {
  const res = await fetch(`${HTTP_BASE}/voice/sidecar/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return (await res.json()) as SidecarActionResult;
}
```

- [ ] **Step 2: useGateway** — import `SidecarActionResult`, add to `HudState`, add `startSidecar`/`stopSidecar` `useCallback`s (same `clientRef.current?… ?? Promise.reject` pattern), return them.
- [ ] **Step 3: Typecheck** `npx tsc --noEmit -p apps/hud`.
- [ ] **Step 4: Commit** `feat(hud): gateway client methods for sidecar start/stop`.

---

### Task 4: HUD guided setup panel

**Files:** create `apps/hud/src/components/VoiceSetup.tsx`; modify `VoiceOptions.tsx` + `styles.css`.

**Interfaces:** Consumes `voiceSetupCommand`, `STT_PROVIDER_IDS` from `@aos/shared`; the statuses/actions already on `hud`.

- [ ] **Step 1: Add `none` to the STT select** in `VoiceOptions.tsx` (`options={[...STT_PROVIDER_IDS]}`), and import `STT_PROVIDER_IDS`.

- [ ] **Step 2: `VoiceSetup.tsx`** — a collapsible "Guided setup" panel. Props: the current `tts`/`stt` values + `hud`. Renders:
  - the composed command (`voiceSetupCommand({tts, stt})`) with a copy button (reuse `.opt__linkbtn`/`.opt__cmd`),
  - three readiness dots — sidecar (from `hud.getSidecarHealth`), models (from `hud.getTtsStatus`, only if tts is installable), misaki (from `hud.getMisakiStatus`),
  - action buttons: **Start/Stop sidecar** (calls `hud.startSidecar/stopSidecar`, then re-checks health), plus the existing Download-models / Install-misaki actions can stay in their rows above (don't duplicate — the panel links to them, or shows Start/Stop only).

```tsx
/** Guided voice setup — from the chosen engines, show the exact install command,
 *  live readiness, and start/stop the sidecar. No pip runs in-app; the user runs
 *  the one composed command, the app does the rest. */
import { useCallback, useEffect, useState } from "react";
import { voiceSetupCommand, type SttProviderId, type TtsProviderId } from "@aos/shared";
import type { HudState } from "../useGateway.js";

export function VoiceSetup({ tts, stt, hud }: { tts: string; stt: string; hud: HudState }) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const cmd = voiceSetupCommand({ tts: tts as TtsProviderId, stt: stt as SttProviderId });

  const refresh = useCallback(() => {
    hud.getSidecarHealth().then((h) => setOnline(h.online)).catch(() => setOnline(false));
  }, [hud]);
  useEffect(refresh, [refresh]);

  const act = async (fn: () => Promise<{ online: boolean }>) => {
    setBusy(true);
    try { setOnline((await fn()).online); } catch { /* notification covers it */ } finally { setBusy(false); }
  };

  return (
    <div className={`vsetup ${open ? "vsetup--open" : ""}`}>
      <button className="opt__linkbtn" onClick={() => setOpen((v) => !v)}>
        {open ? "hide guided setup" : "guided setup"}
      </button>
      {open ? (
        <div className="vsetup__body">
          <p className="opt__hint">1. Create a venv in <code>services/voice</code>, then run once:</p>
          <div className="opt__cmd">
            <code>{cmd}</code>
            <button className="opt__linkbtn" onClick={() => void navigator.clipboard?.writeText(cmd)}>copy</button>
          </div>
          <p className="opt__hint">2. Start the sidecar and provision the rest:</p>
          <div className="opt__row">
            <span className="opt__key">Sidecar
              <span className={`opt__chip ${online ? "opt__chip--on" : ""}`}>{online == null ? "…" : online ? "online ✓" : "offline"}</span>
            </span>
            {online ? (
              <button className="opt__btn" disabled={busy} onClick={() => act(hud.stopSidecar)}>{busy ? "…" : "Stop sidecar"}</button>
            ) : (
              <button className="opt__btn" disabled={busy} onClick={() => act(hud.startSidecar)}>{busy ? "Starting…" : "Start sidecar"}</button>
            )}
          </div>
          <p className="opt__hint">Model files &amp; misaki have their own buttons above (they need the sidecar for misaki).</p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Render it** in `VoiceOptions.tsx`, inside the `cap.installable` block or just below the STT select (visible for any provider): `<VoiceSetup tts={ttsValue} stt={sttValue} hud={hud} />`.
- [ ] **Step 4: Styles** — `.vsetup`, `.vsetup__body` (indent/border), reuse existing `.opt__*`.
- [ ] **Step 5: Verify** `npx tsc --noEmit -p apps/hud` + `npm run build -w @aos/hud`; browser: the command updates as you change TTS/STT selects; Start sidecar (no venv → error notification "no venv found").
- [ ] **Step 6: Commit** `feat(hud): guided voice setup panel — tailored command, status, start/stop`.

---

### Task 5: Docs

**Files:** `services/voice/README.md`.

- [ ] **Step 1:** Document the guided setup (Options → Voice → guided setup): pick engines → copy the tailored command → Start sidecar → Download models / Install misaki. Note the per-engine dep table (kokoro-onnx skips torch).
- [ ] **Step 2: Verify** full `npm test` green; both typechecks clean.
- [ ] **Step 3: Commit** `docs(voice): guided setup walkthrough + per-engine deps`.

---

## Self-Review Notes

- **Bootstrapping is explicit:** the app never runs pip/venv. Start requires a pre-existing venv; if absent, `startSidecar` returns a clear error the panel shows. This is the deliberate robustness/scope boundary.
- **No orphans:** `stopSidecarChild()` on gateway shutdown; `stop` won't kill an externally-launched sidecar (only reports).
- **Type consistency:** `SidecarActionResult` fields identical across sidecar.ts / gateway.ts / HUD. `STT_PROVIDER_IDS` is the one source for the STT select + dep composition.
- **Honest testing gap:** no venv/sidecar on this machine, so start/stop is smoke-tested only via the "no venv" error path; the successful-start path is unverified here — state that in the completion report.
