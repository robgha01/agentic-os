# Agentic OS — design specification

**Date:** 2026-05-18
**Owner:** Robert Ghafoor
**Status:** Approved for implementation planning
**Source:** Conversation 2026-05-18; supersedes nothing (first version).

---

## 1. Purpose

Build a personal agentic operating system that gives me a centralized, improvable workflow on top of Claude Code. The OS removes four recurring frictions and adds one new capability:

- **Re-explaining context every session** — fixed by a global identity layer, per-client brand/workflow context, and a session-start hook that loads the right slice automatically.
- **Cross-session forgetting** — fixed by a curated `learnings.md` index plus a draft/aos-consolidate/archive loop that compresses raw observations into durable rules without context rot.
- **Outputs scattered + inconsistent** — fixed by deterministic paths under `~/.claude/agentic-os/` (memory, state, task scratch) and explicit conventions enforced by the orchestrator.
- **Skills don't compose** — fixed by an orchestrator that wraps the existing public plugins (`jira-ticket`, `ship-branch`, `claude-mem`) without modifying them.
- **New capability: parallel Jira ticket workflows.** Multiple subagents dispatched on per-ticket git worktrees with isolated dev servers, live human intervention via `AskUserQuestion` / `SendMessage`, and an explicit approval gate before ship.

The OS is also a learning exercise. It should be a clean, idiomatic Claude Code plugin that I can extend later with new agents (time reporting, mail triage, etc.) without restructuring.

## 2. Constraints accepted during design

- **Windows host.** No GSD framework reliance (does not run on Windows for this user).
- **Existing public plugins are sacred.** `jira-ticket`, `ship-branch`, `azure-devops-build`, `itwillsync`, `optimize-skill-description`, `claude-mem`, `superpowers` are not modified. The OS composes around them.
- **Plugin packaging, not symlinks.** Source lives in this repo; install via marketplace; personal data lives in `~/.claude/agentic-os/` outside the plugin cache so plugin updates never overwrite it.
- **Single user, single machine in v1.** Multi-machine sync is an explicit non-goal.
- **Frontend-focused work; backend is shared QA on Azure.** Backend-mutating work is serialized through a lock; frontend work runs freely in parallel.
- **No new memory framework.** Markdown for global/client/task tiers, `claude-mem` retained for per-project semantic observations. Obsidian is not in v1.
- **No web UI in v1.** All orchestration via Claude Code slash commands. State is JSON-shaped so a read-only web mirror can be added later as a phase 2.

## 3. Architecture

The OS is a Claude Code plugin distributed via the existing `robert-personal` marketplace as an external source. Plugin code lives in this repo; mutable personal data and runtime state live under `~/.claude/agentic-os/`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PLUGIN — code, versioned, publishable                                       │
│ C:\Workspace\agentic-os\                                                    │
│   plugin\                                                                   │
│     plugin.json            manifest                                         │
│     skills\                slash commands (see §5.1)                        │
│     hooks\                 session-start.ps1                                │
│     templates\             default identity.md, _client_template,           │
│                            learnings.md scaffold, config.json default       │
│   docs\                    this spec + future design docs                   │
│   README.md, LICENSE                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                          first run scaffolds:
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ PERSONAL DATA — private, mutable, survives plugin updates                   │
│ ~/.claude/agentic-os/                                                       │
│   identity.md              T1 always-loaded                                 │
│   learnings.md             T1 curated index (cap ~150 lines)                │
│   learnings.draft.md       raw captures (fuel for /aos-consolidate)             │
│   learnings/<topic>.md     T1 deep, on-demand                               │
│   archive/                 superseded learnings                             │
│   clients/<client>/        T2 per-client (brand, workflows, repos)          │
│   tasks/<ticket>/          T4 per-ticket scratch                            │
│   tasks/_archive/<ticket>/ completed-ticket history                         │
│   state/                   runtime JSON (ports, queue, in-flight, locks)    │
│   config.json              user-tunable settings                            │
└─────────────────────────────────────────────────────────────────────────────┘

Tier 3 (project memory) uses Claude Code's existing mechanisms unchanged:
  <repo>/CLAUDE.md  +  ~/.claude/projects/<projname>/MEMORY.md  +  claude-mem
