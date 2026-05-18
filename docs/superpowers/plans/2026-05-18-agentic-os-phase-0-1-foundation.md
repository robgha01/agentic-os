# Agentic OS — Phase 0 + 1 (Smoke Tests + Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the six platform assumptions our spec relies on, then ship the agentic-os plugin scaffold, its `/aos-install` first-run wizard, and the `/aos-identity` interview that produces a real `identity.md`. After this plan you have an installable plugin and a populated personal data tree at `~/.claude/agentic-os/`.

**Architecture:** Claude Code plugin developed in `C:\Workspace\agentic-os\plugin\`, distributed via the existing `robert-personal` marketplace as an external GitHub source. Personal mutable data lives at `~/.claude/agentic-os/` outside the plugin cache so updates never overwrite it.

**Tech Stack:** Claude Code plugin format (`.claude-plugin/plugin.json`, `skills/<name>/SKILL.md`), PowerShell + Git Bash for hooks/scripts (Windows host), Jira via the Atlassian MCP server (already configured).

**Spec reference:** `docs/superpowers/specs/2026-05-18-agentic-os-design.md` — sections §10 (V1–V6), §11 (build steps 1, 2, 2.5), §3 (architecture), §4 (memory layout), §5.1 (skill catalog), Appendix D (`/aos-identity` interview contract).

---

## Phase 0 — Smoke Tests (V1–V6)

Each smoke test validates one platform assumption from spec §10. If a test fails, the documented fallback in §10 applies and we update the spec before continuing. Phase 0 produces no plugin code — it's pure de-risking.

**Order matters slightly**: V1 first (marketplace plumbing) because everything else depends on installing plugins. V2 and V3 can be done in either order. V4 needs an Agent dispatch so can piggyback on V2. V5 only matters if we ship a hook (we do). V6 has the broadest impact (jira-ticket auto-trigger from inside subagents).

### Task 0.1: V1 — External marketplace source supported

**Goal:** Confirm `claude-plugins\.claude-plugin\marketplace.json` accepts a plugin entry whose `source` points to a different GitHub repo.

**Files:**
- Modify: `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json` (test entry, will be reverted)
- Create: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md` (records results across all V1-V6)

- [ ] **Step 1: Pick a harmless external repo to test against**

Any small public repo with a plugin-like structure works. Use Anthropic's own `claude-plugins-official` marketplace or any well-known plugin repo. We're testing the manifest mechanism, not the plugin itself.

For this test, point at a known-public repo, e.g. `anthropics/claude-code` (or any other repo guaranteed to exist). The install does not need to succeed — we are checking whether CC even attempts to resolve an external `source`.

- [ ] **Step 2: Add a test entry to robert-personal marketplace**

Add (do not commit) a new plugin entry at the end of the `plugins` array in `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json`:

```json
{
  "name": "aos-marketplace-smoketest",
  "description": "Temporary entry to verify external source support — do not install.",
  "category": "development",
  "source": { "source": "github", "repo": "anthropics/claude-code" },
  "author": { "name": "Robert Ghafoor", "email": "" }
}
```

- [ ] **Step 3: Reload the marketplace in CC and list plugins**

In Claude Code, run:

```
/plugin marketplace reload robert-personal
/plugin
```

**Expected if V1 passes:** the marketplace reloads without error, and `aos-marketplace-smoketest` appears in the listing with its source resolved to the external repo. Whether the plugin itself is *installable* doesn't matter — we only care that the schema accepts external `source`.

**Expected if V1 fails:** the reload errors out citing the unsupported `source` shape, OR the plugin doesn't appear in the listing. Record exact error text in `smoke-results.md`.

- [ ] **Step 4: Record result in smoke-results.md**

Create `docs/superpowers/plans/smoke-results.md` if it doesn't exist:

```markdown
# Smoke Test Results — Phase 0

Each row records what happened when we ran the test in spec §10.

| ID | Assumption | Result | Notes / Error text |
|----|-----------|--------|--------------------|
| V1 | External marketplace source supported | PASS / FAIL | <fill in> |
| V2 | SendMessage to running background subagent | TBD | |
| V3 | AskUserQuestion from subagent (with attribution) | TBD | |
| V4 | Subagent writes to ~/.claude/agentic-os/ | TBD | |
| V5 | Plugin SessionStart hook fires globally | TBD | |
| V6 | jira-ticket auto-activates inside subagent | TBD | |

## V1 details
<paste exact CC output here>
```

- [ ] **Step 5: Revert the test marketplace entry**

Remove the `aos-marketplace-smoketest` entry from `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json`. Do not commit the test entry. Reload again:

```
/plugin marketplace reload robert-personal
```

- [ ] **Step 6: Decide fallback if V1 failed**

If V1 PASSED: continue. If V1 FAILED: edit spec §3.1 to note the new dedicated-marketplace approach (Option C from the brainstorm). Then create a new marketplace registration in `~/.claude/settings.json` pointing at the agentic-os repo. Continue with subsequent tasks under that path.

- [ ] **Step 7: Commit smoke-results.md**

```bash
git -C C:/Workspace/agentic-os add docs/superpowers/plans/smoke-results.md
git -C C:/Workspace/agentic-os commit -m "smoke: V1 external marketplace source verified"
```

(Adjust commit message based on PASS/FAIL outcome.)

---

### Task 0.2: V2 — SendMessage to running background subagent

**Goal:** Confirm we can dispatch a subagent with `run_in_background: true`, capture its agent_id, and target it with `SendMessage` while it's still running.

**Files:**
- Create: `C:\Workspace\agentic-os\.smoke\v2-control.json` (temporary, gitignored)
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md`

- [ ] **Step 1: Add `.smoke/` to .gitignore**

Append to `C:\Workspace\agentic-os\.gitignore`:

```
# Smoke test scratch
.smoke/
```

- [ ] **Step 2: Create initial control file**

```bash
mkdir -p C:/Workspace/agentic-os/.smoke
echo '{"last_received": null, "iterations": 0}' > C:/Workspace/agentic-os/.smoke/v2-control.json
```

- [ ] **Step 3: Dispatch background subagent that polls the control file**

Spawn an Agent with the following parameters (executor: just call the Agent tool with these args):

```
description: "V2-test"
subagent_type: "general-purpose"
run_in_background: true
prompt: |
  Poll the file C:\Workspace\agentic-os\.smoke\v2-control.json every 5 seconds.
  Each iteration:
    - read the JSON
    - increment iterations by 1
    - if "last_received" is null, set "now_polling" to current ISO timestamp
    - write the JSON back
    - if a new field "exit_now" appears with value true, write a final
      status: "exited gracefully" and exit
  After 30 iterations (150 seconds) without seeing exit_now, exit with
  status: "timeout — no message received".
