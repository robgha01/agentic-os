/**
 * Gateway server — an HTTP server with a /health endpoint and a WebSocket
 * upgrade. Bus events are broadcast to every connected client (the HUD feed);
 * inbound `ClientCommand`s drive the dispatcher.
 */
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientCommand, OsEvent } from "@aos/shared";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import type { EventBus } from "./event-bus.js";

export class GatewayServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private unsubscribe?: () => void;
  private boundPort = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly dispatcher: Dispatcher,
    private readonly loader: SkillLoader,
    private readonly requestedPort: number,
  ) {
    this.http = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", clients: this.wss.clients.size }));
        return;
      }
      // The HUD fetches this on load to build the command deck.
      if (req.url === "/skills") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ skills: this.loader.deckCards() }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.wss = new WebSocketServer({ server: this.http });
  }

  /** The actual listening port (useful when requestedPort is 0). */
  get port(): number {
    return this.boundPort;
  }

  start(): Promise<void> {
    // Broadcast every bus event to all open clients.
    this.unsubscribe = this.bus.subscribe((event) => this.broadcast(event));

    this.wss.on("connection", (ws) => {
      this.send(ws, { type: "notification", at: new Date().toISOString(), level: "info", message: "connected to agentic-os gateway" });
      ws.on("message", (data) => this.onMessage(ws, data.toString()));
    });

    return new Promise((resolve) => {
      this.http.listen(this.requestedPort, () => {
        const addr = this.http.address();
        this.boundPort = typeof addr === "object" && addr ? addr.port : this.requestedPort;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(raw) as ClientCommand;
    } catch {
      this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "invalid command JSON" });
      return;
    }

    switch (cmd.type) {
      case "ping":
        this.send(ws, { type: "notification", at: new Date().toISOString(), level: "info", message: "pong" });
        return;
      case "route":
        // Events flow back over the broadcast subscription; don't await here.
        void this.dispatcher.dispatch(cmd.input).catch((err) => this.emitDispatchError(err));
        return;
      case "invoke":
        // Command-deck button: deterministic, deck-gated invoke.
        void this.dispatcher
          .invoke(cmd.skillId, cmd.params ?? {}, { requireDeck: true })
          .catch((err) => this.emitDispatchError(err));
        return;
      default:
        this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "unknown command" });
    }
  }

  private emitDispatchError(err: unknown): void {
    this.bus.emit({
      type: "notification",
      at: new Date().toISOString(),
      level: "error",
      message: `dispatch failed: ${(err as Error).message}`,
    });
  }

  private broadcast(event: OsEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private send(ws: WebSocket, event: OsEvent): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  }
}
