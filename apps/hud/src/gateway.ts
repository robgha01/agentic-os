/**
 * Gateway client — the HUD's single connection to the Agentic OS backend.
 *
 * Holds a WebSocket (auto-reconnecting) for the live event stream, fetches the
 * command-deck catalog over HTTP, and sends ClientCommands (route / invoke /
 * ping). Pure transport — React state lives in useGateway.
 */
import type { ClientCommand, OsEvent, SkillCard } from "@aos/shared";

const HTTP_BASE = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:7777";
const WS_URL = HTTP_BASE.replace(/^http/, "ws");

export type ConnectionStatus = "connecting" | "online" | "offline";

export class GatewayClient {
  private ws?: WebSocket;
  private reconnectTimer?: number;
  private closed = false;

  constructor(
    private readonly onEvent: (event: OsEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    this.onStatus("connecting");
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => this.onStatus("online");
    ws.onmessage = (msg) => {
      try {
        this.onEvent(JSON.parse(msg.data as string) as OsEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.onStatus("offline");
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
  }

  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(command));
  }

  async fetchSkills(): Promise<SkillCard[]> {
    const res = await fetch(`${HTTP_BASE}/skills`);
    const data = (await res.json()) as { skills: SkillCard[] };
    return data.skills;
  }

  dispose(): void {
    this.closed = true;
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
