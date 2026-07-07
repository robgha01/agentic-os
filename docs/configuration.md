# Configuration & Secrets

## Precedence: env → file → default

Every setting resolves in this order (see `config/agentic-os.config.ts`):

1. **Environment variable** — an *override* (handy in dev/CI).
2. **Config file** — the **source of truth** (`config-store.ts`), so a future
   standalone executable works with no env and no npm.
3. **Built-in default**.

`config` is a plain object; `reloadConfig()` re-reads it after a settings change
so edits apply live without a restart.

## Secrets

Secrets are **never** stored in plaintext config, never returned by value over
`/config` (only presence), and never logged or committed.

- Stored in the **OS keychain** via `@napi-rs/keyring` when available, else an
  **AES-256-GCM encrypted file** under a master key with locked-down perms.
- On the encrypted-file backend the master key sits beside the ciphertext (and
  `chmod 600` is a no-op on Windows) — it protects against accidental plaintext
  exposure (logs, commits, backups), not against another process running as you.
  Prefer the OS-keychain backend where available.
- The secret backend in use is reported as `secretBackend` on `/config`.
- Secret keys are whitelisted in `SECRET_KEYS` (`config/config-store.ts`):
  `anthropic.apiKey`, `openai.apiKey`, `mail.token`, `mail.refreshToken`,
  `x.bearerToken`.
- Editable non-secret keys are whitelisted in `EDITABLE_KEYS`. `POST /settings`
  and `POST /secrets` drop anything not whitelisted.

Set secrets in the HUD **Options → Secrets** card (password inputs; values go
straight to the keychain and are never echoed back).

## Key settings

| Area | Key(s) | Default |
|---|---|---|
| Router brain | `router.defaultProvider` (`haiku`\|`ollama`\|`openai`) | `haiku` |
| Claude transport | `router.transport` (`sdk`\|`headless`) | `sdk` (use `headless` for no-key) |
| Anthropic | `anthropic.routerModel`, `anthropic.heavyModel`, `anthropic.apiKey`* | `claude-haiku-4-5`, `claude-opus-4-8` |
| Ollama | `ollama.baseUrl`, `ollama.model` | `http://localhost:11434`, `llama3:8b` |
| OpenAI-compatible | `openai.baseUrl`, `openai.model`, `openai.apiKey`* | `https://api.openai.com/v1`, `gpt-4o-mini` |
| Execution fallback | `models.fallbackOrder`, `models.disabled` | `claude-code,openai,ollama,haiku` |
| Voice | `voice.mode` (`text`\|`voice`), `voice.announce`, `voice.tts.provider` (`kokoro`\|`kokoro-onnx`\|`openai`\|`elevenlabs`), `voice.tts.voice`, `voice.stt.provider` | `text`, `true`, `kokoro`, `af_heart`, `faster-whisper` |
| Mail | `mail.provider`, `mail.tokenSource` | `none`, `device-code` |
| Vault | `vault.path`, `vault.managedBlocks` | repo `vault/`, `false` |
| Network access | `security.allowRemoteAccess` (localhost-only vs trusted-LAN) | `false` |

`*` = secret (keychain). Most are editable live in **Options**.

---

## Models & providers

Two **independent** model paths. Skills **cannot** influence the brain.

### The router brain (config-only)

Orchestrates fast intent routing only. Chosen purely from `router.defaultProvider`
+ `router.transport`. If the configured brain isn't ready, it falls back to the
first ready one. Default Haiku via headless `claude -p` needs no API key.

### Skill execution (policy-driven)

Each skill declares a `modelPolicy` (`execTier` none/light/heavy · `privacy`
local-only/cloud-ok · optional `pin` · budgets). `ModelSelector.selectModel()`
resolves it to a concrete `ModelSelection {provider, model}`; `skill-runtime`
builds the matching `LlmService` (`createLlmForSelection`) and injects it.

### Providers

| id | What | Needs |
|---|---|---|
| `haiku` | cheap Anthropic model (light tier, router default) | headless: nothing · sdk: `anthropic.apiKey` |
| `claude-code` | strong Anthropic (Opus) via headless `claude -p` (heavy) | local Claude Code login |
| `ollama` | any local Ollama model, native `/api/chat` | Ollama daemon running |
| `openai` | any OpenAI-compatible `/v1/chat/completions` (local LM Studio/vLLM or remote OpenRouter/Together/Groq/OpenAI/Azure) | `openai.apiKey` + `openai.baseUrl` |

### Readiness & fallback

A provider is a candidate only if **enabled ∧ configured ∧ reachable**:

- **enabled** — not in `models.disabled` (per-provider toggle in Options).
- **configured** — required setup present (anthropic: headless always / sdk needs
  key; openai: key present; ollama: always).
- **reachable** — Ollama daemon responds; cloud → network up.

For a skill with **no pin**: candidates that serve the tier, satisfy privacy, are
ready, and fit the budget are sorted by `models.fallbackOrder` → first wins. With
a **pin**: that provider exactly, **no fallback** (fails clearly if it's down). If
nothing qualifies, the operation **fails loudly** with the reason — never a silent
substitution.

Because headless Claude needs no key, the system works out of the box; add OpenAI
or Ollama and reorder the fallback in **Options → Models & providers**, which also
shows each provider's live status (`ready` / `not set up` / `unreachable`).
