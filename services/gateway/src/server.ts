/**
 * Gateway entry point. Boots the full runtime:
 *   detect runtime -> build router -> load skills -> wire bus + audit + dispatch
 *   -> start the HTTP/WebSocket server for the HUD feed.
 *
 * Settings/secret edits from the Options panel apply LIVE: applyConfig()
 * reloads config and rebuilds the affected pieces (router, mail, llm, voice) in
 * place — no restart.
 *
 * Run with: `npm run start -w @aos/gateway`.
 */
import { config, reloadConfig } from "../../../config/agentic-os.config.js";
import { AuditLogger } from "./audit/audit-log.js";
import { EventBus, now } from "./bus/event-bus.js";
import { GatewayServer } from "./bus/ws-server.js";
import { Dispatcher } from "./dispatch/dispatcher.js";
import { Router } from "./routing/router.js";
import { detectRuntime } from "./runtime.js";
import { SkillLoader } from "./skills/skill-loader.js";
import { SkillRuntime } from "./skills/skill-runtime.js";
import type { SkillServices } from "./skills/native-registry.js";
import { VaultAdapter } from "./memory/vault-adapter.js";
import { VaultRecorder } from "./memory/vault-recorder.js";
import { Speaker, SpeechBridge } from "./voice/speaker.js";
import { createTtsProvider } from "./voice/tts-provider.js";
import { createMailProvider, type MailProvider } from "./mail/mail-provider.js";
import { createLlmService } from "./llm/llm-service.js";

async function main(): Promise<void> {
  const bus = new EventBus();
  new AuditLogger(bus);

  const vault = new VaultAdapter();
  new VaultRecorder(bus, vault);

  const loader = new SkillLoader();
  const skillCount = loader.load();

  // Mail device-code prompts surface as events (HUD popup) + a notification.
  const mailHooks = {
    onPrompt: (p: { verificationUri: string; userCode: string; message: string; expiresAt: string }) => {
      bus.emit({ type: "auth.prompt", at: now(), service: "outlook", ...p });
      bus.emit({
        type: "notification",
        at: now(),
        level: "warn" as const,
        message: `Outlook sign-in needed: open ${p.verificationUri} and enter code ${p.userCode}`,
      });
    },
    onResolved: (ok: boolean) => bus.emit({ type: "auth.resolved", at: now(), service: "outlook", ok }),
  };

  function buildMail(): MailProvider | undefined {
    try {
      return createMailProvider(config.mail, mailHooks);
    } catch (err) {
      console.warn(`[gateway] mail disabled: ${(err as Error).message}`);
      return undefined;
    }
  }
  function buildServices(): SkillServices {
    return { vault, nowIso: () => new Date().toISOString(), mail: buildMail(), llm: createLlmService() };
  }

  let runtime = await detectRuntime();
  const router = new Router({ runtime });
  const speaker = new Speaker(bus, config.voice.mode, createTtsProvider());
  new SpeechBridge(bus, speaker);
  const dispatcher = new Dispatcher(router, loader, bus, runtime, new SkillRuntime(bus, loader, buildServices()));

  // Live apply: reload config from the store/env and rebuild affected pieces.
  async function applyConfig(): Promise<void> {
    reloadConfig();
    runtime = await detectRuntime();
    dispatcher.reconfigure({
      router: new Router({ runtime }),
      runtime,
      runtimeExec: new SkillRuntime(bus, loader, buildServices()),
    });
    speaker.reconfigure(config.voice.mode, createTtsProvider());
    bus.emit({ type: "notification", at: now(), level: "info", message: "Settings applied." });
    console.log(`[gateway] config applied — transport=${config.router.transport} voice=${config.voice.mode} mail=${config.mail.provider}`);
  }

  const server = new GatewayServer(bus, dispatcher, loader, vault, config.ports.gateway, applyConfig);
  await server.start();

  console.log(`[gateway] listening on http://localhost:${server.port}  (ws + /health)`);
  console.log(`[gateway] skills loaded: ${skillCount} (${loader.all().map((s) => s.id).join(", ") || "none"})`);
  console.log(`[gateway] runtime:`, runtime);
  console.log(`[gateway] voice: mode=${config.voice.mode}`);
  console.log(`[gateway] mail: ${config.mail.provider === "none" ? "disabled" : config.mail.provider}`);
  console.log(`[gateway] transport: ${config.router.transport}`);

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
