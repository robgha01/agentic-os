/**
 * Widget registry — the single source of truth for every HUD widget. One entry
 * declares a widget's id (machine), name (display), optional eyebrow/tagline,
 * how it renders, the options it exposes (opt-in), and where it sits by default.
 *
 * Add a widget = add one entry here. Everything (titles, the options cog, the
 * default layout, the add-widget palette) derives from this map.
 */
import type { ReactNode } from "react";
import type { HudState } from "./useGateway.js";
import type { SlotId } from "./layout.js";
import type { WidgetOptionField, WidgetOptions } from "./widget-options.js";
import {
  AiWire,
  AudioIO,
  CommandDeck,
  OperationsLog,
  Schedule,
  VaultFeed,
  VitalMetrics,
} from "./components/widgets.js";

export interface WidgetDef {
  /** Machine id (stable, used in layout + storage). */
  id: string;
  /** Display name shown in the header and the palette. */
  name: string;
  /** Optional tagline under the name (e.g. "MORNING.INTEL"). */
  eyebrow?: string;
  /** Render the widget body from live state + resolved options. */
  render: (hud: HudState, options: WidgetOptions) => ReactNode;
  /** Options the widget exposes — presence enables the header cog. */
  options?: WidgetOptionField[];
  /** Default slot in a fresh layout; omit to leave it in the palette. */
  defaultSlot?: SlotId;
}

export type WidgetId = "vitals" | "ai-wire" | "audio" | "deck" | "vault" | "operations" | "schedule";

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  vitals: {
    id: "vitals",
    name: "System status",
    render: (hud) => <VitalMetrics hud={hud} />,
    defaultSlot: "left-top",
  },
  "ai-wire": {
    id: "ai-wire",
    name: "AI Wire",
    eyebrow: "morning.intel",
    render: (hud, options) => <AiWire hud={hud} options={options} />,
    options: [
      { key: "topic", label: "Theme", type: "text", default: "", placeholder: "default AI-industry theme", hint: "Passed to the skill on refresh." },
      { key: "max", label: "Max bullets", type: "number", default: 8 },
    ],
    defaultSlot: "left-mid",
  },
  audio: {
    id: "audio",
    name: "Audio I/O",
    eyebrow: "voice.link",
    render: (hud) => <AudioIO hud={hud} />,
    defaultSlot: "left-bottom",
  },
  deck: {
    id: "deck",
    name: "Command deck",
    render: (hud) => <CommandDeck hud={hud} />,
    defaultSlot: "right-top",
  },
  vault: {
    id: "vault",
    name: "V.A.U.L.T. feed",
    render: (hud) => <VaultFeed hud={hud} />,
    defaultSlot: "right-mid",
  },
  operations: {
    id: "operations",
    name: "Operations",
    render: (hud) => <OperationsLog hud={hud} />,
    defaultSlot: "right-bottom",
  },
  schedule: {
    id: "schedule",
    name: "Schedule",
    render: () => <Schedule />,
    // no defaultSlot — lives in the add-widget palette until placed
  },
};

export const ALL_WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export function widgetDef(id: WidgetId): WidgetDef {
  return WIDGETS[id];
}

export function hasOptions(id: WidgetId): boolean {
  return (WIDGETS[id].options?.length ?? 0) > 0;
}