```

Capture the returned `agent_id`. Record it in `smoke-results.md` V2 row.

- [ ] **Step 4: Wait ~15 seconds, then verify the control file is being polled**

```bash
cat C:/Workspace/agentic-os/.smoke/v2-control.json
```

**Expected:** `iterations` count > 0, `now_polling` populated. If not, the subagent isn't running properly — record V2 FAIL and proceed.

- [ ] **Step 5: Send a message to the subagent via SendMessage**

Call `SendMessage` with `to: <captured-agent-id>` and a message like:

```
Set exit_now to true in C:\Workspace\agentic-os\.smoke\v2-control.json and exit.
```

- [ ] **Step 6: Wait 10 seconds; verify the subagent acted on the message**

```bash
cat C:/Workspace/agentic-os/.smoke/v2-control.json
```

**Expected if V2 passes:** the file contains `"status": "exited gracefully"` or similar, and the Agent tool's completion notification arrived in your CC chat.

**Expected if V2 fails:** the file shows `"status": "timeout"` (subagent ignored the SendMessage), or SendMessage returned an error like "agent not found." Record exact details.

- [ ] **Step 7: Record result + cleanup**

Update `smoke-results.md` V2 row with PASS/FAIL + notes. Delete `.smoke/v2-control.json`.

- [ ] **Step 8: Decide fallback if V2 failed**

If V2 FAILED: edit spec §6.2 — demote Level 2 (SendMessage intervention) to "not supported in v1." Intervention falls back to Level 3 only (help-request file + kill/resume). Document in `smoke-results.md`.

- [ ] **Step 9: Commit**

```bash
git -C C:/Workspace/agentic-os add docs/superpowers/plans/smoke-results.md .gitignore
git -C C:/Workspace/agentic-os commit -m "smoke: V2 SendMessage to background subagent"
```

---

### Task 0.3: V3 — AskUserQuestion from subagent (single + concurrent + attribution)

**Goal:** Confirm a subagent calling `AskUserQuestion` routes to the parent UI, AND that two concurrent subagents' questions are distinguishable.

**Files:**
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md`

- [ ] **Step 1: Spawn first background subagent that immediately AskUserQuestion**

Dispatch Agent:

```
description: "V3-TEST-A"
subagent_type: "general-purpose"
run_in_background: true
prompt: |
  Immediately call AskUserQuestion with this exact question:
    title: "[V3-TEST-A] Which color do you prefer?"
    options: [{label: "Red", description: "..."}, {label: "Blue", description: "..."}]
  Record the user's answer to C:\Workspace\agentic-os\.smoke\v3-a-answer.json.
  Exit.
```

- [ ] **Step 2: Observe what shows up in CC's UI**

**Expected if V3 passes:** the AskUserQuestion appears in the parent's UI showing both the question text AND some indication of the source subagent (e.g., agent label "V3-TEST-A" or similar). Record what attribution looks like.

**Expected if V3 partially passes:** the question shows but with no clear source attribution. The `[V3-TEST-A]` prefix in the question text becomes the only attribution — confirms our belt-and-suspenders design is load-bearing.

**Expected if V3 fails:** the question doesn't reach the parent UI at all, or the subagent errors out trying to call AskUserQuestion.

- [ ] **Step 3: Answer the question**

Click Red or Blue. Note that the answer flows back to subagent A and it exits.

- [ ] **Step 4: Verify the answer file**

```bash
cat C:/Workspace/agentic-os/.smoke/v3-a-answer.json
```

Should contain "Red" or "Blue" matching your click.

- [ ] **Step 5: Now test concurrency — spawn two subagents back-to-back**

Dispatch Agent A:

```
description: "V3-CC-A"
subagent_type: "general-purpose"
run_in_background: true
prompt: |
  Wait 3 seconds, then call AskUserQuestion:
    title: "[V3-CC-A] Pick a number"
    options: [{label: "1"}, {label: "2"}]
  Record to C:\Workspace\agentic-os\.smoke\v3-cc-a-answer.json. Exit.
```

Immediately dispatch Agent B:

```
description: "V3-CC-B"
subagent_type: "general-purpose"
run_in_background: true
prompt: |
  Wait 3 seconds, then call AskUserQuestion:
    title: "[V3-CC-B] Pick a letter"
    options: [{label: "X"}, {label: "Y"}]
  Record to C:\Workspace\agentic-os\.smoke\v3-cc-b-answer.json. Exit.
```

- [ ] **Step 6: Observe what happens when both questions arrive within seconds**

Record in `smoke-results.md`:
- Did both questions appear? Sequentially or simultaneously?
- Could you tell which question came from which subagent?
- Did one question block the other until answered?
- Did either get dropped?

- [ ] **Step 7: Answer both questions and verify files**

```bash
cat C:/Workspace/agentic-os/.smoke/v3-cc-a-answer.json
cat C:/Workspace/agentic-os/.smoke/v3-cc-b-answer.json
```

Each should contain the answer YOU clicked for the corresponding agent. If they're swapped, attribution is broken at the routing layer — that's a serious issue.

- [ ] **Step 8: Record V3 outcome**

Update `smoke-results.md`. Three possible outcomes:
- **Full PASS:** UI attributes source AND concurrent questions handled cleanly. Bracket prefix is belt-and-suspenders only.
- **Partial PASS:** Concurrent questions handled but UI doesn't attribute source clearly. Bracket prefix is load-bearing.
- **FAIL:** Concurrent questions collide or attribution is wrong. Fall back to Level 3 intervention only.

- [ ] **Step 9: Cleanup and commit**

```bash
rm -rf C:/Workspace/agentic-os/.smoke/v3-*.json
git -C C:/Workspace/agentic-os add docs/superpowers/plans/smoke-results.md
git -C C:/Workspace/agentic-os commit -m "smoke: V3 AskUserQuestion from subagent (incl. concurrent)"
```

---

### Task 0.4: V4 — Subagent writes to `~/.claude/agentic-os/`

**Goal:** Confirm subagents can Read/Write to the global personal data dir under default CC permissions. If not, the `/aos-install` permission grant becomes load-bearing.

**Files:**
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md`

- [ ] **Step 1: Ensure target dir exists**

```bash
mkdir -p ~/.claude/agentic-os/tasks/v4-smoke
```

- [ ] **Step 2: Dispatch subagent that writes to the dir**

```
description: "V4-test"
subagent_type: "general-purpose"
run_in_background: false
prompt: |
  Write the literal string "V4 wrote this" to the file
  C:\Users\Robert\.claude\agentic-os\tasks\v4-smoke\hello.txt
  using the Write tool. After writing, read it back with the Read tool
  to confirm. Return a short summary: did the Write succeed without a
  permission prompt? Did the Read succeed?
