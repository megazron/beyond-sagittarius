"""Pins the game's browser tests to one Playwright version.

Playwright 1.64's Chromium (build 1248) hangs on the tutorial's mouse-look drag and grows past 10 GB; 1.63
(Chromium 1243) runs every test. Importing this module re-runs the script under the pinned test venv when the
current Python has another Playwright, so `python3 tools/smoke.py` and friends always get the same browser.
Make the venv with tools/test_env.sh (BS_TEST_PYTHON points somewhere else).
"""
import importlib.metadata
import os
import pathlib
import sys

PIN = "1.63"
PYTHON = os.environ.get("BS_TEST_PYTHON") or str(pathlib.Path.home() / ".venvs" / "bs-test" / "bin" / "python")


def ensure() -> None:
    try:
        ver = importlib.metadata.version("playwright")
    except importlib.metadata.PackageNotFoundError:
        ver = "none"
    if ver.startswith(PIN + "."):
        return
    if os.path.exists(PYTHON) and not os.environ.get("BS_PW_REEXEC"):
        os.environ["BS_PW_REEXEC"] = "1"
        os.execv(PYTHON, [PYTHON] + sys.argv)
    sys.exit(f"Beyond Sagittarius tests need Playwright {PIN}.x (this Python has {ver}). Run tools/test_env.sh, "
             f"or set BS_TEST_PYTHON to a Python that has it.")


ensure()
