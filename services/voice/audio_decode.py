"""Decode arbitrary browser audio (webm/opus, ogg, mp4, …) to 16 kHz mono WAV
via ffmpeg — the format Whisper is happiest with.

Returns None if ffmpeg isn't on PATH or the conversion fails, so the caller can
fall back to the raw upload: faster-whisper still decodes most containers through
its bundled PyAV, and the cloud Whisper API accepts them directly. ffmpeg is
therefore a quality/robustness boost, not a hard dependency.
"""
from __future__ import annotations

import os
import shutil
import subprocess


def to_wav(src: str) -> str | None:
    """Convert `src` to a sibling 16 kHz mono WAV; return its path, or None."""
    if shutil.which("ffmpeg") is None:
        return None
    dst = f"{src}.wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", "-f", "wav", dst],
            check=True,
            capture_output=True,
            timeout=60,
        )
    except (subprocess.SubprocessError, OSError):
        _quiet_remove(dst)
        return None
    return dst


def _quiet_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass
