/** Small presentational helpers shared across widget modules. */
import type { ReactNode } from "react";

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function timeOf(iso: string): string {
  return (iso.split("T")[1] ?? "").slice(0, 8);
}

export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const w = 100;
  const h = 24;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--magenta)" strokeWidth="1.5" />
    </svg>
  );
}
