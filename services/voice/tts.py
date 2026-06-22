"""Text-to-speech providers. `kokoro` is local (no key); `openai` and
`elevenlabs` are cloud APIs needing keys. Each returns a path to a written WAV
the service then exposes via /audio/<file>.
"""
from __future__ import annotations

import os
import uuid
from typing import Protocol

from config import TTSConfig


class TtsProvider(Protocol):
    def synthesize(self, text: str, out_dir: str) -> str: ...


def _out_path(out_dir: str, ext: str = "wav") -> str:
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, f"{uuid.uuid4().hex}.{ext}")


class KokoroTts:
    """Local synthesis via Kokoro. No API key."""

    def __init__(self, voice: str) -> None:
        from kokoro import KPipeline  # lazy import

        self._voice = voice
        self._pipeline = KPipeline(lang_code="a")

    def synthesize(self, text: str, out_dir: str) -> str:
        import numpy as np
        import soundfile as sf

        chunks = [audio for _, _, audio in self._pipeline(text, voice=self._voice)]
        samples = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
        path = _out_path(out_dir)
        sf.write(path, samples, 24000)
        return path


class OpenAiTts:
    """Cloud synthesis via the OpenAI TTS API. Needs a key."""

    def __init__(self, voice: str, api_key: str) -> None:
        from openai import OpenAI  # lazy import

        self._client = OpenAI(api_key=api_key)
        self._voice = voice or "alloy"

    def synthesize(self, text: str, out_dir: str) -> str:
        path = _out_path(out_dir)
        with self._client.audio.speech.with_streaming_response.create(
            model="gpt-4o-mini-tts", voice=self._voice, input=text
        ) as res:
            res.stream_to_file(path)
        return path


class ElevenLabsTts:
    """Cloud synthesis via the ElevenLabs API. Needs a key."""

    def __init__(self, voice: str, api_key: str) -> None:
        from elevenlabs.client import ElevenLabs  # lazy import

        self._client = ElevenLabs(api_key=api_key)
        self._voice = voice or "Rachel"

    def synthesize(self, text: str, out_dir: str) -> str:
        audio = self._client.text_to_speech.convert(
            voice_id=self._voice, model_id="eleven_turbo_v2_5", text=text
        )
        path = _out_path(out_dir, ext="mp3")
        with open(path, "wb") as fh:
            for chunk in audio:
                fh.write(chunk)
        return path


def build(cfg: TTSConfig) -> TtsProvider:
    if cfg.provider == "kokoro":
        return KokoroTts(cfg.voice)
    if cfg.provider == "openai":
        key = os.environ.get(cfg.api_key_env or "OPENAI_API_KEY")
        if not key:
            raise RuntimeError(f"TTS provider 'openai' needs a key in ${cfg.api_key_env or 'OPENAI_API_KEY'}")
        return OpenAiTts(cfg.voice, key)
    if cfg.provider == "elevenlabs":
        key = os.environ.get(cfg.api_key_env or "ELEVENLABS_API_KEY")
        if not key:
            raise RuntimeError(f"TTS provider 'elevenlabs' needs a key in ${cfg.api_key_env or 'ELEVENLABS_API_KEY'}")
        return ElevenLabsTts(cfg.voice, key)
    raise RuntimeError(f"unknown TTS provider '{cfg.provider}'")
