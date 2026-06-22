# Mail (inbox triage) — Outlook / Microsoft 365, no Azure app registration

`inbox-triage` reads unread mail via a pluggable `MailProvider`. Outlook /
Microsoft 365 is implemented against Microsoft Graph. **You do not register an
Azure AD app** — token acquisition is pluggable (`config.mail.tokenSource`):

## device-code (default) — sign in like the Outlook app

```bash
AGENTIC_OS_MAIL_PROVIDER=outlook
AGENTIC_OS_MAIL_TOKEN_SOURCE=device-code   # default
```

On first use the OS emits an `auth.prompt` (and a notification): open
`https://microsoft.com/devicelogin` and enter the code. Because your account is
org-managed, Microsoft shows **your org's (Comprend) AD login** automatically.
The refresh token is saved to `~/.agentic-os/mail-token.json` and renewed
silently; you're only re-prompted when it expires/revokes — exactly how the
Outlook app re-pops its sign-in.

Uses the Microsoft-published **Graph CLI** public client id by default
(`AGENTIC_OS_MAIL_CLIENT_ID` to override). Tenant defaults to `common`
(`AGENTIC_OS_MAIL_TENANT` to pin to Comprend's tenant id/domain). First sign-in
may ask you to consent to `Mail.Read` — that's a normal login consent, not an
app registration.

## command — reuse an existing CLI login (az / mgc)

```bash
AGENTIC_OS_MAIL_TOKEN_SOURCE=command
# default command (run `az login` once first):
#   az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv
AGENTIC_OS_MAIL_TOKEN_COMMAND="<your command that prints a Graph token>"
```

## env — static token (testing)

```bash
AGENTIC_OS_MAIL_TOKEN_SOURCE=env
AGENTIC_OS_MAIL_TOKEN=<paste a short-lived Graph token>
```

> `gmail` / `imap` providers are recognized but not yet implemented. The
> device-code network flow runs on your machine; it is not exercised in CI.