```

### 3.1 Distribution

The OS is published as one plugin entry in `claude-plugins\.claude-plugin\marketplace.json` with an external `source`. Exact form to be verified during smoke test (see §10):

```json
{
  "name": "agentic-os",
  "description": "Personal agentic workflow OS — orchestrator, memory, learning loop.",
  "category": "productivity",
  "source": { "source": "github", "repo": "robgha01/agentic-os" }
}
```

If external `source` is unsupported on the user's Claude Code version, fallback is a new dedicated marketplace registered in `~/.claude/settings.json`, pointing at the agentic-os repo. The repo split (agentic-os in its own repo) is preserved in both paths.

### 3.2 Composition with existing plugins

- `jira-ticket` — invoked unchanged from inside subagents for ticket workflows. The OS calls it; never wraps or forks.
- `ship-branch` — invoked by subagents during the SHIPPED phase per the client's configured ship strategy.
- `claude-mem` — continues to capture per-project observations on its own. The OS reads observations indirectly through Claude's existing surface, never directly.
- `superpowers` — used at design time (brainstorming, writing-plans, executing-plans). Not invoked at runtime by the OS.

## 4. Memory model

Four tiers plus a separate runtime-state surface. Memory and state are distinct paths; they do not mix.

### 4.1 Tier 1 — Global, always-loaded

Read on every session start by the session-start hook (or by `/aos-load-context` if the hook hasn't fired). Capped to keep parent context lean.

| File | Purpose | Cap |
|---|---|---|
| `identity.md` | Who you are, working style, voice | ~few dozen lines |
| `learnings.md` | Curated cross-project rules; index of `[[wikilinks]]` to deep content | ~150 lines (enforced by `/aos-consolidate`) |

### 4.2 Tier 1 deep + draft (on-demand or raw)

| File | Purpose |
|---|---|
| `learnings/<topic>.md` | Deep content for a curated rule; loaded only when referenced |
| `learnings.draft.md` | Raw, append-only captures; fuel for `/aos-consolidate` |
| `archive/<date>-<topic>.md` | Superseded curated rules; searchable, never auto-loaded |

### 4.3 Tier 2 — Client, loaded when cwd matches

| File | Purpose |
|---|---|
| `clients/<client>/brand.md` | Voice, positioning, tone, banned words |
| `clients/<client>/workflows.md` | Branch naming, ship strategy, review etiquette |
| `clients/<client>/repos.md` | Workspace path → client/project mapping (the lookup that drives Flow B) |

The session-start hook reads each `clients/*/repos.md`, matches `cwd` against the listed paths, and loads the matched client's `brand.md` and `workflows.md` into context. No-match keeps Tier 2 unloaded.

### 4.4 Tier 3 — Project, unchanged Claude Code mechanism

| File | Purpose |
|---|---|
| `<repo>/CLAUDE.md` | Project-specific overrides (existing CC pattern) |
| `~/.claude/projects/<projname>/MEMORY.md` | Curated project memory (existing CC auto-memory) |
| claude-mem observations DB | Auto-captured semantic observations per project |

The agentic OS does not own these. They continue to work as today.

### 4.5 Tier 4 — Task-ephemeral, per subagent

| File | Owner | Purpose |
|---|---|---|
| `tasks/<ticket>/mission.md` | Parent writes initially; appends on `/aos-resume` and on rejection feedback | Pointers + constraints (NOT inlined content) |
| `tasks/<ticket>/notes.md` | Subagent writes | Running narrative |
| `tasks/<ticket>/activity.log` | Subagent appends per action | One line per significant action; for cheap monitoring |
| `tasks/<ticket>/report.md` | Subagent writes on SUBMITTED | Structured verification + outcome |
| `tasks/<ticket>/help-request.md` | Subagent writes if stuck and `AskUserQuestion` fails | Structured human question |
| `tasks/<ticket>/approval.json` | Parent writes after human decision | Approval verdict + feedback |

On `SHIPPED` and successful close, the parent moves `tasks/<ticket>/` to `tasks/_archive/<ticket>/`.

### 4.6 Runtime state — separate from memory

All JSON, all under `state/`. Machine-global, mutated under file lock.

```
state/ports.json       port ownership across the machine
state/queue.json       all queued tickets across all repos (FIFO with priority)
state/in-flight.json   running subagents + recent completions (rolling, last 50)
state/locks.json       coarse resource locks (qa_backend, etc.)
```

State is read by every orchestrator command and every subagent. Subagents are forbidden from writing state directly — only the parent mutates it.

## 5. Orchestration

### 5.1 Skill catalog

All slash commands ship as skills under `plugin/skills/`. The orchestrator skills live at the agentic-os terminal; the small ones work from any repo.

| Command | Surface | Purpose |
|---|---|---|
| `/aos-install` | any | First-run: scaffold `~/.claude/agentic-os/` from templates, pre-grant Write permission |
| `/aos-identity` | any | Mode auto-detected. **Build mode** (no identity.md present): runs the 15-question interview (see Appendix D), writes `identity.md`. **Refine mode** (identity.md present): reads current file + claude-mem observations + recent learnings, forms gap hypotheses, asks 5–8 targeted questions, proposes a diff for approval. Runs in a subagent. |
| `/aos-load-context` | any | Read identity, learnings, and (if cwd matches) client brand + workflows into current conversation |
| `/aos-tickets` | agentic-os | List Jira tickets assigned to user, grouped by project, with in-flight markers; then present the list via `AskUserQuestion` so each ticket is a clickable option to start or queue (no typing IDs). Re-run for a fresh snapshot — live updates are the phase-2 web UI's job. |
| `/aos-queue COMP-123` | any | Validate ticket exists, append to `state/queue.json` |
| `/aos-start-ticket COMP-123` | agentic-os | Full dispatch (see §5.3) |
| `/aos-status` | any | Show in-flight workers + recent completions + queue |
| `/aos-intervene COMP-123 <message>` | agentic-os | `SendMessage` to a running subagent with new guidance |
| `/aos-park COMP-123` | agentic-os | Gracefully exit a SUBMITTED subagent; retain worktree for later resume |
| `/aos-resume COMP-123` | agentic-os | Re-spawn a subagent against a previously-parked worktree |
| `/aos-abort COMP-123` | agentic-os | Kill a running subagent; mark as failed; release resources |
| `/aos-consolidate` | agentic-os | Subagent walks draft + curated + deep, promotes/archives, returns short summary |
| `/aos-review-stale-learnings` | agentic-os | Subagent surfaces curated rules with `last_validated > stale_threshold` |

`/aos-tickets`, `/aos-queue`, and `/aos-status` use the Atlassian MCP server directly (the same one `jira-ticket` uses internally). They do not invoke the `jira-ticket` plugin as a tool. Subagents dispatched by `/aos-start-ticket` may invoke `jira-ticket` for the full ticket workflow.

### 5.2 Parent-thin / subagent-heavy principle

The parent never reads anything large or repeated per-dispatch (identity, brand, ticket bodies, code). It does:

- Slash-command parsing
- Small JSON reads/writes (state files)
- Port allocation, worktree creation
- Subagent dispatch with a tiny mission
- Short report reads on return
- SendMessage routing

The subagent does:

- `/aos-load-context` on first turn (or auto via session-start hook)
- Atlassian MCP fetch of full ticket body
- All implementation work
- Test execution
- Report writing

This keeps parent context budget low across many dispatches in one session.

### 5.3 `/aos-start-ticket COMP-123` dispatch flow

```
[1] LOOKUP    Parent reads clients/*/repos.md; matches COMP-123's project prefix to a repo path.
              No ticket body fetched — that's the subagent's job.

