// The bodies of what the simulation thinks for. Verdaxis animals share a body plan: three pairs of eyes and a ridge of
// light along the back, the way everything with a backbone on Earth shares four limbs. Each body is a handful of
// merged meshes (few draw calls), posed from the creature's state: a pose for every state, so what it is about to do
// can be read from how it stands.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loft, limb, grainNormal } from '../../characters/shapes';
import { createHound } from '../../world/predator';
import type { Enemy, SpeciesId } from '../sim/species';
import { reach } from './ranged';

export interface CreatureView {
  root: THREE.Group;
  /** Pose from the simulation's state. `t` is the clock, `tele` 0 to 1 through a wind-up. */
  update(e: Enemy, t: number, dt: number, tele: number): void;
  /** A hit landed: a short flash and flinch. */
  flinch(dx: number, dz: number): void;
}

const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.6, 0.6), ...o });
const glow = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });

/** Geometry moved, turned and scaled, ready to merge. */
function place(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s));
  const c = g.index ? g.toNonIndexed() : g.clone();
  c.applyMatrix4(m);
  for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
  return c;
}
function part(parent: THREE.Object3D, geos: THREE.BufferGeometry[], m: THREE.Material, shadow = true) {
  const mesh = new THREE.Mesh(mergeGeometries(geos), m);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Everything a body fades with when it has fallen. */
function fader(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) mats.add(m); });
  let last = 1;
  return (k: number) => {
    if (k === last) return; last = k;
    for (const m of mats) { m.transparent = k < 1; m.opacity = k; m.depthWrite = k > 0.5; }
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.shadow ??= o.castShadow; o.castShadow = k > 0.6 && o.userData.shadow; } });
  };
}

/** Shared fall, fade and flinch for bodies that lie down when they are done. */
function common(root: THREE.Group, tilt: THREE.Object3D) {
  const fade = fader(root);
  let fl = 0, fx = 0, fz = 0;
  return {
    flinch(dx: number, dz: number) { fl = 1; fx = dx; fz = dz; },
    /** Returns true when the body is down and only fading. */
    base(e: Enemy, dt: number): boolean {
      root.position.set(e.x, e.y, e.z);
      root.rotation.y = e.yaw;
      fl = Math.max(0, fl - dt * 5);
      // a flinch away from the blow, in the body's own frame
      const c = Math.cos(-e.yaw), s = Math.sin(-e.yaw), lx = fx * c + fz * s, lz = -fx * s + fz * c;
      tilt.rotation.z = -lx * fl * 0.35; tilt.rotation.x = lz * fl * 0.25;
      if (e.dead) {
        // it falls on its side and is still; then it is gone, without anything to look away from
        const k = Math.min(1, e.deadT / 0.7), ease = 1 - (1 - k) * (1 - k);
        tilt.rotation.z = ease * 1.45;
        tilt.position.y = -ease * e.def.height * 0.28;
        fade(1 - THREE.MathUtils.smoothstep(e.deadT, 3.5, 6.5));
        return true;
      }
      tilt.position.y = 0;
      fade(1);
      return false;
    },
  };
}

interface QuadSpec {
  len: number; girth: number; legLen: number; legR: number; headLen: number; neck: number; tail: number; ears: number;
  hide: number; belly: number; ridge: [number, number, number]; eye: [number, number, number]; plates?: number; moss?: number; gait: number;
}

