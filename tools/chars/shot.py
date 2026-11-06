#!/usr/bin/env python3
"""Screenshot helper for the dev pages. Usage: shot.py url out.jpg 'js;js' ... """
import sys, time
from playwright.sync_api import sync_playwright
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from smoke import launch
url = sys.argv[1]
jobs = sys.argv[2:]
with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={'width': 900, 'height': 900})
    pg.on('console', lambda m: print('[c]', m.text[:300]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: print('[e]', str(e)[:500]))
    pg.goto(url)
    pg.wait_for_function('window.ready===true', timeout=240000)
    for i in range(0, len(jobs), 2):
        pg.evaluate(jobs[i + 1])
        time.sleep(0.2)
        pg.screenshot(path=jobs[i], type='jpeg', quality=85)
    b.close()
