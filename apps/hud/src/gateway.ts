/**
 * Gateway client — the HUD's single connection to the Agentic OS backend.
 *
 * Holds a WebSocket (auto-reconnecting) for the live event stream, fetches the
 * command-deck catalog over HTTP, and sends ClientCommands (route / invoke /
 * ping). Pure transport — React state lives in useGateway.
 */
import { parseOsEvent, type ClientCommand, type OsEvent, type SkillCard } from "@aos/shared";

const OVERRIDE_KEY = "aos.gateway.url";

/** The manual gateway address the user typed (persisted client-side), or null. */
export function getGatewayOverride(): string | null {
  try {
    return localStorage.getItem(OVERRIDE_KEY);
  } catch {
    return null; // private mode / no storage
  }
}

/** Set (or clear, with null) the manual gateway address. Caller reloads to apply. */
export function setGatewayOverride(url: string | null): void {
  try {
    if (url) localStorage.setItem(OVERRIDE_KEY, url);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* nothing to persist */
  }
}

/** Normalize a typed address into a base URL: add a scheme, drop any path/trailing slash. */
export function normalizeGatewayUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`;
  try {
    return new URL(withScheme).origin; // scheme + host + port only
  } catch {
    return null;
  }
}

/**
 * Where the HUD calls the gateway, most-specific first:
 *  1. a manual address the user typed (persisted, client-side) — always wins
 *  2. a build-time VITE_GATEWAY_URL (custom deploys)
 *  3. dev — the gateway runs on :7777 while Vite serves the HUD on :5173
 *  4. served by the gateway — talk back to the exact origin the page loaded from,
 *     so a phone opening http://laptop:7777 connects to the laptop, not its own localhost
 *  5. localhost fallback (non-browser / opaque origin)
 */
function resolveGatewayBase(): string {
  const override = getGatewayOverride();
  if (override) return override;
  if (import.meta.env.VITE_GATEWAY_URL) return import.meta.env.VITE_GATEWAY_URL;
  if (import.meta.env.DEV) return "http://localhost:7777";
  const origin = typeof window !== "undefined" ? window.location?.origin : "";
  if (origin && /^https?:/.test(origin)) return origin;
  return "http://localhost:7777";
}

/** The effective gateway base URL this session resolved to (for display). */
export const GATEWAY_BASE = resolveGatewayBase();
const HTTP_BASE = GATEWAY_BASE;
const WS_URL = HTTP_BASE.replace(/^http/, "ws");

export type ConnectionStatus = "connecting" | "online" | "offline";

/** A vault record summary (V.A.U.L.T. feed row). */
export interface VaultSummary {
  type: string;
  key: string;
  title: string;
  updated: string;
  path: string;
}

/** A vault record's content for the viewer. */
export interface VaultDoc {
  frontmatter: Record<string, unknown>;
  body: string;
  path?: string;
  /** obsidian:// deep link to open the note in Obsidian. */
  obsidianUri?: string;
}

/** Sanitized gateway configuration for the Options view. */
export interface ProviderStatus {
  id: string;
  label: string;
  kind: string;
  configured: boolean;
  reachable: boolean;
  enabled: boolean;
  model: string;
}

/** kokoro-onnx (and future installable engines) model-file readiness. */
export interface TtsStatus {
  provider: string;
  installable: boolean;
  ready: boolean;
  missing: string[];
  error?: string;
}

/** Whether the optional misaki G2P is installed in the sidecar's Python env. */
export interface MisakiStatus {
  installed: boolean;
  error?: string;
}

/** Reachability of the Python voice sidecar + its configured engines. */
export interface SidecarHealth {
  online: boolean;
  tts?: string;
  stt?: string;
}

/** Result of a gateway-managed sidecar start/stop. */
export interface SidecarActionResult {
  online: boolean;
  started?: boolean;
  stopped?: boolean;
  note?: string;
  error?: string;
}

/** Detected Python environment for the sidecar (interpreter + tooling). */
export interface VoiceEnv {
  python: string | null;
  source: "config" | "venv" | "path" | "none";
  version: string | null;
  uv: boolean;
  venv: boolean;
}

export interface ConfigView {
  router: { defaultProvider: string; transport: string };
  voice: { mode: string; announce: boolean; stt: string; tts: string; voice: string; python: string };
  mail: { provider: string; tokenSource: string; signedIn: boolean };
  research: { sources: { id: string; label: string; auth: string; enabled: boolean }[] };
  providers: ProviderStatus[];
  models: { fallbackOrder: string[]; disabled: string[] };
  tasks: { maxConcurrent: number };
  security: { allowRemoteAccess: boolean };
  ui: { launch: string; browser: string };
  openai: { baseUrl: string; model: string };
  ollama: { baseUrl: string; model: string };
  vault: { path: string };
  /** Last-saved settings overlay (may differ from running until restart). */
  saved: Record<string, string>;
  /** Secret presence only (never values), keyed by secret key. */
  secrets: Record<string, boolean>;
  /** Where secrets are stored: "os-keychain" or "encrypted-file". */
  secretBackend: string;
}

export class GatewayClient {
  private ws?: WebSocket;
  private reconnectTimer?: number;
  private closed = false;
  private attempts = 0;

  constructor(
    private readonly onEvent: (event: OsEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    this.onStatus("connecting");
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.onStatus("online");
    };
    ws.onmessage = (msg) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.data as string);
      } catch {
        return; // not JSON — drop
      }
      // Schema-validate before folding into state — bad frames never reach the reducer.
      const event = parseOsEvent(parsed);
      if (event) this.onEvent(event);
      else console.warn("[gateway] dropped malformed event frame", parsed);
    };
    ws.onclose = () => {
      this.onStatus("offline");
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  /** Exponential backoff (1.5s → 15s cap, ±250ms jitter) so an absent gateway isn't polled every 1.5s forever. */
  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(15_000, 1_500 * 2 ** this.attempts) + Math.random() * 250;
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(command));
  }

  async fetchSkills(): Promise<SkillCard[]> {
    const res = await fetch(`${HTTP_BASE}/skills`);
    const data = (await res.json()) as { skills: SkillCard[] };
    return data.skills;
  }

  async fetchRecent(): Promise<VaultSummary[]> {
    const res = await fetch(`${HTTP_BASE}/vault/recent`);
    const data = (await res.json()) as { records: VaultSummary[] };
    return data.records;
  }

  async fetchDoc(path: string): Promise<VaultDoc | null> {
    const res = await fetch(`${HTTP_BASE}/vault/doc?path=${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    return (await res.json()) as VaultDoc;
  }

  async fetchConfig(): Promise<ConfigView> {
    const res = await fetch(`${HTTP_BASE}/config`);
    return (await res.json()) as ConfigView;
  }

  async saveSettings(partial: Record<string, string>): Promise<void> {
    await fetch(`${HTTP_BASE}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(partial),
    });
  }

  async saveSecret(key: string, value: string): Promise<void> {
    await fetch(`${HTTP_BASE}/secrets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
  }

  async getTtsStatus(provider: string): Promise<TtsStatus> {
    const res = await fetch(`${HTTP_BASE}/voice/tts/status?provider=${encodeURIComponent(provider)}`);
    return (await res.json()) as TtsStatus;
  }

  async installTts(): Promise<TtsStatus> {
    const res = await fetch(`${HTTP_BASE}/voice/tts/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return (await res.json()) as TtsStatus;
  }

  async getSidecarHealth(): Promise<SidecarHealth> {
    const res = await fetch(`${HTTP_BASE}/voice/health`);
    return (await res.json()) as SidecarHealth;
  }

  async getVoiceEnv(): Promise<VoiceEnv> {
    const res = await fetch(`${HTTP_BASE}/voice/env`);
    return (await res.json()) as VoiceEnv;
  }

  async startSidecar(): Promise<SidecarActionResult> {
    const res = await fetch(`${HTTP_BASE}/voice/sidecar/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return (await res.json()) as SidecarActionResult;
  }

  async stopSidecar(): Promise<SidecarActionResult> {
    const res = await fetch(`${HTTP_BASE}/voice/sidecar/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return (await res.json()) as SidecarActionResult;
  }

  async getMisakiStatus(): Promise<MisakiStatus> {
    const res = await fetch(`${HTTP_BASE}/voice/misaki/status`);
    return (await res.json()) as MisakiStatus;
  }

  async installMisaki(): Promise<MisakiStatus> {
    const res = await fetch(`${HTTP_BASE}/voice/misaki/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return (await res.json()) as MisakiStatus;
  }

  dispose(): void {
    this.closed = true;
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
