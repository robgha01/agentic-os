/**
 * Voice settings — engine picker plus the selected provider's own options:
 * local/cloud badge, cloud key hint, voice field, and (for installable engines
 * like kokoro-onnx) model readiness + a one-click Download button. Driven by the
 * shared TTS_PROVIDERS descriptor, so a new engine adds no conditionals here.
 */
import { useCallback, useEffect, useState } from "react";
import { TTS_PROVIDER_IDS, ttsProvider } from "@aos/shared";
import type { HudState } from "../useGateway.js";
import type { TtsStatus } from "../gateway.js";
import { Select, Text } from "./opt-controls.js";

type Bind = (k: string, running: string) => { value: string; onChange: (v: string) => void };

export function VoiceOptions({ bind, mode, ttsValue, voiceValue, sttValue, hud }: {
  bind: Bind;
  mode: string;
  ttsValue: string;
  voiceValue: string;
  sttValue: string;
  hud: HudState;
}) {
  const cap = ttsProvider(ttsValue);
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!cap?.installable) {
      setStatus(null);
      return;
    }
    hud.getTtsStatus(ttsValue).then(setStatus).catch(() => setStatus(null));
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

  return (
    <section className="opt">
      <h2 className="opt__h">Voice</h2>
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
        </>
      ) : null}

      <Select label="STT engine" {...bind("voice.stt.provider", sttValue)} options={["faster-whisper", "openai"]} />
      <p className="opt__hint">
        <code>voice</code> mode uses the Python sidecar; installs/downloads run there.
      </p>
    </section>
  );
}