/** A four-legged body: Skritch, Nibbet and Mossback are the same plan at different sizes. */
function quadruped(q: QuadSpec): CreatureView {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  const hip = q.legLen * 0.96;
  body.position.y = hip;
  const hide = mat(q.hide), belly = mat(q.belly), ridgeM = glow(...q.ridge), eyeM = glow(...q.eye);
  const L = q.len, G = q.girth;
  const torso = loft([
    { y: L * 0.5, rx: G * 0.55, rz: G * 0.6 }, { y: L * 0.32, rx: G * 0.95, rz: G * 1.05 }, { y: 0, rx: G, rz: G * 1.1, z: -G * 0.05 },
    { y: -L * 0.3, rx: G * 0.9, rz: G * 0.95 }, { y: -L * 0.5, rx: G * 0.5, rz: G * 0.55 },
  ], 12);
  const geos = [place(torso, 0, 0, 0, Math.PI / 2)];
  if (q.plates) for (let i = 0; i < 4; i++) geos.push(place(new THREE.SphereGeometry(G * (0.95 - i * 0.08), 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, G * 0.35, L * (0.3 - i * 0.22), 0, 0, 0, [1.05, 0.7, 0.62]));
  part(body, geos, hide);
  const ridge: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) { const k = i / 6, h = G * (0.18 + Math.sin(k * Math.PI) * 0.25); ridge.push(place(new THREE.ConeGeometry(G * 0.07, h, 4), 0, G * 1.05 + h * 0.3, L * (0.38 - k * 0.76), -0.4)); }
  part(body, ridge, ridgeM, false);
  if (q.moss) {
    const moss: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) { const a = i * 2.4, k = (i % 5) / 4; moss.push(place(new THREE.SphereGeometry(G * (0.22 + (i % 3) * 0.07), 6, 4), Math.sin(a) * G * 0.55, G * (0.85 + Math.cos(a) * 0.1), L * (0.3 - k * 0.6), 0, 0, 0, [1, 0.45, 1])); }
    part(body, moss, mat(q.moss, { roughness: 1 }));
  }
  // head: skull, jaw, ears, six eyes
  const head = new THREE.Group();
  head.position.set(0, G * 0.25 + q.neck * 0.5, L * 0.5 + q.neck * 0.4);
  body.add(head);
  const H = q.headLen;
  const skull = loft([{ y: -H * 0.35, rx: H * 0.34, rz: H * 0.36 }, { y: 0, rx: H * 0.4, rz: H * 0.38 }, { y: H * 0.45, rx: H * 0.26, rz: H * 0.22, z: -H * 0.05 }, { y: H * 0.8, rx: H * 0.12, rz: H * 0.1, z: -H * 0.08 }], 10);
  const hg = [place(skull, 0, 0, 0, Math.PI / 2), place(limb(q.neck + H * 0.5, G * 0.5, H * 0.3, 0.05, 1, 8), 0, 0, -H * 0.2, -1.2)];
  if (q.plates) hg.push(place(new THREE.SphereGeometry(H * 0.62, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, H * 0.12, -H * 0.05, -0.5, 0, 0, [1.25, 0.8, 0.9]), place(new THREE.ConeGeometry(H * 0.13, H * 0.5, 5), 0, H * 0.25, H * 0.62, 0.9));
  for (const sx of [-1, 1]) if (q.ears) hg.push(place(new THREE.ConeGeometry(H * 0.16, H * q.ears, 4), sx * H * 0.3, H * 0.42, -H * 0.2, -0.35, 0, -sx * 0.5, [1, 1, 0.35]));
  part(head, hg, hide);
  const eyes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) eyes.push(place(new THREE.SphereGeometry(H * (0.075 - i * 0.015), 6, 4), sx * H * (0.3 + i * 0.03), H * (0.12 - i * 0.03), H * (0.32 - i * 0.16)));
  part(head, eyes, eyeM, false);
  // eyeshine: at night the eyes catch the firelight and are what you see of it first, a few pixels whatever the
  // distance (the eyes themselves are far smaller than a pixel past a few metres)
  const shine = new THREE.Sprite(new THREE.SpriteMaterial({ map: shineTex(), color: new THREE.Color(...q.eye), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: false }));
  shine.scale.set(0.026, 0.013, 1); shine.position.set(0, H * 0.1, H * 0.34); shine.renderOrder = 5; shine.visible = false;
  head.add(shine);
  const jaw = new THREE.Group(); jaw.position.set(0, -H * 0.16, H * 0.05); head.add(jaw);
  part(jaw, [place(loft([{ y: 0, rx: H * 0.26, rz: H * 0.1 }, { y: H * 0.7, rx: H * 0.1, rz: H * 0.06 }], 8), 0, 0, 0, Math.PI / 2)], belly);
  // tail
  const tail = new THREE.Group(); tail.position.set(0, G * 0.2, -L * 0.5); body.add(tail);
  if (q.tail > 0) part(tail, [place(limb(q.tail, G * 0.32, G * 0.06, 0.02, 1, 8), 0, 0, 0, 1.75)], hide);
  // legs: upper and lower as one piece per leg
  const legs: { g: THREE.Group; ph: number }[] = [];
  for (const [x, z, ph] of [[-1, 1, 0], [1, 1, 0.5], [-1, -1, 0.5], [1, -1, 0]] as const) {
    const g = new THREE.Group(); g.position.set(x * G * 0.72, -G * 0.2, z * L * 0.34); body.add(g);
    part(g, [place(limb(q.legLen * 0.55, q.legR * 1.5, q.legR, 0.2, 1, 8)), place(limb(q.legLen * 0.5, q.legR, q.legR * 0.75, 0.05, 1, 8), 0, -q.legLen * 0.5, 0.02, 0.12), place(new THREE.SphereGeometry(q.legR * 1.2, 6, 4), 0, -q.legLen * 0.97, q.legR * 0.4, 0, 0, 0, [1, 0.5, 1.4])], hide);
    legs.push({ g, ph });
  }
  const C = common(root, tilt);
  let gait = 0, crouch = 0, headUp = 0, open = 0, lie = 0, held = 0;
  const ease = (cur: number, to: number, dt: number, r: number) => cur + (to - cur) * (1 - Math.exp(-dt * r));
  return {
    root, flinch: C.flinch,
    update(e, t, dt, tele) {
      if (C.base(e, dt)) { for (const l of legs) l.g.rotation.x = ease(l.g.rotation.x, 0.5, dt, 6); return; }
      const s = e.state, sp = e.speed;
      gait += dt * (0.8 + sp * q.gait);
      const amt = Math.min(1, sp / 2.5), run = Math.min(1, sp / 7);
      const asleep = s === 'asleep', wind = s === 'windup', strike = s === 'strike';
      crouch = ease(crouch, wind ? 0.5 + tele * 0.5 : s === 'stagger' || e.stunT > 0 ? 0.7 : s === 'feed' && sp < 0.3 ? 0.35 : s === 'warn' ? 0.2 : 0, dt, 9);
      lie = ease(lie, asleep ? 1 : 0, dt, 3);
      headUp = ease(headUp, s === 'investigate' || s === 'call' || s === 'warn' ? 1 : s === 'idle' && sp < 0.2 && !e.aware ? -0.8 : wind || strike ? -0.35 : 0, dt, 5);
      open = ease(open, s === 'call' || strike || s === 'warn' ? 1 : wind ? 0.4 : 0, dt, 12);
      // caught in a snare: one hind leg is pulled out behind it by the cord and the rest of it fights the pull,
      // front legs scrabbling, body twisting and jerking, mouth open
      held = ease(held, e.heldT > 0 && !asleep ? 1 : 0, dt, 14);
      for (const l of legs) {
        const p = (gait + l.ph) * Math.PI * 2;
        // pawing the ground: the telegraph of a charge is one front leg scraping
        const paw = wind && q.plates && l === legs[0] ? Math.sin(t * 14) * 0.6 : 0;
        const fight = l === legs[3] ? 1.25 + Math.sin(t * 23) * 0.12 : l === legs[0] || l === legs[1] ? Math.sin(t * 17 + l.ph * 3) * 0.8 - 0.3 : Math.sin(t * 13) * 0.3;
        l.g.rotation.x = (Math.sin(p) * (0.5 + run * 0.4) * amt + paw + lie * (l.ph ? 1.1 : -1.1) * 0.6 + (strike ? (l === legs[0] || l === legs[1] ? -0.9 : 0.8) : 0)) * (1 - held) + fight * held;
      }
      body.position.y = hip * (1 - crouch * 0.32 - lie * 0.55) + Math.abs(Math.sin(gait * Math.PI * 2)) * hip * 0.07 * amt;
      body.rotation.x = wind ? 0.12 + tele * 0.1 : strike ? -0.18 : s === 'flee' ? -0.06 : 0;
      body.rotation.z = (e.stunT > 0 || s === 'stagger' ? Math.sin(t * 9) * 0.07 : 0) + lie * 0.5 + held * Math.sin(t * 11) * 0.22;
      body.rotation.x += held * (-0.22 + Math.sin(t * 15) * 0.08);
      body.rotation.y = held * (Math.sin(t * 6.5) * 0.45 + Math.sin(t * 21) * 0.08);
      head.rotation.x = -headUp * 0.55 + (s === 'stagger' ? Math.sin(t * 16) * 0.2 : 0) + (wind && q.plates ? 0.5 : 0) + Math.sin(t * 1.1 + e.id) * 0.04;
      head.rotation.y = s === 'investigate' ? Math.sin(t * 1.6) * 0.5 : s === 'warn' ? Math.sin(t * 7) * 0.25 : 0;
      head.rotation.x += held * Math.sin(t * 19) * 0.3; head.rotation.y += held * Math.sin(t * 9) * 0.5;
      jaw.rotation.x = Math.max(open, held * (0.6 + Math.sin(t * 25) * 0.4)) * 0.6;
      tail.rotation.y = Math.sin(t * (2 + run * 6) + e.id) * (0.3 + run * 0.2);
      tail.rotation.x = s === 'warn' || wind ? -0.9 : s === 'flee' ? 0.5 : 0;
      // the ridge and the eyes say how it feels: dim asleep, bright when it means it
      const hot = wind ? 1 + tele * 2.5 : strike ? 3 : s === 'call' || s === 'warn' ? 2 : asleep ? 0.15 : e.aware ? 1 : 0.6;
      ridgeM.color.setRGB(q.ridge[0] * hot, q.ridge[1] * hot, q.ridge[2] * hot);
      eyeM.color.setRGB(q.eye[0] * (0.4 + hot * 0.6), q.eye[1] * (0.4 + hot * 0.6), q.eye[2] * (0.4 + hot * 0.6));
      shine.visible = NIGHT.on && !e.dead && !asleep;
      if (shine.visible) shine.material.opacity = Math.min(1, 0.45 + hot * 0.3);
    },
  };
}

