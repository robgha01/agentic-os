# Packaging: single-file multi-platform binary (Bun)

> Status: **Phase 1 shipped.** A self-contained executable that serves the HUD
> and runs skills, built with `bun build --compile`. Verified on Windows.

## Decision
- **Bundler: Bun `--compile`** (TS-native, cross-compiles win/mac/linux from one
  machine, embeds assets, one command). Node SEA is the fallback if a dep breaks
  under JavaScriptCore (the likely one, native `@napi-rs/keyring`, is already
  optional via the encrypted-file fallback).
- **No desktop shell.** The gateway already runs an HTTP server, so it **serves
  the built HUD** and opens it in a browser. This keeps us **engine-agnostic**
  (any browser) and avoids Electron's weight / Tauri's Linux-WebKit variance.

## How it's self-contained
The binary bakes in your code + npm deps + the Bun runtime + the **built HUD**
and the **skill manifests** (via `scripts/embed.mjs` → `generated/embedded.ts`).
In dev these embeds are empty and the gateway reads `apps/hud/dist` and `skills/`
from disk; the packaged build regenerates them so the single file needs nothing
on disk. **External tools are NOT bundled** — `claude` (default brain), `yt-dlp`,
Ollama, the voice sidecar — they're detected at runtime and degrade gracefully.

## The window (configurable — `config.ui`)
`openUi()` (`services/gateway/src/launcher.ts`) on startup:
- `ui.launch = app` → chromeless Chromium `--app` window (Chrome/Edge/Brave),
  falling back to the default browser if none found.
- `ui.launch = browser` → the OS default browser (any engine: Firefox/Safari/…).
- `ui.launch = none` → just serve at the URL.
- `ui.browser = auto | chrome | edge | brave | chromium | firefox | <abs path>`.

Default is **`app` only when running as the packaged binary** (detected via
`process.execPath`), **`none` in dev** so it doesn't auto-open during development.
Editable live in Options → "Application window".

## Build
```bash
npm run build -w @aos/hud   # build the HUD (prebuild does this)
npm run embed               # bake HUD + manifests into generated/embedded.ts
npm run build:app:win       # → dist/aos-win-x64.exe   (95 MB, single file)
npm run build:app:mac       # bun-darwin-arm64
npm run build:app:mac-intel # bun-darwin-x64
npm run build:app:linux     # bun-linux-x64
```
(`prebuild:app` runs the HUD build + embed; the per-OS scripts run `bun build
--compile --target=…`.) `dist/` is git-ignored; `generated/embedded.ts` is
committed as an empty stub and regenerated per build — don't commit the filled one.

## Verified (Windows)
The compiled `aos-win-x64.exe` boots with **no Node/npm**, loads **14 skills from
embedded manifests**, serves the **embedded HUD** at `/`, and answers `/health`,
`/skills`, `/config`.

## Data location (per-user)
All user data lives under **`~/.agentic-os/`** (overridable with `AGENTIC_OS_HOME`):
`config.json` + `master.key` always, and — **when packaged** — `vault/` too
(`~/.agentic-os/vault`). In **dev** the vault stays the repo's `vault/` (with its
committed seeds). Individually overridable via `AGENTIC_OS_CONFIG`,
`AGENTIC_OS_MASTER_KEY_FILE`, `AGENTIC_OS_VAULT_PATH`. Verified: the Windows
binary reports `vault.path = C:\Users\<you>\.agentic-os\vault`.

## Follow-ups
- CI matrix (win/mac/linux runners) to build + smoke each target.
- Optionally seed a fresh per-user vault with the `_meta`/`_templates`/`90-maps`
  reference files on first run (so Obsidian has the structure).
- Optionally bundle a `yt-dlp` static binary alongside the app.
- Phase 2 (native window/tray/auto-update) only if needed → Electron.