[2] CONCURRENCY CHECK
              If in_flight.length >= config.concurrency.max_concurrent_tickets:
                Enqueue with priority preserved. Print "queued, will dispatch when slot frees."
                Stop.

[3] LOCK PORT Open state/ports.json under file lock.
              Find first free port in config.concurrency.port_range.
              Claim it: { owner: "ticket-COMP-123", since: now }.
              Release lock.

[4] WORKTREE  git worktree add C:\Workspace\<repo>\.worktrees\COMP-123
              Branch name: if jira-ticket exposes a callable branch-name helper, use it;
              otherwise default to feature/<TICKET-ID>-<slug-of-title>.

[5] MISSION   Write ~/.claude/agentic-os/tasks/COMP-123/mission.md (tiny, ~30 lines, see Appendix A).

[6] RECORD    Append to state/in-flight.json with agent_id placeholder.

[7] DISPATCH  Agent({
                isolation: "worktree",
                working_directory: <worktree>,
                run_in_background: true,
                prompt: "Read ~/.claude/agentic-os/tasks/COMP-123/mission.md and execute it.
                         Begin with /aos-load-context. End by writing report.md and entering SUBMITTED."
              })
              Capture agent_id; update in-flight.json.

[8] (parent yields; can dispatch more or do other work)

[9] SUBMITTED Subagent finishes implementation, writes report.md, enters wait state.
              Dev server still running on assigned port.
              Notification fires to parent.

[10] TRUST CHECK
              Parent runs a shell command in the worktree:
                cd <worktree> && pnpm lint && pnpm test --filter <changed-files>
              Result recorded in state/in-flight.json.
              No subagent spawn; sub-second to a few minutes depending on suite.

[11] PRESENT  Parent surfaces to /aos-status (and phase-2 web UI later):
              "COMP-123 ready for review at http://localhost:<port>"

[12] APPROVE  Human reviews at localhost:<port>, reads notes/report.
              Either:
                approve  → parent SendMessages subagent "approved" → subagent ships, dev server stops.
                reject   → parent SendMessages subagent "rejected with: <feedback>" → REVISING, back to RUNNING.

[13] SHIPPED  Subagent runs ship steps (push, optional PR creation per config).
              Exits. Port released. Worktree retained or removed per ship strategy.

