/**
 * Voice settings — engine picker plus the selected provider's own options:
 * local/cloud badge, cloud key hint, voice field, and (for installable engines
 * like kokoro-onnx) model readiness + a one-click Download button. Driven by the
 * shared TTS_PROVIDERS descriptor, so a new engine adds no conditionals here.
 */
import { useCallback, useEffect, useState } from "react";
import { STT_PROVIDER_IDS, TTS_PROVIDER_IDS, ttsProvider } from "@aos/shared";
import type { HudState } from "../useGateway.js";
import type { MisakiStatus, SidecarHealth, TtsStatus } from "../gateway.js";
import { Select, Text } from "./opt-controls.js";
import { VoiceSetup } from "./VoiceSetup.js";

const MISAKI_CMD = "pip install 'misaki-fork[en]'";

type Bind = (k: string, running: string) => { value: string; onChange: (v: string) => void };

export function VoiceOptions({ bind, mode, ttsValue, voiceValue, sttValue, pythonPathValue, hud }: {
  bind: Bind;
  mode: string;
  ttsValue: string;
  voiceValue: string;
  sttValue: string;
  pythonPathValue: string;
  hud: HudState;
}) {
  const cap = ttsProvider(ttsValue);
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [misaki, setMisaki] = useState<MisakiStatus | null>(null);
  const [misakiBusy, setMisakiBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [health, setHealth] = useState<SidecarHealth | null>(null);

  useEffect(() => {
    let alive = true;
    hud.getSidecarHealth().then((h) => alive && setHealth(h)).catch(() => alive && setHealth({ online: false }));
    return () => { alive = false; };
  }, [hud]);

  const refresh = useCallback(() => {
    if (!cap?.installable) {
      setStatus(null);
      setMisaki(null);
      return;
    }
    hud.getTtsStatus(ttsValue).then(setStatus).catch(() => setStatus(null));
    hud.getMisakiStatus().then(setMisaki).catch(() => setMisaki(null));
  }, [cap?.installable, ttsValue, hud]);
  useEffect(refresh, [refresh]);

  const install = async () => {
    setBusy(true);
    try {
      setStatus(await hud.installTts());
    } catch {
      /* the gateway emits an error notification; leave status as-is */
    } finally {
      setBusy(false);
    }
  };

  const installMisakiDep = async () => {
    setMisakiBusy(true);
    try {
      setMisaki(await hud.installMisaki());
    } catch {
      /* gateway emits an error notification */
    } finally {
      setMisakiBusy(false);
    }
  };

  return (
    <section className="opt">
      <h2 className="opt__h">Voice</h2>
      <div className="opt__row">
        <span className="opt__key">
          Voice sidecar
          <span className={`opt__chip ${health?.online ? "opt__chip--on" : ""}`}>
            {health == null ? "…" : health.online ? "online ✓" : "offline"}
          </span>
          <span className="opt__sub">
            {health?.online
              ? "the Python service that synthesizes speech & installs misaki"
              : "run python server.py in services/voice — needed for speech synthesis & misaki (model files download without it)"}
          </span>
        </span>
      </div>
      <Select label="Mode" {...bind("voice.mode", mode)} options={["text", "voice"]} />
      <Select label="TTS engine" {...bind("voice.tts.provider", ttsValue)} options={[...TTS_PROVIDER_IDS]} />

      {cap ? (
        <>
          <div className="opt__row">
            <span className="opt__key">
              Engine
              <span className={`opt__chip ${cap.kind === "local" ? "opt__chip--on" : ""}`}>{cap.kind}</span>
              <span className="opt__sub">{cap.label}</span>
            </span>
          </div>
          {cap.keyEnv ? (
            <p className="opt__hint">
              Cloud engine — set <code>${cap.keyEnv}</code> in the sidecar's environment.
            </p>
          ) : null}
          <Text label={cap.voiceLabel} {...bind("voice.tts.voice", voiceValue)} placeholder={cap.voicePlaceholder} />
          {cap.installable ? (
            <div className="opt__row">
              <span className="opt__key">
                Model files
                <span className={`opt__chip ${status?.ready ? "opt__chip--on" : ""}`}>
                  {status == null ? "…" : status.ready ? "ready ✓" : "missing"}
                </span>
                <span className="opt__sub">
                  {status?.error
                    ? status.error
                    : status && !status.ready && status.missing.length
                      ? status.missing.join(", ")
                      : "ONNX model + voices — the sidecar reads these to speak"}
                </span>
              </span>
              {status && !status.ready ? (
                <button className="opt__btn" disabled={busy} onClick={install}>
                  {busy ? "Downloading… (~330 MB)" : "Download models (~330 MB)"}
                </button>
              ) : null}
            </div>
          ) : null}

          {cap.installable ? (
            <>
              <div className="opt__row">
                <span className="opt__key">
                  misaki G2P
                  <span className={`opt__chip ${misaki?.installed ? "opt__chip--on" : ""}`}>
                    {misaki == null ? "…" : misaki.error ? "sidecar offline" : misaki.installed ? "installed ✓" : "not installed"}
                  </span>
                  <span className="opt__sub">recommended for v1.0 — better pronunciation (optional)</span>
                </span>
                {misaki && !misaki.installed && !misaki.error ? (
                  <button className="opt__btn" disabled={misakiBusy} onClick={installMisakiDep}>
                    {misakiBusy ? "Installing…" : "Install misaki"}
                  </button>
                ) : null}
              </div>
              {misaki && !misaki.installed ? (
                <p className="opt__hint">
                  <button className="opt__linkbtn" onClick={() => setManual((v) => !v)}>
                    {manual ? "hide manual install" : "install manually instead"}
                  </button>
                  {misaki.error ? " — the sidecar must be running for the button." : null}
                  {manual ? (
                    <span className="opt__cmd">
                      run in the sidecar's venv: <code>{MISAKI_CMD}</code>
                      <button
                        className="opt__linkbtn"
                        onClick={() => void navigator.clipboard?.writeText(MISAKI_CMD)}
                      >
                        copy
                      </button>
                    </span>
                  ) : null}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      <Select label="STT engine" {...bind("voice.stt.provider", sttValue)} options={[...STT_PROVIDER_IDS]} />
      <p className="opt__hint">
        <code>voice</code> mode uses the Python sidecar; installs/downloads run there.
      </p>
      <VoiceSetup tts={ttsValue} stt={sttValue} pythonPath={pythonPathValue} bind={bind} hud={hud} />
    </section>
  );
}
