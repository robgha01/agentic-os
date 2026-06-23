/**
 * Per-widget options — an opt-in interface a widget can implement to expose its
 * own settings. A widget that declares fields here gets a cogwheel in its panel
 * header; clicking it reveals an inline options panel. Values persist per widget
 * in localStorage and are passed into the widget's render.
 *
 * Widgets without an entry have no cog and no options — it's entirely optional.
 */
import type { WidgetId } from "./layout.js";

export type WidgetOptionType = "text" | "number" | "toggle" | "select";

export interface WidgetOptionField {
  key: string;
  label: string;
  type: WidgetOptionType;
  /** Default value when the user hasn't set one. */
  default: string | number | boolean;
  /** Options for `select`. */
  choices?: string[];
  placeholder?: string;
  hint?: string;
}

export type WidgetOptions = Record<string, string | number | boolean>;

/** Widgets that implement options declare their fields here. */
export const WIDGET_OPTIONS: Partial<Record<WidgetId, WidgetOptionField[]>> = {
  "ai-wire": [
    { key: "topic", label: "Theme", type: "text", default: "", placeholder: "default AI-industry theme", hint: "Passed to the skill on refresh." },
    { key: "max", label: "Max bullets", type: "number", default: 8 },
  ],
};

/** Does this widget implement the options interface? */
export function hasOptions(id: WidgetId): boolean {
  return Array.isArray(WIDGET_OPTIONS[id]) && WIDGET_OPTIONS[id]!.length > 0;
}

/** Defaults merged with any persisted values for one widget. */
export function resolveOptions(id: WidgetId, stored?: WidgetOptions): WidgetOptions {
  const fields = WIDGET_OPTIONS[id] ?? [];
  const out: WidgetOptions = {};
  for (const f of fields) out[f.key] = stored?.[f.key] ?? f.default;
  return out;
}

const KEY = (id: WidgetId) => `aos.widget.opts.${id}`;

export function loadWidgetOptions(id: WidgetId): WidgetOptions {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as WidgetOptions) : {};
  } catch {
    return {};
  }
}

export function saveWidgetOptions(id: WidgetId, opts: WidgetOptions): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(opts));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
