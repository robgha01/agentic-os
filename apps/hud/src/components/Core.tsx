/**
 * The animated particle core — the HUD's signature element. A point-cloud
 * sphere (Fibonacci distribution) rotates and pulses, colored along the
 * magenta->violet axis by depth. Its motion encodes the OS state:
 *   idle = slow drift · listening = steady pulse · thinking = fast swirl ·
 *   speaking = outward ripple. Honors prefers-reduced-motion (static frame).
 */
import { useEffect, useRef } from "react";
import type { CoreState } from "../useGateway.js";

interface Point {
  x: number;
  y: number;
  z: number;
}

function fibonacciSphere(n: number): Point[] {
  const pts: Point[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

const STATE_SPEED: Record<CoreState, number> = {
  idle: 0.0016,
  listening: 0.0028,
  thinking: 0.0072,
  speaking: 0.004,
};

export function Core({ state }: { state: CoreState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CoreState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const points = fibonacciSphere(420);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let angle = 0;
    let t = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.32;
      const s = stateRef.current;
      const pulse =
        s === "speaking" ? Math.sin(t * 0.12) * 0.08 : s === "listening" ? Math.sin(t * 0.06) * 0.04 : 0;
      const radius = baseR * (1 + pulse);

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cosB = Math.cos(angle * 0.6);
      const sinB = Math.sin(angle * 0.6);

      for (const p of points) {
        // rotate around Y then X
        const x1 = p.x * cosA - p.z * sinA;
        const z1 = p.x * sinA + p.z * cosA;
        const y1 = p.y * cosB - z1 * sinB;
        const z2 = p.y * sinB + z1 * cosB;
        const depth = (z2 + 1) / 2; // 0..1 (back..front)
        const px = cx + x1 * radius;
        const py = cy + y1 * radius;
        const size = 0.6 + depth * 2.0;
        // magenta (#ff3d9a) -> violet (#7b5cff) by depth
        const r = Math.round(255 + (123 - 255) * depth);
        const g = Math.round(61 + (92 - 61) * depth);
        const b = Math.round(154 + (255 - 154) * depth);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r},${g},${b},${0.25 + depth * 0.7})`;
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduced) {
        angle += STATE_SPEED[stateRef.current];
        t += 1;
        raf = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`core core--${state}`}>
      <canvas ref={canvasRef} className="core__canvas" />
      <div className="core__halo" aria-hidden />
    </div>
  );
}
