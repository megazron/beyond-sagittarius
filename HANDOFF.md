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
