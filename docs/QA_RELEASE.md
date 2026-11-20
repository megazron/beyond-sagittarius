# Release QA, 2026-11-19

I played the release build start to finish as a player before the first Play Store upload: on desktop (1280 x 720,
mouse and keyboard) and phone-sized touch (844 x 390 landscape, the Mobile preset), plus the Android app's own files
with a fake Capacitor bridge (`tools/android/app_smoke.py`) and the Electron app (`npm run smoke:desktop`).

Covered: a new game (MegaZroN in the Vault, the title card, Zenvora with every task, the take-off, the orbit card, the
deck, the title sequence, the wake-up) with Skip at every stage; all ten levels of Chapter One and the levels after it
to the end of Chapter Two's playable part (`levels_smoke.py`); every cutscene frame by frame (`cutscene_qa.py`);
Continue, save and load; Settings in all four tabs in English, Hindi and Urdu, the three quality presets, the audio
sliders and the language switch from inside Settings; Chapters with "The opening" (it ends on the title and leaves the
main save as it was, Continue picks the story up at the same level); pause, back and quit to title; death and Wake up
again; Legal; and on Android back, background, resume and the exit question.

Severity: **blocker** (cannot go on or crashes), **major** (wrong or broken for every player who gets there),
**minor** (visible but the game goes on), **cosmetic**.

