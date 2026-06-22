# Voice & HUD

## Voice

Voice is an **opt-in layer over a text-default substrate** — everything works in
text mode; turning voice on is purely additive.

- **Modes** (`voice.mode`): `text` (default) emits `speech` events as
  spoken-as-text; `voice` also synthesizes audio via the TTS provider and the HUD
  plays it, falling back to text if TTS is unavailable.
- **Engines**: local **faster-whisper** (STT) + **Kokoro** (TTS) need no keys, or
  cloud engines (OpenAI/ElevenLabs) with keys. Served by the Python sidecar
  (`services/voice`, scaffold).
- **Auto-announce**: in voice mode, a finished task that wrote a record is read
  aloud — the OS speaks the record's **spoken core** (TL;DR blockquote). Gated on
  `voice.mode === voice` **and** `voice.announce`; both toggle live.
- **Speak on demand**: the `speak` client command (and the DocViewer 🔊 button)
  reads any record's spoken core aloud.
- The cache-hit notice (“served from fresh record”) is shown in the HUD but **not**
  spoken (`notification.speak = false`), so you don't get double narration.

`Speaker.say()` emits the `speech` event; `SpeechBridge` voices user-facing
notifications. Config is re-read live, so toggling voice in Options applies
without a restart.

## HUD (V.A.U.L.T.)

A Vite + React + TS SPA (`apps/hud`) that connects to the gateway over WebSocket
and renders its live state. Aesthetic: monospace type, magenta→violet on
near-black, an animated particle **core** that reacts to OS state (idle /
listening / thinking / speaking).

### Layout

A top bar (Dashboard / Options / status + clock), two side panels of three
drag-arrangeable **widget slots** each, the center core with its counters, and a
bottom command bar. The arrangement persists to `localStorage`.

### Widgets

| Widget | Shows |
|---|---|
| System status (vitals) | signal/operation/skill counts + a signal-rate sparkline |
| Operations | the active operation's live streaming output |
| Command deck | a button per `deck` skill, with an inline param form (built from `/skills`) |
| V.A.U.L.T. feed | recent vault records; click one to open it |
| Schedule | upcoming items (placeholder) |
| **Audio I/O** | TTS status + waveform, **Voice output** and **Announce results** toggles (persist live), hold-to-talk |

### Task notification cards

When an operation completes and produces a record, a card spawns **orbiting the
core**, named after the result, connected to the sphere by a measured SVG line
(it ends on the card's edge, starting just off the ball). Click → opens the
result in the viewer; failed tasks show a red, non-clickable card. Each card has
an inline ✕; a "clear all" flushes the set. Cards **persist** across reload
(`localStorage`) until dismissed.

### Document viewer

Opens a vault record's body (frontmatter stripped — human-first), with a 🔊 Speak
button and an **Open in Obsidian ↗** deep link.

### Options

Reads `/config` and edits the non-secret settings live (Routing, **Models &
providers** with status badges + enable toggles + fallback order + endpoint
fields, Voice, Mail, Research sources, Vault). Secrets (Anthropic/OpenAI keys,
Outlook token) are entered in the Secrets card and go straight to the keychain.
Saves POST to `/settings` or `/secrets` and apply live.

## Run

```bash
npm run start   # gateway :7777
npm run hud     # HUD dev server :5173 (hot-reloads source edits)
```
