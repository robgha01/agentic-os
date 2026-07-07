/**
 * Audio I/O — voice link status + the controls you reach for most: voice output
 * mode and result auto-announce, toggled inline (persisted + applied live) so
 * you don't have to open Options. Hold-to-talk drives the listening state.
 */
import { useEffect, useState } from "react";
import type { HudState } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { isRecording, startRecording, stopRecording } from "../../mic.js";

function AudioIO({ hud }: { hud: HudState }) {
  const [voice, setVoice] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [dictation, setDictation] = useState<"idle" | "recording" | "transcribing">("idle");
  const fetchConfig = hud.fetchConfig;

  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((c) => {
        if (!alive) return;
        setVoice(c.voice.mode === "voice");
        setAnnounce(c.voice.announce !== false);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fetchConfig, hud.status]);

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    void hud.saveSettings({ "voice.mode": next ? "voice" : "text" });
  };
  const toggleAnnounce = () => {
    const next = !announce;
    setAnnounce(next);
    void hud.saveSettings({ "voice.announce": next ? "true" : "false" });
  };

  const speaking = hud.coreState === "speaking";
  const listening = hud.coreState === "listening";
  const status = speaking ? "speaking" : listening ? "listening" : voice ? "voice ready" : "text mode";

  // Push-to-talk: press → record (barge-in via setListening), release →
  // transcribe the clip and route the text like a typed command.
  const beginTalk = async () => {
    hud.setListening(true); // stops any current speech, shows "listening"
    try {
      await startRecording();
      setDictation("recording");
    } catch {
      hud.setListening(false); // mic denied / unavailable
    }
  };
  const endTalk = async () => {
    hud.setListening(false);
    if (!isRecording()) return;
    setDictation("transcribing");
    try {
      const blob = await stopRecording();
      const text = blob ? (await hud.transcribe(blob)).text.trim() : "";
      if (text) hud.send({ type: "route", input: text });
    } catch {
      /* a gateway notification surfaces the failure */
    } finally {
      setDictation("idle");
    }
  };
  const pttLabel = dictation === "transcribing" ? "transcribing…" : dictation === "recording" ? "● listening — release to send" : "⬤ Hold to talk";

  return (
    <div className="audio">
      <div className="audio__status">
        <span className={`audio__dot ${speaking ? "audio__dot--on" : ""}`} aria-hidden />
        <span className="audio__state">TTS · {status.toUpperCase()}</span>
      </div>
      <div className={`audio__wave ${speaking ? "audio__wave--live" : ""}`} aria-hidden>
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${(i % 7) * 80}ms` }} />
        ))}
      </div>
      <div className="audio__toggles">
        <button className={`toggle ${voice ? "toggle--on" : ""}`} onClick={toggleVoice} role="switch" aria-checked={voice}>
          <span className="toggle__knob" /> Voice output
        </button>
        <button
          className={`toggle ${announce ? "toggle--on" : ""}`}
          onClick={toggleAnnounce}
          role="switch"
          aria-checked={announce}
          title="Read finished tasks aloud (voice mode)"
        >
          <span className="toggle__knob" /> Announce results
        </button>
      </div>
      <button
        className={`audio__ptt${dictation !== "idle" ? " audio__ptt--live" : ""}`}
        style={{ touchAction: "none" }}
        disabled={dictation === "transcribing"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          void beginTalk();
        }}
        onPointerUp={() => void endTalk()}
        onPointerCancel={() => void endTalk()}
      >
        {pttLabel}
      </button>
      <div className="audio__hint">voice link · {voice ? "standby" : "text default"}</div>
    </div>
  );
}

export const widget: WidgetDef = {
  id: "audio",
  name: "Audio I/O",
  eyebrow: "voice.link",
  render: (hud) => <AudioIO hud={hud} />,
  defaultSlot: "left-bottom",
};
