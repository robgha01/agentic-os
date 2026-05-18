# Smoke Test Results — Phase 0

Each row records what happened when we ran the test in spec §10.

| ID | Assumption | Result | Notes / Error text |
|----|-----------|--------|--------------------|
| V1 | External marketplace source supported | PASS (by docs reference) | Anthropic's official marketplace at anthropics/claude-plugins-official uses all 5 source shapes including `git-subdir`, `github`, `url`, `git` in production. No need for live test. Spec §3.1 corrected to use `git-subdir` (not `github`) for our plugin-in-subdir case. |
| V2 | SendMessage to running background subagent | TBD | |
| V3 | AskUserQuestion from subagent (with attribution) | TBD | |
| V4 | Subagent writes to ~/.claude/agentic-os/ | TBD | |
| V5 | Plugin SessionStart hook fires globally | TBD | |
| V6 | jira-ticket auto-activates inside subagent | TBD | |

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
