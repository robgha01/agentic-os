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

/**
 * Voice-sidecar status pill + one-click on/off, sitting next to the gateway
 * connection status. Polls /voice/health so it reflects a sidecar started or
 * stopped anywhere; the click starts it (offline) or stops it (online).
 */
function SidecarToggle({ hud }: { hud: HudState }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable method refs — `hud` is a new object each tick, so depending on it
  // would restart the poller constantly.
  const { getSidecarHealth, startSidecar, stopSidecar } = hud;

  useEffect(() => {
    let alive = true;
    const poll = () =>
      getSidecarHealth()
        .then((h) => alive && setOnline(h.online))
        .catch(() => alive && setOnline(false));
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [getSidecarHealth]);

  const toggle = async () => {
    setBusy(true);
    try {
      setOnline((online ? await stopSidecar() : await startSidecar()).online);
    } catch {
      /* a notification event covers the failure */
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? "sidecar …" : online == null ? "sidecar …" : online ? "sidecar on" : "sidecar off";
  return (
    <button
      className={`sidecar-pill ${online ? "sidecar-pill--on" : ""}`}
      onClick={toggle}
      disabled={busy}
      role="switch"
      aria-checked={!!online}
      title={online ? "Voice sidecar running — click to stop" : "Voice sidecar stopped — click to start"}
    >
      {label}
    </button>
  );
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
        <SidecarToggle hud={hud} />
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
