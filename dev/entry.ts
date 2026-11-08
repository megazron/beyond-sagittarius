// Dev-only stage for the rendered black hole entry. Never shipped: tools/film/dump.py --stage films it for Blender.
import * as THREE from 'three';
import { createShip, createInterior } from '../src/cinematic/ship';
import { flail, mixLimbs, FALL, STANDING, nz } from '../src/cinematic/montage';
import type { Character, CrewPose, Limbs, Face } from '../src/characters/character';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true }); r.setSize(320, 180);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 4000);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ship = createShip(); scene.add(ship.group);
const deck = createInterior(1); scene.add(deck.group);
// ---- set dressing: a ship's deck has structure, services and light sources of its own ----
const pbr = (m: THREE.Material, set: string, repeat: number, tint = 0xffffff) => { m.userData.film = { kind: 'pbr', set, repeat, tint }; };
deck.group.traverse((o) => {
  const m = o as THREE.Mesh; if (!m.isMesh) return;
  const g = m.geometry.type;
  if (g === 'CylinderGeometry' && (m.geometry as THREE.CylinderGeometry).parameters.radiusTop > 3) pbr(m.material as THREE.Material, 'hull', 7, 0x9aa2ac);
  else if (g === 'PlaneGeometry' && m.position.y < -2) pbr(m.material as THREE.Material, 'hull', 9, 0x4a5058);
});
const dress = new THREE.Group(); deck.group.add(dress);
{ const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: .8, roughness: .35 }), mid = new THREE.MeshStandardMaterial({ color: 0x5a616b, metalness: .7, roughness: .4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xdfeeff, emissiveIntensity: 3 }), warm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc890, emissiveIntensity: 2.4 });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); dress.add(o); return o; };
  // back wall: panels, vents and a service duct, following the curve of the shell
  for (let x = -5.5; x <= 5.5; x += 1.1) {
    for (const [a, h] of [[2.25, .7], [1.75, .9], [1.25, .6]] as [number, number][]) { const y = Math.sin(a) * 3.82, z = Math.cos(a) * 3.82; add(new THREE.BoxGeometry(.98, h, .06), x % 2.2 === 0 ? dark : mid, x, y - .2, z, -(Math.PI / 2 - a), 0, 0); }
    add(new THREE.BoxGeometry(.5, .08, .2), dark, x + .3, -1.55, 3.05);
  }
  for (const [y, z, r] of [[1.85, 2.85, .09], [1.65, 3.05, .06], [2.4, 1.6, .07]] as [number, number, number][]) add(new THREE.CylinderGeometry(r, r, 12, 10), dark, 0, y, z, 0, 0, Math.PI / 2);
  // ceiling light strips, and the lamps they really are
  for (const z of [-1.4, .4, 2.0]) { add(new THREE.BoxGeometry(10.5, .04, .14), glow, 0, Math.sqrt(Math.max(0, 15.2 - z * z)) - .12, z); }
  for (const x of [-4, 0, 4]) { const l = new THREE.PointLight(0xe8f0ff, 3.2, 9, 1.6); l.position.set(x, 2.9, .4); dress.add(l); }
  // the window rail, with posts, at hip height
  add(new THREE.CylinderGeometry(.035, .035, 11, 10), mid, 0, -1.25, -3.1, 0, 0, Math.PI / 2);
  for (let x = -5; x <= 5; x += 1.25) add(new THREE.CylinderGeometry(.025, .025, .95, 8), mid, x, -1.72, -3.1);
  // floor: grating seams and a warm glow from under the console
  for (let x = -5.5; x <= 5.5; x += 1) add(new THREE.BoxGeometry(.02, .01, 5.6), dark, x, -2.195, 0);
  add(new THREE.BoxGeometry(2.3, .03, .05), warm, 0, -2.17, -.92);
}
const ids = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'] as const;
const C = Object.fromEntries(ids.map((id, i) => [id, deck.crew[i]])) as Record<(typeof ids)[number], Character>;
const MARK: Record<string, [number, number]> = { social: [-1.5, 1.4], strong: [-0.25, 2.0], medic: [1.15, 1.75], explorer: [1.95, 0.75], builder: [-2.5, 0.5], scientist: [0.3, -0.45] };
const seen = new Map<Character, CrewPose>();
const headOf = (c: Character) => c.head.getWorldPosition(new THREE.Vector3());

