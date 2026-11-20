#!/usr/bin/env python3
"""Build the game's soundscape in public/audio/: music per place, ambience beds, footsteps, hands, doors, engines, UI.

Every source is pinned here with its licence:
  * Kenney audio packs (RPG Audio, Impact Sounds, Interface Sounds, Sci-Fi Sounds): CC0, kenney.nl
  * Freesound recordings marked CC0 (the licence is read again from each sound's own page; a sound whose page no
    longer says CC0 stops the build). The audio is Freesound's public high-quality preview.
  * Music by Kevin MacLeod (incompetech.com), CC BY 4.0, credited in CREDITS.md and on the Legal screen.

Loops are cut with a crossfade so they repeat without a click; everything is loudness matched per kind and
encoded as Opus in Ogg (music 56 kb/s stereo, beds 40 kb/s stereo, effects 32 kb/s mono). Writes
public/audio/sfx/index.json and public/audio/music/index.json, read by src/core/audio.ts.

Run: python3 tools/fetch_sounds.py <download dir with kenney/ and incompetech/ unpacked>   (needs numpy, soundfile,
pyloudnorm, ffmpeg)
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SFX = ROOT / 'public' / 'audio' / 'sfx'
MUSIC = ROOT / 'public' / 'audio' / 'music'
FFMPEG = shutil.which('ffmpeg') or str(Path.home() / '.local' / 'bin' / 'ffmpeg')
SR = 48000

# ---------------------------------------------------------------------------------------------- sources
# Freesound: id, author, title, {name: (start, end)}; kind decides level and encoding
FREESOUND = [
    (263635, 'Alcappuccino', 'India Trivandrum Street Market', 'bed', {'amb_bazaar': (2, 62)}),
    (516655, 'SoundEnsemble', 'DELHI ATMO street traffic horns walk voices bazaar', 'bed', {'amb_street': (4, 64)}),
    (110310, 'nickpursehouse', 'Traffic medium city dry road', 'bed', {'amb_traffic': (20, 80)}),
    (46310, 'moxobna', '0105coffeehouse', 'bed', {'amb_cafe': (30, 75)}),
    (629107, 'szegvari', 'Planet Jungle Animals Birds Alien Sci-fi Fantasy Ambience', 'bed', {'amb_planet_day': (10, 80)}),
    (328293, 'felix.blume', "Forest at night, crickets, cicadas and insects in the Sian Ka'an Biosphere Reserve", 'bed', {'amb_planet_night': (20, 90)}),
    (397091, 'janbezouska', 'Soft Tonal Wind_01', 'bed', {'amb_wind': (2, 58)}),
    (144046, 'gchase', 'Room_Tone_Ambience_Medium_Control_Low_Hum', 'bed', {'amb_room': (10, 50)}),
    (675339, 'craigsmith', 'S40-13 Alien hum or space ship interior', 'bed', {'amb_ship': (1, 21)}),
    (326097, 'kvgarlic', 'LakeWavesOct25th2015', 'bed', {'amb_lake': (5, 55)}),
    (204348, 'Sauron974', 'Crackling Fire', 'bed', {'amb_fire': (5, 45)}),
    (548367, 'Borgory', 'Chewing Crunch Cornflakes Eating Munch', 'fx', {'eat_1': (0.0, 1.6), 'eat_2': (1.8, 3.4)}),
    (256311, 'Kodack', 'Munching Food', 'fx', {'eat_3': (1.0, 2.8)}),
    (320139, 'OwlStorm', 'Drink Sip and Swallow', 'fx', {'drink_1': (0.0, 2.6)}),
    (331656, 'Trollarch2', 'Keyboard Typing', 'fx', {'type_1': (0.5, 4.5), 'type_2': (6.0, 10.0)}),
    (212180, 'OwlStorm', 'Bag Zipper', 'fx', {'zip_1': (0.2, 2.2)}),
    (9508, 'petenice', 'SPLASH', 'fx', {'splash_1': (0.0, 1.8)}),
    (182794, 'qubodup', 'Rocket Launch', 'fx', {'launch': (0.0, 22.0)}),
    (184313, 'swiftoid', 'Cinematic Deep Rumble', 'fx', {'rumble': (0.0, 26.0)}),
    (182474, 'keweldog', 'car horn', 'fx', {'horn_1': (0.0, 1.2)}),
    (423990, 'AmishRob', 'Car horn beep beep two beeps honk honk', 'fx', {'horn_2': (0.0, 1.0)}),
    (539973, 'Za-Games', 'Flint Strike', 'fx', {'flint_1': (0.0, 0.8)}),
]
# Kenney: pack, file stem pattern, name prefix, kind
KENNEY = [
    ('impact-sounds', r'footstep_concrete_00[0-4]', 'step_stone', 'step'),
    ('impact-sounds', r'footstep_grass_00[0-4]', 'step_grass', 'step'),
    ('impact-sounds', r'footstep_wood_00[0-4]', 'step_wood', 'step'),
    ('impact-sounds', r'footstep_carpet_00[0-4]', 'step_carpet', 'step'),
    ('impact-sounds', r'footstep_snow_00[0-4]', 'step_snow', 'step'),
    ('impact-sounds', r'impactMining_00[0-4]', 'stone', 'fx'),
    ('impact-sounds', r'impactWood_medium_00[0-4]', 'wood', 'fx'),
    ('impact-sounds', r'impactMetal_light_00[0-4]', 'metal', 'fx'),
    ('impact-sounds', r'impactSoft_medium_00[0-4]', 'soft', 'fx'),
    ('impact-sounds', r'impactPlate_light_00[0-4]', 'plate', 'fx'),
    ('rpg-audio', r'doorOpen_[12]', 'door_open', 'fx'),
    ('rpg-audio', r'doorClose_[1-4]', 'door_close', 'fx'),
    ('rpg-audio', r'cloth[1-4]', 'cloth', 'fx'),
    ('rpg-audio', r'handleCoins2?', 'coins', 'fx'),
    ('rpg-audio', r'handleSmallLeather2?', 'leather', 'fx'),
    ('rpg-audio', r'metalPot[1-3]', 'pot', 'fx'),
    ('rpg-audio', r'bookFlip[1-3]', 'paper', 'fx'),
    ('rpg-audio', r'chop', 'chop', 'fx'),
    ('sci-fi-sounds', r'doorOpen_00[0-2]', 'hatch_open', 'fx'),
    ('sci-fi-sounds', r'doorClose_00[0-2]', 'hatch_close', 'fx'),
    ('sci-fi-sounds', r'computerNoise_00[0-3]', 'console', 'fx'),
    ('sci-fi-sounds', r'forceField_00[0-2]', 'field', 'fx'),
    ('sci-fi-sounds', r'thrusterFire_00[0-2]', 'thruster', 'fx'),
    ('sci-fi-sounds', r'lowFrequency_explosion_00[01]', 'boom', 'fx'),
    ('sci-fi-sounds', r'spaceEngineLow_00[0-1]', 'engine_low', 'loopfx'),
    ('sci-fi-sounds', r'spaceEngineLarge_00[0-1]', 'engine_big', 'loopfx'),
    ('sci-fi-sounds', r'engineCircular_00[0-1]', 'hover', 'loopfx'),
    ('interface-sounds', r'click_00[0-4]', 'ui_click', 'ui'),
    ('interface-sounds', r'select_00[0-3]', 'ui_select', 'ui'),
    ('interface-sounds', r'back_00[0-3]', 'ui_back', 'ui'),
    ('interface-sounds', r'open_00[0-3]', 'ui_open', 'ui'),
    ('interface-sounds', r'close_00[0-3]', 'ui_close', 'ui'),
    ('interface-sounds', r'toggle_00[0-3]', 'ui_toggle', 'ui'),
    ('interface-sounds', r'error_00[0-3]', 'ui_error', 'ui'),
    ('interface-sounds', r'confirmation_00[0-3]', 'ui_confirm', 'ui'),
    ('interface-sounds', r'drop_00[0-3]', 'pickup', 'ui'),
    ('interface-sounds', r'scroll_00[0-3]', 'ui_scroll', 'ui'),
]
# Kevin MacLeod, CC BY 4.0: title, name, (start, end) of the part kept, where the loop goes back to
MACLEOD = [
    ('Odyssey', 'title', (0, 150)),
    ('Phantom from Space', 'vault', (0, 150)),
    ('Naraina', 'zenvora', (0, 165)),
    ('Clean Soul', 'deck', (0, 150)),
    ('Shadowlands 1 - Horizon', 'pull', (0, 120)),
    ('Destiny Day', 'planet_day', (0, 160)),
    ('Stay the Course', 'planet_night', (0, 150)),
    ('Shadowlands 4 - Breath', 'danger', (0, 120)),
]
LUFS = {'bed': -26.0, 'fx': -18.0, 'step': -22.0, 'ui': -22.0, 'loopfx': -22.0, 'music': -20.0}
OPUS = {'bed': ['-ac', '2', '-b:a', '40k'], 'music': ['-ac', '2', '-b:a', '56k'], 'fx': ['-ac', '1', '-b:a', '32k'],
        'step': ['-ac', '1', '-b:a', '24k'], 'ui': ['-ac', '1', '-b:a', '24k'], 'loopfx': ['-ac', '1', '-b:a', '32k']}
LOOPED = {'bed', 'loopfx', 'music'}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (game asset build)'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def ff(*args):
    subprocess.run([FFMPEG, '-v', 'error', '-y', *args], check=True)


def load(path: Path, start=0.0, end=None, stereo=False) -> np.ndarray:
    with tempfile.TemporaryDirectory() as td:
        w = Path(td, 'a.wav')
        ff('-ss', str(start), *(['-to', str(end)] if end else []), '-i', str(path), '-ac', '2' if stereo else '1', '-ar', str(SR), '-c:a', 'pcm_f32le', str(w))
        y, _ = sf.read(w, dtype='float32', always_2d=True)
    return y


def loop_crossfade(y: np.ndarray, fade=1.5) -> np.ndarray:
    n = int(fade * SR)
    if len(y) < 3 * n:
        return y
    head, body, tail = y[:n], y[n:-n], y[-n:]
    k = np.linspace(0, 1, n, dtype=np.float32)[:, None]
    # the tail fades into the head: the end of the file runs straight on into its start
    return np.concatenate([body, tail * (1 - k) + head * k])


def level(y: np.ndarray, kind: str) -> np.ndarray:
    m = pyln.Meter(SR, block_size=min(0.4, max(0.05, len(y) / SR - 0.01)))
    try:
        l = m.integrated_loudness(y.astype(np.float64))
    except Exception:
        l = float('-inf')
    if not np.isfinite(l):
        return y
    y = y * 10 ** ((LUFS[kind] - l) / 20)
    pk = np.abs(y).max()
    return y / pk * 0.89 if pk > 0.89 else y


def fades(y: np.ndarray, a=0.004, b=0.03) -> np.ndarray:
    na, nb = max(1, min(int(a * SR), len(y) // 4)), max(1, min(int(b * SR), len(y) // 2))
    y = y.copy()
    y[:na] *= np.linspace(0, 1, na, dtype=np.float32)[:, None]
    y[-nb:] *= np.linspace(1, 0, nb, dtype=np.float32)[:, None]
    return y


def write(y: np.ndarray, dst: Path, kind: str):
    dst.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        w = Path(td, 'a.wav')
        sf.write(w, y, SR, subtype='FLOAT')
        ff('-i', str(w), '-c:a', 'libopus', *OPUS[kind], '-application', 'audio', '-map_metadata', '-1', str(dst))
    return round(len(y) / SR, 2)


def main():
    dl = Path(sys.argv[1])
    raw = dl / 'freesound'
    raw.mkdir(parents=True, exist_ok=True)
    index, credits = {}, []
    for sid, author, title, kind, cuts in FREESOUND:
        page = get(f'https://freesound.org/people/{author}/sounds/{sid}/').decode('utf-8', 'replace')
        if 'publicdomain/zero' not in page:
            sys.exit(f'Freesound {sid} by {author} no longer reads CC0: stopping')
        src = raw / f'{sid}.mp3'
        if not src.exists():
            m = re.search(rf'https://cdn\.freesound\.org/previews/\d+/{sid}_\d+-hq\.mp3', page)
            if not m:
                sys.exit(f'no preview for {sid}')
            src.write_bytes(get(m.group(0)))
        for name, (a, b) in cuts.items():
            y = load(src, a, b, stereo=kind == 'bed')
            y = level(loop_crossfade(y) if kind in LOOPED else fades(y), kind)
            d = write(y, SFX / f'{name}.ogg', kind)
            index[name] = {'f': f'{name}.ogg', 'd': d, 'loop': kind in LOOPED, 'kind': kind}
        credits.append(f'| {", ".join(cuts)} | [{title}](https://freesound.org/people/{author}/sounds/{sid}/) by {author} | CC0 |')
        print('freesound', sid, list(cuts), flush=True)
    for pack, pat, prefix, kind in KENNEY:
        files = sorted(f for f in (dl / 'kenney' / pack).rglob('*.ogg') if re.fullmatch(pat, f.stem))
        if not files:
            sys.exit(f'nothing matches {pack}/{pat}')
        names = []
        for i, f in enumerate(files, 1):
            y = load(f)
            y = level(loop_crossfade(y, 0.25) if kind in LOOPED else fades(y, 0.002, 0.02), kind)
            name = f'{prefix}_{i}'
            write(y, SFX / f'{name}.ogg', kind)
            index[name] = {'f': f'{name}.ogg', 'd': round(len(y) / SR, 2), 'loop': kind in LOOPED, 'kind': kind}
            names.append(name)
        print('kenney', pack, prefix, len(files), flush=True)
    music, mcred = {}, []
    for title, name, (a, b) in MACLEOD:
        src = dl / 'incompetech' / f'{title}.mp3'
        y = load(src, a, b + 3, stereo=True)
        y = level(loop_crossfade(y, 3.0), 'music')
        d = write(y, MUSIC / f'{name}.ogg', 'music')
        music[name] = {'f': f'{name}.ogg', 'd': d, 'title': title}
        mcred.append(f'| {name} | "{title}" by Kevin MacLeod (incompetech.com) | CC BY 4.0 |')
        print('music', name, d, flush=True)
    (SFX / 'index.json').write_text(json.dumps(dict(sorted(index.items())), indent=0) + '\n')
    (MUSIC / 'index.json').write_text(json.dumps(music, indent=0) + '\n')
    size = sum(f.stat().st_size for f in SFX.glob('*.ogg')) + sum(f.stat().st_size for f in MUSIC.glob('*.ogg'))
    print(f'{len(index)} sounds, {len(music)} tracks, {size // 1024} KiB')
    print('\n'.join(credits + mcred))


if __name__ == '__main__':
    main()
