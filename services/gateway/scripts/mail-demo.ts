/**
 * Inbox triage smoke demo. Run: `npm run mail-demo -w @aos/gateway`.
 *
 *  A) inboxTriage with an injected stub MailProvider (seeded messages) — proves
 *     triage heuristics + the vault inbox record, fully offline.
 *  B) no mail provider configured -> handler fails clearly (no fake fallback).
 *
 * The real Outlook/Graph provider is exercised on your machine with a token
 * (AGENTIC_OS_MAIL_PROVIDER=outlook, AGENTIC_OS_MAIL_TOKEN=...).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoutedIntent } from "@aos/shared";
import { VaultAdapter } from "../src/memory/vault-adapter.js";
import { NATIVE_HANDLERS, type SkillServices } from "../src/skills/native-registry.js";
import type { MailMessage, MailProvider } from "../src/mail/mail-provider.js";

const NOW = "2026-06-22T08:00:00Z";
const intent: RoutedIntent = { actionId: "inbox-triage", source: "direct", confidence: 1, parameters: {}, rawInput: "invoke:inbox-triage" };

const SEED: MailMessage[] = [
  { id: "1", from: "boss@corp.com", subject: "Q3 numbers — can you review by Friday?", receivedAt: NOW, snippet: "Need your sign-off.", flagged: true, webLink: "https://outlook.office.com/mail/1" },
  { id: "2", from: "newsletter@devweekly.com", subject: "DevWeekly #412", receivedAt: NOW, snippet: "This week in...", flagged: false },
  { id: "3", from: "alice@corp.com", subject: "Lunch?", receivedAt: NOW, snippet: "Free at noon?", flagged: false },
  { id: "4", from: "noreply@ci.example.com", subject: "Build #889 passed", receivedAt: NOW, snippet: "All green.", flagged: false },
];

const stubMail: MailProvider = {
  id: "stub",
  async listUnread(limit) {
    return SEED.slice(0, limit);
  },
};

async function main(): Promise<void> {
  console.log("=== Agentic OS — inbox triage smoke demo ===");
  const root = mkdtempSync(join(tmpdir(), "aos-mail-"));
  const vault = new VaultAdapter(root);

  // A) triage with stub provider
  console.log("\n--- A) inboxTriage (stub provider, offline) ---");
  const services: SkillServices = { vault, nowIso: () => NOW, mail: stubMail };
  const code = await NATIVE_HANDLERS.inboxTriage!({
    intent,
    params: {},
    context: {},
    services,
    emit: (c) => process.stdout.write(`  ${c}`),
  });
  const rec = vault.read("inbox", "2026-06-22");
  console.log("exit           :", code);
  console.log("TL;DR          :", rec?.generated.split("\n").find((l) => l.includes("TL;DR"))?.replace(/^>\s*/, ""));
  console.log("action items   :", (rec?.generated.match(/^- \*\*/gm) ?? []).length, "(expected 2: boss + alice)");
  console.log("status         :", rec?.frontmatter.status, "| stale_after:", rec?.frontmatter.staleAfterMinutes, "min");

  // B) no provider configured
  console.log("\n--- B) no mail provider configured ---");
  const noMail: SkillServices = { vault, nowIso: () => NOW };
  const failCode = await NATIVE_HANDLERS.inboxTriage!({
    intent,
    params: {},
    context: {},
    services: noMail,
    emit: (c) => process.stdout.write(`  ${c}`),
  });
  console.log("exit (nonzero) :", failCode);

  rmSync(root, { recursive: true, force: true });
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