// window cracks: branches that grow from one point
const crack = new THREE.Group(); crack.position.set(0, 0, -3.72); deck.group.add(crack); const cracks: THREE.Mesh[] = [];
{ const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfeaff, emissiveIntensity: 2 }); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grow = (x: number, y: number, a: number, n: number, gen: number) => { for (let i = 0; i < n; i++) { const l = 0.08 + rnd() * 0.22, nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
      const b = new THREE.Mesh(new THREE.BoxGeometry(l, 0.008 + 0.012 / (gen + 1), 0.01), m); b.position.set((x + nx) / 2, (y + ny) / 2, 0); b.rotation.z = a; b.userData.at = Math.hypot(nx - 0.3, ny + 0.2); crack.add(b); cracks.push(b);
      x = nx; y = ny; a += (rnd() - 0.5) * 0.9; if (gen < 2 && rnd() < 0.32) grow(x, y, a + (rnd() < .5 ? 1 : -1) * (0.5 + rnd() * .7), Math.floor(n * .6), gen + 1); } };
  for (let i = 0; i < 9; i++) grow(0.3, -0.2, i / 9 * 6.283 + rnd() * .4, 11, 0); }
// glass and hull that go with it
// the bulkhead Bolzar holds, and the rib that gives under his hand
const bulk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4, .22), new THREE.MeshStandardMaterial({ color: 0x6d747e, metalness: .65, roughness: .42 })); bulk.position.set(-1.6, -.3, 3.3); bulk.visible = false; scene.add(bulk);
const rib = new THREE.Mesh(new THREE.BoxGeometry(.2, 3.8, .16, 1, 24, 1), new THREE.MeshStandardMaterial({ color: 0x8a919b, metalness: .75, roughness: .35 })); rib.position.set(-1.05, -.3, 3.14); rib.visible = false; scene.add(rib);
const rib0 = (rib.geometry.attributes.position.array as Float32Array).slice();
const buckle = (k: number) => { const p = rib.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const y = rib0[i * 3 + 1]; p.setZ(i, rib0[i * 3 + 2] - k * .34 * Math.exp(-((y - .25) ** 2) * 2.2)); p.setX(i, rib0[i * 3] + k * .05 * Math.sin(y * 9)); } p.needsUpdate = true; (p as THREE.BufferAttribute).setUsage(35048); rib.geometry.computeVertexNormals(); };
const shards: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; p: THREE.Vector3 }[] = [];
{ const m = new THREE.MeshStandardMaterial({ color: 0xbcd4e8, metalness: .1, roughness: .08, transparent: true, opacity: .55 }); let s = 11; const q = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 150; i++) { const g = new THREE.TetrahedronGeometry(0.03 + q() * 0.13); const o = new THREE.Mesh(g, m); o.visible = false; deck.group.add(o);
    shards.push({ m: o, p: V((q() - .5) * 9, -2 + q() * 4, -3.6), v: V((q() - .5) * 3, (q() - .4) * 2.5, -3 - q() * 5), w: V(q() * 6, q() * 6, q() * 6) }); } }

function act(c: Character, p: THREE.Vector3, q: THREE.Quaternion | null, pose: CrewPose, limbs: Limbs | null, face: Face | null = null) {
  c.root.visible = true; c.root.position.copy(p); if (q) c.root.quaternion.copy(q); c.setLimbs(limbs); c.setFace(face); seen.set(c, pose);
}
const faceTo = (c: Character, t: THREE.Vector3) => Math.atan2(t.x - c.root.position.x, t.z - c.root.position.z);
const yawQ = (y: number, x = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
function lens(from: THREE.Vector3, to: THREE.Vector3, fov: number, focus: number, ap: number, roll = 0) {
  cam.position.copy(from); cam.up.set(0, 1, 0); cam.lookAt(to); if (roll) cam.rotateZ(roll); cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); dof = { focus, ap };
}
let dof = { focus: 0, ap: 0 };
// a key from the camera's side, a cool fill and a rim: faces read even with the disk behind them
const key = new THREE.PointLight(0xffe2c4, 0, 12, 1.6), fill = new THREE.PointLight(0xbcd2ff, 0, 12, 1.6), under = new THREE.PointLight(0xffa860, 0, 40, 1.2), top = new THREE.PointLight(0xc8d8ff, 0, 40, 1.2); scene.add(key, fill, under, top);
function faceLight(h: THREE.Vector3, k = 3, f = .9) {
  const to = cam.position.clone().sub(h).normalize(), right = new THREE.Vector3().crossVectors(to, V(0, 1, 0)).normalize();
  key.position.copy(h).addScaledVector(to, .9).addScaledVector(right, .75).add(V(0, .55, 0)); key.intensity = k;
  fill.position.copy(h).addScaledVector(to, .8).addScaledVector(right, -.9).add(V(0, -.1, 0)); fill.intensity = f;
}
const setHole = (x: number, y: number, z: number) => { (window as unknown as { __hole: number[] }).__hole = [x, y, z]; };
const standAll = (t: number, tense = 0) => ids.forEach((id, i) => { const m = MARK[id]; const c = C[id]; act(c, V(m[0], -2.2, m[1]), yawQ(Math.PI + (i - 2.5) * .08), 'stand', null, { fear: tense * .5 }); c.look2(nz(t * .4, i) * .2, 0); });
const hole = V(-2, 6, -20);

