# Cutscene QA

Every cutscene played through `tools/cutscene_qa.py` on a hand-stepped clock, one frame per second
(0.75 s in the title sequence), then read frame by frame. Frame names are `<scene>/<seconds>` from the
first pass, or the pass named. `b` numbers are music beats (2.67 per second). Sheets from the final pass
are in `docs/screenshots/qa/`, 30 frames each, in time order. `before-deck-pass1.jpg` is the deck as first reviewed.

Scenes covered: opening (Vault intro, departure, journey, deck, the event), title sequence, wake-up,
Vault l3, l7 and ch1, fight flashback, rescue, camp talk, beacon.

`[x]` fixed and checked in a later pass. `[~]` improved, not solved. `[ ]` left, with the reason.

Total: 61 found, 49 fixed, 6 improved but open, 6 left. Three of the fixed items were regressions from this work.

## Title sequence

1. [x] `film/b37`, `b50`: speed lines thick, white and on every shot. Now thin, at the edges, on the drop, the braid and the last fall only.
2. [x] `film/b37`-`b45`: trails burned out half the frame. Far softer, and they point away from the lens.
3. [x] `film/b117`: heat sphere around the player read as a bubble. Cut.
4. [x] `film/b47`: player's trail ran through the camera, frame went white. Direction reversed.
5. [x] `film/b18`: deck blow-out was shot from crotch height with legs filling the frame. Camera raised and pulled back.
6. [x] `film/0006`: a glass shard crossed the lens as a flat blue block. Shards start at the window and are a third the size.
7. [x] `film/b26`: the ring of six was too small to read. Camera closer, hole nearer.
8. [x] `film/b29`: only one hand in the macro shot. Bodies now steer so both wrists land on their marks.
9. [x] `film/b59`: planet looked like a toy, blown clouds and teal blotches. Now a dark world with a thin lit crescent.
10. [x] `film/b64`: flat shock ring at each impact looked cheap. Cut.
11. [x] `film/b68`, `b126`: blocky glowing squares in the scorch marks. Replaced by a soft burn.
12. [x] `film/b81`, `b89`: neon rig lights blew out Bolzar and Skyvra. Key and rim cut to about a quarter.
13. [x] `film/b73`: Lyrra floated above the lake bed. Now waist deep, wading to shore, from the shore.
14. [x] `film/b68`: Draxum pushed at nothing, and the "tree" found was a boulder. He now has his own huge trunk.
15. [x] `film/b88`: camera inside a fir, frame black. Wides are placed above the canopy.
16. [x] `film/b97`: camera inside the mountain on Nuvexa. Camera height now clamped to the terrain.
17. [x] `film/b105`: Nuvexa's card stayed on into the next shot. Every cut clears the card.
18. [x] `film/b84`, `b92`, `b100`: poses blended in on camera, so Bolzar stood instead of sat. A cut now starts in the pose.
19. [x] `film/b126`: the idle player model and an NPC stood in the crash shots. Hidden for the sequence.
20. [x] `film/b71`: the ringed planet blew out to a white shape over the lake. Night boost reduced, shot turned away.
21. [x] `film/0026`: comets off screen for most of their approach. Head kept in frame throughout.
22. [x] `film/b63`: comet wides close to black. Act III now runs dusk to dawn, and wides hold the sky.
23. [x] `film/b126`: "legs out of the dirt" gag read as a mushroom, then a bell. Cut. He lies face down instead.
24. [x] `film/b117`: falling close-ups missed the face. Body turned belly down, camera below.
25. [ ] `film/b100`: Nuvexa's peak is big dark triangles. That is the far terrain's mesh density. Needs a higher LOD on the rim, not a camera fix.
26. [ ] `film/b105`: the crash pod already smokes before the player has landed. The pod is the wake-up's prop. Small continuity slip.
27. [x] `film/b71` pass 6: a dark trunk stood across the lake wide and cut the comet in two. It isn't a registered forest obstacle, so stepping sideways didn't clear it. The wide now sits out over the water.
28. [~] `film/b68`: Draxum's face is mostly hidden by his own arm against the trunk. The joke reads from the body, not the face.
29. [~] `film/b84`: the fir behind Bolzar catches too much of his green light.
30. [ ] `film/b110`: from the air, the mountains are flat colour. Fog is reduced, but the far terrain has little detail to show.

