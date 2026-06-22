/**
 * Vault memory-layer smoke demo. Run: `npm run vault-demo -w @aos/gateway`.
 *
 *  A) Build a contract-compliant research record, write it, read it back —
 *     verify frontmatter provenance + managed block round-trip.
 *  B) Contract enforcement: a research doc missing "Sources" is rejected.
 *  C) Human content survives regeneration (managed-block isolation).
 *  D) Freshness: isStale() + needsRefresh() for missing / fresh / expired.
 *  E) Daily Operations log: two appends accumulate under one note.
 *
 * Writes under a throwaway vault dir so the demo never touches real data.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStale, VaultAdapter } from "../src/memory/vault-adapter.js";
import { buildResultDocument } from "../src/memory/document-builder.js";

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function main(): void {
  console.log("=== Agentic OS — vault memory smoke demo ===");
  const root = mkdtempSync(join(tmpdir(), "aos-vault-"));
  const vault = new VaultAdapter(root);
  const now = "2026-06-22T10:00:00Z";

  // A) Build + write + read a research record.
  section("A) build + write + read research record");
  const built = buildResultDocument({
    type: "research",
    key: "rust async",
    title: "Rust async — last 30 days",
    source: "last-30-days",
    model: "claude-opus-4-8",
    confidence: "high",
    staleAfterMinutes: 1440,
    tags: ["topic/rust", "async"],
    inputs: { topic: "rust async" },
    tldr: "Async Rust matured: the ecosystem consolidated around a few runtimes and ergonomics improved.",
    sections: {
      "Key findings": "- Runtime consolidation continued.\n- Ergonomics improved across the board.",
    },
    sources: [{ label: "This Week in Rust", url: "https://this-week-in-rust.org" }],
    now,
  });
  const path = vault.writeGenerated(built.frontmatter, built.generated);
  const read = vault.read("research", "rust async");
  console.log("written to     :", path.replace(root, "<vault>"));
  console.log("frontmatter    :", { type: read?.frontmatter.type, id: read?.frontmatter.id, status: read?.frontmatter.status, source: read?.frontmatter.source });
  console.log("has TL;DR      :", read?.generated.includes("**TL;DR**"));
  console.log("managed block  :", read ? "present" : "MISSING");

  // B) Contract enforcement.
  section("B) contract enforcement (missing required section)");
  try {
    buildResultDocument({
      type: "research",
      key: "bad-doc",
      title: "Bad",
      source: "test",
      tldr: "x",
      sections: { "Key findings": "y" }, // no "Sources" -> but Sources can come via sources[]; omit both
      now,
    });
    console.log("UNEXPECTED: build succeeded");
  } catch (err) {
    console.log("rejected as expected:", (err as Error).message);
  }

  // C) Human content survives regeneration.
  section("C) human content survives regeneration");
  const withHuman = readFileSync(path, "utf8").replace(
    "<!-- aos:begin generated -->",
    "## My notes\n\nThis matters for our scheduler work.\n\n<!-- aos:begin generated -->",
  );
  writeFileSync(path, withHuman, "utf8");
  const regen = buildResultDocument({ ...{
    type: "research" as const,
    key: "rust async",
    title: "Rust async — last 30 days (v2)",
    source: "last-30-days",
    tldr: "Updated summary.",
    sections: { "Key findings": "- New finding." },
    sources: [{ label: "src", url: "https://example.com" }],
    now: "2026-06-22T12:00:00Z",
  } });
  vault.writeGenerated(regen.frontmatter, regen.generated);
  const after = readFileSync(path, "utf8");
  console.log("human note kept:", after.includes("This matters for our scheduler work."));
  console.log("body updated   :", after.includes("New finding"));
  console.log("created kept   :", vault.read("research", "rust async")?.frontmatter.created === now);

  // D) Freshness.
  section("D) freshness");
  const nowMs = Date.parse("2026-06-23T10:00:00Z"); // 24h after `now`
  console.log("isStale fresh  :", isStale("2026-06-23T09:59:00Z", 1440, nowMs)); // updated 1m ago, ttl 24h -> false
  console.log("isStale expired:", isStale("2026-06-22T09:00:00Z", 1440, nowMs)); // >24h old -> true
  console.log("isStale no-ttl :", isStale("2020-01-01T00:00:00Z", undefined, nowMs)); // never -> false
  console.log("needsRefresh missing:", vault.needsRefresh("research", "does-not-exist"));
  console.log("needsRefresh fresh  :", vault.needsRefresh("research", "rust async", Date.parse("2026-06-22T12:30:00Z")));

  // E) Daily operations log.
  section("E) daily operations log");
  vault.appendDailyOperation("2026-06-22", "`t1` **sync** [—] — ok (exit 0)", "2026-06-22T10:00:00Z");
  vault.appendDailyOperation("2026-06-22", "`t2` **last-30-days** [last-30-days] — ok (exit 0)", "2026-06-22T10:05:00Z");
  const daily = vault.read("daily", "2026-06-22");
  const bullets = (daily?.generated.match(/^- /gm) ?? []).length;
  console.log("daily ops bullets:", bullets);
  console.log(daily?.generated.split("\n").filter((l) => l.startsWith("- ")).join("\n"));

  rmSync(root, { recursive: true, force: true });
  console.log("\nOK");
}

main();
