/**
 * The HUD widgets. Each takes the live HudState and renders one panel body.
 * `renderWidget` maps a WidgetId to its component so panels stay generic.
 */
import { useState } from "react";
import type { SkillCard } from "@aos/shared";
import type { HudState, OperationView } from "../useGateway.js";
import type { WidgetId } from "../layout.js";

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

function VitalMetrics({ hud }: { hud: HudState }) {
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

function OperationsLog({ hud }: { hud: HudState }) {
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

function CommandDeck({ hud }: { hud: HudState }) {
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

function VaultFeed({ hud }: { hud: HudState }) {
  if (hud.operations.length === 0) return <Empty>The audit trail of operations will appear here.</Empty>;
  return (
    <ul className="feed">
      {hud.operations.map((o) => (
        <li className="feed__row" key={o.opId}>
          <span className={`dot dot--${o.status}`} aria-hidden />
          <span className="feed__action">{o.actionId}</span>
          <span className="feed__skill">{o.skillId ?? "—"}</span>
          <span className="feed__time">{timeOf(o.startedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function Schedule() {
  return <Empty>No scheduled items. Morning brief and events surface here once the vault has them.</Empty>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function renderWidget(id: WidgetId, hud: HudState) {
  switch (id) {
    case "vitals":
      return <VitalMetrics hud={hud} />;
    case "operations":
      return <OperationsLog hud={hud} />;
    case "deck":
      return <CommandDeck hud={hud} />;
    case "vault":
      return <VaultFeed hud={hud} />;
    case "schedule":
      return <Schedule />;
  }
}
