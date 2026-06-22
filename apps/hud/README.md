# apps/hud — V.A.U.L.T. HUD (Phase 4)

Vite + React + TS dashboard. Talks to the gateway over WebSocket.

## Widget-based, customizable layout

Panels are **widget containers**, not fixed layouts. The **left** and **right**
panels each expose three drop slots — **top / middle / bottom** — and widgets
are **draggable** between slots, so the user composes their own HUD. A shipped
**default view** defines the initial arrangement; layout is persisted (per-user
config). The center core is fixed.

- **Center** (fixed): animated particle **core**, reacting to OS state (idle / listening / thinking / speaking).
- **Left / right panels** (top·middle·bottom slots, drag-to-arrange): host widgets.
- **Top bar**: title + live clock; **notification bubbles** with a **Clear-all** control.
- **Bottom**: automated task progress bar + headline counter.

### Widget catalog (each panel slot takes one)
- **Vital metrics** — sparkline gauges.
- **Operations log** — recent OS actions.
- **Action cards** — dynamic, click-to-run actions.
- **V.A.U.L.T. feed** — live view of the latest operations written to the
  Obsidian vault storage (this is what the center label refers to); doubles as
  the document audit trail.
- **Event schedule** — upcoming items from the vault.

> Not scaffolded yet — created in Phase 4. "V.A.U.L.T." is the label of the
> vault-operations widget, not the product name. Default view + drag-to-arrange
> widget slots are the agreed Phase 4 design.
