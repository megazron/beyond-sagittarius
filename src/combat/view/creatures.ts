// The bodies of what the simulation thinks for. Verdaxis animals share a body plan: three pairs of eyes and a ridge of
// light along the back, the way everything with a backbone on Earth shares four limbs. Each body is a handful of
// merged meshes (few draw calls), posed from the creature's state: a pose for every state, so what it is about to do
// can be read from how it stands.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loft, limb, grainNormal } from '../../characters/shapes';
import { createHound } from '../../world/predator';
import type { Enemy, SpeciesId } from '../sim/species';

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
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = k > 0.6; });
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
  let gait = 0, crouch = 0, headUp = 0, open = 0, lie = 0;
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
      for (const l of legs) {
        const p = (gait + l.ph) * Math.PI * 2;
        // pawing the ground: the telegraph of a charge is one front leg scraping
        const paw = wind && q.plates && l === legs[0] ? Math.sin(t * 14) * 0.6 : 0;
        l.g.rotation.x = Math.sin(p) * (0.5 + run * 0.4) * amt + paw + lie * (l.ph ? 1.1 : -1.1) * 0.6 + (strike ? (l === legs[0] || l === legs[1] ? -0.9 : 0.8) : 0);
      }
      body.position.y = hip * (1 - crouch * 0.32 - lie * 0.55) + Math.abs(Math.sin(gait * Math.PI * 2)) * hip * 0.07 * amt;
      body.rotation.x = wind ? 0.12 + tele * 0.1 : strike ? -0.18 : s === 'flee' ? -0.06 : 0;
      body.rotation.z = (e.stunT > 0 || s === 'stagger' ? Math.sin(t * 9) * 0.07 : 0) + lie * 0.5;
      head.rotation.x = -headUp * 0.55 + (s === 'stagger' ? Math.sin(t * 16) * 0.2 : 0) + (wind && q.plates ? 0.5 : 0) + Math.sin(t * 1.1 + e.id) * 0.04;
      head.rotation.y = s === 'investigate' ? Math.sin(t * 1.6) * 0.5 : s === 'warn' ? Math.sin(t * 7) * 0.25 : 0;
      jaw.rotation.x = open * 0.6;
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
  let snarl = 0, crouch = 0, lie = 0;
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

