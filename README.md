# Agentic OS

A local-first, voice-capable **developer mission-control** — a sci-fi HUD over a
TypeScript orchestrator that routes your intent to skills, runs them on the model
of your choice (cloud or local), and writes every result to an Obsidian vault as
the durable source of truth. Inspired by the "Jarvis" pattern: talk (or type) to
it, it does the work in the background, and tells you what it found.

> **Status:** active development. The gateway, routing/model layer, skills,
> memory vault, and HUD are working end-to-end. The Python voice sidecar is a
> scaffold (text mode is the default and works everywhere).

---

## What it does

- **Two-path routing** — a deterministic regex table for known commands (instant,
  no LLM), falling back to a **semantic brain** (Haiku by default) for free-form
  intent. The brain is fast/cheap and orchestrates routing *only*.
- **Pluggable models, per skill** — each skill declares a `modelPolicy`; the
  selector picks a provider (Anthropic via API **or** headless `claude -p`,
  **Ollama**, or any **OpenAI-compatible** endpoint) by tier, privacy, budget,
  reachability, and a configurable fallback order. Headless Claude needs no API
  key, so it runs out of the box.
- **Skills** — declarative manifests (deep research, inbox triage, ship-ticket…)
  that run as native TS handlers, headless `claude -p` sessions, local processes,
  or composites. Results are written to the vault.
- **Obsidian vault memory** — every result is a clean, human-first markdown record
  with provenance frontmatter, a spoken-core TL;DR, cited sources, and graph
  backlinks. A freshness guard serves fresh records instantly instead of re-running.
- **The HUD (V.A.U.L.T.)** — an animated particle core, drag-arrangeable widget
  panels, a command deck built from your skills, task-completion notification
  cards orbiting the core, a markdown result viewer with "Open in Obsidian", an
  Audio I/O widget, and a live Options panel.
- **Voice (opt-in)** — text by default; flip to voice and the OS reads finished
  tasks aloud (spoken core). Local (faster-whisper/Kokoro) or cloud engines.

See [`docs/`](docs/) for the full architecture and contracts.

---

## Quickstart

Requires **Node 20+** and **Claude Code** logged in (for the zero-config headless
brain). `npm install` at the repo root wires the workspaces.

```bash
npm install

# Terminal 1 — the gateway (routing, skills, memory, HUD feed) on :7777
npm run start

# Terminal 2 — the HUD dev server on :5173
npm run hud
```

Open <http://localhost:5173>. Type a command (e.g. *"last 30 days on rust"*) or
click a card in the command deck. Results stream into the V.A.U.L.T. feed and open
in the viewer; the file also lands in `vault/`.

No API key needed: the default transport is **headless** (`claude -p`, your local
Claude Code login). Add keys/providers later in the **Options** panel.

---

## Repository layout

```
apps/hud/            Vite + React + TS — the V.A.U.L.T. HUD (WebSocket client)
services/gateway/    Node/TS orchestrator: routing · models · skills · memory · WS server
services/voice/      Python voice sidecar (faster-whisper + Kokoro) — scaffold
packages/shared/     Shared contracts (events, skill manifest, model policy, vault schema)
config/              Config (file → env override) + secret store (OS keychain / encrypted)
skills/              Declarative skill manifests (+ ship-ticket = the old Shape A flow)
vault/               Obsidian vault — generated records are git-ignored
docs/                Architecture & contract docs
```

It's an npm-workspaces monorepo (`@aos/*`). TypeScript strict, ESM.

---

## Common commands

| Command | What |
|---|---|
| `npm run start` | Run the gateway (`:7777`) |
| `npm run hud` | Run the HUD dev server (`:5173`) |
| `npm run typecheck` | Typecheck the gateway |
| `npm run route-demo` | Routing engine smoke (regex + semantic) |
| `npm run research-demo` | Deep-research pipeline smoke |
| `npm run vault-demo` | Vault contract / freshness smoke |

(See `package.json` for the full demo set: `runtime-`, `deck-`, `voice-`,
`mail-`, `mail-auth-`, `config-demo`.)

---

## Documentation

- [Architecture](docs/architecture.md) — components, data flow, the event bus
- [Configuration & secrets](docs/configuration.md) — precedence, keychain, providers
- [Model & provider layer](docs/configuration.md#models--providers) — brain vs skill execution, fallback
- [Skills](docs/skills.md) — manifest schema, surfaces, model policy, native handlers
- [Vault & memory](docs/vault.md) — the document contract, freshness, spoken core
- [Voice & HUD](docs/voice-and-hud.md) — modes, Audio I/O, widgets, cards
