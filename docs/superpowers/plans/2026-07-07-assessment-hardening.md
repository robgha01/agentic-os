# Assessment Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-07-07 project assessment: add a test foundation, extract the duplicated spawn-collect logic (fixing the missing skill timeout), harden the WS/HTTP boundary, sanitize rendered markdown, move the Outlook refresh token into the secret store, unify the fetch-* handlers, fix HUD correctness/perf papercuts, and clean up docs/manifest drift.

**Architecture:** Work happens on branch `fix/assessment-hardening`. Tests come first (vitest at the monorepo root), then a shared `runProcess` utility replaces the four copy-pasted spawn blocks, then zod schemas in `@aos/shared` validate both directions of the wire, then targeted fixes land per subsystem. Each task compiles, tests green, and commits independently.

**Tech Stack:** TypeScript strict ESM (`moduleResolution: Bundler`, `.js` import suffixes), npm workspaces (`@aos/gateway`, `@aos/hud`, `@aos/shared`), zod 3, vitest (new), dompurify (new, HUD), FastAPI sidecar (Python, one-line fix).

## Global Constraints

- Branch: all work on `fix/assessment-hardening`; commit per task; do NOT push unless asked.
- Commit trailer (project CLAUDE.md): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Verify before claiming done: `npm run typecheck -w @aos/gateway`, `npm run build -w @aos/hud`, and (once Task 1 lands) `npm test` must all pass at the end of every task.
- Imports between files use the `.js` suffix for `.ts` sources (existing idiom). Match surrounding comment density/style.
- Model ids come from `config`, never hardcoded (untouched by this plan, but don't regress it).
- No behavior change to the two-model-path rule (router brain vs skill execution).
- Windows dev machine: `claude` resolves via `claude.cmd`, so `shell: true` must be PRESERVED at the two claude-headless spawn sites.

## Explicit non-goals (assessed, deliberately excluded)

- HUD re-render firehose (context-selector refactor): real but invasive; localhost HUD with 6 widgets — defer until measured.
- Zod validation of HUD HTTP *responses* (`/config` etc.): server is same-app and gets hardened in Task 5; WS frames DO get validated (Task 6).
- `ship-ticket` gets NO `produces` block: it is an action skill (shipping must always run), not a document-fetch skill — freshness-exemption is correct. Only its `vaultOutput` folder is fixed.
- Exact-pinning Python sidecar deps: needs the user's working env to freeze from; noted in docs task instead.
- `skill-instances` proposal, gmail/imap providers, schedule widget: features, not fixes.

---

### Task 1: Vitest foundation + first pure-function tests

**Files:**
- Modify: `package.json` (root — devDependency + `test` script)
- Create: `vitest.config.ts` (root)
- Create: `services/gateway/test/vault-freshness.test.ts`
- Create: `services/gateway/test/render-template.test.ts`

**Interfaces:**
- Consumes: `isStale(updatedIso, staleAfterMinutes, nowMs)` from `services/gateway/src/memory/vault-adapter.ts:186`; `renderTemplate(template, params)` from `services/gateway/src/skills/skill-runtime.ts:25`.
- Produces: `npm test` (root) runs vitest across `services/gateway/test`, `packages/shared/test`, `config/test`. Later tasks add test files to those dirs.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b fix/assessment-hardening
```

- [ ] **Step 2: Install vitest at the root and add the script**

```bash
npm install -D vitest
```

In root `package.json` scripts, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts` at the repo root**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "services/gateway/test/**/*.test.ts",
      "packages/shared/test/**/*.test.ts",
      "config/test/**/*.test.ts",
    ],
  },
});
```

(If `@aos/shared` imports fail to resolve inside tests, add `test.server.deps.inline: [/@aos\/shared/]` — workspace-linked TS packages are normally transformed automatically.)

- [ ] **Step 4: Write the failing tests**

`services/gateway/test/vault-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isStale } from "../src/memory/vault-adapter.js";

const T0 = Date.parse("2026-07-07T10:00:00Z");

describe("isStale", () => {
  it("is fresh inside the window", () => {
    expect(isStale("2026-07-07T09:30:00Z", 60, T0)).toBe(false);
  });
  it("is stale past the window", () => {
    expect(isStale("2026-07-07T08:00:00Z", 60, T0)).toBe(true);
  });
  it("never goes stale without a window", () => {
    expect(isStale("2000-01-01T00:00:00Z", undefined, T0)).toBe(false);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(isStale("not-a-date", 60, T0)).toBe(true);
  });
});
```

`services/gateway/test/render-template.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/skills/skill-runtime.js";

describe("renderTemplate", () => {
  it("fills {{param}} placeholders", () => {
    expect(renderTemplate("ship {{ticketId}} now", { ticketId: "SCA-431" })).toBe("ship SCA-431 now");
  });
  it("renders missing/null params as empty", () => {
    expect(renderTemplate("a {{x}} b {{y}}", { y: null })).toBe("a  b ");
  });
  it("stringifies non-string params", () => {
    expect(renderTemplate("n={{n}}", { n: 3 })).toBe("n=3");
  });
});
```

- [ ] **Step 5: Run tests, expect PASS** (the functions already exist — this validates the harness end-to-end)

Run: `npm test`
Expected: 2 files, 7 tests pass. If module resolution fails, apply the `deps.inline` note from Step 3.

- [ ] **Step 6: Typecheck still green**

Run: `npm run typecheck -w @aos/gateway`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts services/gateway/test
git commit -m "test: vitest foundation + first pure-function tests (isStale, renderTemplate)"
```

---

### Task 2: Extract pure research utils (stripVtt, splitTags, dedupeRank) + tests

**Files:**
- Create: `services/gateway/src/skills/research-utils.ts`
- Modify: `services/gateway/src/skills/native-registry.ts` (delete local copies at :99-151, import instead; replace the 3 dedupe blocks at :451-453, :507-509, :645-647)
- Create: `services/gateway/test/research-utils.test.ts`

**Interfaces:**
- Produces (later tasks import these from `./research-utils.js`):
  - `interface ResearchItem { title: string; url: string; score: number; author: string; source: string; excerpt?: string }`
  - `stripVtt(vtt: string): string`
  - `splitTags(text: string): { body: string; tags: string[] }`
  - `dedupeRank(items: ResearchItem[], limit?: number): ResearchItem[]`

- [ ] **Step 1: Write the failing test** — `services/gateway/test/research-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dedupeRank, splitTags, stripVtt, type ResearchItem } from "../src/skills/research-utils.js";

const item = (url: string, score: number): ResearchItem => ({
  title: url, url, score, author: "a", source: "s",
});

describe("dedupeRank", () => {
  it("keeps the highest-scored duplicate and sorts descending", () => {
    const out = dedupeRank([item("u1", 5), item("u2", 9), item("u1", 7)]);
    expect(out.map((i) => [i.url, i.score])).toEqual([["u2", 9], ["u1", 7]]);
  });
  it("applies the limit after ranking", () => {
    expect(dedupeRank([item("a", 1), item("b", 3), item("c", 2)], 2).map((i) => i.url)).toEqual(["b", "c"]);
  });
});

describe("splitTags", () => {
  it("splits a trailing TAGS line into kebab tags", () => {
    const { body, tags } = splitTags("Insight.\nTAGS: LLM Ops, agents, Model  Routing");
    expect(body).toBe("Insight.");
    expect(tags).toEqual(["llm-ops", "agents", "model-routing"]);
  });
  it("returns the body untouched when no TAGS line exists", () => {
    expect(splitTags("just text")).toEqual({ body: "just text", tags: [] });
  });
  it("caps at 6 tags", () => {
    expect(splitTags("x\nTAGS: a,b,c,d,e,f,g,h").tags).toHaveLength(6);
  });
});

describe("stripVtt", () => {
  it("strips headers, cues, inline tags, and consecutive duplicates", () => {
    const vtt = [
      "WEBVTT", "Kind: captions", "",
      "1", "00:00:00.000 --> 00:00:02.000", "Hello <b>world</b>",
      "2", "00:00:02.000 --> 00:00:04.000", "Hello world", "next line",
    ].join("\n");
    expect(stripVtt(vtt)).toBe("Hello world next line");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- research-utils`
Expected: FAIL — cannot resolve `../src/skills/research-utils.js`.

- [ ] **Step 3: Create `services/gateway/src/skills/research-utils.ts`** — move the code verbatim from native-registry (interface at :99-107, `stripVtt` :110-125, `splitTags` :134-143) and add `dedupeRank`:

```ts
/**
 * Pure helpers for the research pipeline — no config or I/O imports, so they
 * are directly unit-testable.
 */

export interface ResearchItem {
  title: string;
  url: string;
  score: number;
  author: string;
  source: string;
  /** Optional extracted text (e.g. a YouTube transcript) folded into synthesis. */
  excerpt?: string;
}

/** Strip a WEBVTT caption file to plain sequential text (no timestamps/tags/dupes). */
export function stripVtt(vtt: string): string {
  // ... (moved verbatim from native-registry.ts:110-125)
}

/**
 * Split a trailing "TAGS: a, b, c" line off an LLM response, returning the body
 * without it plus up to 6 kebab-case tags.
 */
export function splitTags(text: string): { body: string; tags: string[] } {
  // ... (moved verbatim from native-registry.ts:134-143)
}

/** Dedupe by url (highest score wins), rank by score descending, optionally cap. */
export function dedupeRank(items: ResearchItem[], limit?: number): ResearchItem[] {
  const byUrl = new Map<string, ResearchItem>();
  for (const it of items) {
    const prev = byUrl.get(it.url);
    if (!prev || prev.score < it.score) byUrl.set(it.url, it);
  }
  const ranked = [...byUrl.values()].sort((a, b) => b.score - a.score);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}
```

- [ ] **Step 4: Rewire `native-registry.ts`**
  - Delete the local `ResearchItem`, `stripVtt`, `splitTags` definitions; add `import { dedupeRank, splitTags, stripVtt, type ResearchItem } from "./research-utils.js";`
  - `synthesizeResearch` (:451-453): replace the 3-line dedupe block with `const ranked = dedupeRank(items, 25);`
  - `compileResearch` (:507-509): replace with `const items = dedupeRank(all);`
  - `aiWire` (:645-647): replace with `const ranked = dedupeRank(items, 25);`

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npm run typecheck -w @aos/gateway`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/skills/research-utils.ts services/gateway/src/skills/native-registry.ts services/gateway/test/research-utils.test.ts
git commit -m "refactor(skills): extract pure research utils + dedupeRank, with tests"
```

---

### Task 3: Shared `runProcess` with timeout; refactor all 4 spawn sites

The reliability fix: `skill-runtime.spawnCollect` is the only spawn site with NO timeout — a hung `claude -p` permanently occupies a scheduler slot.

**Files:**
- Create: `services/gateway/src/util/run-process.ts`
- Create: `services/gateway/test/run-process.test.ts`
- Modify: `packages/shared/src/skill.ts:19-44` (add optional `timeoutMs` to `claude-headless` and `process` execution variants)
- Modify: `services/gateway/src/skills/skill-runtime.ts:126-154` (replace `spawnCollect` body; pass exec timeout)
- Modify: `services/gateway/src/llm/llm-service.ts:60-92` (`ClaudeHeadlessLlm.complete`)
- Modify: `services/gateway/src/routing/semantic/providers/claude-headless.ts:85-122` (`runClaude`)
- Modify: `services/gateway/src/skills/native-registry.ts:37-70` (`runCapture` becomes a thin wrapper)

