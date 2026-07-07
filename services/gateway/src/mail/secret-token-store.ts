/**
 * Refresh-token storage backed by the config secret store (OS keychain or
 * encrypted file) instead of a plaintext JSON file. Transparently migrates a
 * legacy FileTokenStore token on first read, then removes the plaintext file.
 */
import { rmSync } from "node:fs";
import { getValue, setValues } from "../../../../config/config-store.js";
import type { TokenStore, TokenStoreData } from "./graph-auth.js";

const KEY = "mail.refreshToken";

interface SecretIo {
  get(): string | undefined;
  set(value: string): void;
  deleteLegacyFile?: () => void;
}

export class SecretTokenStore implements TokenStore {
  constructor(
    private readonly legacy?: TokenStore,
    private readonly io: SecretIo = {
      get: () => getValue(KEY),
      set: (v) => setValues({ [KEY]: v }),
    },
  ) {}

  load(): TokenStoreData | null {
    const raw = this.io.get();
    if (raw) {
      try {
        return JSON.parse(raw) as TokenStoreData;
      } catch {
        return null;
      }
    }
    // One-time migration from the legacy plaintext file. Best-effort: a failed
    // secret-backend write must not break auth (the legacy token still works),
    // and the plaintext file is only deleted once the secret copy is readable.
    const migrated = this.legacy?.load() ?? null;
    if (migrated) {
      this.save(migrated);
      if (this.io.get()) {
        try {
          this.io.deleteLegacyFile?.();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    return migrated;
  }

  /**
   * Best-effort persist: a keychain write failure (e.g. a credential-size limit)
   * must not crash the sign-in/refresh flow — the token just isn't persisted and
   * the user re-authenticates next restart.
   */
  save(data: TokenStoreData): void {
    try {
      this.io.set(JSON.stringify(data));
    } catch (err) {
      console.warn(`[mail] could not persist refresh token to the secret store: ${(err as Error).message}`);
    }
  }
}

/** Production wiring: secret store first, legacy file (then deleted) as fallback. */
export function createSecretTokenStore(legacyPath: string, legacy: TokenStore): SecretTokenStore {
  return new SecretTokenStore(legacy, {
    get: () => getValue(KEY),
    set: (v) => setValues({ [KEY]: v }),
    deleteLegacyFile: () => rmSync(legacyPath, { force: true }),
  });
}
