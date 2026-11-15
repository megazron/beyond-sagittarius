// Dev-only turntable for the crew (not part of the build): vite, then /dev/chars.html
import * as THREE from 'three';
import { randomLook, OUTFITS } from '../src/characters/custom';
import { createCharacter, CrewId, Character, CrewPose } from '../src/characters/character';
import { voice } from '../src/core/voice';
import { DECREEP } from '../src/characters/decreep';
import { preloadCrew } from '../src/characters/assets';

const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron'];
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight);
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
r.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4d6a78);
const sun = new THREE.DirectionalLight(0xfff0d8, 3.6); sun.position.set(4, 7, 6); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight(0xbcd6e8, 0x394034, 1.3));
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshStandardMaterial({ color: 0x35402f, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// ?studio: a portrait setup that shows cloth and skin honestly (soft key, low fill, rim from behind)
if (new URLSearchParams(location.search).has('studio')) {
  scene.background = new THREE.Color(0x8f8c88);
  sun.color.set(0xfff4e6); sun.intensity = 2.6; sun.position.set(-3, 5, 6);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.0); fill.position.set(5, 2, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 2.2); rim.position.set(2, 4, -6);
  scene.add(fill, rim);
  (ground.material as THREE.MeshStandardMaterial).color.set(0x77736e);
}
const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
const alt = new URLSearchParams(location.search).get('skin') ?? undefined;
const customs = new URLSearchParams(location.search).get('custom');
// ?custom=all: every creator outfit in both builds (twelve townsfolk), each with a fixed random look, so the skin gate
// sees all of them on every run instead of two picked at random
// mulberry32: a repeatable Math.random for the skin gate
const seeded = (seed: number) => { let s = seed | 0; return () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
// ?gate: the same build gives the same numbers on every run. Clip start times, blinks, glances and sway phases are
// random, and the bodies attach in whatever order their files arrive; here every file is loaded first, so they attach
// in roster order on a seeded Math.random, and gateStart() gives each character its own seed and clock, so a body's
// pose in a close-up never depends on who was looked at before it (or on --only).
const GATE = new URLSearchParams(location.search).has('gate');
let solo = false;
const lookOf = (i: number) => {
  if (customs !== 'all') return randomLook({ name: 'x', gender: i % 2 ? 'f' : 'm' });
  const rnd = Math.random;
  Math.random = seeded(0x9e3779b9 ^ (i * 7919));
  const l = randomLook({ name: 'x', gender: i % 2 ? 'f' : 'm' }); Math.random = rnd;
  return { ...l, outfit: OUTFITS[i >> 1] };
};
const roster: CrewId[] = customs === 'all' ? OUTFITS.flatMap((o) => [o, o] as CrewId[]) : ids;
const detail = Number(new URLSearchParams(location.search).get('detail') ?? 1);
const chars: Character[] = (window as unknown as { chars: Character[] }).chars = [];
const make = () => roster.forEach((id, i) => { const c = customs ? createCharacter('scientist', detail, lookOf(i)) : createCharacter(id, detail, undefined, id === 'strong' ? alt : undefined); c.root.position.x = (i - 2.5) * 1.3; scene.add(c.root); chars.push(c); });
let pose: CrewPose = 'stand', amount = 0, t = 0, phase = 0;
const W = window as unknown as Record<string, unknown>;
W.view = (i: number, d: number, yaw: number, h: number, dist: number) => {
  const c = i < 0 ? new THREE.Vector3(0, 0, 0) : chars[i].root.position;
  cam.position.set(c.x + Math.sin(yaw) * dist, h, c.z + Math.cos(yaw) * dist);
  cam.lookAt(c.x, d, c.z);
  const el = W.eyeLight as THREE.PointLight | undefined; if (el) el.position.copy(cam.position).add(new THREE.Vector3(0.15, 0.25, 0));
};
W.viewAt = (x: number, y: number, z: number, yaw: number, up: number, dist: number) => { cam.position.set(x + Math.sin(yaw) * dist, y + up, z + Math.cos(yaw) * dist); cam.lookAt(x, y, z); };
W.pose = (p: CrewPose, a = 0) => { pose = p; amount = a; };
// review hooks for the de-creep pass: someone to look at, and a spoken line without audio (a syllable envelope)
W.gaze = (i: number, x: number, y: number, z: number) => chars[i].setLookTarget(new THREE.Vector3(x, y, z));
W.say = (i: number, sec: number) => chars[i].say(sec);
{ const v = voice as unknown as { mouth: (o: { open: number; round: number; wide: number }) => void };
  v.mouth = (o) => { const syl = Math.max(0, Math.sin(t * 13.5)) * (0.55 + 0.45 * Math.sin(t * 3.1 + 1)), gap = Math.sin(t * 1.7) > -0.75 ? 1 : 0;
    o.open = syl * gap; o.round = Math.max(0, Math.sin(t * 4.3)) * 0.5 * gap; o.wide = Math.max(0, Math.sin(t * 5.9 + 2)) * 0.5 * gap; }; }
// skin gate: every skin surface shaded flat grey from the front and flag magenta from behind; any magenta pixel on
// screen is the inside of a body seen through a hole (culled skin a camera can see). Clothes and hair render grey both
// sides (a coat's lining is meant to be seen); the background is black.
W.flagMode = () => {
  scene.background = new THREE.Color(0x000000); ground.visible = false; grid.visible = false;
  const flag = new THREE.ShaderMaterial({ side: THREE.DoubleSide, vertexShader: `#include <common>\n#include <skinning_pars_vertex>\n#include <morphtarget_pars_vertex>\nvarying vec3 vN;\nvoid main(){\n#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <skinning_vertex>\nvN = normalize(normalMatrix * objectNormal);\ngl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);}`,
    fragmentShader: `varying vec3 vN; void main(){ gl_FragColor = gl_FrontFacing ? vec4(vec3(0.35 + 0.4 * abs(vN.z)), 1.0) : vec4(1.0, 0.0, 1.0, 1.0); }` });
  const grey = new THREE.MeshBasicMaterial({ color: 0x777777, side: THREE.DoubleSide });
  scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || m === ground) return; m.material = m.name.startsWith('skin') ? flag : grey; });
};
// the camera inside a body or a garment (a sweep angle that lands in the hip as the hand swings past): the first
// surface on the way to the target is seen from behind, or sits so close the near plane cuts it open. Not a view anyone gets; the skin gate skips it.
const rc = new THREE.Raycaster(), rcN = new THREE.Vector3();
W.camInside = (x: number, y: number, z: number) => {
  const to = new THREE.Vector3(x, y, z), dir = to.clone().sub(cam.position); const far = dir.length(); dir.normalize();
  rc.set(cam.position, dir); rc.near = 0; rc.far = far - 0.02;
  const ms: THREE.Object3D[] = [];
  scene.traverseVisible((o) => { const m = o as THREE.SkinnedMesh; if (m.isMesh && m !== ground) { if (m.isSkinnedMesh) { m.computeBoundingSphere(); m.computeBoundingBox(); } ms.push(m); } });
  const hits = rc.intersectObjects(ms, false).filter((h) => h.face);
  const hit = hits[0];
  if (!hit) return false;
  if (hit.distance < cam.near * 1.6) return true; // a surface at the lens is cut open by the near plane: the same thing
  rcN.copy(hit.face!.normal).transformDirection(hit.object.matrixWorld);
  return rcN.dot(dir) > 0;
};
// skin gate probe: what is under some screen pixels (first surface along the ray, front or back): mesh, triangle, bones
W.probeHits = (pts: [number, number][]) => {
  const out: unknown[] = []; const ms: THREE.Object3D[] = [];
  scene.traverseVisible((o) => { const m = o as THREE.SkinnedMesh; if (m.isMesh && m !== ground) { if (m.isSkinnedMesh) { m.computeBoundingSphere(); } ms.push(m); } });
  for (const [x, y] of pts) {
    rc.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam); rc.near = 0; rc.far = 100;
    const h = rc.intersectObjects(ms, false)[0]; if (!h || !h.face) { out.push(null); continue; }
    const m = h.object as THREE.SkinnedMesh, g = m.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const bones = [h.face.a, h.face.b, h.face.c].map((v) => { const r: string[] = []; if (si) for (let j = 0; j < 4; j++) { const w = sw.getComponent(v, j); if (w > 0.05) r.push(`${m.skeleton.bones[si.getComponent(v, j)].name}:${w.toFixed(2)}`); } return r.join(' '); });
    const fn = h.face.normal.clone().transformDirection(m.matrixWorld);
    out.push({ mesh: m.name, face: [h.face.a, h.face.b, h.face.c], back: fn.dot(rc.ray.direction) > 0, d: +h.distance.toFixed(3), bones });
  }
  return out;
};
W.flagCount = () => { const g = r.getContext(); const w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) n++; return n; };
// the eye light: a small soft source by the lens, so eyes are never dead sockets (de-creep only)
if (DECREEP) { const eyeLight = new THREE.PointLight(0xfff2e0, 0.55, 6, 1.5); scene.add(eyeLight); W.eyeLight = eyeLight; }

