/**
 * Widget registry — auto-discovers every widget module. There is NO central
 * list: each widget is a self-contained folder under `widgets/<id>/` whose
 * `index.tsx` exports a `widget: WidgetDef`. Vite's import.meta.glob collects
 * them at build time, so adding a widget = dropping a folder (and a third party
 * can ship one without touching core). Build-time discovery — rebuild to pick
 * up new folders.
 */
import type { WidgetDef, WidgetId } from "./widgets/_contract.js";

export type { WidgetDef, WidgetId };

const modules = import.meta.glob<{ widget: WidgetDef }>("./widgets/*/index.tsx", { eager: true });

export const WIDGETS: Record<WidgetId, WidgetDef> = (() => {
  const map: Record<WidgetId, WidgetDef> = {};
  for (const mod of Object.values(modules)) {
    const w = mod.widget;
    if (!w?.id) continue;
    if (map[w.id]) console.warn(`[widgets] duplicate widget id "${w.id}" — keeping the first`);
    else map[w.id] = w;
  }
  return map;
})();

export const ALL_WIDGET_IDS: WidgetId[] = Object.keys(WIDGETS);

export function widgetDef(id: WidgetId): WidgetDef | undefined {
  return WIDGETS[id];
}

export function hasOptions(id: WidgetId): boolean {
  return (WIDGETS[id]?.options?.length ?? 0) > 0;
}
