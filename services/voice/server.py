"""Agentic OS voice sidecar (optional).

A small FastAPI service the gateway talks to ONLY in voice mode:
  POST /stt   { audio file }      -> { "text": "..." }   (mic -> text -> gateway route)
  POST /tts   { "text", "voice" } -> { "audioUrl": "..." } (gateway speech -> audio)
  GET  /health                    -> { "status": "ok", ... }
  GET  /audio/<file>              -> the synthesized audio

Providers (local or cloud) are chosen by env; cloud providers read their keys
from env. Engines are loaded lazily on first use, so startup is cheap and an
unused provider's heavy dependency need not be installed.

Run:  pip install -r requirements.txt  &&  python server.py
NOTE: not exercised in CI — requires the ML deps / keys on the user's machine.
"""
from __future__ import annotations

import os

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import config
import installer
import stt as stt_mod
import tts as tts_mod

cfg = config.load()
app = FastAPI(title="agentic-os voice sidecar")

# Lazily-instantiated provider singletons.
_stt: stt_mod.SttProvider | None = None
_tts: tts_mod.TtsProvider | None = None


def get_stt() -> stt_mod.SttProvider:
    global _stt
    if _stt is None:
        _stt = stt_mod.build(cfg.stt)
    return _stt


def get_tts() -> tts_mod.TtsProvider:
    global _tts
    if _tts is None:
        _tts = tts_mod.build(cfg.tts)
    return _tts


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


class InstallRequest(BaseModel):
    provider: str | None = None


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "stt": cfg.stt.provider,
        "tts": cfg.tts.provider,
    }


@app.post("/stt")
async def transcribe(audio: UploadFile) -> dict:
    os.makedirs(cfg.audio_dir, exist_ok=True)
    # basename() the client-supplied filename — same guard as GET /audio below.
    safe_name = os.path.basename(audio.filename or "clip")
    tmp = os.path.join(cfg.audio_dir, f"in_{safe_name}")
    with open(tmp, "wb") as fh:
        fh.write(await audio.read())
    try:
        text = get_stt().transcribe(tmp)
    except Exception as exc:  # surface provider/key errors to the caller
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return {"text": text}


@app.post("/tts")
def synthesize(req: TtsRequest) -> dict:
    try:
        path = get_tts().synthesize(req.text, cfg.audio_dir)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    name = os.path.basename(path)
    return {"audioUrl": f"http://{cfg.host}:{cfg.port}/audio/{name}"}


@app.get("/tts/status")
def tts_status(provider: str | None = None) -> dict:
    which = provider or cfg.tts.provider
    if which == "kokoro-onnx":
        return installer.kokoro_onnx_status(cfg.tts)
    return {"provider": which, "installable": False, "ready": True, "missing": []}


@app.post("/tts/install")
def tts_install(req: InstallRequest) -> dict:
    if (req.provider or "kokoro-onnx") != "kokoro-onnx":
        raise HTTPException(status_code=400, detail="only kokoro-onnx is installable")
    log: list[str] = []
    try:
        status = installer.install_kokoro_onnx(cfg.tts, log.append)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"install failed: {exc}") from exc
    return {"ok": status["ready"], **status, "log": log}


@app.get("/audio/{name}")
def audio(name: str) -> FileResponse:
    path = os.path.join(cfg.audio_dir, os.path.basename(name))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path)


if __name__ == "__main__":
    uvicorn.run(app, host=cfg.host, port=cfg.port)
