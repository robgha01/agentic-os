/**
 * A vertical drag handle between a side panel and the center stage. Reports the
 * live pointer x while dragging; the parent clamps it into a panel width. Also
 * keyboard-operable: focus it and use ←/→ to nudge (Shift = larger step), which
 * the parent clamps identically. Exposes aria-value* so assistive tech reads the
 * current width. Hidden below the mobile breakpoint by CSS (the stage stacks).
 */
import { useCallback, useRef } from "react";
import { MAX_PANEL, MIN_PANEL } from "../panel-size.js";

export function PanelResizer({
  side, width, onResize, onNudge,
}: {
  side: "left" | "right";
  width: number;
  onResize: (clientX: number) => void;
  onNudge: (deltaPx: number) => void;
}) {
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) onResize(e.clientX);
  }, [onResize]);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  // ←/→ nudge the width. A right-hand panel grows leftward, so its arrow mapping
  // is mirrored: ArrowLeft widens it, ArrowRight narrows it.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = side === "left" ? -step : step;
    else if (e.key === "ArrowRight") delta = side === "left" ? step : -step;
    else return;
    e.preventDefault();
    onNudge(delta);
  }, [side, onNudge]);

  return (
    <div
      className={`resizer resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      aria-valuemin={MIN_PANEL}
      aria-valuemax={MAX_PANEL}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
