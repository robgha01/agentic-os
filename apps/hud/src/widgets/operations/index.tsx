/** Operations — the active operation's live streaming output. */
import type { HudState, OperationView } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { Empty } from "../_shared.js";

function statusGlyph(o: OperationView): string {
  return o.status === "running" ? "◍" : o.status === "done" ? "●" : "✕";
}

function Operations({ hud }: { hud: HudState }) {
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

export const widget: WidgetDef = {
  id: "operations",
  name: "Operations",
  render: (hud) => <Operations hud={hud} />,
  defaultSlot: "right-bottom",
};
