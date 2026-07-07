/**
 * Options view — reads the gateway's sanitized config and lets you edit the
 * non-secret settings (modes, providers, transport). Edits POST to the gateway,
 * persist to settings.json, and apply on the next gateway restart. Secrets are
 * never entered here (Outlook uses device-code sign-in).
 */
import { useEffect, useState } from "react";
import { GATEWAY_BASE, getGatewayOverride, normalizeGatewayUrl, setGatewayOverride, type ConfigView } from "../gateway.js";
import type { HudState } from "../useGateway.js";
import { Select, Text } from "./opt-controls.js";
import { VoiceOptions } from "./VoiceOptions.js";

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

  // Bind a config key to the hoisted controls: effective value + change handler.
  const bind = (k: string, running: string) => ({
    value: valueOf(k, running),
    onChange: (v: string) => change(k, v),
  });

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

  // Disabled research-source set (same CSV pattern): pending edit > running
  // (the off sources implied by /config's enabled flags).
  const researchRunning = cfg.research.sources.filter((s) => !s.enabled).map((s) => s.id).join(",");
  const researchOff = new Set(
    valueOf("research.disabled", researchRunning)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const toggleSource = (id: string) => {
    if (researchOff.has(id)) researchOff.delete(id);
    else researchOff.add(id);
    change("research.disabled", [...researchOff].join(","));
  };

  // Hide the auto-generated daily journal from the feed (default on).
  const hideDaily = valueOf("vault.hideDailyFromFeed", "true") === "true";

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
        <Select label="Router brain" {...bind("router.defaultProvider", cfg.router.defaultProvider)} options={["haiku", "ollama", "openai"]} />
        <Select label="Claude transport" {...bind("router.transport", cfg.router.transport)} options={["sdk", "headless"]} />
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
        <Text label="Fallback order" {...bind("models.fallbackOrder", cfg.models.fallbackOrder.join(","))} placeholder="claude-code,openai,ollama,haiku" />
        <Text label="Max concurrent tasks" {...bind("tasks.maxConcurrent", String(cfg.tasks.maxConcurrent))} placeholder="2" />
        <Text label="OpenAI base URL" {...bind("openai.baseUrl", cfg.openai.baseUrl)} placeholder="https://api.openai.com/v1" />
        <Text label="OpenAI model" {...bind("openai.model", cfg.openai.model)} placeholder="gpt-4o-mini" />
        <Text label="Ollama base URL" {...bind("ollama.baseUrl", cfg.ollama.baseUrl)} placeholder="http://localhost:11434" />
        <Text label="Ollama model" {...bind("ollama.model", cfg.ollama.model)} placeholder="llama3:8b" />
        <p className="opt__hint">
          The OpenAI provider speaks any OpenAI-compatible endpoint — local (LM Studio,
          vLLM, llama.cpp) or remote (OpenRouter, Together, Groq, OpenAI). Set its key
          under Secrets below.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Vault feed</h2>
        <div className="opt__row">
          <span className="opt__key">
            Hide the daily journal
            <span className="opt__sub">the per-day operations log — still written to the vault, just kept out of the feed</span>
          </span>
          <button
            className={`opt__toggle ${hideDaily ? "opt__toggle--on" : ""}`}
            role="switch"
            aria-checked={hideDaily}
            onClick={() => change("vault.hideDailyFromFeed", hideDaily ? "false" : "true")}
          >
            <span className="opt__toggleknob" /> {hideDaily ? "hidden" : "shown"}
          </button>
        </div>
        <Text label="Obsidian vault name" {...bind("vault.obsidianVault", "")} placeholder="(defaults to the vault folder name)" />
        <p className="opt__hint">
          "Open in Obsidian" builds an <code>obsidian://open?vault=…&amp;file=…</code> link.
          Obsidian only opens notes inside a <em>registered</em> vault, so first add the
          vault folder to Obsidian once ("Open folder as vault"). Set the name here if
          your Obsidian vault isn't named after the folder.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Application window</h2>
        <Select label="Open on launch" {...bind("ui.launch", cfg.ui.launch)} options={["app", "browser", "none"]} />
        <Text label="Browser" {...bind("ui.browser", cfg.ui.browser)} placeholder="auto | chrome | edge | brave | firefox | path" />
        <p className="opt__hint">
          <code>app</code> opens a chromeless Chromium window (Chrome/Edge/Brave); <code>browser</code> opens your
          default browser (any engine); <code>none</code> just serves the HUD at the local URL. Applies to the
          packaged app on next launch.
        </p>
      </section>

      <section className="opt">
        <h2 className="opt__h">Network access</h2>
        {(() => {
          const on = valueOf("security.allowRemoteAccess", String(cfg.security.allowRemoteAccess)) === "true";
          return (
            <div className="opt__row">
              <span className="opt__key">
                Allow remote access
                <span className="opt__sub">reach the HUD from other devices / the machine name</span>
              </span>
              <button
                className={`opt__toggle ${on ? "opt__toggle--on" : ""}`}
                role="switch"
                aria-checked={on}
                onClick={() => change("security.allowRemoteAccess", String(!on))}
              >
                <span className="opt__toggleknob" /> {on ? "on" : "off"}
              </button>
            </div>
          );
        })()}
        <p className="opt__hint">
          Off by default: the gateway serves <code>localhost</code> only and blocks cross-site
          requests (DNS-rebinding + CSRF defense). Turn on to reach it over your LAN —
          only on a network you trust. Applies live.
        </p>
        <GatewayAddress />
      </section>

      <VoiceOptions
        bind={bind}
        mode={cfg.voice.mode}
        ttsValue={valueOf("voice.tts.provider", cfg.voice.tts)}
        voiceValue={valueOf("voice.tts.voice", cfg.voice.voice)}
        sttValue={valueOf("voice.stt.provider", cfg.voice.stt)}
        micModeValue={valueOf("voice.micMode", cfg.voice.micMode ?? "push-to-talk")}
        wakeWordValue={valueOf("voice.wakeWord", cfg.voice.wakeWord ?? "hey jarvis")}
        wakeProviderValue={valueOf("voice.wakeProvider", cfg.voice.wakeProvider ?? "auto")}
        pythonPathValue={valueOf("voice.pythonPath", cfg.voice.python ?? "")}
        hud={hud}
      />

      <section className="opt">
        <h2 className="opt__h">Mail (inbox triage)</h2>
        <Select label="Provider" {...bind("mail.provider", cfg.mail.provider)} options={["none", "outlook", "gmail", "imap"]} />
        <Select label="Token source" {...bind("mail.tokenSource", cfg.mail.tokenSource)} options={["device-code", "command", "env"]} />
        <Row label="Outlook" value={cfg.mail.signedIn ? "signed in ✓" : "not connected"} />
        {cfg.mail.provider === "outlook" ? (
          <button className="opt__btn" onClick={() => hud.send({ type: "invoke", skillId: "inbox-triage" })}>
            {cfg.mail.signedIn ? "Run triage" : "Connect Outlook (device-code sign-in)"}
          </button>
        ) : null}
      </section>

      <section className="opt">
        <h2 className="opt__h">Research sources</h2>
        <p className="opt__hint">
          Sources feeding the deep-research pipeline. Toggle any off to skip it.
          YouTube needs the <code>yt-dlp</code> binary; X needs a bearer token (Secrets below).
        </p>
        {cfg.research.sources.map((s) => {
          const enabled = !researchOff.has(s.id);
          return (
            <div className="opt__row" key={s.id}>
              <span className="opt__key">
                {s.label}
                <span className="opt__sub">{s.auth}</span>
              </span>
              <button
                className={`opt__toggle ${enabled ? "opt__toggle--on" : ""}`}
                role="switch"
                aria-checked={enabled}
                onClick={() => toggleSource(s.id)}
              >
                <span className="opt__toggleknob" /> {enabled ? "on" : "off"}
              </button>
            </div>
          );
        })}
      </section>

      <section className="opt">
        <h2 className="opt__h">Secrets</h2>
        <p className="opt__hint">
          Stored via <strong>{cfg.secretBackend === "os-keychain" ? "your OS keychain" : "encrypted file"}</strong>;
          never shown again or sent back. Applied live on save.
        </p>
        <SecretField label="Anthropic API key" k="anthropic.apiKey" present={!!cfg.secrets["anthropic.apiKey"]} hud={hud} onSaved={() => setDirty(true)} />
        <SecretField label="OpenAI API key" k="openai.apiKey" present={!!cfg.secrets["openai.apiKey"]} hud={hud} onSaved={() => setDirty(true)} />
        <SecretField label="X / Twitter bearer token" k="x.bearerToken" present={!!cfg.secrets["x.bearerToken"]} hud={hud} onSaved={() => setDirty(true)} />
        <SecretField label="Outlook static token" k="mail.token" present={!!cfg.secrets["mail.token"]} hud={hud} onSaved={() => setDirty(true)} />
      </section>

      <section className="opt">
        <h2 className="opt__h">Vault</h2>
        <Row label="Path" value={cfg.vault.path} />
      </section>
    </div>
  );
}