/** Whether it is dark enough for eyeshine (the controller sets it from the fight). */
export const NIGHT = { on: false };
let shineT: THREE.Texture | null = null;
/** Two soft dots side by side: a pair of eyes at a distance. */
function shineTex() {
  if (shineT) return shineT;
  const c = document.createElement('canvas'); c.width = 32; c.height = 16;
  const g = c.getContext('2d')!;
  for (const x of [8, 24]) { const r = g.createRadialGradient(x, 8, 0, x, 8, 7); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(x - 8, 0, 16, 16); }
  shineT = new THREE.CanvasTexture(c);
  return shineT;
}

function hound(): CreatureView {
  const h = createHound();
  const root = new THREE.Group(), tilt = new THREE.Group();
  h.root.visible = true; root.add(tilt); tilt.add(h.root);
  const C = common(root, tilt);
  let snarl = 0, crouch = 0, lie = 0, held = 0;
  return {
    root, flinch: C.flinch,
    update(e, t, dt, tele) {
      if (C.base(e, dt)) return;
      const s = e.state, wind = s === 'windup', strike = s === 'strike';
      const k = (to: number, cur: number, r: number) => cur + (to - cur) * (1 - Math.exp(-dt * r));
      snarl = k(wind ? 0.5 + tele * 0.5 : strike ? 1 : s === 'stalk' ? 0.2 : s === 'stagger' ? 0.6 : 0, snarl, 8);
      crouch = k(wind ? 0.6 + tele * 0.4 : s === 'stalk' && e.speed < 1.5 ? 0.35 : e.stunT > 0 || s === 'stagger' ? 0.5 : 0, crouch, 8);
      lie = k(s === 'asleep' ? 1 : 0, lie, 2.5);
      h.animate(lie > 0.5 ? 0 : e.speed, snarl * (1 - lie), t, dt);
      // gathered low on its haunches before the leap, stretched flat in it; curled on its side asleep
      h.root.position.y = -crouch * 0.2 - lie * 0.42;
      h.root.rotation.x = strike ? -0.22 : wind ? 0.16 * tele : 0;
      h.root.rotation.z = lie * 1.1 + (s === 'stagger' ? Math.sin(t * 14) * 0.1 : 0);
      // a snare on a hind leg: it twists and throws itself against the cord
      held = k(e.heldT > 0 ? 1 : 0, held, 14);
      h.root.rotation.y = held * Math.sin(t * 6) * 0.4;
      h.root.rotation.z += held * Math.sin(t * 12) * 0.14;
      h.root.rotation.x += held * -0.15;
    },
  };
}

