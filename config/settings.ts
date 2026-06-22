/**
 * Persisted settings overlay. The Options panel writes user choices here; the
 * config below reads them at startup, overriding env defaults. Flat dotted keys
 * (e.g. "voice.mode") keep it simple to read/write. Secrets never live here —
 * only non-sensitive enums/toggles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FILE = process.env.AGENTIC_OS_SETTINGS ?? join(homedir(), ".agentic-os", "settings.json");

/** Keys the Options panel is allowed to set (no secrets). */
export const EDITABLE_KEYS = [
  "router.defaultProvider",
  "router.transport",
  "voice.mode",
  "voice.tts.provider",
  "voice.stt.provider",
  "mail.provider",
  "mail.tokenSource",
] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

let cache: Record<string, string> = load();

function load(): Record<string, string> {
  try {
    if (!existsSync(FILE)) return {};
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of EDITABLE_KEYS) if (typeof raw[k] === "string") out[k] = raw[k] as string;
    return out;
  } catch {
    return {};
  }
}

export function setting(key: EditableKey): string | undefined {
  return cache[key];
}

export function settingsAll(): Record<string, string> {
  return { ...cache };
}

/** Merge + persist allowed keys. Returns the new overlay. Applies on restart. */
export function writeSettings(partial: Record<string, unknown>): Record<string, string> {
  const next = { ...cache };
  for (const k of EDITABLE_KEYS) {
    if (typeof partial[k] === "string") next[k] = partial[k] as string;
  }
  cache = next;
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
