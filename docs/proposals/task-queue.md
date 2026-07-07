# Plan: Task Queue + Concurrency Limit (Scheduler)

> Status: **shipped.** Implemented in `services/gateway/src/dispatch/scheduler.ts`:
> single global limit (default **2**, live-editable via `tasks.maxConcurrent`), FIFO
> queue, `operation.queued` events; the HUD vitals widget shows running/queued.

## Context

Today the gateway runs every command **immediately, unbounded, fire-and-forget**:

```ts
// services/gateway/src/bus/ws-server.ts
case "route":  void this.dispatcher.dispatch(cmd.input).catch(…)        // :196
case "invoke": void this.dispatcher.invoke(cmd.skillId, …).catch(…)     // :201
```

There is **no concurrency control** anywhere (the only `inflight` map, in
`memory/vault-recorder.ts`, is just for logging). So N "Deep Research" clicks =
N concurrent `claude -p` synthesis runs (~30–40s each) hammering the machine and
the single Claude Code login, with zero visibility into what's waiting.

Goal: cap how many operations run at once (default 2) and **queue** the rest,
with the HUD showing "running N · queued M". The existing **freshness guard
already short-circuits fresh records before heavy work**, so the queue only ever
holds genuinely-new tasks.

## Design

A small **`Scheduler`** sits between the WS handler and the dispatcher.

- New `services/gateway/src/dispatch/scheduler.ts`:
  - `constructor(bus: EventBus, limit: () => number)` — reads the limit lazily so
    Options edits apply live.
  - `submit(run: (opId: string) => Promise<void>, meta: { kind, label }): string`
    — generates the `opId`, emits **`operation.queued`**, pushes `{opId, run, meta}`
    onto a FIFO array, calls `pump()`, returns the opId.
  - internal `running = new Set<string>()`, `queue: QueuedTask[]`.
  - `pump()`: while `running.size < limit()` and the queue is non-empty, dequeue,
    add the opId to `running`, call `run(opId)`, and in `.finally` remove it and
    `pump()` again. (`run`'s promise resolves when the dispatcher's
    dispatch/invoke resolves — i.e. when the op completes — so no bus
    subscription is needed; `.finally` also frees the slot on throw so the queue
    can't wedge.)

- **opId threading** (so a task is trackable from the moment it's queued):
  `Dispatcher.dispatch(input, opId?)` and `invoke(skillId, params, opts, opId?)`
  accept an optional opId and use it instead of `randomUUID()` when provided.
  The scheduler owns the opId so `operation.queued` and the later
  `operation.started` share it. (`dispatch/dispatcher.ts`)

- **WS handler** (`bus/ws-server.ts`) calls the scheduler instead of the
  dispatcher directly:
  ```ts
  case "route":  this.scheduler.submit((opId) => this.dispatcher.dispatch(cmd.input, opId), { kind: "route", label: cmd.input });
  case "invoke": this.scheduler.submit((opId) => this.dispatcher.invoke(cmd.skillId, cmd.params ?? {}, { requireDeck: true }, opId), { kind: "invoke", label: cmd.skillId });
  ```
  The `Scheduler` is constructed in `server.ts` and passed to `GatewayServer`.

- **New event** (`packages/shared/src/events.ts`): add to `OsEvent`
  `{ type: "operation.queued"; at: string; opId: string; label: string; kind: "route" | "invoke" }`.
  The HUD derives counts: a task is **queued** from `operation.queued` until its
  `operation.started` (or terminal `operation.failed`) arrives → then **running**
  → then settled. No separate depth event needed.

- **Config**: `tasks.maxConcurrent` (number, default **2**), env
  `AGENTIC_OS_MAX_CONCURRENT`, in `config/agentic-os.config.ts` (`AppConfig` +
  `build()`), added to `EDITABLE_KEYS` (`config/config-store.ts`). The scheduler
  reads `config.tasks.maxConcurrent` on each `pump()`, so changing it in Options
  applies live (raising it pumps more immediately; lowering it lets current ops
  finish without starting new ones).

- **HUD**:
  - `apps/hud/src/useGateway.ts` — handle `operation.queued`: track a `queued`
    set keyed by opId; remove on `operation.started`/`.completed`/`.failed`.
    Expose `queued: number` in `HudState`.
  - Surface it: show "running N · queued M" in the **System status (vitals)**
    widget (`apps/hud/src/widgets/vitals/index.tsx`) and/or near the core counter
    in `App.tsx`. (A dedicated "Queue" widget is now trivial via the
    auto-discovery registry — optional follow-up.)
  - Options: a `tasks.maxConcurrent` number field in the existing settings UI
    (`components/Options.tsx`), reusing the `Text`/number pattern.

## Out of scope (v1) / future

- Cancelling a queued task (needs a `cancel(opId)` + an `operation.canceled`
  event). Note as a follow-up.
- Per-kind limits / priorities (we chose a single global limit). NL routing runs
  inside the queued task, so the cheap haiku routing call is also gated — fine at
  limit 2; route-before-queue is a possible later refinement.

## Verification

- `npm run typecheck -w @aos/gateway` + `npm run build -w @aos/hud` clean.
- WS smoke: with `tasks.maxConcurrent = 2`, fire 4 `invoke last-30-days` (distinct
  topics, `force:true`) rapidly over `ws://localhost:7777`; observe at most **2**
  `operation.started` at once, the others arriving as `operation.queued` and only
  starting as slots free; all 4 eventually `operation.completed`.
- Browser (claude-in-chrome): the vitals widget shows running/queued counts
  updating as the burst drains; changing the limit in Options takes effect live.

## Key touch points

- `services/gateway/src/dispatch/scheduler.ts` (new)
- `services/gateway/src/dispatch/dispatcher.ts` — optional `opId` on dispatch/invoke
- `services/gateway/src/bus/ws-server.ts` — submit to scheduler (:196/:201); accept Scheduler
- `services/gateway/src/server.ts` — construct + wire the Scheduler
- `packages/shared/src/events.ts` — `operation.queued`
- `config/agentic-os.config.ts` + `config/config-store.ts` — `tasks.maxConcurrent`
- `apps/hud/src/useGateway.ts` (+ `gateway.ts` type) — track queued; `widgets/vitals/index.tsx` / `App.tsx` — display; `components/Options.tsx` — the limit field
