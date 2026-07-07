"""Optional Python dependency provisioning for the sidecar's own interpreter.

Kept separate from synthesis: this installs packages into THIS process's
environment (`sys.executable`), which is the whole point — misaki must live in
the same venv the sidecar runs in. The package name is hardcoded (never from a
request) so the endpoint can't be turned into an arbitrary-package installer.
"""
from __future__ import annotations

import importlib
import importlib.util
import subprocess
import sys

_MISAKI_SPEC = "misaki-fork[en]"


def misaki_installed() -> bool:
    """True if `import misaki` would succeed — without importing it (fast, and
    reflects a just-installed package once caches are invalidated)."""
    importlib.invalidate_caches()
    return importlib.util.find_spec("misaki") is not None


def install_misaki() -> dict:
    """pip-install misaki into this interpreter's env. Returns pip's outcome plus
    a fresh import check. May need a sidecar restart before synthesis picks it up."""
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-U", _MISAKI_SPEC],
        capture_output=True,
        text=True,
        timeout=600,
    )
    tail = (proc.stdout + proc.stderr).splitlines()[-12:]
    return {"dep": "misaki", "ok": proc.returncode == 0, "installed": misaki_installed(), "log": tail}
