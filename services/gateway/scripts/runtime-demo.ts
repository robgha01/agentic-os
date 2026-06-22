/**
 * Gateway runtime smoke demo — proves the dispatch pipeline and the WS feed
 * without any external tools (no claude CLI, no API key, no Ollama).
 *
 * Run with: `npm run runtime-demo -w @aos/gateway`.
 *
 *  A) SkillRuntime executes a real `process` skill (node -e) and streams output.
 *  B) Dispatcher routes a regex action with no bound skill -> notification.
 *  C) GatewayServer over a live WebSocket: ping -> pong; route -> event stream.
 */
import { WebSocket } from "ws";
import type { ModelRuntimeContext, OsEvent, SkillManifest } from "@aos/shared";
import { EventBus } from "../src/bus/event-bus.js";
import { GatewayServer } from "../src/bus/ws-server.js";
import { Dispatcher } from "../src/dispatch/dispatcher.js";
import { Router } from "../src/routing/router.js";
import { SkillLoader } from "../src/skills/skill-loader.js";
import { SkillRuntime } from "../src/skills/skill-runtime.js";

const RUNTIME: ModelRuntimeContext = {
  networkUp: true,
  anthropicKeyPresent: false,
  ollamaReachable: false,
};

function collect(bus: EventBus): OsEvent[] {
  const events: OsEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return events;
}

async function partA(): Promise<void> {
  console.log("\n--- A) SkillRuntime executes a process skill ---");
  const bus = new EventBus();
  const events = collect(bus);
  const runtime = new SkillRuntime(bus);

  const echoSkill: SkillManifest = {
    id: "demo-echo",
    name: "Demo Echo",
    description: "Prints a line to prove process streaming.",
    triggers: ["demo-echo"],
    surfaces: [],
    modelPolicy: { execTier: "none", privacy: "cloud-ok" },
    execution: {
      kind: "process",
      command: process.execPath, // node — guaranteed present
      args: ["-e", "process.stdout.write('hello from skill\\n')"],
    },
  };

  await runtime.execute(
    echoSkill,
    { actionId: "demo-echo", source: "regex", confidence: 1, parameters: {}, rawInput: "demo" },
    null,
    "op-A",
  );

  const out = events.find((e) => e.type === "operation.output");
  const done = events.find((e) => e.type === "operation.completed");
  console.log("output :", out?.type === "operation.output" ? JSON.stringify(out.chunk) : "<none>");
  console.log("done   :", done?.type === "operation.completed" ? `exit=${done.exitCode}` : "<none>");
}

async function partB(): Promise<void> {
  console.log("\n--- B) Dispatcher: regex action with no bound skill ---");
  const bus = new EventBus();
  const events = collect(bus);
  const loader = new SkillLoader();
  loader.load();
  const dispatcher = new Dispatcher(new Router({ runtime: RUNTIME }), loader, bus, RUNTIME);

  await dispatcher.dispatch("give me the rundown");
  for (const e of events) {
    if (e.type === "routing.resolved") console.log(`routing.resolved -> ${e.intent.actionId} [${e.intent.source}]`);
    if (e.type === "notification") console.log(`notification(${e.level}) -> ${e.message}`);
    if (e.type === "operation.completed") console.log(`operation.completed exit=${e.exitCode}`);
  }
}

async function partC(): Promise<void> {
  console.log("\n--- C) GatewayServer over a live WebSocket ---");
  const bus = new EventBus();
  const loader = new SkillLoader();
  loader.load();
  const dispatcher = new Dispatcher(new Router({ runtime: RUNTIME }), loader, bus, RUNTIME);
  const server = new GatewayServer(bus, dispatcher, loader, 0); // ephemeral port
  await server.start();

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const received: OsEvent[] = [];

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws demo timed out")), 5000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "ping" }));
      ws.send(JSON.stringify({ type: "route", input: "sync everything" }));
    });
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as OsEvent;
      received.push(event);
      // Resolve once the routed op for "sync" has completed.
      if (event.type === "operation.completed") {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.on("error", reject);
  });

  ws.close();
  await server.stop();

  const sawPong = received.some((e) => e.type === "notification" && e.message === "pong");
  const routed = received.find((e) => e.type === "routing.resolved");
  console.log(`health port      : ${server.port}`);
  console.log(`pong received    : ${sawPong}`);
  console.log(`routing.resolved : ${routed?.type === "routing.resolved" ? routed.intent.actionId : "<none>"}`);
  console.log(`events received  : ${received.length}`);
}

async function main(): Promise<void> {
  console.log("=== Agentic OS — gateway runtime smoke demo ===");
  await partA();
  await partB();
  await partC();
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
