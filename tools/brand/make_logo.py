"""Draws the BEYOND SAGITTARIUS logo from scratch and writes public/brand/*.svg.

No font is involved. Every letter is a chamfered centre line (the same corner
cut as the game's menu buttons) thickened with shapely, then every outline is
passed through a point-mass lens equation centred on the black hole that stands
in for the O of BEYOND, so the type bends around it the way background stars do.

Usage: python tools/brand/make_logo.py   (needs: pip install shapely)
Then:  python tools/brand/render_brand.py  for the PNGs and the social preview.
"""
import math
import pathlib

from shapely.geometry import LineString, box
from shapely.ops import unary_union

OUT = pathlib.Path(__file__).resolve().parents[2] / "public" / "brand"

AMBER_HI, AMBER, EMBER = "#fff1d6", "#ffb35c", "#e8622a"
CYAN, BLUE = "#6ff3ff", "#2f8fd8"
VOID = "#05070d"


# ---------------------------------------------------------------- letters
def glyph(ch: str, w: float, h: float, t: float, c: float) -> tuple[list, float]:
    """Centre lines for one letter. x runs 0..w, y runs 0..h (top to bottom)."""
    m = h / 2
    b = {
        "B": [[(0, 0), (w - c, 0), (w, c * .8), (w, m - c * .8), (w - c, m), (w, m + c * .8), (w, h - c * .8), (w - c, h), (0, h), (0, 0)],
              [(0, m), (w - c, m)]],
        "E": [[(w, 0), (0, 0), (0, h), (w, h)], [(0, m), (w * .78, m)]],
        "Y": [[(0, -t), (w / 2, m * 1.02), (w, -t)], [(w / 2, m * 1.02), (w / 2, h + t)]],
        "N": [[(0, h + t), (0, 0), (w, h), (w, -t)]],
        "D": [[(0, 0), (w - c, 0), (w, c), (w, h - c), (w - c, h), (0, h), (0, 0)]],
        "S": [[(w, 0), (c, 0), (0, c * .8), (0, m - c * .8), (c, m), (w - c, m), (w, m + c * .8), (w, h - c * .8), (w - c, h), (0, h)]],
        "A": [[(-t * .35, h + t), (w / 2, -t * 1.2), (w + t * .35, h + t)]],
        "G": [[(w, 0), (c, 0), (0, c), (0, h - c), (c, h), (w - c, h), (w, h - c), (w, h * .56), (w * .56, h * .56)]],
        "I": [[(0, -t), (0, h + t)]],
        "T": [[(0, 0), (w, 0)], [(w / 2, 0), (w / 2, h + t)]],
        "R": [[(0, h + t), (0, 0), (w - c, 0), (w, c * .8), (w, m - c * .8), (w - c, m), (0, m)], [(w * .5, m), (w, h + t)]],
        "U": [[(0, -t), (0, h - c), (c, h), (w - c, h), (w, h - c), (w, -t)]],
    }
    return b[ch], w


def outline(lines, h: float, t: float, x: float, y: float):
    """Thicken centre lines and clip to the cap height."""
    shape = unary_union([
        LineString([(px + t / 2, py + t / 2) for px, py in ln]).buffer(t / 2, cap_style="flat", join_style="mitre", mitre_limit=8)
        for ln in lines])
    shape = shape.intersection(box(-50, 0, 1000, h + t))
    from shapely.affinity import translate
    return translate(shape, x, y)


def word(text, widths, x, y, cap, t, c, gap, kern=None):
    """Lay out a word; a space leaves a hole of the given width."""
    shapes, pen = [], x
    for i, (ch, w) in enumerate(zip(text, widths)):
        pen += (kern or {}).get(i, 0)
        if ch != " ":
            lines, _ = glyph(ch, w, cap - t, t, c)
            shapes.append(outline(lines, cap - t, t, pen, y))
        pen += w + t + gap
    return shapes, pen - gap


# ---------------------------------------------------------------- lens
def lens(p, centre, theta):
    """Point-mass lens: r' = (r + sqrt(r^2 + 4 theta^2)) / 2, along the same ray."""
    dx, dy = p[0] - centre[0], p[1] - centre[1]
    r = math.hypot(dx, dy) or 1e-6
    k = (r + math.sqrt(r * r + 4 * theta * theta)) / 2 / r
    return centre[0] + dx * k, centre[1] + dy * k