```

- [ ] **Step 3: Verify**

```bash
cat ~/.claude/agentic-os/tasks/v4-smoke/hello.txt
```

**Expected if V4 passes:** file contains "V4 wrote this" and the subagent's report says no permission prompts.

**Expected if V4 fails:** the file doesn't exist (permission denied or subagent reported a prompt), OR the subagent reports the user had to approve a permission prompt mid-run.

- [ ] **Step 4: Record + cleanup**

Update `smoke-results.md` V4 row. Delete `~/.claude/agentic-os/tasks/v4-smoke/` to leave no smoke residue.

```bash
rm -rf ~/.claude/agentic-os/tasks/v4-smoke
```

- [ ] **Step 5: Decide fallback if V4 failed**

If V4 FAILED with permission prompts: confirm `/aos-install` must pre-grant Write/Edit scoped to `~/.claude/agentic-os/**` in `settings.local.json`. Add an explicit Task 1.x to verify the permission grant works. Note in `smoke-results.md`.

- [ ] **Step 6: Commit**

```bash
git -C C:/Workspace/agentic-os add docs/superpowers/plans/smoke-results.md
git -C C:/Workspace/agentic-os commit -m "smoke: V4 subagent write to ~/.claude/agentic-os/"
```

---

### Task 0.5: V5 — Plugin SessionStart hook fires globally

**Goal:** Confirm a plugin can ship a SessionStart hook that fires in every Claude Code session regardless of cwd. We need this for Flow B's auto-context loading.

This test temporarily creates a stub plugin to test hook behavior, then removes it.

**Files:**
- Create (temporary): `C:\Workspace\claude-plugins\v5-hook-test\.claude-plugin\plugin.json`
- Create (temporary): `C:\Workspace\claude-plugins\v5-hook-test\hooks\session-start.ps1`
- Modify (temporary): `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json`
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md`

- [ ] **Step 1: Create the stub plugin directory**

```bash
mkdir -p C:/Workspace/claude-plugins/v5-hook-test/.claude-plugin
mkdir -p C:/Workspace/claude-plugins/v5-hook-test/hooks
```

- [ ] **Step 2: Write the stub plugin manifest**

Create `C:\Workspace\claude-plugins\v5-hook-test\.claude-plugin\plugin.json`:

```json
{
  "name": "v5-hook-test",
  "description": "Temporary test plugin to verify SessionStart hook firing — do not keep.",
  "version": "0.0.1",
  "author": { "name": "Robert Ghafoor", "email": "" },
  "hooks": {
    "SessionStart": "hooks/session-start.ps1"
  }
}
```

Note: the exact key name (`hooks.SessionStart`, or `SessionStart`, or `session_start`) depends on the CC plugin schema. Try the most likely name first, then adjust based on whether reload accepts the manifest. Record which works.

- [ ] **Step 3: Write the hook script**

Create `C:\Workspace\claude-plugins\v5-hook-test\hooks\session-start.ps1`:

```powershell
# v5 hook smoke test — writes timestamp + cwd to a known file
$marker = "$env:USERPROFILE\.claude\agentic-os\v5-hook-fired.log"
$dir = Split-Path $marker -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$line = "$(Get-Date -Format 'o') | cwd=$(Get-Location)"
Add-Content -Path $marker -Value $line
```

- [ ] **Step 4: Add to marketplace**

Append a plugin entry to `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json`:

```json
{
  "name": "v5-hook-test",
  "description": "Temporary smoke test.",
  "category": "development",
  "source": "./v5-hook-test",
  "author": { "name": "Robert Ghafoor", "email": "" }
}
```

- [ ] **Step 5: Reload, install, and verify**

```
/plugin marketplace reload robert-personal
/plugin install v5-hook-test@robert-personal
```

Then close and reopen Claude Code (or run `/reload-plugins` if available).

- [ ] **Step 6: Verify the hook fired**

```bash
cat ~/.claude/agentic-os/v5-hook-fired.log
```

**Expected if V5 passes:** the log contains one line per CC session restart, with timestamp and cwd. Open CC in a different directory (e.g., `cd C:/Workspace/catella`) and reopen — log should gain another entry with the new cwd.

**Expected if V5 fails:** the log doesn't exist, OR it only appeared when CC was launched from a specific directory. Note the exact pattern.

- [ ] **Step 7: Test from multiple cwds**

Open CC in each of these (one at a time, observing the log between each):
- `C:\Workspace\agentic-os\`
- `C:\Workspace\catella\` (or any client repo)
- `C:\` (root, to test edge cases)

Each session should append a line to `v5-hook-fired.log`.

- [ ] **Step 8: Record + cleanup**

Update `smoke-results.md` V5 row. Then remove the test plugin:

```
/plugin uninstall v5-hook-test
```

Then delete the test plugin directory and remove the marketplace entry:

```bash
rm -rf C:/Workspace/claude-plugins/v5-hook-test
# Edit marketplace.json to remove the v5-hook-test entry
rm ~/.claude/agentic-os/v5-hook-fired.log
```

Reload marketplace:

```
/plugin marketplace reload robert-personal
```

- [ ] **Step 9: Decide fallback if V5 failed**

If V5 FAILED entirely: spec §3 mentions Flow B's auto-loading hook; Flow B's "Claude lands warm in any client repo" becomes manual (user must invoke `/aos-load-context` after starting CC). Update spec §11 step 3 to mark hook as optional with `/aos-load-context` as primary.

If V5 partially fired (e.g., only in specific dirs): document the rule and adapt.

- [ ] **Step 10: Commit**

```bash
git -C C:/Workspace/agentic-os add docs/superpowers/plans/smoke-results.md
git -C C:/Workspace/agentic-os commit -m "smoke: V5 plugin SessionStart hook"
```

---

### Task 0.6: V6 — jira-ticket auto-activates inside subagent + branch dedup

**Goal:** Confirm the jira-ticket plugin auto-triggers inside an Agent-tool subagent's context when the ticket-ID pattern appears in its mission, AND that its branch dedup logic gracefully detects a worktree the orchestrator already created.

**Files:**
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md`

- [ ] **Step 1: Identify a real Jira ticket to use**

Pick a ticket assigned to you that's been worked or is fresh enough that re-touching it is safe. Note the ticket ID (e.g., `COMP-XXX`). Do NOT use a production ticket; pick a low-impact one or create a throwaway "smoke test" ticket if your Jira allows.

Record the chosen ticket ID in `smoke-results.md` V6 row.

- [ ] **Step 2: Pick a client repo and pre-create a detached worktree**

In the matching client repo (e.g., `C:\Workspace\catella` if the ticket is COMP-XXX):

```bash
cd C:/Workspace/catella
git fetch origin
git worktree add --detach C:/Workspace/catella/.worktrees/v6-smoke main
```

This mimics what `/aos-start-ticket` will do in real use.

- [ ] **Step 3: Dispatch subagent with mission referencing the ticket**

```
description: "<TICKET-ID>"
subagent_type: "general-purpose"
isolation: "worktree"   (or whatever the actual parameter is named; check Agent tool docs)
working_directory: "C:\\Workspace\\catella\\.worktrees\\v6-smoke"
run_in_background: false
prompt: |
  Your working directory is a detached git worktree at C:\Workspace\catella\.worktrees\v6-smoke.
  Ticket: <TICKET-ID>.
  Step 1: simply reference the ticket ID (<TICKET-ID>) in your first response.
  Step 2: observe whether the jira-ticket skill auto-triggers and runs its protocol.
  Step 3: report:
    - Did jira-ticket auto-trigger? (yes/no)
    - What branch did jira-ticket end up checking out or creating?
    - Did jira-ticket's Step 2 dedup logic see the detached HEAD as no-conflict?
  Step 4: do NOT proceed past Step 2 of jira-ticket's protocol. Just report the
  observed behavior and exit. We are smoke-testing, not implementing the ticket.
```

- [ ] **Step 4: Read the subagent's report**

The report will say one of:
- jira-ticket auto-triggered and branched cleanly — V6 PASS
- jira-ticket auto-triggered but couldn't handle detached HEAD — V6 PARTIAL
- jira-ticket didn't auto-trigger at all — V6 FAIL (significant)

- [ ] **Step 5: Verify the branch state in the worktree**

```bash
git -C C:/Workspace/catella/.worktrees/v6-smoke branch --show-current
git -C C:/Workspace/catella branch --list "*<TICKET-ID>*"
```

The first command shows what branch the worktree is now on (or empty if still detached). The second shows all branches matching the ticket pattern. Both inform whether jira-ticket's dedup logic worked.

- [ ] **Step 6: Cleanup**

```bash
git -C C:/Workspace/catella worktree remove --force .worktrees/v6-smoke
# If jira-ticket created a branch, delete it to leave no smoke residue:
git -C C:/Workspace/catella branch -D <created-branch-name>   # only if applicable
```

- [ ] **Step 7: Record outcome**

Update `smoke-results.md` V6 row with full detail. This is the most consequential smoke test — if V6 fails, the entire "jira-ticket inside subagent" composition pattern needs rework.

- [ ] **Step 8: Decide fallback if V6 failed**

If V6 FAILED (no auto-trigger): edit spec Appendix A mission template — subagent must explicitly invoke jira-ticket via the skill mechanism (not rely on auto-trigger). Add note that we have to verify the explicit-invocation path works.

If V6 FAILED (jira-ticket auto-triggered but branched wrong): edit spec §3.2 — orchestrator creates the branch itself instead of detached worktree. Revert §5.3 step 4 to the named-branch form.

- [ ] **Step 9: Commit**

```bash
git -C C:/Workspace/agentic-os add docs/superpowers/plans/smoke-results.md
git -C C:/Workspace/agentic-os commit -m "smoke: V6 jira-ticket inside subagent + dedup"
```

---

### Task 0.7: Phase 0 wrap-up — review results, update spec if needed

**Files:**
- Modify: `C:\Workspace\agentic-os\docs\superpowers\specs\2026-05-18-agentic-os-design.md` (only if any V failed)
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md`

- [ ] **Step 1: Read smoke-results.md end-to-end**

Confirm all six rows have a definitive result (PASS / PARTIAL / FAIL) and notes.

- [ ] **Step 2: Apply any spec updates required by FAILs**

For each FAIL, edit the spec to reflect the fallback. Common patches:
- V1 fail → spec §3.1 mentions dedicated marketplace; verify wording is up to date.
- V2 fail → spec §6.2 demote Level 2; intervention is Level 1 + Level 3 only.
- V3 partial → spec §6.2 Level 1 keeps the `[<TICKET-ID>]` prefix requirement (already there) and notes UI attribution is unreliable.
- V4 fail → spec §11 step 2 promotes the permission-grant subtask to a hard requirement.
- V5 fail → spec §11 step 3 marks session-start hook as optional; `/aos-load-context` is the primary entry point.
- V6 fail → spec Appendix A or §5.3 step 4 (see Task 0.6 step 8).

- [ ] **Step 3: Add a "Smoke results applied" entry**

Append to `smoke-results.md`:

```markdown
## Spec updates applied 2026-05-18
- <bullet per spec section touched, citing which V and why>
- (or: "No updates needed — all six tests passed cleanly")
```

- [ ] **Step 4: Commit**

```bash
git -C C:/Workspace/agentic-os add docs/superpowers/
git -C C:/Workspace/agentic-os commit -m "smoke: V1-V6 complete; spec updated to reflect findings"
```

---

## Phase 1 — Foundation (Plugin Scaffold + /aos-install + /aos-identity)

Now we know the platform works as expected (or we know which fallbacks apply). Build the plugin itself.

### Task 1.1: Plugin directory skeleton

**Files:**
- Create: `C:\Workspace\agentic-os\plugin\.claude-plugin\` (directory)
- Create: `C:\Workspace\agentic-os\plugin\skills\` (directory)
- Create: `C:\Workspace\agentic-os\plugin\hooks\` (directory)
- Create: `C:\Workspace\agentic-os\plugin\templates\` (directory)
- Create: `C:\Workspace\agentic-os\plugin\templates\clients\_template\` (directory)

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p C:/Workspace/agentic-os/plugin/.claude-plugin
mkdir -p C:/Workspace/agentic-os/plugin/skills
mkdir -p C:/Workspace/agentic-os/plugin/hooks
mkdir -p C:/Workspace/agentic-os/plugin/templates/clients/_template
mkdir -p C:/Workspace/agentic-os/plugin/templates/learnings
mkdir -p C:/Workspace/agentic-os/plugin/templates/archive
```

- [ ] **Step 2: Verify the tree**

```bash
find C:/Workspace/agentic-os/plugin -type d | sort
```

Expected output (paths normalized):
```
C:/Workspace/agentic-os/plugin
C:/Workspace/agentic-os/plugin/.claude-plugin
C:/Workspace/agentic-os/plugin/hooks
C:/Workspace/agentic-os/plugin/skills
C:/Workspace/agentic-os/plugin/templates
C:/Workspace/agentic-os/plugin/templates/archive
C:/Workspace/agentic-os/plugin/templates/clients
C:/Workspace/agentic-os/plugin/templates/clients/_template
C:/Workspace/agentic-os/plugin/templates/learnings
```

- [ ] **Step 3: Commit**

Empty directories don't commit on their own — add a `.gitkeep` to each empty leaf:

```bash
touch C:/Workspace/agentic-os/plugin/skills/.gitkeep
touch C:/Workspace/agentic-os/plugin/hooks/.gitkeep
touch C:/Workspace/agentic-os/plugin/templates/learnings/.gitkeep
touch C:/Workspace/agentic-os/plugin/templates/archive/.gitkeep
touch C:/Workspace/agentic-os/plugin/templates/clients/_template/.gitkeep

git -C C:/Workspace/agentic-os add plugin/
git -C C:/Workspace/agentic-os commit -m "feat(plugin): scaffold directory tree"
```

---

### Task 1.2: Plugin manifest

**Files:**
- Create: `C:\Workspace\agentic-os\plugin\.claude-plugin\plugin.json`

- [ ] **Step 1: Write the manifest**

Create `C:\Workspace\agentic-os\plugin\.claude-plugin\plugin.json`:

```json
{
  "name": "agentic-os",
  "description": "Personal agentic workflow OS — orchestrates multiple Jira tickets in parallel via per-worktree subagents, with global+client+task memory tiers, live intervention via AskUserQuestion, and a self-improving learnings loop.",
  "version": "0.1.0",
  "author": { "name": "Robert Ghafoor", "email": "" },
  "keywords": ["agentic-os", "workflow", "jira", "orchestrator", "superpowers"]
}
```

Note: do NOT include a `hooks` field yet — we add it in Task 3.x of phase 2 (session-start hook). If V5 failed in phase 0, we skip hooks entirely.

- [ ] **Step 2: Commit**

```bash
git -C C:/Workspace/agentic-os add plugin/.claude-plugin/plugin.json
git -C C:/Workspace/agentic-os commit -m "feat(plugin): add plugin.json manifest"
```

---

### Task 1.3: Plugin README and CLAUDE.md

**Files:**
- Create: `C:\Workspace\agentic-os\plugin\README.md`
- Create: `C:\Workspace\agentic-os\plugin\CLAUDE.md`

- [ ] **Step 1: Write the plugin README**

Create `C:\Workspace\agentic-os\plugin\README.md`:

```markdown
# agentic-os

A personal Claude Code plugin that orchestrates parallel Jira-driven workflows with
multi-tier memory and a self-improving learnings loop.

See the design spec at:
https://github.com/robgha01/agentic-os/blob/main/docs/superpowers/specs/2026-05-18-agentic-os-design.md

## Install

This plugin is registered in the `robert-personal` marketplace.

```
/plugin install agentic-os@robert-personal
/aos-install
```

The first command installs the plugin. The second scaffolds your personal data
directory at `~/.claude/agentic-os/`.

## Commands

| Command | What it does |
|---|---|
| `/aos-install` | First-run setup; scaffolds `~/.claude/agentic-os/`. |
| `/aos-identity` | Interactive interview to build or refine your identity.md. |
| `/aos-load-context` | Load identity + client + learnings into the current conversation. |
| `/aos-tickets` | List Jira tickets assigned to you, grouped by project. |
| `/aos-queue <TICKET>` | Queue a ticket for the orchestrator. |
| `/aos-start-ticket <TICKET>` | Dispatch a subagent to work on a ticket. |
| `/aos-status` | Show in-flight workers + queue. |
| `/aos-intervene <TICKET> <message>` | Send a message to a running subagent. |
| `/aos-park <TICKET>` | Park a submitted subagent for later. |
| `/aos-resume <TICKET>` | Resume a parked or rejected ticket. |
| `/aos-abort <TICKET>` | Kill a running subagent. |
| `/aos-consolidate` | Promote drafts to curated learnings; archive stale rules. |
| `/aos-review-stale-learnings` | Interactive review of old curated rules. |

## Configuration

Edit `~/.claude/agentic-os/config.json` (created by `/aos-install`). See the design
spec §8 for all knobs.
```

- [ ] **Step 2: Write the plugin's CLAUDE.md**

This file is auto-loaded by CC when the plugin is active in a session. Use it for any always-on guidance about the plugin's commands.

Create `C:\Workspace\agentic-os\plugin\CLAUDE.md`:

```markdown
# agentic-os plugin guidance

When the user runs an `aos-` slash command, follow the corresponding skill file
under `plugin/skills/<command-name>/SKILL.md` precisely.

Personal data lives at `~/.claude/agentic-os/`. State files at
`~/.claude/agentic-os/state/`. The plugin reads and writes these locations
(subagents may write to `tasks/` but never to `state/` directly).

If `~/.claude/agentic-os/` does not exist, the user has not run `/aos-install`
yet — prompt them to do so before invoking any other `aos-` command.
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Workspace/agentic-os add plugin/README.md plugin/CLAUDE.md
git -C C:/Workspace/agentic-os commit -m "docs(plugin): add README and CLAUDE.md"
```

---

### Task 1.4: Register the plugin in the robert-personal marketplace

**Files:**
- Modify: `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json`

This is the V1 path. If V1 failed in phase 0, follow the dedicated-marketplace fallback per smoke-results.md instead.

- [ ] **Step 1: Push the agentic-os repo to GitHub**

The marketplace entry references a GitHub repo. The plugin code must be reachable.

```bash
git -C C:/Workspace/agentic-os push -u origin main
```

Verify the repo is accessible at `https://github.com/robgha01/agentic-os` (or the actual remote URL — check with `git remote -v`).

- [ ] **Step 2: Add the plugin entry to the marketplace**

Open `C:\Workspace\claude-plugins\.claude-plugin\marketplace.json`. Add to the `plugins` array (alphabetical by name is conventional):

```json
{
  "name": "agentic-os",
  "description": "Personal agentic workflow OS — orchestrates parallel Jira tickets, memory tiers, self-improving learnings.",
  "category": "productivity",
  "source": { "source": "github", "repo": "robgha01/agentic-os", "path": "plugin" },
  "author": { "name": "Robert Ghafoor", "email": "" }
}
```

The `path: "plugin"` field tells CC to look inside the `plugin/` subdirectory of the repo, not at the repo root.

- [ ] **Step 3: Reload the marketplace**

In CC:

```
/plugin marketplace reload robert-personal
/plugin
```

Verify `agentic-os` appears in the listing.

- [ ] **Step 4: Install the plugin**

```
/plugin install agentic-os@robert-personal
```

- [ ] **Step 5: Verify installation**

```
/plugin
```

Expected: `agentic-os` shows as enabled. The `aos-` slash commands aren't yet defined (no skills written yet), but the plugin should at least register.

- [ ] **Step 6: Commit the marketplace change**

```bash
git -C C:/Workspace/claude-plugins add .claude-plugin/marketplace.json
git -C C:/Workspace/claude-plugins commit -m "feat(marketplace): register agentic-os plugin"
git -C C:/Workspace/claude-plugins push
```

(The marketplace repo is `claude-plugins`, not `agentic-os` — push so other machines can reach the entry.)

---

### Task 1.5: Template files for scaffolding personal data

**Files:**
- Create: `C:\Workspace\agentic-os\plugin\templates\identity.md`
- Create: `C:\Workspace\agentic-os\plugin\templates\learnings.md`
- Create: `C:\Workspace\agentic-os\plugin\templates\learnings.draft.md`
- Create: `C:\Workspace\agentic-os\plugin\templates\config.json`
- Create: `C:\Workspace\agentic-os\plugin\templates\clients\_template\brand.md`
- Create: `C:\Workspace\agentic-os\plugin\templates\clients\_template\workflows.md`
- Create: `C:\Workspace\agentic-os\plugin\templates\clients\_template\repos.md`

These are the files `/aos-install` copies into `~/.claude/agentic-os/` on first run.

- [ ] **Step 1: Write identity.md placeholder**

Create `C:\Workspace\agentic-os\plugin\templates\identity.md`:

```markdown
# Identity

Placeholder. Run `/aos-identity` to populate this file via the 15-question interview
(see design spec Appendix D). Until then, Claude will fall back to whatever is in
your `~/.claude/CLAUDE.md` plus session context.

## Role
<run /aos-identity>

## Communication
<run /aos-identity>

## Code standards
<run /aos-identity>

## Autonomy
<run /aos-identity>

## Never
<run /aos-identity>

## Always
<run /aos-identity>

## Pet peeves
<run /aos-identity>

## Domain
<run /aos-identity>
```

- [ ] **Step 2: Write learnings.md and learnings.draft.md placeholders**

`C:\Workspace\agentic-os\plugin\templates\learnings.md`:

```markdown
# Curated learnings

Cross-project validated rules. Always loaded at session start. Capped at ~150 lines
(enforced by `/aos-consolidate`).

## Conventions
<no entries yet>

## Testing
<no entries yet>

## Communication
<no entries yet>
```

`C:\Workspace\agentic-os\plugin\templates\learnings.draft.md`:

```markdown
# Draft learnings

Raw, append-only captures. Fuel for `/aos-consolidate`. Never auto-loaded.

<no entries yet>
```

- [ ] **Step 3: Write config.json with all defaults from spec §8**

`C:\Workspace\agentic-os\plugin\templates\config.json`:

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
    "stale_review_days": 90,
    "consolidate_mode": "auto-non-interactive",
    "auto_consolidate_suggest_drafts": 10,
    "auto_consolidate_suggest_at_cap_percent": 95
  },
  "intervention": {
    "watchdog_inactivity_minutes": 15,
    "subagent_total_runtime_max_minutes": 60
  },
  "ship": {
    "create_pr_after_approval": false
  },
  "experimental": {
    "phase_2_web_ui": false,
    "itwillsync_notify_on_help": false
  }
}
```

- [ ] **Step 4: Write client template files**

`C:\Workspace\agentic-os\plugin\templates\clients\_template\brand.md`:

```markdown
# <Client Name> — Brand

Replace this template with real content for the client.

## Voice
- Tone:
- Reading level:
- Words to avoid:
- Words to favor:

## Positioning
- Who they are:
- Who their customers are:
- What makes them different:

## Visual / format conventions
- e.g., capitalization rules, hyphenation, oxford comma policy
```

`C:\Workspace\agentic-os\plugin\templates\clients\_template\workflows.md`:

```markdown
# <Client Name> — Workflows

## Jira
- Project keys: e.g., COMP
- Default ticket type prefix mapping handled by jira-ticket

## Branching
- Ship strategy (drives ship-branch): rebase+merge | squash | direct-merge | none

## Review
- PR review conventions:
- Approval requirements:
```

`C:\Workspace\agentic-os\plugin\templates\clients\_template\repos.md`:

```markdown
# <Client Name> — Repos

The session-start hook (and `/aos-load-context`) read this table to resolve
`cwd` → client.

| Workspace path | Project | Ship strategy | Notes |
|---|---|---|---|
| C:\Workspace\<repo-folder> | <project-name> | rebase+merge | <e.g., Next.js, frontend only> |
```

- [ ] **Step 5: Commit**

```bash
git -C C:/Workspace/agentic-os add plugin/templates/
git -C C:/Workspace/agentic-os commit -m "feat(plugin): templates for /aos-install scaffold"
```

---

### Task 1.6: `/aos-install` skill

**Files:**
- Create: `C:\Workspace\agentic-os\plugin\skills\aos-install\SKILL.md`

- [ ] **Step 1: Write the skill file**

Create `C:\Workspace\agentic-os\plugin\skills\aos-install\SKILL.md`:

```markdown
---
name: aos-install
description: First-run scaffolding for the agentic-os plugin. Creates ~/.claude/agentic-os/ from plugin templates and pre-grants Write permission scoped to that path. Idempotent — running it twice never overwrites existing personal data.
argument-hint: (none)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# /aos-install — agentic-os first-run setup

**Announce at start:** "Running /aos-install — scaffolding ~/.claude/agentic-os/."

## Step 1 — Check current state

Use the Bash tool to determine whether `~/.claude/agentic-os/` already exists:

```bash
test -d "$HOME/.claude/agentic-os" && echo "EXISTS" || echo "MISSING"
```

If the output is `EXISTS`, list the directory and report what's already there:

```bash
ls -la "$HOME/.claude/agentic-os"
```

Then say: "agentic-os is already installed. Run `/aos-identity` if you haven't populated identity.md yet. Stopping." and exit. **Do not overwrite anything.**

If the output is `MISSING`, continue to Step 2.

## Step 2 — Create the directory tree

```bash
mkdir -p "$HOME/.claude/agentic-os"
mkdir -p "$HOME/.claude/agentic-os/clients"
mkdir -p "$HOME/.claude/agentic-os/learnings"
mkdir -p "$HOME/.claude/agentic-os/archive"
mkdir -p "$HOME/.claude/agentic-os/tasks"
mkdir -p "$HOME/.claude/agentic-os/tasks/_archive"
mkdir -p "$HOME/.claude/agentic-os/state"
```

## Step 3 — Copy templates

The plugin's templates live alongside this skill. The exact path depends on where CC installs plugins, but a reliable lookup is the plugin's own directory relative to this skill file. Use the Bash tool to find the plugin root and copy each template.

```bash
# Find plugin root — three levels up from this skill (skills/aos-install/SKILL.md → plugin/)
PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Fallback if the above doesn't work — search by manifest:
[ -z "$PLUGIN_ROOT" ] && PLUGIN_ROOT="$(find "$HOME/.claude/plugins" -name plugin.json -path "*agentic-os*" -exec dirname {} \; | head -1 | xargs dirname)"

cp "$PLUGIN_ROOT/templates/identity.md"        "$HOME/.claude/agentic-os/identity.md"
cp "$PLUGIN_ROOT/templates/learnings.md"       "$HOME/.claude/agentic-os/learnings.md"
cp "$PLUGIN_ROOT/templates/learnings.draft.md" "$HOME/.claude/agentic-os/learnings.draft.md"
cp "$PLUGIN_ROOT/templates/config.json"        "$HOME/.claude/agentic-os/config.json"
cp -r "$PLUGIN_ROOT/templates/clients/_template" "$HOME/.claude/agentic-os/clients/_template"
```

If `$PLUGIN_ROOT` cannot be resolved, abort with a clear error message asking the user to report it.

## Step 4 — Initialize empty state files

```bash
echo '{"ports": {}, "range": [3001, 3099]}' > "$HOME/.claude/agentic-os/state/ports.json"
echo '{"queue": []}' > "$HOME/.claude/agentic-os/state/queue.json"
echo '{"in_flight": [], "recent": []}' > "$HOME/.claude/agentic-os/state/in-flight.json"
echo '{"qa_backend": null}' > "$HOME/.claude/agentic-os/state/locks.json"
echo '{"last_review": null}' > "$HOME/.claude/agentic-os/state/last_stale_review.json"
```

## Step 5 — Pre-grant Write/Edit permission

If smoke test V4 confirmed default permissions work, skip this step. Otherwise, add an explicit permission rule:

Use the Edit tool to modify `~/.claude/settings.local.json` (create if it doesn't exist). Add to the `permissions.allow` array:

```
"Write(//$HOME/.claude/agentic-os/**)",
"Edit(//$HOME/.claude/agentic-os/**)"
```

(Adjust syntax based on what CC actually accepts — verify with a permission test on first install.)

## Step 6 — Verify

```bash
ls -la "$HOME/.claude/agentic-os"
cat "$HOME/.claude/agentic-os/config.json" | head -3
```

Expected: directory listing shows identity.md, learnings.md, learnings.draft.md, config.json, plus subdirs clients/, learnings/, archive/, tasks/, state/. Config preview shows the JSON header.

## Step 7 — Final message

Tell the user:

```
agentic-os installed at ~/.claude/agentic-os/.

Next step: run /aos-identity to build your identity.md via the 15-question
interview. Without this, agentic-os will fall back to ~/.claude/CLAUDE.md
for identity context.
```
```

- [ ] **Step 2: Commit**

```bash
git -C C:/Workspace/agentic-os add plugin/skills/aos-install/
git -C C:/Workspace/agentic-os commit -m "feat(skill): /aos-install scaffolds personal data dir"
```

---

### Task 1.7: Verify `/aos-install` on a fresh state

**Files:**
- (Test only — no new files)

- [ ] **Step 1: Ensure personal data dir does not already exist**

If `~/.claude/agentic-os/` exists from manual testing, move it aside:

```bash
[ -d "$HOME/.claude/agentic-os" ] && mv "$HOME/.claude/agentic-os" "$HOME/.claude/agentic-os.bak.$(date +%s)"
```

- [ ] **Step 2: Pull the latest plugin (since we pushed in Task 1.4)**

```
/plugin update agentic-os
```

(Or uninstall and reinstall if update isn't available.)

- [ ] **Step 3: Run `/aos-install`**

In CC:

```
/aos-install
```

- [ ] **Step 4: Verify file presence**

```bash
ls -la ~/.claude/agentic-os/
cat ~/.claude/agentic-os/config.json
cat ~/.claude/agentic-os/identity.md | head -10
cat ~/.claude/agentic-os/state/ports.json
```

Expected: all template files copied; state files initialized as empty JSON; identity.md is the placeholder template.

- [ ] **Step 5: Restore any moved data**

If you backed up an existing personal data dir in Step 1, restore it now (only after verifying install worked):

```bash
# Confirm install worked, then optionally:
# rm -rf "$HOME/.claude/agentic-os"
# mv "$HOME/.claude/agentic-os.bak.<timestamp>" "$HOME/.claude/agentic-os"
```

Or keep the fresh install and discard the backup.

---

### Task 1.8: Verify `/aos-install` is idempotent

**Files:**
- (Test only)

- [ ] **Step 1: Modify a file to detect overwrite**

```bash
echo "test marker - do not overwrite" >> ~/.claude/agentic-os/identity.md
```

- [ ] **Step 2: Re-run `/aos-install`**

In CC:

```
/aos-install
```

Expected output: "agentic-os is already installed. ... Stopping." No file modification happens.

- [ ] **Step 3: Confirm the marker still exists**

```bash
tail -1 ~/.claude/agentic-os/identity.md
```

Expected: `test marker - do not overwrite`.

- [ ] **Step 4: Remove the test marker**

Use Edit to remove the test marker line from `~/.claude/agentic-os/identity.md`.

- [ ] **Step 5: Commit anything that changed in the skill during testing**

If you iterated on the skill SKILL.md to make this pass, commit those fixes:

```bash
git -C C:/Workspace/agentic-os add plugin/skills/aos-install/SKILL.md
git -C C:/Workspace/agentic-os commit -m "fix(skill): /aos-install idempotency check"
```

---

### Task 1.9: `/aos-identity` skill — build mode

**Files:**
- Create: `C:\Workspace\agentic-os\plugin\skills\aos-identity\SKILL.md`

- [ ] **Step 1: Write the skill file**

Create `C:\Workspace\agentic-os\plugin\skills\aos-identity\SKILL.md`:

```markdown
---
name: aos-identity
description: Build or refine the user's identity.md via a 15-question interview. Mode auto-detected. Build mode covers all 15 questions when identity.md is the placeholder template. Refine mode asks 5-8 targeted gap questions when identity.md already has real content. Synthesizes answers into the canonical identity.md structure (see design spec Appendix D).
argument-hint: (none)
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
  - Bash
---

# /aos-identity — interview-driven identity.md

**Announce at start:** "Running /aos-identity — building your personal identity file via interview."

## Step 1 — Detect mode

Read `~/.claude/agentic-os/identity.md`. If the file doesn't exist, ask the user to run `/aos-install` first, then stop.

Check whether the file is the placeholder (contains the string `<run /aos-identity>`) or has real content. The placeholder check:

```bash
grep -q "<run /aos-identity>" "$HOME/.claude/agentic-os/identity.md" && echo "BUILD" || echo "REFINE"
```

- `BUILD` → proceed to Step 2 (full 15 questions).
- `REFINE` → skip to Step 4 (gap analysis).

## Step 2 — Build mode: ask the 15 questions

Ask the questions one at a time using `AskUserQuestion`. The exact contracts are in design spec Appendix D. Reproduce them faithfully here.

For brevity in this skill file, the questions are listed below as a contract. Implement them by calling AskUserQuestion once per question, using the indicated format. Record each answer in memory (in your conversation state) before moving on.

### Q1 — Role
Multi-choice + Other:
- Web dev for clients
- Product engineering
- SRE / DevOps
- Both / mixed
- Other

### Q2 — Activity mix
Multi-choice:
- Mostly building
- Mostly debugging
- Mostly reviewing
- Even mix

### Q3 — Response length preference
Multi-choice:
- Terse
- Balanced
- Detailed

### Q4 — Pre-action explanations
Multi-choice:
- Explain what you're about to do, then do it
- Just do it
- Case-by-case

### Q5 — End-of-turn summaries
Multi-choice:
- Always summarize
- Only when substantive
- Never — I can read the diff

### Q6 — Comment policy
Multi-choice:
- None unless non-obvious
- Explain intent (comments document the why)
- Heavy docs (comments are part of the deliverable)

### Q7 — Testing philosophy
Multi-choice:
- TDD (test first, then implementation)
- Tests after implementation
- Case-by-case
- Skip for prototypes; rigor for production

### Q8 — Refactor tolerance
Multi-choice:
- Aggressive (clean up nearby smells as I go)
- Minimal (touch only what the ticket says)
- Case-by-case

### Q9 — When Claude is uncertain
Multi-choice:
- Ask first
- Pick a default and proceed (surface the choice)
- Pick and just continue (no surfacing)

### Q10 — Destructive operations
Multi-choice:
- Always confirm
- Confirm only for shared-state operations (push, deploy)
- Autonomous

### Q11 — Multi-step tasks
Multi-choice:
- Lay out a plan first
- Start working immediately
- Case-by-case

### Q12 — Things Claude should NEVER do
Free text. Open-ended. User can list 1-3 items.

### Q13 — Things Claude should ALWAYS do
Free text. 1-3 items.

### Q14 — Pet peeves about generic AI output
Free text.

### Q15 — Expertise / stack assumed
Free text — language, frameworks, years, niches.

## Step 3 — Synthesize identity.md from answers

After all 15 are collected, write the file to `~/.claude/agentic-os/identity.md` using this exact structure:

```markdown
# Identity — <user's name from ~/.claude/CLAUDE.md or git config user.name>

## Role
You are a <Q1>, primarily <Q2>.

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
<Q12 formatted as bullets>

## Always
<Q13 formatted as bullets>

## Pet peeves
<Q14 formatted as prose if one item, bullets if multiple>

## Domain
<Q15 as prose>
```

Use the Write tool. Confirm to the user:

```
identity.md written to ~/.claude/agentic-os/identity.md.

Next: session-start context will now include this file. Run /aos-load-context
in any conversation to load it on demand.
```

Then stop. Do NOT proceed to refine mode in the same run.

## Step 4 — Refine mode: gap analysis (when identity.md has real content)

Read the existing `identity.md`. Then read up to 30 lines of recent observations from claude-mem if available, plus any entries in `learnings.draft.md`.

Identify 5-8 questions that target:
- Sections of identity.md that are vague or could be misread
- Behaviors observed in claude-mem that contradict identity.md
- New dimensions (tools, clients, conventions) that emerged since identity.md was written and aren't reflected

Ask those questions via `AskUserQuestion`. For each answer that changes the file, write a proposed diff using the Edit tool with a clear before/after, and ask the user to confirm via another `AskUserQuestion`:

- "Apply this change?" options: Apply / Skip / Modify text and re-ask

Only after explicit approval, Edit the file. Never write changes silently.

After all proposed changes are resolved, append a stamped note to `learnings.draft.md`:

```
- <YYYY-MM-DD> identity.md refined; N changes applied (touched: <section names>)
```

Confirm to the user and stop.
```

- [ ] **Step 2: Commit**

```bash
git -C C:/Workspace/agentic-os add plugin/skills/aos-identity/
git -C C:/Workspace/agentic-os commit -m "feat(skill): /aos-identity build + refine modes"
```

---

### Task 1.10: Verify `/aos-identity` build mode end-to-end

**Files:**
- (Test only)

- [ ] **Step 1: Confirm identity.md is the placeholder**

```bash
grep -q "<run /aos-identity>" ~/.claude/agentic-os/identity.md && echo "PLACEHOLDER" || echo "REAL CONTENT"
```

If it shows `REAL CONTENT`, your identity.md has been customized — back it up before testing:

```bash
cp ~/.claude/agentic-os/identity.md ~/.claude/agentic-os/identity.md.bak
# Then restore the placeholder for testing:
cp C:/Workspace/agentic-os/plugin/templates/identity.md ~/.claude/agentic-os/identity.md
```

- [ ] **Step 2: Update plugin install if you changed the skill since last install**

```
/plugin update agentic-os
```

- [ ] **Step 3: Run `/aos-identity`**

In CC:

```
/aos-identity
```

- [ ] **Step 4: Answer all 15 questions honestly**

Take the interview. The questions should appear as 15 separate `AskUserQuestion` calls (Q1 through Q15). Each multi-choice has its options; the four free-text questions (Q12-Q15) allow "Other" with text entry.

- [ ] **Step 5: Verify identity.md was written**

```bash
cat ~/.claude/agentic-os/identity.md
```

Expected: file follows the exact structure from the skill (Role / Communication / Code standards / Autonomy / Never / Always / Pet peeves / Domain), populated with your actual answers, no `<run /aos-identity>` placeholders remaining.

- [ ] **Step 6: If something is wrong, fix the skill and re-test**

Common issues:
- Question wording is confusing → edit Q text in skill
- Synthesis template puts answers in wrong sections → fix Step 3 of skill
- Free-text answers come back malformed → adjust formatting rules

If you fix anything, commit and re-test:

```bash
git -C C:/Workspace/agentic-os add plugin/skills/aos-identity/SKILL.md
git -C C:/Workspace/agentic-os commit -m "fix(skill): aos-identity build mode <what>"
/plugin update agentic-os
```

Then re-restore the placeholder identity.md and re-run the test.

- [ ] **Step 7: Restore your backup or keep the new identity.md**

If your real identity.md was the template before testing, the new one IS your real one — keep it. If you backed one up in Step 1, decide whether to merge.

---

### Task 1.11: Verify `/aos-identity` refine mode

**Files:**
- (Test only)

- [ ] **Step 1: Make a small intentional gap in identity.md**

Replace a section of `~/.claude/agentic-os/identity.md` with vague text. For example:

```markdown
## Autonomy
- When uncertain: depends
- Destructive operations: depends
- Multi-step tasks: depends
```

Save the file.

- [ ] **Step 2: Add a "contradiction" to learnings.draft.md**

```bash
echo '- I told Claude not to ask me about trivial design choices anymore' >> ~/.claude/agentic-os/learnings.draft.md
```

- [ ] **Step 3: Run `/aos-identity` (it should detect REFINE mode)**

```
/aos-identity
```

Expected: the skill detects identity.md has real content (not placeholder), skips to Step 4 (gap analysis), asks 5-8 targeted questions including at least one about the vague "Autonomy" section.

- [ ] **Step 4: Answer questions; verify diffs are shown before write**

For each refinement, expected behavior: skill shows the proposed before/after and asks "Apply this change?" via AskUserQuestion. Approve some; reject others.

- [ ] **Step 5: Verify file was updated only for approved changes**

```bash
grep -A 4 "## Autonomy" ~/.claude/agentic-os/identity.md
tail -3 ~/.claude/agentic-os/learnings.draft.md
```

Expected: the Autonomy section is no longer "depends, depends, depends" if you approved fixes; learnings.draft.md has a new stamped line noting the refinement.

- [ ] **Step 6: Fix the skill if behavior diverged; commit and update**

```bash
git -C C:/Workspace/agentic-os add plugin/skills/aos-identity/SKILL.md
git -C C:/Workspace/agentic-os commit -m "fix(skill): aos-identity refine mode <what>"
```

---

### Task 1.12: Phase 1 wrap-up

**Files:**
- Modify: `C:\Workspace\agentic-os\docs\superpowers\plans\smoke-results.md` (append phase-1 status)
- Modify: `C:\Workspace\agentic-os\README.md` (the top-level repo README)

- [ ] **Step 1: Add phase 1 completion section to smoke-results.md**

Append:

```markdown
## Phase 1 — Foundation completed YYYY-MM-DD

- [x] Plugin scaffolded at C:\Workspace\agentic-os\plugin\
- [x] Registered in robert-personal marketplace
- [x] /aos-install verified (clean install + idempotency)
- [x] /aos-identity verified (build mode + refine mode)

Personal data tree: ~/.claude/agentic-os/ (see directory listing in commit history)

Ready for Phase 2: /aos-load-context + session-start hook + state files +
read-only orchestrator surface (/aos-tickets, /aos-queue, /aos-status).
```

- [ ] **Step 2: Update repo README**

Replace `C:\Workspace\agentic-os\README.md`'s contents (currently `# agentic-os`) with a short intro:

```markdown
# agentic-os

Personal agentic workflow OS for Claude Code. Orchestrates parallel Jira-driven
ticket work via per-worktree subagents, with a multi-tier memory system and a
self-improving learnings loop.

## Status

- ✓ Phase 0: Smoke tests V1–V6 (see `docs/superpowers/plans/smoke-results.md`)
- ✓ Phase 1: Plugin scaffold, `/aos-install`, `/aos-identity`
- ☐ Phase 2: Context loading + read-only orchestrator
- ☐ Phase 3: Full ticket lifecycle (`/aos-start-ticket`)
- ☐ Phase 4+: Intervention, consolidation, polish

## Install

```
/plugin install agentic-os@robert-personal
/aos-install
/aos-identity
```

## Design

See `docs/superpowers/specs/2026-05-18-agentic-os-design.md` for the full design
spec. See `docs/superpowers/plans/` for implementation plans.
```

- [ ] **Step 3: Commit phase 1 wrap-up**

```bash
git -C C:/Workspace/agentic-os add README.md docs/superpowers/plans/smoke-results.md
git -C C:/Workspace/agentic-os commit -m "chore: phase 1 complete; update README and smoke results"
git -C C:/Workspace/agentic-os push
```

- [ ] **Step 4: Tag the milestone**

```bash
git -C C:/Workspace/agentic-os tag -a v0.1.0-phase-1 -m "Phase 1 foundation: install + identity"
git -C C:/Workspace/agentic-os push --tags
```

- [ ] **Step 5: Confirm to user**

```
Phase 0 + 1 complete. Plugin is installable, personal data tree is scaffolded,
identity.md is real. Ready for Phase 2 — context loading and read-only
orchestrator surface. Run /gsd-plan-phase or invoke writing-plans manually
when ready to plan Phase 2.
```

---

## Self-review of this plan

Before handoff, run through:

1. **Spec coverage:** every spec §10 verification item has a task (V1–V6 → 0.1–0.6, plus 0.7 wrap-up). Build steps 1, 2, 2.5 from spec §11 have tasks 1.1–1.4 (scaffold), 1.5–1.8 (install), 1.9–1.11 (identity). Phase 1 wrap-up is 1.12.
2. **Placeholders:** none. Every step has the actual content or exact command.
3. **Type consistency:** file paths use `C:/Workspace/agentic-os/` and `~/.claude/agentic-os/` consistently. Plugin path is `C:\Workspace\agentic-os\plugin\`. Personal data is `~/.claude/agentic-os/`. State files are at `state/`. Skill names use the `aos-` prefix consistently.
4. **Scope:** ends at the milestone "you can install and personalize, but cannot yet orchestrate tickets." That's the right place to break — phase 2 wants its own plan informed by what we learn here.
