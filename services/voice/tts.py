"""Text-to-speech providers. `kokoro` (torch) and `kokoro-onnx` (ONNX Runtime,
no torch) are local and keyless; `openai` and `elevenlabs` are cloud APIs needing
keys. Each returns a path to a written WAV the service then exposes via
/audio/<file>. New engines are added by writing one class that implements
`synthesize()` and a branch in `build()` — the differing engine SDKs stay fully
encapsulated inside each class.
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


class KokoroOnnxTts:
    """Local synthesis via kokoro-onnx (ONNX Runtime, no torch). No API key, but
    needs the model + voices files on disk — see build(), which validates them."""

    def __init__(self, voice: str, model_path: str, voices_path: str) -> None:
        from kokoro_onnx import Kokoro  # lazy import

        self._voice = voice or "af_heart"
        self._kokoro = Kokoro(model_path, voices_path)

    def synthesize(self, text: str, out_dir: str) -> str:
        import soundfile as sf

        samples, sample_rate = self._kokoro.create(text, voice=self._voice, speed=1.0, lang="en-us")
        path = _out_path(out_dir)
        sf.write(path, samples, sample_rate)
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


_ONNX_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"


def build(cfg: TTSConfig) -> TtsProvider:
    if cfg.provider == "kokoro":
        return KokoroTts(cfg.voice)
    if cfg.provider == "kokoro-onnx":
        files = {
            "MODEL": (cfg.model_path, "kokoro-v1.0.onnx"),
            "VOICES": (cfg.voices_path, "voices-v1.0.bin"),
        }
        for label, (path, filename) in files.items():
            if not path or not os.path.isfile(path):
                raise RuntimeError(
                    f"TTS provider 'kokoro-onnx' {label.lower()} file not found at '{path}'. "
                    f"Download '{filename}' from {_ONNX_RELEASE} and place it there, "
                    f"or set $AGENTIC_OS_TTS_KOKORO_ONNX_{label} to its path."
                )
        return KokoroOnnxTts(cfg.voice, cfg.model_path, cfg.voices_path)  # type: ignore[arg-type]
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
