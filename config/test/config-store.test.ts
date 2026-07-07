import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  vi.stubEnv("AGENTIC_OS_HOME", mkdtempSync(join(tmpdir(), "aos-cfg-")));
  vi.stubEnv("AGENTIC_OS_NO_KEYCHAIN", "1"); // never touch the real credential manager
  return import("../config-store.js");
}

describe("config-store setValues", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("persists strings", async () => {
    const s = await freshStore();
    s.setValues({ "ollama.model": "llama3:8b" });
    expect(s.getValue("ollama.model")).toBe("llama3:8b");
  });

  it("coerces numbers and booleans instead of silently dropping them", async () => {
    const s = await freshStore();
    s.setValues({ "tasks.maxConcurrent": 4, "voice.announce": false });
    expect(s.getValue("tasks.maxConcurrent")).toBe("4");
    expect(s.getValue("voice.announce")).toBe("false");
  });

  it("still drops objects and arrays", async () => {
    const s = await freshStore();
    s.setValues({ "ollama.model": { nope: true } });
    expect(s.getValue("ollama.model")).toBeUndefined();
  });

  it("round-trips a secret through the encrypted-file backend", async () => {
    const s = await freshStore();
    expect(s.secretBackendId).toBe("encrypted-file");
    s.setValues({ "x.bearerToken": "tok-123" });
    expect(s.getValue("x.bearerToken")).toBe("tok-123");
    expect(s.secretPresence()["x.bearerToken"]).toBe(true);
  });
});