W.renderNow = () => r.render(scene, cam);
W.step = (n: number, dt = 1 / 30) => { for (let k = 0; k < n; k++) { t += dt; phase += dt * 7 * amount; chars.forEach((c) => { if (solo && !c.root.visible) return; c.root.updateMatrixWorld(); c.animate(pose, phase, amount, t, dt); }); } r.render(scene, cam); };
/** Skin gate: show only character i, on its own seed and clock; from now on only visible characters animate. */
W.gateStart = (i: number) => { chars.forEach((c, j) => { c.root.visible = j === i; }); Math.random = seeded(0x2545f491 + i * 977); t = 0; phase = 0; solo = true; };
/** Foot slide probe: walk a character at v m/s over flat ground, report world drift of planted feet. */
W.slide = (i: number, v: number, n = 240, dt = 1 / 60) => {
  const c = chars[i]; const res: number[] = [];
  c.setGround(() => 0);
  const b = (name: string) => c.fig.getObjectByName(name)!;
  const last: Record<string, THREE.Vector3> = {};
  const p = new THREE.Vector3(), lows: number[] = [];
  for (let k = 0; k < n; k++) {
    c.root.position.z += v * dt; t += dt;
    c.root.updateMatrixWorld(true);
    c.animate('walk', 0, v / 4, t, dt);
    c.root.updateMatrixWorld(true);
    for (const s of ['footL', 'footR']) {
      b(s).getWorldPosition(p);
      if (last[s] && k > 60 && p.y < 0.13) res.push(Math.hypot(p.x - last[s].x, p.z - last[s].z) / dt);
      if (k > 60) lows.push(p.y);
      (last[s] ??= new THREE.Vector3()).copy(p);
    }
  }
  res.sort((a, b2) => a - b2);
  c.root.position.z = 0;
  return { medianStanceSlide: res[res.length >> 1], p90: res[Math.floor(res.length * 0.9)], minFootY: Math.min(...lows) };
};
/** Deterministic driven take for video: speed and turn profile over time, camera following. */
const grid = new THREE.GridHelper(200, 200, 0xc8d0c0, 0x7f8a7a); grid.position.y = 0.004; grid.visible = !new URLSearchParams(location.search).has('studio'); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5; scene.add(grid);
let driveT = 0, yawNow = 0;
const profile = (s: number): [number, number] => {
  // seconds -> [m/s, rad/s]
  const seg = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const v = 1.4 * seg(1, 1.6, s) + 1.6 * seg(4, 4.6, s) + 3.2 * seg(7, 7.6, s) - 6.2 * seg(9.5, 10.3, s);
  const w = (s > 5 && s < 6 ? 0.9 : 0) + (s > 11 && s < 12.4 ? 1.8 : 0) + (s > 13.2 && s < 14.2 ? -2.4 : 0);
  return [Math.max(0, v), w];
};
W.drive = (i: number, dt = 1 / 30, sideView = false) => {
  const c = chars[i];
  chars.forEach((o, j) => { o.root.visible = j === i; });
  c.setGround(() => 0);
  for (let k = 0; k < 2; k++) {
    const h = dt / 2; driveT += h; t += h;
    const [v, w] = profile(driveT);
    yawNow += w * h;
    c.root.rotation.y = yawNow;
    c.root.position.x += Math.sin(yawNow) * v * h; c.root.position.z += Math.cos(yawNow) * v * h;
    c.root.updateMatrixWorld(true);
    c.animate('idle', 0, v / 4, t, h);
  }
  const p = c.root.position;
  if (sideView) { cam.position.set(p.x + 3.8, 1.0, p.z); cam.lookAt(p.x, 0.92, p.z); }
  else { cam.position.set(p.x - Math.sin(yawNow - 0.5) * 3.6, 1.55, p.z - Math.cos(yawNow - 0.5) * 3.6); cam.lookAt(p.x, 0.95, p.z); }
  r.render(scene, cam);
  return driveT;
};
/** Shake probe: head travel per frame while standing, and worst frame-to-frame jerk (mm). */
W.calm = (i: number, kind: CrewPose = 'stand', n = 240, dt = 1 / 60) => {
  const c = chars[i]; const h = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let v = 0, jerk = 0, peak = 0;
  for (let k = 0; k < n; k++) {
    t += dt; c.root.updateMatrixWorld(true); c.animate(kind, 0, 0, t, dt); c.root.updateMatrixWorld(true);
    c.head.getWorldPosition(h);
    if (k > 90) { const d = h.distanceTo(a); v += d; peak = Math.max(peak, d); jerk = Math.max(jerk, h.clone().sub(a).sub(a.clone().sub(b)).length()); }
    b.copy(a); a.copy(h);
  }
  return { meanMmPerFrame: v / (n - 91) * 1000, peakMm: peak * 1000, jerkMm: jerk * 1000 };
};
W.trace = (i: number, n = 200, dt = 1 / 60) => {
  const c = chars[i]; const a = new THREE.Vector3(), h = new THREE.Vector3(), out: unknown[] = [];
  const hips = c.fig.getObjectByName('hips')!, hp = new THREE.Vector3(), lp = new THREE.Vector3();
  const last = new Map<string, THREE.Quaternion>();
  for (let k = 0; k < n; k++) {
    t += dt; c.root.updateMatrixWorld(true); c.animate('stand', 0, 0, t, dt); c.root.updateMatrixWorld(true);
    c.head.getWorldPosition(h); hips.getWorldPosition(hp);
    const d = h.distanceTo(a) * 1000, e = hp.distanceTo(lp) * 1000;
    if (k > 0 && d > 3) { const bad: string[] = []; c.fig.traverse((o) => { if (!(o as THREE.Bone).isBone) return; const l = last.get(o.name); if (l) { const a2 = l.angleTo(o.quaternion) * 57.3; if (a2 > 0.5) bad.push(o.name + ':' + a2.toFixed(1)); } }); out.push([k, +d.toFixed(1), +e.toFixed(1), bad.join(' ')]); }
    c.fig.traverse((o) => { if ((o as THREE.Bone).isBone) last.set(o.name, o.quaternion.clone()); });
    a.copy(h); lp.copy(hp);
  }
  return out;
};
/** Walk one character past the camera, a frame every few steps. */
W.film = (i: number, v: number, k: number) => {
  const c = chars[i];
  chars.forEach((o, j) => { o.root.visible = j === i; });
  c.setGround(() => 0);
  for (let n = 0; n < k; n++) { c.root.position.z += v / 60; t += 1 / 60; c.root.updateMatrixWorld(true); c.animate('walk', 0, v / 4, t, 1 / 60); }
  const p = c.root.position;
  cam.position.set(p.x + 3.6, 1.1, p.z + 0.2); cam.lookAt(p.x, 0.95, p.z);
  r.render(scene, cam);
};
(W.view as Function)(-1, 1, 0, 1.3, 11);
const keys = customs === 'all' ? roster.map((o, i) => `custom_${i % 2 ? 'f' : 'm'}_${o}`) : roster.map((id) => (id === 'strong' && alt ? 'strong_suit' : id));
(GATE ? (Math.random = seeded(0x51a7e), preloadCrew(keys, detail)) : Promise.resolve()).then(() => { make(); return Promise.all(chars.map((c) => c.whenReady)); })
  .then(() => { (W.step as Function)(4); setTimeout(() => { (W.step as Function)(2); W.ready = true; }, 3000); });
