/**
 * Gateway server — an HTTP server with a /health endpoint and a WebSocket
 * upgrade. Bus events are broadcast to every connected client (the HUD feed);
 * inbound `ClientCommand`s drive the dispatcher.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientCommand, type OsEvent } from "@aos/shared";
import { config } from "../../../../config/agentic-os.config.js";
import {
  editableView,
  isEditableKey,
  isSecretKey,
  secretBackendId,
  secretPresence,
  setValues,
} from "../../../../config/config-store.js";
import type { Dispatcher } from "../dispatch/dispatcher.js";
import type { SkillLoader } from "../skills/skill-loader.js";
import type { VaultAdapter } from "../memory/vault-adapter.js";
import { extractSpokenCore } from "../memory/document-builder.js";
import { serveHud } from "./static-hud.js";
import { isLocalHostHeader, isLocalOrigin } from "./origin-guard.js";
import { now, type EventBus } from "./event-bus.js";
import { installMisaki, installTts, misakiStatus, sidecarHealth, ttsStatus } from "../voice/installer.js";

export class GatewayServer {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private unsubscribe?: () => void;
  private boundPort = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly dispatcher: Dispatcher,
    private readonly loader: SkillLoader,
    private readonly vault: VaultAdapter,
    private readonly requestedPort: number,
    private readonly onSettingsChange?: () => Promise<void>,
    private readonly speak?: (text: string) => void,
    private readonly providers?: () => import("@aos/shared").ProviderReadiness[],
    private readonly scheduler?: import("../dispatch/scheduler.js").Scheduler,
  ) {
    // Localhost single-user tool by default: only LOCAL origins may read
    // cross-origin (the HUD dev server on :5173). Anything else gets no CORS
    // grant — unless the user opts into remote access (trusted-LAN), which
    // reflects any origin. Read live so an Options toggle applies without restart.
    const allowRemote = () => config.security.allowRemoteAccess;
    const originOk = (origin: string | undefined) => allowRemote() || isLocalOrigin(origin);
    const corsFor = (req: import("node:http").IncomingMessage): Record<string, string> => {
      const origin = req.headers.origin;
      return origin && originOk(origin)
        ? { "access-control-allow-origin": origin, vary: "origin" }
        : {};
    };

    this.http = createServer((req, res) => {
      const cors = corsFor(req);
      const json = (res2: import("node:http").ServerResponse, body: unknown, code = 200) => {
        res2.writeHead(code, { "content-type": "application/json", ...cors });
        res2.end(JSON.stringify(body));
      };

      // DNS-rebinding defense: the Host header must name this machine, unless the
      // user has opted into remote access (LAN/hostname).
      if (!allowRemote() && !isLocalHostHeader(req.headers.host)) {
        return json(res, { error: "forbidden host — the gateway serves localhost only (enable security.allowRemoteAccess for LAN access)" }, 403);
      }

      const url = new URL(req.url ?? "/", "http://localhost");

      // CORS preflight for the POST below.
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          ...cors,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        return res.end();
      }

      // Persist edits from the Options panel (applies on restart). /settings
      // takes non-secret editable keys; /secrets takes secret keys (encrypted /
      // keychained, never echoed back).
      if (req.method === "POST" && (url.pathname === "/settings" || url.pathname === "/secrets")) {
        // CSRF gate: a cross-site page can fire a non-preflighted "simple" POST
        // (e.g. content-type text/plain) that the Host check alone won't stop —
        // browsers always attach the page's Origin to cross-origin POSTs, so a
        // non-local Origin is rejected outright. Absent Origin = CLI/same-origin.
        // (Remote-access mode relaxes this to any origin — trusted-LAN only.)
        if (!originOk(req.headers.origin)) {
          return json(res, { ok: false, error: "forbidden origin" }, 403);
        }
        const wantSecret = url.pathname === "/secrets";
        const MAX_BODY = 64 * 1024;
        let body = "";
        let tooLarge = false;
        req.on("data", (c) => {
          if (tooLarge) return;
          body += c;
          if (body.length > MAX_BODY) {
            tooLarge = true;
            body = "";
            // Respond first, then sever once the 413 has flushed — destroying
            // the socket immediately would reset the connection mid-response.
            res.once("finish", () => req.destroy());
            json(res, { ok: false, error: "body too large" }, 413);
          }
        });
        req.on("end", () => {
          if (res.writableEnded) return;
          try {
            const input = JSON.parse(body || "{}") as Record<string, unknown>;
            const allowed: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(input)) {
              if (wantSecret ? isSecretKey(k) : isEditableKey(k)) allowed[k] = v;
            }
            setValues(allowed);
            void Promise.resolve(this.onSettingsChange?.()).then(
              () => json(res, { ok: true, saved: Object.keys(allowed), applied: true }),
              () => json(res, { ok: true, saved: Object.keys(allowed), applied: false }),
            );
          } catch {
            json(res, { ok: false, error: "invalid JSON" }, 400);
          }
        });
        return;
      }

      // Is the Python voice sidecar reachable? Read-only, never throws.
      if (req.method === "GET" && url.pathname === "/voice/health") {
        void sidecarHealth().then((h) => json(res, h), () => json(res, { online: false }));
        return;
      }

      // Voice model status (read-only) — proxied to the sidecar. Never throws to
      // the client: an unreachable sidecar reports not-ready so the HUD degrades.
      if (req.method === "GET" && url.pathname === "/voice/tts/status") {
        void ttsStatus(url.searchParams.get("provider") ?? undefined).then(
          (status) => json(res, status),
          (e) => json(res, { provider: "", installable: false, ready: false, missing: [], error: String(e) }),
        );
        return;
      }

      // Voice model install — downloads assets in the sidecar. Same CSRF/localhost
      // gate as /settings; emits notifications the HUD feed renders.
      if (req.method === "POST" && url.pathname === "/voice/tts/install") {
        if (!originOk(req.headers.origin)) {
          return json(res, { ok: false, error: "forbidden origin" }, 403);
        }
        this.bus.emit({ type: "notification", at: now(), level: "info", message: "Downloading kokoro-onnx voice models…" });
        void installTts().then(
          (status) => {
            this.bus.emit({
              type: "notification",
              at: now(),
              level: status.ready ? "info" : "error",
              message: status.ready ? "kokoro-onnx voice models ready." : `Model download incomplete: missing ${status.missing.join(", ")}`,
            });
            json(res, status);
          },
          (e) => {
            this.bus.emit({ type: "notification", at: now(), level: "error", message: `Voice model download failed: ${String(e)}` });
            json(res, { ok: false, error: String(e) }, 503);
          },
        );
        return;
      }

      // misaki G2P dependency status (read-only) — proxied to the sidecar, which
      // owns its own Python env. Never throws to the client.
      if (req.method === "GET" && url.pathname === "/voice/misaki/status") {
        void misakiStatus().then(
          (status) => json(res, status),
          (e) => json(res, { installed: false, error: String(e) }),
        );
        return;
      }

      // misaki install — pip runs in the sidecar's venv. Same CSRF/localhost gate.
      if (req.method === "POST" && url.pathname === "/voice/misaki/install") {
        if (!originOk(req.headers.origin)) {
          return json(res, { ok: false, error: "forbidden origin" }, 403);
        }
        this.bus.emit({ type: "notification", at: now(), level: "info", message: "Installing misaki G2P in the voice sidecar…" });
        void installMisaki().then(
          (status) => {
            this.bus.emit({
              type: "notification",
              at: now(),
              level: status.installed ? "info" : "error",
              message: status.installed ? "misaki G2P installed (restart the sidecar to use it)." : "misaki install ran but the package isn't importable — check the sidecar log.",
            });
            json(res, status);
          },
          (e) => {
            this.bus.emit({ type: "notification", at: now(), level: "error", message: `misaki install failed: ${String(e)}` });
            json(res, { ok: false, error: String(e) }, 503);
          },
        );
        return;
      }

      switch (url.pathname) {
        case "/health":
          return json(res, { status: "ok", clients: this.wss.clients.size });
        // The HUD fetches this on load to build the command deck.
        case "/skills":
          return json(res, { skills: this.loader.deckCards() });
        // Sanitized config + connection status for the Options view (no secrets).
        case "/config":
          return json(res, {
            router: { defaultProvider: config.router.defaultProvider, transport: config.router.transport },
            voice: {
              mode: config.voice.mode,
              announce: config.voice.announce,
              stt: config.voice.stt.provider,
              tts: config.voice.tts.provider,
              voice: config.voice.tts.voice ?? "",
            },
            mail: {
              provider: config.mail.provider,
              tokenSource: config.mail.tokenSource,
              signedIn:
                config.mail.provider === "outlook" &&
                (secretPresence()["mail.refreshToken"] || existsSync(config.mail.tokenStorePath)),
            },
            research: {
              sources: [
                { id: "hackernews", label: "Hacker News", auth: "keyless" },
                { id: "reddit", label: "Reddit", auth: "keyless (may rate-limit)" },
                { id: "polymarket", label: "Polymarket", auth: "keyless" },
                { id: "web", label: "Web search", auth: "keyless (DuckDuckGo)" },
                { id: "youtube", label: "YouTube", auth: "needs yt-dlp binary" },
                { id: "x", label: "X / Twitter", auth: config.x.bearerToken ? "token set" : "needs bearer token" },
              ].map((s) => ({ ...s, enabled: !config.research.disabled.includes(s.id) })),
            },
            // Model providers + their live readiness, and the execution preference.
            providers: this.providers?.() ?? [],
            models: { fallbackOrder: config.models.fallbackOrder, disabled: config.models.disabled },
            tasks: { maxConcurrent: config.tasks.maxConcurrent },
            security: { allowRemoteAccess: config.security.allowRemoteAccess },
            ui: { launch: config.ui.launch, browser: config.ui.browser },
            openai: { baseUrl: config.openai.baseUrl, model: config.openai.model },
            ollama: { baseUrl: config.ollama.baseUrl, model: config.ollama.model },
            vault: { path: config.vault.path },
            // Saved overlay (what the Options panel last wrote) — may differ from
            // the running values above until the gateway restarts.
            saved: editableView(),
            // Secret presence only (never values) + which backend stores them.
            secrets: secretPresence(),
            secretBackend: secretBackendId,
          });
        // Recent vault records — the V.A.U.L.T. feed.
        case "/vault/recent":
          return json(res, { records: this.vault.listRecent(40) });
        // One record's rendered content — the result viewer.
        case "/vault/doc": {
          const path = url.searchParams.get("path") ?? "";
          const doc = this.vault.readByPath(path);
          if (!doc) return json(res, { error: "not found" }, 404);
          // Deep link to open the note in Obsidian (matches the file's vault).
          // Forward slashes are the most portable in the obsidian:// path param.
          const abs = join(config.vault.path, path).replace(/\\/g, "/");
          const obsidianUri = `obsidian://open?path=${encodeURIComponent(abs)}`;
          return json(res, { ...doc, path, obsidianUri });
        }
        default:
          // Everything else is the HUD (static assets / SPA routes).
          return void serveHud(url.pathname, res, cors);
      }
    });
    this.wss = new WebSocketServer({
      server: this.http,
      // Reject browser connections from non-local pages; non-browser clients
      // (no Origin header) are allowed. Remote-access mode relaxes this (LAN).
      verifyClient: (info: { origin?: string }) => originOk(info.origin || undefined),
    });
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "invalid command JSON" });
      return;
    }
    // Schema-validate before dispatch — malformed frames never reach the router.
    const cmd = parseClientCommand(parsed);
    if (!cmd) {
      this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "unknown or malformed command" });
      return;
    }

    switch (cmd.type) {
      case "ping":
        this.send(ws, { type: "notification", at: new Date().toISOString(), level: "info", message: "pong" });
        return;
      case "route":
        // Queue (concurrency-limited); events flow back over the broadcast sub.
        this.run("route", cmd.input, (opId) => this.dispatcher.dispatch(cmd.input, opId));
        return;
      case "invoke":
        // Command-deck button: deterministic, deck-gated invoke.
        this.run("invoke", cmd.skillId, (opId) =>
          this.dispatcher.invoke(cmd.skillId, cmd.params ?? {}, { requireDeck: true }, opId),
        );
        return;
      case "speak":
        // Read a record's spoken core (TL;DR blockquote) aloud.
        this.speakDocument(cmd.path);
        return;
      default:
        this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "unknown command" });
    }
  }

  /** Run a command through the scheduler (concurrency-limited) when present. */
  private run(kind: "route" | "invoke", label: string, exec: (opId: string) => Promise<unknown>): void {
    const guarded = (opId: string) => Promise.resolve(exec(opId)).catch((err) => this.emitDispatchError(err));
    if (this.scheduler) this.scheduler.submit(guarded, { kind, label });
    else void guarded(randomUUID());
  }

  private speakDocument(path: string): void {
    const doc = this.vault.readByPath(path);
    if (!doc) return;
    const core = extractSpokenCore(doc.body);
    const text = core || `${doc.frontmatter.title}.`;
    this.speak?.(text);
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
