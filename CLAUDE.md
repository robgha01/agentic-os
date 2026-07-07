# CLAUDE.md — working in the Agentic OS repo

Guidance for Claude Code when working in this repository. Read alongside
[`README.md`](README.md) and [`docs/`](docs/).

## What this is

A local-first developer mission-control: a **TS gateway** (routing → model
selection → skills → events → Obsidian vault) feeding a **Vite/React HUD** over
WebSocket, with an opt-in **Python voice sidecar**. npm-workspaces monorepo
(`@aos/*`), TypeScript strict, ESM (`"type": "module"`, `moduleResolution:
Bundler`, run via `tsx`).

```
apps/hud · services/gateway · services/voice · packages/shared · config · skills · vault · docs
```

## Run & verify

- Gateway: `npm run start` (`:7777`). HUD: `npm run hud` (`:5173`).
- Typecheck before claiming done: `npm run typecheck -w @aos/gateway` and
  `npm run build -w @aos/hud`. The HUD is a **Vite dev server**, so source edits
  hot-reload live — no rebuild needed to see a change, but still typecheck.
- Smoke scripts live in `services/gateway/scripts/*` (`npm run route-demo`,
  `research-demo`, `vault-demo`, …). Prefer driving the gateway over its
  WebSocket for end-to-end checks (open `ws://localhost:7777`, send a
  `ClientCommand`, watch `OsEvent`s).
- **Windows**: this dev machine is Windows. `claude` resolves to `claude.cmd`, so
  any `spawn` of it needs `shell: true` (already done in the headless LLM/router).
  Free a stuck port with PowerShell `Get-NetTCPConnection -LocalPort 7777 | … Stop-Process`.
- **Headless `claude -p` isolation**: every headless spawn (LLM completion, router,
  skill execution) passes `--setting-sources project,local` so the user's *global*
  plugins/hooks (superpowers, claude-mem, …) don't fire on these automated
  sub-calls — otherwise each call runs the full SessionStart chain (~100KB of hook
  output under `stream-json`, a claude-mem worker boot, and stray observations).
  OAuth auth is untouched (not a setting source). All three sites route through
  `claudeSettingArgs()` in `services/gateway/src/util/claude-args.ts`; flip its
  `ISOLATE_HEADLESS_SESSIONS` constant to `false` (or set `claudeCode.settingSources`
  empty) to restore loading all sources. Keep completion **buffered plain-text** —
  do not switch to `--output-format stream-json --verbose` (that's what surfaced
  the flood in the first place).

## Conventions

- **Commit straight to `main`** (the user rejected feature branches for this
  repo). Commit/push only when asked. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Models**: default to `claude-opus-4-8` for heavy, `claude-haiku-4-5` for the
  router/light tier. Model ids come from `config`, never hardcoded inline. When
  writing Claude API/SDK code, follow the `claude-api` skill.
- **Don't commit**: generated vault records (`vault/**` except seeds in
  `_meta`/`_templates`/`90-maps`), `planing/*.png`, `.env*`. These are gitignored.
- **Frontend verification**: prefer a browser MCP for visual changes. `claude-in-chrome`
  is the stable path here (new tab → navigate → `computer` screenshot); the
  `chrome-devtools` MCP works for a read/screenshot but **crashes when you drive
  navigation/reload through it**. If neither is up, say so and rely on build + WS checks.

## Architecture rules that matter

- **Two model paths, kept separate** ([docs/configuration.md](docs/configuration.md#models--providers)):
  the **router brain** is config-only (`router.defaultProvider`, default haiku) and
  **skills can never influence it**. **Skill execution** is driven by each skill's
  `modelPolicy` → `ModelSelector` → `ModelSelection` → `createLlmForSelection`.
  Don't blur these.
- **Provider selection** = enabled ∧ configured ∧ reachable, ordered by the
  configurable `models.fallbackOrder`. `pin` = exact-or-fail (no fallback). Nothing
  ready → loud `operation.failed`, never a silent wrong model.
- **Config precedence is env → file → default** (env is the *override*; the file is
  the source of truth so a future no-npm executable works). Secrets go through the
  OS keychain (or encrypted-file fallback) — never plaintext in `config.json`,
  never returned by value over `/config` (presence only), never logged/committed.
  Editable keys are whitelisted (`EDITABLE_KEYS`/`SECRET_KEYS` in `config/config-store.ts`).
- **Vault records are the source of truth** and must read well for a human OR an
  LLM with no context ([docs/vault.md](docs/vault.md)): provenance frontmatter +
  `# Title` → `> **TL;DR**` (the spoken core) → required sections → `## Sources` →
  `## Related` `[[wikilinks]]`. No footer noise. Build via `buildResultDocument`
  (it enforces the per-type contract). Skills declare `produces` so the dispatcher
  can serve fresh records instead of re-running.
- **Events**: the gateway emits `OsEvent`s on the bus; the WS server broadcasts to
  the HUD. Clients send `ClientCommand`s (`route` | `invoke` | `speak` | `ping`).
  Contracts live in `packages/shared/src/events.ts` — change them there, not ad hoc.
- **Live settings apply** without restart: `/settings` & `/secrets` POST →
  `applyConfig()` reloads config and rebuilds router/runtime/llm/voice in place.

## Skills

A skill is a manifest in `skills/<id>/skill.manifest.json` (schema in
`packages/shared/src/skill.ts`). Key fields: `triggers`, `surfaces`
(`deck`/`nl`/`[]` = internal sub-skill), `presentation` (deck button + inputs),
`modelPolicy`, `execution` (`claude-headless` | `process` | `native` | `composite`),
`produces` (freshness key). Native handlers register in
`services/gateway/src/skills/native-registry.ts` and receive injected `services`
(vault, clock, optional mail, the selection-resolved llm). See [docs/skills.md](docs/skills.md).

## When unsure

Read the relevant `docs/` page and the contracts in `packages/shared/src/`. Match
the surrounding code's idiom. Verify with a typecheck + a WS or browser smoke
before reporting something as working — and report failures honestly with output.