/** The Lashbloom: a bud that opens to strike, with a vine that whips out along the ground. */
function lashbloom(): CreatureView {
  const root = new THREE.Group(), tilt = new THREE.Group();
  root.add(tilt);
  const stem = mat(0x2c4a3a), petalM = mat(0x5a2f52, { side: THREE.DoubleSide, roughness: 0.55 }), heartM = glow(1.6, 2.4, 0.5), spotM = glow(0.9, 0.5, 1.6);
  part(tilt, [place(loft([{ y: 0, rx: 0.34, rz: 0.34 }, { y: 0.25, rx: 0.3, rz: 0.3 }, { y: 0.5, rx: 0.14, rz: 0.14 }], 10)),
    ...[0, 1, 2, 3, 4].map((i) => place(limb(0.5, 0.05, 0.02, 0, 1, 6), Math.cos(i * 1.26) * 0.3, 0.06, Math.sin(i * 1.26) * 0.3, Math.sin(i * 1.26) * 1.5, 0, -Math.cos(i * 1.26) * 1.5))], stem);
  const heart = part(tilt, [place(new THREE.SphereGeometry(0.17, 10, 8), 0, 0.6, 0)], heartM, false);
  const petals: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group(); g.position.set(0, 0.45, 0); g.rotation.y = i * 1.2566; tilt.add(g);
    const p = new THREE.Group(); g.add(p);
    part(p, [place(loft([{ y: 0, rx: 0.1, rz: 0.03 }, { y: 0.3, rx: 0.24, rz: 0.04, z: 0.1 }, { y: 0.62, rx: 0.2, rz: 0.03, z: 0.12 }, { y: 0.86, rx: 0.02, rz: 0.01, z: 0.02 }], 8), 0, 0, 0.12)], petalM);
    part(p, [0.25, 0.45, 0.63].map((y) => place(new THREE.SphereGeometry(0.022, 5, 3), 0, y, 0.25)), spotM, false);
    petals.push(p);
  }
  // the vine: a chain that lies coiled and whips straight
  const vine: THREE.Group[] = []; let parent: THREE.Object3D = tilt;
  const vineG = place(limb(0.5, 0.035, 0.03, 0, 1, 6), 0, 0, 0, -Math.PI / 2);
  for (let i = 0; i < 7; i++) { const s = new THREE.Group(); s.position.set(0, i === 0 ? 0.12 : 0, i === 0 ? 0.25 : 0.5); const m = new THREE.Mesh(vineG, stem); s.add(m); parent.add(s); vine.push(s); parent = s; }
  const fade = fader(root);
  let open = 0, whip = 0, fl = 0;
  return {
    root,
    flinch() { fl = 1; },
    update(e, t, dt, tele) {
      root.position.set(e.x, e.y, e.z); root.rotation.y = e.yaw;
      fl = Math.max(0, fl - dt * 4);
      const s = e.state, ease = (c: number, to: number, r: number) => c + (to - c) * (1 - Math.exp(-dt * r));
      if (e.dead) { open = ease(open, 1.5, 3); tilt.scale.y = Math.max(0.25, 1 - e.deadT * 0.5); fade(1 - THREE.MathUtils.smoothstep(e.deadT, 3, 6)); }
      else { tilt.scale.y = 1; fade(1); open = ease(open, s === 'windup' ? 0.35 + tele * 0.3 : s === 'strike' ? 1 : s === 'recover' ? 0.9 : 0, s === 'strike' ? 30 : 6); }
      whip = ease(whip, s === 'strike' ? 1 : s === 'recover' ? 0.5 * Math.max(0, 1 - e.stateT) : 0, s === 'strike' ? 40 : 5);
      petals.forEach((p, i) => { p.rotation.x = 0.05 + open * 1.25 + (s === 'windup' ? Math.sin(t * 34 + i) * 0.05 : 0) + Math.sin(t * 0.9 + i) * 0.015 + fl * 0.2; });
      vine.forEach((v, i) => { v.rotation.y = (1 - whip) * (i === 0 ? 0 : 0.95); v.rotation.x = i === 0 ? 0 : (1 - whip) * 0.02 + whip * Math.sin(t * 30 + i) * 0.04; v.visible = whip > 0.03 || i < 2; });
      heart.visible = open > 0.15;
      const hot = s === 'windup' ? 0.6 + tele * 2 : s === 'strike' ? 3 : 1;
      heartM.color.setRGB(1.6 * hot, 2.4 * hot, 0.5 * hot);
      // at night the spots glow: it can be seen for what it is, by someone who looks
      spotM.color.setRGB(0.9, 0.5, 1.6).multiplyScalar(0.5 + Math.sin(t * 1.7 + e.id) * 0.2 + open);
    },
  };
}

