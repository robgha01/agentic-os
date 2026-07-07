# Skills

A **skill** is a unit of work the OS can run: deep research, inbox triage, the
ship-ticket pipeline, and the internal sub-skills they compose from. Each ships a
declarative manifest validated at load time (`packages/shared/src/skill.ts`).

## Manifest

`skills/<id>/skill.manifest.json`:

```jsonc
{
  "id": "last-30-days",
  "name": "Last 30 Days Deep Research",
  "description": "…",
  "triggers": ["last-30-days"],          // action ids that dispatch to this skill
  "surfaces": ["deck", "nl"],            // where users can invoke it (see below)
  "presentation": {                       // required when "deck" is a surface
    "label": "Deep Research",
    "icon": "telescope",
    "group": "Knowledge",
    "inputs": [
      { "name": "topic", "type": "string", "label": "Topic", "required": true },
      { "name": "force", "type": "boolean", "label": "Force refresh", "default": false }
    ]
  },
  "modelPolicy": { "execTier": "heavy", "privacy": "cloud-ok" },
  "execution": { "kind": "composite", "steps": ["fetch-hackernews", "fetch-reddit", "fetch-polymarket", "fetch-web", "fetch-youtube", "fetch-x", "synthesize-research", "compile-research"] },
  "vaultOutput": "10-research/{{topic}}.md",
  "staleAfterMinutes": 1440,
  "produces": { "type": "research", "keyParam": "topic" }
}
```

### `surfaces` — how a skill is reached

- `"deck"` — a button in the HUD command deck (requires `presentation`).
- `"nl"` — reachable by typed/spoken natural language (router).
- `[]` — **internal sub-skill**: only other skills invoke it (e.g.
  `fetch-hackernews`, `synthesize-research`).

### `modelPolicy` — which brain runs it

`execTier` (`none` = deterministic, no LLM · `light` · `heavy`), `privacy`
(`local-only` forces a local provider), optional `maxLatencyMs`/`maxCostUsd`, and
optional `pin` (hard provider override). The selector turns this into a concrete
`{provider, model}` — see [configuration.md](configuration.md#models--providers).
This never affects the router brain.

### `execution` — how it runs

| kind | Runs |
|---|---|
| `claude-headless` | a hidden `claude -p` session (`promptTemplate`, `{{param}}` filled from intent) |
| `process` | an arbitrary local command (`command` + `args`) |
| `native` | an in-gateway TS handler resolved by `handler` id |
| `composite` | an ordered list of sub-skill `steps` sharing one context bag |

### `produces` — freshness guard

Declares the vault record this skill writes (`type` + `keyParam` *or* `keyDate`).
The dispatcher checks freshness first: if a non-stale record exists, it serves it
instantly (notification + `result`) instead of re-running. A `force: true` param
(the deck "Force refresh" toggle) bypasses it.

## Native handlers

`execution.kind: "native"` resolves to a function in
`services/gateway/src/skills/native-registry.ts`. Each receives:

```ts
{ intent, params, context, services, emit }
```

- `context` — a mutable bag shared across composite steps (how the research
  pipeline passes items → synthesis → compile).
- `services` — injected `{ vault, nowIso, mail?, llm? }`. The `llm` is the one
  resolved from this op's `ModelSelection`. `vault.toRelative()` gives a HUD path.
- `emit(chunk)` — stream output to the op's event feed.

Return `0` for success (exit-code semantics). To record a produced doc for the
HUD card + freshness, set `context.result = { path, title, type }`.

Handlers build records with `buildResultDocument` (which enforces the per-type
contract — see [vault.md](vault.md)) and write via `vault.writeGenerated`.

## Bundled skills

| Skill | Surface | Execution |
|---|---|---|
| `last-30-days` (Deep Research) | deck, nl | composite: 6 fetchers (HN, Reddit, Polymarket, Web, YouTube, X) → synthesize → compile |
| `ai-wire` | deck, nl | native — themed AI-industry intel brief (`intel` record) |
| `morning-report` (trigger `rundown`) | deck, nl | native — daily brief from vault + calendar (`report` record) |
| `schedule` | deck, nl | native — today's Outlook agenda (`schedule` record) |
| `inbox-triage` | deck, nl | native (Outlook/Graph via device-code) |
| `ship-ticket` | deck, nl | claude-headless — the preserved Shape A ticket flow |
| `fetch-hackernews` / `fetch-reddit` / `fetch-polymarket` / `fetch-web` / `fetch-youtube` / `fetch-x` | `[]` | internal sub-skills (research sources) |
| `synthesize-research` / `compile-research` | `[]` | internal sub-skills (grounded synthesis → vault record) |

## Adding a skill

1. Create `skills/<id>/skill.manifest.json`.
2. For `native`, add the handler to `native-registry.ts`.
3. If it writes a vault record, set `produces` (freshness) and have the handler
   record `context.result`.
4. Reload the gateway; `GET /skills` and the command deck pick it up.
