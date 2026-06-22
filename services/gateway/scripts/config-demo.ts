/**
 * Config store smoke demo. Run: `npm run config-demo -w @aos/gateway`.
 *
 *  A) Secret round-trip via the active backend (keychain or encrypted-file);
 *     a non-secret stored in clear; verify the plaintext secret is NOT in
 *     config.json.
 *  B) Precedence: env override wins over the config file; the file is used when
 *     no env is set.
 *
 * Uses a throwaway AGENTIC_OS_HOME so nothing real is touched. Imports are
 * dynamic so the temp home is set before the store module loads.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  console.log("=== Agentic OS — config store smoke demo ===");
  const home = mkdtempSync(join(tmpdir(), "aos-cfg-"));
  process.env.AGENTIC_OS_HOME = home;
  // Throwaway keychain service so the demo never touches the real one.
  const svc = `agentic-os-demo-${process.pid}`;
  process.env.AGENTIC_OS_KEYCHAIN_SERVICE = svc;

  // A) secret + non-secret round-trip
  console.log("\n--- A) secret round-trip ---");
  const store = await import("../../../config/config-store.js");
  console.log("secret backend :", store.secretBackendId);
  store.setValues({
    "router.transport": "headless",
    "voice.mode": "voice",
    "anthropic.apiKey": "sk-TESTSECRET-123",
  });
  console.log("non-secret get :", store.getValue("router.transport"), "(expect headless)");
  console.log("secret get     :", store.getValue("anthropic.apiKey"), "(expect sk-TESTSECRET-123)");
  console.log("secret present :", store.secretPresence()["anthropic.apiKey"]);
  const raw = readFileSync(join(home, "config.json"), "utf8");
  console.log("plaintext leaked into config.json:", raw.includes("sk-TESTSECRET-123"), "(expect false)");
  console.log("editable view  :", store.editableView());

  // B) precedence: env override > file
  console.log("\n--- B) precedence (env override > file) ---");
  process.env.AGENTIC_OS_ROUTER_TRANSPORT = "sdk"; // override the file's "headless"
  const { config } = await import("../../../config/agentic-os.config.js");
  console.log("transport (env set) :", config.router.transport, "(expect sdk — env wins)");
  console.log("voice mode (no env) :", config.voice.mode, "(expect voice — from file)");
  console.log("apiKey resolved     :", config.anthropic.apiKey ? "present (from file)" : "<none>");

  // Clean up: remove the temp config dir and any keychain entries we created.
  rmSync(home, { recursive: true, force: true });
  if (store.secretBackendId === "os-keychain") {
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      const { Entry } = req("@napi-rs/keyring") as {
        Entry: new (s: string, a: string) => { deletePassword(): boolean };
      };
      for (const k of ["anthropic.apiKey", "mail.token", "reddit.clientSecret", "__probe__"]) {
        try {
          new Entry(svc, k).deletePassword();
        } catch {
          /* not set */
        }
      }
    } catch {
      /* keyring gone */
    }
  }
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
