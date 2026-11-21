# bs-perf handoff (city/world/graphics/perf agent)

Worktree ~/bs-perf, branch city13 (WIP on origin/main 63a3686). Not committed to main until all gates pass; land by
fast-forward. Commits as megazron, no AI attribution, first person "I", no em dashes.

## Goal order (owner)
1. Phone proxy (Mobile 844x390, 4x CPU) every Zenvora spot >= 30 fps, Web ~60, Ultra 36-60 on the A500.
2. Buildings not flat boxes. 3. Street life + PBR ground. 4. Far people not cardboard, no popping. 5. Reflections, KTX2.

## Tools
- GPU tours: ~/bs-assets/gpu (run.sh NAME PLAN, multi.sh, show.py, sheet.py). gpu_tour.py port: env BS_CDP_PORT or
  plan "port" (mine: 9444, profile %TEMP%\bs-perf-gpu-profile; 9333 is the old shared one).
- Preview server for dist: vite preview --port 4180 (serves ~/bs-perf/dist). Windows reaches it at localhost, not 127.0.0.1.
- Gates: ~/bs-assets/gates/run_gates.sh (GATES="perf crowd ..." to pick), summary in summary.txt.

## State (2026-11-21)
- city13 WIP = relief/roofs/shop kinds/cafes/recall of cars+walkers/probe clamp. Last gate run on it (03:00):
  perf_gate FAIL web bazaar 2.0M tris, web gate 973 draws 2.87M tris; crowd FAIL web walker1 card at 2.5 m. Investigating.
- Phone proxy on a quiet machine: main 38-60 at all nine spots; city13 40-59 (earlier sub-30 numbers were machine load).

## Done on city13 since takeover (uncommitted to main)
- 05a0379: shops sell what their sign says (BRANDS has a kind; building seed mod 5 = interior kind; tables only at food
  places; podium = counter shops); recessed-window parallax in facade.ts; gpu_tour port from plan/env.
- next commit: projecting blade signs, street food carts with cook + customers, rooftop condensers/masts/dishes,
  impostors baked from 8 sides (IMP.views), recall of cars/walkers never places them anywhere ahead of the camera.
- ~/bs-assets/gpu/round.sh TAG = build + perf gate + mobile/web/ultra fps tours + ultra district stills (port 9444).
- Also: SSR pass on Ultra (renderer.ts SsrPass, scene.userData.ssr set in city.ts update), bollards, phone shop panes,
  near-player townsfolk always bodies (crowd_smoke walker1 fail fix attempt).
- r1 round (03:30-04:00): numbers useless, machine saturated (other agents' builds + Windows GPU capture). Mobile 11-24,
  Web 25-49. Next: ab13.sh = A/B main vs city13 in one HEAVY_EXCLUSIVE slot. main worktree ~/bs-ab-main (detached
  origin/main, node_modules symlinked), its preview on 4181. perf_gate port 4391 collides with the combat agent: use 4747.
- 04:30 more commits: far cards dither out at CARD_FAR (citydense setFar), NCAR [20,55,100], PARKED [20,50,80],
  parkRoads keep one lane each way. A/B ab1 queued (exclusive). After it: rebuild, then plan_dist, plan_night13
  (URL ...?tod=21.5&weather=rain), plan_clips13 -> /mnt/c/Users/Gausms/Downloads/BS_Game_v1.1/city_v1.3_GPU/.
