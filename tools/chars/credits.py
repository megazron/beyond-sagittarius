#!/usr/bin/env python3
"""Prints the asset table for CREDITS.md and fails on anything not CC0 or CC-BY."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import mh
from config import CHARS

packs = {}
for n, z, rows in json.load(open(f'{mh.ROOT}/packs.json')):
    for r in rows:
        packs[r[1]] = (n, r[2], r[3])
seen = {}
for c in CHARS.values():
    for nm, *_ in c['clothes']:
        seen[nm] = mh.Clo(mh.find_clo(nm))
print('| Asset | Author | Licence | Source |\n| --- | --- | --- | --- |')
bad = 0
for nm, clo in sorted(seen.items()):
    lic = clo.meta.get('license', '')
    pk = packs.get(nm)
    if pk:
        lic2 = pk[2]
    else:
        lic2 = lic
    okay = re.search(r'CC0|CC[- ]?BY(?![- ]?(NC|ND|SA))|public domain', f'{lic} {lic2}', re.I)
    if not okay:
        bad += 1
    src = pk[0] if pk else 'makehuman_system_assets'
    print(f"| {nm} | {(pk[1] if pk and nm != 'male_worksuit01' else '') or clo.meta.get('author', '') or 'MakeHuman team'} | {lic2 or lic} | [{src}](https://static.makehumancommunity.org/assets/assetpacks/{src}.html) |")
sys.exit(1 if bad else 0)
