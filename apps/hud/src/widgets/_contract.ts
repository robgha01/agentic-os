/**
 * Widget contract — the shape every widget module exports. A widget is a
 * self-contained folder under `widgets/<id>/` whose `index.tsx` exports a
 * `widget: WidgetDef`. The registry auto-discovers them (no central list), so
 * adding a widget = dropping a folder; nothing in core needs editing.
 */
import type { ReactNode } from "react";
import type { HudState } from "../useGateway.js";
import type { SlotId } from "../layout.js";
import type { WidgetOptionField, WidgetOptions } from "../widget-options.js";

export type { WidgetOptionField, WidgetOptions };

/** Ids are dynamic (discovered at build time), so this is a runtime-validated string. */
export type WidgetId = string;

export interface WidgetDef {
  /** Machine id — must be unique; also the folder name by convention. */
  id: WidgetId;
  /** Display name shown in the header and the add-widget palette. */
  name: string;
  /** Optional tagline under the name (e.g. "morning.intel"). */
  eyebrow?: string;
  /** Render the body from live state + resolved options. */
  render: (hud: HudState, options: WidgetOptions) => ReactNode;
  /** Options the widget exposes — presence enables the header cog. */
  options?: WidgetOptionField[];
  /** Default slot in a fresh layout; omit to leave it in the palette. */
  defaultSlot?: SlotId;
}
