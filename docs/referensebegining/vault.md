# Vault & Memory

The Obsidian vault (`vault/`) is the **source of truth for what each AI task
produced**. Every record is written to read well for a human *or* an LLM with no
outside context. Contract in `packages/shared/src/vault.ts`; assembly +
enforcement in `services/gateway/src/memory/`.

## Document shape

```markdown
---                         ← YAML frontmatter = Obsidian "Properties" (hidden from the body)
type: research
title: rust async — last 30 days
id: rust async
created: 2026-06-22T17:00:02Z
updated: 2026-06-22T18:31:16Z
source: last-30-days        ← producing skill/action
status: complete
confidence: medium
staleAfterMinutes: 1440     ← TTL; powers the freshness guard
tags: [topic/rust-async]
inputs: ["topic: rust async"]   ← flat list (renders cleanly in Properties)
model: claude-opus-4-8 (headless)   ← provenance: which brain produced it
links: ["2026-06-22"]
---
# rust async — last 30 days

> **TL;DR** — …            ← the "spoken core": one standalone paragraph

## Analysis                 ← required/extra sections per type
…
## Sources                  ← cited
- [title](url)
## Related                  ← in-body [[wikilinks]] so Obsidian's graph connects
[[2026-06-22]]
```

No provenance footer, no marker comments in the default (clean) mode — the body
stays human-first; provenance lives in frontmatter only.

## Per-type contract (`DOCUMENT_CONTRACTS`)

| type | folder | requires |
|---|---|---|
| research | `10-research` | TL;DR · Key findings · Sources |
| knowledge | `20-knowledge` | TL;DR · Summary |
| ticket | `30-tickets` | TL;DR · Summary · Outcome |
| telemetry | `40-telemetry` | Metrics |
| daily | `01-daily` | Operations |
| inbox | `02-inbox` | TL;DR · Action items |

`buildResultDocument()` validates the contract and **throws** on a malformed
record, so nothing half-formed reaches the vault.

## Spoken core

The leading `> **TL;DR**` blockquote is the canonical text the voice layer reads
aloud. `extractSpokenCore()` strips the label/markdown; the `speak` command and
the voice-mode auto-announce use it (see [voice-and-hud.md](voice-and-hud.md)).

## Freshness (check-exists-or-execute)

`VaultAdapter.needsRefresh(type, key)` + per-record `staleAfterMinutes` decide
whether a record is fresh. Skills declare `produces`, and the dispatcher serves a
fresh record instantly instead of re-running (a `force` param overrides). This is
what makes repeat requests near-instant.

## Managed blocks (optional)

With `vault.managedBlocks = true`, the OS writes only between
`<!-- aos:begin generated -->` / `<!-- aos:end generated -->`, so hand-written
content outside survives regeneration. Default is clean mode (full overwrite,
preserving `created`).

## Recorder & feed

`VaultRecorder` subscribes to the event bus and appends one line per
completed/failed op to today's daily-note Operations log — the data behind the
HUD's **V.A.U.L.T. feed**. `GET /vault/recent` lists recent records;
`GET /vault/doc?path=` returns a record's body plus an `obsidian://` deep link.

## Git

Generated records are user data and are **git-ignored**. Only seeds are tracked:
`_meta/`, `_templates/`, `90-maps/`.