/**
 * The guardian: a standing stone that walks. Asleep it is a weathered monolith of dark ceramic and old bronze, crusted
 * with moss, crouched on folded legs: a statue in a cave. Awake it rises on four long jointed legs. It has no face: a
 * column of three lenses in a groove at the front. What it is about to do shows in how it moves: before the beam the
 * three lenses slide together into one line and it lowers and leans in; before the stomp it rears on its hind legs.
 * After a beam it has to shed the heat: two banks of fins on its back fan open, glowing, and the core between them is
 * bare (the weak point, from behind).
 */
function guardian(): CreatureView {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  // weathered pale stone, not dark ceramic: at fight distance a dark metal block read as a hole in the picture
  const stone = mat(0x77736b, { metalness: 0.05, roughness: 0.86, flatShading: true });
  const bronze = mat(0x9a7f52, { metalness: 0.75, roughness: 0.45, flatShading: true });
  const moss = mat(0x6f7d5c, { roughness: 1, flatShading: true });
  const strut = mat(0x2a2c31, { metalness: 0.6, roughness: 0.6, flatShading: true });
  const seamM = glow(0.1, 0.5, 0.6), lensM = glow(0.2, 1.2, 1.6), coreM = glow(2.4, 0.9, 0.2);
  const finM = new THREE.MeshStandardMaterial({ color: 0x4a4038, metalness: 0.6, roughness: 0.5, flatShading: true, emissive: new THREE.Color(0, 0, 0) });
  // the monolith: six-sided, wider at the shoulders, leaning a little forward, with bronze bands let into it
  const ring = (y: number, rx: number, rz: number, z = 0) => ({ y, rx, rz, z });
  part(body, [loft([ring(-0.45, 0.6, 0.48), ring(0.25, 0.74, 0.58), ring(1.15, 0.6, 0.48, 0.03), ring(1.7, 0.38, 0.3, 0.06), ring(1.92, 0.2, 0.17, 0.07)], 6)], stone);
  part(body, [0.05, 0.8, 1.42].map((y) => { const k = y < 0.5 ? 0.76 : y < 1 ? 0.71 : 0.53; return place(new THREE.CylinderGeometry(k, k, 0.07, 6), 0, y, 0.01); }),
    bronze);
  // a row of six marks on the middle band, cut by someone; nobody can read them
  part(body, Array.from({ length: 6 }, (_, i) => place(new THREE.BoxGeometry(0.035, 0.12, 0.04), (i - 2.5) * 0.09, 0.8, 0.66)), bronze, false);
  // moss and mineral crust on whatever faces up
  part(body, [[0.3, 1.62, 0.1, 0.32], [-0.35, 1.25, -0.2, 0.36], [0.15, 1.85, -0.05, 0.22], [-0.2, 0.32, 0.4, 0.28], [0.45, 0.3, -0.3, 0.3]].map(([x, y, z, r]) => place(new THREE.IcosahedronGeometry(r * 0.8, 1), x * 0.8, y - r * 0.1, z * 0.8, 0, x * 3, 0, [1, 0.55, 1])), moss);
  // the lens groove and three lenses; glowing seams down the front edges
  part(body, [place(new THREE.BoxGeometry(0.2, 0.62, 0.1), 0, 1.3, 0.5, -0.1)], strut, false);
  const lenses = [0.18, 0, -0.18].map((dy) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 10).rotateX(Math.PI / 2), lensM); m.position.set(0, 1.3 + dy, 0.56); body.add(m); return { m, dy }; });
  // a glowing seam down every edge of the six-sided stone: awake, its outline is drawn in light against the dark
  const edge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), l = d.length();
    const g = new THREE.CylinderGeometry(0.022, 0.022, l, 4).translate(0, l / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z);
    return place(g);
  };
  const seams: THREE.BufferGeometry[] = [];
  for (let j = 0; j < 6; j++) {
    const a = (j / 6) * Math.PI * 2, sx = Math.sin(a), cz = Math.cos(a), o = 1.03;
    seams.push(edge(sx * 0.74 * o, 0.25, cz * 0.58 * o, sx * 0.6 * o, 1.15, 0.03 + cz * 0.48 * o), edge(sx * 0.6 * o, 1.15, 0.03 + cz * 0.48 * o, sx * 0.38 * o, 1.7, 0.06 + cz * 0.3 * o));
  }
  part(body, seams, seamM, false);
  // a crest of three bronze spines on the crown, swept back: the shape that says it is not a rock
  part(body, [-0.13, 0, 0.13].map((x, i) => place(new THREE.ConeGeometry(0.06, i === 1 ? 0.75 : 0.5, 5), x, 1.98 + (i === 1 ? 0.25 : 0.15), -0.08, -0.55, 0, -x * 1.6)), bronze);
  // the back: the core under two banks of fins hinged at the spine
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), coreM); core.position.set(0, 0.85, -0.5); body.add(core);
  const fins = [-1, 1].map((sx) => {
    const g = new THREE.Group(); g.position.set(sx * 0.04, 0.85, -0.52); body.add(g);
    const m = part(g, Array.from({ length: 5 }, (_, i) => place(new THREE.BoxGeometry(0.3, 0.035, 0.16), sx * 0.16, (i - 2) * 0.13, -0.05)), finM);
    return { g, m, sx };
  });
  // four legs, each a two-bone strut with a bronze knee and a splayed foot, solved to the ground every frame
  const unit = (r0: number, r1: number) => new THREE.CylinderGeometry(r1, r0, 1, 6).translate(0, 0.5, 0);
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], i) => {
    const up = new THREE.Mesh(unit(0.21, 0.15), stone), lo = new THREE.Mesh(unit(0.16, 0.1), strut);
    const knee = new THREE.Mesh(new THREE.DodecahedronGeometry(0.21, 0), bronze);
    const foot = new THREE.Mesh(mergeGeometries([0, 2.09, 4.19].map((a) => place(new THREE.BoxGeometry(0.1, 0.07, 0.34), Math.sin(a) * 0.12, 0.035, Math.cos(a) * 0.12, 0, a, 0))), strut);
    for (const o of [up, lo, knee, foot]) { o.castShadow = true; o.frustumCulled = false; tilt.add(o); }
    return { sx, sz, up, lo, knee, foot, hip: new THREE.Vector3(sx * 0.5, -0.2, sz * 0.38), ph: i === 0 || i === 3 ? 0 : Math.PI };
  });
  const fade = fader(root);
  const Y = new THREE.Vector3(0, 1, 0), hipT = new THREE.Vector3(), footT = new THREE.Vector3(), kneeT = new THREE.Vector3(), wristT = new THREE.Vector3(), pole = new THREE.Vector3();
  const strutTo = (o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) => { const d = new THREE.Vector3().subVectors(b, a), l = d.length(); o.position.copy(a); o.quaternion.setFromUnitVectors(Y, d.divideScalar(l || 1)); o.scale.set(1, Math.max(0.01, l), 1); };
  let wake = 0, vent = 0, fl = 0, sink = 0, walk = 0, conv = 0, rear = 0, slam = 0, crouch = 0;
  return {
    root,
    flinch() { fl = 1; },
    update(e, t, dt, tele) {
      root.position.set(e.x, e.y, e.z); root.rotation.y = e.yaw;
      const s = e.state, ease = (c: number, to: number, r: number) => c + (to - c) * (1 - Math.exp(-dt * r));
      fl = Math.max(0, fl - dt * 6);
      wake = ease(wake, s === 'dormant' || e.dead ? 0 : 1, 1.1);
      vent = ease(vent, e.weakT > 0 || s === 'stagger' ? 1 : 0, 5);
      sink = ease(sink, e.dead ? 1 : 0, 1.2);
      walk += dt * e.speed * 2.2;
      const stomp = e.atk?.id === 'stomp', beam = e.atk?.id === 'beam';
      conv = ease(conv, s === 'windup' && beam ? tele : s === 'strike' && beam ? 1 : 0, 10);
      rear = ease(rear, s === 'windup' && stomp ? tele : 0, s === 'windup' ? 6 : 14);
      slam = s === 'strike' && stomp ? 1 : Math.max(0, slam - dt * 2.5);
      crouch = ease(crouch, s === 'windup' && beam ? 1 : 0, 4);
      const lift = 0.55 + 1.0 * wake * (1 - sink) - crouch * 0.25 - slam * 0.2;
      body.position.set(0, lift + Math.sin(t * 1.1) * 0.025 * wake + rear * 0.35, rear * -0.2);
      body.rotation.set(-rear * 0.42 + crouch * 0.1 + slam * 0.1 + sink * 0.15, 0, (s === 'stagger' || e.stunT > 0 ? Math.sin(t * 22) * 0.035 : 0) + fl * 0.03 + sink * 0.1);
      body.updateMatrix();
      for (const L of legs) {
        hipT.copy(L.hip).applyMatrix4(body.matrix);
        // feet: wide and planted awake, tucked in asleep; a trot when it walks; the front pair up when it rears
        // asleep the long legs lie folded flat out to the sides, knees low (a statue on its belly); tucked under it
        // they had nowhere to go but up, and stood beside it like posts
        const rest = 1 - wake * (1 - sink), spread = 1.25 + 0.4 * rest, ph = walk + L.ph, step = e.speed > 0.05 ? 1 : 0;
        footT.set(L.sx * spread * 1.05, 0, L.sz * (0.42 + 0.63 * wake + 0.5 * rest) + Math.sin(ph) * 0.4 * step);
        footT.y = Math.max(0, Math.cos(ph)) * 0.22 * step;
        if (L.sz > 0) { footT.y += rear * 1.1; footT.z += rear * 0.35; }
        pole.set(L.sx * 1, 1.3 - rest * 1.0, L.sz * 0.4 + L.sz * rest * 0.4);
        reach(hipT, footT, 1.05, 1.3, pole, kneeT, wristT);
        strutTo(L.up, hipT, kneeT); strutTo(L.lo, kneeT, wristT);
        L.knee.position.copy(kneeT); L.foot.position.copy(wristT); L.foot.rotation.y = L.sx * 0.5;
      }
      // the lenses slide together into one line before the beam; one bright lens while it fires
      const hot = e.dead ? 0 : s === 'strike' && beam ? 8 : wake * (1 + conv * 4);
      const over = e.phase ? 1 : 0;
      lensM.color.setRGB(0.2 * hot + over * 0.9 * wake, 1.2 * hot * (over ? 0.45 : 1), 1.6 * hot * (over ? 0.35 : 1));
      lenses.forEach((l) => { l.m.position.y = 1.3 + l.dy * (1 - 0.9 * conv); l.m.scale.setScalar(0.4 + 0.6 * wake + conv * 0.3); });
      seamM.color.setRGB(over ? 1.4 : 0.25, over ? 0.35 : 1.0, over ? 0.1 : 1.2).multiplyScalar(0.08 + wake * (0.9 + Math.sin(t * 2.2) * 0.15));
      // fins fan open off the spine to shed heat; they glow while hot and the core shows between them
      fins.forEach((f) => { f.g.rotation.z = f.sx * vent * 1.1; f.g.rotation.y = -f.sx * vent * 0.35; });
      finM.emissive.setRGB(1.6, 0.45, 0.1).multiplyScalar(vent * (0.7 + Math.sin(t * 18) * 0.15));
      // the core is always lit while it is awake (a slow pulse through the gaps of the closed fins); bared and
      // blazing while it vents
      core.scale.setScalar(0.75 + vent * 0.6);
      coreM.color.setRGB(2.4, 0.9, 0.2).multiplyScalar(e.dead ? 0 : 0.12 + wake * (0.55 + Math.sin(t * 2.4) * 0.2) + vent * (1.3 + Math.sin(t * 20) * 0.3));
      fade(e.dead ? 1 - THREE.MathUtils.smoothstep(e.deadT, 5, 7) : 1);
    },
  };
}

