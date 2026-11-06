#!/usr/bin/env python3
"""Render a driven take from the dev turntable to frames, a 30 fps video and a contact sheet.
Usage: film.py <out_dir> <char index> [seconds] [side]"""
import os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from smoke import launch
from playwright.sync_api import sync_playwright
from PIL import Image

out, i = sys.argv[1], int(sys.argv[2])
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 15
side = 'true' if len(sys.argv) > 4 else 'false'
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={'width': 640, 'height': 640})
    pg.on('pageerror', lambda e: print('ERR', str(e)[:400]))
    pg.goto('http://localhost:5191/dev/chars.html')
    pg.wait_for_function('window.ready===true', timeout=170000)
    n = int(secs * 30)
    for f in range(n):
        pg.evaluate(f'drive({i},1/30,{side})')
        pg.screenshot(path=f'{out}/f{f:04d}.jpg', type='jpeg', quality=80)
    b.close()
subprocess.check_call(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', f'{out}/f%04d.jpg', '-pix_fmt', 'yuv420p', f'{out}/take.mp4'])
