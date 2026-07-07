# Voice Provider-Options Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat Voice settings into a declarative, per-provider options surface, and give `kokoro-onnx` a one-click "download models if missing" install flow.

**Architecture:** A shared capability descriptor (`TTS_PROVIDERS`) is the single source of truth for what each TTS provider needs in the UI. The HUD renders the selected provider's descriptor (local/cloud badge, key hint, voice field, and — for installable engines — readiness + a Download button). Installation runs in the Python sidecar (it owns the disk + the fixed release URL); the gateway proxies status/install over its existing REST surface and emits a `notification` event. No new `OsEvent` types.

**Tech Stack:** TS strict ESM (`@aos/shared`, `@aos/gateway`, `@aos/hud`), zod, React 18, Python FastAPI sidecar (httpx), vitest.

## Global Constraints

- The kokoro-onnx release URL is **hardcoded** in the sidecar — never sourced from config, query, or request body (SSRF/abuse guard).
- The gateway install proxy reuses the existing localhost + CSRF/Origin gate on POST (same as `/settings`).
- No new `OsEvent`/`ClientCommand` contract types — reuse `notification`.
- Cloud key status is a **static hint** ("needs `$ENV` in the sidecar env"), not a live check — the key lives in the sidecar's process env, which the gateway can't introspect.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Provider id list is a shared const — no duplicated string arrays (the "no magic strings" rule).

## File Structure

- `packages/shared/src/voice.ts` — **new**: `TTS_PROVIDER_IDS`, `TtsProviderCapability`, `TTS_PROVIDERS`, `ttsProvider()`. Exported from `index.ts`.
- `packages/shared/test/voice.test.ts` — **new**: descriptor invariants.
- `services/voice/installer.py` — **new**: `kokoro_onnx_status(cfg)`, `install_kokoro_onnx(cfg, log)`.
- `services/voice/server.py` — **modify**: `GET /tts/status`, `POST /tts/install`.
- `services/gateway/src/voice/installer.ts` — **new**: `ttsStatus()`, `installTts()` (fetch the sidecar).
- `services/gateway/src/bus/ws-server.ts` — **modify**: route `GET /voice/tts/status` + `POST /voice/tts/install`, emit `notification`.
- `apps/hud/src/gateway.ts` — **modify**: `getTtsStatus()`, `installTts()` client methods + `TtsStatus` type.
- `apps/hud/src/useGateway.ts` — **modify**: expose the two methods on `HudState`.
- `apps/hud/src/components/VoiceOptions.tsx` — **new**: the per-provider section (extracted from `Options.tsx`).
- `apps/hud/src/components/Options.tsx` — **modify**: replace the inline Voice `<section>` with `<VoiceOptions/>`.
- `apps/hud/src/styles.css` — **modify**: install-row styles.

---

### Task 1: Shared TTS provider descriptors

**Files:**
- Create: `packages/shared/src/voice.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./voice.js"`)
- Test: `packages/shared/test/voice.test.ts`

**Interfaces:**
- Produces: `TTS_PROVIDER_IDS` (readonly tuple), `type TtsProviderId`, `interface TtsProviderCapability`, `const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderCapability>`, `function ttsProvider(id: string): TtsProviderCapability | undefined`.