/** A small animal's shadow is its body's alone: the head, tail and legs would each be drawn again for a few pixels. */
function small(v: CreatureView): CreatureView {
  let first = true;
  v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { if (!first) o.castShadow = false; first = false; } });
  return v;
}

export function createCreature(kind: SpeciesId): CreatureView {
  switch (kind) {
    case 'hound': return hound();
    case 'lashbloom': return lashbloom();
    case 'guardian': return guardian();
    case 'skritch': return small(quadruped({ len: 0.75, girth: 0.17, legLen: 0.3, legR: 0.035, headLen: 0.3, neck: 0.1, tail: 0.5, ears: 0.9, hide: 0x4a3f33, belly: 0x8a7a62, ridge: [0.5, 1.5, 0.9], eye: [2.2, 1.6, 0.4], gait: 1.1 }));
    case 'nibbet': return small(quadruped({ len: 0.5, girth: 0.15, legLen: 0.26, legR: 0.03, headLen: 0.22, neck: 0.08, tail: 0.12, ears: 1.9, hide: 0x7d745a, belly: 0xc9c2a4, ridge: [0.4, 1.1, 1.3], eye: [1.2, 1.4, 1.5], gait: 1.3 }));
    default: return quadruped({ len: 2.5, girth: 0.72, legLen: 0.95, legR: 0.16, headLen: 0.8, neck: 0.3, tail: 0.5, ears: 0.35, hide: 0x4b4f45, belly: 0x6f6a58, ridge: [0.4, 1.2, 0.5], eye: [1.6, 1.3, 0.5], plates: 1, moss: 0x3f7a4c, gait: 0.42 });
  }
}
