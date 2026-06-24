/** System status — signal/op/skill counts + a signal-rate sparkline. */
import type { HudState } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { Sparkline } from "../_shared.js";

function Vitals({ hud }: { hud: HudState }) {
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
      <div className="vitals__rate">
        signal rate · 2s buckets
        {hud.running + hud.queued > 0 ? (
          <span className="vitals__queue"> · running {hud.running} · queued {hud.queued}</span>
        ) : null}
      </div>
    </div>
  );
}

export const widget: WidgetDef = {
  id: "vitals",
  name: "System status",
  render: (hud) => <Vitals hud={hud} />,
  defaultSlot: "left-top",
};