type Shot = (k: number, t: number, len: number) => void;
const SHOTS: Record<string, Shot> = {
  a1(k, t) { deck.group.visible = false; ship.group.visible = true; ship.group.position.set(0, 0, 0); ship.group.rotation.set(0, Math.PI * .9 + k * .05, 0); lens(V(-20 + k * 4, 5, 62 - k * 7), V(0, 0, 0), 38, 62, 0); setHole(16, -3, -60); void t; },
  a2(k, t) { standAll(t); const f = deck.floaters[0]; f.userData.b0 ??= f.position.clone(); f.position.set(.42, -1.2 + k * .55, -1.2); f.rotation.set(k * 1.3, k * .8, k * .5); const c = C.scientist; act(c, V(.3, -2.2, -.45), yawQ(Math.PI), 'stand', null, { fear: k * .3 }); c.look2(.25, .28 - k * .3);
    lens(V(1.5 - k * .2, -.9, -2.3 + k * .1), V(.42, -1 + k * .3, -1.1), 34, 1.6, .02); faceLight(headOf(c), 1.5, .6); },
  b1(k, t) { standAll(t, .3); const c = C.strong, s = C.scientist; const y = THREE.MathUtils.lerp(Math.PI, faceTo(c, s.root.position), THREE.MathUtils.smoothstep(k, 0, .35)); act(c, V(-.25, -2.2, 2), yawQ(y), 'stand', null, { frown: .55 }); c.setLookTarget(headOf(s));
    const h = headOf(c); lens(h.clone().add(V(.9 - k * .1, -.08, -1.25 + k * .15)), h.clone().add(V(0, -.1, 0)), 38, 1.5, .022); faceLight(h, 1.5, .6); },
  b2(k, t) { standAll(t, .4); const c = C.scientist; act(c, V(.3, -2.2, -.45), yawQ(.15), 'stand', null, { fear: .6 }); c.look2(k < .45 ? -.45 : .35 * Math.sin(k * 9), .2); const h = headOf(c); lens(h.clone().add(V(.22, -.04, .85 - k * .12)), h.clone().add(V(0, -.04, 0)), 42, .85, .03, .015); faceLight(h, 1.7, .7); },
  b3(k, t) { const a = THREE.MathUtils.smoothstep(k, .1, .5); deck.group.rotation.z = a * .05; ids.forEach((id, i) => { const c = C[id], m = MARK[id]; act(c, V(m[0] + a * .38 * (1 + (i % 2)) + nz(t * 3, i) * .05 * a, -2.2, m[1]), yawQ(Math.PI + (i - 2.5) * .08, 0, -a * .14), 'stand', mixLimbs(STANDING, flail({ ...FALL.spread, openHands: true }, t, i * 3, .3), a * .32), { fear: .3 + .5 * a, open: .3 * a }); });
    deck.floaters.forEach((f, i) => { const b = f.userData.b0 ??= f.position.clone(); f.position.x = b.x + a * a * (.9 + (i % 5) * .3); }); lens(V(-.6, -.3, 3.4 - k * .25), V(.1, -1, -1), 40, 3.5, .006, a * .05); faceLight(V(0, -.6, 1), 5, 2); },
  c1(k, t) { deck.group.visible = false; ship.group.visible = true; ship.group.scale.set(1 - k * .12, 1 - k * .12, 1 + k * k * .55); ship.group.rotation.set(.12, Math.PI * .9 + k * .18, k * .1); ship.ring.rotation.z = t * .4 * k; const a = 2.2 + k * .7; lens(V(Math.sin(a) * 22, 6 - k * 3, Math.cos(a) * 22), V(0, 0, 1 + k * 2), 30, 22, .002, nz(t * 3, 1) * .012 * (1 + k * 3)); setHole(-Math.sin(a) * 60 + 18, -8, -Math.cos(a) * 60); },
  c2(k, t) { deck.group.visible = true; deck.group.rotation.z = .05; standAll(t, .5); bulk.visible = rib.visible = true; buckle(0); const c = C.builder; act(c, V(-1.6, -2.2, 2.82), yawQ(.05), 'stand', { ...STANDING, armL: [.35, -.35, .9], foreL: [.1, .7, .7], armR: [-.35, -.3, .9], foreR: [-.1, .75, .65], openHands: true, bend: .2 + nz(t, 2) * .03 }, null); c.look2(-.55, .08 + nz(t * 1.3, 3) * .05); const h = headOf(c); lens(h.clone().add(V(-.85, -.03, .34)), h.clone().add(V(0, -.05, .04)), 40, .95, .028); faceLight(h, 1.8, .7); },
  c3(k, t) { bulk.visible = rib.visible = true; buckle(Math.min(1, Math.max(0, (k - .12) * 3.2)) ** 2); const c = C.builder; act(c, V(-1.6, -2.2, 2.82), yawQ(.05), 'stand', { ...STANDING, armL: [.35, -.35, .9], foreL: [.1, .7, .7], armR: [-.45, -.25, .8], foreR: [-.3, -.6, .6], openHands: true, bend: .12 }, { fear: .5 * k }); c.look2(-.55 + .3 * k, .1 + .25 * k); const h = headOf(c); lens(h.clone().add(V(-1.05, -.14, .3)), h.clone().add(V(.05, -.22, .2)), 34, 1.2, .02, nz(t * 4, 1) * .01); faceLight(h, 1.8, .7); },
  c4(k, t) { const c = C.social, m = MARK.social; const low = THREE.MathUtils.smoothstep(k, .45, .9); act(c, V(m[0], -2.2, m[1]), yawQ(Math.PI * .92), 'stand', { ...STANDING, armR: [-.3, .25 - low * 1.1, .95 - low * .5], foreR: [-.05, .75 - low * 1.5, .7], openHands: false }, { fear: .35 + .5 * low, smile: .3 * (1 - low) }); c.look2(0, -.05 + low * .3); const h = headOf(c); lens(h.clone().add(V(-.5, -.06, -.95 + k * .1)), h.clone().add(V(0, -.08, 0)), 40, 1.05, .028); faceLight(h, 1.6, .6); void t; },
  d1(k, t) { standAll(t, .85); cracks.forEach((b) => { b.visible = b.userData.at < k * 3.4; }); lens(V(-.3 + k * .3, -.5, 3.7), V(.3, -.3, -3.6), 44, 7, .002); },
  d2(k, t) { cracks.forEach((b) => (b.visible = false)); ids.forEach((id, i) => { const go = THREE.MathUtils.smoothstep(k, i * .03, .4 + i * .04), g2 = go * go, side = i % 2 ? 1 : -1, m = MARK[id]; const p = V(m[0] + side * g2 * 1 + nz(t * 2, i) * .25 * go, -2.2 + go * (1.2 + (i % 3) * .5), THREE.MathUtils.lerp(m[1], m[1] - 7, g2));
      act(C[id], p, new THREE.Quaternion().setFromEuler(new THREE.Euler(-g2 * (2 + (i % 3)) + nz(t * 2, i) * .3 * go, Math.PI + side * g2 * 2.2, side * g2 * 2)), 'float', mixLimbs(STANDING, flail({ ...FALL.spread, openHands: true }, t, i * 3.1, .85), THREE.MathUtils.smoothstep(go, 0, .3)), { fear: .9, open: .6 }); C[id].look2(nz(t * 2.4, i + 2) * .9, nz(t * 1.8, i + 4) * .35); });
    shards.forEach((s, i) => { s.m.visible = true; const u = k * 4; s.m.position.copy(s.p).addScaledVector(s.v, u * (1 + (i % 3) * .3)); s.m.rotation.set(s.w.x * u, s.w.y * u, s.w.z * u); }); lens(V(-.3, -.45, 4 - k), V(0, -.8, -3), 58, 4, .003, nz(t * 5, 2) * .03); },
  d3(k, t) { deck.group.visible = true; shards.forEach((s) => (s.m.visible = false)); for (const o of deck.group.children) if (!o.userData.crewKeep) o.visible = false; ids.forEach((id, i) => { const a = i / 6 * 6.283 + t * .08, R = 1 + k * k * 1.2 + 1.75; const rad = V(Math.cos(a), 0, Math.sin(a)); const up = rad.clone().negate(), fw = V(0, -1, 0), lf = up.clone().cross(fw); const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lf, up, fw)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(nz(t * 1.5, i) * .4, nz(t * 1.2, i + 2) * .35, nz(t * 1.7, i + 4) * .45)));
      act(C[id], rad.multiplyScalar(R + nz(t * 1.4, i + 6) * .14), q, 'float', flail({ armL: [1, .32, .02], armR: [-1, .32, .02], legL: [.22, -1, .05], shinL: [.15, -1, .3], legR: [-.2, -1, 0], shinR: [-.15, -1, .25], openHands: true }, t, i * 2.7, .22 + k * .35), { fear: .6, frown: .5 }); C[id].look2(nz(t * 1.6, i + 8) * .7, 0); }); lens(V(.3, 8.5 + k * 3.5, .4), V(0, 0, 0), 44, 10, 0, .3 + t * .02); setHole(1.2, -26, -1.2); under.position.set(0, -6, 0); under.intensity = 40; top.position.set(1, 7, 1); top.intensity = 16; },
  d4(k, t) { ids.forEach((id) => { if (id !== 'explorer' && id !== 'scientist') C[id].root.visible = false; }); ship.group.visible = false; deck.group.visible = true; for (const o of deck.group.children) if (!o.userData.crewKeep) o.visible = false; const gap = .02 + k * k * .16;
    const put = (c: Character, hand: THREE.Object3D, side: 'L' | 'R', want: number, tilt: number) => { const L = side === 'L'; const base = flail({ ...FALL.spread, openHands: true }, t, L ? 3 : 9, .3);
      const o = (c.root.userData.fit as THREE.Vector3 | undefined) ?? V(L ? -1 : 1, -1.5, 0);
      if (c.root.visible) { const w = hand.getWorldPosition(new THREE.Vector3()); o.set(o.x + want - w.x, o.y - w.y, o.z - w.z); } c.root.userData.fit = o;
      act(c, o, yawQ(0, 0, tilt + nz(t, L ? 6 : 8) * .05), 'float', L ? { ...base, armL: [1, .05 + nz(t * 2, 1) * .05, 0], foreL: [1, .02 + nz(t * 2.4, 2) * .07, 0] } : { ...base, armR: [-1, .05 + nz(t * 2, 7) * .05, 0], foreR: [-1, .02 + nz(t * 2.4, 8) * .07, 0] }, { fear: .9, open: .4 }); };
    put(C.explorer, C.explorer.handL, 'L', -gap, -.03); put(C.scientist, C.scientist.handR, 'R', gap, .03); lens(V(k * .1 - .05, .03, .95 - k * .1), V(0, 0, 0), 26, .9, .012, -.05); key.position.set(.2, .4, .9); key.intensity = 1.6; fill.position.set(-.5, -.3, .6); fill.intensity = .8; setHole(.5, .35, -30); },
  d5() { ids.forEach((id) => (C[id].root.visible = false)); ship.group.visible = false; deck.group.visible = false; lens(V(0, 0, 0), V(0, 0, -1), 40, 0, 0); },
};

