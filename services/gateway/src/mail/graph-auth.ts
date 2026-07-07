/**
 * Microsoft Graph token acquisition — no Azure app registration required.
 *
 * Strategies behind a common `GraphTokenProvider` interface:
 *  - StaticTokenProvider  : a token from env (testing).
 *  - CommandTokenProvider : runs a shell command that prints a token (az/mgc).
 *  - DeviceCodeTokenProvider : OAuth2 device-code flow against a PUBLIC Microsoft
 *    client (Microsoft Graph CLI). The user signs in once in the browser (their
 *    org's AD login appears automatically for work accounts); we persist the
 *    refresh token and silently renew. When the refresh expires/revokes we
 *    re-prompt — exactly how the Outlook app re-pops its sign-in.
 *
 * Network/clock/sleep are injectable so the device-code state machine is fully
 * testable offline.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface GraphTokenProvider {
  getToken(): Promise<string>;
}

export interface DeviceCodePrompt {
  verificationUri: string;
  userCode: string;
  message: string;
  expiresAt: string;
}

// --- Static (env) -----------------------------------------------------------

export class StaticTokenProvider implements GraphTokenProvider {
  constructor(private readonly token: string) {}
  async getToken(): Promise<string> {
    return this.token;
  }
}

// --- Command (az / mgc / custom) -------------------------------------------

export class CommandTokenProvider implements GraphTokenProvider {
  constructor(private readonly command: string) {}

  getToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Run through the shell so the user's full command string works as-is.
      const child = spawn(this.command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) => reject(new Error(`token command failed to start: ${e.message}`)));
      child.on("close", (code) => {
        const token = out.trim();
        if (code === 0 && token) resolve(token);
        else reject(new Error(`token command exited ${code}: ${err.trim() || "no token on stdout"}`));
      });
    });
  }
}

// --- Device code (no app registration) -------------------------------------

export interface TokenStoreData {
  refreshToken: string;
  clientId: string;
  tenant: string;
}

/** Where the long-lived refresh token lives (file = legacy, secret store = current). */
export interface TokenStore {
  load(): TokenStoreData | null;
  save(data: TokenStoreData): void;
}

export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  load(): TokenStoreData | null {
    try {
      if (!existsSync(this.path)) return null;
      return JSON.parse(readFileSync(this.path, "utf8")) as TokenStoreData;
    } catch {
      return null;
    }
  }

  save(data: TokenStoreData): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(data, null, 2), "utf8");
  }
}

export interface AuthTransport {
  postForm(url: string, form: Record<string, string>): Promise<{ status: number; body: any }>;
}

const fetchTransport: AuthTransport = {
  async postForm(url, form) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15000),
    });
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return { status: res.status, body };
  },
};

export interface DeviceCodeOptions {
  clientId: string;
  tenant: string;
  scopes: string;
  store: TokenStore;
  onPrompt: (p: DeviceCodePrompt) => void;
  onResolved?: (ok: boolean) => void;
  // Test seams (default to real implementations):
  transport?: AuthTransport;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

export class DeviceCodeTokenProvider implements GraphTokenProvider {
  private readonly transport: AuthTransport;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly nowMs: () => number;
  private accessToken?: string;
  private accessExpMs = 0;

  constructor(private readonly opts: DeviceCodeOptions) {
    this.transport = opts.transport ?? fetchTransport;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  private get tokenUrl(): string {
    return `https://login.microsoftonline.com/${this.opts.tenant}/oauth2/v2.0/token`;
  }
  private get deviceCodeUrl(): string {
    return `https://login.microsoftonline.com/${this.opts.tenant}/oauth2/v2.0/devicecode`;
  }

  async getToken(): Promise<string> {
    // 1. Valid cached access token (60s safety margin).
    if (this.accessToken && this.accessExpMs > this.nowMs() + 60_000) return this.accessToken;

    // 2. Try a silent refresh.
    const stored = this.opts.store.load();
    if (stored?.refreshToken) {
      try {
        return await this.refresh(stored.refreshToken);
      } catch {
        // refresh expired/revoked -> fall through to interactive sign-in
      }
    }

    // 3. Interactive device-code sign-in.
    return this.deviceCodeFlow();
  }

  private cache(body: any): string {
    this.accessToken = body.access_token as string;
    this.accessExpMs = this.nowMs() + Number(body.expires_in ?? 3600) * 1000;
    if (body.refresh_token) {
      this.opts.store.save({
        refreshToken: body.refresh_token as string,
        clientId: this.opts.clientId,
        tenant: this.opts.tenant,
      });
    }
    return this.accessToken;
  }

  private async refresh(refreshToken: string): Promise<string> {
    const { status, body } = await this.transport.postForm(this.tokenUrl, {
      client_id: this.opts.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: this.opts.scopes,
    });
    if (status !== 200 || !body.access_token) {
      throw new Error(`refresh failed: ${body.error ?? status}`);
    }
    return this.cache(body);
  }

  private async deviceCodeFlow(): Promise<string> {
    const start = await this.transport.postForm(this.deviceCodeUrl, {
      client_id: this.opts.clientId,
      scope: this.opts.scopes,
    });
    if (start.status !== 200 || !start.body.device_code) {
      this.opts.onResolved?.(false);
      throw new Error(`device-code request failed: ${start.body.error ?? start.status}`);
    }

    const dc = start.body;
    const expiresAt = new Date(this.nowMs() + Number(dc.expires_in ?? 900) * 1000).toISOString();
    this.opts.onPrompt({
      verificationUri: dc.verification_uri ?? "https://microsoft.com/devicelogin",
      userCode: dc.user_code,
      message: dc.message ?? `Sign in at ${dc.verification_uri} and enter ${dc.user_code}`,
      expiresAt,
    });

    let intervalMs = Number(dc.interval ?? 5) * 1000;
    const deadline = this.nowMs() + Number(dc.expires_in ?? 900) * 1000;

    while (this.nowMs() < deadline) {
      await this.sleep(intervalMs);
      const poll = await this.transport.postForm(this.tokenUrl, {
        client_id: this.opts.clientId,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: dc.device_code,
      });
      if (poll.status === 200 && poll.body.access_token) {
        const token = this.cache(poll.body);
        this.opts.onResolved?.(true);
        return token;
      }
      const err = poll.body.error;
      if (err === "authorization_pending") continue;
      if (err === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      // declined / expired / bad request -> stop
      this.opts.onResolved?.(false);
      throw new Error(`device-code sign-in failed: ${err ?? poll.status}`);
    }

    this.opts.onResolved?.(false);
    throw new Error("device-code sign-in timed out");
  }
}
