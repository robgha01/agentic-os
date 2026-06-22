/**
 * Persistent config store — the source of truth for configuration.
 *
 * Precedence (resolved by agentic-os.config.ts): env var → this file → default.
 * Env vars are dev/power-user OVERRIDES; the file is what the app (Options
 * panel) writes and what a packaged executable relies on (no env/npm needed).
 *
 * Non-secret keys live in clear in ~/.agentic-os/config.json. SECRETS go to a
 * pluggable backend:
 *   1. the OS keychain (Windows Credential Manager / macOS Keychain / Linux
 *      Secret Service) via the optional @napi-rs/keyring — preferred;
 *   2. otherwise AES-256-GCM encrypted in config.json under a master key file
 *      (no native deps; works on headless boxes and in a single-binary build).
 *
 * Only Node built-ins are required; the keychain module is optional and
 * lazy-probed, so the system runs everywhere and upgrades to the keychain when
 * one is present.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DIR = process.env.AGENTIC_OS_HOME ?? join(homedir(), ".agentic-os");
const CONFIG_FILE = process.env.AGENTIC_OS_CONFIG ?? join(DIR, "config.json");
const KEY_FILE = process.env.AGENTIC_OS_MASTER_KEY_FILE ?? join(DIR, "master.key");
// Overridable so tests/demos use a throwaway keychain service (the keychain is
// system-wide, independent of AGENTIC_OS_HOME).
const KEYCHAIN_SERVICE = process.env.AGENTIC_OS_KEYCHAIN_SERVICE ?? "agentic-os";

/** Non-secret keys the Options panel may set (stored in clear in config.json). */
export const EDITABLE_KEYS = [
  "router.defaultProvider",
  "router.transport",
  "voice.mode",
  "voice.announce",
  "voice.tts.provider",
  "voice.stt.provider",
  "mail.provider",
  "mail.tokenSource",
] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

/** Secret keys — kept in the OS keychain or encrypted; never returned by value. */
export const SECRET_KEYS = ["anthropic.apiKey", "mail.token", "reddit.clientSecret"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];
const SECRET_SET: ReadonlySet<string> = new Set(SECRET_KEYS);

// --- config.json (non-secret + file-backed secrets) ------------------------

let cache: Record<string, unknown> = load();
function load(): Record<string, unknown> {
  try {
    return existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
function persist(): void {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cache, null, 2), "utf8");
}

// --- secret backends --------------------------------------------------------

interface SecretBackend {
  readonly id: string;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  has(key: string): boolean;
}

/** OS keychain via @napi-rs/keyring (optional dependency). undefined if absent/unusable. */
function tryKeychainBackend(): SecretBackend | undefined {
  try {
    const require = createRequire(import.meta.url);
    const { Entry } = require("@napi-rs/keyring") as {
      Entry: new (service: string, account: string) => {
        getPassword(): string;
        setPassword(p: string): void;
        deletePassword(): boolean;
      };
    };
    // Probe: confirm the service actually works (set+delete a throwaway secret).
    const probe = new Entry(KEYCHAIN_SERVICE, "__probe__");
    probe.setPassword("1");
    probe.deletePassword();
    return {
      id: "os-keychain",
      get(key) {
        try {
          return new Entry(KEYCHAIN_SERVICE, key).getPassword();
        } catch {
          return undefined; // not found
        }
      },
      set(key, value) {
        new Entry(KEYCHAIN_SERVICE, key).setPassword(value);
      },
      has(key) {
        try {
          new Entry(KEYCHAIN_SERVICE, key).getPassword();
          return true;
        } catch {
          return false;
        }
      },
    };
  } catch {
    return undefined;
  }
}

/** AES-256-GCM in config.json under a master key file. Always available. */
function fileBackend(): SecretBackend {
  let masterKey: Buffer | undefined;
  const key = (): Buffer => {
    if (masterKey) return masterKey;
    if (existsSync(KEY_FILE)) {
      const k = Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64");
      if (k.length === 32) return (masterKey = k);
    }
    masterKey = randomBytes(32);
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, masterKey.toString("base64"), "utf8");
    try {
      chmodSync(KEY_FILE, 0o600);
    } catch {
      /* no-op on Windows */
    }
    return masterKey;
  };
  const enc = (plain: string): string => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key(), iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
  };
  const dec = (blob: string): string | undefined => {
    try {
      const [iv, tag, ct] = blob.split(":");
      if (!iv || !tag || !ct) return undefined;
      const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  };
  const blobOf = (k: string): string | undefined => {
    const v = cache[k];
    return v && typeof v === "object" && typeof (v as { $enc?: string }).$enc === "string"
      ? (v as { $enc: string }).$enc
      : undefined;
  };
  return {
    id: "encrypted-file",
    get(k) {
      const b = blobOf(k);
      return b ? dec(b) : undefined;
    },
    set(k, value) {
      cache[k] = { $enc: enc(value) };
      persist();
    },
    has(k) {
      return blobOf(k) !== undefined;
    },
  };
}

const secrets: SecretBackend = tryKeychainBackend() ?? fileBackend();

/** Which secret backend is active ("os-keychain" or "encrypted-file"). */
export const secretBackendId = secrets.id;

// --- public API -------------------------------------------------------------

/** Resolved string value for a key (decrypting/fetching secrets), or undefined. */
export function getValue(key: string): string | undefined {
  if (SECRET_SET.has(key)) return secrets.get(key);
  const v = cache[key];
  return v === undefined ? undefined : typeof v === "string" ? v : String(v);
}

/** Write keys; secrets route to the secret backend, non-secrets to config.json. */
export function setValues(partial: Record<string, unknown>): void {
  let touchedFile = false;
  for (const [k, v] of Object.entries(partial)) {
    if (typeof v !== "string") continue;
    if (SECRET_SET.has(k)) {
      secrets.set(k, v);
    } else {
      cache[k] = v;
      touchedFile = true;
    }
  }
  if (touchedFile) persist();
}

export function editableView(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of EDITABLE_KEYS) if (typeof cache[k] === "string") out[k] = cache[k] as string;
  return out;
}

export function secretPresence(): Record<SecretKey, boolean> {
  const out = {} as Record<SecretKey, boolean>;
  for (const k of SECRET_KEYS) out[k] = secrets.has(k);
  return out;
}

export function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}
export function isSecretKey(key: string): key is SecretKey {
  return SECRET_SET.has(key);
}