let TIMING: { shots: { id: string; t0: number; t1: number }[] };
let cur = '', tPrev = 0;
const W = window as unknown as Record<string, unknown>;
W.__entry = {
  load(t: typeof TIMING) { TIMING = t; },
  frame(time: number) {
    const s = TIMING.shots.find((x) => time >= x.t0 && time < x.t1) ?? TIMING.shots[TIMING.shots.length - 1];
    if (s.id !== cur) { cur = s.id; deck.floaters.forEach((f) => { const b = f.userData.b0 as THREE.Vector3 | undefined; if (b) f.position.copy(b); f.rotation.set(0, 0, 0); }); deck.group.visible = true; ship.group.visible = false; for (const o of deck.group.children) o.visible = true; deck.group.rotation.z = 0; ship.group.scale.set(1, 1, 1); crack.visible = true; cracks.forEach((b) => (b.visible = false)); shards.forEach((x) => (x.m.visible = false)); key.intensity = fill.intensity = under.intensity = top.intensity = 0; bulk.visible = rib.visible = false; setHole(-2, 6, -20); ids.forEach((id) => { C[id].root.visible = true; C[id].setLookTarget(null); C[id].look2(0, 0); }); }
    const k = (time - s.t0) / (s.t1 - s.t0);
    for (let pass = 0; pass < 2; pass++) {
      seen.clear(); SHOTS[s.id](k, time, s.t1 - s.t0);
      for (const [c, p] of seen) { c.root.updateMatrixWorld(); c.animate(p, 0, 0, time, pass ? Math.max(.001, time - tPrev) : 1.2); }
    }
    tPrev = time; scene.updateMatrixWorld(true); r.render(scene, cam);
  },
};
W.__bs = { stageInfo: () => ({ scene, camera: cam, focus: dof.focus, aperture: dof.ap }), film: { get beat() { return tPrev; } } };
deck.floaters.forEach((f) => { f.userData.b0 = f.position.clone(); });
Promise.all(deck.crew.map((c) => c.whenReady)).then(() => { W.ready = true; });
