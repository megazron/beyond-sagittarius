"""Per-character build recipe: macro body, outfit, identity."""

# Face units (MakeHuman expression units + community face units), name -> [(target, weight)].
U = 'expression/units/caucasian/'
MORPHS = {
    'blink': [(U + 'eye-left-closure.target', 1), (U + 'eye-right-closure.target', 1)],
    'smile': [(U + 'mouth-corner-puller.target', 0.9), (U + 'mouth-part-later.target', 0.25)],
    'fear': [(U + 'eye-left-opened-up.target', 0.8), (U + 'eye-right-opened-up.target', 0.8),
             (U + 'eyebrows-left-inner-up.target', 0.9), (U + 'eyebrows-right-inner-up.target', 0.9),
             (U + 'mouth-depression-retraction.target', 0.45)],
    'frown': [(U + 'eyebrows-left-down.target', 0.9), (U + 'eyebrows-right-down.target', 0.9), (U + 'mouth-compression.target', 0.3)],
    'open': [(U + 'mouth-open.target', 1)],
    'squint': [(U + 'eye-left-slit.target', 1), (U + 'eye-right-slit.target', 1)],
    'round': [(U + 'mouth-pursing.target', 0.7), (U + 'mouth-protusion.target', 0.35)],
    'wide': [(U + 'mouth-part-later.target', 0.7), (U + 'mouth-retraction.target', 0.5)],
}


def _custom():
    out = {}
    for g, gv in (('m', 1.0), ('f', 0.0)):
        for o in ('scientist', 'strong', 'medic', 'explorer', 'builder', 'social'):
            out[f'custom_{g}_{o}'] = dict(
                height=1.76 if g == 'm' else 1.68, macro=dict(gender=gv, muscle=0.5, weight=0.5, proportions=0.8, cup=0.5),
                build_slim=dict(gender=gv, muscle=0.35, weight=0.1, proportions=0.8, cup=0.4),
                build_heavy=dict(gender=gv, muscle=0.8, weight=0.95, proportions=0.6, cup=0.7),
                skin_src='m' if g == 'm' else 'f', clothes=CHARS[o]['clothes'], atlas=o, lods=('',))
    return out


# garment: (asset name, tint rgb or None for texture colours, options)
CHARS = {  # noqa
    'scientist': dict(
        look=dict(skin=0x57b3ad, shade=0x1c6f88, iris=0x7ffcff, brow=0x12305a, glow=0x6ff6e6, marks='dots', ear='fin'),
        height=1.76, macro=dict(gender=1.0, muscle=0.28, weight=0.22, proportions=0.7),
        extra=[('nose/nose-scale-horiz-decr.target', 0.15)],
        skin_src='m',
        clothes=[('toigo_wool_pants', (0x2c, 0x34, 0x40), {}),
                 ('toigo_basic_tucked_t-shirt', (0x1f, 0x2d, 0x3f), {'accent': True}),
                 ('mindfront_cardigan_long_open_front', (0xd2, 0xd4, 0xce), {'skirt': True, 'inflate': 0.004}),
                 ('mindfront_shoes_biker_boots_male', (0x2a, 0x25, 0x22), {})],
    ),
    'strong': dict(
        look=dict(skin=0xc77d33, shade=0x7c3016, iris=0xffc23a, brow=0x3b0f08, glow=0xff7a1e, marks='cracks', ear='round'),
        height=1.97, macro=dict(gender=1.0, muscle=1.0, weight=0.78, proportions=0.8),
        skin_src='m',
        clothes=[('cortu_cargo_pants', (0x3b, 0x3a, 0x30), {}),
                 ('mindfront_tactical_vest_male', (0x4a, 0x5a, 0x58), {'accent': True, 'budget': 2.4}),
                 ('mindfront_shoes_biker_boots_male', (0x1f, 0x1d, 0x1c), {})],
    ),
    'medic': dict(
        look=dict(skin=0xc3a8ee, shade=0x7a58c8, iris=0xe4d6ff, brow=0xbbb4e0, glow=0xc8a8ff, marks='veins', ear='long'),
        height=1.69, macro=dict(gender=0.0, muscle=0.42, weight=0.25, proportions=0.8, cup=0.45),
        skin_src='f',
        clothes=[('elvs_emt_uniform_pants_female', (0x3a, 0x46, 0x64), {'accent': True}),
                 ('elvs_emt_uniform_jacket_female', (0xc4, 0xc6, 0xc4), {'flat': True}),
                 ('toigo_ankle_boots_female', (0xe8, 0xe4, 0xdc), {})],
    ),
    'explorer': dict(
        look=dict(skin=0xe68a78, shade=0xb23d4c, iris=0x4cf08c, brow=0x6e2a12, glow=0xff5e6e, marks='stripes', ear='tuft'),
        height=1.71, macro=dict(gender=0.0, muscle=0.68, weight=0.38, proportions=0.85, cup=0.4),
        skin_src='f',
        clothes=[('cortu_jeans_shorts', (0x4c, 0x4a, 0x34), {}),
                 ('joepal_crude_t-shirt_female', (0x2d, 0x6a, 0x5c), {'accent': True}),
                 ('elvs_hooded_sweat_jacket1', (0x8b, 0x6a, 0x44), {}),
                 ('punkduck_winter_boots', (0x4a, 0x32, 0x20), {})],
    ),
    'builder': dict(
        look=dict(skin=0x6fa867, shade=0x2c6a48, iris=0xff9a32, brow=0x123a30, glow=0xffa030, marks='plates', ear='round'),
        height=1.57, macro=dict(gender=1.0, muscle=0.72, weight=1.0, height=0.2, proportions=0.35),
        skin_src='m',
        clothes=[('male_worksuit01', None, {}),
                 ('mindfront_shoes_biker_boots_male', (0x3a, 0x2c, 0x20), {})],
    ),
    'social': dict(
        look=dict(skin=0x4d70e0, shade=0x2a2f9e, iris=0xffd84a, brow=0xc32e8f, lip=0xff4fa8, glow=0xffe07a, marks='stars', ear='round'),
        height=1.67, macro=dict(gender=0.0, muscle=0.42, weight=0.5, proportions=0.85, cup=0.68),
        skin_src='f',
        clothes=[('toigo_fisherman_sweater', (0xff, 0xc8, 0x1e), {'accent': True}),
                 ('elvs_gored_elephant_pants', (0x6b, 0x2b, 0xd0), {}),
                 ('toigo_ankle_boots_female', (0xf5, 0xf0, 0xea), {})],
    ),
    'megazron': dict(
        look=dict(skin=0x23213c, shade=0x09081a, iris=0xffc36a, brow=0xe8e4f6, glow=0xd8dcff, marks='stars', ear='long'),
        height=2.08, macro=dict(gender=1.0, muscle=0.3, weight=0.12, height=1.0, proportions=0.9),
        skin_src='m',
        clothes=[('toigo_wool_pants', (0x0a, 0x0b, 0x16), {}),
                 ('punkduck_winter_coat', (0x14, 0x1a, 0x3c), {'skirt': True}),
                 ('mindfront_shoes_biker_boots_male', (0x0c, 0x0c, 0x12), {})],
    ),
}

CHARS['strong_suit'] = dict(
    height=2.0, macro=dict(gender=1.0, muscle=0.8, weight=0.55, proportions=0.85), skin_src='m', look=dict(marks='none'),
    clothes=[('toigo_male_suit_3', (0x2a, 0x21, 0x1c), {}), ('toigo_ankle_boots_male', (0x3a, 0x23, 0x18), {})])
CREW = list(CHARS)
CHARS.update(_custom())
