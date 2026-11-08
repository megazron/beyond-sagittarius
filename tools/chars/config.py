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


def _pair(t, w):
    """A left and right target at the same weight: t holds {s} for the side."""
    return [(t.format(s='l'), w), (t.format(s='r'), w)]


# Six different skulls, all from MakeHuman's CC0 shape targets. Bone first (head, cheek, jaw, brow ridge),
# then eyes, nose and mouth, then age. Each also gets its own skin source and brow.
FACES = {
    # Zenvik: long and gaunt, high forehead, narrow hooked nose, deep tired eyes, thin mouth. Mid thirties.
    'scientist': [('head/head-oval.target', 0.6), ('head/head-scale-horiz-decr.target', 0.3), ('head/head-scale-vert-incr.target', 0.3),
                  ('forehead/forehead-scale-vert-incr.target', 0.6), ('chin/chin-height-incr.target', 0.4), ('chin/chin-width-decr.target', 0.5),
                  *_pair('cheek/{s}-cheek-volume-decr.target', 0.8), *_pair('cheek/{s}-cheek-bones-incr.target', 0.5),
                  *_pair('eyes/{s}-eye-push1-in.target', 0.3), *_pair('eyes/{s}-eye-bag-incr.target', 0.4), *_pair('eyes/{s}-eye-height2-incr.target', 0.3),
                  ('nose/nose-scale-vert-incr.target', 0.6), ('nose/nose-width2-decr.target', 0.5), ('nose/nose-hump-incr.target', 0.5), ('nose/nose-point-down.target', 0.3),
                  ('mouth/mouth-upperlip-volume-decr.target', 0.5), ('mouth/mouth-lowerlip-volume-decr.target', 0.4), ('mouth/mouth-scale-horiz-decr.target', 0.2),
                  ('head/head-age-incr.target', 0.2)],
    # Draxum: a slab. Square jaw, heavy brow ridge, small deep eyes, broken wide nose, thick neck. Late thirties.
    'strong': [('head/head-square.target', 0.9), ('head/head-scale-horiz-incr.target', 0.15), ('chin/chin-width-incr.target', 0.9), ('chin/chin-bones-incr.target', 0.8),
               ('chin/chin-prominent-incr.target', 0.5), ('chin/chin-jaw-drop-incr.target', 0.3), ('forehead/forehead-trans-forward.target', 0.8), ('forehead/forehead-scale-vert-decr.target', 0.4),
               *_pair('cheek/{s}-cheek-bones-incr.target', 0.7), *_pair('eyes/{s}-eye-scale-decr.target', 0.45), *_pair('eyes/{s}-eye-push1-in.target', 0.7),
               ('nose/nose-width2-incr.target', 0.7), ('nose/nose-width3-incr.target', 0.6), ('nose/nose-flaring-incr.target', 0.5), ('nose/nose-hump-incr.target', 0.5),
               ('mouth/mouth-scale-horiz-incr.target', 0.3), ('mouth/mouth-upperlip-volume-decr.target', 0.3), ('head/head-age-incr.target', 0.3)],
    # The medic: tapered, high sharp cheekbones, long almond eyes with a lifted outer corner, fine straight nose. Late forties.
    'medic': [('head/head-invertedtriangular.target', 0.55), ('head/head-scale-vert-incr.target', 0.12), ('chin/chin-width-decr.target', 0.3),
              *_pair('cheek/{s}-cheek-bones-incr.target', 1.0), *_pair('cheek/{s}-cheek-volume-decr.target', 0.5),
              *_pair('eyes/{s}-eye-corner2-up.target', 0.8), *_pair('eyes/{s}-eye-epicanthus-in.target', 0.5), *_pair('eyes/{s}-eye-height2-decr.target', 0.3),
              ('nose/nose-greek-incr.target', 0.7), ('nose/nose-width2-decr.target', 0.3), ('nose/nose-scale-vert-incr.target', 0.2),
              ('mouth/mouth-scale-horiz-decr.target', 0.15), ('mouth/mouth-angles-down.target', 0.15), ('head/head-age-incr.target', 0.6)],
    # Skyvra: heart-shaped, big round eyes, short upturned nose, a wide mouth that never shuts, sharp little chin. Early twenties.
    'explorer': [('head/head-invertedtriangular.target', 0.9), ('chin/chin-triangle.target', 0.5), ('chin/chin-prominent-incr.target', 0.3),
                 *_pair('eyes/{s}-eye-scale-incr.target', 0.55), *_pair('eyes/{s}-eye-height2-incr.target', 0.5),
                 ('nose/nose-scale-vert-decr.target', 0.5), ('nose/nose-point-up.target', 0.8), ('nose/nose-width1-decr.target', 0.3), ('nose/nose-nostrils-angle-up.target', 0.5),
                 ('mouth/mouth-scale-horiz-incr.target', 0.5), ('mouth/mouth-angles-up.target', 0.3), ('mouth/mouth-lowerlip-volume-incr.target', 0.2)],
    # The builder: wide and weathered, low forehead, jowls, a big soft nose, small creased eyes. Mid fifties.
    'builder': [('head/head-round.target', 0.8), ('head/head-fat-incr.target', 0.9), ('head/head-scale-horiz-incr.target', 0.25), ('forehead/forehead-scale-vert-decr.target', 0.7),
                ('chin/chin-width-incr.target', 0.5), *_pair('cheek/{s}-cheek-volume-incr.target', 1.0), *_pair('cheek/{s}-cheek-trans-down.target', 0.6),
                *_pair('eyes/{s}-eye-scale-decr.target', 0.12), *_pair('eyes/{s}-eye-bag-incr.target', 0.35), *_pair('eyes/{s}-eye-height2-incr.target', 0.5),
                ('nose/nose-volume-incr.target', 0.8), ('nose/nose-point-width-incr.target', 0.9), ('nose/nose-width3-incr.target', 0.4), ('nose/nose-point-down.target', 0.4),
                ('mouth/mouth-lowerlip-volume-incr.target', 0.5), ('mouth/mouth-angles-down.target', 0.2), ('head/head-age-incr.target', 0.85)],
    # The social one: small and round, huge wide-set eyes, tiny nose, full lips, soft short chin. Nineteen.
    'social': [('head/head-round.target', 0.55), ('head/head-scale-vert-decr.target', 0.15), ('chin/chin-height-decr.target', 0.5), ('chin/chin-width-decr.target', 0.45),
               ('forehead/forehead-scale-vert-incr.target', 0.3), *_pair('cheek/{s}-cheek-volume-incr.target', 0.45),
               *_pair('eyes/{s}-eye-scale-incr.target', 1.0), *_pair('eyes/{s}-eye-height2-incr.target', 0.8), *_pair('eyes/{s}-eye-height1-incr.target', 0.4), *_pair('eyes/{s}-eye-trans-out.target', 0.45), *_pair('eyes/{s}-eye-corner2-up.target', 0.3),
               ('nose/nose-scale-horiz-decr.target', 0.4), ('nose/nose-scale-vert-decr.target', 0.5), ('nose/nose-point-width-decr.target', 0.5),
               ('mouth/mouth-upperlip-volume-incr.target', 0.8), ('mouth/mouth-lowerlip-volume-incr.target', 0.8), ('mouth/mouth-cupidsbow-incr.target', 0.6)],
}
SKIN_OF = {'scientist': 'sci', 'strong': 'str', 'medic': 'med', 'explorer': 'exp', 'builder': 'bld', 'social': 'soc'}
BROW_OF = {'scientist': 'eyebrow004', 'strong': 'eyebrow009', 'medic': 'eyebrow002', 'explorer': 'eyebrow006', 'builder': 'eyebrow011', 'social': 'eyebrow003'}


