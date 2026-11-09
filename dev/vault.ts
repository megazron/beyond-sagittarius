// Dev-only stage for the rendered MegaZroN intro in the Vault. Never shipped: tools/film/dump.py --stage films it for Blender.
// The room, the host and the camera moves are the game's own (src/narrator/vault.ts); this page only holds the clock
// and plays each shot of tools/film/vault_timing.json, so the film and the real-time scene stay the same scene.
import * as THREE from 'three';
import { Vault, VaultShot } from '../src/narrator/vault';
import type { CrewPose } from '../src/characters/character';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true }); r.setSize(320, 180);
const v = new Vault(() => {}, 1.4);
v.prepare();
const P = v as unknown as { shot: VaultShot; shotT: number; shotLen: number; pose: CrewPose; time: number; playing: boolean };
v.camera.aspect = 16 / 9; v.camera.updateProjectionMatrix();
// the pose each shot plays, as vaultScript('intro') gives it
const POSE: Record<string, CrewPose> = { wide: 'stand', push: 'present', orrery: 'point', hands: 'write', close: 'idle' };

let TIMING: { shots: { id: string; t0: number; t1: number }[]; lines: { key: string; t0: number; t1: number }[] };
let tPrev = -1, dof = { focus: 3, ap: 0 };
const head = new THREE.Vector3();
const W = window as unknown as Record<string, unknown>;
W.__entry = {
  load(t: typeof TIMING) { TIMING = t; },
  frame(time: number) {
    const s = TIMING.shots.find((x) => time >= x.t0 && time < x.t1) ?? TIMING.shots[TIMING.shots.length - 1];
    P.playing = false; P.shot = s.id as VaultShot; P.pose = POSE[s.id] ?? 'idle';
    P.shotLen = s.t1 - s.t0; P.shotT = time - s.t0;
    const ln = TIMING.lines.find((l) => time >= l.t0 && time < l.t1); if (ln) v.host.say(ln.t1 - time);
    const dt = tPrev < 0 ? 1.2 : Math.max(.001, time - tPrev); // the first frame settles the pose, as the entry stage does
    P.time = time - dt; v.update(dt); tPrev = time;
    // focus on the host's head; a shallow field only in the close set-ups
    v.host.root.getObjectByName('head')?.getWorldPosition(head);
    const near = s.id === 'close' || s.id === 'hands';
    dof = { focus: s.id === 'orrery' ? v.camera.position.distanceTo(new THREE.Vector3(-3.2, 2.9, -1.6)) : v.camera.position.distanceTo(head), ap: near ? .012 : .004 };
    v.scene.updateMatrixWorld(true); if (r.domElement.width !== 320) r.setSize(320, 180); r.render(v.scene, v.camera);
  },
};
// QA: the current frame from any point (the clipping check's places are often out of the shot's own view)
W.__look = (p: number[], at: number[], fov = 30) => {
  const c = v.camera.clone(); c.position.set(p[0], p[1], p[2]); c.lookAt(at[0], at[1], at[2]); c.fov = fov; c.aspect = 1; c.updateProjectionMatrix();
  r.setSize(640, 640); r.render(v.scene, c); // the next frame() sets the film size back
};
W.__bs = { stageInfo: () => ({ scene: v.scene, camera: v.camera, focus: dof.focus, aperture: dof.ap }), film: { get beat() { return tPrev; } } };
v.host.whenReady.then(() => { W.ready = true; });
