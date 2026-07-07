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
  In front of it sits **`dispatch/scheduler.ts`** — a global FIFO queue with a
  live-editable concurrency limit (`tasks.maxConcurrent`, default 2); queued ops
  emit `operation.queued` before `operation.started`.
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
2. The Scheduler queues the command (emitting `operation.queued` when a
   concurrency slot isn't free), then the Dispatcher resolves the skill, runs
   the freshness guard and the model cascade, emitting `routing.resolved` /
   `operation.started`.
3. SkillRuntime executes — streaming `operation.output`, then
   `operation.completed` (with the produced record as `result`) or
   `operation.failed`.
4. VaultRecorder logs the op to today's daily note; the record is written to the
   vault. The HUD spawns a notification card and refreshes the V.A.U.L.T. feed.

## Event & command contracts (`packages/shared/src/events.ts`)

`OsEvent` (gateway → clients): `routing.resolved`, `operation.queued`, `operation.started`,
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

## Local-only control plane

The gateway is a **localhost single-user** tool by default: requests whose
`Host` header isn't `localhost`/`127.0.0.1`/`[::1]` get a 403 (DNS-rebinding
defense), WS upgrades and `POST /settings`/`/secrets` require a local (or absent)
`Origin` (CSRF defense), and CORS grants are only reflected to local origins.

Set **`security.allowRemoteAccess`** (Options → Network access, or
`AGENTIC_OS_ALLOW_REMOTE=true`) to reach the HUD from another device or the
machine name — this drops the Host/Origin guards, so only enable it on a trusted
LAN. The flag is read live, so toggling it applies without a restart.

## Ports

| Service | Default | Override |
|---|---|---|
| Gateway (HTTP + WS) | 7777 | `AGENTIC_OS_GATEWAY_PORT` |
| Voice sidecar | 7788 | `AGENTIC_OS_VOICE_PORT` |
| HUD dev server (Vite) | 5173 | Vite config |
