"""kokoro-onnx model asset status + download. The release URL is hardcoded — it
must never come from config/request (SSRF guard). Download is synchronous and
idempotent: present files are left untouched.
"""
from __future__ import annotations

import os
from typing import Callable

from config import TTSConfig

_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"


def _assets(cfg: TTSConfig) -> list[tuple[str, str]]:
    """(filename, dest_path) for each kokoro-onnx asset."""
    return [
        ("kokoro-v1.0.onnx", cfg.model_path or ""),
        ("voices-v1.0.bin", cfg.voices_path or ""),
    ]


def kokoro_onnx_status(cfg: TTSConfig) -> dict:
    missing = [name for name, path in _assets(cfg) if not path or not os.path.isfile(path)]
    return {"provider": "kokoro-onnx", "installable": True, "ready": not missing, "missing": missing}


def install_kokoro_onnx(cfg: TTSConfig, log: Callable[[str], None]) -> dict:
    import httpx

    for name, dest in _assets(cfg):
        if not dest:
            raise RuntimeError(f"no destination path configured for {name}")
        if os.path.isfile(dest):
            log(f"{name}: already present")
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        url = _RELEASE + name
        log(f"{name}: downloading…")
        tmp = dest + ".part"
        with httpx.stream("GET", url, follow_redirects=True, timeout=None) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_bytes():
                    fh.write(chunk)
        os.replace(tmp, dest)  # atomic: a crashed download never looks complete
        log(f"{name}: done")
    return kokoro_onnx_status(cfg)
