"""Turn PRIVACY.md into public/privacy.html (served on GitHub Pages and bundled in the app).

    python3 tools/android/privacy_page.py
"""
import html, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\[(.+?)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', s)
    return re.sub(r'(?<!href=")(https://[^\s<)]+[^\s<).,;])', r'<a href="\1">\1</a>', s)


out, inlist = [], False
for l in (ROOT / 'PRIVACY.md').read_text().strip().split('\n'):
    if l.startswith('# '):
        out.append(f'<h1>{inline(l[2:])}</h1>'); continue
    if l.startswith('- '):
        if not inlist: out.append('<ul>'); inlist = True
        out.append(f'<li>{inline(l[2:])}</li>'); continue
    if inlist: out.append('</ul>'); inlist = False
    if l.strip(): out.append(f'<p>{inline(l)}</p>')
if inlist: out.append('</ul>')
body = '\n'.join(out)
(ROOT / 'public/privacy.html').write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy - Beyond Sagittarius</title>
<!-- Generated from PRIVACY.md by tools/android/privacy_page.py. Edit PRIVACY.md, then run it again. -->
<style>body{{margin:0;background:#05060a;color:#e8eef6;font:16px/1.6 system-ui,sans-serif}}main{{max-width:720px;margin:0 auto;padding:32px 20px 64px}}h1{{font-weight:600;letter-spacing:.02em}}a{{color:#ffb35c}}</style>
</head><body><main>
{body}
</main></body></html>
''')
