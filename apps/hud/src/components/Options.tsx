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

  // Stable callback + status only — not the whole `hud` (which changes each tick).
  const fetchConfig = hud.fetchConfig;
  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((c) => alive && setCfg(c))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [fetchConfig, hud.status]);

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

  function Text({ label, k, running, placeholder }: { label: string; k: string; running: string; placeholder?: string }) {
    return (
      <div className="opt__row">
        <span className="opt__key">{label}</span>
        <input
          className="opt__select"
          value={valueOf(k, running)}
          placeholder={placeholder}
          onChange={(e) => change(k, e.target.value)}
        />
      </div>
    );
  }

  // Disabled-provider set (edited overlay > saved > running), and its toggle.
  const disabledSet = new Set(
    valueOf("models.disabled", cfg.models.disabled.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const toggleProvider = (id: string) => {
    if (disabledSet.has(id)) disabledSet.delete(id);
    else disabledSet.add(id);
    change("models.disabled", [...disabledSet].join(","));
  };

  return (
    <div className="options">
      <h1 className="options__title">Options</h1>
      <p className="options__lead">
        Edit settings here — they persist to the config file and apply live (new
        operations use them immediately). Env vars still override at runtime.
      </p>

      {dirty ? <div className="opt__banner">Saved &amp; applied live.</div> : null}

      <section className="opt">
        <h2 className="opt__h">Routing</h2>
        <Select label="Router brain" k="router.defaultProvider" running={cfg.router.defaultProvider} options={["haiku", "ollama", "openai"]} />
        <Select label="Claude transport" k="router.transport" running={cfg.router.transport} options={["sdk", "headless"]} />
        <p className="opt__hint">
          The brain orchestrates fast routing only — it never runs skill work, and
          skills can't change it. <code>sdk</code> uses the Anthropic API (needs a key);
          <code> headless</code> runs a hidden <code>claude -p</code> session (local login, no key).
          If the chosen brain isn't ready it falls back automatically.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Models &amp; providers</h2>
        <p className="opt__hint">
          Skills pick their execution model by policy; the selector keeps the first
          <em> ready &amp; enabled</em> provider in the fallback order. Toggle a provider off
          to keep it out of selection even when it's set up.
        </p>
        {cfg.providers.map((p) => {
          const enabled = !disabledSet.has(p.id);
          const state = !p.configured ? "not set up" : !p.reachable ? "unreachable" : "ready";
          return (
            <div className="opt__row" key={p.id}>
              <span className="opt__key">
                {p.label}
                <span className={`opt__chip ${p.reachable && p.configured ? "opt__chip--on" : ""}`}>{state}</span>
                <span className="opt__sub">{p.kind} · {p.model}</span>
              </span>
              <button
                className={`opt__toggle ${enabled ? "opt__toggle--on" : ""}`}
                role="switch"
                aria-checked={enabled}
                onClick={() => toggleProvider(p.id)}
              >
                <span className="opt__toggleknob" /> {enabled ? "enabled" : "disabled"}
              </button>
            </div>
          );
        })}
        <Text label="Fallback order" k="models.fallbackOrder" running={cfg.models.fallbackOrder.join(",")} placeholder="claude-code,openai,ollama,haiku" />
        <Text label="Max concurrent tasks" k="tasks.maxConcurrent" running={String(cfg.tasks.maxConcurrent)} placeholder="2" />
        <Text label="OpenAI base URL" k="openai.baseUrl" running={cfg.openai.baseUrl} placeholder="https://api.openai.com/v1" />
        <Text label="OpenAI model" k="openai.model" running={cfg.openai.model} placeholder="gpt-4o-mini" />
        <Text label="Ollama base URL" k="ollama.baseUrl" running={cfg.ollama.baseUrl} placeholder="http://localhost:11434" />
        <Text label="Ollama model" k="ollama.model" running={cfg.ollama.model} placeholder="llama3:8b" />
        <p className="opt__hint">
          The OpenAI provider speaks any OpenAI-compatible endpoint — local (LM Studio,
          vLLM, llama.cpp) or remote (OpenRouter, Together, Groq, OpenAI). Set its key
          under Secrets below.
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
        <h2 className="opt__h">Secrets</h2>
        <p className="opt__hint">
          Stored via <strong>{cfg.secretBackend === "os-keychain" ? "your OS keychain" : "encrypted file"}</strong>;
          never shown again or sent back. Applied live on save.
        </p>
        <SecretField label="Anthropic API key" k="anthropic.apiKey" present={!!cfg.secrets["anthropic.apiKey"]} hud={hud} onSaved={() => setDirty(true)} />
        <SecretField label="OpenAI API key" k="openai.apiKey" present={!!cfg.secrets["openai.apiKey"]} hud={hud} onSaved={() => setDirty(true)} />
        <SecretField label="Outlook static token" k="mail.token" present={!!cfg.secrets["mail.token"]} hud={hud} onSaved={() => setDirty(true)} />
      </section>

      <section className="opt">
        <h2 className="opt__h">Vault</h2>
        <Row label="Path" value={cfg.vault.path} />
      </section>
    </div>
  );
}

function SecretField({ label, k, present, hud, onSaved }: { label: string; k: string; present: boolean; hud: HudState; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const save = () => {
    if (!value.trim()) return;
    void hud.saveSecret(k, value.trim());
    setValue("");
    setSaved(true);
    onSaved();
  };
  return (
    <div className="opt__row">
      <span className="opt__key">
        {label} <span className={`opt__chip ${present || saved ? "opt__chip--on" : ""}`}>{present || saved ? "set ✓" : "not set"}</span>
      </span>
      <span className="opt__secret">
        <input
          className="opt__select"
          type="password"
          placeholder={present ? "replace…" : "paste value"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button className="opt__save" onClick={save}>save</button>
      </span>
    </div>
  );
}
