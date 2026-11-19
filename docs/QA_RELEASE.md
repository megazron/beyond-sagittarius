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

## Left for later

- Phones in Zenvora are still bound by draw calls: at 4x CPU slowdown the street costs about 105 ms of main thread a
  frame and the view out of the flat about 155 ms (free play about 50 ms). The rest is three.js's cost per draw call
  for the townsfolk (a dozen draws each) and the street's props; the next step is fewer, merged meshes per body.
- The sweater hole of item 8, and the inner-garment-at-the-coat-opening cases the skin work measured, need a
  character rebuild.
- No real Android device or emulator has run the app yet (internal testing on a phone is step 4 of
  `store/PLAYSTORE_GUIDE.md`).
