# Agentic OS — design specification

**Date:** 2026-05-18 (revised 2026-05-19)
**Owner:** Robert Ghafoor
**Status:** Approved for implementation planning
**Source:** Conversation 2026-05-18/19; supersedes nothing (first version).

## Architecture revision — 2026-05-19

Phase 0 smoke tests confirmed that Claude Code's current platform makes the original "parent dispatches subagents" model infeasible without the experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag, which we chose not to depend on. The relevant findings:

- **Issue [#34592](https://github.com/anthropics/claude-code/issues/34592)** (CLOSED as "not planned"): `AskUserQuestion` is not available in subagents. Same gap for `EnterPlanMode` / `ExitPlanMode`.
- **Issue [#35240](https://github.com/anthropics/claude-code/issues/35240)**: `SendMessage` (for mid-flight intervention) is gated behind the agent-teams experimental flag.
- **Issue [#1770](https://github.com/anthropics/claude-code/issues/1770)** (still OPEN, no Anthropic response in 11 months): parent-child agent communication is intentionally not exposed programmatically.
- **Empirical**: on VS Code-integrated CC, `run_in_background: true` spawns new VS Code windows per agent.

**Decision**: adopt **Shape A — same-session pipeline**. Ticket implementation runs in the user's main CC session, one active ticket at a time, with automatic handoff between tickets via the queue. Subagents (foreground only) are reserved for non-interactive batch helpers (consolidate, lint, test, research). No experimental flags, no background dispatch, no SendMessage dependency. The OS becomes a coordination layer around the user's existing CC workflow rather than an orchestrator that spawns parallel workers.

The sections below reflect the revised architecture. Sections §§4, 8, 9 and Appendices B–D survived the revision largely unchanged; §§1, 2, 3, 5, 6, 7, 10, 11 and Appendix A were rewritten.

---

## 1. Purpose

Build a personal agentic operating system that gives me a centralized, improvable workflow on top of Claude Code. The OS removes four recurring frictions and adds one new capability:

- **Re-explaining context every session** — fixed by a global identity layer, per-client brand/workflow context, and a session-start hook that loads the right slice automatically.
- **Cross-session forgetting** — fixed by a curated `learnings.md` index plus a draft/consolidate/archive loop that compresses raw observations into durable rules without context rot.
- **Outputs scattered + inconsistent** — fixed by deterministic paths under `~/.claude/agentic-os/` (memory, state, task scratch) and explicit conventions enforced by the orchestrator.
- **Skills don't compose** — fixed by an orchestrator that wraps the existing public plugins (`jira-ticket`, `ship-branch`, `claude-mem`) without modifying them.
- **New capability: queue-driven ticket pipeline with auto-handoff.** Tickets are queued in advance; the OS processes them serially in the user's main CC session — set up the worktree, hand off to jira-ticket, implement, ship, and automatically pull the next queued ticket. One ticket actively running at a time but human review time becomes the only friction between tickets, not setup.

The OS is also a learning exercise. It should be a clean, idiomatic Claude Code plugin that I can extend later with new agents (time reporting, mail triage, etc.) without restructuring.

## 2. Constraints accepted during design

- **Windows host.** No GSD framework reliance (does not run on Windows for this user).
- **Existing public plugins are sacred.** `jira-ticket`, `ship-branch`, `azure-devops-build`, `itwillsync`, `optimize-skill-description`, `claude-mem`, `superpowers` are not modified. The OS composes around them.
- **Plugin packaging, not symlinks.** Source lives in this repo; install via marketplace; personal data lives in `~/.claude/agentic-os/` outside the plugin cache so plugin updates never overwrite it.
- **Single user, single machine in v1.** Multi-machine sync is an explicit non-goal.
- **Same-session execution model.** All ticket work runs in the user's main Claude Code session. Subagent dispatch is reserved for batch helpers that do not require human input mid-run (consolidation, lint runs, test runs, research). Required by current CC platform limitations — see the architecture revision note above.
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
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/robgha01/agentic-os.git",
    "path": "plugin"
  }
}
```

We use `git-subdir` (not `github`) because the plugin lives in a subdirectory of the repo (`plugin/`). The `github` source type does not accept a `path` field — it expects the plugin at the repo root. Anthropic's official marketplace uses `git-subdir` for this exact pattern (e.g., the `42Crunch-AI` plugin entry).

Fallback (unused — V1 verified by reference to Anthropic's official marketplace which uses these shapes in production): a new dedicated marketplace registered in `~/.claude/settings.json`, pointing at the agentic-os repo. The repo split is preserved in both paths.

### 3.2 Composition with existing plugins

The OS runs plugins **in the user's main CC session**, not in dispatched subagents. This means every existing plugin works exactly as it does today — same UI, same prompts, same tool access.

- `jira-ticket` — invoked from the user's main session for ticket workflows. The OS sets up the worktree first (detached, from main), then naturally references the ticket ID, which auto-triggers `jira-ticket` in the same session. Its Step 2 dedup logic detects the existing worktree state and proceeds normally. The OS never modifies or wraps `jira-ticket`.
- `ship-branch` — invoked from the user's main session during the SHIPPED phase per the client's configured ship strategy.
- `claude-mem` — continues to capture per-project observations on its own. The OS reads observations indirectly through Claude's existing surface, never directly.
- `superpowers` — used at design time (brainstorming, writing-plans, executing-plans). Not invoked at runtime by the OS.

### 3.3 Same-session execution model

Under Shape A (see the architecture revision note at the top of this spec), the user's main CC session **is** the worker. The OS:

- Maintains state files (`queue.json`, `in-flight.json`, `ports.json`, `locks.json`) that any session can read or update
- Provides slash commands that the user invokes in their main session
- Loads identity + client + learnings context automatically via the session-start hook
- Coordinates between tickets by automatically suggesting the next queued ticket after a ship

Subagent dispatch is reserved for **non-interactive batch helpers**:
- `/aos-consolidate` — runs in a foreground subagent so the parent never sees the full draft+curated content during promotion. Defers all interactive decisions back to the main session.
- Optional helper subagents for research, lint runs, test runs, or one-off code inspection tasks. These must be fire-and-forget (no human input required mid-run) per CC platform constraints (Issue #34592).

No subagent ever invokes `jira-ticket`, `ship-branch`, or any other plugin that uses interactive prompts. Those run in the main session only.

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
| `tasks/<ticket>/setup.md` | OS writes once on `/aos-start-ticket` | Ticket pointers (ID, repo, worktree, port). No mission instructions — the main session does the work itself. |
| `tasks/<ticket>/notes.md` | Main session writes as work proceeds | Running narrative (decisions, what was tried) |
| `tasks/<ticket>/report.md` | Written on `/aos-submit` | Structured verification + outcome (see Appendix B) |
| `tasks/<ticket>/feedback.md` | OS appends on `/aos-revise <feedback>` | Reviewer feedback that triggered revision |
| `tasks/<ticket>/state.json` | OS writes throughout lifecycle | Current state: RUNNING / SUBMITTED / SHIPPED / etc., plus timestamps |

On `/aos-ship` and successful close, the OS moves `tasks/<ticket>/` to `tasks/_archive/<ticket>/`.

### 4.6 Runtime state — separate from memory

All JSON, all under `state/`. Machine-global, mutated under file lock.

```
state/ports.json       port ownership across the machine
state/queue.json       all queued tickets across all repos (FIFO with priority)
state/in-flight.json   currently-active ticket + recent completions (rolling, last 50)
state/locks.json       coarse resource locks (qa_backend, etc.)
```

State is read by every `/aos-*` command and by helper subagents. Helper subagents (consolidate, lint, test) are forbidden from writing state — only the main session mutates state through the `/aos-*` slash commands. Under Shape A there is at most ONE active ticket in `in-flight.json` at a time (`max_concurrent_tickets` defaults to 1; values > 1 are reserved for a future agent-teams-enabled mode).

## 5. Orchestration

### 5.1 Skill catalog

All slash commands ship as skills under `plugin/skills/`. The orchestrator skills live at the agentic-os terminal; the small ones work from any repo.

| Command | Surface | Purpose |
|---|---|---|
| `/aos-install` | any | First-run: scaffold `~/.claude/agentic-os/` from templates, pre-grant Write permission |
| `/aos-identity` | any | Mode auto-detected. **Build mode** (no identity.md present): runs the 15-question interview (see Appendix D), writes `identity.md`. **Refine mode** (identity.md present): reads current file + claude-mem observations + recent learnings, forms gap hypotheses, asks 5–8 targeted questions, proposes a diff for approval. Runs in a helper subagent (non-interactive layers); interactive parts come back to the main session. |
| `/aos-load-context` | any | Read identity, learnings, and (if cwd matches) client brand + workflows into current conversation |
| `/aos-tickets` | any | List Jira tickets assigned to user, grouped by project, with in-flight markers; then present the list via `AskUserQuestion` so each ticket is a clickable option to start or queue. Re-run for a fresh snapshot. |
| `/aos-queue COMP-123` | any | Validate ticket exists, append to `state/queue.json`. Use multiple times to queue several tickets in advance. |
| `/aos-start-ticket COMP-123` | any | Sets up worktree, port, state, then **hands off to the current session for implementation** via jira-ticket. See §5.3. |
| `/aos-status` | any | Show currently-active ticket + queue + recent completions |
| `/aos-submit` | any | Mark the currently-active ticket as SUBMITTED. Writes `report.md` (asks the main session to fill in the verification block). State transition. |
| `/aos-ship` | any | Approve the currently-submitted ticket. Invokes `ship-branch` (per client workflows), updates state to SHIPPED, archives task dir, and if queue is non-empty, suggests `/aos-start-ticket <next>`. |
| `/aos-revise <feedback>` | any | Reject the currently-submitted ticket with feedback. Writes `feedback.md`, transitions back to RUNNING in the same session. |
| `/aos-park` | any | Pause the currently-active ticket. Saves state, leaves worktree intact. After `/clear` you can resume with `/aos-resume <TICKET>`. |
| `/aos-resume COMP-123` | any | Restore a parked ticket as the currently-active one. Loads task scratch + worktree + state into the current session. |
| `/aos-abort` | any | Abandon the currently-active ticket. Marks state as ABORTED, removes the detached worktree, releases port. Confirmation required. |
| `/aos-consolidate` | any | Runs in a helper subagent (non-interactive layer). Promotes drafts to curated; archives stale rules with high confidence; demotes weakest on cap. Defers interactive items back to the main session. |
| `/aos-review-stale-learnings` | any | Main session walks stale curated rules and asks "still true?" per entry via AskUserQuestion. |

All `/aos-*` commands work from any directory (including inside a client repo or the agentic-os repo). State files at `~/.claude/agentic-os/state/` are the single source of truth, so any session can see the current active ticket and queue.

`/aos-tickets`, `/aos-queue`, and `/aos-status` use the Atlassian MCP server directly to look up Jira data. They do NOT invoke the `jira-ticket` plugin as a tool — `jira-ticket` is reserved for invocation from the main session during implementation (`/aos-start-ticket` triggers it implicitly by referencing the ticket ID once setup is complete).

### 5.2 OS as coordination layer; main session does the work

Under Shape A there is no parent/subagent split for ticket work. The user's main CC session IS the worker, and the OS adds a thin coordination layer around it:

The OS (via slash commands) does:
- Slash-command parsing
- Small JSON reads/writes (state files)
- Worktree creation/cleanup
- Port allocation
- Memory-tier loading (identity, client brand, learnings) via the session-start hook or `/aos-load-context`
- Queue management with auto-handoff suggestion after each ship

The main session does (with the OS having set things up):
- Atlassian MCP fetch of full ticket body (via jira-ticket)
- All implementation work
- Test execution
- Report writing (`/aos-submit` prompts the session to produce the verification block)
- Ship steps (`/aos-ship` invokes ship-branch)
- Answering `AskUserQuestion` prompts from jira-ticket or superpowers tiers — these work natively because everything is in one session

This means the user sees everything happening live: jira-ticket's Step 2 prompts, implementation decisions, test output, dev server logs. There's no opaque "subagent doing things" — the OS is just adding structure and automation around what the user already does in CC today.

#### Context management across tickets in one session

Working multiple tickets back-to-back in a single session causes context buildup. Two patterns the OS supports:

- **Continuous session**: run several tickets without `/clear`. Pros: cross-ticket context continuity (e.g., learning something while doing COMP-123 informs how COMP-456 is approached). Cons: context grows large; CC compaction may kick in mid-ticket.
- **Cleared-between-tickets**: after `/aos-ship`, run `/clear` before the next `/aos-start-ticket`. The session-start hook re-loads identity + client + learnings. claude-mem keeps observations across sessions. Pros: bounded context per ticket. Cons: lose cross-ticket conversational continuity (still have file-based memory).

The OS suggests but never forces. Configurable via `config.session.suggest_clear_between_tickets` (default `true`).

### 5.3 Same-session ticket pipeline flow

`/aos-start-ticket COMP-123` runs in the user's main session and prepares the ticket for in-session work. The skill does the setup; the user's session then carries out the work via jira-ticket and other plugins running natively.

```
USER: /aos-start-ticket COMP-123

[1] CHECK     Skill reads state/in-flight.json.
              If an active ticket already exists, refuse and offer:
                "COMP-XYZ is currently active. Use /aos-park first, or /aos-abort to cancel it."
              Stop.

[2] LOOKUP    Skill fetches just enough Jira data to know the repo, via Atlassian MCP
              (`getJiraIssue`, only the fields needed: project key, title, summary).
              Cross-references clients/*/repos.md to resolve project key → workspace repo path.
              No body, no acceptance criteria — those come in via jira-ticket later.

[3] LOCK PORT Open state/ports.json under file lock.
              Allocate first free port in config.concurrency.port_range. Default 3001.
              Record { owner: "ticket-COMP-123", since: now }. Release lock.

[4] WORKTREE  git -C C:\Workspace\<repo> worktree add --detach \
                  C:\Workspace\<repo>\.worktrees\COMP-123 main
              Detached worktree at main's tip. Branch creation belongs to jira-ticket Step 2.

[5] STATE     Initialize tasks/COMP-123/ scratch dir with:
                setup.md       (ticket pointers, see Appendix A)
                notes.md       (empty)
                state.json     ({ "state": "RUNNING", "started_at": now })
              Append to state/in-flight.json:
                { ticket: "COMP-123", state: "RUNNING", port, worktree, task_dir, started_at }.

[6] CD        Skill uses Bash to change directory: cd <worktree>.
              Subsequent commands in this session execute in the worktree.

[7] HANDOFF   Skill prints a clear handoff message to the user:
                "Worktree ready at C:\Workspace\catella\.worktrees\COMP-123 (port 3017).
                 Beginning COMP-123 — jira-ticket will fetch the full body next."
              Skill emits a line referencing the ticket ID; jira-ticket's auto-trigger
              activates and runs its full Step 1–5 protocol in this session.
              From here, the user IS in the ticket work: prompts from jira-ticket
              go to their UI, AskUserQuestion works, dev server starts on port 3017.

[8] WORK      User (with Claude) implements the ticket in the session.
              Tests are run via shell commands. Dev server runs on assigned port.
              Decisions logged to tasks/COMP-123/notes.md as work proceeds.
              Take as long as needed; this is normal CC implementation work.

USER: /aos-submit
[9] SUBMITTED Skill verifies tests pass (asks user to confirm if it can't autodetect).
              Writes tasks/COMP-123/report.md from a template (see Appendix B);
              the main session fills in the verification block based on what was actually run.
              Updates state.json and state/in-flight.json: state = "SUBMITTED".
              Prints: "COMP-123 submitted. Review at http://localhost:3017 or
                       run /aos-ship to approve, /aos-revise <reason> to reject."

[10] REVIEW   Human reviews live (dev server still running, worktree intact).
              Either:
                /aos-ship           → continue to [11]
                /aos-revise <text>  → write feedback.md, state = RUNNING, loop back to [8]

USER: /aos-ship
[11] SHIP     Skill invokes ship-branch with the worktree's branch (created by jira-ticket).
              ship-branch handles the merge per the client's ship strategy.
              On success: state = "SHIPPED", port released, worktree removed (or retained
              per ship strategy), tasks/COMP-123/ archived to tasks/_archive/COMP-123/.

[12] CONSOLIDATE
              Check consolidation thresholds (§9.2). If applicable, dispatch
              /aos-consolidate as a helper subagent (non-interactive layer only —
              defers interactive items back to main session). Parent context cost
              is minimal because subagent does the heavy reading.

[13] NEXT     Skill reads state/queue.json.
              If queue is non-empty, suggest the next ticket:
                "COMP-456 is next in queue. Run /aos-start-ticket COMP-456 to begin
                 (or /clear first if you'd like a fresh context window)."
              If suggest_clear_between_tickets is true, suggest /clear before next.
              If queue is empty, print: "Queue is empty. No more tickets."
```

The flow is interactive (with the user, in their session) rather than autonomous (a subagent doing work behind the scenes). This is by design — see the architecture revision note at the top of this spec.
```

### 5.4 Mission file (`mission.md`) template

See **Appendix A**.

### 5.5 Report file (`report.md`) contract

See **Appendix B**.

## 6. Error handling and intervention

### 6.1 Three failure classes

| Class | Examples | Strategy |
|---|---|---|
| Mechanical setup | Port range exhausted, worktree creation fails, ticket not found, branch already exists | `/aos-start-ticket` skill catches and surfaces a clear error; state unchanged; ticket remains queueable |
| Implementation failure (in-session) | Tests fail and the user/Claude can't fix; build broken; design impossible | Mark ticket as FAILED via `/aos-abort` (or revise approach in-session); state recorded; worktree retained for human inspection |
| Helper subagent failure | `/aos-consolidate` or similar helper crashes | Helper returns error; OS surfaces to main session; user decides next step |

### 6.2 Intervention (Shape A — no levels, just typing)

Because all ticket work runs in the user's main session, intervention is **native to the conversation**:

- jira-ticket needs to clarify the ticket? It uses `AskUserQuestion` directly in your UI.
- A design decision comes up mid-implementation? Claude in your session asks you (with all tools available, including AskUserQuestion).
- You want to change direction mid-flow? You just type it. There's no subagent to message — the conversation is the channel.

Removed concepts that don't apply under Shape A:
- ~~Level 1 (`AskUserQuestion` from subagent)~~ — N/A. Ticket work isn't in a subagent. AskUserQuestion in main session works naturally.
- ~~Level 2 (`SendMessage` to subagent)~~ — N/A. No running subagent for ticket work. Helper subagents (consolidate) are fire-and-forget; they can't be messaged mid-run but they're short-running and non-interactive by design.
- ~~Level 3 (help-request file + kill/resume)~~ — N/A. Same reason.

For helper subagents (consolidate, lint, test) that do hit something unexpected: they return an error string in their result, and the main session decides what to do.

### 6.3 Watchdog

Mostly N/A under Shape A — the user IS the work; "inactivity" means the user paused work, which is fine. The watchdog concept survives only for helper subagents in narrow form: if `/aos-consolidate` runs longer than `config.intervention.helper_max_runtime_minutes` (default 5), the OS suggests aborting via `TaskStop`. Helper subagents are expected to be short.

### 6.4 Retries

- Mechanical setup errors: no retry. Deterministic; the user adjusts input and re-runs `/aos-start-ticket`.
- Implementation failures: handled in-session by the user + Claude. No automatic retry mechanism — retry is just "keep trying things until it works, or `/aos-abort`."
- Helper subagent errors: surface the error message; suggest re-running the helper or doing the work inline in the main session.

## 7. Ticket lifecycle and testing

### 7.1 Lifecycle states (Shape A)

The lifecycle now describes the **state of the active ticket** as recorded in `state/in-flight.json`, not the state of a subagent.

```
(none) → RUNNING → SUBMITTED → SHIPPED → ARCHIVED
              │       │
              │       └── (rejected) → RUNNING  [/aos-revise loop]
              │
              ├── PARKED  [/aos-park, then /aos-resume returns to RUNNING]
              │
              └── ABORTED  [/aos-abort]
```

- **(none)**: no active ticket. `/aos-start-ticket` is available.
- **RUNNING**: a ticket is active; work is happening in the main CC session. Dev server typically running on the assigned port. Worktree is the cwd.
- **SUBMITTED**: `/aos-submit` was run. Tests passed (per user), `report.md` written. Awaiting `/aos-ship` or `/aos-revise`. Dev server still up.
- **SHIPPED**: `/aos-ship` was run. ship-branch merged the work. Worktree cleaned per ship strategy, port released.
- **ARCHIVED**: task scratch moved from `tasks/<ticket>/` to `tasks/_archive/<ticket>/`. State entry moved from `in_flight` to `recent`. Ticket is done; `/aos-start-ticket` is available again.
- **PARKED**: `/aos-park` was run. State preserved on disk, port released, dev server stopped. User can `/clear` safely. `/aos-resume <TICKET>` later brings the ticket back to RUNNING.
- **ABORTED**: `/aos-abort` was run. Worktree removed, port released, state moved to `recent` with outcome: aborted.

### 7.2 Park + resume across sessions

`/aos-park` is the explicit "I want to /clear my context but I'm not done with this ticket" command:

- Stops the dev server (preserves changes in worktree on disk)
- Releases the port
- Writes a marker file `tasks/<ticket>/parked.json` with `{ "parked_at": now, "last_state": "RUNNING" }`
- State transitions to PARKED in `state/in-flight.json`
- User can run `/clear` safely now

`/aos-resume <TICKET>`:
- Reads `parked.json` and notes.md and report.md (if exists)
- Re-allocates a port (may differ from original)
- Re-starts dev server in the worktree
- Sets cwd to the worktree
- Loads context into the current session (identity, client, learnings re-loaded automatically by session-start hook)
- Reads the ticket's setup.md and notes.md to refresh the session with what was already done
- Transitions state to whatever it was before park (RUNNING or SUBMITTED)
- Continues from there

### 7.3 Test layers

| Layer | Owner | Mechanism | Purpose |
|---|---|---|---|
| 1 — Lint + typecheck | Main session | Repo's commands in the worktree | Pre-submit gate |
| 2 — Unit tests | Main session | Repo's commands in the worktree | Pre-submit gate |
| 3 — Component tests | Main session | Repo's commands in the worktree | Pre-submit gate |
| 4 — Headless browser | Main session | `mcp__chrome-devtools__*` preferred, against `localhost:<assigned-port>` | Pre-submit gate |
| 5 — Visual e2e | Human | Open `localhost:<port>` in browser; review the UX | Pre-approval gate (between SUBMITTED and SHIP) |
| 6 — PR review | Human | Read the diff | Pre-merge gate (could happen inside `/aos-ship` via ship-branch's strategy) |

The Shape-A spec drops the original "Layer 5 — Parent trust-check" (which existed in the subagent-dispatch design to defend against a lying subagent). With same-session execution, the user is watching the test output live; there's no "agent claims green but lied" failure mode to defend against.

### 7.4 Backend lock

Some tickets mutate the shared Azure QA backend (schema changes, integration tests that write). With Shape A and a single active ticket at a time, this lock matters less day-to-day — but it survives in the spec for two reasons:

1. The state file gives a single record of "this ticket touched QA" for traceability.
2. If/when the user enables agent-teams in the future and `max_concurrent_tickets` becomes > 1, the lock protects against concurrent mutations.

```json
state/locks.json
{
  "qa_backend": { "owner": "ticket-COMP-131", "since": "...", "reason": "migration test" }
}
```

Per ticket, before backend-mutating work, the user (or Claude in the session) writes the lock. After the work, the lock is released. Lock acquisition is advisory under Shape A (single active ticket), enforcement-grade under future modes.

### 7.5 Browser tool preference

Per the user's global `~/.claude/CLAUDE.md`, browser test calls in the active ticket session follow:

1. Prefer `mcp__chrome-devtools__*` (real CDP emulation; required for media queries).
2. Fall back to `mcp__claude-in-chrome__*` if unavailable.
3. If neither, note explicitly in `report.md` verification block.

This rule is loaded by the session-start hook on session start and is therefore in scope for every ticket worked in the session.

## 8. Configuration

Single file at `~/.claude/agentic-os/config.json`, scaffolded by `/aos-install` from a template, never overwritten by plugin updates.

```json
{
  "concurrency": {
    "max_concurrent_tickets": 1,
    "port_range": [3001, 3099]
  },
  "session": {
    "suggest_clear_between_tickets": true
  },
  "memory": {
    "learnings_md_max_lines": 150,
    "promotion_threshold": 3,
    "stale_review_days": 90,
    "consolidate_mode": "auto-non-interactive",
    "auto_consolidate_suggest_drafts": 10,
    "auto_consolidate_suggest_at_cap_percent": 95
  },
  "intervention": {
    "helper_max_runtime_minutes": 5
  },
  "ship": {
    "create_pr_after_approval": false
  },
  "experimental": {
    "phase_2_web_ui": false,
    "itwillsync_notify_on_help": false,
    "agent_teams_when_enabled": false
  }
}
```

**Defaults under Shape A:**

- `max_concurrent_tickets: 1` — at most one active ticket; queue holds the rest. Reserved for future agent-teams-enabled mode where it may go higher.
- `suggest_clear_between_tickets: true` — after `/aos-ship`, the OS suggests `/clear` before the next `/aos-start-ticket` to keep session context bounded. Override per personal preference.
- `helper_max_runtime_minutes: 5` — if `/aos-consolidate` (or other helper subagent) runs longer than 5 min, OS suggests aborting it.
- `agent_teams_when_enabled: false` — placeholder for a future opt-in. When true (and the user has set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), the OS may dispatch teammates for parallel ticket work. Not implemented in v1.

When `/aos-start-ticket` is invoked and an active ticket already exists, the new ticket is automatically queued. The OS will suggest starting it after `/aos-ship` (or after `/aos-abort`/`/aos-park`).

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
  Non-interactive (always safe to auto-run):
    A. Drafts with 3+ occurrences and no conflict with existing rules → promote
    B. Drafts that are clearly project-specific → move to that project's CLAUDE.md or auto-memory
    C. Curated rules where frontmatter says confidence: high AND last_validated > stale_review_days × 2
       → archive automatically (high-confidence rules that haven't been touched in a long time
       are either deeply true or completely irrelevant — either way, archiving them is reversible)
    D. learnings.md > learnings_md_max_lines → merge or demote weakest entries (lowest confidence first)

  Interactive (requires AskUserQuestion — DEFERRED in auto-non-interactive mode):
    E. Drafts that contradict existing curated rules → ask which wins
    F. Drafts ambiguous between project-specific and cross-project → ask the scope
    G. Curated rules that are stale but NOT high-confidence → ask "still true?"

OUTPUT
  Updated learnings.md (capped, fresh)
  Updated learnings/<topic>.md (only for non-deferred entries when auto-running)
  Cleared/rewritten learnings.draft.md (deferred items remain in draft, tagged for next manual run)
  archive/<date>-<topic>.md for demoted/auto-archived rules
  Short summary report to parent including: actions taken, items deferred (N)
```

#### Triggers

Three modes determine when and how `/aos-consolidate` runs. The mode is set via `config.memory.consolidate_mode`.

| Mode (config value) | Default? | Behavior |
|---|---|---|
| `auto-non-interactive` | **DEFAULT** | After every ship (§5.3 step [14]) and on every `/aos-status`, orchestrator cheaply checks: `learnings.draft.md` line count > `config.memory.auto_consolidate_suggest_drafts`, OR `learnings.md` line count > `config.memory.auto_consolidate_suggest_at_cap_percent` × `learnings_md_max_lines`. If either, **dispatch `/aos-consolidate` automatically in a subagent**. Subagent does only decisions A–D; defers E–G to the manual flow. User sees the summary in `/aos-status` ("12 drafts promoted; 2 items deferred — run `/aos-consolidate` to resolve"). |
| `auto-full` | opt-in | Same triggers, but subagent also resolves E–G interactively via `AskUserQuestion`. Questions appear in the UI as they arise; user answers when ready. Most aggressive — turn this on once you trust the consolidation behavior on your data. |
| `suggest` | opt-in | The "tell me but don't act" behavior. Orchestrator only surfaces a suggestion ("Drafts piled up — run `/aos-consolidate`?"). Never auto-runs. For users who want full manual control. |

The user types `/aos-consolidate` manually at any time, in any mode — that always does the full A–G pass interactively. The mode only governs the *automatic* behavior.

#### Why `auto-non-interactive` is the default

The OS is supposed to keep itself tidy without the user having to remember. Routine consolidation (drafts piling up, clearly cross-project patterns, stale high-confidence rules) doesn't need human judgment — those are mechanical. Only when there's a real judgment call (conflicts, ambiguous scope) does the user need to be pulled in. Auto-non-interactive does the boring work silently and defers the genuinely-needs-you items to the next manual run.

### 9.3 `/aos-review-stale-learnings` workflow

Subagent reads `learnings.md` frontmatter (`last_validated`, `confidence`). For entries beyond `stale_review_days`:

- Use `AskUserQuestion` per entry: "still true? archive? update?"
- Apply user's choice, update or move to archive

#### Triggers

**Soft suggest only.** On every `/aos-status`, the orchestrator checks: when was the last stale-review? If `now - last_review > stale_review_days`, surface a suggestion ("It's been N days since the last stale-learnings review — run `/aos-review-stale-learnings`?"). No hard auto-run knob because the workflow is interactive per-entry (`AskUserQuestion`) and silent auto-invocation would interrupt without warning.

The orchestrator records `state/last_stale_review.json` with a single timestamp; updated each time `/aos-review-stale-learnings` completes.

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

After Phase 0 round 1, the verification matrix below has been updated with actual results. See `docs/superpowers/plans/smoke-results.md` for the full discussion.

| # | Assumption | Result | Detail |
|---|---|---|---|
| V1 | Marketplace `source` field supports external repos | **PASS** | Verified by reference to Anthropic's official marketplace which uses `git-subdir`, `github`, `url`, and `git` source shapes in production. Spec §3.1 uses `git-subdir` for our repo-with-subdir case. |
| V2 | `SendMessage` to a running background subagent | **FAIL** | Gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag (Issue #35240). Also: `run_in_background: true` in VS Code-integrated CC spawns new VS Code windows per agent. **Architectural fallback applied**: Shape A pivot — no subagent dispatch for ticket work. |
| V3 | `AskUserQuestion` from inside a subagent | **FAIL** | Tool simply not available in subagent contexts (Issue #34592 closed as "not planned" by Anthropic; same for `EnterPlanMode`/`ExitPlanMode`). **Architectural fallback applied**: Shape A — ticket work runs in main session where AskUserQuestion natively works. |
| V4 | Helper subagents can Read/Write to `~/.claude/agentic-os/` under default permissions | TBD | Still relevant under Shape A for helper subagents (`/aos-consolidate`, optional research/test helpers). Re-test under Shape A. Fallback: `/aos-install` adds explicit Write/Edit rules to `settings.local.json` scoped to `~/.claude/agentic-os/**`. |
| V5 | Plugin SessionStart hook fires globally | TBD | Still core to Shape A — the hook is how identity + client context auto-load in any session. Fallback: `/aos-load-context` as the manual entry point. |
| ~~V6~~ | ~~jira-ticket auto-trigger inside subagent~~ | **N/A** | Dropped under Shape A — jira-ticket runs in the main session, never in a subagent. |

V4 and V5 remain to be tested. V1 PASS, V2 + V3 FAIL with architectural pivots already applied to this spec.

## 11. Build order (v1 scope)

Revised for Shape A. V1/V2/V3 are done (V1 PASS, V2+V3 FAIL with architectural pivots applied). V4 + V5 still to verify.

```
0. REMAINING SMOKE TESTS — verify V4, V5.

1. PLUGIN SCAFFOLD
   plugin.json manifest, directory structure, marketplace entry, install on local CC.
   Use git-subdir source per §3.1.
   Acceptance: `/plugin install agentic-os@robert-personal` works; plugin listed in /plugin.

2. /aos-install
   Skill scaffolds ~/.claude/agentic-os/ from plugin/templates/.
   Pre-grants Write/Edit permission for ~/.claude/agentic-os/**.
   Idempotent: never overwrites existing data; emits a clear "already installed" message.
   At the end, prompts user to run /aos-identity to populate identity.md for real.
   Acceptance: fresh machine → run /aos-install → personal data tree exists.

2.5. /aos-identity (build + refine modes)
   Skill runs in helper subagent for the non-interactive layers (reading existing identity,
   claude-mem observations, learnings). Interactive parts (the 15 questions, refine-mode
   diff approval) happen in the main session via AskUserQuestion. Writes identity.md.
   Acceptance: build mode produces a sensible identity.md from 15 answers;
   refine mode picks up at least one stale or missing item from existing identity.md.

3. /aos-load-context + session-start hook
   Hook reads identity + learnings + (if cwd matches) client brand + workflows.
   /aos-load-context is the manual equivalent. V5 verifies hook actually fires.
   Acceptance: opening CC in a Comprend repo loads Comprend brand into context.

4. STATE FILES + /aos-tickets + /aos-queue + /aos-status
   Read-only orchestrator surface. /aos-tickets uses AskUserQuestion for clickable
   selection. /aos-status reads in-flight + queue + recent.
   Acceptance: /aos-tickets shows my assigned Jira issues grouped by project; queueing works.

5. /aos-start-ticket FULL LIFECYCLE (same-session)
   Setup: validate no active ticket, allocate port, detached worktree, init state.
   Hand off to main session by cd-ing into worktree and referencing the ticket ID
   (jira-ticket auto-triggers).
   Implementation happens in the session. User runs /aos-submit, /aos-ship, /aos-revise
   to drive the lifecycle. Automatic suggestion of next queued ticket on /aos-ship.
   Acceptance: a real ticket completes end-to-end through submit → ship → next ticket
   suggested. Test live in a real client repo (e.g., catella).

6. /aos-park + /aos-resume + /aos-abort
   Lifecycle controls. /aos-park saves state and allows /clear; /aos-resume restores into
   current session; /aos-abort cleans up.
   Acceptance: a ticket can be parked, /clear runs cleanly, /aos-resume brings it back
   in a fresh session.

7. /aos-consolidate + /aos-review-stale-learnings
   Self-improvement loop. /aos-consolidate runs in a helper subagent for non-interactive
   layers (A–D in §9.2). Interactive items (E–G) come back to main session.
   /aos-review-stale-learnings is fully interactive in main session.
   Acceptance: after a few mock observations in draft, /aos-consolidate produces a
   sensible promotion. /aos-review-stale-learnings asks per-entry and applies user choices.

8. POLISH
   Real-data scaffolding for Comprend brand + repos.md, sensible defaults in config.json,
   README updates, error messages, the suggest-clear-between-tickets nudge tuning.
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
| V4 / V5 fail | Each has a documented fallback (see §10). Neither blocks v1 entirely; they reduce the polish (V4 fail → explicit settings.local.json grant; V5 fail → user must `/aos-load-context` manually after starting CC). |
| Single active ticket feels too slow vs. true parallelism | Pipeline parallelism is the design choice — the queue pulls next ticket automatically on ship. If the user wants true parallel, they can enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and the spec's reserved `experimental.agent_teams_when_enabled` knob (not built in v1). |
| Multi-ticket context buildup in one session | `suggest_clear_between_tickets` on by default. Memory tiers + claude-mem keep durable knowledge across clears. |
| Dev server collision when user runs CC outside a worktree on port 3000 | Port range is 3001–3099 for tickets; user's main work keeps 3000. Collision shouldn't occur in normal use. |
| User runs `/aos-start-ticket` from a worktree of a different ticket | Skill detects: cwd is inside an existing worktree but there's an active ticket already. Refuses with clear error. |
| Stale state if CC crashes mid-ticket | `state/in-flight.json` retains the entry; on next session start, `/aos-status` will show it. User decides: `/aos-resume` to restore, `/aos-abort` to clean up. |
| Helper subagent (e.g., /aos-consolidate) hangs or runs forever | Watchdog: `config.intervention.helper_max_runtime_minutes` (default 5). OS suggests `TaskStop` if exceeded. |

## Appendix A — setup.md template

Under Shape A there is no "mission for a subagent" — the user's main CC session does the ticket work. `/aos-start-ticket` writes a short `setup.md` to the task scratch dir that captures the ticket's coordinates. The session reads it (or just reads it implicitly via the slash command's output) and proceeds.

```markdown
# Ticket: <TICKET-ID>

Repo:      <repo-path>
Worktree:  <worktree-path>      (detached HEAD at main's tip; jira-ticket Step 2 owns branch creation)
Port:      <assigned-port>      (use PORT=<port> when starting dev server)
Started:   <ISO timestamp>
Scratch:   ~/.claude/agentic-os/tasks/<TICKET-ID>/

## What you (main session) just need to do

1. cd <worktree>   (already done by the skill, but worth confirming)
2. Reference <TICKET-ID> — jira-ticket will auto-trigger and run its Step 1-5 workflow
   (fetch body, create branch in this detached worktree, transition Jira status,
   assess complexity, hand off to the appropriate superpowers tier)
3. Implement, test, iterate. Use the dev server on port <assigned-port> for live testing
   (set PORT=<port> when starting it).
4. When done: run /aos-submit. This generates report.md and transitions state to SUBMITTED.
5. Human reviews. Then run /aos-ship to approve or /aos-revise <feedback> to reject.

## Where to log running notes

Append to `notes.md` in this same directory as you work. Anything you'd want to remember
when revising, or that should feed claude-mem observations, goes there.

## Tools available

All of CC's tools are available in your main session — AskUserQuestion, EnterPlanMode,
Read/Write/Edit/Bash, all MCPs (Atlassian, chrome-devtools), all installed plugins
(jira-ticket, ship-branch). Use them as you normally would.

## Browser testing (from your global CLAUDE.md)

1. Prefer mcp__chrome-devtools__* (real CDP emulation; required for media queries).
2. Fall back to mcp__claude-in-chrome__* if unavailable.
3. If neither, note explicitly in report.md verification block.

## When this ticket completes (/aos-ship runs)

- The OS will archive this directory to tasks/_archive/<TICKET-ID>/
- The OS will check the queue. If queued tickets exist, it'll suggest /aos-start-ticket <next>.
- If `config.session.suggest_clear_between_tickets` is true, it'll suggest /clear before next.
```

## Appendix B — report.md contract

Generated by `/aos-submit` from a template; the main session fills in the verification block based on what was actually tested.

```yaml
ticket: <TICKET-ID>
status: submitted | shipped | aborted
submitted_at: <ISO timestamp>
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
      "state": "RUNNING" | "SUBMITTED" | "PARKED",
      "port": 3017,
      "worktree": "C:\\Workspace\\catella\\.worktrees\\COMP-123",
      "task_dir": "C:\\Users\\Robert\\.claude\\agentic-os\\tasks\\COMP-123",
      "started_at": "...",
      "submitted_at": null,
      "parked_at": null
    }
  ],
  "recent": [
    { "ticket": "COMP-100", "state": "SHIPPED", "ended_at": "...", "outcome": "merged" }
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
