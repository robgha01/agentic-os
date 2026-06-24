/**
 * Mail providers — the hot-swappable inbox backend for the triage skill.
 *
 * `outlook` is implemented against Microsoft Graph (work or personal Outlook /
 * Microsoft 365). Tokens come from a pluggable GraphTokenProvider so NO Azure
 * app registration is required — the default is device-code sign-in against a
 * public Microsoft client (see graph-auth.ts), with `command` (az/mgc) and
 * `env` (static) alternatives.
 *
 * gmail/imap are recognized but not yet implemented (they throw clearly).
 */
import { config } from "../../../../config/agentic-os.config.js";
import {
  CommandTokenProvider,
  DeviceCodeTokenProvider,
  FileTokenStore,
  StaticTokenProvider,
  type DeviceCodePrompt,
  type GraphTokenProvider,
} from "./graph-auth.js";

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  flagged: boolean;
  webLink?: string;
}

export interface CalendarEvent {
  subject: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  location?: string;
  organizer?: string;
  webLink?: string;
}

export interface MailProvider {
  readonly id: string;
  listUnread(limit: number): Promise<MailMessage[]>;
  /** Calendar events in [fromIso, toIso); optional — only providers with calendar support it. */
  listEvents?(fromIso: string, toIso: string, limit?: number): Promise<CalendarEvent[]>;
}

interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  webLink?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  flag?: { flagStatus?: string };
}

/** Microsoft 365 / Outlook via Microsoft Graph. */
export class OutlookGraphProvider implements MailProvider {
  readonly id = "outlook";

  constructor(
    private readonly tokens: GraphTokenProvider,
    private readonly baseUrl: string = "https://graph.microsoft.com/v1.0",
  ) {}

  async listUnread(limit: number): Promise<MailMessage[]> {
    const token = await this.tokens.getToken();
    const url =
      `${this.baseUrl}/me/mailFolders/inbox/messages` +
      `?$filter=isRead eq false&$top=${Math.max(1, Math.min(limit, 50))}` +
      `&$select=id,subject,from,receivedDateTime,bodyPreview,flag,webLink` +
      `&$orderby=receivedDateTime desc`;

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Microsoft Graph ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { value?: GraphMessage[] };
    return (data.value ?? []).map((m) => ({
      id: m.id,
      from: m.from?.emailAddress?.address ?? m.from?.emailAddress?.name ?? "unknown",
      subject: m.subject ?? "(no subject)",
      receivedAt: m.receivedDateTime,
      snippet: m.bodyPreview ?? "",
      flagged: m.flag?.flagStatus === "flagged",
      webLink: m.webLink,
    }));
  }

  /** Calendar events in a window (needs the Calendars.Read scope). */
  async listEvents(fromIso: string, toIso: string, limit = 25): Promise<CalendarEvent[]> {
    const token = await this.tokens.getToken();
    const url =
      `${this.baseUrl}/me/calendarView` +
      `?startDateTime=${encodeURIComponent(fromIso)}&endDateTime=${encodeURIComponent(toIso)}` +
      `&$select=subject,start,end,location,organizer,isAllDay,webLink` +
      `&$orderby=start/dateTime&$top=${Math.max(1, Math.min(limit, 50))}`;

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Microsoft Graph ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { value?: GraphEvent[] };
    return (data.value ?? []).map((e) => ({
      subject: e.subject ?? "(no subject)",
      start: e.start?.dateTime ?? "",
      end: e.end?.dateTime ?? "",
      allDay: Boolean(e.isAllDay),
      location: e.location?.displayName || undefined,
      organizer: e.organizer?.emailAddress?.name ?? e.organizer?.emailAddress?.address,
      webLink: e.webLink,
    }));
  }
}

interface GraphEvent {
  subject: string | null;
  isAllDay?: boolean;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  webLink?: string;
}

export interface MailHooks {
  /** Surface a device-code sign-in prompt to the user (HUD popup / notification). */
  onPrompt?: (p: DeviceCodePrompt) => void;
  onResolved?: (ok: boolean) => void;
}

/** Build the Graph token provider implied by config.mail.tokenSource. */
function buildTokenProvider(mailConfig: typeof config.mail, hooks: MailHooks): GraphTokenProvider {
  switch (mailConfig.tokenSource) {
    case "env": {
      // Resolved token: env ($tokenEnv) → encrypted config ("mail.token").
      const token = mailConfig.token;
      if (!token) {
        throw new Error(`mail tokenSource "env" needs a token (set $${mailConfig.tokenEnv} or store "mail.token")`);
      }
      return new StaticTokenProvider(token);
    }
    case "command":
      return new CommandTokenProvider(mailConfig.tokenCommand);
    case "device-code":
      return new DeviceCodeTokenProvider({
        clientId: mailConfig.clientId,
        tenant: mailConfig.tenant,
        scopes: mailConfig.scopes,
        store: new FileTokenStore(mailConfig.tokenStorePath),
        onPrompt: hooks.onPrompt ?? consolePrompt,
        onResolved: hooks.onResolved,
      });
  }
}

function consolePrompt(p: DeviceCodePrompt): void {
  console.log(`\n[mail] Outlook sign-in needed:\n  open ${p.verificationUri}\n  enter code: ${p.userCode}\n`);
}

/**
 * Build the configured mail provider, or `undefined` when mail is disabled.
 * Throws a descriptive error when a provider is selected but unusable.
 */
export function createMailProvider(
  mailConfig = config.mail,
  hooks: MailHooks = {},
): MailProvider | undefined {
  switch (mailConfig.provider) {
    case "none":
      return undefined;
    case "outlook":
      return new OutlookGraphProvider(buildTokenProvider(mailConfig, hooks), mailConfig.graphBaseUrl);
    case "gmail":
    case "imap":
      throw new Error(`mail provider "${mailConfig.provider}" is not yet implemented`);
  }
}