| # | Where | What I found | Severity | Status |
| --- | --- | --- | --- | --- |
| 1 | Level 5 (shelter) | Oom-Sa, the roaming local, stopped beside a giant frond, and every Use press talked to her instead of picking the frond up. A player who did not step around her was stuck; the level run stuck here for 160 tries. An item within a step of you now wins over a person standing closer (`findInteraction`). | major | fixed |
| 2 | Zenvora, every preset | While you were in the city, the planet's lake kept rendering the whole planet into its mirror for the city camera, and the grass and forest kept rebuilding around it: 5.7 M triangles a frame on Ultra (the 480 x 270 pass), 1.6 M every third frame on Web. Nothing of it was on screen. `World.update` now skips them while another stage is drawn. | major (performance) | fixed |
| 3 | Legal, all languages | "Licences and credits" said every model was CC0 from Poly Haven. The clothes include CC BY garments (Elvaerwyn, Mindfront, punkduck), and the bodies, animation, mocap, fonts and Capacitor were not named. The paragraph now credits them in English, Hindi and Urdu; Capacitor is in CREDITS.md. | major (licences) | fixed |
| 4 | Title screen | The version badge said v0.1 on a 1.0.0 release. It now shows the version from `android/app/version.properties` (the desktop app still shows its own). | minor | fixed |
| 5 | Phones, Zenvora | 1,250 to 2,550 draw calls a frame; at 4x CPU slowdown (Chrome's mid-range phone model) the street took 183 ms and the view out of the flat 320 ms of main-thread time a frame. On phones the townsfolk further than 26 m from the camera are not drawn (the painted crowd in the haze stands in for them): 105 ms and 155 ms. | major (performance) | improved |
| 6 | Phones, the planet | Free play: 624 draw calls, 58 ms a frame at 4x CPU slowdown. The fruit bushes were twelve meshes each and every red fruit eleven (ten thorns), and item rings further than 9 m were drawn at zero opacity. Bushes and thorns are merged, far rings are skipped, and the phone shadow covers 45 m instead of 70 (sharper too): 436 draw calls, 44 ms. | major (performance) | improved |
| 7 | Deck, title sequence | Nuvexa's chest showed through her sweater in the selfie close-up, the first close-up of a new game (skin coming through the cloth when a raised arm stretches it). Every garment is now drawn 6 mm nearer the camera than the skin (`CLOTH_LIFT`), on top of the per-layer 3 mm. | minor (visual) | improved |
| 8 | Deck | A small hole in Nuvexa's sweater at the collarbone shows the skin under it. It is in the garment's own mesh; fixing it needs a character rebuild. | cosmetic | left |
| 9 | Phones, play | Your own lab coat showed dark specks from the follow camera: phones drew every body with the light build (`.lod1`). The body you play is now drawn with the full build on phones too (`PLAYER_DETAIL`); the others keep the light one. A few specks remain at the hip. | minor (visual) | improved |
| 10 | LEVELS.md | Said the Zenvora prologue was not in the shipped flow. It is. | cosmetic (docs) | fixed |
| 11 | Tests | Playwright 1.64's Chromium hangs on the tutorial's mouse-look drag and grows past 10 GB. The browser tests now pin Playwright 1.63 (`tools/pw_pin.py` re-runs any test under `~/.venvs/bs-test`, made by `tools/test_env.sh`). | test | fixed |
| 12 | Tests | mobile_smoke tapped Use at the trader and gave the dialogue a fixed 10 s; on a slow frame it failed, and stepping the game while waiting let the trader walk away. It now stands next to him, waits for Use, taps, and waits for the dialogue state with real frames, tapping again only when the game shows the tap was not taken. | test | fixed |
| 13 | Tests | app_smoke expected Back in the Vault to change the state at once. Since the cold open the Vault hands over to the title card (state still `narrator`), so the test now checks that the Vault stopped. Back itself worked. | test | fixed |
| 14 | Tests | Worktrees could not build the Android app: the shared `node_modules` in the main checkout had no Capacitor. Reinstalled from the current lockfile. | test | fixed |

## Gates on the release build

All on the final tree (Playwright 1.63, SwiftShader): build and typecheck; `smoke.py`; `levels_smoke.py` (levels 1 to
22, death and retry, Continue after a reload, Hindi and Urdu HUD); `prologue_smoke.py`; `mobile_smoke.py` (iPhone 13
portrait, Pixel 7 landscape); `cutscene_qa.py` (every scene, 0 errors); `tools/android/app_smoke.py` (the bundled
files with Capacitor's bridge: back, background, resume, Continue, the exit question, offline); the Electron smoke;
and `tools/android/check_aab.py` on the signed bundle.

## After the first release QA (1.0.1)

The owner played 1.0.0 and wrote: the game looks incomplete, the pedestrians disappear when you go near them, the map
is too small, there is no map or GPS, the houses are too small. What I changed, and what I checked on a real GPU
(Windows Chrome, the game recording itself with `?demo=city`; clips in `Downloads\BS_Game_v1.1\`):

| # | Where | What I found | Severity | Status |
| --- | --- | --- | --- | --- |
| 15 | Zenvora | The pedestrians that vanished were the painted crowd: camera-facing cards, hidden within 9 m of the camera. Now a pool of real bodies (8 on phones, 14 elsewhere) takes over the nearest cards within 14 m and walks them; a card nobody took stays drawn. Phones also drew real townsfolk only to 26 m from the camera: now 36 m. `tools/crowd_smoke.py` walks up to people from 28 m to 2.5 m on Mobile and Web and fails if a body is not drawn. | major | fixed |
| 16 | Zenvora | The street was one street. Two side streets now open off it (shops, flats, people at the shopfronts, lamps), each ending in a square with a landmark, shops on three walls and people. Hover cars run both lanes and wait if you are in the road; walkers step aside, people look at you and wave the first time you come close; crowd bodies step round you. The flat is 9.6 m deep instead of 6.5 m. | major | improved |
| 17 | Everywhere | No minimap, no GPS. A minimap (turns with the camera, tap it for the full map), a full map that pans, zooms and takes a waypoint, a route line on the map and chevrons on the ground. English, Hindi and Urdu. | major | fixed |
| 18 | Phones | Draw calls and per-frame work: props merged into each body, static scenery merged, atlases for the signs, the flat only draws what its door and window show, far items culled, hidden bodies not posed. | major (performance) | improved |

## Left for later

- Phones in Zenvora are still bound by draw calls: at 4x CPU slowdown the street costs about 105 ms of main thread a
  frame and the view out of the flat about 155 ms (free play about 50 ms). The rest is three.js's cost per draw call
  for the townsfolk (a dozen draws each) and the street's props; the next step is fewer, merged meshes per body.
- The sweater hole of item 8, and the inner-garment-at-the-coat-opening cases the skin work measured, need a
  character rebuild.
- No real Android device or emulator has run the app yet (internal testing on a phone is step 4 of
  `store/PLAYSTORE_GUIDE.md`).

## Zenvora, a city (1.1)

The owner asked for a city at the level of the big open-world games, as close as a browser and a phone allow, and
listed: pedestrians vanish when you go near, the map is too small, no map or GPS, the houses are too small, the game
looks incomplete. Measured on the owner's laptop GPU (NVIDIA RTX A500, Windows Chrome, `tools/gpu_tour.py`), at
1280 x 720 unless said.

| # | Where | What I found | Severity | Status |
| --- | --- | --- | --- | --- |
| 19 | Zenvora, Ultra | 2 to 7 fps on the A500: 6 to 15 M triangles a frame. Props were Poly Haven scans of up to 176k triangles (a street lamp 30k) drawn hundreds of times in both passes; about a hundred bodies were drawn, each casting a skinned, morphed shadow (the shadow pass alone cost most of the frame); hair was 9k triangles a head at any distance. Props now have a light build past 14 m (`tools/lod_city.py`; far ones are one draw per model part for the whole street), townsfolk past 34 m are cards of their height, crowd bodies cast no shadow (a soft contact shadow instead), a crowd body's light build keeps only its shape morphs and drops its eyes and lashes far off, hair has a light build, and the sun's shadow covers 46 m round the camera instead of the whole street. | blocker (performance) | improved |
| 20 | Zenvora | One street. Now a city round the old town (districts.ts): about 640 by 430 m, downtown towers, midtown, a market quarter, the waterfront on a bay, northside flats and a park, joined through the two squares and a new north gate. Roads with lanes, kerbs, zebras, signals; lamps, trees, benches, bins, shelters, shop signs and rooftop billboards with original names in three scripts. | major | done |
| 21 | Zenvora | Houses too small: the bazaar's street front was two or three floors. Now three or four, with the old town's back streets built up behind it (five to ten floors), towers downtown to about 190 m. The flat's door is 2.2 m, its ceiling 2.95 m. | major | improved |
| 22 | Zenvora | People: walkers loop the blocks and cross on the green, others sit, shop, chat and film; near the camera a pool of real bodies takes the nearest of them, the rest are cards. Cars follow lanes, turn at junctions, stop at red lights and for anyone on a crossing, the player too. | major | done |
| 23 | Maps | The map knew one street. The minimap and the full map now paint the whole city with its quarters named in English, Hindi and Urdu, and the GPS routes across it on a 2 m grid (pavements first, roads crossed at junctions). | major | done |
| 24 | Look | Night-blue all the time, flat boxes. Time of day (16:54 to night as you play), a sky that lights the city, rain with wet ground, a grade per quarter, facades with rooms behind their windows. | major | improved |

### Numbers (Windows Chrome on the RTX A500, `tools/gpu_tour.py`)

Ultra, 1280 x 720, the dynamic resolution at its floor (0.75), golden hour:

| Spot | Before (perf head 6f088eb) | After |
| --- | --- | --- |
| Bazaar street | 4.4 fps, 1,268 draws, 6.9 M triangles | 15 to 18 fps, about 900 draws, 2.4 to 2.7 M triangles |
| Among the crowd | 3.2 fps, 2,014 draws, 8.6 M | 10 fps, 1,100 to 1,600 draws, 2 to 3.8 M |
| Gate (looking up the street) | 2.3 fps, 3,415 draws, 14.9 M | 6 to 9 fps, 1,870 draws, 3.9 M |
| Downtown, market, waterfront (new) | | 23 to 47 fps, 120 to 350 draws, 0.4 to 0.8 M |

Mobile preset, 844 x 390, Chrome's 4x CPU slowdown (the mid-range phone proxy), on the same laptop while a Playwright
gate ran beside it: 1.4 to 3 fps (170 to 570 draws). Phones are not at 30 fps; see below.

Numbers moved by a few fps between runs: the other agents' jobs shared the laptop and its GPU.

### Still below the bar

- Frame rate: Ultra on the A500 is 15 to 18 fps in the bazaar and 6 to 9 at the gate; the phone proxy is far from
  30 fps. What is left is CPU per draw in three.js (900 to 1,900 draws) and the crowd's bodies; the next steps are
  batching the bazaar's own geometry further, baked impostors for far townsfolk, and a lighter post chain on Ultra.
- Far townsfolk are flat painted cards, and near the gate many of them are close to the camera: they read as
  cardboard. Baked impostors of the real bodies would fix that.
- Buildings are boxes with shaded windows (and rooms behind them): no modelled cornices, balconies only on flats, no
  doors you can enter outside the flat.
- No screen-space reflections: wet ground and glass reflect the sky only, not the neon or the street.
- No driving; cars do not react to being touched beyond stopping.
- The planet was not made bigger in this round.
- Textures are WebP, not KTX2; the web build is 129 MB, so the Android base download stays well under 200 MB without
  asset packs.

### Gates on this tree

Build and typecheck, `smoke.py`, `levels_smoke.py`, `prologue_smoke.py`, `mobile_smoke.py`, `crowd_smoke.py` (with the
new district checks: every walker within 30 m of the camera is a body or a card), `cutscene_qa.py` and
`tools/android/app_smoke.py` after `npx cap sync android`, all under `~/.venvs/bs-test` (Playwright 1.63, SwiftShader).
