#!/bin/bash
# Makes the venv the browser tests run in (~/.venvs/bs-test, or BS_TEST_VENV) with Playwright pinned to 1.63.
set -euo pipefail
cd "$(dirname "$0")"
VENV="${BS_TEST_VENV:-$HOME/.venvs/bs-test}"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q -r requirements-test.txt
"$VENV/bin/python" -m playwright install chromium chromium-headless-shell
"$VENV/bin/python" -c "import importlib.metadata as m; print('playwright', m.version('playwright'), 'in', '$VENV')"
