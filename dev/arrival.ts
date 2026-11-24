// Dev-only: one arrival on its stage, seekable, without the game around it (not part of the build).
// vite, then /dev/arrival.html?id=explorer ; window.seek(t) poses everything at time t (steps from 0).
import * as THREE from 'three';
import { createCharacter, CHAR_BUDGET, preloadCrew, type CrewId } from '../src/characters/character';
import { buildStage, STAGES } from '../src/game/away/kit';
import { Arrival } from '../src/game/arrival';
import { ARRIVAL_STAGE } from '../src/game/arrivals';
import { HURT } from '../src/core/hurtfx';
CHAR_BUDGET.throttle = false; CHAR_BUDGET.lodFar = Infinity;
const q = new URLSearchParams(location.search);
const id = (q.get('id') ?? 'explorer') as CrewId;
const loc = ARRIVAL_STAGE[id] ?? 'ring';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight); r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true;
const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 6000);
const st = buildStage(loc, STAGES[loc], (k) => k, 0, 1);
const W = window as unknown as Record<string, unknown>;
void (async () => {
  await preloadCrew([id]);
  const body = createCharacter(id, 1);
  st.scene.add(body.root); body.setGround((x, z) => st.height(x, z));
  await body.whenReady;
  let a = new Arrival(id, { scene: st.scene, camera: cam, body, ground: (x, z) => st.height(x, z), say: () => undefined }, () => undefined);
  W.dur = a.def.dur;
  W.seek = (t: number) => {
    if (t < a.t) { a.skip(); a = new Arrival(id, { scene: st.scene, camera: cam, body, ground: (x, z) => st.height(x, z), say: () => undefined }, () => undefined); }
    while (a.t + 1 / 30 <= t && a.active) a.update(1 / 30);
    st.update(1 / 30, t, cam);
    r.render(st.scene, cam);
    return { t: a.t, hurt: { ...HURT.film } };
  };
  W.ready = true;
})();
