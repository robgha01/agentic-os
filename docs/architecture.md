# Architecture

Agentic OS is an npm-workspaces monorepo. A TypeScript **gateway** owns
routing, model selection, skill execution, and memory; a React **HUD** renders
its live state over WebSocket; an optional Python **voice sidecar** adds STT/TTS.

```
                 ┌──────────────────────────────────────────────┐
   Voice in ──►  │  PYTHON VOICE SIDECAR  (services/voice)        │  (opt-in scaffold)
                 │   faster-whisper (STT) · Kokoro (TTS)          │
                 └───────────────┬──────────────────────────────┘
                                 │ HTTP (text in, audio out)
                 ┌───────────────▼──────────────────────────────┐
   HUD ◄──WS──►  │  TS GATEWAY  (services/gateway)               │
 (apps/hud)      │   Router ─► Dispatcher ─► ModelSelector        │
                 │     │                          │               │
                 │     │                          ▼               │
                 │     │                    SkillRuntime ──► LLM   │
                 │     ▼                          │  (haiku/ollama/openai/claude-code)
                 │   EventBus ◄───────────────────┘               │
                 │     │  broadcast OsEvents                       │
                 │     ▼                                           │
                 │   VaultAdapter ─► Obsidian vault (markdown)     │
                 └───────────────────────────────────────────────┘
```

## Components (`services/gateway/src`)

- **`routing/`** — the two-path router. `router.ts` tries the regex table
  (`routes.config.ts`) first (instant, no LLM, confidence 1); on a miss it calls
  the **semantic brain** (`semantic/intent-router.ts` over a `RouterProvider`:
  `anthropic-haiku`, `claude-headless`, `ollama`, `openai`). The brain is chosen
  from config only (default haiku) and never from a skill.
- **`models/`** — the per-skill model layer. `models.config.ts` holds the provider
  registry + the configurable fallback order; `model-selector.ts` resolves a
  skill's `modelPolicy` to a concrete `ModelSelection` (provider + model) by a
  cascade (pin → tier → privacy → readiness → budget → fallback order).
- **`dispatch/dispatcher.ts`** — turns an utterance/invoke into a running
  operation: route → find bound skill → run the model cascade → hand to the
  runtime. Also the **freshness guard**: if a skill `produces` a record that's
  still fresh, it serves it instantly instead of re-running (unless `force`).
- **`skills/`** — `skill-loader.ts` validates manifests; `skill-runtime.ts`
  executes a skill (and composite sub-skills), streaming output as events; it
  builds the per-op LLM from the selection and injects it. `native-registry.ts`
  holds the in-gateway TS handlers.
- **`memory/`** — `vault-adapter.ts` (read/write/freshness), `document-builder.ts`
  (contract-enforcing record assembly + spoken-core extraction), `markdown.ts`
  (frontmatter + managed blocks), `vault-recorder.ts` (appends each op to the
  daily Operations log).
- **`voice/speaker.ts`** — `say()` emits a `speech` event (and synthesizes audio
  in voice mode); `SpeechBridge` voices notifications. The server also
  auto-announces finished tasks' spoken core in voice mode.
- **`bus/`** — `event-bus.ts` (in-process pub/sub) and `ws-server.ts` (HTTP +
  WebSocket; broadcasts `OsEvent`s, accepts `ClientCommand`s, serves the REST
  endpoints below).
- **`server.ts`** — boot: detect runtime → build router → load skills → wire
  bus/audit/dispatch/voice → start the server. `applyConfig()` rebuilds the live
  pieces on a settings change (no restart).

## Request lifecycle

1. HUD sends a `ClientCommand` over WS: `route` (free text), `invoke` (deck
   button, deck-gated), or `speak` (read a record aloud).
2. Dispatcher resolves the skill, runs the freshness guard, then the model
   cascade, emitting `routing.resolved` / `operation.started`.
3. SkillRuntime executes — streaming `operation.output`, then
   `operation.completed` (with the produced record as `result`) or
   `operation.failed`.
4. VaultRecorder logs the op to today's daily note; the record is written to the
   vault. The HUD spawns a notification card and refreshes the V.A.U.L.T. feed.

## Event & command contracts (`packages/shared/src/events.ts`)

`OsEvent` (gateway → clients): `routing.resolved`, `operation.started`,
`operation.output`, `operation.completed` (carries `result {path,title,type}`),
`operation.failed`, `notification` (optional `speak:false`), `metric`, `speech`,
`auth.prompt`, `auth.resolved`.

`ClientCommand` (clients → gateway): `route`, `invoke`, `speak`, `ping`.

## HTTP endpoints (same port as WS, `:7777`)

| Method · path | Purpose |
|---|---|
| `GET /health` | liveness + connected client count |
| `GET /skills` | command-deck cards |
| `GET /config` | sanitized config + provider readiness + secret *presence* |
| `GET /vault/recent` | recent vault records (the feed) |
| `GET /vault/doc?path=` | one record's body + `obsidianUri` |
| `POST /settings` | persist editable (non-secret) keys → apply live |
| `POST /secrets` | persist secret keys (keychain) → apply live |

## Ports

| Service | Default | Override |
|---|---|---|
| Gateway (HTTP + WS) | 7777 | `AGENTIC_OS_GATEWAY_PORT` |
| Voice sidecar | 7788 | `AGENTIC_OS_VOICE_PORT` |
| HUD dev server (Vite) | 5173 | Vite config |
