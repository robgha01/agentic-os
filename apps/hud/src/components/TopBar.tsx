/**
 * Top bar — the wordmark, connection status, a live clock, and the notification
 * bubbles with a clear-all control.
 */
import { useEffect, useState } from "react";
import type { HudState } from "../useGateway.js";

export type ViewId = "dashboard" | "options";
const VIEWS: { id: ViewId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "options", label: "Options" },
];

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour12: false });
}

export function TopBar({ hud, view, onNav }: { hud: HudState; view: ViewId; onNav: (v: ViewId) => void }) {
  const clock = useClock();
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="brand">V.A.U.L.T.</span>
        <nav className="nav">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`nav__link ${view === v.id ? "nav__link--active" : ""}`}
              onClick={() => onNav(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <span className={`status status--${hud.status}`}>{hud.status}</span>
      </div>

      <div className="topbar__notes">
        {hud.notifications.length > 0 ? (
          <>
            <ul className="bubbles">
              {hud.notifications.slice(0, 4).map((n) => (
                <li className={`bubble bubble--${n.level}`} key={n.id} title={n.message}>
                  {n.message}
                </li>
              ))}
            </ul>
            <button className="clear" onClick={hud.clearNotifications} title="Clear all notifications">
              clear all{hud.notifications.length > 4 ? ` (${hud.notifications.length})` : ""}
            </button>
          </>
        ) : (
          <span className="topbar__quiet">no notifications</span>
        )}
      </div>

      <time className="topbar__clock">{clock}</time>
    </header>
  );
}
