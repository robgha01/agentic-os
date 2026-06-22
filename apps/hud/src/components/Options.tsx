/**
 * Options view — reads the gateway's sanitized config and lets you edit the
 * non-secret settings (modes, providers, transport). Edits POST to the gateway,
 * persist to settings.json, and apply on the next gateway restart. Secrets are
 * never entered here (Outlook uses device-code sign-in).
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
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

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

  // Effective control value: pending edit > saved overlay > running config.
  const valueOf = (key: string, running: string) => edits[key] ?? cfg.saved[key] ?? running;

  const change = (key: string, value: string) => {
    setEdits((e) => ({ ...e, [key]: value }));
    setDirty(true);
    void hud.saveSettings({ [key]: value });
  };

  function Select({ label, k, running, options }: { label: string; k: string; running: string; options: string[] }) {
    return (
      <div className="opt__row">
        <span className="opt__key">{label}</span>
        <select className="opt__select" value={valueOf(k, running)} onChange={(e) => change(k, e.target.value)}>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="options">
      <h1 className="options__title">Options</h1>
      <p className="options__lead">
        Edit non-secret settings here — they persist and apply on the next gateway
        restart. Secrets aren't entered here (Outlook uses device-code sign-in).
      </p>

      {dirty ? (
        <div className="opt__banner">Saved. Restart the gateway (<code>npm run start</code>) to apply.</div>
      ) : null}

      <section className="opt">
        <h2 className="opt__h">Routing</h2>
        <Select label="Router brain" k="router.defaultProvider" running={cfg.router.defaultProvider} options={["haiku", "llama3"]} />
        <Select label="Claude transport" k="router.transport" running={cfg.router.transport} options={["sdk", "headless"]} />
        <p className="opt__hint">
          <code>sdk</code> uses the Anthropic API (needs <code>ANTHROPIC_API_KEY</code>);
          <code> headless</code> runs a hidden <code>claude -p</code> session (local Claude Code login).
          This transport also powers research synthesis.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Voice</h2>
        <Select label="Mode" k="voice.mode" running={cfg.voice.mode} options={["text", "voice"]} />
        <Select label="TTS engine" k="voice.tts.provider" running={cfg.voice.tts} options={["kokoro", "openai", "elevenlabs"]} />
        <Select label="STT engine" k="voice.stt.provider" running={cfg.voice.stt} options={["faster-whisper", "openai"]} />
        <p className="opt__hint">
          <code>voice</code> mode uses the Python sidecar; cloud engines need their key set in the environment.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Mail (inbox triage)</h2>
        <Select label="Provider" k="mail.provider" running={cfg.mail.provider} options={["none", "outlook", "gmail", "imap"]} />
        <Select label="Token source" k="mail.tokenSource" running={cfg.mail.tokenSource} options={["device-code", "command", "env"]} />
        <Row label="Outlook" value={cfg.mail.signedIn ? "signed in ✓" : "not connected"} />
        {cfg.mail.provider === "outlook" ? (
          <button className="opt__btn" onClick={() => hud.send({ type: "invoke", skillId: "inbox-triage" })}>
            {cfg.mail.signedIn ? "Run triage" : "Connect Outlook (device-code sign-in)"}
          </button>
        ) : null}
      </section>

      <section className="opt">
        <h2 className="opt__h">Research sources</h2>
        {cfg.research.sources.map((s) => (
          <Row key={s.id} label={s.label} value={s.auth} />
        ))}
        <p className="opt__hint">
          Both keyless. Reddit can rate-limit from some networks; an authenticated
          script-app token is a planned option. Synthesis quality depends on the
          Claude transport above.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Vault</h2>
        <Row label="Path" value={cfg.vault.path} />
      </section>
    </div>
  );
}