## Opening

31. [x] `opening/0022`: Ledger page blown to white. Now readable.
32. [x] `opening/0029`: MegaZroN's head cut off by the bottom of the frame, in all three Vault close and profile set-ups. Reframed.
33. [x] `opening/0001`: Vault wide too small and dark to read a face. Closer, with more fill.
34. [x] `opening/0047`: soft white ball on Earth's ocean. Sun glint reduced.
35. [x] `opening/0063`: engine plume a hard-edged cone. Now fades out at its silhouette.
36. [x] `opening/0087`: back of Lyrra's head while she speaks. Cuts now snap actors to their marks, and the camera refuses a speaker's back.
37. [x] `opening/0096`: Skyvra's back while she speaks in the two-shot. Replaced by a mid shot.
38. [x] `opening/0110`: Nuvexa's hair filled the lens on Bolzar's line. The camera swings clear of anyone in the way, hair included.
39. [~] `opening/0092`, `0120`: foreground actor burned out in over-the-shoulder shots. Lamps ease off near listeners and the sun is lower on the deck. A hot edge remains on Zenvik's coat in one shot.
40. [x] `opening/0119`: "Who's got the brain cell?" was all backs. Replaced by a mid shot.
41. [x] `opening/0145`: Skyvra cropped to her hair and bent at an extreme angle by the `point` clip. Clip removed from her scenes, frame tracks her head.
42. [x] `opening/0154`: four flat white engine discs in the foreground. Engines read as dead now.
43. [x] `opening/0155`: red alert text unreadable over the disk. Dark backing added.
44. [x] `opening/0175`: floating props were big coloured cubes. Now small debris.
45. [~] `opening/0175`: the event was shot from behind the crew and burned out. Exposure fixed and turned side-on, but faces still don't lead the shot.
46. [x] Regression in pass 2: the camera solver moved fixed shots, so the selfie framed a bare wall. It now only moves coverage built on the speaker.
47. [x] Regression in pass 2: first frame after a cut pointed at the wrong place (`rescue/0005`, `0015`, `opening/0101`). The aim point was never set, because a merge had moved the line my edit targeted.
48. [x] Regression in pass 3: the sun showed as a ball inside the deck. Hidden indoors.
49. [~] `opening/0076`: the selfie's side view played up Nuvexa's sweater. Now framed from the front. The sweater's shape is in the model and is not fixed.
50. [x] Not visible at this size, but real: the deck sat 60 km from the origin, which costs skinned faces centimetres of float precision. Moved to the origin.

## Fight flashback

51. [x] `fight/0006`, `0036`: boxes from the disaster hung in the air, one on Zenvik's head, one on Bolzar's chest. The memory now starts clean.
52. [x] `fight/0006`: console stuck on red alarm in a scene set days earlier. Reset.
53. [x] `fight/0036`: camera inside Draxum's shoulder on Skyvra's line. Replaced by a mid shot.
54. [~] `fight/0031`: glare on Zenvik's collar. Console light cut to a third, some glare remains.

## Vault scenes (l3, l7, ch1)

55. [x] The Ledger page and head framing fixes under Opening apply in every scene.
56. [ ] `vault-l3/0010`: hair and quill bloom heavily. Reads as a glow in motion, left as his look.

## World scenes

57. [x] `rescue/0001`-`0020`, `camp`, `beacon` first pass: Skyvra missing from every shot. Not a game bug: the test hook hadn't set the level. Scenes reviewed again with her present.
58. [x] `camp/0011`: a tree trunk filled the frame. The camera now rejects trees and the ground.
59. [x] `beacon/0012` pass 4: Skyvra bent over sideways by the `point` clip. Removed.
60. [ ] `wake/0028`: chapter card sits across the player's head. Minor.
61. [ ] All world scenes: bodies stand still between lines. There's no conversational body language in the clip set.

## Limits of this review

- Lip sync was not reviewed: mouths follow the audio clock, which doesn't run while the clock is held.
- Sound and picture sync was never heard. Only the beat map and a spectrogram were checked.
- Everything was judged on software GL at 960x540, Web preset. Nothing here has been seen on a real GPU.
- Frames every 0.75 to 1 s can miss a glitch that lasts a few frames.


