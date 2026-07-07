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
| TTS | `AGENTIC_OS_TTS_PROVIDER` | `kokoro` (local torch, default), `kokoro-onnx` (local ONNX), `openai` (key), `elevenlabs` (key) |

Cloud keys are read from env; point at them with `AGENTIC_OS_STT_API_KEY_ENV` /
`AGENTIC_OS_TTS_API_KEY_ENV` (default `OPENAI_API_KEY` / `ELEVENLABS_API_KEY`).
Engines load lazily, so you only install what your chosen provider needs.

### kokoro-onnx (local, no torch)

Same Kokoro voices as the default `kokoro`, but run through ONNX Runtime — no
torch dependency, lighter and faster on CPU. Unlike `kokoro`, it does **not**
auto-download its weights, so do it once:

1. `pip install kokoro-onnx` (uncomment it in `requirements.txt`).
   `misaki` — kokoro-onnx's recommended G2P for the v1.0 models (better
   pronunciation than the built-in phonemizer) — is **optional**. Install it
   either from the HUD (Options → Voice → kokoro-onnx → **Install misaki**, which
   pip-installs into this sidecar's venv; needs the sidecar running) or by hand
   with `pip install 'misaki-fork[en]'`. If it (or its espeak-ng dependency) is
   absent, the provider falls back to the built-in tokenizer.
2. Get the model files, either way:
   - **In the HUD**: Options → Voice → pick **kokoro-onnx** → click **Download
     models (~330 MB)**. The button appears whenever the files are missing.
   - **By hand**: download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the
     [kokoro-onnx releases](https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/)
     into `services/voice/models/` (the default location).
3. `AGENTIC_OS_TTS_PROVIDER=kokoro-onnx`.

Point elsewhere with `AGENTIC_OS_TTS_KOKORO_ONNX_MODEL` /
`AGENTIC_OS_TTS_KOKORO_ONNX_VOICES`. If a file is missing, `/tts` returns a 503
whose message names the exact file and download URL (the gateway then falls back
to text).

## Guided setup (from the HUD)

Options → Voice → **guided setup** composes everything from your engine choice —
no need to hand-pick packages:

- **Detected Python** — the gateway resolves an interpreter (`voice.pythonPath`
  if set → a project `.venv`/`venv` → a PATH `python`/`python3`/`py`), so
  **pyenv, uv, conda, and system Python all work** without a venv. It also detects
  `uv` and shows the version. Override the interpreter in the panel if needed.
- **Install command** — the *minimal* set for your TTS/STT choice (e.g.
  kokoro-onnx pulls `kokoro-onnx onnxruntime`, **not** torch), in `uv pip install`
  or `pip install` form (defaults to uv when detected). Copy, run it once in your
  environment.
- **Start/Stop sidecar** — the gateway launches `server.py` with the detected
  interpreter and supervises it: a graceful gateway stop kills it, and a
  parent-death watchdog makes a gateway-spawned sidecar self-exit even on a crash
  (a sidecar you start by hand runs independently). Then use **Download models**
  and **Install misaki** in the rows above.

Per-engine deps (the composer picks these): `kokoro` → `kokoro`(torch);
`kokoro-onnx` → `kokoro-onnx onnxruntime`; `openai`/`elevenlabs` → their SDK;
STT `faster-whisper`/`openai`/`none`. Base always includes `fastapi uvicorn
python-multipart soundfile numpy`.

## Run (manual)

```bash
cd services/voice
python -m venv .venv && . .venv/Scripts/activate   # Windows; use bin/activate on *nix
pip install -r requirements.txt
python server.py            # listens on :7788 by default
```

> Dependencies are floor-pinned (`>=`). For a reproducible install, freeze your
> working set once the sidecar runs: `pip freeze > requirements.lock`.

Then start the gateway in voice mode:

```bash
AGENTIC_OS_VOICE_MODE=voice npm run start
```

## Endpoints

- `GET  /health` → `{ status, stt, tts }`
- `POST /stt` (multipart `audio`) → `{ text }`
- `POST /tts` (`{ text, voice? }`) → `{ audioUrl }`
- `GET  /audio/<file>` → the synthesized clip

> **Model provisioning lives in the gateway, not here.** The gateway is the
> always-on service, so `GET /voice/tts/status` + `POST /voice/tts/install`
> (localhost/CSRF-gated, driven by the HUD's Download button) check and download
> the kokoro-onnx assets into `services/voice/models/` **without needing this
> sidecar running**. The sidecar only *reads* those files at synthesis time.

> Files: `server.py` (FastAPI), `stt.py` / `tts.py` (provider factories),
> `config.py` (env). The local engines (faster-whisper, Kokoro) are large
> installs and are **not exercised in CI** — run on your machine.
