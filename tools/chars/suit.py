"""Where the suited man's hair grows: beard and scalp masks in neutral base-mesh decimetres.

Both the fur shells (vertex thickness) and the painted roots under them (texture) read these,
so stubble and fur always line up, whatever the face targets do to the head afterwards."""
import numpy as np


def _step(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _ear(P):
    """1 on the outer ear, so neither mask grows on it."""
    x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
    return _step(0.73, 0.79, x) * _step(6.84, 6.92, y) * (1 - _step(7.34, 7.42, y)) * _step(0.12, 0.2, z) * (1 - _step(0.7, 0.78, z))


def beard(P):
    """0..1: full on the jaw, chin and lip, thinning up the cheek."""
    x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
    top = np.interp(x, [0, .2, .34, .5, .64, .76, .9], [6.80, 6.80, 6.72, 6.74, 6.84, 7.02, 7.3])
    low = np.interp(x, [0, .4, .7], [6.02, 6.1, 6.3])
    m = (1 - _step(top - .24, top + .1, y)) * _step(low - .05, low + .3, y)  # thins out down the neck: no fur stands through the collar
    m = m * _step(0.08, 0.42, z)                                        # fades out into the sideburn
    lips = np.hypot(x / .25, (y - 6.615) / .082)
    m = m * _step(.9, 1.15, lips)
    nose = np.hypot(x / .2, (y - 6.86) / .08)
    m = m * _step(.8, 1.1, nose)
    return m * (1 - _ear(P))


def scalp(P):
    """0..1: the close-cut sides and back, and the bed the long hair grows from."""
    x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
    line = np.interp(x, [0, .3, .55, .68, .74], [8.06, 8.03, 7.9, 7.72, 7.45])  # forehead, temple
    front = _step(line - .09, line + .07, y)
    side = _step(6.6, 6.82, y) * (1 - _step(.3, .46, z))                # beside and behind the ear
    # sideburn, in front of the ear: a stubble gradient from the beard up into the side hair, not a solid block
    burn = _step(.6, .68, x) * (1 - _step(.84, 1.0, z)) * _step(6.8, 6.95, y) * (.35 + .65 * _step(7.0, 7.3, y))
    nape = (1 - _step(.0, .22, z)) * _step(6.52, 6.66, y)
    m = np.maximum.reduce([front, side, burn, nape])
    return m * (1 - _ear(P))


def brows(P):
    """0..1: heavy straight brows, thicker towards the nose."""
    x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
    mid = np.interp(x, [.08, .3, .5, .66], [7.50, 7.53, 7.53, 7.50])  # straight, not arched
    half = np.interp(x, [.08, .3, .66], [.05, .042, .012])
    return _step(.08, .14, x) * (1 - _step(.58, .7, x)) * (1 - _step(half * .4, half * 1.6, np.abs(y - mid))) * _step(.7, .9, z)  # no hard painted edge
