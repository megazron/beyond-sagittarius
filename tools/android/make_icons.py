"""Android launcher icons, splash screens and Play Store graphics from the brand mark.

    python3 tools/android/make_icons.py            # writes android/app/src/main/res/* and store/graphics/*
Feature graphic needs a gameplay frame: --frame path.jpg (defaults to docs/screenshots/ultra-03-wakeup-sky.jpg).
"""
import argparse, pathlib
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
RES = ROOT / 'android/app/src/main/res'
BG = (5, 6, 10)
MARK = Image.open(ROOT / 'public/brand/logo-mark-1024.png').convert('RGBA')
LOGO = Image.open(ROOT / 'public/brand/logo.png').convert('RGBA')


def space(w, h):
    """The game's night: near black with a faint blue rise toward the middle."""
    im = Image.new('RGB', (w, h), BG)
    glow = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(glow)
    r = int(min(w, h) * 0.55)
    d.ellipse((w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.45))
    im.paste(Image.new('RGB', (w, h), (22, 36, 64)), (0, 0), glow)
    return im


def mark(size):
    """The mark without its pale halo (it reads as fog on a dark icon): keep the strong pixels only."""
    m = MARK.resize((size, size), Image.LANCZOS)
    a = m.getchannel('A').point(lambda v: 0 if v < 120 else min(255, (v - 120) * 2))
    m.putalpha(a)
    return m


def paste_center(base, img, dy=0):
    base.paste(img, ((base.width - img.width) // 2, (base.height - img.height) // 2 + dy), img)


def launcher():
    for dens, s in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
        d = RES / f'mipmap-{dens}'
        fg = Image.new('RGBA', (int(108 * s), int(108 * s)), (0, 0, 0, 0))
        paste_center(fg, mark(int(78 * s)))  # inside the 72 dp area every mask keeps
        fg.save(d / 'ic_launcher_foreground.png')
        n = int(48 * s)
        for name, rnd in (('ic_launcher', False), ('ic_launcher_round', True)):
            ic = space(n, n).convert('RGBA')
            paste_center(ic, mark(int(n * 0.9)))
            msk = Image.new('L', (n, n), 0)
            ImageDraw.Draw(msk).ellipse((0, 0, n - 1, n - 1), fill=255) if rnd else ImageDraw.Draw(msk).rounded_rectangle((0, 0, n - 1, n - 1), radius=n // 6, fill=255)
            ic.putalpha(msk)
            ic.save(d / f'{name}.png')
    bg = space(432, 432)
    for dens, s in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
        bg.resize((int(108 * s), int(108 * s)), Image.LANCZOS).save(RES / f'mipmap-{dens}' / 'ic_launcher_background.png')
    xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'
    for n in ('ic_launcher', 'ic_launcher_round'):
        (RES / 'mipmap-anydpi-v26' / f'{n}.xml').write_text(xml)


def splash():
    for p in RES.glob('drawable*/splash.png'):
        w, h = Image.open(p).size
        im = Image.new('RGBA', (w, h), BG + (255,))
        lw = int(min(w, h * 1.6) * 0.62)
        lg = LOGO.resize((lw, int(LOGO.height * lw / LOGO.width)), Image.LANCZOS)
        paste_center(im, lg)
        im.convert('RGB').save(p)


def store(frame):
    out = ROOT / 'store/graphics'
    out.mkdir(parents=True, exist_ok=True)
    ic = space(512, 512).convert('RGBA')  # Play masks the corners itself: full square, no own rounding
    paste_center(ic, mark(470))
    ic.save(out / 'icon-512.png')  # 32-bit PNG
    fr = Image.open(frame).convert('RGB')
    from PIL import ImageStat
    rows = [y for y in range(fr.height) if sum(ImageStat.Stat(fr.crop((0, y, fr.width, y + 1))).mean) > 30]
    fr = fr.crop((0, rows[0] + 2, fr.width, rows[-1] - 1))  # drop letterbox bars
    k = max(1024 / fr.width, 500 / fr.height)
    fr = fr.resize((round(fr.width * k), round(fr.height * k)), Image.LANCZOS)
    fr = fr.crop(((fr.width - 1024) // 2, (fr.height - 500) // 2, (fr.width - 1024) // 2 + 1024, (fr.height - 500) // 2 + 500))
    shade = Image.new('L', (1024, 500), 0)
    ImageDraw.Draw(shade).ellipse((162, 90, 862, 410), fill=170)
    fr.paste(Image.new('RGB', (1024, 500), BG), (0, 0), shade.filter(ImageFilter.GaussianBlur(70)))
    fr = fr.convert('RGBA')
    lg = LOGO.resize((640, int(LOGO.height * 640 / LOGO.width)), Image.LANCZOS)
    paste_center(fr, lg)
    fr.convert('RGB').save(out / 'feature-graphic-1024x500.png')  # 24-bit, no alpha


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--frame', default=str(ROOT / 'docs/screenshots/ultra-03-wakeup-sky.jpg'))
    a = ap.parse_args()
    launcher(); splash(); store(a.frame)
