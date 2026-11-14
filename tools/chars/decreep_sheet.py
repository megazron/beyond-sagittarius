#!/usr/bin/env python3
"""Before/after contact sheet of every character for the de-creep review: the shipped crew (public/models/crew) on the
left, the de-creep build (?decreep=1, public/models/crew_dc) on the right; a face close-up (at rest, looking at the
lens) and a full figure for each crew member, MegaZroN and Mir.
  python tools/chars/decreep_sheet.py OUT.png [--url http://localhost:5197/dev/chars.html]"""
import argparse, io, sys, pathlib
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from smoke import launch  # noqa: E402
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--url', default='http://localhost:5197/dev/chars.html')
ap.add_argument('--size', type=int, default=420); a = ap.parse_args()
WHO = [('Zenvik', '', 0), ('Draxum', '', 1), ('Lyrra', '', 2), ('Skyvra', '', 3), ('Bolzar', '', 4), ('Nuvexa', '', 5),
       ('MegaZroN', '', 6), ('Mir', '&skin=suit', 1)]
S = a.size


def shots(pg, i, face_t):
    pg.evaluate(f"chars.forEach((c,j)=>c.root.visible=j==={i})")
    h = pg.evaluate(f"(()=>{{const o=chars[{i}].root.getObjectByName('head'); const v=o.getWorldPosition(chars[{i}].root.position.clone()); return [v.x,v.y,v.z];}})()")
    x, y, z = h
    out = []
    # face: three-quarter, at rest, eyes on the lens
    pg.evaluate(f"pose('stand',0); gaze({i},{x + 0.55},{y + 0.08},{z + 1.4}); step({face_t})")
    pg.evaluate(f"viewAt({x}, {y + 0.07}, {z}, 0.38, 0.0, 0.62); step(1)")
    out.append(Image.open(io.BytesIO(pg.screenshot())).convert('RGB'))
    pg.evaluate(f"view({i}, {y * 0.52}, 0.5, {y * 0.62}, {y * 2.3}); step(1)")
    out.append(Image.open(io.BytesIO(pg.screenshot())).convert('RGB'))
    return out


with sync_playwright() as pw:
    b = launch(pw)
    res = {}
    for side, q in (('before', ''), ('after', '&decreep=1')):
        for name, extra, i in WHO:
            key = (q, extra)
            pg = res.get(('page',) + key)
            if pg is None:
                for k in [k for k in res if k[0] == 'page']: res.pop(k).close()
                pg = b.new_page(viewport={'width': S, 'height': S}); pg.set_default_timeout(600000)
                pg.goto(a.url + '?studio=1' + q + extra); pg.wait_for_function('window.ready===true', timeout=600000)
                res[('page',) + key] = pg
            res[(side, name)] = shots(pg, i, 40)
            print(side, name, flush=True)
    b.close()

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
cols = 4; bar = 34; cw = S * 2; ch = bar + S * 2
sheet = Image.new('RGB', (cw * cols, ch * ((len(WHO) + cols - 1) // cols)), (20, 22, 28))
dr = ImageDraw.Draw(sheet)
for n, (name, _, _) in enumerate(WHO):
    ox, oy = (n % cols) * cw, (n // cols) * ch
    dr.text((ox + 8, oy + 5), f'{name}:  before  |  after', fill=(240, 240, 240), font=font)
    for s, side in enumerate(('before', 'after')):
        face, full = res[(side, name)]
        sheet.paste(face, (ox + s * S, oy + bar)); sheet.paste(full, (ox + s * S, oy + bar + S))
sheet.save(a.out, quality=88)
print('wrote', a.out)
