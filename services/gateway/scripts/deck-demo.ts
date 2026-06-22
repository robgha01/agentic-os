/**
 * Command-deck + invoke smoke demo. Run: `npm run deck-demo -w @aos/gateway`.
 *
 * Uses a throwaway skills dir with three manifests to exercise the surfaces
 * model offline (no claude CLI / API key needed):
 *   - demo-echo       : deck skill, process exec, no inputs    -> invoke succeeds
 *   - demo-needs-input: deck skill, required input "topic"     -> gated until provided
 *   - demo-internal   : surfaces []                            -> sub-skill, not invokable
 *
 * Checks: deck catalog (GET /skills data), required-input gating, internal
 * rejection, a successful streamed invoke, and a live WS invoke round-trip.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { ModelRuntimeContext, OsEvent } from "@aos/shared";
import { EventBus } from "../src/bus/event-bus.js";
import { GatewayServer } from "../src/bus/ws-server.js";
import { Dispatcher } from "../src/dispatch/dispatcher.js";
import { Router } from "../src/routing/router.js";
import { SkillLoader } from "../src/skills/skill-loader.js";
import { VaultAdapter } from "../src/memory/vault-adapter.js";

const RUNTIME: ModelRuntimeContext = { networkUp: true, anthropicKeyPresent: false, ollamaReachable: false };

function writeManifest(root: string, id: string, manifest: unknown): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "skill.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function seedSkills(): string {
  const root = mkdtempSync(join(tmpdir(), "aos-skills-"));
  const echoExec = (text: string) => ({
    kind: "process",
    command: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(text)})`],
  });

  writeManifest(root, "demo-echo", {
    id: "demo-echo",
    name: "Demo Echo",
    description: "Echoes a fixed line.",
    triggers: ["demo-echo"],
    surfaces: ["deck", "nl"],
    presentation: { label: "Echo", icon: "terminal", group: "Demo", inputs: [] },
    modelPolicy: { execTier: "none", privacy: "cloud-ok" },
    execution: echoExec("echo ok\n"),
  });
  writeManifest(root, "demo-needs-input", {
    id: "demo-needs-input",
    name: "Demo Needs Input",
    description: "Requires a topic.",
    triggers: ["demo-needs-input"],
    surfaces: ["deck", "nl"],
    presentation: {
      label: "Needs Input",
      group: "Demo",
      inputs: [{ name: "topic", type: "string", label: "Topic", required: true }],
    },
    modelPolicy: { execTier: "none", privacy: "cloud-ok" },
    execution: echoExec("ran with topic\n"),
  });
  writeManifest(root, "demo-internal", {
    id: "demo-internal",
    name: "Demo Internal",
    description: "A sub-skill only other skills call.",
    triggers: ["demo-internal"],
    surfaces: [],
    modelPolicy: { execTier: "none", privacy: "cloud-ok" },
    execution: echoExec("internal\n"),
  });
  return root;
}

function lastFailure(events: OsEvent[]): string | undefined {
  const f = [...events].reverse().find((e) => e.type === "operation.failed");
  return f?.type === "operation.failed" ? f.error : undefined;
}

async function main(): Promise<void> {
  console.log("=== Agentic OS — command-deck + invoke smoke demo ===");
  const root = seedSkills();
  const loader = new SkillLoader(root);
  console.log("skills loaded:", loader.load());

  // Deck catalog (what GET /skills returns).
  console.log("\n--- command deck (GET /skills) ---");
  for (const card of loader.deckCards()) {
    const inputs = card.inputs.map((i) => `${i.name}${i.required ? "*" : ""}`).join(",") || "—";
    console.log(`[${card.group}] ${card.label} (${card.skillId})  inputs: ${inputs}`);
  }
  console.log("internal skill in deck?:", loader.deckCards().some((c) => c.skillId === "demo-internal"));

  const mkDispatcher = (bus: EventBus) =>
    new Dispatcher(new Router({ runtime: RUNTIME }), loader, bus, RUNTIME);

  // Invoke gating.
  console.log("\n--- invoke gating ---");
  {
    const bus = new EventBus();
    const events: OsEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const d = mkDispatcher(bus);

    await d.invoke("demo-needs-input", {}, { requireDeck: true });
    console.log("missing input  ->", lastFailure(events));

    events.length = 0;
    await d.invoke("demo-internal", {}, { requireDeck: true });
    console.log("internal skill ->", lastFailure(events));

    events.length = 0;
    await d.invoke("demo-echo", {}, { requireDeck: true });
    const out = events.find((e) => e.type === "operation.output");
    const done = events.find((e) => e.type === "operation.completed");
    console.log(
      "deck-skill run ->",
      out?.type === "operation.output" ? JSON.stringify(out.chunk.trim()) : "<no output>",
      done?.type === "operation.completed" ? `(exit ${done.exitCode})` : "(no completion)",
    );
  }

  // Live WS invoke.
  console.log("\n--- live WS invoke ---");
  {
    const bus = new EventBus();
    const server = new GatewayServer(
      bus,
      mkDispatcher(bus),
      loader,
      new VaultAdapter(mkdtempSync(join(tmpdir(), "aos-deck-ws-"))),
      0,
    );
    await server.start();

    const httpSkills = (await (
      await fetch(`http://127.0.0.1:${server.port}/skills`)
    ).json()) as { skills: { skillId: string }[] };
    console.log("GET /skills cards:", httpSkills.skills.map((s) => s.skillId));

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: OsEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws invoke timed out")), 5000);
      ws.on("open", () => ws.send(JSON.stringify({ type: "invoke", skillId: "demo-echo" })));
      ws.on("message", (data) => {
        const e = JSON.parse(data.toString()) as OsEvent;
        got.push(e);
        if (e.type === "operation.completed") {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on("error", reject);
    });
    ws.close();
    await server.stop();
    console.log("ws invoke completed:", got.some((e) => e.type === "operation.completed"));
    console.log("ws events received :", got.length);
  }

  rmSync(root, { recursive: true, force: true });
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
