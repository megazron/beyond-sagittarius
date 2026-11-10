# Credits & licences

BEYOND SAGITTARIUS is an original game design by its owner. Crew, creatures,
hair, clothes, the Vault, shaders and synthesised sound effects are generated
in code at runtime. The photo textures, scanned models, the HDRI and the voice
model below are third-party and credited here. Every in-game company or
BEYOND SAGITTARIUS is an original game design by its owner. Creatures,
anime hair, the Vault, shaders, synthesised sound effects and the foliage
atlas are generated in code at runtime. The photo textures, the HDRI and the
voice model below are third-party and credited here. Every in-game company or
product name is a made-up parody.

## Science

The science is simplified for a game and is not instructions. Do not try this
at home. Dangerous procedures stay high-level or are left out.

## Libraries

| Library | Use | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) (r187) incl. `examples/jsm` post-processing (EffectComposer, UnrealBloomPass, GTAOPass, FXAAPass, OutputPass, ShaderPass), loaders (HDRLoader, GLTFLoader, meshopt decoder), SunLight and `BufferGeometryUtils` | Rendering | MIT |
| [Electron](https://www.electronjs.org) (includes Chromium; its notices ship as `LICENSES.chromium.html` in the download) | Desktop build runtime | MIT |
| [electron-builder](https://www.electron.build) | Desktop packaging (dev only) | MIT |
| [Vite](https://vitejs.dev) | Build tool (dev only) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language (dev only) | Apache-2.0 |

## Graphics assets (all CC0 1.0, public domain)

From [Poly Haven](https://polyhaven.com) ([licence](https://polyhaven.com/license)). Everything is re-downloaded
and rebuilt by `tools/fetch_assets.py`.

### Textures

Re-encoded to WebP at 512 / 1k / 2k into `public/textures/`.

| Used for | Asset | Source | Licence |
| --- | --- | --- | --- |
| Ground | Forrest Ground 01 | https://polyhaven.com/a/forrest_ground_01 | CC0 |
| Dirt | Forest Ground 04 | https://polyhaven.com/a/forest_ground_04 | CC0 |
| Lake shore mud | Mud Forest | https://polyhaven.com/a/mud_forest | CC0 |
| Rock, cliffs | Rock Face 03 | https://polyhaven.com/a/rock_face_03 | CC0 |
| Alien grove bark (fallback) | Bark Brown 02 | https://polyhaven.com/a/bark_brown_02 | CC0 |
| Escape pod metal | Blue Metal Plate | https://polyhaven.com/a/blue_metal_plate | CC0 |
| Image-based lighting (`public/hdri/sky_1k.hdr`) | Misty Pines HDRI | https://polyhaven.com/a/misty_pines | CC0 |

### Scanned models and foliage

Models are split into single rocks or plants, decimated to three LODs with
[gltfpack](https://github.com/zeux/meshoptimizer) (MIT, build-time only) and packed, quantised and
meshopt-compressed, into `public/models/world/`, with WebP textures in `public/textures/m/`. Tree crowns
use cards composed from the real twig and leaf sheets, in `public/textures/foliage/`.

| Used for | Asset | Authors | Source | Licence |
| --- | --- | --- | --- | --- |
| Scanned rock | Boulder 01 | Rico Cilliers | https://polyhaven.com/a/boulder_01 | CC0 |
| Scanned rock | Namaqualand Boulder 03 | Jenelle van Heerden, Dario Barresi | https://polyhaven.com/a/namaqualand_boulder_03 | CC0 |
| Scanned rock | Namaqualand Boulder 04 | Jenelle van Heerden | https://polyhaven.com/a/namaqualand_boulder_04 | CC0 |
| Scanned rock | Rock Moss Set 01 | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_01 | CC0 |
| Scanned rock | Rock Moss Set 02 | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_02 | CC0 |
| Scanned outcrop | Rock Face 01 | Dario Barresi | https://polyhaven.com/a/rock_face_01 | CC0 |
| Scanned outcrop | Rock Face 02 | Dario Barresi, Rico Cilliers | https://polyhaven.com/a/rock_face_02 | CC0 |
| Scanned outcrop | Mountainside | Dario Barresi, Rico Cilliers | https://polyhaven.com/a/mountainside | CC0 |
| Scanned outcrop | Namaqualand Cliff 01 | Jenelle van Heerden, Rico Cilliers | https://polyhaven.com/a/namaqualand_cliff_01 | CC0 |
| Scanned stump | Tree Stump 01 | Rob Tuytel | https://polyhaven.com/a/tree_stump_01 | CC0 |
| Scanned stump | Tree Stump 02 | Rob Tuytel | https://polyhaven.com/a/tree_stump_02 | CC0 |
| Scanned log | Dead Tree Trunk | Rob Tuytel | https://polyhaven.com/a/dead_tree_trunk | CC0 |
| Scanned log | Dead Tree Trunk 02 | Jenelle van Heerden, Rico Cilliers | https://polyhaven.com/a/dead_tree_trunk_02 | CC0 |
| Scanned roots | Pine Roots | Rob Tuytel | https://polyhaven.com/a/pine_roots | CC0 |
| Scanned roots | Root Cluster 01 | Jenelle van Heerden, Rico Cilliers | https://polyhaven.com/a/root_cluster_01 | CC0 |
| Scanned branch | Dry Branches Medium 01 | Rico Cilliers | https://polyhaven.com/a/dry_branches_medium_01 | CC0 |
| Scanned plant | Fern 02 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fern_02 | CC0 |
| Scanned shrub | Shrub 02 | Rico Cilliers | https://polyhaven.com/a/shrub_02 | CC0 |
| Scanned plant | Nettle Plant | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/nettle_plant | CC0 |
| Scanned plant | Weed Plant 02 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/weed_plant_02 | CC0 |
| Fir boughs (twig sheet) and tree bark | Fir Tree 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fir_tree_01 | CC0 |
| Pine boughs (twig sheet) | Pine Tree 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/pine_tree_01 | CC0 |
| Broad-leaf crowns (leaf sheet) | Island Tree 01 | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/island_tree_01 | CC0 |

### Made for this game

The water normal map (FFT wave spectrum) and the hydraulic erosion of the mountains
(`public/models/world/erosion_*.bin`, from `tools/bake_erosion.ts`) are generated, not sourced.
Clouds, the sky, the giant planet and the moon are shaders. The Windows build can add 4K versions of the same
assets (`tools/fetch_assets.py --desktop`, not in this repository).

### The Vault of the Last Ledger (the narrator's hall)

Re-downloaded by `tools/fetch_vault.py`: textures to WebP in `public/textures/vault/`, used by the rendered films.

| Used for | Asset | Source | Licence |
| --- | --- | --- | --- |
| Vault floor | Granite Tile 02 | https://polyhaven.com/a/granite_tile_02 | CC0 |
| Vault pillars and roof | Granite Wall | https://polyhaven.com/a/granite_wall | CC0 |
| Brass rings, shelves, orrery | Metal Plate | https://polyhaven.com/a/metal_plate | CC0 |
| Writing desk | Dark Wood | https://polyhaven.com/a/dark_wood | CC0 |
| The Ledger's cover | Brown Leather | https://polyhaven.com/a/brown_leather | CC0 |

### Zenvora (the prologue city)

Re-downloaded and packed by `tools/fetch_city.py`: textures to WebP in `public/textures/city/`, models as 1k glTF with 512 px textures, packed with gltfpack into `public/models/city/`.

| Used for | Asset | Source | Licence |
| --- | --- | --- | --- |
| City facades | Painted Plaster Wall | https://polyhaven.com/a/painted_plaster_wall | CC0 |
| City facades, weathered | Peeling Painted Wall | https://polyhaven.com/a/peeling_painted_wall | CC0 |
| City facades, brick | Painted Worn Brick | https://polyhaven.com/a/painted_worn_brick | CC0 |
| City pavement | Brick Pavement 02 | https://polyhaven.com/a/brick_pavement_02 | CC0 |
| City road | Asphalt 02 | https://polyhaven.com/a/asphalt_02 | CC0 |
| Shop shutters | Painted Metal Shutter | https://polyhaven.com/a/painted_metal_shutter | CC0 |
| Stall wood | Brown Planks 05 | https://polyhaven.com/a/brown_planks_05 | CC0 |
| Rooftop parapets | Concrete Block Wall | https://polyhaven.com/a/concrete_block_wall | CC0 |
| The flat, floor | Floor Tiles 06 | https://polyhaven.com/a/floor_tiles_06 | CC0 |
| The flat, walls | Blue Plaster Wall | https://polyhaven.com/a/blue_plaster_wall | CC0 |
| City props and the flat | Rollershutter Door | https://polyhaven.com/a/rollershutter_door | CC0 |
| City props and the flat | Rollershutter Window 01 | https://polyhaven.com/a/rollershutter_window_01 | CC0 |
| City props and the flat | Street Lamp 01 | https://polyhaven.com/a/street_lamp_01 | CC0 |
| City props and the flat | Street Lamp 02 | https://polyhaven.com/a/street_lamp_02 | CC0 |
| City props and the flat | Metal Trash Can | https://polyhaven.com/a/metal_trash_can | CC0 |
| City props and the flat | Utility Box 01 | https://polyhaven.com/a/utility_box_01 | CC0 |
| City props and the flat | Power Box 01 | https://polyhaven.com/a/power_box_01 | CC0 |
| City props and the flat | Fire Hydrant | https://polyhaven.com/a/fire_hydrant | CC0 |
| City props and the flat | Modular Street Seating | https://polyhaven.com/a/modular_street_seating | CC0 |
| City props and the flat | Painted Wooden Bench | https://polyhaven.com/a/painted_wooden_bench | CC0 |
| City props and the flat | Potted Plant 01 | https://polyhaven.com/a/potted_plant_01 | CC0 |
| City props and the flat | Potted Plant 02 | https://polyhaven.com/a/potted_plant_02 | CC0 |
| City props and the flat | Planter Box 01 | https://polyhaven.com/a/planter_box_01 | CC0 |
| City props and the flat | Security Light | https://polyhaven.com/a/security_light | CC0 |
| City props and the flat | Caged Hanging Light | https://polyhaven.com/a/caged_hanging_light | CC0 |
| City props and the flat | Trashbag | https://polyhaven.com/a/trashbag | CC0 |
| City props and the flat | Plastic Monobloc Chair 01 | https://polyhaven.com/a/plastic_monobloc_chair_01 | CC0 |
| City props and the flat | Plastic Crate 01 | https://polyhaven.com/a/plastic_crate_01 | CC0 |
| City props and the flat | Plastic Crate 02 | https://polyhaven.com/a/plastic_crate_02 | CC0 |
| City props and the flat | Wooden Crate 01 | https://polyhaven.com/a/wooden_crate_01 | CC0 |
| City props and the flat | Cardboard Box 01 | https://polyhaven.com/a/cardboard_box_01 | CC0 |
| City props and the flat | Wicker Basket 01 | https://polyhaven.com/a/wicker_basket_01 | CC0 |
| City props and the flat | Wicker Basket 02 | https://polyhaven.com/a/wicker_basket_02 | CC0 |
| City props and the flat | Food Apple 01 | https://polyhaven.com/a/food_apple_01 | CC0 |
| City props and the flat | Food Pomegranate 01 | https://polyhaven.com/a/food_pomegranate_01 | CC0 |
| City props and the flat | Food Lime 01 | https://polyhaven.com/a/food_lime_01 | CC0 |
| City props and the flat | Food Pears Asian 01 | https://polyhaven.com/a/food_pears_asian_01 | CC0 |
| City props and the flat | Brass Pot 01 | https://polyhaven.com/a/brass_pot_01 | CC0 |
| City props and the flat | Brass Diya Lantern | https://polyhaven.com/a/brass_diya_lantern | CC0 |
| City props and the flat | Tea Set 01 | https://polyhaven.com/a/tea_set_01 | CC0 |
| City props and the flat | Folding Wooden Stool | https://polyhaven.com/a/folding_wooden_stool | CC0 |
| City props and the flat | Round Wooden Table 01 | https://polyhaven.com/a/round_wooden_table_01 | CC0 |
| City props and the flat | Pot Enamel 01 | https://polyhaven.com/a/pot_enamel_01 | CC0 |
| City props and the flat | Ceiling Fan | https://polyhaven.com/a/ceiling_fan | CC0 |
| City props and the flat | Sofa 02 | https://polyhaven.com/a/sofa_02 | CC0 |
| City props and the flat | Old Bed Frame | https://polyhaven.com/a/old_bed_frame | CC0 |
| City props and the flat | Drawer Cabinet | https://polyhaven.com/a/drawer_cabinet | CC0 |
| City props and the flat | Dining Table | https://polyhaven.com/a/dining_table | CC0 |
| City props and the flat | Dining Chair 02 | https://polyhaven.com/a/dining_chair_02 | CC0 |
| City props and the flat | Wall Clock | https://polyhaven.com/a/wall_clock | CC0 |
| City props and the flat | Vintage Electric Kettle | https://polyhaven.com/a/vintage_electric_kettle | CC0 |
| City props and the flat | Wooden Bookshelf Worn | https://polyhaven.com/a/wooden_bookshelf_worn | CC0 |

## Characters

The crew are skinned MakeHuman bodies built offline by `tools/build_characters.py`; only MakeHuman's
CC0 data files are read (base mesh hm08, macro and expression targets, default rig and weights, eyes,
teeth, tongue, eyelashes, eyebrows, photographic skin source), never its AGPL program code. Body shapes,
species ears, skin colouring, glowing marks, props and hair are this project's own work.

| Asset | Source | Author | Licence |
| --- | --- | --- | --- |
| Base mesh, targets, rig, weights | https://github.com/makehumancommunity/makehuman | MakeHuman Team, Data Collection AB, Joel Palmius, Jonas Hauquier | CC0 1.0 |
| Eyes, teeth, tongue, eyelashes, twelve eyebrows, skin sources | [MakeHuman system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) | MakeHuman Team | CC0 1.0 (each file states "explicitly released as CC0 in september 2020") |
| Face shapes (head, cheek, chin, forehead, eye, nose and mouth targets) | https://github.com/makehumancommunity/makehuman | MakeHuman Team | CC0 1.0 |

Each of the six crew has their own head, recipe in `FACES` in `tools/chars/config.py`, and their own skin detail:
young_asian_male (Zenvik), middleage_african_male (Draxum), middleage_asian_female (Lyrra), young_caucasian_female2
(Skyvra), old_caucasian_male (Bolzar), young_african_female (Nuvexa). Only the brightness and crease detail of a skin is
used; the colour is the species colour. No third-party face pack is used: the free rigged heads found were non-commercial
or paid, so they were left out.

Clothing from the MakeHuman community asset packs, refit to each body, recoloured and reduced:

| Asset | Author | Licence | Source |
| --- | --- | --- | --- |
| cortu_cargo_pants | Cortu | CC0 | [pants01](https://static.makehumancommunity.org/assets/assetpacks/pants01.html) |
| cortu_jeans_shorts | Cortu | CC0 | [pants01](https://static.makehumancommunity.org/assets/assetpacks/pants01.html) |
| elvs_emt_uniform_jacket_female | Elvaerwyn | CC-BY | [suits03](https://static.makehumancommunity.org/assets/assetpacks/suits03.html) |
| elvs_emt_uniform_pants_female | Elvaerwyn | CC-BY | [suits03](https://static.makehumancommunity.org/assets/assetpacks/suits03.html) |
| elvs_gored_elephant_pants | Elvaerwyn | CC-BY | [pants02](https://static.makehumancommunity.org/assets/assetpacks/pants02.html) |
| elvs_hooded_sweat_jacket1 | Elvaerwyn | CC-BY | [shirts02](https://static.makehumancommunity.org/assets/assetpacks/shirts02.html) |
| joepal_crude_t-shirt_female | Joel Palmius | CC0 | [shirts01](https://static.makehumancommunity.org/assets/assetpacks/shirts01.html) |
| male_worksuit01 | MakeHuman team | CC0 | [makehuman_system_assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) |
| mindfront_cardigan_long_open_front | Mindfront | CC-BY | [shirts02](https://static.makehumancommunity.org/assets/assetpacks/shirts02.html) |
| mindfront_shoes_biker_boots_male | Mindfront | CC-BY | [shoes03](https://static.makehumancommunity.org/assets/assetpacks/shoes03.html) |
| mindfront_tactical_vest_male | Mindfront | CC-BY | [equipment03](https://static.makehumancommunity.org/assets/assetpacks/equipment03.html) |
| punkduck_winter_boots | punkduck | CC-BY | [shoes03](https://static.makehumancommunity.org/assets/assetpacks/shoes03.html) |
| punkduck_winter_coat | punkduck | CC-BY | [dress03](https://static.makehumancommunity.org/assets/assetpacks/dress03.html) |
| toigo_ankle_boots_female | MargaretToigo | CC0 | [shoes01](https://static.makehumancommunity.org/assets/assetpacks/shoes01.html) |
| toigo_ankle_boots_male | MargaretToigo | CC0 | [shoes01](https://static.makehumancommunity.org/assets/assetpacks/shoes01.html) |
| toigo_basic_tucked_t-shirt | MargaretToigo | CC0 | [shirts01](https://static.makehumancommunity.org/assets/assetpacks/shirts01.html) |
| toigo_fisherman_sweater | MargaretToigo | CC0 | [MakeHuman community assets](https://static.makehumancommunity.org/assets/assetpacks/) |
| toigo_camisole_top | MargaretToigo | CC0 | [shirts01](https://static.makehumancommunity.org/assets/assetpacks/shirts01.html) |
| toigo_male_suit_3 | MargaretToigo | CC0 | [suits01](https://static.makehumancommunity.org/assets/assetpacks/suits01.html) |
| toigo_wool_pants | MargaretToigo | CC0 | [pants01](https://static.makehumancommunity.org/assets/assetpacks/pants01.html) |

CC-BY assets are used under Creative Commons Attribution; changes made: fitted to new bodies, geometry
reduced, recoloured, emblems removed, texture-atlased.

## Animation

Standing, walking, jogging, sprinting, jumping and talking are from the Universal Animation Library by
[Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) (animation help by Gonzalo Furnier),
CC0 1.0, free version as mirrored at https://github.com/J-Ponzo/gltf-universal-animation-library, retargeted
to the crew rig by `tools/build_animations.py`.

## Motion capture

Gestures the pack lacks (sitting on the ground, waving, pointing, cheering, shouting, writing, limping) are retargeted offline by `tools/build_animations.py` from the CMU Graphics Lab Motion Capture
Database, free for any use: "The data used in this project was obtained from mocap.cs.cmu.edu. The
database was created with funding from NSF EIA-0196217." Source: http://mocap.cs.cmu.edu (AMC/ASF originals;
trial numbers are listed in `CLIPS` in that tool and in `public/models/crew/anim.json`).

## Music

The title theme "The Scatter" (`public/audio/music/`) is an original composition, synthesised from scratch by `tools/make_theme.py`. No samples, no borrowed melody. It is part of this project's own work.

## Voices

All dubbing in `public/audio/vo/` is synthetic speech rendered locally by `tools/tts/generate_voice.py`.

| Component | Use | Licence |
| --- | --- | --- |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (hexgrad), model weights and voicepacks | Text to speech, English and Hindi voices (also used for Urdu) | Apache-2.0 |
| [kokoro](https://github.com/hexgrad/kokoro) Python package | Inference | Apache-2.0 |
| [misaki](https://github.com/hexgrad/misaki) | Grapheme-to-phoneme | Apache-2.0 |
| [espeak-ng](https://github.com/espeak-ng/espeak-ng) via `espeakng-loader` | Hindi and Urdu phonemes, build-time tool only; not distributed with the game and its GPL-3.0 does not cover the generated audio | GPL-3.0 (tool) |
| [FFmpeg](https://ffmpeg.org) | Pitch, room and filter effects, MP3 encoding, build-time only | LGPL/GPL (tool) |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) with Whisper small | Build-time quality check of the audio only; nothing from it ships | MIT |

## Fonts

Self-hosted in `public/fonts/`, subset by `tools/ui/make_fonts.py`, all under the
SIL Open Font License 1.1 (full texts in `public/fonts/OFL.txt`):

- **Barlow** and **Barlow Condensed** (Jeremy Tribby): English text and UI
- **VT323** (Peter Hull): wrist device readouts
- **Rajdhani** (Indian Type Foundry): Hindi UI
- **Noto Sans Devanagari** (Google): Hindi reading text and subtitles
- **Noto Naskh Arabic** (Google): Urdu UI
- **Noto Nastaliq Urdu** (Google): Urdu subtitles and story text

## Logo

The wordmark and emblem in `public/brand/` were drawn for this project by
`tools/brand/make_logo.py`. No font is used: the letters are original outlines.

## Algorithms

- 2D simplex noise after Stefan Gustavson's public-domain reference implementation.
- `hash12/13/33` GLSL hashes after David Hoskins' "Hash without Sine" (MIT).
- Black hole light bending uses the well-known photon-orbit approximation
  `a = -1.5 h² r̂ / r⁴` (Schwarzschild, units of r_s), written from scratch.

## Translations

English, Hindi and Urdu text was written for this project (see `src/i18n/`).
