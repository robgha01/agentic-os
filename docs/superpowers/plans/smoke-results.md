# Smoke Test Results — Phase 0

Each row records what happened when we ran the test in spec §10.

| ID | Assumption | Result | Notes / Error text |
|----|-----------|--------|--------------------|
| V1 | External marketplace source supported | PASS (by docs reference) | Anthropic's official marketplace at anthropics/claude-plugins-official uses all 5 source shapes including `git-subdir`, `github`, `url`, `git` in production. No need for live test. Spec §3.1 corrected to use `git-subdir` (not `github`) for our plugin-in-subdir case. |
| V2 | SendMessage to running background subagent | FAIL — gated behind CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 flag (not enabled). Also: run_in_background:true on VS Code-integrated CC spawns new VS Code windows per agent. Mitigation: enable agent teams + in-process mode (see V2 details below). | |
| V3 | AskUserQuestion from subagent | **FAIL** — tool not available in subagents (Issue #34592 closed as "not planned" by Anthropic). | |
| V4 | Subagent writes to ~/.claude/agentic-os/ | Deferred — still relevant for helper subagents (consolidate, lint, test) but not blocking the architecture choice | |
| V5 | Plugin SessionStart hook fires globally | Deferred — still relevant under Shape A | |
| V6 | jira-ticket auto-activates inside subagent | **N/A** — Shape A runs jira-ticket in main session, not in subagents | |

---

## Architectural decision — locked 2026-05-19

Phase 0 results V1-V3 forced a fundamental architecture revision. Anthropic has explicitly chosen (per Issues [#34592](https://github.com/anthropics/claude-code/issues/34592), [#35240](https://github.com/anthropics/claude-code/issues/35240), and the still-open [#1770](https://github.com/anthropics/claude-code/issues/1770)) to keep subagents non-interactive without the experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag.

Decision: adopt **Shape A — same-session pipeline**. Ticket work runs in the user's main CC session, one ticket actively running at a time, with automatic handoff between tickets via the queue. Subagents reserved for non-interactive batch helpers only (consolidate, lint, test, research). No experimental flag. No `run_in_background:true` dispatch.

This requires substantial spec rewrites (§§1, 2, 3, 5, 6, 7 of the design spec). Remaining smoke tests (V4, V5) are deferred for re-scoping under the new architecture; V6 (jira-ticket inside subagent) is dropped — jira-ticket runs in main session under Shape A.

---

## V3 — AskUserQuestion from subagent — FAIL

Test: dispatched two foreground subagents in a single response. Each was instructed to call `AskUserQuestion` immediately with a labeled question.

Result: **both subagents reported the tool was not available.** Direct quote from one of them: *"The `AskUserQuestion` tool is not available in this environment (it doesn't appear in either the loaded tools or the deferred tools list, and ToolSearch returns no matches for it)."*

This is confirmed at the platform level by [Issue #34592](https://github.com/anthropics/claude-code/issues/34592) (CLOSED as "not planned"):
- The official docs claim subagents inherit `AskUserQuestion`. They don't.
- Same gap exists for `EnterPlanMode`/`ExitPlanMode`.
- Closed without resolution. Multiple related issues (#30563, #29393, #30983, #30523) confirm the pattern.

Workaround discussed: yurukusa's file-question pattern ([#34592 comment](https://github.com/anthropics/claude-code/issues/34592#issuecomment-4062842335)) — subagent writes question to file and exits; parent reads, asks user, re-dispatches subagent. Works for narrow non-jira interactive needs but does NOT solve our specific problem (jira-ticket uses text-based prompts internally — re-implementing those via the file pattern would violate the "jira-ticket is sacred" constraint in §2 of the spec).

**Impact on spec:** intervention model collapses — Level 1 (AskUserQuestion in subagent) impossible, Level 2 (SendMessage) requires flag, only Level 3 (file-based, slow) remains. Under Shape A this is moot because ticket work runs in main session where AskUserQuestion natively works.

---

## V2 — SendMessage + background subagent behavior

### Finding 1: SendMessage is gated behind an experimental flag

`SendMessage` is referenced in the Agent tool's documentation but cannot be loaded via ToolSearch in default Claude Code. Per https://github.com/anthropics/claude-code/issues/35240 and https://code.claude.com/docs/en/agent-teams, it's part of the **Agent Teams** feature, which is disabled by default. Enable with:

```json
// settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

With agent teams enabled, our spec's "subagent" maps cleanly to a **teammate** (full independent CC session, addressable by name, supports SendMessage). Shared task list with file-locking, mailbox for messages — exactly the primitives we designed for.

### Finding 2: run_in_background: true spawns new VS Code windows

In the user's VS Code-integrated CC, dispatching `Agent({ run_in_background: true })` opens a new VS Code window per agent. Confirmed empirically: a foreground Agent call (no `run_in_background`) did NOT open any new window. Background did.

This breaks our spec's "parent stays in main terminal while N subagents work invisibly" model.

### Mitigation: agent teams + in-process mode

The Agent Teams docs explicitly say: *"Split-pane mode isn't supported in VS Code's integrated terminal, Windows Terminal, or Ghostty."* For VS Code-integrated CC, the only mode is `in-process` — all teammates render inside the main terminal, navigate between them with Shift+Down. No new windows. SendMessage works.

```json
// settings.json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "teammateMode": "in-process"
}
```

### Spec impact

- Replace "subagent" with "teammate" terminology in §§3, 5, 6, 7 (or keep "subagent" and note that internally it's an agent-teams teammate when running in parallel).
- Drop `run_in_background: true` from the dispatch flow (§5.3 step 7). Use agent-teams spawn instead.
- Level 2 intervention via `SendMessage` is now conditionally available — only with the flag set.
- §11 step 1 (plugin scaffold) should also document the required settings.json change as a prerequisite.

### Stability caveats noted

- Agent teams is marked experimental — known limitations around session resumption (no `/resume` for in-process teammates), task status lag, slow shutdown.
- "Uses significantly more tokens than a single session."
- One team at a time (no nesting; teammates can't spawn their own teams).

---

## V1 — External marketplace source — PASS

Verified by reference to Anthropic's official marketplace
(https://github.com/anthropics/claude-plugins-official) rather than live test.

The official marketplace uses these source shapes in production:
- String relative path: `"source": "./plugins/agent-sdk-dev"`
- `url`: `{ source: "url", url, sha }`
- `git-subdir`: `{ source: "git-subdir", url, path, ref?, sha? }`
- `github`: `{ source: "github", repo, commit?, sha? }` (NO path field)
- `git`: `{ source: "git", url }`

**Correction to spec:** original spec §3.1 used `{ source: "github", repo, path }`.
The `github` source does not accept a `path` field. Since agentic-os keeps its
plugin in a `plugin/` subdirectory of the repo, the correct shape is `git-subdir`:

```json
{
  "name": "agentic-os",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/robgha01/agentic-os.git",
    "path": "plugin"
  }
}
```

Spec §3.1 has been updated. No live test entry was pushed to the public
robert-personal repo.
