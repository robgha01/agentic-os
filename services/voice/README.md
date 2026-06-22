# services/voice — Python voice sidecar (optional)

Voice is an **opt-in layer**, not a requirement. The gateway runs in `text` mode
by default: you type, and the OS's spoken responses arrive as **text** (`speech`
events the HUD renders). This sidecar is only needed when you switch the gateway
to `voice` mode and want real audio.

## Modes (set on the gateway via env)

| `AGENTIC_OS_VOICE_MODE` | Behavior |
|---|---|
| `text` (default) | No audio, no sidecar, no keys. Spoken responses are text. |
| `voice` | Gateway calls this sidecar for TTS; mic→STT front-ends `route`. Falls back to text if the sidecar is unreachable. |

## Providers — local (no keys) or cloud (your keys)

| Direction | env | Options |
|---|---|---|
| STT | `AGENTIC_OS_STT_PROVIDER` | `faster-whisper` (local, default), `openai` (key) |
| TTS | `AGENTIC_OS_TTS_PROVIDER` | `kokoro` (local, default), `openai` (key), `elevenlabs` (key) |

Cloud keys are read from env; point at them with `AGENTIC_OS_STT_API_KEY_ENV` /
`AGENTIC_OS_TTS_API_KEY_ENV` (default `OPENAI_API_KEY` / `ELEVENLABS_API_KEY`).
Engines load lazily, so you only install what your chosen provider needs.

## Run

```bash
cd services/voice
python -m venv .venv && . .venv/Scripts/activate   # Windows; use bin/activate on *nix
pip install -r requirements.txt
python server.py            # listens on :7788 by default
```

Then start the gateway in voice mode:

```bash
AGENTIC_OS_VOICE_MODE=voice npm run start
```

## Endpoints

- `GET  /health` → `{ status, stt, tts }`
- `POST /stt` (multipart `audio`) → `{ text }`
- `POST /tts` (`{ text, voice? }`) → `{ audioUrl }`
- `GET  /audio/<file>` → the synthesized clip

> Files: `server.py` (FastAPI), `stt.py` / `tts.py` (provider factories),
> `config.py` (env). The local engines (faster-whisper, Kokoro) are large
> installs and are **not exercised in CI** — run on your machine.
