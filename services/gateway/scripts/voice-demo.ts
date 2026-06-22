/**
 * Voice layer smoke demo. Run: `npm run voice-demo -w @aos/gateway`.
 *
 *  A) text mode: say() emits a text speech event (no audio) — the
 *     "writes and gets the spoken-as-text" path.
 *  B) SpeechBridge: a user-facing notification is spoken (text) automatically.
 *  C) voice mode with no sidecar reachable: say() tries to synthesize, fails,
 *     and gracefully falls back to a text speech event.
 *
 * No audio engines / keys needed — proves the config-driven mode + fallback.
 */
import type { OsEvent } from "@aos/shared";
import { EventBus } from "../src/bus/event-bus.js";
import { Speaker, SpeechBridge } from "../src/voice/speaker.js";
import { NoneTtsProvider, SidecarTtsProvider } from "../src/voice/tts-provider.js";

function speechEvents(bus: EventBus): OsEvent[] {
  const out: OsEvent[] = [];
  bus.subscribe((e) => out.push(e));
  return out;
}

async function main(): Promise<void> {
  console.log("=== Agentic OS — voice layer smoke demo ===");

  // A) text mode
  console.log("\n--- A) text mode say() ---");
  {
    const bus = new EventBus();
    const events = speechEvents(bus);
    const speaker = new Speaker(bus, "text", new NoneTtsProvider());
    await speaker.say("Good morning. Three new research briefs are ready.");
    const s = events.find((e) => e.type === "speech");
    if (s?.type === "speech") console.log(`speech: mode=${s.mode} audio=${s.audioUrl ?? "<none>"} text="${s.text}"`);
  }

  // B) SpeechBridge speaks notifications
  console.log("\n--- B) SpeechBridge (notification -> spoken text) ---");
  {
    const bus = new EventBus();
    const events = speechEvents(bus);
    const speaker = new Speaker(bus, "text", new NoneTtsProvider());
    new SpeechBridge(bus, speaker);
    bus.emit({ type: "notification", at: new Date().toISOString(), level: "info", message: "Synced. 12 items refreshed." });
    bus.emit({ type: "notification", at: new Date().toISOString(), level: "error", message: "internal boom" });
    const spoken = events.filter((e) => e.type === "speech");
    console.log("spoken count (error not spoken):", spoken.length);
    for (const e of spoken) if (e.type === "speech") console.log(`  -> "${e.text}"`);
  }

  // C) voice mode, sidecar down -> graceful text fallback
  console.log("\n--- C) voice mode, sidecar unreachable ---");
  {
    const bus = new EventBus();
    const events = speechEvents(bus);
    const deadSidecar = new SidecarTtsProvider("kokoro", "http://127.0.0.1:59999");
    const speaker = new Speaker(bus, "voice", deadSidecar);
    await speaker.say("This should fall back to text.");
    const s = events.find((e) => e.type === "speech");
    if (s?.type === "speech") console.log(`speech: mode=${s.mode} (expected text — fell back) audio=${s.audioUrl ?? "<none>"}`);
  }

  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
