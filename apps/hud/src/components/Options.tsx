/**
 * Options view — reads the gateway's sanitized config and shows the state of
 * each integration plus how to enable it. No secrets cross the wire. Actions
 * that can be triggered safely (e.g. starting the Outlook device-code sign-in)
 * are offered as buttons; credential entry from the UI is a planned follow-up.
 */
import { useEffect, useState } from "react";
import type { ConfigView } from "../gateway.js";
import type { HudState } from "../useGateway.js";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="opt__row">
      <span className="opt__key">{label}</span>
      <span className="opt__val">{value}</span>
    </div>
  );
}

export function Options({ hud }: { hud: HudState }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    hud
      .fetchConfig()
      .then((c) => alive && setCfg(c))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [hud, hud.status]);

  if (error) return <div className="options"><div className="empty">Gateway offline — start it with <code>npm run start</code>.</div></div>;
  if (!cfg) return <div className="options"><div className="empty">Loading settings…</div></div>;

  return (
    <div className="options">
      <h1 className="options__title">Options</h1>
      <p className="options__lead">
        Current configuration. Most settings are environment variables read at
        gateway start (see each card). Editing them in-app is coming.
      </p>

      <section className="opt">
        <h2 className="opt__h">Routing</h2>
        <Row label="Router brain" value={cfg.router.defaultProvider} />
        <Row label="Transport" value={cfg.router.transport} />
        <p className="opt__hint">
          Transport is global: <code>sdk</code> uses the Anthropic API (needs
          <code> ANTHROPIC_API_KEY</code>); <code>headless</code> runs a hidden
          <code> claude -p</code> session (uses your local Claude Code login).
          Set <code>AGENTIC_OS_ROUTER_TRANSPORT</code>.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Voice</h2>
        <Row label="Mode" value={cfg.voice.mode} />
        <Row label="STT · TTS" value={`${cfg.voice.stt} · ${cfg.voice.tts}`} />
        <p className="opt__hint">
          <code>text</code> mode (default) needs nothing — replies arrive as
          text. <code>voice</code> mode uses the Python sidecar (local or cloud).
          Set <code>AGENTIC_OS_VOICE_MODE=voice</code>.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Mail (inbox triage)</h2>
        <Row label="Provider" value={cfg.mail.provider} />
        <Row label="Token source" value={cfg.mail.tokenSource} />
        <Row label="Outlook" value={cfg.mail.signedIn ? "signed in ✓" : "not connected"} />
        {cfg.mail.provider === "outlook" ? (
          <button className="opt__btn" onClick={() => hud.send({ type: "invoke", skillId: "inbox-triage" })}>
            {cfg.mail.signedIn ? "Run triage" : "Connect Outlook (device-code sign-in)"}
          </button>
        ) : (
          <p className="opt__hint">
            Enable with <code>AGENTIC_OS_MAIL_PROVIDER=outlook</code>. First run
            shows a device-code sign-in (no Azure app needed).
          </p>
        )}
      </section>

      <section className="opt">
        <h2 className="opt__h">Research sources</h2>
        {cfg.research.sources.map((s) => (
          <Row key={s.id} label={s.label} value={s.auth} />
        ))}
        <p className="opt__hint">
          Both are keyless. Reddit can rate-limit (HTTP 429/403) from some
          networks; an authenticated Reddit "script app" token (id + secret) is a
          planned option for reliable access.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Vault</h2>
        <Row label="Path" value={cfg.vault.path} />
      </section>
    </div>
  );
}
