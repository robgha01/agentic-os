/**
 * Audio I/O — voice link status + the controls you reach for most: voice output
 * mode and result auto-announce, toggled inline (persisted + applied live) so
 * you don't have to open Options. The mic control follows voice.micMode:
 * push-to-talk (hold a button) or hands-free (voice-activity detection).
 */
import { useEffect, useRef, useState } from "react";
import type { HudState } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { isRecording, startRecording, stopRecording } from "../../mic.js";
import { isSpeaking } from "../../audio-player.js";
import { startHandsFree, type HandsFreeHandle } from "../../vad.js";

function AudioIO({ hud }: { hud: HudState }) {
  const [voice, setVoice] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [micMode, setMicMode] = useState("push-to-talk");
  const [dictation, setDictation] = useState<"idle" | "recording" | "transcribing">("idle");
  const [hands, setHands] = useState({ on: false, speaking: false });
  const handsRef = useRef<HandsFreeHandle | null>(null);
  const fetchConfig = hud.fetchConfig;

  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((c) => {
        if (!alive) return;
        setVoice(c.voice.mode === "voice");
        setAnnounce(c.voice.announce !== false);
        setMicMode(c.voice.micMode || "push-to-talk");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fetchConfig, hud.status]);

  // Stop hands-free on unmount, or when the mode switches away from it.
  useEffect(() => {
    if (micMode === "push-to-talk" && handsRef.current) {
      handsRef.current.stop();
      handsRef.current = null;
      setHands({ on: false, speaking: false });
    }
  }, [micMode]);
  useEffect(() => () => handsRef.current?.stop(), []);

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

  // Transcribe a captured clip and route the text like a typed command.
  const routeClip = async (blob: Blob) => {
    setDictation("transcribing");
    try {
      const text = (await hud.transcribe(blob)).text.trim();
      if (text) hud.send({ type: "route", input: text });
    } catch {
      /* a gateway notification surfaces the failure */
    } finally {
      setDictation("idle");
    }
  };

  // --- Push-to-talk: press → record (barge-in via setListening), release → route.
  const beginTalk = async () => {
    hud.setListening(true);
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
    if (dictation === "recording") setDictation("idle");
    const blob = await stopRecording();
    if (blob) await routeClip(blob);
  };
  const pttLabel = dictation === "transcribing" ? "transcribing…" : dictation === "recording" ? "● listening — release to send" : "⬤ Hold to talk";

  // --- Hands-free: VAD segments each utterance; the echo guard suppresses capture
  // while the OS is talking so its own voice isn't recorded and routed back.
  const toggleHands = async () => {
    if (handsRef.current) {
      handsRef.current.stop();
      handsRef.current = null;
      setHands({ on: false, speaking: false });
      hud.setListening(false);
      return;
    }
    try {
      handsRef.current = await startHandsFree({
        onUtterance: (blob) => void routeClip(blob),
        onState: (on, sp) => {
          setHands({ on, speaking: sp });
          hud.setListening(sp);
        },
        shouldCapture: () => !isSpeaking(),
      });
    } catch {
      setHands({ on: false, speaking: false }); // mic denied
    }
  };
  const handsLabel = !hands.on
    ? "○ Start hands-free"
    : hands.speaking
      ? "● hearing you…"
      : dictation === "transcribing"
        ? "transcribing…"
        : "◉ hands-free on — tap to stop";

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
      {micMode === "push-to-talk" ? (
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
      ) : (
        <button className={`audio__ptt${hands.on ? " audio__ptt--live" : ""}`} onClick={() => void toggleHands()}>
          {handsLabel}
        </button>
      )}
      <div className="audio__hint">voice link · {micMode} · {voice ? "standby" : "text default"}</div>
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
