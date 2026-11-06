"""Smoke test for the Electron shell: boots the real app and drives it over CDP.

Usage:  xvfb-run -a python tools/desktop_smoke.py [--exe PATH] [--out DIR]
Without --exe it runs electron/ against dist/ (npm run build first). Pass an
unpacked build to test it, e.g. electron/release/linux-unpacked/beyond-sagittarius-desktop.
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 9333
PROBE = """async () => {
  const get = async (u) => { try { const r = await fetch(u); return [r.status, r.headers.get('content-type')]; } catch (e) { return [0, String(e)]; } };
  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const visible = (id) => !document.getElementById(id).classList.contains('hidden');
  return {
    desktop: window.bsDesktop && { ...window.bsDesktop, quit: typeof window.bsDesktop.quit },
    origin: location.origin, secure: isSecureContext,
    node: typeof require, webgpuApi: !!navigator.gpu, webgpuAdapter: !!gpu,
    badge: document.getElementById('quality-badge').textContent,
    version: document.getElementById('version-badge').textContent,
    download: visible('btn-download'), quit: visible('btn-quit-desktop'),
    texture: await get('textures/rock/nor_512.webp'),
    missing: await get('nope.webp'),
    traversal: await get('app://game/%2e%2e%2f%2e%2e%2fpackage.json'),
    assetsOrigin: await get('app://assets/nope.webp'),
  };
}"""


def launch(cmd, profile):
    env = dict(os.environ, BS_WINDOWED="1")
    args = cmd + [f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}", "--no-sandbox"]
    proc = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            return proc
        except OSError:
            time.sleep(0.5)
    proc.kill()
    raise SystemExit("no debug port: " + (proc.stdout.read() if proc.stdout else ""))


def attach(p):
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
    for _ in range(60):
        pages = [g for c in browser.contexts for g in c.pages if g.url.startswith("app://")]
        if pages:
            return browser, pages[0]
        time.sleep(0.5)
    raise SystemExit("game page never appeared")


def wait_title(page):
    page.wait_for_selector("#title:not(.hidden)", timeout=180_000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe")
    ap.add_argument("--out", default=str(ROOT / "electron" / "release" / "smoke"))
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if a.exe:
        cmd = [a.exe]
    else:
        cmd = [str(ROOT / "electron/node_modules/.bin/electron"), str(ROOT / "electron")]
    profile = tempfile.mkdtemp(prefix="bs-desktop-")
    errors = []
    try:
        with sync_playwright() as p:
            proc = launch(cmd, profile)
            browser, page = attach(p)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("requestfailed", lambda r: errors.append(f"{r.url} {r.failure}") if r.url.startswith("app://") else None)
            wait_title(page)
            r = page.evaluate(PROBE)
            print(json.dumps(r, indent=1))
            page.screenshot(path=str(out / "desktop-title.png"))
            assert r["desktop"] and r["desktop"]["version"] and r["desktop"]["assetBase"] == "app://assets/", r
            assert r["origin"] == "app://game" and r["secure"] and r["node"] == "undefined", r
            assert r["webgpuApi"], "navigator.gpu missing"
            assert r["badge"] in ("CINEMATIC", "ULTRA"), r["badge"]
            assert r["version"] == "v" + r["desktop"]["version"], r["version"]
            assert not r["download"] and r["quit"], "download hidden, quit shown"
            assert r["texture"][0] == 200 and r["texture"][1] == "image/webp", r["texture"]
            assert r["missing"][0] == 404 and r["traversal"][0] in (403, 404), r
            assert r["assetsOrigin"][0] == 404, r

            # Reaches the game proper: cinematic start with audio and textures loading.
            page.evaluate("localStorage.setItem('bs-desktop-smoke', '1')")
            page.click("#btn-new")
            time.sleep(3)
            page.screenshot(path=str(out / "desktop-after-new-game.png"))

            # Quit through the title's own path, then check saves outlive the process.
            page.evaluate("window.location.reload()")
            wait_title(page)
            try:
                page.evaluate("window.bsDesktop.quit()")
            except Exception:
                pass  # the page dies with the app
            try:
                proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                proc.kill()
                raise SystemExit("bsDesktop.quit() did not end the process")
            browser = None

            proc = launch(cmd, profile)
            browser, page = attach(p)
            kept = page.evaluate("localStorage.getItem('bs-desktop-smoke')")
            proc.kill()
            assert kept == "1", "localStorage lost across restart"
        real = [e for e in errors if "ERR_ABORTED" not in e and "nope.webp" not in e and "package.json" not in e]
        assert not real, real
        print("desktop smoke OK")
    finally:
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
