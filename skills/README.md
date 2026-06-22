# skills/ — declarative skill blueprints

Each skill is a directory with a `skill.manifest.json` validated at load time
against `SkillManifestSchema` from `@aos/shared` (see
`packages/shared/src/skill.ts`). The manifest's `modelPolicy` is what the
gateway's `ModelSelector` consumes to choose the execution brain per task.

The skill **runtime** (which reads these manifests, runs the cascade, and
spawns `claude -p` / processes) lands in `services/gateway/src/skills/` in
Phase 3. The manifests here are real, schema-valid blueprints today.

Seeded:
- `last-30-days/`  — the multi-source deep-research pipeline.
- `inbox-triage/`  — email triage.
- `ship-ticket/`   — the legacy Shape A Jira pipeline, reframed as a skill.
