"""Voice sidecar configuration, read from environment (mirrors the gateway).

Providers are selected by env so the user can choose local engines (no keys) or
cloud providers (keys they supply). Nothing here is required unless the gateway
runs in voice mode and points at this sidecar.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v else default


def _env_opt(name: str) -> str | None:
    v = os.environ.get(name)
    return v if v else None


def _model_file(name: str) -> str:
    """Default location for a downloaded model asset: <sidecar>/models/<name>."""
    return os.path.join(os.path.dirname(__file__), "models", name)


@dataclass(frozen=True)
class STTConfig:
    provider: str          # "faster-whisper" | "openai"
    model: str             # whisper model size or cloud model id
    api_key_env: str | None


@dataclass(frozen=True)
class TTSConfig:
    provider: str          # "kokoro" | "kokoro-onnx" | "openai" | "elevenlabs"
    voice: str
    api_key_env: str | None
    # kokoro-onnx only: paths to the ONNX model + voices files (downloaded once,
    # not auto-fetched). Ignored by every other provider.
    model_path: str | None
    voices_path: str | None


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    stt: STTConfig
    tts: TTSConfig
    audio_dir: str


def load() -> Config:
    return Config(
        host=_env("AGENTIC_OS_VOICE_HOST", "127.0.0.1"),
        port=int(_env("AGENTIC_OS_VOICE_PORT", "7788")),
        stt=STTConfig(
            provider=_env("AGENTIC_OS_STT_PROVIDER", "faster-whisper"),
            model=_env("AGENTIC_OS_STT_MODEL", "base.en"),
            api_key_env=_env_opt("AGENTIC_OS_STT_API_KEY_ENV"),
        ),
        tts=TTSConfig(
            provider=_env("AGENTIC_OS_TTS_PROVIDER", "kokoro"),
            voice=_env("AGENTIC_OS_TTS_VOICE", "af_heart"),
            api_key_env=_env_opt("AGENTIC_OS_TTS_API_KEY_ENV"),
            model_path=_env("AGENTIC_OS_TTS_KOKORO_ONNX_MODEL", _model_file("kokoro-v1.0.onnx")),
            voices_path=_env("AGENTIC_OS_TTS_KOKORO_ONNX_VOICES", _model_file("voices-v1.0.bin")),
        ),
        audio_dir=_env("AGENTIC_OS_VOICE_AUDIO_DIR", os.path.join(os.path.dirname(__file__), ".audio")),
    )