[14] CLEANUP  Parent moves tasks/COMP-123/ to tasks/_archive/COMP-123/.
              If queue has items and slot is free, dequeue and dispatch next.
```

### 5.4 Mission file (`mission.md`) template

See **Appendix A**.

### 5.5 Report file (`report.md`) contract

See **Appendix B**.

## 6. Error handling and intervention

### 6.1 Three failure classes

| Class | Examples | Strategy |
|---|---|---|
| Mechanical | Port range exhausted, worktree creation fails, ticket not found, branch exists | Parent catches and surfaces a clear error; no subagent dispatched; state unchanged |
| Subagent failure | Tests fail and subagent gives up; build broken | Subagent writes `report.md` with `status: failed`; parent releases port; marks in-flight as `failed`; surfaces report |
| Subagent stuck / human needed | Ambiguous spec, missing credentials, design decision | See §6.2 below |

### 6.2 Intervention model (three levels, ordered by interactivity)

**Level 1 — `AskUserQuestion` from the subagent.** Cleanest UX. Subagent has the tool in its allowlist. When stuck, calls `AskUserQuestion` with 2–4 concrete options. Question routes to the user's Claude Code UI. User answers. Response flows back to subagent. No kill, no resume. Same mechanism `jira-ticket` already uses for ticket clarifications. Inherited transparently when invoked from subagent.

**Level 2 — `SendMessage` from the parent to a running subagent.** Parent uses `SendMessage` against the subagent's agent_id (captured at dispatch time) to inject new guidance. Subagent receives on next turn and incorporates. Triggered by `/aos-intervene COMP-123 <message>`.

**Level 3 — Help-request file + kill/aos-resume (fallback).** If Levels 1 and 2 fail (e.g., subagent has gone into a tool-use loop and isn't responsive), subagent eventually writes `help-request.md` and exits `needs_help`. Parent surfaces; user provides input via `/aos-resume COMP-123 <answer>`; parent appends to mission.md and re-dispatches against the existing worktree.

### 6.3 Watchdog

- Inactivity timeout: if no writes to `activity.log` for `config.intervention.watchdog_inactivity_minutes` (default 15), parent assumes stuck. Kills via TaskStop; marks `needs_help`.
- Total runtime cap: `config.intervention.subagent_total_runtime_max_minutes` (default 60). Same behavior.

Watchdog is implemented as occasional small polls of the activity log: parent checks file modtime only, reads contents only if modtime is suspiciously stale. Cost is negligible compared to dispatch and does not violate the parent-thin principle.

### 6.4 Retries

- Mechanical errors: no retry. Deterministic; user must adjust input.
- Subagent test/lint failures: subagent has its own internal retry budget per its mission. Parent does not retry these at the orchestrator level.
- Agent tool infrastructure errors: parent retries dispatch once. Retry semantics: remove the failed worktree (`git worktree remove --force`), release the port back to `state/ports.json`, then re-run the full dispatch flow from §5.3 step 3. If second attempt fails, surface to user with both error messages.

## 7. Subagent lifecycle and testing

### 7.1 Lifecycle states

```
DISPATCHED → RUNNING → SUBMITTED → APPROVED → SHIPPED → TERMINATED
                          │            │
                          │            └── (or rejected) → REVISING → RUNNING
                          │
                          └── failed | needs_help | timeout exits