/**
 * Manual gateway address — a client-side override for where the HUD calls the
 * backend. Left blank it auto-resolves (same origin when the gateway serves the
 * HUD, localhost in dev); type an address to point anywhere (e.g. a Tailscale
 * IP). Persisted in localStorage; a reload re-establishes the connection.
 */
function GatewayAddress() {
  const [value, setValue] = useState(getGatewayOverride() ?? "");
  const overridden = getGatewayOverride() != null;
  const apply = () => {
    setGatewayOverride(normalizeGatewayUrl(value));
    window.location.reload();
  };
  const reset = () => {
    setGatewayOverride(null);
    window.location.reload();
  };
  return (
    <>
      <div className="opt__row">
        <span className="opt__key">
          Gateway address
          <span className="opt__sub">{overridden ? "manual" : "auto"} · now: {GATEWAY_BASE}</span>
        </span>
        <span className="opt__secret">
          <input
            className="opt__select"
            value={value}
            placeholder="auto — or e.g. http://100.x.y.z:7777"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
          <button className="opt__save" onClick={apply}>set</button>
          {overridden ? <button className="opt__save" onClick={reset}>auto</button> : null}
        </span>
      </div>
      <p className="opt__hint">
        Where this HUD calls the gateway. Blank = auto (the server it was loaded from, or
        <code> localhost</code> in dev). Set it to reach a gateway elsewhere — e.g. your laptop's
        Tailscale address from your phone. Saved on this device; reloads to reconnect.
      </p>
    </>
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
