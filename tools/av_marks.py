"""Picture/sound sync marks of a capture (see `__bs.syncMark` and `__bs.syncTest` in src/main.ts): a beep at 1.5 kHz on
the game's last audio node and a white patch on screen, started in the same animation frame and held 0.15 s.

  tone_onsets(pcm, sr)         -> times (s) in the sound where a 1.5 kHz beep starts
  corner_onsets(times, files)  -> times (s) where the white corner square appears (syncMark)
  screen_onsets(times, bright) -> times (s) where the whole screen turns white (syncTest)
  align(p, a)                  -> pair picture and sound onsets in order and give sound minus picture per pair

Beeps are found by their pitch, not their loudness, so game sound around them does not count as a mark."""
import numpy as np

F = 1500.0   # syncTest beeps
FM = 2000.0  # syncMark beeps (another pitch, so a sync test running near a mark is never taken for one)


def tone_onsets(pcm, sr=48000, hop=0.0025, win=0.01, freq=F):
    a = np.asarray(pcm, dtype=np.float32)
    w, h = int(sr * win), int(sr * hop)
    n = (len(a) - w) // h
    if n <= 0:
        return np.array([])
    idx = np.arange(w)[None, :] + (np.arange(n) * h)[:, None]
    seg = a[idx]
    basis = np.exp(-2j * np.pi * freq * np.arange(w) / sr)
    amp = 2 * np.abs(seg @ basis) / w                     # amplitude of the beep's pitch
    rms = np.sqrt((seg ** 2).mean(1)) * np.sqrt(2) + 1e-9  # amplitude if the window were one pure sine
    on = (amp > 0.04) & (amp / rms > 0.7)
    out, last = [], -1.0
    for i in np.flatnonzero(on):
        t = i * h / sr
        if t - last > 0.25:
            out.append(t + win / 2 - 0.003)  # the window centre crosses the threshold about half a window in
        last = t
    return np.array(out)


def corner_patch(img):
    """True when the sync square is up: white inside, black outline just outside its right and bottom edges."""
    g = np.asarray(img.convert('L'), dtype=np.float32)
    s = g.shape[1] / 1280.0
    a, b, c, d = int(8 * s), int(40 * s), int(49 * s), int(53 * s)
    return g[a:b, a:b].mean() > 235 and g[c:d, a:b].mean() < 50 and g[a:b, c:d].mean() < 50


def corner_onsets(times, flags, gap=0.35):
    """Times where the flag turns on; a flicker within `gap` s of the last onset (one frame dropped from a held mark)
    is the same mark."""
    out, prev = [], False
    for t, f in zip(times, flags):
        if f and not prev and (not out or t - out[-1] > gap):
            out.append(t)
        prev = f
    return np.array(out)


screen_onsets = lambda times, bright: corner_onsets(times, [b > 200 for b in bright])


def align(p, a, near=0.5, ordered=True):
    """Sound minus picture per mark. With `ordered` and the same number of each: paired in order. Otherwise each
    picture onset takes the sound onset closest to it within `near` s."""
    p, a = np.asarray(p), np.asarray(a)
    if ordered and len(p) and len(p) == len(a):
        return [(float(x), float(y - x)) for x, y in zip(p, a)]
    res = []
    for x in p:
        if len(a) == 0:
            break
        j = int(np.argmin(np.abs(a - x)))
        if abs(a[j] - x) < near:
            res.append((float(x), float(a[j] - x)))
    return res


def align_marks(p, a, tol=0.06, span=1.0):
    """Sync marks come as a pattern (three, 0.6 s apart), so pair them by the one offset that lines up the most of them:
    every picture-to-sound difference within `span` s is a candidate, scored by how many picture onsets then have a
    sound onset within `tol` s. Returns [(picture time, sound minus picture)] for the matched marks."""
    p, a = np.asarray(p), np.asarray(a)
    best = (0, 0.0)
    for x in p:
        for y in a:
            d = y - x
            if abs(d) > span:
                continue
            n = sum(1 for q in p if np.min(np.abs(a - (q + d))) < tol)
            if n > best[0] or (n == best[0] and abs(d) < abs(best[1])):
                best = (n, d)
    if best[0] == 0:
        return []
    out = []
    for q in p:
        j = int(np.argmin(np.abs(a - (q + best[1]))))
        if abs(a[j] - (q + best[1])) < tol:
            out.append((float(q), float(a[j] - q)))
    return out