**Interfaces:**
- Produces:
  ```ts
  interface RunProcessOptions { stdin?: string; timeoutMs?: number; shell?: boolean; onOutput?: (stream: "stdout" | "stderr", chunk: string) => void }
  interface RunProcessResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }
  function runProcess(command: string, args: string[], opts?: RunProcessOptions): Promise<RunProcessResult>  // NEVER rejects
  ```
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** — `services/gateway/test/run-process.test.ts` (uses `process.execPath` so it's cross-platform):

```ts
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/util/run-process.js";

const NODE = process.execPath;

describe("runProcess", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runProcess(NODE, ["-e", "console.log('hi')"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("hi");
    expect(r.timedOut).toBe(false);
  });

  it("reports a non-zero exit code with stderr", async () => {
    const r = await runProcess(NODE, ["-e", "console.error('bad'); process.exit(3)"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("bad");
  });

  it("kills and reports on timeout", async () => {
    const r = await runProcess(NODE, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
  });

  it("resolves (not rejects) on spawn failure", async () => {
    const r = await runProcess("definitely-not-a-real-binary-xyz", []);
    expect(r.spawnError).toBeTruthy();
  });

  it("pipes stdin and streams output chunks", async () => {
    const chunks: string[] = [];
    const r = await runProcess(NODE, ["-e", "process.stdin.pipe(process.stdout)"], {
      stdin: "echo-me",
      onOutput: (_s, c) => chunks.push(c),
    });
    expect(r.stdout).toBe("echo-me");
    expect(chunks.join("")).toBe("echo-me");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- run-process` → cannot resolve module.

- [ ] **Step 3: Implement `services/gateway/src/util/run-process.ts`**

```ts
/**
 * The ONE spawn-collect-timeout helper for the gateway. Every child process the
 * gateway starts goes through here so timeout/kill semantics are uniform.
 * Never rejects — callers map the result to their own error style.
 */
import { spawn } from "node:child_process";

export interface RunProcessOptions {
  stdin?: string;
  /** Kill (SIGKILL) and resolve with `timedOut: true` after this. */
  timeoutMs?: number;
  /** shell:true is needed on Windows to resolve .cmd shims (e.g. claude.cmd). */
  shell?: boolean;
  /** Streaming tap — receives each chunk as it arrives (also accumulated). */
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
}

export interface RunProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be spawned at all. */
  spawnError?: string;
}

export const DEFAULT_TIMEOUT_MS = 120_000;

export function runProcess(
  command: string,
  args: string[],
  opts: RunProcessOptions = {},
): Promise<RunProcessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: opts.shell ?? false,
    });

    const finish = (r: RunProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onOutput?.("stdout", s);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      opts.onOutput?.("stderr", s);
    });
    child.on("error", (err) => finish({ code: null, stdout, stderr, timedOut: false, spawnError: err.message }));
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut: false }));

    // A failed spawn can EPIPE the stdin stream — swallow it (the error event handles reporting).
    child.stdin.on("error", () => {});
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}
```

- [ ] **Step 4: Run the new tests** — `npm test -- run-process` → 5 pass.

- [ ] **Step 5: Add `timeoutMs` to the execution schema** — in `packages/shared/src/skill.ts`, inside BOTH the `claude-headless` and `process` variants of `SkillExecutionSchema`, add:

```ts
    /** Kill the child if it exceeds this (ms). Default lives in skill-runtime. */
    timeoutMs: z.number().int().positive().optional(),
```

- [ ] **Step 6: Refactor `skill-runtime.ts`** — replace `spawnCollect` (:126-154) with:

```ts
  /** Skills may run long (a headless ship-ticket implements a whole change). */
  private static readonly DEFAULT_SKILL_TIMEOUT_MS = 15 * 60_000;

  /** Spawn a child, stream its stdio to the bus, resolve with a StepResult. */
  private async spawnCollect(
    opId: string,
    command: string,
    args: string[],
    opts: { stdin?: string; timeoutMs?: number; shell?: boolean } = {},
  ): Promise<StepResult> {
    const r = await runProcess(command, args, {
      stdin: opts.stdin,
      shell: opts.shell,
      timeoutMs: opts.timeoutMs ?? SkillRuntime.DEFAULT_SKILL_TIMEOUT_MS,
      onOutput: (stream, chunk) => this.output(opId, stream, chunk),
    });
    if (r.spawnError) return { ok: false, exitCode: null, error: `failed to spawn "${command}": ${r.spawnError}` };
    if (r.timedOut) return { ok: false, exitCode: null, error: `"${command}" timed out and was killed` };
    return { ok: r.code === 0, exitCode: r.code };
  }
```

Update the two call sites (import `runProcess` from `../util/run-process.js`, drop the `spawn` import):

```ts
      case "claude-headless": {
        const model = selection?.model ?? config.anthropic.heavyModel;
        const prompt = renderTemplate(exec.promptTemplate, intent.parameters);
        // shell:true so Windows resolves the `claude.cmd` shim.
        return this.spawnCollect(opId, config.claudeCode.bin, ["-p", "--model", model, ...exec.args], {
          stdin: prompt,
          shell: true,
          timeoutMs: exec.timeoutMs,
        });
      }

      case "process": {
        const args = exec.args.map((a) => renderTemplate(a, intent.parameters));
        return this.spawnCollect(opId, exec.command, args, { timeoutMs: exec.timeoutMs });
      }
```

NOTE: the old `claude-headless` branch passed the prompt via stdin but spawned WITHOUT `shell: true` — on this Windows machine that only worked because `config.claudeCode.bin` can point at a resolvable exe; passing `shell: true` matches the other two claude spawn sites and the CLAUDE.md instruction. Keep stdin delivery (never argv).

- [ ] **Step 7: Refactor `llm-service.ts` `ClaudeHeadlessLlm.complete`** (:60-92):

```ts
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    // shell:true so Windows resolves the `claude.cmd` shim (npm global bin).
    const r = await runProcess(this.bin, ["-p", "--model", this.model], {
      stdin: full,
      shell: true,
      timeoutMs: this.timeoutMs,
    });
    if (r.spawnError) throw new Error(`failed to spawn "${this.bin}": ${r.spawnError}`);
    if (r.timedOut) throw new Error(`claude -p timed out after ${this.timeoutMs}ms`);
    const out = r.stdout.trim();
    if (r.code !== 0) throw new Error(`claude -p exited ${r.code}: ${r.stderr.trim() || "(no stderr)"}`);
    if (!out) throw new Error(`claude -p produced no output${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
    return out;
  }
```

(Import `runProcess`, drop `spawn`.)

- [ ] **Step 8: Refactor `routing/semantic/providers/claude-headless.ts` `runClaude`** (:85-122):

```ts
  /** Spawn `claude -p --output-format json --model <model>`, prompt via stdin. */
  private async runClaude(prompt: string): Promise<ClaudeCliResult> {
    // shell:true resolves claude.cmd on Windows.
    const r = await runProcess(this.bin, ["-p", "--output-format", "json", "--model", this.model], {
      stdin: prompt,
      shell: true,
      timeoutMs: this.timeoutMs,
    });
    if (r.spawnError) throw new Error(`claude-headless: failed to spawn "${this.bin}": ${r.spawnError}`);
    if (r.timedOut) throw new Error(`claude-headless: timed out after ${this.timeoutMs}ms`);
    if (r.code !== 0) throw new Error(`claude-headless: exited ${r.code}: ${r.stderr.trim()}`);
    try {
      return JSON.parse(r.stdout) as ClaudeCliResult;
    } catch {
      throw new Error("claude-headless: could not parse CLI JSON envelope");
    }
  }
```

(Import path from that file: `../../../util/run-process.js`.)

- [ ] **Step 9: Refactor `native-registry.ts` `runCapture`** (:37-70) — keep the cmd-wrapper comment block, shrink the body:

```ts
async function runCapture(bin: string, args: string[], timeoutMs: number): Promise<string> {
  const r =
    process.platform === "win32"
      ? await runProcess("cmd", ["/d", "/s", "/c", bin, ...args], { timeoutMs })
      : await runProcess(bin, args, { timeoutMs });
  if (r.spawnError) throw new Error(`spawn failed: ${r.spawnError}`);
  if (r.timedOut) throw new Error(`${bin} timed out`);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
  return r.stdout.trim();
}
```

(Import `runProcess` from `../util/run-process.js`; drop the `spawn` import if now unused.)

- [ ] **Step 10: Full verify** — `npm test && npm run typecheck -w @aos/gateway` → green.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/skill.ts services/gateway/src/util/run-process.ts services/gateway/src/skills/skill-runtime.ts services/gateway/src/llm/llm-service.ts services/gateway/src/routing/semantic/providers/claude-headless.ts services/gateway/src/skills/native-registry.ts services/gateway/test/run-process.test.ts
git commit -m "refactor(gateway): single runProcess helper; skills get a kill-timeout (fixes wedged scheduler slots)"
```

---

### Task 4: Zod schemas for the wire contracts (`OsEvent`, `ClientCommand`)

**Files:**
- Modify: `packages/shared/src/events.ts` (add schemas + parse helpers; keep the existing interfaces as-is)
- Create: `packages/shared/test/events.test.ts`

**Interfaces:**
- Produces (used by Tasks 5 & 6): `parseClientCommand(input: unknown): ClientCommand | null`, `parseOsEvent(input: unknown): OsEvent | null`, plus exported `ClientCommandSchema` / `OsEventSchema`.

- [ ] **Step 1: Write the failing test** — `packages/shared/test/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseClientCommand, parseOsEvent } from "../src/events.js";

describe("parseClientCommand", () => {
  it("accepts a valid route command", () => {
    expect(parseClientCommand({ type: "route", input: "hello" })).toEqual({ type: "route", input: "hello" });
  });
  it("accepts invoke with optional params", () => {
    expect(parseClientCommand({ type: "invoke", skillId: "ai-wire" })).toEqual({ type: "invoke", skillId: "ai-wire" });
  });
  it("rejects an unknown type", () => {
    expect(parseClientCommand({ type: "drop-tables" })).toBeNull();
  });
  it("rejects a route command missing input", () => {
    expect(parseClientCommand({ type: "route" })).toBeNull();
  });
  it("rejects non-objects", () => {
    expect(parseClientCommand("route")).toBeNull();
  });
});

describe("parseOsEvent", () => {
  it("accepts operation.completed with a result", () => {
    const e = {
      type: "operation.completed", at: "2026-07-07T10:00:00Z", opId: "1", exitCode: 0,
      result: { path: "10-research/x.md", title: "X", type: "research" },
    };
    expect(parseOsEvent(e)).toEqual(e);
  });
  it("accepts a notification", () => {
    const e = { type: "notification", at: "2026-07-07T10:00:00Z", level: "info", message: "hi" };
    expect(parseOsEvent(e)).toEqual(e);
  });
  it("rejects a wrong-shaped event", () => {
    expect(parseOsEvent({ type: "operation.completed", at: "x" })).toBeNull();
  });
  it("rejects junk", () => {
    expect(parseOsEvent(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- events` → `parseClientCommand` not exported.

- [ ] **Step 3: Add schemas to `packages/shared/src/events.ts`** (below the existing type definitions; `import { z } from "zod";` at top):

```ts
// --- Runtime validation (the wire is untrusted on both ends) -----------------

const RoutedIntentSchema: z.ZodType<RoutedIntent> = z.object({
  actionId: z.string(),
  source: z.enum(["regex", "semantic", "direct"]),
  confidence: z.number(),
  parameters: z.record(z.unknown()),
  rawInput: z.string(),
  reasoning: z.string().optional(),
});

const ModelSelectionSchema: z.ZodType<ModelSelection> = z.object({
  provider: z.enum(["haiku", "ollama", "openai", "claude-code"]),
  model: z.string(),
  reason: z.string(),
});

const OperationResultSchema: z.ZodType<OperationResult> = z.object({
  path: z.string(),
  title: z.string(),
  type: z.string(),
});

const OperationDescriptorSchema: z.ZodType<OperationDescriptor> = z.object({
  opId: z.string(),
  actionId: z.string(),
  skillId: z.string().nullable(),
  selection: ModelSelectionSchema.nullable(),
});

export const OsEventSchema: z.ZodType<OsEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("routing.resolved"), at: z.string(), intent: RoutedIntentSchema }),
  z.object({ type: z.literal("operation.queued"), at: z.string(), opId: z.string(), label: z.string(), kind: z.enum(["route", "invoke"]) }),
  z.object({ type: z.literal("operation.started"), at: z.string(), op: OperationDescriptorSchema }),
  z.object({ type: z.literal("operation.output"), at: z.string(), opId: z.string(), stream: z.enum(["stdout", "stderr"]), chunk: z.string() }),
  z.object({ type: z.literal("operation.completed"), at: z.string(), opId: z.string(), exitCode: z.number().nullable(), result: OperationResultSchema.optional() }),
  z.object({ type: z.literal("operation.failed"), at: z.string(), opId: z.string(), error: z.string() }),
  z.object({ type: z.literal("notification"), at: z.string(), level: z.enum(["info", "warn", "error"]), message: z.string(), speak: z.boolean().optional() }),
  z.object({ type: z.literal("metric"), at: z.string(), name: z.string(), value: z.number() }),
  z.object({ type: z.literal("speech"), at: z.string(), text: z.string(), mode: z.enum(["text", "voice"]), audioUrl: z.string().optional(), provider: z.string().optional() }),
  z.object({ type: z.literal("auth.prompt"), at: z.string(), service: z.string(), verificationUri: z.string(), userCode: z.string(), message: z.string(), expiresAt: z.string() }),
  z.object({ type: z.literal("auth.resolved"), at: z.string(), service: z.string(), ok: z.boolean() }),
]) as unknown as z.ZodType<OsEvent>;

export const ClientCommandSchema: z.ZodType<ClientCommand> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("route"), input: z.string().min(1) }),
  z.object({ type: z.literal("invoke"), skillId: z.string().min(1), params: z.record(z.unknown()).optional() }),
  z.object({ type: z.literal("speak"), path: z.string().min(1) }),
  z.object({ type: z.literal("ping") }),
]) as unknown as z.ZodType<ClientCommand>;

/** Validate an inbound event frame; null when it isn't a well-formed OsEvent. */
export function parseOsEvent(input: unknown): OsEvent | null {
  const r = OsEventSchema.safeParse(input);
  return r.success ? r.data : null;
}

/** Validate an inbound client command; null when it isn't well formed. */
export function parseClientCommand(input: unknown): ClientCommand | null {
  const r = ClientCommandSchema.safeParse(input);
  return r.success ? r.data : null;
}
```

(The `as unknown as z.ZodType<...>` casts absorb zod's optional-property inference vs the handwritten interfaces; the tests + `toEqual` round-trips are the real conformance check. If they assign cleanly without the cast, drop it.)

- [ ] **Step 4: Run tests** — `npm test -- events` → 9 pass. Also `npm run typecheck -w @aos/gateway` (shared is typechecked through the gateway).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/test/events.test.ts
git commit -m "feat(shared): zod schemas + parse helpers for OsEvent and ClientCommand"
```

---

### Task 5: Harden the gateway control plane (validate, cap, origin/host guard)

**Files:**
- Create: `services/gateway/src/bus/origin-guard.ts`
- Create: `services/gateway/test/origin-guard.test.ts`
- Modify: `services/gateway/src/bus/ws-server.ts`

**Interfaces:**
- Produces: `isLocalOrigin(origin: string | undefined): boolean`, `isLocalHostHeader(host: string | undefined): boolean` from `origin-guard.js`.
- Consumes: `parseClientCommand` from `@aos/shared` (Task 4).

- [ ] **Step 1: Write the failing test** — `services/gateway/test/origin-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isLocalHostHeader, isLocalOrigin } from "../src/bus/origin-guard.js";

describe("isLocalOrigin", () => {
  it("allows localhost origins on any port and scheme", () => {
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:7777")).toBe(true);
    expect(isLocalOrigin("https://localhost")).toBe(true);
  });
  it("allows absent origin (non-browser clients, same-origin fetches)", () => {
    expect(isLocalOrigin(undefined)).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isLocalOrigin("http://evil.example")).toBe(false);
    expect(isLocalOrigin("http://localhost.evil.example")).toBe(false);
    expect(isLocalOrigin("null")).toBe(false);
  });
});

