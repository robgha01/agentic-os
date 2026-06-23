/**
 * The HUD widget components. Each takes the live HudState (and optional resolved
 * options) and renders one panel body. They're wired to ids in widget-registry.
 */
import { useEffect, useState } from "react";
import type { SkillCard } from "@aos/shared";
import type { HudState, OperationView } from "../useGateway.js";
import type { WidgetOptions } from "../widget-options.js";

function timeOf(iso: string): string {
  return (iso.split("T")[1] ?? "").slice(0, 8);
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const w = 100;
  const h = 24;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--magenta)" strokeWidth="1.5" />
    </svg>
  );
}

export function VitalMetrics({ hud }: { hud: HudState }) {
  const stat = (label: string, value: string | number) => (
    <div className="metric" key={label}>
      <div className="metric__value">{value}</div>
      <div className="metric__label">{label}</div>
    </div>
  );
  return (
    <div className="vitals">
      <div className="vitals__grid">
        {stat("signals", hud.signals)}
        {stat("operations", hud.operations.length)}
        {stat("skills", hud.skills.length)}
      </div>
      <Sparkline data={hud.signalSeries} />
      <div className="vitals__rate">signal rate · 2s buckets</div>
    </div>
  );
}

function statusGlyph(o: OperationView): string {
  return o.status === "running" ? "◍" : o.status === "done" ? "●" : "✕";
}

export function OperationsLog({ hud }: { hud: HudState }) {
  const active = hud.operations[0];
  if (!active) return <Empty>No operations yet. Run a skill or type a command.</Empty>;
  return (
    <div className="oplog">
      <div className="oplog__head">
        <span className={`badge badge--${active.status}`}>{statusGlyph(active)} {active.actionId}</span>
        <span className="oplog__skill">{active.skillId ?? "—"}</span>
      </div>
      <pre className="oplog__out">{active.output || "…"}</pre>
      {active.error ? <div className="oplog__err">{active.error}</div> : null}
    </div>
  );
}

function DeckCard({ card, hud }: { card: SkillCard; hud: HudState }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const needsForm = card.inputs.length > 0;

  const run = () => {
    const params: Record<string, unknown> = {};
    for (const i of card.inputs) params[i.name] = values[i.name] ?? "";
    hud.send({ type: "invoke", skillId: card.skillId, params });
    setOpen(false);
  };

  return (
    <div className="card">
      <button
        className="card__btn"
        onClick={() => (needsForm ? setOpen((v) => !v) : hud.send({ type: "invoke", skillId: card.skillId }))}
      >
        <span className="card__label">{card.label}</span>
        <span className="card__hint">{needsForm ? (open ? "▾" : "▸") : "run"}</span>
      </button>
      {open && needsForm ? (
        <form
          className="card__form"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          {card.inputs.map((i) => (
            <input
              key={i.name}
              className="field"
              placeholder={i.label ?? i.name}
              value={values[i.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))}
            />
          ))}
          <button className="card__go" type="submit">run</button>
        </form>
      ) : null}
    </div>
  );
}

export function CommandDeck({ hud }: { hud: HudState }) {
  if (hud.skills.length === 0) {
    return <Empty>{hud.status === "online" ? "No command skills available." : "Connecting to gateway…"}</Empty>;
  }
  return (
    <div className="deck">
      {hud.skills.map((c) => (
        <DeckCard key={c.skillId} card={c} hud={hud} />
      ))}
    </div>
  );
}

export function VaultFeed({ hud }: { hud: HudState }) {
  if (hud.records.length === 0) return <Empty>Records the OS writes to the vault appear here. Click one to open it.</Empty>;
  return (
    <ul className="feed">
      {hud.records.map((r) => (
        <li key={r.path}>
          <button className="feed__row feed__row--btn" onClick={() => hud.openDoc(r.path)} title={r.title}>
            <span className="feed__type">{r.type}</span>
            <span className="feed__title">{r.title}</span>
            <span className="feed__time">{timeOf(r.updated)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Schedule() {
  return <Empty>No scheduled items. Morning brief and events surface here once the vault has them.</Empty>;
}

/**
 * Audio I/O — voice link status + the controls you reach for most: voice output
 * mode and result auto-announce, toggled inline (persisted + applied live) so
 * you don't have to open Options. Hold-to-talk drives the listening state.
 */
export function AudioIO({ hud }: { hud: HudState }) {
  const [voice, setVoice] = useState(false);
  const [announce, setAnnounce] = useState(true);
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
        className="audio__ptt"
        onMouseDown={() => hud.setListening(true)}
        onMouseUp={() => hud.setListening(false)}
        onMouseLeave={() => hud.setListening(false)}
      >
        ⬤ Hold to talk
      </button>
      <div className="audio__hint">voice link · {voice ? "standby" : "text default"}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Pull the bullets out of an intel record's "## Wire" section, markdown stripped. */
function wireBullets(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+Wire\b/i.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? "")) break;
    const m = (lines[i] ?? "").match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      out.push(
        m[1]!
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links -> label
          .replace(/[*_`]/g, "")
          .trim(),
      );
    }
  }
  return out;
}

/** AI Wire — a terse AI-industry intel brief from the newest `intel` record. */
export function AiWire({ hud, options }: { hud: HudState; options?: WidgetOptions }) {
  const max = Number(options?.max ?? 8);
  const topic = String(options?.topic ?? "").trim();
  const rec = hud.records.find((r) => r.type === "intel");
  const path = rec?.path;
  const fetchDoc = hud.fetchDoc;
  const [bullets, setBullets] = useState<string[]>([]);

  useEffect(() => {
    if (!path) {
      setBullets([]);
      return;
    }
    let alive = true;
    fetchDoc(path)
      .then((d) => alive && d && setBullets(wireBullets(d.body)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, fetchDoc]);

  const run = () => hud.send({ type: "invoke", skillId: "ai-wire", params: topic ? { topic } : {} });

  if (!rec) {
    return (
      <div className="wire">
        <Empty>No wire yet — pull the latest AI-industry signal.</Empty>
        <button className="wire__run" onClick={run}>Run AI Wire</button>
      </div>
    );
  }
  return (
    <div className="wire">
      <button className="wire__head" onClick={() => hud.openDoc(rec.path)} title="Open the full intel record">
        <span className="wire__sub">{rec.title}</span>
        <span className="wire__open">open ↗</span>
      </button>
      <ul className="wire__list">
        {bullets.slice(0, max).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
        {bullets.length === 0 ? <li className="wire__muted">(no bullets parsed)</li> : null}
      </ul>
      <button className="wire__run" onClick={run} title="Refresh the wire">⟳ refresh</button>
    </div>
  );
}

