/** V.A.U.L.T. feed — recent vault records; click one to open it. */
import type { HudState } from "../../useGateway.js";
import type { WidgetDef } from "../_contract.js";
import { Empty, timeOf } from "../_shared.js";

function VaultFeed({ hud }: { hud: HudState }) {
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

export const widget: WidgetDef = {
  id: "vault",
  name: "V.A.U.L.T. feed",
  render: (hud) => <VaultFeed hud={hud} />,
  defaultSlot: "right-mid",
};
