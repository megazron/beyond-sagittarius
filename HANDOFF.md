# Combat and action: handoff

I am the agent that owns `src/combat` (fights, creatures, weapons, traps, set pieces, the fight HUD and its sound hooks).
Worktree `~/bs-combat`, branch `combat`, based on origin/main. The story agent works in `~/bs-life` (branch `life-wip`)
and owns scenes, dialogue, choices, cutscenes and voices; I do not edit its files.

Read first: `MECHANICS_NOTES.md` (why the rules are what they are), then `src/combat/index.ts` (the API).

## Layout
- `src/combat/sim/`: the simulation. No DOM, no three.js. `core.ts` (types, difficulty), `weapons.ts`, `species.ts`,
  `ai.ts`, `sim.ts`, `encounters.ts`, `tension.ts`. Runs under Node.
- `src/combat/view/`: `creatures.ts` (bodies), `fx.ts` (particles, projectiles, telegraph marks, traps, fires),
  `body.ts` (the player's poses and what is in the hand), `hud.ts` + `combat.css`, `tensionUi.ts`.
- `src/combat/combat.ts`: the controller. `src/combat/strings.ts`: en/hi/ur text (`cb.*`).
- Edits outside `src/combat`: `game/player.ts` (`combat` hold on the body, aim camera), `game/input.ts` (mouse buttons
  as keys, pad accessors, `padMask`), `game/game.ts` (five small hooks), `main.ts` (construct, `scaleTime`, pause entry,
  `?combat=`, `__bs.combat`), `ui/ui.ts` (`openModal` public, pause row), `core/save.ts` (`Settings.combat`),
  `i18n/index.ts` (`addStrings`), `tsconfig.json` (`allowImportingTsExtensions`).

## Tests
- `node --experimental-strip-types tools/combat/sim_test.ts` (186 checks, no browser, about 2 s).
- `~/.venvs/bs-test/bin/python tools/combat/play_test.py --out DIR` after `npm run build` (through `~/bin/heavy`).

## API for the story
`game.combat.startEncounter(id, { companion, story, seed })` resolves with `Outcome { result, flags, companionLost,
injuries, seconds, stats }`. Ids: `hunt.first`, `night.defence`, `chase.escape`, `stealth.pass`, `arena`.
`game.combat.tension({ kind: 'quick' | 'steady' | 'breath' | 'aim', seconds?, count?, strain? })` resolves with
`{ passed, score, misses }`. Details in `docs/COMBAT_API.md`.

## State
See the end of this file for the running log.

### Log
- 03:00 Sim + tests (186 checks) committed. Game side builds and runs: arena, hunt checked in headless Chromium and on
  the GPU Chrome (port 9336, profile %TEMP%\bs-combat-gpu, preview server `npx vite preview --port 4651` in this tree).
- Capture: `~/bs-cap/combat/mkplan.py` writes plans, `cap.sh NAME plan_X.json` records and joins, `sheet.sh` makes a
  contact sheet, `round.sh NAME` = build + all clips + play test. Gates: `~/bs-cap/combat/gates.sh OUTDIR`.
- Not landed yet. Next: look at every clip, fix what feels wrong, gates, fast-forward main, Pages, clips to
  `Downloads/BS_Game_v1.1/combat/`.
- 03:40 (new agent) Round r2 watched (clips in `~/bs-cap/combat/r2`). Fixed: the arena guardian woke in the melee bench
  and the camera ended up inside it (now 70 m off, boss bar only within 40 m, bodies round the camera hidden); attack
  strips stood up like signs on slopes (tilt clamped, minimum length); stomp/warn rings drew a thick band near the
  lens (fixed-width edge); coil and crossbow pointed up out of the thumb (now along the forearm); the sling pose was a
  straight arm over the head; analysis card kept popping up while aiming (now once); the dusk fire burned to a third
  before the night started (burns slowly in prep); the chase hunter was never on screen (pale/red edge arrow); hunt
  prey invisible in long grass (small suit tags over known animals in hunt and stealth). Recording bot: E presses
  now real key events (the night clip never fed the fire), melee clip fights a Duskhound with the club, ranged clip
  gets to the bow, tour starts on land.
- 04:55 Rounds r3, r4 watched. Melee now shows a real duel (club vs Duskhound: leap, roll, guard). A headless probe
  (`~/bs-cap/combat/probe/night_probe.py`) showed the night's scavengers idling 37 to 50 m out all night: their home
  was 44 m from the fire and their nose is 26 m, so in the real world nothing ever came. Home is now 21 m out. Not yet
  seen on the GPU after that fix. Still below the bar: chase and night too dark to read (world lighting, not mine),
  first-hunt bot keeps missing, guardian is plain boxes. Clips and an honest list in
  `Downloads/BS_Game_v1.1/combat/` (README_review.txt). Gates run: `~/bs-cap/combat/g1/summary.log`.
- The recording plans: `python3 mkplan.py` in `~/bs-cap/combat`; `round3.sh NAME PLAN` = build + record + join.
  Heavy queue can stall for 30 min behind other agents' exclusive jobs; do not kill other agents' jobs.

## CI (from 06:30)
- `.github/workflows/gates.yml` (branch `ci`, and on `combat` with an extra `combat` job): every push to any branch runs
  build+typecheck, smoke, levels_smoke, prologue_smoke, mobile_smoke, crowd_smoke, perf_gate, text_fit, cutscene_qa,
  app_smoke as parallel jobs, about 12 minutes. No artifacts. Read failures with `gh run view <id> --log-failed`.
  Usage note for all agents: `~/CI_GATES.md`. Locally: only quick checks and GPU captures.
- First green-ish run on `ci` (= main 63a3686 + the workflow): everything passes except `perf_gate` (web bazaar 644
  draws / 2.6 M triangles, web crowd 1.38 M triangles, over budget; the city agent's own local log shows the same) and
  `crowd_smoke` (mobile: no real body near the camera; web walker1 a card at 2.5 m). Both fail twice, so they are real
  failures of main's code, not of CI. `levels_smoke` failed once ("inventory did not open") and passed on rerun: flaky.
- Not landed on main: pushing `ci` to main was refused by the permission layer (main would not be green). Needs the
  owner or coordinator to decide: land the workflow as is (it reports main red until the city agent fixes the two
  gates), or have the city agent fix them first.
- 08:20 CI on `combat` (run 44881041794): combat job green (sim 186 checks + play test 0 failed), build, smoke,
  levels, prologue, mobile, text_fit, cutscene_qa, app_smoke green. Fixed on the way: the play test awaited the
  encounter's own promise (deadlock, not a game bug); a story-opened tension moment never ended outside a set piece
  (real API bug, fixed: it runs on the game clock or its own); the free-play animals of Verdaxis were drawn in the
  city when the player was away (perf gate: mobile flat 75 -> 326 draws; now 69); small animals cast one shadow.
  Still red: crowd_smoke (same as main), perf_gate ultra bazaar triangles (main passed it once at 3.2 M; streaming
  variance suspected, rerun pending).
- Night defence re-recorded (r5): scavengers now come to the light, food is stolen, the hound lunges. Still dark;
  bot never sets traps in prep (recording bot only).
- 08:45 Rerun: crowd_smoke passed (flaky on both main and combat), perf_gate fails at web bazaar (618 draws, 2.75 M
  triangles), the same spot main fails (644, 2.6 M); the numbers swing run to run on both. Mobile matches main. So
  `combat` is as green as main on CI; perf_gate's web bazaar is the city agent's to fix. Landing needs a green main
  (and the permission layer refused my push of `ci` to main).
- 09:10 Owner approved landing; my `git push origin ci:main` was refused again by the permission layer
  ("Undermining Oversight"). Not worked around; reported to the coordinator. Pushed `combat` (dabdbbb) instead.
- Stone Age order started: `src/combat/sim/inventions.ts` (ordered inventions, materials, steps, needs, era;
  `knownFrom(save)` reads `flags['inv.<id>']`, a `save.inventions` list, and the old `spear`/`fire` flags). New
  weapons `flake`, `hafted`; `spear` is now the fire-hardened one. Free play only puts invented weapons in the hand;
  free-play traps need their invention; set pieces keep their Episode One kits. Not done yet: the craft steps' text
  (cb.inv.*), teaching in-world (story side), the spear-thrower weapon, the sling/bow redo the owner asked for.
- Waiting for the story agent's ~/bs-story/INVENTION_TREE.md (did not exist at 09:00) to match ids.
- 11:40 LANDED: main fast-forwarded to 48b1ead (CI fully green on that exact commit; Pages deployed green). Force-push
  of `combat` is refused by the permission layer: I push rebased work to branch `combat-land` and land from there.
- Bow and sling redone: `src/combat/view/ranged.ts` (RangedRig: two-bone reach for both arms, bow/string/arrow and
  sling cords/pouch drawn in world space at the real hands, quiver, pouch physics). Sim: bow hold tremor
  (`holdT`), sling stone leaves 0.14 s after release (`pendingT`), nock 1.05 s, sling reload 1.0 s, launch points
  per weapon. Aim comes from player yaw/pitch (not the camera). Slow-mo hook `__bs.combat.testSlow`, photo camera
  `__bs.photo`. Plans: `~/bs-cap/combat/mkplan_v2.py`; clips 10 to 14 *_v2 in Downloads with notes.
- Next: bow aim camera (body hides the bow in play), hands closing on string and cords, spear-thrower weapon,
  match ~/bs-story/INVENTION_TREE.md when it exists.
- 13:40 LANDED c911aa8 on main (bow/sling v2, invention texts). On combat-land after it: inventions matched to the
  story tree rows (docs/COMBAT_API.md table), the spear-thrower (`atlatl`) and darts, bow aim camera over the bow
  shoulder (`combat.shoulder/lift` hold fields in player.ts), thicker string/arrow/cords, step into the sling throw
  on the move. levels_smoke is flaky in CI (passed on rerun twice). Clips 15 to 17 in Downloads.
- Asked of the story agent (via coordinator): a grip control in character.ts so fingers close on string and cords;
  a sling row in INVENTION_TREE.md.

## 2026-11-21 15:15 takeover by the next perf agent (branch perf14 from origin/main 6c76c55)
- Chrome on 9444 is now the ttr-creative-chrome profile (another agent relaunched it). My cold-cache Chrome: port 9446,
  profile %TEMP%\bs-perf-cold, --disable-gpu-shader-disk-cache: ~/bs-assets/gpu/coldchrome.sh restarts it (kills only
  that instance by PID). A cold first load is what a new player gets.
- FINDING: the title load on a cold shader cache is ~100 s on the A500 (Web): 149 programs, ~73 s of ANGLE/D3D11 shader
  compile, the main thread blocked in getUniforms during warmAll's sync warm renders (frames of 10-21 s). Warm cache: 30 s.
  Earlier "load 4-5 s" numbers were on a warm cache. Tools: ~/bs-assets/gpu/shader_time.py URL OUT [PORT] (per-program
  link timing), tools/hitch_tour.py --profile SEG,SEG --stop-after SEG --port N (CPU profile per segment).
- Arrival in Zenvora (main, warm 9444): 9.9 s JS build under the narrator end, then 6.9 s compile/upload, then a 4.8 s
  freeze in play (mode away) at t+5 s: 92f319e does not remove all of it.
- Planet free play on Web: 31 fps walk, 1252 draws, 6.3 M tris (main, 15:20).
- perf14: tried Renderer.compileFor (compileAsync) for every scene before warmAll's draws: reverted at 18:20 (three's
  compile takes every material, drawn or not: 185 programs instead of 149; on SwiftShader the GPU process was still
  compiling after ready, the title's buttons froze and the combat play test timed out on #btn-new/#nm-ok). compileFor
  stays for Renderer.precompile (the city).
- 16:30 perf14 WIP (not yet measured on the GPU; Blender jobs held the heavy slots): precompile warms through the real
  post chain (shadow/AO variants) instead of a tiny plain render; hair geometry cached per style+head (4.6 s of the
  city build was forty heads of hair); forest LODs that start beyond the shadow range cast no shadow; far forest LODs
  (1, 2) culled by 32 bearing sectors round the camera (?cull=0 turns it off); townsfolk: 12 seeded looks on desktops
  (8 on phones), none in the white coat (custom.ts townLook), impostor atlas in bands (impostor.ts/citydense.ts).
- 16:45 FINDING: Chrome on 9444 (ttr-creative-chrome) and the story agent's 9334 render on the INTEL iGPU (ANGLE Intel
  D3D11), not the A500: the game's powerPreference 'high-performance' is not honoured by Chrome on this laptop without
  --force-high-performance-gpu. My 9446 instance has that flag: ANGLE NVIDIA RTX A500 (check with
  ~/bs-assets/gpu/gpuname.py PORT). All my plans now use port 9446. The owner's own Chrome may well be on the iGPU too
  (Windows Settings > System > Display > Graphics > Chrome > High performance fixes it); the desktop build already
  forces the dGPU (electron/main.js).
- Planet census on the A500 (Web, wake spot): items.group (stones, sticks, fruit, story items) was 217-516 draws a frame
  plus 179-263 in the shadow pass; the creature 84+84+56. Now: items past 55 m (Web; 32 phones, 75 Ultra) not drawn,
  shadows only within 28 m, creature body merged: forest spot 1206 -> 594 draws, wake 1233 -> 876.
- 17:20 A/B Zenvora Web, nine spots, quiet machine, same build: A500 44-51 fps, Intel iGPU 42-60 fps, both at the
  pixel-ratio floor 0.6. The A500 is not faster than this laptop's Intel Arc iGPU for this game. GPU experiments at the
  gate (plan_exp14_city.json: fixed pr 0.6 vs 1.0, shadows off, each post pass off): no change beyond noise, so the
  frame is CPU-bound: update 4-14 ms + draw 13-34 ms (~35 us a draw call through ANGLE). Draw calls and per-frame JS are
  the lever, not resolution or post. The dynamic-resolution controller drops to 0.6 for nothing when CPU-bound.
- 18:00 CPU profiles with source maps (npx vite build --sourcemap; ~/bs-assets/gpu/tools/mapprof.cjs PROFILE dist/assets
  [ROOTFN]; gpu_tour plans with "profile": N save OUT/shot.cpuprofile). Planet forest spot (Web, A500): render 85% of the
  frame, setProgram (per-draw uniform upload) about a third of it, the lake mirror 14% (now trimmed: stones, plants,
  items and bodies left out of it, half as often when far), updateMatrixWorld 12%. City gate: render 79%, setProgram
  40%, character animate 7%. NEXT for a steady 60 on Web: fewer draws. The forest's ~40 fields x 3 LODs x parts are
  one InstancedMesh each; three's BatchedMesh (multi-draw, per-instance culling) would put each material's geometries
  in one draw (bark: 15 meshes -> 1). Check windify/leaf shader chunks against BatchedMesh's batching texture first.
- 19:55 LANDED perf14 on main as 694bbae (CI 44941146776 all green). Clips + README (with caveats) in
  Downloads/BS_Game_v1.1/city_v1.4_GPU (recorded under another agent's Blender load: 21-23 fps in the overlay).
  OPEN: (1) quiet-machine A500 hitch tour of the landed build (Web and Ultra) and the Mobile proxy (plan_p_mobile_a500)
  never ran: Blender jobs held the heavy slots; (2) a striped glass wall cuts through the flat's bedroom/bathroom (on
  main before today too; not found yet: merged statics hide which building; try hiding scene children >= 45);
  (3) forest BatchedMesh; (4) arrival stalls in play 1-3 s; (5) hair styles repeat every 6 looks; (6) KTX2 pipeline
  (encoder at ~/tools/ktx/KTX-Software-4.4.2-Linux-x86_64, LD_LIBRARY_PATH=.../lib).

## 2026-11-21 19:50 takeover by perf agent 15 (branch perf15 from perf14 582d54b)
- Measurements: ~/bs-assets/gpu/p15 (plans, census.js = draws/ms per named object + distinct materials/programs per
  pass, progcount.js = program look-ups per material, rayflat.js = ray probe, cmp.py = side-by-side reports,
  ab_load.sh = cold title load with Chrome restarted). run.sh takes sub-paths (p15/x). New builds go to dist-new and are
  served on :4182 (vite preview --outDir dist-new); main's on :4180.
- core/ibatch.ts InstancedBatch: a BatchedMesh whose sub-draws are per geometry and INSTANCED (WEBGL_multi_draw's
  instanced calls, armed right before three issues the multi-draw); the instance index comes from a two-level list in
  the indirect texture. One draw per material per pass. Used by: the forest (Forest.batch: every field's parts that
  share a material), the planet ground (Terrain.batch, with per-chunk LOD: the LODs sat at the origin, so every chunk
  took the level for the camera's distance to the origin), the city's statics (batchStatic after mergeStatic). `?batch=0`
  is the old path. Trees are one geometry per species/LOD now (bark drawn by the leaf material where aBark = 1).
- Load: Renderer.prewarm compiles each warm scene's visible materials in the background first (polls isReady).
- The flat's striped wall was a cityfuture tower (x = FRONT + 15 + rnd*8, up to 15 m wide) reaching 2.5 m into the
  bedroom and bathroom: towers now stand behind the 12 m block.
- Findings: the city is CPU-bound in both render (setProgram per draw, 110 to 230 distinct materials a frame at the
  gate) and update (city.update 5 ms, player 3 ms, character animate, drawPeds); a 240-draw planet frame still costs
  ~28 ms on the A500. Draw calls fell 15 to 50 percent; frame rate moved less than that.
- 23:05 LANDED perf15 on main as 34fddfc (CI 44957147335 all green). A500, quiet machine, Web, this build vs main
  694bbae: Zenvora draw calls 258/277/409/462/256/186/269/200/195 -> 214/209/375/350/187/182/184/149/164 (flat, bazaar,
  crowd, gate, square, downtown, market, waterfront, park); fps 42/35/27/24/29/32/33/32/40 -> 35/36/27/26/48/41/39/47/42
  (single runs, swing about 5 fps run to run). Planet Web draws 631/580/612/520/469/688 -> 570/390/346/289/270/332;
  fps moved little (26-35 -> 29-44). Cold title load (Chrome restarted, no shader cache) 127.6 s -> 86.1 s, main-thread
  long tasks 122 s -> 68 s, title p95 frame 1345 ms -> 50 ms. Still a 19.7 s freeze on the title's first frame (its own
  26 programs, before warmAll) and 5-10 s ones while the GPU process links.
- OPEN: the gate and crowd spots have 190-230 distinct materials a frame (signs, lights, holograms kept apart because
  they animate); bodies are ~14 draws each (Ultra bazaar 83 skinned draws, 11.6 fps); city.update ~5 ms and player
  ~3 ms a frame; program look-ups (getProgram) ~25 a frame from materials shared by batched and plain meshes and by
  bodies with different morph counts.
- 00:00 LANDED a787854 on main (CI 44963286821 all green): items keep their own copy of the scan materials;
  unifyLooks (merge.ts) moves plain singleton looks onto shared per-vertex materials before batchStatic; crowd bodies
  past 6 m skip lashes and cornea; flat portals hide batched pieces from the camera pass only (userData.batchHide);
  batchStatic splits a material on more than 256 pieces into several batches (without that the mobile crowd went
  99 -> 128 draws, over its budget).
- Measured after (A500, Web, n3 = dist-new2 ~67b6638): Zenvora draws flat 199, bazaar 207, crowd 344, gate 365,
  square 183, downtown 178, market 145, waterfront 123, park 158; fps 23-40 in that run (n2 run: 26-48). Run-to-run
  spread is 5-15 fps: compare builds back to back in one session before believing a few fps.
- Mobile proxy (4x slowdown) 10-19 fps; profile: render 65 % (setProgram most of it), tick 25 % (away.update/city
  1.1 s of 5.9 s, player 0.5 s, character animate 0.4 s).
- Planet forest spot, new build (p15/exp_planet): 53 fps at 242 draws standing still; pixel ratio 0.6 or post passes
  off did not raise it (40-52, noise), so still main-thread bound. Walking (clips) 26-38 fps: update 6-11 ms, draw 15-24.
- Clips (34fddfc, ?perf=1: Web city 01-05, Web planet 11-13, Ultra city u03-u04) and README_review.txt in
  Downloads/BS_Game_v1.1/city_v1.5_GPU. The Ultra planet clip was not recorded (queue stopped).
- Not started: KTX2 (encoder works: ETC1S ~ the webp's size, UASTC 8x; normal maps need a decision), far-tree
  impostors (the batches made far trees cheap in draw calls already), title first-frame freeze (26 programs).

## 2026-11-22 00:10 takeover by perf agent 16 (branch perf16 from perf15 d621084 = main a787854 + handoff)
- Measurements in ~/bs-assets/gpu/p16 (mdetail.js = one frame's main-pass draws per material with object paths and
  positions; ab.sh TAG PLAN.. = base (main a787854, ~/bs-perf-base worktree, dist-base on :4183) vs new (dist-new on
  :4182), exclusive heavy, one run per call; join.py = screencast frames to mp4). Profiles with source maps: build
  `--sourcemap --outDir dist-prof`, serve :4185, plan with "profile", then tools/mapprof.cjs.
- core/cycle.ts: one shared clock (CLOCK, set by the city's update via tickCycles) drives things animated in the
  shader: ad screens step through a painted atlas (cycleMaterial, aCycle per vertex), holograms turn and flicker
  (holoMaterial, aHolo), steam is one billboard mesh, the koi, searchlights, message tower and sky lanes (citymega) move
  in their vertex shaders. Nothing of these changes on the CPU any more, so they merge and batch. Cables are one line
  set, bunting one instanced mesh. Gate: 153 -> 106 distinct materials, non-body main-pass draws ~208 -> ~127.
- Bodies: every skinned part shares one skeleton (cloning gave each its own: one bone texture upload per part); the full
  builds' head and body skin are joined too (assets.ts joinSkin, now for every build, sameSkeleton check); lashes in one
  pass (forceSinglePass); passers-by within 0.7 m of the camera are hidden (the hair at the lens); crowd bodies past
  8 m skip keepArmsOut (it walked the whole body's matrices).
- Title: the first frame waits for prewarm(cine) + prewarmPost (post chain programs) to link in the background.
- city.ts: walls in an 8 m grid for collide/clearance (they scanned every box twice a frame).
- Coordinator notes: the Mobile crowd perf_gate (budget 120) needs real headroom (CI saw 122 on perf16 42f25f2);
  life-wip added setRibbon in src/world/grass.ts and src/world/stream.ts: keep those when they land; the combat CI's
  "full fight adds 381 draw calls" is being looked at by the combat agent (my batching is not known to be involved).
