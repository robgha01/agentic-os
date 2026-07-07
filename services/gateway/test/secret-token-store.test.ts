import { describe, expect, it } from "vitest";
import { SecretTokenStore } from "../src/mail/secret-token-store.js";
import type { TokenStore, TokenStoreData } from "../src/mail/graph-auth.js";

const data: TokenStoreData = { refreshToken: "rt", clientId: "c", tenant: "t" };

function fakeIo(initial?: string) {
  let stored = initial;
  let legacyDeleted = false;
  return {
    io: {
      get: () => stored,
      set: (v: string) => {
        stored = v;
      },
      deleteLegacyFile: () => {
        legacyDeleted = true;
      },
    },
    read: () => stored,
    wasLegacyDeleted: () => legacyDeleted,
  };
}

const legacyWith = (d: TokenStoreData | null): TokenStore => ({ load: () => d, save: () => {} });

describe("SecretTokenStore", () => {
  it("round-trips through the secret backend", () => {
    const f = fakeIo();
    const store = new SecretTokenStore(undefined, f.io);
    store.save(data);
    expect(store.load()).toEqual(data);
  });

  it("prefers the secret backend over the legacy file", () => {
    const f = fakeIo(JSON.stringify(data));
    const store = new SecretTokenStore(legacyWith({ ...data, refreshToken: "old" }), f.io);
    expect(store.load()?.refreshToken).toBe("rt");
  });

  it("migrates a legacy file token into the secret backend and deletes the file", () => {
    const f = fakeIo();
    const store = new SecretTokenStore(legacyWith(data), f.io);
    expect(store.load()).toEqual(data); // served from legacy
    expect(JSON.parse(f.read()!)).toEqual(data); // and persisted to secrets
    expect(f.wasLegacyDeleted()).toBe(true);
  });

  it("returns null when nothing is stored anywhere", () => {
    expect(new SecretTokenStore(legacyWith(null), fakeIo().io).load()).toBeNull();
  });
});
