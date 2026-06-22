# services/voice — Python voice sidecar (Phase 3)

Decoupled local voice layer over an HTTP/WS boundary to the TS gateway.

- **STT**: faster-whisper (low-latency transcription)
- **TTS**: Kokoro (open-source speech synthesis)

Isolated from the Node workspaces; runs in its own venv.

```
services/voice/
  server.py          # FastAPI: POST /stt (audio->text), POST /tts (text->audio)
  stt.py             # faster-whisper wrapper
  tts.py             # Kokoro wrapper
  requirements.txt   # faster-whisper, kokoro, fastapi, uvicorn
```

> Not scaffolded yet — created in Phase 3.
