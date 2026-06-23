/** Schedule — upcoming items (placeholder until the vault feeds it). */
import type { WidgetDef } from "../_contract.js";
import { Empty } from "../_shared.js";

function Schedule() {
  return <Empty>No scheduled items. Morning brief and events surface here once the vault has them.</Empty>;
}

export const widget: WidgetDef = {
  id: "schedule",
  name: "Schedule",
  render: () => <Schedule />,
  // no defaultSlot — lives in the add-widget palette until placed
};
