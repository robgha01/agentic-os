/**
 * Mail providers — the hot-swappable inbox backend for the triage skill.
 *
 * `outlook` is implemented against Microsoft Graph (work or personal Outlook /
 * Microsoft 365), authenticated with an access token the user supplies via env.
 * The token is delegated (Mail.Read scope) — obtain it via an Azure AD app
 * (device-code/auth-code flow) or, for testing, Graph Explorer. Token refresh /
 * device-code flow is a documented follow-up; a static token works today.
 *
 * gmail/imap are recognized but not yet implemented (they throw clearly rather
 * than pretend).
 */
import { config } from "../../../../config/agentic-os.config.js";

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  flagged: boolean;
  /** Deep link to open the message, when the provider exposes one. */
  webLink?: string;
}

export interface MailProvider {
  readonly id: string;
  /** Most recent unread messages, newest first. */
  listUnread(limit: number): Promise<MailMessage[]>;
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
    private readonly token: string,
    private readonly baseUrl: string = "https://graph.microsoft.com/v1.0",
  ) {}

  async listUnread(limit: number): Promise<MailMessage[]> {
    const url =
      `${this.baseUrl}/me/mailFolders/inbox/messages` +
      `?$filter=isRead eq false&$top=${Math.max(1, Math.min(limit, 50))}` +
      `&$select=id,subject,from,receivedDateTime,bodyPreview,flag,webLink` +
      `&$orderby=receivedDateTime desc`;

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.token}` },
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
}

/**
 * Build the configured mail provider, or `undefined` when mail is disabled.
 * Throws a descriptive error when a provider is selected but unusable (missing
 * token, or not yet implemented), so the skill surfaces exactly what's wrong.
 */
export function createMailProvider(
  mailConfig = config.mail,
  envSource: NodeJS.ProcessEnv = process.env,
): MailProvider | undefined {
  switch (mailConfig.provider) {
    case "none":
      return undefined;
    case "outlook": {
      const token = envSource[mailConfig.tokenEnv];
      if (!token) {
        throw new Error(
          `mail provider "outlook" needs an access token in $${mailConfig.tokenEnv}`,
        );
      }
      return new OutlookGraphProvider(token, mailConfig.graphBaseUrl);
    }
    case "gmail":
    case "imap":
      throw new Error(`mail provider "${mailConfig.provider}" is not yet implemented`);
  }
}
