/**
 * Gateway entry point. Boots the full runtime:
 *   detect runtime -> build router -> load skills -> wire bus + audit + dispatch
 *   -> start the HTTP/WebSocket server for the HUD feed.
 *
 * Run with: `npm run start -w @aos/gateway`.
 */
import { config } from "../../../config/agentic-os.config.js";
import { AuditLogger } from "./audit/audit-log.js";
import { EventBus, now } from "./bus/event-bus.js";
import { GatewayServer } from "./bus/ws-server.js";
import { Dispatcher } from "./dispatch/dispatcher.js";
import { Router } from "./routing/router.js";
import { detectRuntime } from "./runtime.js";
import { SkillLoader } from "./skills/skill-loader.js";
import { SkillRuntime } from "./skills/skill-runtime.js";
import { VaultAdapter } from "./memory/vault-adapter.js";
import { VaultRecorder } from "./memory/vault-recorder.js";
import { Speaker, SpeechBridge } from "./voice/speaker.js";
import { createTtsProvider } from "./voice/tts-provider.js";
import { createMailProvider, type MailProvider } from "./mail/mail-provider.js";

async function main(): Promise<void> {
  const runtime = await detectRuntime();

  const bus = new EventBus();
  new AuditLogger(bus);

  // Persist every operation to the vault's daily Operations log (V.A.U.L.T. feed).
  const vault = new VaultAdapter();
  new VaultRecorder(bus, vault);

  // Voice layer: speak the OS's user-facing notifications (text by default,
  // audio in voice mode via the sidecar — falls back to text if unavailable).
  const speaker = new Speaker(bus, config.voice.mode, createTtsProvider());
  new SpeechBridge(bus, speaker);

  const loader = new SkillLoader();
  const skillCount = loader.load();

  const router = new Router({ runtime });

  // Optional mail backend for inbox triage (disabled unless configured).
  // Device-code sign-in prompts surface as events (HUD popup) + a notification.
  let mail: MailProvider | undefined;
  try {
    mail = createMailProvider(config.mail, process.env, {
      onPrompt: (p) => {
        bus.emit({
          type: "auth.prompt",
          at: now(),
          service: "outlook",
          verificationUri: p.verificationUri,
          userCode: p.userCode,
          message: p.message,
          expiresAt: p.expiresAt,
        });
        bus.emit({
          type: "notification",
          at: now(),
          level: "warn",
          message: `Outlook sign-in needed: open ${p.verificationUri} and enter code ${p.userCode}`,
        });
      },
      onResolved: (ok) => bus.emit({ type: "auth.resolved", at: now(), service: "outlook", ok }),
    });
  } catch (err) {
    console.warn(`[gateway] mail disabled: ${(err as Error).message}`);
  }

  // Share one vault + skill runtime so skills and the recorder write the same tree.
  const skillRuntime = new SkillRuntime(bus, loader, {
    vault,
    nowIso: () => new Date().toISOString(),
    mail,
  });
  const dispatcher = new Dispatcher(router, loader, bus, runtime, skillRuntime);

  const server = new GatewayServer(bus, dispatcher, loader, vault, config.ports.gateway);
  await server.start();

  console.log(`[gateway] listening on http://localhost:${server.port}  (ws + /health)`);
  console.log(`[gateway] skills loaded: ${skillCount} (${loader.all().map((s) => s.id).join(", ") || "none"})`);
  console.log(`[gateway] runtime:`, runtime);
  console.log(`[gateway] voice: mode=${config.voice.mode}` + (config.voice.mode === "voice" ? ` tts=${config.voice.tts.provider} sidecar=${config.voice.sidecarUrl}` : ""));
  console.log(`[gateway] mail: ${mail ? mail.id : "disabled"}`);

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
