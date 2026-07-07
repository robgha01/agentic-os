/**
 * Guided voice setup — from the chosen engines, show the exact minimal install
 * command (pip or uv, matching what's detected), the resolved Python interpreter
 * (pyenv/uv/venv/system, overridable), live sidecar readiness, and start/stop.
 * No pip runs in-app: you run the one composed command, the app does the rest.
 */
import { useCallback, useEffect, useState } from "react";
import { voiceSetupCommand, type SttProviderId, type TtsProviderId, type VoiceInstallTool } from "@aos/shared";
import type { HudState } from "../useGateway.js";
import type { VoiceEnv } from "../gateway.js";
import { Text } from "./opt-controls.js";

type Bind = (k: string, running: string) => { value: string; onChange: (v: string) => void };

export function VoiceSetup({ tts, stt, pythonPath, bind, hud }: {
  tts: string;
  stt: string;
  pythonPath: string;
  bind: Bind;
  hud: HudState;
}) {
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<VoiceEnv | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // null = not chosen yet; defaulted from env once, then the user's pick sticks.
  const [tool, setTool] = useState<VoiceInstallTool | null>(null);

  // Destructure the STABLE method refs — `hud` itself is a new object each gateway
  // tick, so depending on it would re-run this effect (and reset `tool`) constantly.
  const { getVoiceEnv, getSidecarHealth } = hud;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getVoiceEnv()
      .then((e) => {
        if (!alive) return;
        setEnv(e);
        setTool((prev) => prev ?? (e.uv ? "uv" : "pip")); // default once; keep user's choice
      })
      .catch(() => alive && setEnv(null));
    getSidecarHealth().then((h) => alive && setOnline(h.online)).catch(() => alive && setOnline(false));
    return () => { alive = false; };
  }, [open, getVoiceEnv, getSidecarHealth]);

  const cmd = voiceSetupCommand({ tts: tts as TtsProviderId, stt: stt as SttProviderId }, tool ?? "pip");

  const act = async (fn: () => Promise<{ online: boolean }>) => {
    setBusy(true);
    try { setOnline((await fn()).online); } catch { /* notification covers it */ } finally { setBusy(false); }
  };

  return (
    <div className="vsetup">
      <button className="opt__linkbtn" onClick={() => setOpen((v) => !v)}>
        {open ? "hide guided setup" : "guided setup ▸"}
      </button>
      {open ? (
        <div className="vsetup__body">
          <div className="opt__row">
            <span className="opt__key">Detected Python
              <span className={`opt__chip ${env?.python ? "opt__chip--on" : ""}`}>
                {env == null ? "…" : env.python ? (env.version ?? env.python) : "none found"}
              </span>
              <span className="opt__sub">
                {env == null ? "" : `${env.source === "config" ? "configured" : env.source === "venv" ? "project venv" : env.source === "path" ? "on PATH (pyenv/system)" : "not found"}${env.uv ? " · uv available" : ""}`}
              </span>
            </span>
          </div>
          <Text label="Interpreter override" {...bind("voice.pythonPath", pythonPath)} placeholder="auto — or a pyenv/uv/conda python path" />

          <p className="opt__hint">
            1. Install the deps for your engines
            {env?.uv ? (
              <> (
                <button className="opt__linkbtn" onClick={() => setTool("uv")} disabled={tool === "uv"}>uv</button>
                {" / "}
                <button className="opt__linkbtn" onClick={() => setTool("pip")} disabled={tool === "pip"}>pip</button>
                )</>
            ) : null}:
          </p>
          <div className="opt__cmd">
            <code>{cmd}</code>
            <button className="opt__linkbtn" onClick={() => void navigator.clipboard?.writeText(cmd)}>copy</button>
          </div>

          <p className="opt__hint">2. Start the sidecar, then use the Download / Install buttons above.</p>
          <div className="opt__row">
            <span className="opt__key">Sidecar
              <span className={`opt__chip ${online ? "opt__chip--on" : ""}`}>
                {online == null ? "…" : online ? "online ✓" : "offline"}
              </span>
            </span>
            {online ? (
              <button className="opt__btn" disabled={busy} onClick={() => act(hud.stopSidecar)}>
                {busy ? "…" : "Stop sidecar"}
              </button>
            ) : (
              <button className="opt__btn" disabled={busy} onClick={() => act(hud.startSidecar)}>
                {busy ? "Starting…" : "Start sidecar"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
