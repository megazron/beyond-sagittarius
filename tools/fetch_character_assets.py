#!/usr/bin/env python3
"""Fetch everything tools/build_characters.py and tools/build_animations.py read, into MH_ROOT
(default ~/bs-mh). Resumable: finished files are skipped. Sources are checked for licences by
tools/chars/credits.py after the build."""
import os, subprocess, sys, urllib.request, zipfile

ROOT = os.environ.get('MH_ROOT', os.path.expanduser('~/bs-mh'))
MIRROR = 'https://files.makehumancommunity.org/'
PACKS = """asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip functional/faceunits01.zip
asset_packs/suits01/suits01_cc0.zip asset_packs/suits03/suits03_cc-by.zip asset_packs/shirts01/shirts01_cc0.zip
asset_packs/shirts02/shirts02_ccby.zip asset_packs/shoes01/shoes01_cc0.zip asset_packs/shoes03/shoes03_ccby.zip
asset_packs/pants01/pants01_cc0.zip asset_packs/pants02/pants02_ccby.zip asset_packs/equipment03/equipment03_cc-by.zip
asset_packs/dress03/dress03_cc-by.zip""".split()


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print('get', url, flush=True)
    urllib.request.urlretrieve(url, path + '.part')
    os.replace(path + '.part', path)


def main():
    for p in PACKS:
        z = f'{ROOT}/packs/{os.path.basename(p)}'
        get(MIRROR + p, z)
        dest = f'{ROOT}/sys' if 'system_assets' in p else f'{ROOT}/ex/{os.path.basename(p)[:-4]}'
        if not os.path.isdir(dest):
            zipfile.ZipFile(z).extractall(dest)
    repo = f'{ROOT}/mhrepo'
    if not os.path.isdir(repo):
        subprocess.check_call(['git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/makehumancommunity/makehuman', repo])
        subprocess.check_call(['git', '-C', repo, 'sparse-checkout', 'set', 'makehuman/data/3dobjs', 'makehuman/data/rigs', 'makehuman/data/targets'])
    ual = f'{ROOT}/ual/gltf-universal-animation-library'
    if not os.path.isdir(ual):
        os.makedirs(f'{ROOT}/ual', exist_ok=True)
        subprocess.check_call(['git', 'clone', '--depth', '1', 'https://github.com/J-Ponzo/gltf-universal-animation-library', ual])
    # CMU takes named in the clip table
    sys.path.insert(0, os.path.dirname(__file__))
    from build_animations import CLIPS
    for take, *_ in CLIPS.values():
        if take.startswith('ual:'):
            continue
        s = take.split('_')[0]
        get(f'http://mocap.cs.cmu.edu/subjects/{s}/{s}.asf', f'{ROOT}/mocap/{s}.asf')
        get(f'http://mocap.cs.cmu.edu/subjects/{s}/{take}.amc', f'{ROOT}/mocap/{take}.amc')


if __name__ == '__main__':
    main()