describe("isLocalHostHeader", () => {
  it("allows localhost hosts with or without port", () => {
    expect(isLocalHostHeader("localhost:7777")).toBe(true);
    expect(isLocalHostHeader("127.0.0.1")).toBe(true);
    expect(isLocalHostHeader("[::1]:7777")).toBe(true);
  });
  it("rejects rebound hosts", () => {
    expect(isLocalHostHeader("evil.example:7777")).toBe(false);
    expect(isLocalHostHeader(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement `services/gateway/src/bus/origin-guard.ts`:

```ts
/**
 * Local-only guards for the gateway's HTTP/WS control plane. The gateway is a
 * single-user localhost tool, but a hostile web page (CSRF / DNS-rebinding) can
 * still reach 127.0.0.1 from the user's browser — so we only trust requests
 * that provably come from a local origin.
 */

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Browser origin is local, or absent entirely (CLI clients, same-origin GETs). */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return LOCAL_ORIGIN_RE.test(origin);
}

/** Host header names this machine — the DNS-rebinding defense. */
export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  return bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]";
}
```

- [ ] **Step 3: Run tests** — `npm test -- origin-guard` → pass.

- [ ] **Step 4: Wire into `ws-server.ts`** — five edits:

1. Imports: add `parseClientCommand` to the `@aos/shared` import; add `import { isLocalHostHeader, isLocalOrigin } from "./origin-guard.js";`

2. CORS: replace `const cors = { "access-control-allow-origin": "*" };` (:47) with a per-request helper, and thread it through (the `json` helper gains a `cors` argument computed once per request at the top of the request handler):

```ts
    // Only local origins may read cross-origin (HUD dev server on :5173).
    const corsFor = (req: import("node:http").IncomingMessage): Record<string, string> => {
      const origin = req.headers.origin;
      return origin && isLocalOrigin(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : {};
    };
```

Inside `createServer((req, res) => { ... })`, first lines become:

```ts
      const cors = corsFor(req);
      // DNS-rebinding defense: the Host header must name this machine.
      if (!isLocalHostHeader(req.headers.host)) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "forbidden host" }));
      }
```

(The existing `json(res, body)` helper closes over nothing request-specific today; change its signature to `json(res, cors, body, code = 200)` or make it a per-request closure — smallest diff wins, keep all existing call sites updated.)

3. POST body cap (:71-73): replace the accumulator with

```ts
        const MAX_BODY = 64 * 1024;
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > MAX_BODY) {
            json(res, cors, { ok: false, error: "body too large" }, 413);
            req.destroy();
          }
        });
```

4. WS origin check — replace `this.wss = new WebSocketServer({ server: this.http });` (:157) with:

```ts
    this.wss = new WebSocketServer({
      server: this.http,
      // Reject browser connections from non-local pages; non-browser clients
      // (no Origin header) are allowed.
      verifyClient: (info: { origin?: string }) => isLocalOrigin(info.origin || undefined),
    });
```

5. Command validation — in `onMessage` (:190-197), replace the parse block:

```ts
  private onMessage(ws: WebSocket, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "invalid command JSON" });
      return;
    }
    const cmd = parseClientCommand(parsed);
    if (!cmd) {
      this.send(ws, { type: "notification", at: new Date().toISOString(), level: "error", message: "unknown or malformed command" });
      return;
    }
    switch (cmd.type) { /* unchanged cases; the default branch can now be dropped */ }
  }
```

- [ ] **Step 5: Typecheck + tests** — `npm test && npm run typecheck -w @aos/gateway`.

- [ ] **Step 6: Live smoke** — start the gateway (`npm run start`, background) and probe:

```bash
# Host guard: forged Host must 403, real one 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example:7777" http://localhost:7777/health   # expect 403
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7777/health                                # expect 200
# WS: valid ping works; garbage command gets a malformed-command notification
node -e "const WebSocket=require('ws');const w=new WebSocket('ws://localhost:7777');w.on('open',()=>{w.send(JSON.stringify({type:'ping'}));w.send('not json');w.send(JSON.stringify({type:'nope'}))});w.on('message',m=>console.log(m.toString()));setTimeout(()=>process.exit(0),1500)"
# WS with an evil Origin must be refused
node -e "const WebSocket=require('ws');const w=new WebSocket('ws://localhost:7777',{origin:'http://evil.example'});w.on('open',()=>console.log('OPENED (bad!)'));w.on('error',e=>console.log('refused ok'));setTimeout(()=>process.exit(0),1500)"
```

Then stop the gateway. Also confirm the HUD dev server (`npm run hud`) still connects (its Origin is `http://localhost:5173`).

- [ ] **Step 7: Commit**

```bash
git add services/gateway/src/bus/origin-guard.ts services/gateway/src/bus/ws-server.ts services/gateway/test/origin-guard.test.ts
git commit -m "feat(gateway): local-origin guard, host check, body cap, and schema-validated WS commands"
```

---

### Task 6: HUD — validate WS frames, sanitize markdown, fix Options remount, backoff, Audio reuse

**Files:**
- Modify: `apps/hud/package.json` (+ `dompurify`)
- Modify: `apps/hud/src/gateway.ts` (parseOsEvent on frames; reconnect backoff)
- Modify: `apps/hud/src/components/DocViewer.tsx:83` (sanitize)
- Modify: `apps/hud/src/components/Options.tsx` (hoist `Select`/`Text` to module scope)
- Modify: `apps/hud/src/useGateway.ts:237` (single reused Audio element)

**Interfaces:**
- Consumes: `parseOsEvent` from `@aos/shared` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Install dompurify**

```bash
npm install dompurify -w @aos/hud
```

- [ ] **Step 2: Validate WS frames + backoff in `gateway.ts`**

Add `parseOsEvent` to the shared import. Replace `onmessage` (:80-86):

```ts
    ws.onmessage = (msg) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.data as string);
      } catch {
        return; // not JSON — drop
      }
      const event = parseOsEvent(parsed);
      if (event) this.onEvent(event);
      else console.warn("[gateway] dropped malformed event frame", parsed);
    };
```

Backoff: add `private attempts = 0;` to the class; in `onopen` set `this.attempts = 0;` (keep the `onStatus("online")` call); replace `scheduleReconnect` (:94-97):

```ts
  /** Exponential backoff (1.5s → 15s cap, ±250ms jitter) so an absent gateway isn't polled every 1.5s forever. */
  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(15_000, 1_500 * 2 ** this.attempts) + Math.random() * 250;
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }
```

- [ ] **Step 3: Sanitize DocViewer** — in `DocViewer.tsx` add `import DOMPurify from "dompurify";` and replace line 83's `dangerouslySetInnerHTML` value:

```tsx
            <div
              className="doc__body"
              // Strip the body's leading H1 — we already render the title above.
              // Sanitized: vault bodies contain LLM-synthesized text from scraped
              // web sources, so raw HTML must never reach the DOM.
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                  marked.parse(doc.body.replace(/^\s*#\s+[^\n]*\n+/, "")) as string,
                ),
              }}
            />
```

- [ ] **Step 4: Hoist `Select`/`Text` in `Options.tsx`** — they are currently defined INSIDE the component (:50-75), so every render creates new component types and React remounts the inputs (focus loss per keystroke). Move them to module scope with explicit props, next to `Row`:

```tsx
function Select({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="opt__row">
      <span className="opt__key">{label}</span>
      <select className="opt__select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function Text({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  return (
    <div className="opt__row">
      <span className="opt__key">{label}</span>
      <input className="opt__select" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
```

Update every call site from `k`/`running` props to computed props, e.g.:

```tsx
<Select label="Router brain" value={valueOf("router.defaultProvider", cfg.router.defaultProvider)} options={["haiku", "ollama", "openai"]} onChange={(v) => change("router.defaultProvider", v)} />
```

(11 call sites: router.defaultProvider, router.transport, models.fallbackOrder, tasks.maxConcurrent, openai.baseUrl, openai.model, ollama.baseUrl, ollama.model, ui.launch, ui.browser, voice.mode, voice.tts.provider, voice.stt.provider, mail.provider, mail.tokenSource — apply mechanically.)

- [ ] **Step 5: Reuse one Audio element in `useGateway.ts`** — add near the other refs (:139):

```ts
  // One reused element so rapid speech events don't stack overlapping players.
  const audioRef = useRef<HTMLAudioElement | null>(null);
```

Replace the `speech` case body (:236-238):

```ts
      case "speech":
        setLastSpeech({ text: e.text, at: Date.now() });
        if (e.audioUrl) {
          const player = (audioRef.current ??= new Audio());
          player.src = e.audioUrl;
          void player.play().catch(() => {});
        }
        break;
```

- [ ] **Step 6: Verify** — `npm run build -w @aos/hud && npm run typecheck -w @aos/hud` → green. Then a browser smoke (claude-in-chrome per project CLAUDe.md): start gateway + HUD, load `http://localhost:5173`, open Options, type into a Text field and confirm focus is retained across keystrokes; open a vault doc and confirm it renders.

- [ ] **Step 7: Commit**

```bash
git add apps/hud package-lock.json
git commit -m "fix(hud): validate WS frames, sanitize doc markdown (XSS), stop Options input remounts, reconnect backoff, single Audio player"
```

---

### Task 7: Outlook refresh token → secret store (with silent migration)

**Files:**
- Modify: `config/config-store.ts:58` (add `"mail.refreshToken"` to `SECRET_KEYS`)
- Modify: `services/gateway/src/mail/graph-auth.ts` (introduce `TokenStore` interface; export `TokenStoreData`)
- Create: `services/gateway/src/mail/secret-token-store.ts`
- Create: `services/gateway/test/secret-token-store.test.ts`
- Modify: `services/gateway/src/mail/mail-provider.ts:161` (use SecretTokenStore)
- Modify: `services/gateway/src/bus/ws-server.ts:111` (`signedIn` check)

**Interfaces:**
- Produces: `interface TokenStore { load(): TokenStoreData | null; save(data: TokenStoreData): void }` (graph-auth); `class SecretTokenStore implements TokenStore` with constructor `(legacy?: TokenStore & { path?: string }, io?: { get(): string | undefined; set(v: string): void; deleteLegacyFile?: () => void })`.
- Consumes: `getValue`/`setValues`/`secretPresence` from `config/config-store.js`.

- [ ] **Step 1: Whitelist the new secret** — `config/config-store.ts:58`:

```ts
export const SECRET_KEYS = ["anthropic.apiKey", "openai.apiKey", "mail.token", "mail.refreshToken", "x.bearerToken"] as const;
```

(`reddit.clientSecret` is removed in Task 8 — don't do it here to keep commits reviewable.) — actually removing it here alongside adding is fine if Task 8 is folded; keep them separate as written.

- [ ] **Step 2: Add the `TokenStore` seam in `graph-auth.ts`** — export the data type (:65-69) and an interface; retype the option:

```ts
export interface TokenStoreData {
  refreshToken: string;
  clientId: string;
  tenant: string;
}

/** Where the long-lived refresh token lives (file = legacy, secret store = current). */
export interface TokenStore {
  load(): TokenStoreData | null;
  save(data: TokenStoreData): void;
}

export class FileTokenStore implements TokenStore { /* unchanged body */ }
```

and in `DeviceCodeOptions` change `store: FileTokenStore;` → `store: TokenStore;`.

- [ ] **Step 3: Write the failing test** — `services/gateway/test/secret-token-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SecretTokenStore } from "../src/mail/secret-token-store.js";
import type { TokenStore, TokenStoreData } from "../src/mail/graph-auth.js";

const data: TokenStoreData = { refreshToken: "rt", clientId: "c", tenant: "t" };

function fakeIo(initial?: string) {
  let stored = initial;
  let legacyDeleted = false;
  return {
    io: { get: () => stored, set: (v: string) => { stored = v; }, deleteLegacyFile: () => { legacyDeleted = true; } },
    read: () => stored,
    wasLegacyDeleted: () => legacyDeleted,
  };
}

const legacyWith = (d: TokenStoreData | null): TokenStore => ({ load: () => d, save: () => {} });

describe("SecretTokenStore", () => {
  it("round-trips through the secret backend", () => {
    const f = fakeIo();
    const store = new SecretTokenStore(undefined, f.io);
    store.save(data);
    expect(store.load()).toEqual(data);
  });

  it("prefers the secret backend over the legacy file", () => {
    const f = fakeIo(JSON.stringify(data));
    const store = new SecretTokenStore(legacyWith({ ...data, refreshToken: "old" }), f.io);
    expect(store.load()?.refreshToken).toBe("rt");
  });

  it("migrates a legacy file token into the secret backend and deletes the file", () => {
    const f = fakeIo();
    const store = new SecretTokenStore(legacyWith(data), f.io);
    expect(store.load()).toEqual(data);          // served from legacy
    expect(JSON.parse(f.read()!)).toEqual(data); // and persisted to secrets
    expect(f.wasLegacyDeleted()).toBe(true);
  });

  it("returns null when nothing is stored anywhere", () => {
    expect(new SecretTokenStore(legacyWith(null), fakeIo().io).load()).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify it fails**, then implement `services/gateway/src/mail/secret-token-store.ts`:

```ts
/**
 * Refresh-token storage backed by the config secret store (OS keychain or
 * encrypted file) instead of a plaintext JSON file. Transparently migrates a
 * legacy FileTokenStore token on first read, then removes the plaintext file.
 */
import { rmSync } from "node:fs";
import { getValue, setValues } from "../../../../config/config-store.js";
import type { TokenStore, TokenStoreData } from "./graph-auth.js";

const KEY = "mail.refreshToken";

interface SecretIo {
  get(): string | undefined;
  set(value: string): void;
  deleteLegacyFile?: () => void;
}

export class SecretTokenStore implements TokenStore {
  constructor(
    private readonly legacy?: TokenStore,
    private readonly io: SecretIo = {
      get: () => getValue(KEY),
      set: (v) => setValues({ [KEY]: v }),
    },
  ) {}

  load(): TokenStoreData | null {
    const raw = this.io.get();
    if (raw) {
      try {
        return JSON.parse(raw) as TokenStoreData;
      } catch {
        return null;
      }
    }
    // One-time migration from the legacy plaintext file.
    const migrated = this.legacy?.load() ?? null;
    if (migrated) {
      this.save(migrated);
      try {
        this.io.deleteLegacyFile?.();
      } catch {
        /* best-effort cleanup */
      }
    }
    return migrated;
  }

  save(data: TokenStoreData): void {
    this.io.set(JSON.stringify(data));
  }
}

/** Production wiring: secret store first, legacy file (then deleted) as fallback. */
export function createSecretTokenStore(legacyPath: string, legacy: TokenStore): SecretTokenStore {
  return new SecretTokenStore(legacy, {
    get: () => getValue(KEY),
    set: (v) => setValues({ [KEY]: v }),
    deleteLegacyFile: () => rmSync(legacyPath, { force: true }),
  });
}
```

- [ ] **Step 5: Wire the provider** — `mail-provider.ts:161`:

```ts
        store: createSecretTokenStore(mailConfig.tokenStorePath, new FileTokenStore(mailConfig.tokenStorePath)),
```

(import `createSecretTokenStore` from `./secret-token-store.js`).

- [ ] **Step 6: Fix the `signedIn` probe** — `ws-server.ts:111`: the token no longer necessarily lives on disk:

```ts
              signedIn:
                config.mail.provider === "outlook" &&
                (secretPresence()["mail.refreshToken"] || existsSync(config.mail.tokenStorePath)),
```

(`secretPresence` is already imported at :18.)

- [ ] **Step 7: Verify** — `npm test && npm run typecheck -w @aos/gateway` → green.

- [ ] **Step 8: Commit**

```bash
git add config/config-store.ts services/gateway/src/mail services/gateway/src/bus/ws-server.ts services/gateway/test/secret-token-store.test.ts
git commit -m "fix(mail): store the Outlook refresh token in the secret backend, migrating the plaintext file"
```

---

### Task 8: config-store — coerce non-string values; drop dead `reddit.clientSecret`; test seam

**Files:**
- Modify: `config/config-store.ts` (`setValues` coercion :200-212; remove `reddit.clientSecret` from :58; `AGENTIC_OS_NO_KEYCHAIN` escape in `tryKeychainBackend` :87)
- Create: `config/test/config-store.test.ts`

**Interfaces:**
- Produces: `setValues` now persists `string | number | boolean` (stored as strings); env `AGENTIC_OS_NO_KEYCHAIN=1` forces the encrypted-file backend (tests + headless boxes).

- [ ] **Step 1: Write the failing test** — `config/test/config-store.test.ts`. The store reads env at import time, so stub env FIRST, then dynamic-import with a reset module registry:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  vi.stubEnv("AGENTIC_OS_HOME", mkdtempSync(join(tmpdir(), "aos-cfg-")));
  vi.stubEnv("AGENTIC_OS_NO_KEYCHAIN", "1"); // never touch the real credential manager
  return import("../config-store.js");
}

describe("config-store setValues", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("persists strings", async () => {
    const s = await freshStore();
    s.setValues({ "ollama.model": "llama3:8b" });
    expect(s.getValue("ollama.model")).toBe("llama3:8b");
  });

  it("coerces numbers and booleans instead of silently dropping them", async () => {
    const s = await freshStore();
    s.setValues({ "tasks.maxConcurrent": 4, "voice.announce": false });
    expect(s.getValue("tasks.maxConcurrent")).toBe("4");
    expect(s.getValue("voice.announce")).toBe("false");
  });

  it("still drops objects and arrays", async () => {
    const s = await freshStore();
    s.setValues({ "ollama.model": { nope: true } });
    expect(s.getValue("ollama.model")).toBeUndefined();
  });

  it("round-trips a secret through the encrypted-file backend", async () => {
    const s = await freshStore();
    expect(s.secretBackendId).toBe("encrypted-file");
    s.setValues({ "x.bearerToken": "tok-123" });
    expect(s.getValue("x.bearerToken")).toBe("tok-123");
    expect(s.secretPresence()["x.bearerToken"]).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failures** (coercion test fails; keychain test may fail without the escape hatch), then implement the three edits:

`tryKeychainBackend` first line:

```ts
function tryKeychainBackend(): SecretBackend | undefined {
  // Explicit off-switch (tests, headless boxes where a probe would hang).
  if (process.env.AGENTIC_OS_NO_KEYCHAIN) return undefined;
  try {
```

`setValues` loop (:203):

```ts
  for (const [k, v] of Object.entries(partial)) {
    // Accept the scalar types the Options panel produces; store as strings
    // (agentic-os.config.ts parses them back). Drop anything structured.
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const value = String(v);
    if (SECRET_SET.has(k)) {
      secrets.set(k, value);
    } else {
      cache[k] = value;
      touchedFile = true;
    }
  }
```

`SECRET_KEYS` (:58): remove `"reddit.clientSecret"` (nothing reads it — there is no `reddit` config block and `fetchReddit` uses the keyless endpoint).

- [ ] **Step 3: Run tests** — `npm test -- config-store` → 4 pass; full `npm test` + gateway typecheck green.

- [ ] **Step 4: Commit**

```bash
git add config/config-store.ts config/test/config-store.test.ts
git commit -m "fix(config): setValues coerces numbers/booleans; drop dead reddit.clientSecret; AGENTIC_OS_NO_KEYCHAIN seam"
```

---

### Task 9: Unify the six fetch-* handlers behind one `runFetcher`

**Files:**
- Modify: `services/gateway/src/skills/native-registry.ts:153-433`

**Interfaces:**
- Consumes: `dedupeRank`/`ResearchItem` from Task 2.
- Produces: internal only. Behavior contract change (deliberate): ALL fetchers now (a) honor `sourceDisabled()` — including HN (`"hackernews"`) and Reddit (`"reddit"`), whose Options toggles were previously ignored — and (b) soft-skip (`return 0`) on an empty topic instead of HN/Reddit failing the composite with `return 1`. `compile-research` still fails loudly on an empty topic, so the pipeline outcome is unchanged.

- [ ] **Step 1: Add the helper** (below `collect`):

```ts
/**
 * Shared fetcher shell: disabled/topic guards, collect + emit on success,
 * collect-empty + emit on failure. Every source keeps only its parsing.
 * Failures NEVER fail the composite — a dead source just contributes nothing.
 */
async function runFetcher(
  ctx: NativeHandlerContext,
  opts: {
    /** config.research.disabled id, e.g. "hackernews". */
    id: string;
    /** emit prefix, e.g. "fetch-hackernews". */
    name: string;
    /** SourceRef label for the record's Sources section. */
    label: string;
    humanUrl: string;
    /** Unit for the success line, e.g. "stories". */
    unit: string;
    fetchItems: () => Promise<ResearchItem[]>;
  },
): Promise<number> {
  if (sourceDisabled(opts.id)) return 0;
  try {
    const items = await opts.fetchItems();
    collect(ctx, items, { label: opts.label, url: opts.humanUrl });
    ctx.emit(`${opts.name}: ${items.length} ${opts.unit}\n`);
  } catch (err) {
    collect(ctx, [], { label: opts.label, url: opts.humanUrl });
    ctx.emit(`${opts.name}: failed (${(err as Error).message})\n`);
  }
  return 0;
}
```

- [ ] **Step 2: Rewrite each fetcher as guard + `runFetcher`.** Pattern (Hacker News shown in full; apply the same mechanical shape to the other five, keeping each source's existing fetch/parse code verbatim inside `fetchItems`):

```ts
const fetchHackerNews: NativeHandler = async (ctx) => {
  const topic = String(ctx.params.topic ?? "").trim();
  if (!topic) return 0;
  const cutoff = Math.floor(Date.parse(ctx.services.nowIso()) / 1000) - THIRTY_DAYS_SEC;
  const apiUrl =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story` +
    `&query=${encodeURIComponent(topic)}&numericFilters=created_at_i>${cutoff}&hitsPerPage=20`;
  const humanUrl = `https://hn.algolia.com/?query=${encodeURIComponent(topic)}&dateRange=pastMonth&type=story`;
  return runFetcher(ctx, {
    id: "hackernews",
    name: "fetch-hackernews",
    label: `Hacker News search: ${topic}`,
    humanUrl,
    unit: "stories",
    fetchItems: async () => {
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { hits?: AlgoliaHit[] };
      return (data.hits ?? []).map((h) => ({
        title: h.title ?? "(untitled)",
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        score: h.points ?? 0,
        author: h.author ?? "unknown",
        source: "Hacker News",
      }));
    },
  });
};
```

Per-source notes:
- **reddit** (`id: "reddit"`, unit `"posts"`): parsing verbatim from :209-224.
- **polymarket** (`id: "polymarket"`, unit `"markets"`): keep the `terms` precomputation before `runFetcher`; drop its now-redundant top-level `sourceDisabled` check.
- **web** (`id: "web"`, unit `"results"`): the regex scrape moves into `fetchItems` verbatim.
- **x** (`id: "x"`, unit `"posts"`): the no-token early-return stays BEFORE `runFetcher` (it emits its own hint and returns 0).
- **youtube** (`id: "youtube"`, unit `"videos"`): the whole yt-dlp block (search + transcript extraction, :313-389) moves into `fetchItems`; the internal `ctx.emit` transcript-count lines still work (ctx is in scope). Its catch message differs from the generic one ("skipped … is yt-dlp installed?") — acceptable to lose the custom suffix, OR keep fetchYouTube's existing try/catch inside `fetchItems` for the transcript sub-block only; the outer failure line becomes the generic `fetch-youtube: failed (...)`. Choose the generic (uniformity wins; the error message still names the binary).

- [ ] **Step 3: Verify** — `npm test && npm run typecheck -w @aos/gateway`. Optional live smoke: `npm run research-demo` (needs network) and confirm all six `fetch-*` lines appear and the record compiles.

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/skills/native-registry.ts
git commit -m "refactor(skills): one runFetcher shell for all six sources; HN/Reddit now honor their Options toggles"
```

---

### Task 10: Small fixes — ship-ticket vault folder, sidecar filename sanitize, dead code

**Files:**
- Modify: `skills/ship-ticket/skill.manifest.json:25`
- Modify: `services/voice/server.py:68`
- Modify: `services/gateway/src/bus/static-hud.ts` (remove `hudAvailable`, :34)
- Modify: `services/gateway/src/dispatch/scheduler.ts` (remove `stats()`, :42)

- [ ] **Step 1: ship-ticket manifest** — the vault `ticket` contract folder is `30-tickets` (`packages/shared/src/vault.ts:77`); the manifest says `tickets/`:

```json
  "vaultOutput": "30-tickets/{{ticketId}}.md"
```

(No `produces` block on purpose: ship-ticket is an action skill — re-invoking it must always run, never serve a cached record.)

- [ ] **Step 2: Sidecar upload path traversal** — `services/voice/server.py:68`: the client-supplied filename goes into a path join unsanitized (the `/audio` GET at :95 already applies `basename`; the upload must too):

```python
    safe_name = os.path.basename(audio.filename or "clip")
    tmp = os.path.join(cfg.audio_dir, f"in_{safe_name}")
```

- [ ] **Step 3: Dead code** — verified by grep (only definitions, no callers): delete `hudAvailable()` from `static-hud.ts` and `stats()` from `scheduler.ts`. (`byIdOrThrow` stays — `research-demo.ts:84` uses it.)

- [ ] **Step 4: Verify** — `npm test && npm run typecheck -w @aos/gateway && npm run build -w @aos/hud`. For the manifest: `npm run deck-demo` loads/validates all manifests — expect no schema errors.

- [ ] **Step 5: Commit**

```bash
git add skills/ship-ticket/skill.manifest.json services/voice/server.py services/gateway/src/bus/static-hud.ts services/gateway/src/dispatch/scheduler.ts
git commit -m "fix: ship-ticket vault folder, sidecar upload filename sanitization, remove dead exports"
```

---

### Task 11: Docs drift cleanup

**Files:**
- Modify: `docs/proposals/task-queue.md:3-4`
- Modify: `docs/configuration.md:23-24`
- Modify: `docs/skills.md:87-94`
- Modify: `docs/referensebegining/vault.md` (~:43-50 — read first)
- Modify: `docs/architecture.md` (read first; add scheduler mention)
- Modify: `docs/skills.md` or `services/voice/README.md` (one-line note on unpinned sidecar deps)

- [ ] **Step 1: task-queue proposal is shipped** — replace the status blockquote (:3-4):

```markdown
> Status: **shipped.** Implemented in `services/gateway/src/dispatch/scheduler.ts`:
> single global limit (default **2**, live-editable via `tasks.maxConcurrent`), FIFO
> queue, `operation.queued` events; the HUD vitals widget shows running/queued.
```

- [ ] **Step 2: configuration.md secret list** (:24) — reflect Tasks 7/8:

```markdown
  `anthropic.apiKey`, `openai.apiKey`, `mail.token`, `mail.refreshToken`, `x.bearerToken`.
```

Also add one honest sentence to the Secrets section (Windows reality of the file backend):

```markdown
- On the encrypted-file backend the master key sits beside the ciphertext (and
  `chmod 600` is a no-op on Windows) — it protects against accidental plaintext
  exposure (logs, commits, backups), not against another process running as you.
  Prefer the OS-keychain backend where available.
```

- [ ] **Step 3: skills.md bundled table** (:87-94) — replace with the full current inventory:

```markdown
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
```

Also fix the composite example earlier in the page (:28 area) if it still says "HN + Reddit".

- [ ] **Step 4: vault doc types** — read `docs/referensebegining/vault.md`; the per-type table lists 6 types; add the 3 newer ones matching `packages/shared/src/vault.ts` (`DOCUMENT_CONTRACTS`): `intel` (05-intel, ai-wire), `report` (03-report, morning-report), `schedule` (04-schedule, schedule skill) — copy folder names/required sections from `vault.ts:77-83` exactly.

- [ ] **Step 5: architecture.md scheduler** — read the page; in the command-flow section (WS → dispatcher), insert one sentence: inbound `route`/`invoke` commands pass through the `Scheduler` (`dispatch/scheduler.ts`) — a global FIFO queue with a live-editable concurrency limit (`tasks.maxConcurrent`, default 2) — before reaching the dispatcher; queued ops emit `operation.queued`.

- [ ] **Step 6: sidecar dep note** — in `services/voice/README.md` add:

```markdown
> Dependencies are floor-pinned (`>=`). For a reproducible install, freeze your
> working set once the sidecar runs: `pip freeze > requirements.lock`.
```

- [ ] **Step 7: Verify + commit** — docs only; re-run `npm test` once to be safe.

```bash
git add docs services/voice/README.md
git commit -m "docs: task-queue shipped, full skill inventory, new vault types, secret-key list, scheduler in architecture"
```

---

## Final verification (after Task 11)

- [ ] `npm test` — full suite green.
- [ ] `npm run typecheck -w @aos/gateway` and `npm run build -w @aos/hud` — green.
- [ ] Live smoke: start gateway + HUD, click a deck skill (e.g. AI Wire), watch `operation.queued/started/output/completed` flow and the record open in the viewer.
- [ ] `git log --oneline main..HEAD` — ~11 commits, each self-contained.