def ring_path(coords, warp, step=26.0) -> str:
    """One closed ring as quadratic segments through the warped outline."""
    pts = list(coords)[:-1]
    d = []
    f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
    start = warp(pts[0])
    d.append(f"M{f(start[0])} {f(start[1])}")
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n = max(1, math.ceil(math.dist(a, b) / step))
        for k in range(n):
            lerp = lambda s: (a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s)
            p0, pm, p1 = warp(lerp(k / n)), warp(lerp((k + .5) / n)), warp(lerp((k + 1) / n))
            qx, qy = 2 * pm[0] - (p0[0] + p1[0]) / 2, 2 * pm[1] - (p0[1] + p1[1]) / 2
            d.append(f"Q{f(qx)} {f(qy)} {f(p1[0])} {f(p1[1])}")
    d.append("Z")
    return "".join(d)


def shape_path(shape, warp) -> str:
    polys = [shape] if shape.geom_type == "Polygon" else list(shape.geoms)
    out = []
    for poly in polys:
        poly = poly.simplify(0.01)
        out.append(ring_path(poly.exterior.coords, warp))
        out += [ring_path(i.coords, warp) for i in poly.interiors]
    return "".join(out)


# ---------------------------------------------------------------- black hole
# The far side of the disc, thrown up and over the shadow by the hole's gravity:
# a crescent cut from two circles, tips resting on the near side of the disc.
HALO = "M-112.6 28A116 116 0 1 1 112.6 28A124 124 0 1 0 -112.6 28Z"


def band(rx: float) -> str:
    """The near side of the disc, crossing in front of the shadow."""
    k = rx / 290
    return (f"M{-rx} 0C{-180 * k:g} 22 -96 50 0 50C96 50 {180 * k:g} 22 {rx} 0"
            f"C{180 * k:g} 14 96 20 0 20C-96 20 {-180 * k:g} 14 {-rx} 0Z")


def hole(cx, cy, u, ids="", tilt=-14, rx=290, glow=False, void=VOID) -> tuple[str, str]:
    """(defs, body) for the emblem. u scales a shadow of radius 100."""
    defs = f"""
    <linearGradient id="{ids}disc" x1="{-rx}" y1="0" x2="{rx}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{AMBER_HI}"/><stop offset=".45" stop-color="{AMBER}"/><stop offset="1" stop-color="{EMBER}"/>
    </linearGradient>
    <linearGradient id="{ids}ring" x1="-90" y1="-90" x2="90" y2="90" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="{CYAN}"/><stop offset="1" stop-color="{BLUE}"/>
    </linearGradient>"""
    if glow:
        defs += f"""
    <radialGradient id="{ids}glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="scale(300)">
      <stop offset=".3" stop-color="{AMBER}" stop-opacity=".3"/><stop offset=".6" stop-color="{BLUE}" stop-opacity=".1"/><stop offset="1" stop-color="{BLUE}" stop-opacity="0"/>
    </radialGradient>"""
    disc = f'url(#{ids}disc)'
    glow_el = f'<circle r="300" fill="url(#{ids}glow)"/>' if glow else ""
    body = f"""
  <g transform="translate({cx:g} {cy:g}) rotate({tilt}) scale({u:g})">
    {glow_el}
    <circle r="100" fill="{void}"/>
    <path fill="url(#{ids}ring)" fill-rule="evenodd" d="M-110 0a110 110 0 1 0 220 0a110 110 0 1 0-220 0ZM-98 -3a99 99 0 1 0 198 0a99 99 0 1 0-198 0Z"/>
    <path fill="{disc}" d="{HALO}"/>
    <path fill="{disc}" d="{band(rx)}"/>
  </g>"""
    return defs, body