/** The guardian: three legs, a tall shell of old metal and stone, one slit of light, and a core at its back. */
function guardian(): CreatureView {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  const shell = mat(0x5d6068, { metalness: 0.75, roughness: 0.5, flatShading: true }), dark = mat(0x23252b, { metalness: 0.6, roughness: 0.6, flatShading: true });
  const eyeM = glow(0.2, 1.2, 1.6), coreM = glow(2.4, 0.9, 0.2);
  body.position.y = 1.5;
  part(body, [place(new THREE.CylinderGeometry(0.55, 0.9, 1.9, 6), 0, 0.7, 0), place(new THREE.CylinderGeometry(0.35, 0.56, 0.5, 6), 0, 1.85, 0), place(new THREE.BoxGeometry(1.5, 0.3, 0.5), 0, 1.25, 0)], shell);
  part(body, [place(new THREE.CylinderGeometry(0.93, 0.7, 0.3, 6), 0, -0.3, 0), place(new THREE.BoxGeometry(0.5, 0.9, 0.3), 0, 0.7, -0.62)], dark);
  const eye = part(body, [place(new THREE.BoxGeometry(0.62, 0.07, 0.06), 0, 1.3, 0.58)], eyeM, false);
  const core = part(body, [place(new THREE.SphereGeometry(0.2, 10, 8), 0, 0.75, -0.8)], coreM, false);
  const vents = [-1, 1].map((sx) => { const g = new THREE.Group(); g.position.set(sx * 0.26, 0.75, -0.72); body.add(g); part(g, [place(new THREE.BoxGeometry(0.26, 0.9, 0.08), sx * 0.13, 0, -0.06)], shell); return g; });
  const legs: { hip: THREE.Group; a: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + Math.PI, hip = new THREE.Group();
    hip.position.set(Math.sin(a) * 0.7, -0.25, Math.cos(a) * 0.7); hip.rotation.y = a; body.add(hip);
    part(hip, [place(new THREE.BoxGeometry(0.26, 0.26, 1.2), 0, 0.1, 0.5, -0.5), place(new THREE.BoxGeometry(0.2, 1.5, 0.2), 0, -0.55, 1.0, 0.12), place(new THREE.CylinderGeometry(0.3, 0.36, 0.14, 6), 0, -1.22, 1.08)], dark);
    legs.push({ hip, a });
  }
  const fade = fader(root);
  let wake = 0, vent = 0, fl = 0, sink = 0, walk = 0;
  return {
    root,
    flinch() { fl = 1; },
    update(e, t, dt, tele) {
      root.position.set(e.x, e.y, e.z); root.rotation.y = e.yaw;
      const s = e.state, ease = (c: number, to: number, r: number) => c + (to - c) * (1 - Math.exp(-dt * r));
      fl = Math.max(0, fl - dt * 6);
      wake = ease(wake, s === 'dormant' || e.dead ? 0 : 1, 1.4);
      vent = ease(vent, e.weakT > 0 || s === 'stagger' ? 1 : 0, 6);
      // shut down, it settles on its legs and the light goes out; nothing breaks off
      sink = ease(sink, e.dead ? 1 : 0, 1.2);
      walk += dt * e.speed * 1.4;
      const stomp = e.atk?.id === 'stomp', beam = e.atk?.id === 'beam';
      body.position.y = 1.5 - (1 - wake) * 0.35 - sink * 0.5 + (s === 'windup' && stomp ? tele * 0.5 : s === 'strike' && stomp ? -0.3 : 0) + Math.sin(t * 1.3) * 0.03 * wake;
      body.rotation.z = (s === 'stagger' || e.stunT > 0 ? Math.sin(t * 22) * 0.04 : 0) + sink * 0.12 + fl * 0.03;
      body.rotation.x = s === 'windup' && beam ? -0.08 * tele : sink * 0.2;
      legs.forEach((l, i) => { l.hip.rotation.x = Math.sin(walk + i * 2.094) * 0.14 * Math.min(1, e.speed) - (1 - wake) * 0.2 - sink * 0.25; });
      vents.forEach((v, i) => { v.rotation.y = (i ? 1 : -1) * vent * 1.3; });
      const hot = e.dead ? 0 : s === 'windup' && beam ? 1 + tele * 5 : s === 'strike' && beam ? 8 : wake;
      eyeM.color.setRGB(0.2 * hot + (e.phase ? 0.8 * wake : 0), 1.2 * hot * (e.phase ? 0.5 : 1), 1.6 * hot * (e.phase ? 0.4 : 1));
      eye.scale.y = 0.2 + wake * 0.8 + (s === 'windup' && beam ? tele : 0);
      core.scale.setScalar(0.5 + vent * 0.8);
      coreM.color.setRGB(2.4, 0.9, 0.2).multiplyScalar(e.dead ? 0 : 0.25 + vent * (1.2 + Math.sin(t * 20) * 0.3));
      fade(e.dead ? 1 - THREE.MathUtils.smoothstep(e.deadT, 5, 7) : 1);
    },
  };
}

export function createCreature(kind: SpeciesId): CreatureView {
  switch (kind) {
    case 'hound': return hound();
    case 'lashbloom': return lashbloom();
    case 'guardian': return guardian();
    case 'skritch': return quadruped({ len: 0.75, girth: 0.17, legLen: 0.3, legR: 0.035, headLen: 0.3, neck: 0.1, tail: 0.5, ears: 0.9, hide: 0x4a3f33, belly: 0x8a7a62, ridge: [0.5, 1.5, 0.9], eye: [2.2, 1.6, 0.4], gait: 1.1 });
    case 'nibbet': return quadruped({ len: 0.5, girth: 0.15, legLen: 0.26, legR: 0.03, headLen: 0.22, neck: 0.08, tail: 0.12, ears: 1.9, hide: 0x7d745a, belly: 0xc9c2a4, ridge: [0.4, 1.1, 1.3], eye: [1.2, 1.4, 1.5], gait: 1.3 });
    default: return quadruped({ len: 2.5, girth: 0.72, legLen: 0.95, legR: 0.16, headLen: 0.8, neck: 0.3, tail: 0.5, ears: 0.35, hide: 0x4b4f45, belly: 0x6f6a58, ridge: [0.4, 1.2, 0.5], eye: [1.6, 1.3, 0.5], plates: 1, moss: 0x3f7a4c, gait: 0.42 });
  }
}
