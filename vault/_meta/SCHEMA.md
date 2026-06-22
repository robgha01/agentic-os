# Vault document schema

Authoritative per-type rules (mirrors `DOCUMENT_CONTRACTS` in
`packages/shared/src/vault.ts`). The document builder rejects any record that
violates these.

| Type | Folder | TL;DR required | Required sections |
|---|---|---|---|
| `research` | `10-research/` | yes | Key findings · Sources |
| `knowledge` | `20-knowledge/` | yes | Summary |
| `ticket` | `30-tickets/` | yes | Summary · Outcome |
| `telemetry` | `40-telemetry/` | no | Metrics |
| `daily` | `01-daily/` | no | Operations |
| `inbox` | `02-inbox/` | yes | Action items |

Notes:
- "Required section" means a `## <Heading>` that is present and non-empty.
- Extra sections are allowed and rendered after the required ones, in the order
  the producing task supplied them.
- `Sources` is auto-rendered from the frontmatter-adjacent source list when the
  task provides cited sources.