# ---------------------------------------------------------------- lockups
def lockup(ink_top, ink_mid, ink_bot, sub_fill, void):
    cap, t, c, gap = 104, 15, 21, 24
    # BEYOND: B E Y [hole] N D
    w = [84, 74, 96, 96, 86, 86]
    top, end = word("BEY ND", w, 0, 0, cap, t, c, gap, kern={2: -12, 3: -10, 4: 6})
    hx = sum(w[:3]) + 3 * (t + gap) - 22 + (w[3] + t) / 2
    hy = cap / 2
    # SAGITTARIUS, tracked out to the width of BEYOND
    cap2, t2, c2 = 35, 6.4, 7.5
    w2 = {"S": 27, "A": 30, "G": 28, "I": 0, "T": 26, "R": 28, "U": 27}
    txt = "SAGITTARIUS"
    widths = [w2[ch] for ch in txt]
    used = sum(widths) + t2 * len(txt)
    gap2 = (end - used) / (len(txt) - 1)
    sub, _ = word(txt, widths, 0, cap + 40, cap2, t2, c2, gap2)

    centre = (hx, hy)
    warp = lambda p: lens(p, centre, 15)
    d_top = "".join(shape_path(s, warp) for s in top)
    d_sub = "".join(shape_path(s, warp) for s in sub)
    u, rx, tilt = .54, 182, -14
    xs = [warp(p)[0] for s in top + sub for p in s.envelope.exterior.coords]
    ys = [warp(p)[1] for s in top + sub for p in s.envelope.exterior.coords]
    x0, x1 = min(xs) - 10, max(xs) + 10
    y0, y1 = hy - 150 * u - 10, max(ys) + 10
    defs, body = hole(hx, hy, u, tilt=tilt, rx=rx, void=void)
    keyline = f'<g transform="translate({hx:g} {hy:g}) rotate({tilt}) scale({u:g})" fill="#000" stroke="#000" stroke-width="20" stroke-linejoin="round"><circle r="112"/><path d="{HALO}"/><path d="{band(rx)}"/></g>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.0f} {y0:.0f} {x1 - x0:.0f} {y1 - y0:.0f}" role="img" aria-label="Beyond Sagittarius">
  <title>Beyond Sagittarius</title>
  <defs>
    <linearGradient id="ink" x1="0" y1="-6" x2="0" y2="{cap + 6}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{ink_top}"/><stop offset=".6" stop-color="{ink_mid}"/><stop offset="1" stop-color="{ink_bot}"/>
    </linearGradient>{defs}
    <mask id="clear" maskUnits="userSpaceOnUse" x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}">
      <rect x="{x0:.0f}" y="{y0:.0f}" width="{x1 - x0:.0f}" height="{y1 - y0:.0f}" fill="#fff"/>
      {keyline}
    </mask>
  </defs>
  <path fill="url(#ink)" fill-rule="evenodd" mask="url(#clear)" d="{d_top}"/>
  <path fill="{sub_fill}" fill-rule="evenodd" d="{d_sub}"/>{body}
</svg>
"""


def emblem(u=.8, rx=300, glow=True, void=VOID):
    defs, body = hole(256, 262, u, rx=rx, glow=glow, void=void)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Beyond Sagittarius emblem">
  <title>Beyond Sagittarius</title>
  <defs>{defs}
  </defs>{body}
</svg>
"""


def app_tile():
    """Desktop icon: the emblem on a dark rounded tile so it holds up on any taskbar."""
    defs, body = hole(512, 524, 1.62, ids="t", rx=286, glow=True, void="#02030a")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>{defs}
    <radialGradient id="sky" cx=".5" cy=".5" r=".75">
      <stop offset="0" stop-color="#14233a"/><stop offset="1" stop-color="{VOID}"/>
    </radialGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="208" fill="url(#sky)"/>{body}
</svg>
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "logo.svg").write_text(lockup("#ffffff", "#e6f6ff", "#a9dcf5", AMBER, VOID))
    (OUT / "logo-ink.svg").write_text(lockup("#0b1a2a", "#0b1a2a", "#1d3a52", "#c26a14", VOID))
    (OUT / "logo-mark.svg").write_text(emblem())
    (OUT / "favicon.svg").write_text(emblem(u=.92, rx=262, glow=False))
    (OUT / "app-icon.svg").write_text(app_tile())
    for f in sorted(OUT.glob("*.svg")):
        print(f.name, f.stat().st_size)


if __name__ == "__main__":
    main()
