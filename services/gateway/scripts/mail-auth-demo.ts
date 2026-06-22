/**
 * Device-code sign-in smoke demo. Run: `npm run mail-auth-demo -w @aos/gateway`.
 *
 * Exercises the full DeviceCodeTokenProvider state machine offline via an
 * injected fake transport (no Microsoft network / account):
 *   A) First sign-in: device code -> prompt shown -> poll pending -> success;
 *      access token returned, refresh token persisted to a temp store.
 *   B) Silent refresh: a fresh provider with the same store renews WITHOUT
 *      prompting (the "stays signed in" path).
 *   C) Refresh expired/revoked: refresh fails -> re-prompts (the Outlook-style
 *      "finish login" re-pop) -> succeeds again.
 *
 * The real flow talks to login.microsoftonline.com with a public client id;
 * that network path is not exercised here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceCodeTokenProvider,
  FileTokenStore,
  type AuthTransport,
  type DeviceCodePrompt,
} from "../src/mail/graph-auth.js";

const OPTS_BASE = {
  clientId: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
  tenant: "common",
  scopes: "https://graph.microsoft.com/Mail.Read offline_access",
  sleep: async () => {}, // no waiting in the demo
  nowMs: () => 1_000_000,
};

/** A scriptable fake of the Microsoft token endpoints. */
function fakeTransport(opts: { refreshValid: boolean }): AuthTransport {
  let pollCount = 0;
  return {
    async postForm(url, form) {
      if (url.endsWith("/devicecode")) {
        return {
          status: 200,
          body: {
            device_code: "DEV-123",
            user_code: "F7Q2-9XKD",
            verification_uri: "https://microsoft.com/devicelogin",
            message: "Go to https://microsoft.com/devicelogin and enter F7Q2-9XKD",
            interval: 1,
            expires_in: 900,
          },
        };
      }
      // token endpoint
      if (form.grant_type === "refresh_token") {
        return opts.refreshValid
          ? { status: 200, body: { access_token: "ACCESS-refreshed", refresh_token: "RT-2", expires_in: 3600 } }
          : { status: 400, body: { error: "invalid_grant" } };
      }
      // device_code grant: pending once, then success
      pollCount += 1;
      if (pollCount < 2) return { status: 400, body: { error: "authorization_pending" } };
      return { status: 200, body: { access_token: "ACCESS-new", refresh_token: "RT-1", expires_in: 3600 } };
    },
  };
}

async function main(): Promise<void> {
  console.log("=== Agentic OS — device-code sign-in smoke demo ===");
  const dir = mkdtempSync(join(tmpdir(), "aos-auth-"));
  const storePath = join(dir, "mail-token.json");
  const store = new FileTokenStore(storePath);
  const prompts: DeviceCodePrompt[] = [];
  const resolved: boolean[] = [];

  // A) First sign-in (no stored refresh token).
  console.log("\n--- A) first sign-in (device code) ---");
  const p1 = new DeviceCodeTokenProvider({
    ...OPTS_BASE,
    store,
    onPrompt: (p) => prompts.push(p),
    onResolved: (ok) => resolved.push(ok),
    transport: fakeTransport({ refreshValid: true }),
  });
  const t1 = await p1.getToken();
  console.log("prompt shown   :", prompts.length === 1 ? `yes (code ${prompts[0]!.userCode})` : "NO");
  console.log("token          :", t1);
  console.log("refresh stored :", store.load()?.refreshToken ?? "<none>");

  // B) Silent refresh (fresh provider, same store) — no prompt.
  console.log("\n--- B) silent refresh (fresh provider) ---");
  const promptsB: DeviceCodePrompt[] = [];
  const p2 = new DeviceCodeTokenProvider({
    ...OPTS_BASE,
    store,
    onPrompt: (p) => promptsB.push(p),
    transport: fakeTransport({ refreshValid: true }),
  });
  const t2 = await p2.getToken();
  console.log("token          :", t2);
  console.log("prompted again :", promptsB.length > 0 ? "yes (unexpected)" : "no (silent — correct)");

  // C) Refresh expired/revoked -> re-prompt (Outlook-style re-login).
  console.log("\n--- C) refresh expired -> re-prompt ---");
  const promptsC: DeviceCodePrompt[] = [];
  const p3 = new DeviceCodeTokenProvider({
    ...OPTS_BASE,
    store,
    onPrompt: (p) => promptsC.push(p),
    transport: fakeTransport({ refreshValid: false }),
  });
  const t3 = await p3.getToken();
  console.log("re-prompted    :", promptsC.length === 1 ? "yes (correct — like Outlook re-login)" : "NO");
  console.log("token          :", t3);

  rmSync(dir, { recursive: true, force: true });
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
