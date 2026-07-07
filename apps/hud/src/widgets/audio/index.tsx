/**
 * Audio I/O — voice link status + the controls you reach for most: voice output
 * mode and result auto-announce, toggled inline (persisted + applied live). The
 * mic control follows voice.micMode: push-to-talk (hold a button), hands-free
 * (voice-activity detection), or wake-word (say the trigger phrase).
 */
import { useEffect, useRef, useState } from "react";
import type { HudState } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { isRecording, startRecording, stopRecording } from "../../mic.js";
import { isSpeaking } from "../../audio-player.js";
import { startHandsFree } from "../../vad.js";
import { resolveWakeProvider, startWake, type WakeHandle } from "../../wake.js";

// openWakeWord / Porcupine engines aren't implemented yet, so nothing is
// "available" and the resolver always lands on STT-based. Wire real availability
// (sidecar /health + Picovoice key presence) when those engines ship.
const WAKE_AVAILABILITY = { openwakeword: false, porcupine: false };

function AudioIO({ hud }: { hud: HudState }) {
  const [voice, setVoice] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [micMode, setMicMode] = useState("push-to-talk");
  const [wakeWord, setWakeWord] = useState("hey jarvis");
  const [wakeProvider, setWakeProvider] = useState("auto");
  const [dictation, setDictation] = useState<"idle" | "recording" | "transcribing">("idle");
  const [listen, setListen] = useState<{ on: boolean; status: string }>({ on: false, status: "" });
  const listenerRef = useRef<WakeHandle | null>(null);
  const fetchConfig = hud.fetchConfig;

  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((c) => {
        if (!alive) return;
        setVoice(c.voice.mode === "voice");
        setAnnounce(c.voice.announce !== false);
        setMicMode(c.voice.micMode || "push-to-talk");
        setWakeWord(c.voice.wakeWord || "hey jarvis");
        setWakeProvider(c.voice.wakeProvider || "auto");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fetchConfig, hud.status]);

  const stopListening = () => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListen({ on: false, status: "" });
    hud.setListening(false);
  };
  // Stop any running listener on unmount, or whenever the mic mode changes.
  useEffect(() => () => listenerRef.current?.stop(), []);
  useEffect(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListen({ on: false, status: "" });
  }, [micMode]);

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
  const listeningCore = hud.coreState === "listening";
  const status = speaking ? "speaking" : listeningCore ? "listening" : voice ? "voice ready" : "text mode";

  const route = (text: string) => {
    if (text.trim()) hud.send({ type: "route", input: text.trim() });
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
    setDictation("transcribing");
    try {
      const blob = await stopRecording();
      if (blob) route((await hud.transcribe(blob)).text);
    } catch {
      /* a gateway notification surfaces the failure */
    } finally {
      setDictation("idle");
    }
  };
  const pttLabel = dictation === "transcribing" ? "transcribing…" : dictation === "recording" ? "● listening — release to send" : "⬤ Hold to talk";

  // --- Hands-free / wake-word: a toggle starts the appropriate listener. The
  // echo guard suppresses capture while the OS talks so it isn't looped back.
  const startListening = async () => {
    try {
      if (micMode === "wake-word") {
        const provider = resolveWakeProvider(wakeProvider, WAKE_AVAILABILITY);
        listenerRef.current = await startWake(provider, {
          wakeWord: wakeWord || "hey jarvis",
          transcribe: hud.transcribe,
          isSpeaking,
          onCommand: route,
          onState: (s) => {
            setListen({ on: true, status: s });
            hud.setListening(s === "capturing");
          },
        });
      } else {
        listenerRef.current = await startHandsFree({
          shouldCapture: () => !isSpeaking(),
          onUtterance: async (blob) => {
            setListen({ on: true, status: "thinking" });
            try {
              route((await hud.transcribe(blob)).text);
            } catch {
              /* notification covers it */
            }
            setListen({ on: true, status: "listening" });
          },
          onState: (on, sp) => {
            setListen({ on, status: sp ? "capturing" : "listening" });
            hud.setListening(sp);
          },
        });
      }
      setListen({ on: true, status: "listening" });
    } catch {
      setListen({ on: false, status: "" }); // mic denied
    }
  };
  const toggleListen = () => (listenerRef.current ? stopListening() : void startListening());

  const wake = wakeWord || "hey jarvis";
  const listenLabel = !listen.on
    ? micMode === "wake-word"
      ? `○ Wake on "${wake}"`
      : "○ Start hands-free"
    : listen.status === "capturing"
      ? "● hearing you…"
      : listen.status === "thinking"
        ? "transcribing…"
        : micMode === "wake-word"
          ? `◉ listening for "${wake}"`
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
        <button className={`audio__ptt${listen.on ? " audio__ptt--live" : ""}`} onClick={toggleListen}>
          {listenLabel}
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
