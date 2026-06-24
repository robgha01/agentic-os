# Proposal: Configured Skill Instances (templates → instances)

> Status: **researched, not yet built.** Captures the idea, how the system works
> today, the gaps, pros/cons, and a recommended phased shape. Companion to
> [configuration.md](../configuration.md) (model & provider layer) and
> [skills.md](../skills.md).

## The idea

Today a skill is a singleton: `inbox-triage` is one thing, driving one config.
Instead, treat the **manifest as a template** and let users create named
**instances** of it — configured copies with their own preset params, model
(provider + specific model), and strictness. "Work Email" and "Personal Email"
become two command-deck buttons; "AI Wire: Security" and "AI Wire: Markets"
become two wire feeds. This **subsumes** the earlier "model sets + per-skill
assignment + per-run picker" idea into one concept users actually think in.

**Instance shape (user data, stored in config):**
```
instanceId  = `${baseId}:${slug}`        e.g. "ai-wire:security"
{ baseId, label, eyebrow?, params (preset inputs), model?: {provider, model, strict} }
```
The base skill is its own *default* instance (no namespace) for back-compat and
NL routing.

**Resolution precedence:** instance.model → manifest `modelPolicy.pin` → cascade.
Strict is a per-instance flag (default **soft**: if the instance's provider isn't
ready, fall through to the cascade with a notice; strict = exact-or-fail).

## How the system works today (verified against code)

- **Skill identity is a singleton.** `SkillLoader` keys manifests by `id`
  (`byId`/`byTrigger`); `get(id)`, `forAction(actionId)`, `deckCards()`, composite
  `steps`, `dispatcher.invoke(skillId)`, and the `ClientCommand` all assume that
  one static id. (`services/gateway/src/skills/skill-loader.ts`,
  `dispatch/dispatcher.ts`, `bus/ws-server.ts`)
- **NL routing is 1:1.** `router → actionId → loader.forAction → exactly one skill`
  (`routing/router.ts:66`). Two instances would share a trigger and collide.
- **Records are keyed by `(type, key)`** where `key` = the **topic** (research) or
  **today's date** (inbox, ai-wire). That derivation runs in **two places that
  must agree**: the writing handler (`skills/native-registry.ts`) and the
  dispatcher freshness guard (`dispatch/dispatcher.ts` `freshHit`). Path built by
  `memory/vault-paths.ts:recordPath` (slugifies the key).
- **Config is a flat string store**; structured values already ride as encoded
  strings (e.g. `models.fallbackOrder` is CSV). Instances would store as a JSON
  string under one editable key — proven pattern. (`config/config-store.ts`,
  `config/agentic-os.config.ts:build()`)
- **Invoke carries an opaque `skillId` + `params`** end-to-end (deck → WS →
  dispatcher), so an instance id flows through with **no HUD/events changes**.
- **Model override**: today a provider maps to one configured model
  (`models/models.config.ts`); an instance picking an exact model inlines
  `{provider, model}` and builds the `ModelSelection` directly (reusing
  `createLlmForSelection`), bypassing the one-model-per-provider assumption.

## Gaps (ranked by impact)

1. **Vault-key collisions — the one must-solve.** Two instances of the same
   producing skill compute the *same* key → they overwrite each other's record
   **and** falsely cache-hit in `freshHit` (instance B serves instance A's
   record). **Fix = a hard invariant: produced record keys are namespaced by the
   instance** (default = no namespace; named = prefixed), applied **identically**
   in the handler write and in `freshHit`. Cleanest injection: add an optional
   `instance` to `NativeHandlerContext` and thread it from the dispatcher into
   both the write path and the freshness check.
2. **Some skills aren't parameterized for what you'd configure.**
   `inbox-triage` reads **one global mailbox** (mail provider is global config),
   no per-call mailbox param — so "Work" vs "Personal" email instances would
   differ only by model/label until **multi-account mail** exists. **Research
   (topic) and AI Wire (theme) are fully parameterized → instances work there
   immediately.**
3. **NL routing is 1:1** → instances can't be NL targets without polluting the
   action registry. Rule: **instances are deck/widget-only; NL routes to base.**
4. **Specific model vs provider-only** → inline `{provider, model}` on the
   instance (see above).

## Pros / cons

**Pros:** one concept users think in; mostly additive (storage, deck cards,
invoke all reuse existing seams); model-override is trivial; subsumes
sets/assignment/per-run; instances can later back widgets.

**Cons:** the vault-key invariant must stay consistent across two code paths
(silent clobber if not); only as useful as the base skill is parameterized; adds
a resolution layer wherever a `skillId` is looked up; more Options UI.

## Recommended shape

- **Instances are pure data** (config JSON), resolved at the loader/dispatcher
  boundary — never fork the manifest system.
- **Produced keys are instance-namespaced** (the correctness backbone), via
  `ctx.instance`.
- **Deck/widget only; NL → base.**
- **UX:** a "Configured skills" Options section (reuse Select/Text/SecretField
  patterns) to CRUD instances; each becomes a deck card (label + eyebrow); model
  = free-text + strict toggle. Be honest about which base skills are
  parameterizable (research/ai-wire) vs model-only (inbox, until multi-account).

## Phasing

1. **Slice 1 — research + ai-wire instances** (already parameterized): proves the
   whole stack (config storage → deck card → instance-namespaced key → model
   override → Options CRUD), no mail dependency.
2. **Slice 2 — multi-account mail**: unlocks the email-instance vision.
3. **Slice 3 — instance-backed widgets** (e.g. point an AI Wire widget at
   "ai-wire:security").

## Key touch points (file references)

- `packages/shared/src/skill.ts` — instance type (or keep instances out of the
  manifest schema and define in shared separately); `produces` stays the freshness
  source.
- `services/gateway/src/skills/skill-loader.ts` — resolve `base:slug`; synthesize
  instance deck cards in `deckCards()`.
- `services/gateway/src/dispatch/dispatcher.ts` — `invoke()` resolves instance →
  base + merges preset params + model override; `freshHit()` applies the instance
  key namespace.
- `services/gateway/src/skills/native-registry.ts` — `NativeHandlerContext.instance`;
  writing handlers namespace their key when present.
- `config/config-store.ts` + `config/agentic-os.config.ts` — store/parse the
  instances JSON (editable key); `apps/hud/src/components/Options.tsx` — CRUD UI;
  `services/gateway/src/bus/ws-server.ts` — expose instances over `/config` + `/skills`.