- [ ] **Step 1: Write the failing test** (`packages/shared/test/voice.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { TTS_PROVIDER_IDS, TTS_PROVIDERS, ttsProvider } from "../src/voice.js";

describe("tts provider descriptors", () => {
  it("every id has a descriptor whose id matches its key", () => {
    for (const id of TTS_PROVIDER_IDS) {
      expect(TTS_PROVIDERS[id].id).toBe(id);
    }
    expect(Object.keys(TTS_PROVIDERS).sort()).toEqual([...TTS_PROVIDER_IDS].sort());
  });
  it("only kokoro-onnx is installable; cloud providers declare a keyEnv", () => {
    expect(TTS_PROVIDERS["kokoro-onnx"].installable).toBe(true);
    expect(TTS_PROVIDERS["kokoro"].installable).toBeFalsy();
    expect(TTS_PROVIDERS["openai"].keyEnv).toBe("OPENAI_API_KEY");
    expect(TTS_PROVIDERS["elevenlabs"].kind).toBe("cloud");
  });
  it("ttsProvider returns undefined for an unknown id (forward-compat)", () => {
    expect(ttsProvider("nope")).toBeUndefined();
    expect(ttsProvider("kokoro")?.kind).toBe("local");
  });
});
```

- [ ] **Step 2: Run it — expect failure** `npx vitest run packages/shared/test/voice.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** (`packages/shared/src/voice.ts`)

```ts
/**
 * TTS provider descriptors — the declarative source of truth for how each
 * text-to-speech engine appears in the HUD's Voice settings. Adding a provider
 * = one entry here (+ its class in the Python sidecar's tts.py). The gateway
 * stays engine-agnostic; only the HUD reads these for provider-specific UI.
 */
export const TTS_PROVIDER_IDS = ["kokoro", "kokoro-onnx", "openai", "elevenlabs"] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

export interface TtsProviderCapability {
  id: TtsProviderId;
  label: string;                 // human name for the dropdown/badge
  kind: "local" | "cloud";       // local = no key; cloud = key in sidecar env
  keyEnv?: string;               // cloud only: the env var the sidecar reads
  installable?: boolean;         // has downloadable assets → readiness + Download
  voiceLabel: string;            // engines name voices differently
  voicePlaceholder?: string;
}

export const TTS_PROVIDERS: Record<TtsProviderId, TtsProviderCapability> = {
  "kokoro":      { id: "kokoro",      label: "Kokoro (torch)", kind: "local",                             voiceLabel: "Voice",    voicePlaceholder: "af_heart" },
  "kokoro-onnx": { id: "kokoro-onnx", label: "Kokoro (ONNX)",  kind: "local", installable: true,          voiceLabel: "Voice",    voicePlaceholder: "af_heart" },
  "openai":      { id: "openai",      label: "OpenAI",         kind: "cloud", keyEnv: "OPENAI_API_KEY",    voiceLabel: "Voice",    voicePlaceholder: "alloy" },
  "elevenlabs":  { id: "elevenlabs",  label: "ElevenLabs",     kind: "cloud", keyEnv: "ELEVENLABS_API_KEY", voiceLabel: "Voice ID", voicePlaceholder: "Rachel" },
};

/** Look up a descriptor, tolerating unknown ids from a newer gateway. */
export function ttsProvider(id: string): TtsProviderCapability | undefined {
  return (TTS_PROVIDERS as Record<string, TtsProviderCapability>)[id];
}
```

- [ ] **Step 4: Export** — add `export * from "./voice.js";` to `packages/shared/src/index.ts`.
- [ ] **Step 5: Run tests + typecheck** `npx vitest run packages/shared/test/voice.test.ts` → PASS; `npm run typecheck -w @aos/gateway` clean.
- [ ] **Step 6: Commit** `feat(shared): declarative TTS provider descriptors`.

---

### Task 2: Sidecar status + install endpoints

**Files:**
- Create: `services/voice/installer.py`
- Modify: `services/voice/server.py`

**Interfaces:**
- Produces (HTTP): `GET /tts/status?provider=<id>` → `{ provider, installable, ready, missing: string[] }`; `POST /tts/install` (body `{ provider }`) → `{ ok, ready, missing, log: string[] }`.
- Consumes: `TTSConfig.model_path` / `voices_path` from Task-0 (already on `main`/branch).

- [ ] **Step 1: Implement `installer.py`**

```python
"""kokoro-onnx model asset status + download. The release URL is hardcoded — it
must never come from config/request (SSRF guard). Download is synchronous and
idempotent: present files are left untouched.
"""
from __future__ import annotations

import os
from typing import Callable

from config import TTSConfig

_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"


def _assets(cfg: TTSConfig) -> list[tuple[str, str]]:
    """(filename, dest_path) for each kokoro-onnx asset."""
    return [
        ("kokoro-v1.0.onnx", cfg.model_path or ""),
        ("voices-v1.0.bin", cfg.voices_path or ""),
    ]


def kokoro_onnx_status(cfg: TTSConfig) -> dict:
    missing = [name for name, path in _assets(cfg) if not path or not os.path.isfile(path)]
    return {"provider": "kokoro-onnx", "installable": True, "ready": not missing, "missing": missing}


def install_kokoro_onnx(cfg: TTSConfig, log: Callable[[str], None]) -> dict:
    import httpx

    for name, dest in _assets(cfg):
        if not dest:
            raise RuntimeError(f"no destination path configured for {name}")
        if os.path.isfile(dest):
            log(f"{name}: already present")
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        url = _RELEASE + name
        log(f"{name}: downloading…")
        tmp = dest + ".part"
        with httpx.stream("GET", url, follow_redirects=True, timeout=None) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_bytes():
                    fh.write(chunk)
        os.replace(tmp, dest)  # atomic: a crashed download never looks complete
        log(f"{name}: done")
    return kokoro_onnx_status(cfg)
```

- [ ] **Step 2: Wire endpoints in `server.py`** (import `installer`; add below `/tts`)

```python
class InstallRequest(BaseModel):
    provider: str | None = None


@app.get("/tts/status")
def tts_status(provider: str | None = None) -> dict:
    which = provider or cfg.tts.provider
    if which == "kokoro-onnx":
        return installer.kokoro_onnx_status(cfg.tts)
    return {"provider": which, "installable": False, "ready": True, "missing": []}


@app.post("/tts/install")
def tts_install(req: InstallRequest) -> dict:
    if (req.provider or "kokoro-onnx") != "kokoro-onnx":
        raise HTTPException(status_code=400, detail="only kokoro-onnx is installable")
    log: list[str] = []
    try:
        status = installer.install_kokoro_onnx(cfg.tts, log.append)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"install failed: {exc}") from exc
    return {"ok": status["ready"], **status, "log": log}
