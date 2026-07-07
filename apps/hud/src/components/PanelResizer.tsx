/**
 * A vertical drag handle between a side panel and the center stage. Reports the
 * live pointer x while dragging; the parent clamps it into a panel width. Hidden
 * below the mobile breakpoint by CSS (the stage stacks there).
 */
import { useCallback, useRef } from "react";

export function PanelResizer({ side, onResize }: { side: "left" | "right"; onResize: (clientX: number) => void }) {
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

  return (
    <div
      className={`resizer resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
