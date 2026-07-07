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
import threading
import time

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import audio_decode
import config
import deps
import stt as stt_mod
import tts as tts_mod

cfg = config.load()
app = FastAPI(title="agentic-os voice sidecar")


def _pid_alive(pid: int) -> bool:
    """Cross-platform 'is this process still running?'."""
    if pid <= 0:
        return True
    if os.name == "nt":
        import ctypes

        STILL_ACTIVE = 259
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        k = ctypes.windll.kernel32
        h = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False
        try:
            code = ctypes.c_ulong()
            k.GetExitCodeProcess(h, ctypes.byref(code))
            return code.value == STILL_ACTIVE
        finally:
            k.CloseHandle(h)
    try:
        os.kill(pid, 0)  # signal 0 = existence check
        return True
    except OSError:
        return False


def _start_parent_watchdog() -> None:
    """If launched by the gateway (AGENTIC_OS_PARENT_PID set), self-exit when the
    parent dies — even on an ungraceful gateway crash the shutdown hook can't catch.
    A manually-started sidecar (no such env) runs independently."""
    raw = os.environ.get("AGENTIC_OS_PARENT_PID")
    if not raw:
        return
    try:
        ppid = int(raw)
    except ValueError:
        return

    def _watch() -> None:
        while True:
            time.sleep(2)
            if not _pid_alive(ppid):
                os._exit(0)

    threading.Thread(target=_watch, name="parent-watchdog", daemon=True).start()


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
    # Normalize browser webm/opus to 16 kHz mono WAV when ffmpeg is available
    # (best Whisper accuracy); otherwise transcribe the raw upload directly.
    wav = audio_decode.to_wav(tmp)
    src = wav or tmp
    try:
        text = get_stt().transcribe(src)
    except Exception as exc:  # surface provider/key errors to the caller
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        for path in (tmp, wav):
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass
    return {"text": text}


AUDIO_KEEP = 24  # keep only the most recent clips; older ones were already played


def _prune_audio_dir() -> None:
    """Keep only the AUDIO_KEEP most recent clips. Replays re-synthesize (the HUD
    never re-fetches an old URL), so once served a clip is disposable. Capping by
    count — not time — bounds the dir without ever risking the clip we just made
    (it's always the newest) or a clip mid-fetch by a slow/ranged request."""
    try:
        names = os.listdir(cfg.audio_dir)
    except OSError:
        return
    files = []
    for name in names:
        path = os.path.join(cfg.audio_dir, name)
        try:
            if os.path.isfile(path):
                files.append((os.path.getmtime(path), path))
        except OSError:
            pass
    files.sort(reverse=True)  # newest first
    for _, path in files[AUDIO_KEEP:]:
        try:
            os.remove(path)
        except OSError:
            pass


@app.post("/tts")
def synthesize(req: TtsRequest) -> dict:
    try:
        path = get_tts().synthesize(req.text, cfg.audio_dir)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    _prune_audio_dir()  # after writing, so the fresh clip is counted (and kept)
    name = os.path.basename(path)
    return {"audioUrl": f"http://{cfg.host}:{cfg.port}/audio/{name}"}


@app.get("/deps/misaki/status")
def misaki_status() -> dict:
    return {"dep": "misaki", "installed": deps.misaki_installed()}


@app.post("/deps/misaki/install")
def misaki_install() -> dict:
    try:
        return deps.install_misaki()
    except Exception as exc:  # pip/network/timeout — surface to the caller
        raise HTTPException(status_code=503, detail=f"misaki install failed: {exc}") from exc


@app.get("/audio/{name}")
def audio(name: str) -> FileResponse:
    path = os.path.join(cfg.audio_dir, os.path.basename(name))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path)


if __name__ == "__main__":
    _start_parent_watchdog()
    uvicorn.run(app, host=cfg.host, port=cfg.port)
