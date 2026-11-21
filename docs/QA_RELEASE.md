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

## Zenvora, frame rate and look (1.2)

The owner's review of 1.1: the frame rate blocks everything (phones at 1.4 to 3 fps on the proxy, Ultra 6 to 18 fps in
the old town on his RTX A500; his targets are Mobile 30, Web 60, Ultra 30 and up), and the "after" pictures were washed
out, the district buildings flat, the ground empty, the cars blobs, the far people cardboard, the map upside down, and
people stood in front of the camera.

| # | Where | What I found | Severity | Status |
| --- | --- | --- | --- | --- |
| 25 | Zenvora, every preset | The frame was spent in three.js's own work per draw call and per object. A fifth of a phone's frame went to refreshing matrices of thousands of objects that never move (hidden bodies' bones too); every body's shadow pass cost more than its own draw; every shop sign, shelf and poster was its own material; a hundred scanned props were a draw each. See "Frame budget in Zenvora" in DEVELOPMENT.md for what replaced each. | blocker (performance) | improved, see the numbers |
| 26 | Zenvora | Far people were flat painted cards. They are now pictures of the game's own bodies, baked at load (six walk frames and one standing, from four sides), lit by the hour. Real bodies are capped per preset (2, 7, 14) and go to whoever is nearest. | major | improved |
| 27 | Zenvora, Web and Ultra | Washed out: strong light, the same exposure all day, and bloom on everything bright. The exposure and the bloom now follow the hour, and the prologue starts at sunset with the neon on. | major | fixed |
| 28 | Districts | Flat boxes: street floors now have piers, a plinth, a fascia with the sign on it, a door with its frame and step, awnings; cornices and string courses; air conditioners; shelves and goods behind the shop glass; light spilling from shop windows and under every lamp. | major | improved |
| 29 | Districts | Empty ground: kerbstones, manhole covers, worn and mottled paving and tarmac, damp with puddles; scanned bins, hydrants, service boxes and planters along the pavements. | major | improved |
| 30 | Cars | Blobs: an original saloon with wheels in arches, a glass cabin on pillars, bumpers, a grille and lamps, in the districts and in the bazaar (the capsules are gone). | major | fixed |
| 31 | Map | North was at the bottom (Zenvora's north is +z). The minimap and the full map are turned so north is up. | major | fixed |
| 32 | Camera | People stood in the lens. A body or card within arm's reach of the camera, or on the line from the camera to you, is not drawn until it has moved on. | major | fixed |
| 33 | Web | The dynamic resolution never came back up on a display that caps the frame rate (it waited for headroom a capped display never shows), so Web stayed at its lowest sharpness. It now tries a step sharper whenever it is holding the target. | major | fixed |
| 34 | Reflections | A reflection probe that follows the camera is written (`?probe=1`) but off: on the real GPU it whites the picture out and I have not found why. Wet ground and glass still mirror the sky only. | minor | left |

### Numbers (1.2, Windows Chrome on the RTX A500, `tools/gpu_tour.py`, the other heavy jobs held off)

| Preset | Before (1.1) | Now |
| --- | --- | --- |
| Web, 1280 x 720 | not measured | 59 to 60 fps at all nine spots (130 to 540 draws) |
| Web, 1920 x 1080 | not measured | 57 to 60 fps (resolution scale 0.74 to 1.0) |
| Ultra, 1280 x 720 | 6 to 18 fps in the old town, 23 to 47 in the districts | 36 to 60 fps (36 once in the bazaar, 52 to 60 elsewhere; 180 to 660 draws) |
| Ultra, 1920 x 1080 | not measured | 56 to 60 fps |
| Mobile preset, 844 x 390, 4x CPU slowdown | 1.4 to 3 fps | flat 31 to 41, bazaar 30 to 32, crowd 19 to 26, gate 24 to 27, square 30 to 31, downtown 41 to 53, market 31 to 39, waterfront 32 to 52, park 36 to 45 (two runs; 44 to 143 draws) |

Those are the best runs, taken before I rebased on to main. On the landed tree, later the same day, two back-to-back
runs with my other jobs held off gave lower numbers, and the tree before the rebase measured in the same sitting was
lower too, so most of the gap is the machine and a little is the merge (the six friends are now always real bodies
within 9 m, and main added work per frame):

| Preset | Landed tree, 1280 x 720 |
| --- | --- |
| Web | bazaar 41 to 42, crowd 49 to 50, gate 44 to 47, flat 52 to 54, square 51 to 54, districts 57 to 60 (resolution scale 0.6 in the old town) |
| Ultra (one run) | bazaar 30, crowd 34, gate 26, flat 42, square 47, districts 50 to 58 |
| Mobile preset, 844 x 390, 4x CPU slowdown | flat 28 to 30, bazaar 22 to 33, crowd 25 to 28, gate 29 to 31, square 13 to 25, downtown 32 to 35, market 22 to 23, waterfront 27 to 38, park 30 to 36 |

So the targets are not held: Web is under 60 in the old town on a bad run, Ultra dipped to 26 at the gate, and phones
are under 30 at several spots. Runs differ by a quarter or more between themselves: the laptop is shared.

### Still below the bar (1.2)

- Frame rate is not at target everywhere (table above): Web 41 to 54 in the old town on the landed tree against a
  target of 60, Ultra 26 to 34 at the gate and in the crowd, phones 13 to 33 in the old town. What is left there is
  about a hundred different materials in view (each a draw) and the bodies.
- No real phone has run it. The proxy is Chrome's CPU slowdown on a laptop; it says nothing of a phone's GPU.
- Reflections: sky only (the probe is off, item 34). No screen-space reflections.
- On phones the district shop windows are flat lit panes (no room behind the glass), there is no bloom or grade, and
  near people beyond the two real bodies are low-resolution cards.
- A car can stand between the camera and you (bodies are cleared from the lens, cars are not), and a tall body just
  outside arm's reach can still fill the bottom of the frame.
- Buildings are still boxes above the street floor: shader windows, with real depth only in the shopfronts, cornices,
  balconies and roof clutter.
- Textures are WebP, not KTX2. The planet is 1.4 km across as it was; I did not enlarge it.

## Zenvora, streets that make sense (1.3, in progress)

The owner asked for the city to come as close to the big open-world games as it can (original world only), for
everything to be realistic and to make sense, and for phones to hold 30 fps.

| # | Where | What I found | Severity | Status |
| --- | --- | --- | --- | --- |
| 35 | Shops | A sign and its shop did not match (a salon with shelves of goods and cafe tables outside). Every shop now sells what its sign says: the brand list carries a kind (clothes, food, goods, counter, pharmacy), the building's seed carries it to the facade shader, which draws that interior (rails, a kitchen with a chalk menu, shelves, a counter under lit panels, a bright pharmacy); tables go out only in front of places that serve food; food places are never shuttered. | major | fixed |
| 36 | Buildings | Flat boxes. The glass sits back in the wall (the jamb shows at an angle, so windows read as openings); sills, pilasters and a cornice on brackets on street walls; pitched roofs, set-back top floors and water tanks; condensers, masts and dishes on the roofs; a lit crown and an aircraft beacon on every tower; signs that project square from the wall, readable down the street. Far windows blend to a tone instead of shimmering. | major | improved |
| 37 | Streets | Empty. Food carts with a cook and customers at the kerbs and on the promenade, people at the sea rail, cafe tables with customers, bollards at the corners, more moving cars (20, 55, 100 by preset) and parked cars (20, 50, 80) on streets that keep one lane each way for them. | major | improved |
| 38 | People | Cars and walkers that wander far off are brought back near the camera, but only where it is not looking; far people thin out at the edge of their range instead of blinking out; a townsperson at your elbow is never a card; far people are baked from eight sides instead of four. | major | improved |
| 39 | Reflections | Ultra now has screen-space reflections on wet ground: the lit shop windows, signs and car lamps show in the street, strongest in the puddles. Wet nights no longer glow beige under the lamps. | major | improved |
| 40 | Lag | "The game is very laggy." Arriving in Zenvora froze the game for 9.9 s on Web (61 shaders compiled, 349 meshes and 63 textures uploaded in its first frame). The city is now built, its textures loaded, its shaders compiled for the buffer they draw into, and everything drawn once into a tiny target while the title card and the black after it are up: the first frame in the city is 2.5 s. The desktop build no longer starts everyone on Cinematic: a first run picks a preset for the graphics chip (`gpuTier` in `quality.ts`; an RTX A500 gets Web). Web holds 51 to 56 fps walking the bazaar (45.6 on live main), with fewer real bodies (5), its props' light builds up close, and only near bodies casting shadows. The planet is on 200 m terrain chunks (a quarter of its terrain draws). `tools/hitch_tour.py` plays the whole opening on the GPU and lists every frame over 50 ms with what it did. | blocker | improved |
| 41 | People | Pedestrians turned into other people as they came close: a far card showed one of eight baked townsfolk at random and the body that took over was someone else. Everyone in the crowd now wears one of eight looks, the card is baked from that look and only a body of that look takes it over; the six and Mir are never cards. Fewer people: the bazaar's crowd halved, the districts' walkers about a third fewer. | major | fixed |
| 42 | Traffic | Cars drove through people. Cars stop with their front behind the zebra, brake for anyone in front, give way when turning; walkers wait until no car is on the crossing; the old town's cars stop for anyone in their lane and the gate crowd keeps to the pavements. `tools/traffic_smoke.py` (in CI) runs a simulated minute at five places and fails on any overlap or any walker on the road outside a crossing. | major | fixed |
| 43 | The flat | Too small. It is now 11.5 by 15.2 m: a hall, a kitchen along one wall, a living room with two windows on the street, a bedroom and a bathroom behind a wall with doorways, a 3 m ceiling. | major | improved |

### Numbers (1.3, Windows Chrome on the RTX A500, `tools/gpu_tour.py`, main and this tree back to back)

Measured in one exclusive slot, main (63a3686) and this tree alternating preset by preset at 1280 x 720 (the phone
proxy at 844 x 390 with Chrome's 4x CPU slowdown). The laptop was in a slow state all day (the CPU reported 1.4 GHz,
and another agent's game tab was running in its own Chrome), so the phone proxy is far below the 38 to 60 that main
measured on a quiet evening; what the table shows is that this round costs nothing measurable against main.

| Preset | main | 1.3 |
| --- | --- | --- |
| Mobile proxy | 9.4 to 15.7 | 9.2 to 13.4 |
| Web | 52 to 60 | 52 to 60 |
| Ultra | 34 to 59 | 33 to 53 |

I also found and closed a browser tab left running the game by an earlier capture session (on another debugging
port); it had been drawing the city in the background for hours and explains part of the low numbers in earlier runs.

### Still below the bar (1.3)

- The street walls above the shopfronts are still shaded boxes with windows: real modelled facades (bay windows,
  balconies on every type, varied rooflines along a block) are not there.
- Phones keep their simple walls (no room behind the glass); their shop panes now show shelves of goods.
- Cafe customers stand by the chairs; there is no sitting-on-a-chair clip.
- Courtyards inside the blocks are empty paving.
- Textures are still WebP, not KTX2 (no encoder on the build machine yet); the web build is 160 MB.
- Frame rate: see the numbers; the laptop was shared with other agents' jobs for most of this round.