def _custom():
    out = {}
    for g, gv in (('m', 1.0), ('f', 0.0)):
        for o in ('scientist', 'strong', 'medic', 'explorer', 'builder', 'social'):
            out[f'custom_{g}_{o}'] = dict(
                height=1.76 if g == 'm' else 1.68, macro=dict(gender=gv, muscle=0.5, weight=0.5, proportions=0.8, cup=0.5),
                build_slim=dict(gender=gv, muscle=0.35, weight=0.1, proportions=0.8, cup=0.4),
                build_heavy=dict(gender=gv, muscle=0.8, weight=0.95, proportions=0.6, cup=0.7),
                skin_src='m' if g == 'm' else 'f', clothes=CHARS[o]['clothes'], atlas=o, lods=('',),
                # the player's own head follows the outfit's face at a gentler weight, so a creator look stays theirs
                extra=[(t, w * 0.7) for t, w in FACES[o]], brow=BROW_OF[o])
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

# A locked alternate skin: an ordinary man in a three-piece, drawn by hand from a description of the
# clothes and build. No photograph is read by this build and none may enter the repo.
CHARS['strong_suit'] = dict(
    height=2.0, macro=dict(gender=1.0, muscle=0.6, weight=0.9, proportions=0.72, race=(0.6, 0.1, 0.3)), skin_src='m', look=dict(marks='suit'),  # solid, broad through chest and middle
    extra=[('head/head-fat-incr.target', 0.45), ('head/head-round.target', 0.3), ('head/head-scale-horiz-incr.target', 0.12),
           ('cheek/l-cheek-volume-incr.target', 0.5), ('cheek/r-cheek-volume-incr.target', 0.5),
           ('nose/nose-width2-incr.target', 0.35), ('nose/nose-point-width-incr.target', 0.35), ('nose/nose-volume-incr.target', 0.2),
           ('chin/chin-width-incr.target', 0.35), ('mouth/mouth-lowerlip-volume-incr.target', 0.3), ('mouth/mouth-upperlip-volume-incr.target', 0.15),
           ('eyes/l-eye-scale-incr.target', 0.12), ('eyes/r-eye-scale-incr.target', 0.12)],
    fur=True, cloth_k=1.8, brow='eyebrow004',  # straight, full brows
    clothes=[('toigo_male_suit_3', (0x3a, 0x29, 0x20), {'islands': 'suit', 'drop': (6, 7)}),  # a dark brown three-piece, satin lapels
             ('shoes04', (0x5a, 0x36, 0x22), {})])  # brown leather lace-ups (MakeHuman system asset, CC0)
for _id, _f in FACES.items():
    CHARS[_id].update(extra=CHARS[_id].get('extra', []) + _f, skin_src=SKIN_OF[_id], brow=BROW_OF[_id])
CREW = list(CHARS)
CHARS.update(_custom())
