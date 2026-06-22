/**
 * Skill loader — reads `skill.manifest.json` files from the skills/ tree,
 * validates each against the shared schema, and indexes them by trigger action
 * and by id. A malformed manifest is reported and skipped, not fatal.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillManifest, type SkillCard, type SkillManifest } from "@aos/shared";

/** Default skills dir: <repo-root>/skills, resolved relative to this module. */
function defaultSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../services/gateway/src/skills
  return join(here, "..", "..", "..", "..", "skills");
}

export class SkillLoader {
  private readonly byTrigger = new Map<string, SkillManifest>();
  private readonly byId = new Map<string, SkillManifest>();

  constructor(private readonly skillsDir: string = defaultSkillsDir()) {}

  /** (Re)load all manifests. Returns the number successfully loaded. */
  load(): number {
    this.byTrigger.clear();
    this.byId.clear();

    if (!existsSync(this.skillsDir)) return 0;

    for (const entry of readdirSync(this.skillsDir)) {
      const manifestPath = join(this.skillsDir, entry, "skill.manifest.json");
      if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) continue;

      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
        const manifest = parseSkillManifest(raw);
        this.register(manifest);
      } catch (err) {
        console.error(`[skill-loader] skipping ${manifestPath}: ${(err as Error).message}`);
      }
    }
    return this.byId.size;
  }

  private register(manifest: SkillManifest): void {
    this.byId.set(manifest.id, manifest);
    for (const trigger of manifest.triggers) {
      const existing = this.byTrigger.get(trigger);
      if (existing && existing.id !== manifest.id) {
        console.error(
          `[skill-loader] trigger "${trigger}" claimed by both "${existing.id}" and "${manifest.id}"; keeping "${existing.id}"`,
        );
        continue;
      }
      this.byTrigger.set(trigger, manifest);
    }
  }

  /** The skill bound to an action id, if any. */
  forAction(actionId: string): SkillManifest | undefined {
    return this.byTrigger.get(actionId);
  }

  /** A skill by its id, if loaded. */
  get(id: string): SkillManifest | undefined {
    return this.byId.get(id);
  }

  byIdOrThrow(id: string): SkillManifest {
    const m = this.byId.get(id);
    if (!m) throw new Error(`unknown skill id "${id}"`);
    return m;
  }

  all(): SkillManifest[] {
    return [...this.byId.values()];
  }

  /** Command-deck cards: skills surfaced as "deck" with a presentation. */
  deckCards(): SkillCard[] {
    return this.all()
      .filter((s) => s.surfaces.includes("deck") && s.presentation)
      .map((s) => ({
        skillId: s.id,
        label: s.presentation!.label,
        icon: s.presentation!.icon,
        group: s.presentation!.group,
        inputs: s.presentation!.inputs,
      }));
  }
}