```

Add `import installer` near the other imports.

- [ ] **Step 3: Smoke it** (no 330 MB download): start the sidecar with kokoro-onnx selected but files absent, and confirm status reports missing + install path resolves. (Real download is a manual one-time step — do NOT run it in dev.)

```bash
cd services/voice && AGENTIC_OS_TTS_PROVIDER=kokoro-onnx python server.py &
curl -s "http://127.0.0.1:7788/tts/status?provider=kokoro-onnx"
# expect: {"provider":"kokoro-onnx","installable":true,"ready":false,"missing":["kokoro-v1.0.onnx","voices-v1.0.bin"]}
```

Then create a dummy file at each path and re-check `ready:true` to prove the idempotent branch, then delete the dummies.

- [ ] **Step 4: Commit** `feat(voice): sidecar /tts/status + /tts/install for kokoro-onnx models`.

---

### Task 3: Gateway proxy + notification

**Files:**
- Create: `services/gateway/src/voice/installer.ts`
- Modify: `services/gateway/src/bus/ws-server.ts`

**Interfaces:**
- Produces (HTTP on the gateway): `GET /voice/tts/status?provider=<id>` (proxied), `POST /voice/tts/install` (proxied, gated). Emits `notification` (`info` on start/success, `error` on failure) via the bus.
- Consumes: `config.voice.sidecarUrl`; the bus `emit(event: OsEvent)` used elsewhere in ws-server.

- [ ] **Step 1: Implement the proxy** (`services/gateway/src/voice/installer.ts`)

```ts
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
```

- [ ] **Step 2: Route in `ws-server.ts`** — alongside the existing `GET`/`POST` handling (mirror the `/settings` branch: same `json()` helper, same localhost + CSRF gate for the POST). Import `ttsStatus, installTts` and the bus emitter already in scope.

```ts
// GET status (read-only, no gate)
if (req.method === "GET" && url.pathname === "/voice/tts/status") {
  try {
    const status = await ttsStatus(url.searchParams.get("provider") ?? undefined);
    return json(res, status, 200);
  } catch (e) {
    return json(res, { ready: false, installable: false, missing: [], error: String(e) }, 200);
  }
}
// POST install (same origin/localhost gate as /settings, reused above)
if (req.method === "POST" && url.pathname === "/voice/tts/install") {
  // <same isLocalOrigin(...) 403 guard used by /settings — do NOT skip it>
  emit({ type: "notification", at: new Date().toISOString(), level: "info", message: "Downloading kokoro-onnx voice models…" });
  try {
    const status = await installTts();
    emit({ type: "notification", at: new Date().toISOString(), level: status.ready ? "info" : "error",
           message: status.ready ? "kokoro-onnx voice models ready." : `Model download incomplete: missing ${status.missing.join(", ")}` });
    return json(res, status, 200);
  } catch (e) {
    emit({ type: "notification", at: new Date().toISOString(), level: "error", message: `Voice model download failed: ${String(e)}` });
    return json(res, { ok: false, error: String(e) }, 503);
  }
}
```

> Exact variable names (`json`, `emit`, `isLocalOrigin`) must match what the file already uses — read the `/settings` branch and copy its guard verbatim. The CSRF gate is REQUIRED on the install POST.

- [ ] **Step 3: Typecheck** `npm run typecheck -w @aos/gateway` clean.
- [ ] **Step 4: Commit** `feat(gateway): proxy voice TTS status/install to the sidecar with notifications`.

---

### Task 4: HUD per-provider Voice options + install button

**Files:**
- Modify: `apps/hud/src/gateway.ts` (client methods + `TtsStatus` type)
- Modify: `apps/hud/src/useGateway.ts` (expose on `HudState`)
- Create: `apps/hud/src/components/VoiceOptions.tsx`
- Modify: `apps/hud/src/components/Options.tsx` (swap the Voice section)
- Modify: `apps/hud/src/styles.css`

**Interfaces:**
- Consumes: `TTS_PROVIDER_IDS`, `TTS_PROVIDERS`, `ttsProvider` from `@aos/shared`; `bind` semantics from `Options`.
- Produces: `hud.getTtsStatus(provider)`, `hud.installTts()`.

- [ ] **Step 1: Client methods** (`apps/hud/src/gateway.ts`)

```ts
export interface TtsStatus { provider: string; installable: boolean; ready: boolean; missing: string[]; error?: string }

