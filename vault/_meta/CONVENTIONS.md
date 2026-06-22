# Vault conventions

This vault is the **source of truth** for what the Agentic OS and its AI tasks
produce. Every file must read well for **both a human and an LLM** with no
outside context. These conventions are enforced by the gateway's vault adapter
(`services/gateway/src/memory/`) and the shared contract
(`packages/shared/src/vault.ts`).

## Folder taxonomy (Johnny-Decimal)

| Folder | Holds |
|---|---|
| `00-inbox/` | Unsorted captures awaiting filing. |
| `01-daily/` | One note per day (`YYYY-MM-DD.md`): the **Operations** log + brief/schedule. |
| `02-inbox/` | Inbox-triage records (`YYYY-MM-DD.md`): unread counts + action items. |
| `10-research/` | Deep-research / Last-30-Days briefs, one file per topic. |
| `20-knowledge/` | Durable, curated wisdom & findings — the long-term wiki. |
| `30-tickets/` | Ship-ticket records. |
| `40-telemetry/` | Metric snapshots. |
| `90-maps/` | Maps of Content (index notes) for navigation. |
| `_templates/` | Per-type note templates. |
| `_meta/` | This file + the schema reference. |

## Every record has provenance frontmatter

```yaml
---
type: research            # research | knowledge | ticket | telemetry | daily
title: "Rust async — last 30 days"
id: rust-async            # stable key (slugged for the filename)
created: 2026-06-22T10:00:00Z
updated: 2026-06-22T10:00:00Z
source: last-30-days      # the skill/action/agent that produced it
status: complete          # complete | partial | failed
confidence: high          # high | medium | low (optional)
staleAfterMinutes: 1440   # TTL for the check-exists-or-execute loop (optional)
tags: [topic/rust, async]
inputs: { topic: "rust async" }
model: claude-opus-4-8
links: ["[[20-knowledge/rust]]"]
---
```

## Body shape (self-contained)

1. `# Title`
2. `> **TL;DR** — …` — a standalone paragraph; reading only this is enough to
   trust and use the result. Required for `research`, `knowledge`, `ticket`.
3. The type's **required sections** (see SCHEMA.md), in order.
4. `## Sources` — cited links, when applicable.
5. A provenance footer mirroring the frontmatter.

## Humans and the OS share files safely

The OS only writes between these markers:

```
<!-- aos:begin generated -->
…OS-authored, regenerated on each run…
<!-- aos:end generated -->
```

Anything you write **outside** the markers is yours and survives regeneration.
Promote durable insights from `10-research/` into `20-knowledge/` by hand (or
let a future skill propose it); link liberally with `[[wikilinks]]`.

## Freshness

`staleAfterMinutes` drives self-refresh: when a task is requested and the record
is missing or older than its TTL, the OS regenerates it; otherwise it serves the
cached record. Omit the field for records that never auto-expire (durable
knowledge).
