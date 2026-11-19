"""Check a release AAB against the Play rules this game cares about.

    python3 tools/android/check_aab.py path/to/app.aab

- size: Play's limit is on the compressed download of the base module (500 MB as of 2026-11; check
  support.google.com/googleplay/android-developer/answer/9859372). bundletool's get-size gives the real number.
- target/compile SDK: new apps and updates need targetSdk 36 since 2026-08-31.
- permissions: none expected.
- 16 KB pages: every .so in the bundle must have 16 KB aligned LOAD segments (none expected at all).
"""
import os, pathlib, re, subprocess, sys, tempfile, zipfile

BT = os.path.expanduser('~/tools/bundletool.jar')
aab = pathlib.Path(sys.argv[1])
ok = True


def bt(*a):
    return subprocess.run(['java', '-jar', BT, *a], capture_output=True, text=True, check=True).stdout


def fail(msg):
    global ok
    ok = False
    print('FAIL', msg)


print(f'file: {aab} ({aab.stat().st_size / 1e6:.1f} MB)')
man = bt('dump', 'manifest', f'--bundle={aab}')
pkg = re.search(r'package="([^"]+)"', man).group(1)
tgt = int(re.search(r'targetSdkVersion="(\d+)"', man).group(1))
mn = int(re.search(r'minSdkVersion="(\d+)"', man).group(1))
code = re.search(r'versionCode="(\d+)"', man).group(1)
name = re.search(r'versionName="([^"]+)"', man).group(1)
perms = re.findall(r'uses-permission[^>]*android:name="([^"]+)"', man)
debuggable = 'debuggable="true"' in man
print(f'package {pkg}  version {name} ({code})  minSdk {mn}  targetSdk {tgt}')
print('permissions:', perms or 'none')
if pkg != 'com.megazron.beyondsagittarius': fail('package id')
if tgt < 36: fail('targetSdk below 36')
if debuggable: fail('debuggable release')
# AndroidX adds a DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION signature permission for itself; that is not a user permission.
user = [p for p in perms if not p.endswith('DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')]
if user: fail(f'unexpected permissions {user}')

with zipfile.ZipFile(aab) as z:
    sos = [n for n in z.namelist() if n.endswith('.so')]
    print('native libs:', sos or 'none (16 KB page size rule satisfied trivially)')
    if sos:
        with tempfile.TemporaryDirectory() as d:
            for n in sos:
                p = z.extract(n, d)
                hdr = subprocess.run(['objdump', '-p', p], capture_output=True, text=True).stdout
                aligns = re.findall(r'LOAD .* align 2\*\*(\d+)', hdr)
                if any(int(a) < 14 for a in aligns): fail(f'{n} not 16 KB aligned')
    print('bundle config alignment:', 'PAGE_ALIGNMENT_16K' if 'PAGE_ALIGNMENT_16K' in bt('dump', 'config', f'--bundle={aab}') else 'default')

with tempfile.TemporaryDirectory() as d:
    apks = f'{d}/x.apks'
    bt('build-apks', f'--bundle={aab}', f'--output={apks}')
    size = bt('get-size', 'total', f'--apks={apks}')
    print('download size (bytes, MIN,MAX):', size.strip().splitlines()[-1])
    mx = int(size.strip().splitlines()[-1].split(',')[-1])
    if mx > 500 * 1024 * 1024: fail('download over 500 MB')
    elif mx > 200 * 1024 * 1024: print('note: over 200 MB, Play warns users on mobile data')
print('RESULT', 'ok' if ok else 'PROBLEMS')
sys.exit(0 if ok else 1)
