/**
 * Gateway client — the HUD's single connection to the Agentic OS backend.
 *
 * Holds a WebSocket (auto-reconnecting) for the live event stream, fetches the
 * command-deck catalog over HTTP, and sends ClientCommands (route / invoke /
 * ping). Pure transport — React state lives in useGateway.
 */
import { parseOsEvent, type ClientCommand, type OsEvent, type SkillCard } from "@aos/shared";

const HTTP_BASE = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:7777";
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

export interface ConfigView {
  router: { defaultProvider: string; transport: string };
  voice: { mode: string; announce: boolean; stt: string; tts: string };
  mail: { provider: string; tokenSource: string; signedIn: boolean };
  research: { sources: { id: string; label: string; auth: string; enabled: boolean }[] };
  providers: ProviderStatus[];
  models: { fallbackOrder: string[]; disabled: string[] };
  tasks: { maxConcurrent: number };
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

  dispose(): void {
    this.closed = true;
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
