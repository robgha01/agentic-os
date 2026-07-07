/**
 * Side-panel widths — pure clamp helpers + localStorage persistence. The center
 * (the particle Core) must never be crushed, so a panel is clamped per-panel AND
 * against the viewport so `CENTER_MIN` px always remain for the stage's middle.
 */
export interface PanelWidths { left: number; right: number }

export const MIN_PANEL = 220;
export const MAX_PANEL = 520;
export const CENTER_MIN = 360;
export const DEFAULT_WIDTHS: PanelWidths = { left: 300, right: 340 };

export function clampPanel(px: number): number {
  return Math.max(MIN_PANEL, Math.min(MAX_PANEL, Math.round(px)));
}

/** Clamp a panel so the center keeps CENTER_MIN given the other panel + viewport. */
export function clampAgainstViewport(px: number, otherPanelPx: number, viewportPx: number): number {
  const maxForCenter = viewportPx - otherPanelPx - CENTER_MIN;
  return Math.max(MIN_PANEL, Math.min(clampPanel(px), maxForCenter));
}

const KEY = "aos.hud.panelWidths.v1";

export function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WIDTHS };
    const p = JSON.parse(raw) as Partial<PanelWidths>;
    return {
      left: clampPanel(typeof p.left === "number" ? p.left : DEFAULT_WIDTHS.left),
      right: clampPanel(typeof p.right === "number" ? p.right : DEFAULT_WIDTHS.right),
    };
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

export function savePanelWidths(w: PanelWidths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