// inside GatewayClient:
async getTtsStatus(provider: string): Promise<TtsStatus> {
  const res = await fetch(`${HTTP_BASE}/voice/tts/status?provider=${encodeURIComponent(provider)}`);
  return (await res.json()) as TtsStatus;
}
async installTts(): Promise<TtsStatus> {
  const res = await fetch(`${HTTP_BASE}/voice/tts/install`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return (await res.json()) as TtsStatus;
}
```

- [ ] **Step 2: Expose on `useGateway`** — add to `HudState`: `getTtsStatus: (p: string) => Promise<TtsStatus>；installTts: () => Promise<TtsStatus>`, wired through `clientRef.current?…` like `fetchConfig`, returned in the state object.

- [ ] **Step 3: `VoiceOptions.tsx`** — receives `bind`, current tts provider value, and `hud`. Renders the descriptor.

```tsx
/**
 * Voice settings — engine picker plus the selected provider's own options:
 * local/cloud badge, cloud key hint, voice field, and (for installable engines
 * like kokoro-onnx) model readiness + a one-click Download button.
 */
import { useCallback, useEffect, useState } from "react";
import { TTS_PROVIDER_IDS, ttsProvider } from "@aos/shared";
import type { HudState } from "../useGateway.js";
import type { TtsStatus } from "../gateway.js";

type Bind = (k: string, running: string) => { value: string; onChange: (v: string) => void };

export function VoiceOptions({ bind, mode, ttsValue, voiceValue, sttValue, hud }: {
  bind: Bind; mode: string; ttsValue: string; voiceValue: string; sttValue: string; hud: HudState;
}) {
  const cap = ttsProvider(ttsValue);
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!cap?.installable) { setStatus(null); return; }
    hud.getTtsStatus(ttsValue).then(setStatus).catch(() => setStatus(null));
  }, [cap?.installable, ttsValue, hud]);
  useEffect(refresh, [refresh]);

  const install = async () => {
    setBusy(true);
    try { setStatus(await hud.installTts()); } finally { setBusy(false); }
  };

  return (
    <section className="opt">
      <h2 className="opt__h">Voice</h2>
      <Select label="Mode" {...bind("voice.mode", mode)} options={["text", "voice"]} />
      <Select label="TTS engine" {...bind("voice.tts.provider", ttsValue)} options={[...TTS_PROVIDER_IDS]} />
      {cap ? (
        <>
          <div className="opt__row">
            <span className="opt__key">Engine
              <span className={`opt__chip ${cap.kind === "local" ? "opt__chip--on" : ""}`}>{cap.kind}</span>
            </span>
            <span className="opt__sub">{cap.label}</span>
          </div>
          {cap.keyEnv ? <p className="opt__hint">Cloud engine — set <code>${cap.keyEnv}</code> in the sidecar's environment.</p> : null}
          <Text label={cap.voiceLabel} {...bind("voice.tts.voice", voiceValue)} placeholder={cap.voicePlaceholder} />
          {cap.installable ? (
            <div className="opt__row">
              <span className="opt__key">Model files
                <span className={`opt__chip ${status?.ready ? "opt__chip--on" : ""}`}>
                  {status == null ? "…" : status.ready ? "ready ✓" : "missing"}
                </span>
              </span>
              {status && !status.ready ? (
                <button className="opt__btn" disabled={busy} onClick={install}>
                  {busy ? "Downloading… (~330 MB)" : "Download models (~330 MB)"}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <Select label="STT engine" {...bind("voice.stt.provider", sttValue)} options={["faster-whisper", "openai"]} />
      <p className="opt__hint"><code>voice</code> mode uses the Python sidecar; installs/downloads run there.</p>
    </section>
  );
}
```

> `Select`/`Text` are defined at module scope in `Options.tsx`. Export them from `Options.tsx` (or move both into a shared `opt-controls.tsx` and import in both) — do NOT redefine them inline (that remounts inputs and drops focus). Prefer extracting `Select`/`Text` into `apps/hud/src/components/opt-controls.tsx` and importing in both files.

- [ ] **Step 4: Swap into `Options.tsx`** — remove the inline `<section>` for Voice (lines ~215-223) and render `<VoiceOptions bind={bind} mode={cfg.voice.mode} ttsValue={valueOf("voice.tts.provider", cfg.voice.tts)} voiceValue={valueOf("voice.tts.voice", cfg.voice.voice ?? "")} sttValue={cfg.voice.stt} hud={hud} />`. Confirm `ConfigView.voice` exposes `voice` (the tts voice); if absent, add it to the gateway `/config` sanitizer (`voice.tts.voice`). `voice.tts.voice` is already an `EDITABLE_KEY`? If not, add it to `EDITABLE_KEYS` in `config/config-store.ts`.

- [ ] **Step 5: Styles** — add `.opt__btn[disabled]{opacity:.6;cursor:progress}` if not present; reuse existing `.opt__row/.opt__chip/.opt__btn`.

- [ ] **Step 6: Verify** `npx tsc --noEmit -p apps/hud` exit 0; `npm run build -w @aos/hud`; browser: Options → Voice → pick `kokoro-onnx` → shows "missing" + Download button; pick `kokoro` → no install row; pick `openai` → cloud hint + `alloy` voice placeholder.

- [ ] **Step 7: Commit** `feat(hud): per-provider Voice options with kokoro-onnx model install`.

---

### Task 5: Docs + editable-key wiring

**Files:**
- Modify: `config/config-store.ts` (ensure `voice.tts.voice` is editable, if the voice field is new)
- Modify: `docs/configuration.md`, `services/voice/README.md`
- Modify: `docs/architecture.md` (one line: install proxy path), if it enumerates gateway routes

- [ ] **Step 1:** If `voice.tts.voice` isn't in `EDITABLE_KEYS`, add it (whitelist gate) and confirm `/config` returns it.
- [ ] **Step 2:** Document `GET /voice/tts/status` + `POST /voice/tts/install` and the in-app Download button in `services/voice/README.md` (kokoro-onnx section) and note it in `docs/configuration.md`.
- [ ] **Step 3: Verify** `npm run typecheck -w @aos/gateway` + full `npm test` green.
- [ ] **Step 4: Commit** `docs(voice): document TTS install endpoints + editable voice key`.

---

## Self-Review Notes

- **No new contract types:** install/status ride REST + the existing `notification` event — deliberate, keeps the wire contract stable.
- **Type consistency:** `TtsStatus` (HUD) and `TtsInstallStatus` (gateway) and the sidecar JSON all share `{provider, installable, ready, missing}`. Keep the field names identical across the three.
- **Security:** the release URL is hardcoded in `installer.py`; the gateway install POST keeps the CSRF/localhost gate; the status GET is read-only and safe cross-origin-blocked by default config.
- **Honest testing gap:** the sidecar isn't in CI and the real download is 330 MB — Task 2/3 are smoke-tested with files absent + dummy files, not a live fetch. State this in the completion report.
- **Follow-up (out of scope):** real byte-level progress needs the sidecar to stream a chunked response and the gateway to forward it as repeated events; v1 is an indeterminate spinner + coarse notifications.
