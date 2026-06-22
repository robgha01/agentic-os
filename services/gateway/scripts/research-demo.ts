/**
 * Research pipeline smoke demo. Run: `npm run research-demo -w @aos/gateway`.
 *
 *  A) compileResearch (deterministic, offline): seed context with fake HN items,
 *     run the handler, read back a contract-compliant research record.
 *  B) composite last-30-days end-to-end through the runtime: fetch-hackernews
 *     (best-effort live; non-fatal if offline) -> compile-research -> vault doc.
 *     Always produces a valid record (cites the HN search URL even when empty).
 *
 * Writes to a throwaway vault so real data is never touched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OsEvent, RoutedIntent } from "@aos/shared";
import { EventBus } from "../src/bus/event-bus.js";
import { SkillLoader } from "../src/skills/skill-loader.js";
import { SkillRuntime } from "../src/skills/skill-runtime.js";
import { VaultAdapter } from "../src/memory/vault-adapter.js";
import { NATIVE_HANDLERS, type SkillServices } from "../src/skills/native-registry.js";

const NOW = "2026-06-22T10:00:00Z";

function intentFor(topic: string): RoutedIntent {
  return { actionId: "last-30-days", source: "direct", confidence: 1, parameters: { topic }, rawInput: `invoke:last-30-days` };
}

async function main(): Promise<void> {
  console.log("=== Agentic OS — research pipeline smoke demo ===");
  const root = mkdtempSync(join(tmpdir(), "aos-research-"));
  const vault = new VaultAdapter(root);
  const services: SkillServices = { vault, nowIso: () => NOW };

  // A) Deterministic compile from seeded context (no network).
  console.log("\n--- A) compileResearch (seeded, offline) ---");
  const seeded = {
    researchItems: [
      { title: "Async Rust in 2026", url: "https://example.com/a", score: 412, author: "alice", source: "Hacker News" },
      { title: "Tokio internals deep dive", url: "https://example.com/b", score: 287, author: "bob", source: "Reddit" },
    ],
    searchSources: [
      { label: "Hacker News search: rust async", url: "https://hn.algolia.com/?query=rust%20async&dateRange=pastMonth&type=story" },
    ],
  };
  // Stub LLM so synthesis is deterministic + offline.
  const stubLlm = {
    id: "stub",
    async complete() {
      return "## Signal\nStubbed grounded summary of rust async [1].\n## Rising\n- Runtime consolidation [1]\n## Friction\n- Not evident in the last 30 days of items.";
    },
  };
  const synthCtx: Record<string, unknown> = { ...seeded };
  await NATIVE_HANDLERS.synthesizeResearch!({
    intent: intentFor("rust async"),
    params: { topic: "rust async" },
    context: synthCtx,
    services: { ...services, llm: stubLlm },
    emit: (c) => process.stdout.write(`  ${c}`),
  });
  const code = await NATIVE_HANDLERS.compileResearch!({
    intent: intentFor("rust async"),
    params: { topic: "rust async" },
    context: synthCtx,
    services,
    emit: (c) => process.stdout.write(`  ${c}`),
  });
  const recA = vault.read("research", "rust async");
  console.log("handler exit   :", code);
  console.log("status         :", recA?.frontmatter.status, "| confidence:", recA?.frontmatter.confidence);
  console.log("has TL;DR      :", recA?.generated.includes("**TL;DR**"));
  console.log("has Analysis   :", recA?.generated.includes("## Analysis"), "(synthesis embedded)");
  console.log("findings bullets:", (recA?.generated.match(/^- /gm) ?? []).length);

  // B) Full composite through the runtime (live HN best-effort, offline-safe).
  console.log("\n--- B) composite last-30-days end-to-end ---");
  const bus = new EventBus();
  const events: OsEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const loader = new SkillLoader();
  console.log("skills loaded  :", loader.load(), "->", loader.all().map((s) => s.id).sort().join(", "));

  const runtime = new SkillRuntime(bus, loader, { vault, nowIso: () => NOW });
  const skill = loader.byIdOrThrow("last-30-days");
  await runtime.execute(skill, intentFor("typescript"), null, "op-research");

  const steps = events
    .filter((e) => e.type === "operation.output")
    .map((e) => (e.type === "operation.output" ? e.chunk.trim() : ""))
    .filter((l) => l.startsWith("▸") || l.includes(":"));
  console.log("pipeline trace :");
  for (const s of steps) console.log("   " + s);

  const completed = events.some((e) => e.type === "operation.completed");
  const recB = vault.read("research", "typescript");
  console.log("op completed   :", completed);
  console.log("vault doc valid:", recB ? `yes (${recB.frontmatter.status})` : "MISSING");

  rmSync(root, { recursive: true, force: true });
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
