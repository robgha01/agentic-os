/**
 * Gateway entry point. Boots the full runtime:
 *   detect runtime -> build router -> load skills -> wire bus + audit + dispatch
 *   -> start the HTTP/WebSocket server for the HUD feed.
 *
 * Run with: `npm run start -w @aos/gateway`.
 */
import { config } from "../../../config/agentic-os.config.js";
import { AuditLogger } from "./audit/audit-log.js";
import { EventBus } from "./bus/event-bus.js";
import { GatewayServer } from "./bus/ws-server.js";
import { Dispatcher } from "./dispatch/dispatcher.js";
import { Router } from "./routing/router.js";
import { detectRuntime } from "./runtime.js";
import { SkillLoader } from "./skills/skill-loader.js";
import { VaultAdapter } from "./memory/vault-adapter.js";
import { VaultRecorder } from "./memory/vault-recorder.js";

async function main(): Promise<void> {
  const runtime = await detectRuntime();

  const bus = new EventBus();
  new AuditLogger(bus);

  // Persist every operation to the vault's daily Operations log (V.A.U.L.T. feed).
  const vault = new VaultAdapter();
  new VaultRecorder(bus, vault);

  const loader = new SkillLoader();
  const skillCount = loader.load();

  const router = new Router({ runtime });
  const dispatcher = new Dispatcher(router, loader, bus, runtime);

  const server = new GatewayServer(bus, dispatcher, loader, config.ports.gateway);
  await server.start();

  console.log(`[gateway] listening on http://localhost:${server.port}  (ws + /health)`);
  console.log(`[gateway] skills loaded: ${skillCount} (${loader.all().map((s) => s.id).join(", ") || "none"})`);
  console.log(`[gateway] runtime:`, runtime);

  const shutdown = async (): Promise<void> => {
    console.log("\n[gateway] shutting down…");
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[gateway] fatal:", err);
  process.exitCode = 1;
});