## Rendered or real-time

Honest list. Rendered means a Cycles film from `tools/film/`, played by `src/cinematic/filmvideo.ts`. Everything else plays in WebGL.

| Scene | State |
| --- | --- |
| Black hole entry (`tools/film/entry.json`) | In production, first scene for the owner to judge. Not in the game yet |
| Title sequence, the fall and the lights going out | Real-time |
| Deck scene | Real-time |
| Player's landing and wake-up | Real-time, landing rework still to do |
| Vault scenes (l3, l7, ch1, ch2) | Real-time |
| Fight flashback | Real-time |
| Skyvra on the ring (Level 9) | Real-time stage, reveal film not made |
| Camp and beacon radio scenes | Real-time |
| The four other reveals | Not made. Waiting on the owner's review of the story |

## Render plan from the narrator onward

Order is fixed: the black hole entry is locked first, then the narrator, then each scene after it. Every scene goes through the same pipeline:
1. A dev stage under `dev/` drives the scene from the real game code.
2. `tools/film/edl.py` times it to the voice takes.
3. `tools/film/dump.py --stage` dumps it.
4. `tools/film/rig_dump_check.py` gates it.
5. `render_all.sh` renders it.
6. `encode.sh` encodes it with the mix.
7. I watch it frame by frame before it goes to the owner.

| Scene | Content | Length (est.) | Render budget (est.) | State |
| --- | --- | --- | --- | --- |
| Black hole entry | deck, the event, the six pulled apart | 67 s, 1611 frames | 10 s per frame on a1, 30 to 50 s on the deck: about 15 h | rendering |
| MegaZroN intro (Vault) | `mz.intro.1` to `.5`: wide, push-in, orrery, hands on the Ledger, close | about 45 s, 1080 frames | one character, a large interior: about 25 s per frame, about 8 h | next, after the entry locks |
| Vault l3, l7, ch1, ch2 | the narrator's returns | 30 to 60 s each | about 6 h each | after the intro is approved |
| The six reveal films | one per crew member, after the owner reviews the Scatter | 30 to 45 s each | about 6 h each | waiting on the owner |

**MegaZroN intro, the shots** (from `vaultScript('intro')`, kept so the real-time fallback and the film match):

| Shot | Line | Framing | Action |
| --- | --- | --- | --- |
| 1 `wide` | `mz.intro.1` | Wide on the Vault: the Ledger lectern, the orrery, the black hole through the dome. MegaZroN small, back to camera | Turns, sees us, sighs |
| 2 `push` | `mz.intro.2` | Slow push-in to a mid shot | Presents himself, one hand to the Ledger |
| 3 `orrery` | `mz.intro.3` | Over his shoulder onto the orrery: six lights in a ring | Points; the six lights drift apart on "Then the worst" |
| 4 `hands` | `mz.intro.4` | Insert on the Ledger | His hand writes; the ink glows and settles |
| 5 `close` | `mz.intro.5` | Close-up, eye line just off the lens | Holds the look, the faintest smile, cut to black |

What it needs that the entry didn't:
- A Vault set at film grade, with the deck's look-dev applied: materials, practicals, greebles.
- MegaZroN's robe in cloth that passes the clipping gate.
- Face performance from `tools/film/face.py` on the five lines.
- The Ledger's ink as an animated emissive.

The voice is the approved Chatterbox take, re-done in the full re-voice with direction per phrase.

## Line timing

`python tools/line_timing.py` reports lines over 4.5 s, lines of 3 s or more with no pause in the audio, and for the timed opening how long the picture would freeze or a line would run past its shot. The real-time opening stretches its shots to the takes of the current language (`fitToVoice`), so the freeze figure is what the written timeline asks for, not what plays. Rendered scenes are cut to the takes by `tools/film/edl.py`, which fails if a line outlasts its shot.

## Clipping gate

Two checks, both measured on the meshes the player or the camera actually sees.

