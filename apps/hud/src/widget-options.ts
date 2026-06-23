/**
 * Per-widget options — an opt-in interface a widget can implement to expose its
 * own settings. A widget declares `options` fields in the widget registry; if it
 * has any, its panel header shows a cogwheel that reveals an inline options form.
 * Values persist per widget in localStorage and are passed into the widget render.
 *
 * Widgets without `options` have no cog — it's entirely optional.
 */
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

/** Defaults merged with any persisted values for one widget. */
export function resolveOptions(fields: WidgetOptionField[] | undefined, stored?: WidgetOptions): WidgetOptions {
  const out: WidgetOptions = {};
  for (const f of fields ?? []) out[f.key] = stored?.[f.key] ?? f.default;
  return out;
}

const KEY = (id: string) => `aos.widget.opts.${id}`;

export function loadWidgetOptions(id: string): WidgetOptions {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as WidgetOptions) : {};
  } catch {
    return {};
  }
}

export function saveWidgetOptions(id: string, opts: WidgetOptions): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(opts));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
