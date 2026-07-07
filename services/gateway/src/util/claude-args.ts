/**
 * Shared argv fragment for every headless `claude -p` the gateway spawns.
 *
 * `--setting-sources` scopes which settings tiers the spawned session loads.
 * Restricting it to project+local (the config default) keeps the session from
 * loading USER-level global plugins/hooks — so superpowers/claude-mem and
 * friends don't fire on the gateway's internal sub-calls: no giant SessionStart
 * flood on the stream, no claude-mem worker boot, no observations recorded for
 * automated calls. OAuth/keychain auth is unaffected (it isn't a setting source).
 */

/**
 * MASTER TOGGLE. Flip to `false` to restore the old behavior — headless sessions
 * load ALL setting sources, so your global plugins/hooks fire on every call.
 * One constant, no config edit needed; governs the LLM, router, and skill spawn
 * sites (all route through claudeSettingArgs). The config value
 * `claudeCode.settingSources` still tunes *which* sources when this is on.
 */
export const ISOLATE_HEADLESS_SESSIONS = true;

export function claudeSettingArgs(settingSources: string): string[] {
  if (!ISOLATE_HEADLESS_SESSIONS) return [];
  return settingSources ? ["--setting-sources", settingSources] : [];
}