- `python tools/rig_check.py` plays every clip on every body (the six crew, the suit and every custom build) in `dev/rig.html`. It reports hand runs, garment runs and one-frame vertex leaps per body and clip.
- `python tools/film/rig_dump_check.py <dump> --timing <timing.json>` runs over a film dump: every frame, every character, reported per shot. It measures:
  - **Hand:** how deep any hand vertex sits behind the surface you see: body skin (torso and thighs) and the garments over the torso. Hand and body are told apart in the frame where that body's hands are furthest from it. The limit is 2 cm, after allowing 1.5 cm into cloth because a resting hand presses into a soft coat. Every flag up to 1.7 cm was looked at in close-up (a hand on a coat or a bag) and none showed. The medic's buried hand before the fixes read 3.3 cm.
  - **Through cloth:** how far skin comes out through the garment that covers it. Each skin vertex covered at rest or in the reference frame is held to the garment vertex over it then, so a sleeved wrist resting on a coat's side is contact, not a poke. Openings (cuffs, collars, hems) and hands are never counted. The limit is 3 cm: every flag under it was looked at in close-up and none showed.
  - **Leap:** one-frame vertex jumps.

  Exit 1 fails the shot. `render_all.sh` holds back any shot that fails, so nothing clipped is rendered.
- `--closeup=x,y,z[,dx,dy,dz]` on `tools/film/render_shot.py` renders a sharp frame 0.55 m from a point, from the shot's camera direction or a given one. Every flagged frame is looked at this way before a threshold is trusted.

What the checks found, and the fixes:

- **Skin under a garment kept its own skin weights while the garment used MakeHuman's interpolated ones.** Under a big pose (arms up in the d2 tumble) the two skinned apart, and the strong's side came through his shirt. Covered skin now takes the weights of the garment over it, fading back to its own weights near openings and at the neck. Inner garments do the same under outer ones. Skirts hang free and are never followed.
- **The medic's satchel sat across the side of her right hip** and swallowed her hanging hand. It now lies flat against the hip, a little behind the side seam and high enough to clear the ground when she sits.
- **The arm guard measured the torso from the raw mesh attribute, which is not the body you see.** The real shape also comes from morph targets and quantisation. So slim bodies got a torso about 9 cm thick and no protection: a hand on the hip vanished into the coat in `selfie`, `argue` and `cheer`. Heavy bodies got 30 cm and their arms were shoved out. The guard now measures the skinned, morphed skin in world space the first time the body is posed, and scales with the body.
- **Tried and dropped:** a torso guard built from each body's measured cross-section instead of capsules. It made heavy bodies worse, and once the measurement bug above was fixed, the capsules were enough.
- **Near an armhole or a cuff, skin kept its own weights,** so with the arm overhead it moved with the arm while the vest stayed. Armpit skin was pulled out as orange flaps (the strong, d2 frame 1182, 7.9 cm). Shoulder skin now follows the garment right up to the last 2 cm before the opening. Doing that everywhere made the legs worse, so it applies to the arms only: shoulders, and forearms too. Once a cuff follows the forearm (below), the skin inside it must as well, or a bent wrist pulls skin out of the sleeve (the medic, hand on her bag, d2).
- **Skin deep under a garment is removed at build time, and the cut edge sat 5 cm from each opening.** A raised arm opened the strong's vest armhole wider than that, and the jagged edge showed as orange flaps (d2, frame 1182). The band of kept skin is now 10 cm. It no longer pokes through, because it follows the garment's weights. (The flaps turned out to be the shoulder weights, below, but the wider band stays: it costs nothing.)
- **The covered-skin mask in the shot check came only from the frame where the hands are furthest from the body.** In the d2 tumble that frame has the arms up, so the skin under an armhole never counted as covered and the flaps went unseen. Skin now counts as covered if it is covered at rest or in that frame.
- **Sleeve cuffs were weighted up to 91% to the hand,** so a fast wrist turn threw the cuff (scientist `wave`, 6.8 cm in one frame). Garment weights on the hand and fingers now go to the forearm twist bone.
- **A posed limb aimed nearly opposite to the clip** used the shortest turn, which has no stable axis, so its roll could flip between frames. It now keeps last frame's axis near that case.
- **The leap test counted fast, smooth flailing as a pop** (scientist `float` at full flail: the lower arm turning about 30 degrees a frame, steadily). A pop starts from nothing, so a leap now also needs the vertex to move at least 2.5 times faster than it did the frame before.
- **Game cloth is low poly and read as facets under the deck practicals.** Film renders weld the uv seams and add one smooth level on cloth.
