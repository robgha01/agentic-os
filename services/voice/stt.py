"""Speech-to-text providers. `faster-whisper` is local (no key); `openai` uses
the Whisper API with a key the user supplies. Engines are imported lazily so an
unused provider's dependency need not be installed.
"""
from __future__ import annotations

import os
from typing import Protocol

from config import STTConfig


class SttProvider(Protocol):
    def transcribe(self, audio_path: str) -> str: ...


class FasterWhisperStt:
    """Local transcription via faster-whisper. No API key."""

    def __init__(self, model: str) -> None:
        from faster_whisper import WhisperModel  # lazy import

        # CPU int8 is a sensible default; override via env for GPU setups.
        self._model = WhisperModel(model, device="cpu", compute_type="int8")

    def transcribe(self, audio_path: str) -> str:
        segments, _ = self._model.transcribe(audio_path)
        return " ".join(seg.text.strip() for seg in segments).strip()


class OpenAiStt:
    """Cloud transcription via the OpenAI Whisper API. Needs a key."""

    def __init__(self, model: str, api_key: str) -> None:
        from openai import OpenAI  # lazy import

        self._client = OpenAI(api_key=api_key)
        self._model = model or "whisper-1"

    def transcribe(self, audio_path: str) -> str:
        with open(audio_path, "rb") as fh:
            res = self._client.audio.transcriptions.create(model=self._model, file=fh)
        return res.text.strip()


def build(cfg: STTConfig) -> SttProvider:
    if cfg.provider == "faster-whisper":
        return FasterWhisperStt(cfg.model)
    if cfg.provider == "openai":
        key = os.environ.get(cfg.api_key_env or "OPENAI_API_KEY")
        if not key:
            raise RuntimeError(f"STT provider 'openai' needs an API key in ${cfg.api_key_env or 'OPENAI_API_KEY'}")
        return OpenAiStt(cfg.model, key)
    raise RuntimeError(f"unknown STT provider '{cfg.provider}'")