```

- **RUNNING**: subagent implementing the work. Dev server may or may not be up depending on progress.
- **SUBMITTED**: report.md written. Dev server still running on assigned port. Subagent in wait state (no token consumption beyond keep-alive). Worktree intact.
- **APPROVED**: parent SendMessaged "approved". Subagent transitions to SHIPPED.
- **SHIPPED**: subagent runs ship steps (push branch, optionally create PR), then exits. Dev server stops, port released.
- **REVISING**: parent SendMessaged "rejected with: <feedback>". Subagent reads feedback, loops back to RUNNING.
- **TERMINATED**: dev server stopped, port released, worktree retained or removed per ship strategy.

### 7.2 Why subagents live through approval

- Dev server stays up at `localhost:<port>` — human can preview live work without re-launching anything.
- Trust-check runs in the same worktree without needing a fresh clone.
- Revision is cheap: same agent_id, same context, same worktree — no respawn cost.

### 7.3 Park timeout

If a SUBMITTED subagent receives no decision after `config.concurrency.park_timeout_hours` (default 4):

- Parent uses `SendMessage` to send `"park"` to the subagent's `agent_id`
- Subagent gracefully exits: stops dev server, releases port, terminates
- Worktree retained, notes.md/report.md preserved
- State recorded as `status: parked`
- `/aos-resume COMP-123` later re-spawns a subagent against the existing worktree to either revise or ship

### 7.4 Test layers

| Layer | Owner | Mechanism | Purpose |
|---|---|---|---|
| 1 — Lint + typecheck | Subagent | Repo's commands in worktree | Gate before claiming SUBMITTED |
| 2 — Unit tests | Subagent | Repo's commands in worktree | Gate before SUBMITTED |
| 3 — Component tests | Subagent | Repo's commands in worktree | Gate before SUBMITTED |
| 4 — Headless browser | Subagent | `mcp__chrome-devtools__*` preferred, `mcp__claude-in-chrome__*` fallback, against `localhost:<assigned-port>` | Gate before SUBMITTED |
| 5 — Trust-check | Parent | Shell command in worktree: lint + test on changed files | Defends against an LLM falsely claiming green; sub-minute |
| 6 — Visual e2e | Human | Open `localhost:<port>` in browser; review the UX | Pre-approval gate |
| 7 — PR review | Human | Read the diff | Pre-merge gate |

### 7.5 Backend lock

Some tickets mutate the shared Azure QA backend (schema changes, integration tests that write). The lock prevents two subagents from corrupting each other's QA state.

```json
state/locks.json
{
  "qa_backend": { "owner": "ticket-COMP-131", "since": "...", "reason": "migration test" }
}
```

When a subagent's mission includes backend mutation, it acquires the `qa_backend` lock at the relevant step. If held by another subagent, the subagent either waits (if mission allows) or exits with `status: blocked_on_lock`. Default: exit and surface; user decides whether to queue or cancel.

Frontend-only work does not acquire the lock and runs freely in parallel up to the concurrency cap.

### 7.6 Browser tool preference

Subagents inherit the user's global rule from `~/.claude/CLAUDE.md` via `/aos-load-context`:

1. Prefer `mcp__chrome-devtools__*` (real CDP emulation; required for media queries).
2. Fall back to `mcp__claude-in-chrome__*` if unavailable.
3. If neither, note explicitly in `report.md` verification block.

## 8. Configuration

Single file at `~/.claude/agentic-os/config.json`, scaffolded by `/aos-install` from a template, never overwritten by plugin updates.

```json
{
  "concurrency": {
    "max_concurrent_tickets": 3,
    "port_range": [3001, 3099],
    "park_timeout_hours": 4
  },
  "memory": {
    "learnings_md_max_lines": 150,
    "promotion_threshold": 3,
    "stale_review_days": 90
  },
  "intervention": {
    "watchdog_inactivity_minutes": 15,
    "subagent_total_runtime_max_minutes": 60
  },
  "ship": {
    "auto_run_consolidate_on_completion": false,
    "create_pr_after_approval": false
  },
  "experimental": {
    "phase_2_web_ui": false,
    "itwillsync_notify_on_help": false
  }
}
```

When `/aos-start-ticket` is invoked and `in_flight.length >= max_concurrent_tickets`:
- Don't dispatch
- Auto-enqueue with priority preserved
- Print confirmation, stop

When a subagent reaches TERMINATED, parent dequeues the highest-priority queued ticket and dispatches it. Self-balancing.

## 9. Self-improvement loop

### 9.1 Three-layer learning hierarchy

```
ALWAYS-LOADED (every session)
  identity.md, learnings.md (curated index, capped)
        ▲
        │  /aos-consolidate promotes drafts (3+ occurrences across projects)
        │
ON-DEMAND (loaded when referenced via [[wikilinks]])
  learnings/<topic>.md, clients/<x>/*.md, project memory
        ▲
        │  promotion when pattern observed 3+ times
        │
RAW (append-only, never auto-loaded)
  learnings.draft.md, claude-mem observations, task scratch
```

### 9.2 `/aos-consolidate` workflow

Runs in a subagent so the parent never sees the full draft + curated content.

```
INPUT
  learnings.draft.md   (raw, append-only)
  learnings.md         (curated index)
  learnings/<topic>.md (deep content)

DECISIONS
  1. Drafts with 3+ occurrences across projects/sessions → promote to learnings.md + learnings/<topic>.md
  2. Drafts that are project-specific → move to that project's CLAUDE.md or auto-memory
  3. Drafts that contradict existing rules → surface conflict via AskUserQuestion
  4. Curated rules > stale_review_days old → archive candidate
  5. learnings.md > learnings_md_max_lines → merge or demote weakest entries

OUTPUT
  Updated learnings.md (capped, fresh)
  Updated learnings/<topic>.md
  Cleared/rewritten learnings.draft.md
  archive/<date>-<topic>.md for demoted rules
  Short summary report to parent
```

### 9.3 `/aos-review-stale-learnings` workflow

Subagent reads `learnings.md` frontmatter (`last_validated`, `confidence`). For entries beyond `stale_review_days`:

- Use `AskUserQuestion` per entry: "still true? archive? update?"
- Apply user's choice, update or move to archive

Frontmatter convention per curated learning (in `learnings/<topic>.md`):

```yaml
---
name: per-worktree-port
last_validated: 2026-05-18
confidence: high
sources: [COMP-100, COMP-103, HAB-22]
---
```

### 9.4 Three rules that prevent context rot

1. Always-loaded files have hard caps. Enforced by `/aos-consolidate`.
2. Deep content is opt-in. Never preloaded; followed by wikilink reference.
3. Runtime state is not memory. `state/*.json` is mutated by parent only and never read as "knowledge."

## 10. Verification items (smoke tests before implementation)

These exist as design assumptions. Each must be empirically confirmed before relying on it.

| # | Assumption | Test | Fallback if false |
|---|---|---|---|
| V1 | Marketplace `source` field supports `{ "source": "github", "repo": "..." }` for plugins in a different repo | Add a tiny no-op plugin entry pointing at any external repo; verify install works | Use a separate marketplace (Option C from design discussion); preserves repo split |
| V2 | A subagent dispatched via `Agent` tool with `run_in_background: true` produces an agent_id that `SendMessage` can target while the subagent is still running | Spawn a background agent that loops every 30s reading `tasks/<id>/control.json`; SendMessage it; confirm it receives and acts | Demote intervention to Level 3 only (help-request file + kill/aos-resume); document UX impact in v1 |
| V3 | A subagent calling `AskUserQuestion` routes the question to the parent's UI when the parent is in an interactive session | Spawn a background subagent that immediately calls AskUserQuestion; observe parent UI. Also test two concurrent background subagents both calling AskUserQuestion within seconds — confirm whether CC queues them, shows both, or drops one | Subagents emit help-request.md only; no live AskUserQuestion from subagents |
| V4 | Subagents can Read/Write to `~/.claude/agentic-os/` under default Claude Code permissions (or the install step's pre-granted Write rule covers it) | Spawn subagent that writes to `~/.claude/agentic-os/tasks/test/note.md`; confirm | `/aos-install` adds explicit Write/Edit rules to settings.local.json scoped to `~/.claude/agentic-os/**` |
| V5 | Claude Code plugins can ship a SessionStart hook that fires on every session in any directory | Add a session-start.ps1 that writes a timestamp to a known file; reload plugins; open CC in three different directories; verify | Provide `/aos-load-context` as the manual entry point; document the requirement to run it after starting CC in client repos |

V1, V2, V3, V4, V5 are step 0 of implementation per §11.

## 11. Build order (v1 scope)

```
0. SMOKE TESTS — verify V1 through V5 (above). 5-15 minutes each. Spec branch decisions if any fall through.

1. PLUGIN SCAFFOLD
   plugin.json manifest, directory structure, marketplace entry, install on local CC.
   Informational sub-task: check whether CC auto-namespaces plugin commands by plugin name
   (e.g., /agentic-os:tickets). If yes, the manual `/aos-` prefix is redundant but harmless —
   keep it for consistent UX across CC versions. If no, the prefix is load-bearing.
   Acceptance: `/plugin install agentic-os@robert-personal` works; plugin listed in /plugin.

2. /aos-install
   Skill scaffolds ~/.claude/agentic-os/ from plugin/templates/.
   Pre-grants Write/Edit permission for ~/.claude/agentic-os/**.
   Idempotent: never overwrites existing data; emits a clear "already installed" message.
   At the end, prompts user to run /aos-identity to populate identity.md for real.
   Acceptance: fresh machine → run /aos-install → personal data tree exists.

2.5. /aos-identity (build + refine modes)
   Skill runs in subagent. Build mode: 15-question interview per Appendix D, writes identity.md.
   Refine mode: reads existing identity.md + claude-mem observations + recent learnings,
   asks 5-8 targeted gap questions, proposes diff for approval.
   Acceptance: build mode produces a sensible identity.md from 15 answers;
   refine mode picks up at least one stale or missing item from existing identity.md.

3. /aos-load-context + session-start hook
   Hook reads identity + learnings + (if cwd matches) client brand + workflows.
   /aos-load-context is the manual equivalent.
   Acceptance: opening CC in a Comprend repo loads Comprend brand into context.

4. STATE FILES + /aos-tickets + /aos-queue + /aos-status
   Read-only orchestrator surface. No subagent dispatch yet.
   Acceptance: /aos-tickets shows my assigned Jira issues grouped by project.

5. /aos-start-ticket FULL LIFECYCLE
   Dispatch, port lock, worktree, mission, run_in_background Agent, SUBMITTED wait,
   trust-check, approval via SendMessage, ship.
   Acceptance: a real ticket completes end-to-end through approval and merges.

6. /aos-intervene + /aos-park + /aos-resume + /aos-abort
   Lifecycle controls layered on step 5.
   Acceptance: a SUBMITTED ticket can be parked and resumed across CC restarts.

7. /aos-consolidate + /aos-review-stale-learnings
   Self-improvement loop. Both run in subagents.
   Acceptance: after a few mock observations in draft, /aos-consolidate produces a sensible promotion.

8. POLISH
   Real-data scaffolding for Comprend brand + repos.md, sensible defaults in config.json,
   README, error messages, watchdog tuning.
```

After step 5 the OS is functional for daily use; steps 6–8 make it pleasant.

## 12. Out of scope for v1 (designed-for, not built)

- Phase-2 web UI mirror. State JSON is shaped to enable it; build later if desired.
- itwillsync mobile notifications on subagent help requests.
- Time-reporting agent. Plug-in surface ready; skill is later work.
- Mail-triage agent. Same.
- CronCreate-scheduled jobs. CC supports it; we don't build any in v1.
- Multi-client onboarding wizard. `_template/` directory exists; wizard is later UX.
- Multi-machine sync. Single-machine in v1.
- Automatic PR creation. `config.ship.create_pr_after_approval` exists, defaults false.

## 13. Risks and open questions

| Risk | Mitigation |
|---|---|
| Verification items V1–V5 fail | Each has a documented fallback (see §10). None block v1 entirely. |
| Subagent token cost in SUBMITTED state higher than expected | Park timeout (4h default) bounds it. Tunable. Worst case: tighten default to 1h. |
| Approval gate UX feels heavy for trivial tickets | Add a `--auto-approve-on-green` flag to mission template later; off by default in v1. |
| Dev server collision when subagent and human both try to use a port | Port range is 3001-3099; user keeps 3000. Collision shouldn't occur in normal use. |
| State file races between parallel subagents (despite locks) | Subagents are forbidden from writing state; only parent mutates. Reduces race surface to "parent vs parent" which the file lock handles. |

## Appendix A — mission.md template

```markdown
# Mission: <TICKET-ID>

Ticket:    <TICKET-ID>  (fetch full details yourself via Atlassian MCP)
Repo:      <repo-path>
Worktree:  <worktree-path>
Port:      <assigned-port>   (use PORT=<port> for dev server)

Scratch:   ~/.claude/agentic-os/tasks/<TICKET-ID>/
           - write notes.md as you work
           - append one line per significant action to activity.log
           - write report.md when work is done; enter SUBMITTED state
           - DO NOT write to ~/.claude/agentic-os/state/*.json

Setup (in order on first turn):
  1. /aos-load-context        (loads identity + client brand + workflows + learnings)
  2. Fetch <TICKET-ID> via Atlassian MCP for full body + acceptance criteria.
  3. Plan; communicate plan in notes.md before implementing.
  4. Implement.
  5. Run lint, typecheck, unit, component, browser tests (see §7.4 of the spec).
  6. Write report.md per Appendix B contract.
  7. Enter SUBMITTED state: keep dev server running, wait for SendMessage("approved")
     or SendMessage("rejected with: <feedback>").

When you need a human decision:
  - Prefer AskUserQuestion with 2-4 concrete options.
  - Use it for: design decisions, business rules, ambiguous ticket descriptions,
    missing credentials.
  - Do not use it for: technical implementation details you can decide yourself,
    retrying a flaky test.
  - After answer, append the Q&A to notes.md for auditability.

If you receive SendMessage from parent:
  - Treat as authoritative; newer than original mission.
  - Acknowledge in notes.md before changing course.

If all intervention paths fail and you cannot proceed:
  - Write help-request.md (structured: what you tried, the question, plausible answers).
  - Write report.md with status: needs_help. Exit.
```

## Appendix B — report.md contract

```yaml
ticket: <TICKET-ID>
status: submitted | failed | needs_help | shipped
summary: |
  One paragraph of what was done.
files_changed:
  - path: src/components/MobileNav.tsx
    summary: refactor overflow handling
decisions:
  - "Chose flex-wrap over overflow-x because <reason>"
verification:
  lint:       { command: "<cmd>", status: pass | fail, output_excerpt: "..." }
  typecheck:  { command: "<cmd>", status: pass | fail, output_excerpt: "..." }
  unit:       { command: "<cmd>", status: pass | fail, tests_passed: N, tests_failed: M }
  component:  { command: "<cmd>", status: pass | fail }
  browser:    { command: "<cmd>", status: pass | fail, viewports: [375, 768, 1280] }
  manual_steps_remaining: []
  not_run: []   # explicit list of what wasn't run and why
learnings:
  - "When X happens, do Y"  # candidate for learnings.draft.md
next_step: "ready_for_ship" | "needs_review" | "blocked: <reason>"
```

## Appendix C — state file shapes

```json
state/ports.json
{
  "ports": {
    "3017": { "owner": "ticket-COMP-123", "since": "2026-05-18T14:23:00Z" }
  },
  "range": [3001, 3099]
}

state/queue.json
{
  "queue": [
    { "ticket": "COMP-456", "queued_at": "...", "queued_from": "C:\\Workspace\\catella", "priority": "p2" }
  ]
}

state/in-flight.json
{
  "in_flight": [
    {
      "ticket": "COMP-123",
      "agent_id": "<from Agent tool>",
      "port": 3017,
      "worktree": "C:\\Workspace\\catella\\.worktrees\\COMP-123",
      "task_dir": "C:\\Users\\Robert\\.claude\\agentic-os\\tasks\\COMP-123",
      "started_at": "...",
      "status": "running" | "submitted" | "revising" | "approved" | "shipped" | "failed" | "needs_help" | "parked",
      "submitted_at": null
    }
  ],
  "recent": [
    { "ticket": "COMP-100", "status": "shipped", "ended_at": "...", "outcome": "merged" }
  ]
}

state/locks.json
{
  "qa_backend": null
}
```

## Appendix D — /aos-identity 15-question interview contract

The build mode asks exactly these 15 questions in order, using `AskUserQuestion` (with multi-choice options where shown; "Other" available on every question for free text). The subagent synthesizes answers into `identity.md` sections matching the six categories.

| # | Category | Question | Format | Maps to identity.md section |
|---|---|---|---|---|
| 1 | Role & context | What's your role / primary work? | Multi-choice + Other (web dev for clients / product engineering / SRE / both / Other) | `## Role` |
| 2 | Role & context | Are you primarily building, debugging, reviewing, or some mix? | Multi-choice | `## Role` |
| 3 | Communication | Response length preference? | Multi-choice (terse / balanced / detailed) | `## Communication` |
| 4 | Communication | Should Claude explain what it's about to do, or just do it? | Multi-choice (explain first / just do / case-by-case) | `## Communication` |
| 5 | Communication | Do you want summaries at end of work, or skip them since you can read the diff? | Multi-choice (always / only when substantive / never) | `## Communication` |
| 6 | Code standards | Comment policy? | Multi-choice (none unless non-obvious / explain intent / heavy docs) | `## Code standards` |
| 7 | Code standards | Testing philosophy? | Multi-choice (TDD / tests-after / case-by-case / skip for prototypes) | `## Code standards` |
| 8 | Code standards | Refactor tolerance when fixing a bug — also clean up nearby smells? | Multi-choice (aggressive / minimal / case-by-case) | `## Code standards` |
| 9 | Autonomy | When Claude is uncertain about a design choice — ask first, pick a default and proceed, or pick and surface? | Multi-choice | `## Autonomy` |
| 10 | Autonomy | Destructive operations (force-push, delete branch, drop table) — confirmation policy? | Multi-choice (always confirm / confirm only for shared state / autonomous) | `## Autonomy` |
| 11 | Autonomy | Multi-step tasks — plan first, start immediately, or case-by-case? | Multi-choice | `## Autonomy` |
| 12 | Hard rules | Things Claude should NEVER do (top 1–3)? | Free text | `## Never` |
| 13 | Hard rules | Things Claude should ALWAYS do (top 1–3)? | Free text | `## Always` |
| 14 | Hard rules | Pet peeves about generic AI output you want suppressed? | Free text | `## Pet peeves` |
| 15 | Domain assumed | What expertise / stack should Claude assume you have? | Free text | `## Domain` |

### Output template — identity.md

The wizard writes a file structured as:

```markdown
# Identity — Robert Ghafoor

## Role
You are a <role from Q1>, primarily <activity mix from Q2>.

## Communication
- Response length: <Q3>
- Pre-action explanations: <Q4>
- End-of-turn summaries: <Q5>

## Code standards
- Comments: <Q6>
- Tests: <Q7>
- Refactor tolerance: <Q8>

## Autonomy
- When uncertain: <Q9>
- Destructive operations: <Q10>
- Multi-step tasks: <Q11>

## Never
<Q12, formatted as bullets>

## Always
<Q13, formatted as bullets>

## Pet peeves
<Q14, formatted as prose or bullets — the wizard picks based on input>

## Domain
<Q15, formatted as prose>
```

### Refine mode

The subagent reads the existing identity.md plus a sample of recent claude-mem observations and learnings.draft.md entries, then asks 5–8 questions targeting only:

- Sections where observed behavior contradicts the file
- Sections that are vague enough to allow misinterpretation
- New dimensions that have emerged since the last refresh (e.g., a new tool you started using, a new client you onboarded)

Output is presented as a diff for explicit approval before write.
