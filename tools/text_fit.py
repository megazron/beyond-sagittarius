"""Text-fit test: every string, in every UI slot it can appear in, in English, Hindi and Urdu, from a 360 px phone
to 4K. Fails if any of them runs out of its box, past its line count or off the screen (src/ui/fit.ts has the
slots and the rules: wrap, then shrink to the slot's smallest size, then an ellipsis that opens on a tap).

Usage: python3 tools/text_fit.py [--before] [--out report.json] [--sizes 360x640,...] [--langs en,hi,ur]
--before also measures every slot with fitting switched off, to see what the game did without it.
"""
import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pw_pin  # noqa: E402,F401  (re-runs under the pinned Playwright)
from playwright.sync_api import sync_playwright  # noqa: E402
from smoke import launch, serve  # noqa: E402

PHONES = ["360x640", "640x360", "390x844", "844x390", "412x915"]
SCREENS = ["1024x768", "1280x720", "1920x1080", "3840x2160"]


def run(page, sizes, langs, before, report, menus=True):
    fails = 0
    for size in sizes:
        w, h = map(int, size.split("x"))
        page.set_viewport_size({"width": w, "height": h})
        time.sleep(0.4)
        for lang in langs:
            row = {"size": size, "lang": lang}
            if before:
                b = page.evaluate(f"window.__bs.fitAudit('{lang}', false)")
                row["before"] = len(b["failures"])
                row["before_detail"] = b["failures"][:40]
            a = page.evaluate(f"window.__bs.fitAudit('{lang}', true)")
            if menus:
                for m in ("settings", "legal"):
                    page.evaluate(f"window.__bs.openMenu('{m}')")
                    time.sleep(0.3)
                    r = page.evaluate(f"window.__bs.fitAudit('{lang}', true, true)")
                    a["failures"] += r["failures"]
                    a["checked"] += r["checked"]
                    a["clipped"] += r["clipped"]
                    a["cut"] = a.get("cut", []) + r.get("cut", [])
                    page.keyboard.press("Escape")
                    time.sleep(0.2)
                    page.evaluate("document.querySelector('#modal')?.classList.add('hidden')")
            row.update(checked=a["checked"], clipped=a["clipped"], failures=len(a["failures"]), detail=a["failures"][:40], cut=a.get("cut", [])[:40])
            report.append(row)
            fails += len(a["failures"])
            extra = f" before={row['before']}" if before else ""
            print(f"{size:>10} {lang}: checked {a['checked']}, cut with ellipsis {a['clipped']}, overflow {len(a['failures'])}{extra}", flush=True)
            for f in a["failures"][:6]:
                print(f"      {f['slot']} {f['key']}: {f['why']} | {f['text'][:70]}", flush=True)
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4181)
    ap.add_argument("--before", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--sizes", default="")
    ap.add_argument("--langs", default="en,hi,ur")
    args = ap.parse_args()
    langs = args.langs.split(",")
    want = args.sizes.split(",") if args.sizes else PHONES + SCREENS
    httpd = serve(args.port)
    url = f"http://127.0.0.1:{args.port}/index.html?prologue=0&quality=web"
    report: list[dict] = []
    errors: list[str] = []
    fails = 0
    with sync_playwright() as p:
        browser = launch(p)
        for mobile, sizes in ((True, [s for s in want if s in PHONES]), (False, [s for s in want if s not in PHONES])):
            if not sizes:
                continue
            w, h = map(int, sizes[0].split("x"))
            ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
            ctx.add_init_script("localStorage.setItem('bs-consent-v1', '1')")
            ctx.add_init_script("localStorage.setItem('bs-settings-v1', JSON.stringify({lang: 'en', volume: 0, subtitles: true}))")
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url, wait_until="domcontentloaded", timeout=120000)
            page.wait_for_function("window.__bs && window.__bs.state === 'title'", timeout=120000)
            page.evaluate("document.fonts.ready")
            page.evaluate("document.getElementById('c').style.display = 'none'")
            fails += run(page, sizes, langs, args.before, report)
            cf = page.evaluate("window.__bs.canvasFit")
            print(f"painted text (signs, boards): {cf['drawn']} drawn, {cf['shrunk']} shrunk to fit, {cf['squeezed']} squeezed", flush=True)
            ctx.close()
        browser.close()
    httpd.shutdown()
    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    total = sum(r["checked"] for r in report)
    print(f"text fit: {total} string placements, {fails} overflowing" + (f", {sum(r.get('before', 0) for r in report)} before fitting" if args.before else ""))
    if errors:
        print("page errors:", errors[:5])
    sys.exit(1 if fails or errors else 0)


if __name__ == "__main__":
    main()
