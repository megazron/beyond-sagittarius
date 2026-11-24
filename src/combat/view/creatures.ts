// The bodies of what the simulation thinks for. Verdaxis animals share a body plan: three pairs of eyes and a ridge of
// light along the back, the way everything with a backbone on Earth shares four limbs. Each body is a handful of
// merged meshes (few draw calls), posed from the creature's state: a pose for every state, so what it is about to do
// can be read from how it stands.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loft, limb, grainNormal } from '../../characters/shapes';
import { createHound } from '../../world/predator';
import type { Enemy, SpeciesId } from '../sim/species';
import { DARTER_LEN } from '../sim/species';
import { reach } from './ranged';
import { nearFade } from '../../core/nearfade';

export interface CreatureView {
  root: THREE.Group;
  /** Pose from the simulation's state. `t` is the clock, `tele` 0 to 1 through a wind-up. */
  update(e: Enemy, t: number, dt: number, tele: number): void;
  /** A hit landed: a short flash and flinch. */
  flinch(dx: number, dz: number): void;
}

const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, normalMap: grainNormal(), normalScale: new THREE.Vector2(0.6, 0.6), ...o });
/** The night's cold edge light on the animals (the controller sets it with the planetshine): a body beyond the
 * firelight is otherwise a dark shape on a dark ground, and only its eyes show. */
export const NIGHT_RIM = { value: new THREE.Color(0, 0, 0) };
/** `held`: this animal's own light while it is caught (a trap's catch has to read at the edge of the firelight). */
function rimmed<T extends THREE.MeshStandardMaterial>(m: T, held: { value: THREE.Color } = { value: new THREE.Color(0, 0, 0) }): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNightRim = NIGHT_RIM; sh.uniforms.uHeldLit = held;
    sh.fragmentShader = 'uniform vec3 uNightRim;\nuniform vec3 uHeldLit;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  { float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); vec3 tint = 0.15 + 1.6 * diffuseColor.rgb; totalEmissiveRadiance += (uNightRim * pow(fr, 2.0) + uHeldLit * (0.12 + 0.88 * pow(fr, 1.6))) * tint; }');
    nearFade(m, sh);
  };
  const key = m.customProgramCacheKey.bind(m);
  // (the edge light tinted by the hide's own colour: as a flat cold-white edge of 0.9 on dark hides the animals glowed
  // white at night like lit ghosts, GPU take e169v8; a dark hide now gets about a quarter of it, in its own hue)
  m.customProgramCacheKey = () => key() + '|nightRim6';
  return m;
}
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
  /** A pale tail tip (a flag that flashes as it runs, like a rabbit's scut or a deer's tail). */
  flag?: number;
  /** How far it sits up on its haunches to look round (radians): small prey in long grass raise the head above it. */
  perk?: number;
}

/** A four-legged body: Skritch, Nibbet and Mossback are the same plan at different sizes. */
function quadruped(q: QuadSpec): CreatureView {
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  const hip = q.legLen * 0.96;
  body.position.y = hip;
  const heldU = { value: new THREE.Color(0, 0, 0) };
  const hide = rimmed(mat(q.hide), heldU), belly = rimmed(mat(q.belly), heldU), ridgeM = glow(...q.ridge), eyeM = glow(...q.eye);
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
  if (q.flag && q.tail > 0) part(tail, [place(new THREE.SphereGeometry(G * 0.42, 8, 6).translate(0, -q.tail * 0.92, 0), 0, 0, 0, 1.75)], rimmed(mat(q.flag, { roughness: 0.95 }), heldU));
  // legs: upper and lower as one piece per leg
  const legs: { g: THREE.Group; ph: number }[] = [];
  for (const [x, z, ph] of [[-1, 1, 0], [1, 1, 0.5], [-1, -1, 0.5], [1, -1, 0]] as const) {
    const g = new THREE.Group(); g.position.set(x * G * 0.72, -G * 0.2, z * L * 0.34); body.add(g);
    part(g, [place(limb(q.legLen * 0.55, q.legR * 1.5, q.legR, 0.2, 1, 8)), place(limb(q.legLen * 0.5, q.legR, q.legR * 0.75, 0.05, 1, 8), 0, -q.legLen * 0.5, 0.02, 0.12), place(new THREE.SphereGeometry(q.legR * 1.2, 6, 4), 0, -q.legLen * 0.97, q.legR * 0.4, 0, 0, 0, [1, 0.5, 1.4])], hide);
    legs.push({ g, ph });
  }
  const C = common(root, tilt);
  let gait = 0, crouch = 0, headUp = 0, open = 0, lie = 0, held = 0, sit = 0;
  const hind = legs.filter((l) => l.g.position.z < 0);
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
      // sitting up to look: when something has its attention, and in short bouts while it feeds (prey that feeds in
      // the open keeps lifting its head to scan, then goes back down); the head comes up out of the long grass
      const vig = ((t * 0.16 + e.id * 0.37) % 1) < 0.2;
      const look = !!q.perk && held < 0.1 && !asleep && sp < 0.4 && (s === 'investigate' || s === 'warn' || s === 'call' || ((s === 'idle' || s === 'feed') && (e.aware || vig)));
      sit = ease(sit, look ? 1 : 0, dt, look ? 7 : 9);
      const sa = sit * (q.perk ?? 0);
      body.position.y = hip * (1 - crouch * 0.32 - lie * 0.55) + Math.abs(Math.sin(gait * Math.PI * 2)) * hip * 0.07 * amt + Math.sin(sa) * L * 0.34;
      body.position.z = -(1 - Math.cos(sa)) * L * 0.34;
      body.rotation.x = (wind ? 0.12 + tele * 0.1 : strike ? -0.18 : s === 'flee' ? -0.06 : 0) - sa;
      // the hind legs stay under it, the front paws tuck up against the chest
      for (const l of legs) l.g.rotation.x += hind.includes(l) ? sa : sa * 1.4;
      body.rotation.z = (e.stunT > 0 || s === 'stagger' ? Math.sin(t * 9) * 0.07 : 0) + lie * 0.5 + held * Math.sin(t * 11) * 0.22;
      body.rotation.x += held * (-0.22 + Math.sin(t * 15) * 0.08);
      body.rotation.y = held * (Math.sin(t * 6.5) * 0.45 + Math.sin(t * 21) * 0.08);
      head.rotation.x = -headUp * 0.55 + sa * 0.75 + (s === 'stagger' ? Math.sin(t * 16) * 0.2 : 0) + (wind && q.plates ? 0.5 : 0) + Math.sin(t * 1.1 + e.id) * 0.04;
      head.rotation.y = s === 'investigate' ? Math.sin(t * 1.6) * 0.5 : s === 'warn' ? Math.sin(t * 7) * 0.25 : 0;
      head.rotation.x += held * Math.sin(t * 19) * 0.3; head.rotation.y += held * Math.sin(t * 9) * 0.5;
      jaw.rotation.x = Math.max(open, held * (0.6 + Math.sin(t * 25) * 0.4)) * 0.6;
      tail.rotation.y = Math.sin(t * (2 + run * 6) + e.id) * (0.3 + run * 0.2);
      tail.rotation.x = s === 'warn' || wind ? -0.9 : s === 'flee' ? 0.5 : 0;
      // the ridge and the eyes say how it feels: dim asleep, bright when it means it
      // caught: its eyes and ridge flare (fear), and the body takes a light of its own, pale firelight at night, so
      // a small dark animal fighting the cord at the edge of the light reads as one (it was a dark lump)
      // (v12 at 0.3 made it a glowing pale ghost, blown out near the lens: now mostly an edge)
      heldU.value.setRGB(0.2, 0.17, 0.13).multiplyScalar(held * (NIGHT.on ? 1 : 0.2));
      const hot = held > 0.5 ? 2.6 : wind ? 1 + tele * 2.5 : strike ? 3 : s === 'call' || s === 'warn' ? 2 : asleep ? 0.15 : e.aware ? 1 : 0.6;
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
  // the light of its own seams and core on the stone: a cold rim where the faces turn away from the eye (the seams
  // run down every edge) and a faint warm glow from the core, so from the front at fight distance it reads as lit
  // stone with an outline, not a dark block. No real light: a light added mid-game recompiles every material.
  const rimU = { value: new THREE.Color(0, 0, 0) }, coreU = { value: new THREE.Color(0, 0, 0) };
  // the legs take the seams' cold rim but not the core's warmth: the core is in the back, and its glow on every stone
  // turned the legs tan in the sun and orange after a beam
  const legRimU = { value: new THREE.Color(0, 0, 0) }, noGlow = { value: new THREE.Color(0, 0, 0) };
  const stoneOf = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}, rim = rimU, glowU = coreU) => {
    const m = mat(c, { metalness: 0.05, roughness: 0.88, flatShading: true, ...o });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = rim; sh.uniforms.uCoreGlow = glowU;
      sh.fragmentShader = 'uniform vec3 uRim;\nuniform vec3 uCoreGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  { float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);\n'
        + '    totalEmissiveRadiance += uRim * (0.1 + pow(fr, 2.2) * 1.5) + uCoreGlow * (0.4 + 0.6 * fr); }');
      nearFade(m, sh);
    };
    const k = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => k() + '|guardianStone';
    return m;
  };
  // the body pale; the legs and the face's carving a darker, older stone, so the legs read as weight under it and
  // not as pale planks
  const stone = stoneOf(0x8a857b), dark = stoneOf(0x46423b);
  // the legs: a cold dark basalt, weathered (grime in the joints, rain streaks down each drum, pale lichen on what
  // faces up); vertex colours, so the sun on them reads as dark old stone, never tan
  // (lying folded the legs face the sun square on, so they need a far darker stone than the upright body to read dark)
  const legStone = stoneOf(0x3b3d40, { vertexColors: true, roughness: 0.96 }, legRimU, noGlow);
  // the face's hollow: near black stone that only takes the lenses' light
  const hollowM = mat(0x2b2c2e, { roughness: 1, flatShading: true, side: THREE.DoubleSide, emissive: new THREE.Color(0, 0, 0) });
  const bronze = mat(0x9a7f52, { metalness: 0.75, roughness: 0.45, flatShading: true });
  const moss = mat(0x6f7d5c, { roughness: 1, flatShading: true });
  const seamM = glow(0.1, 0.5, 0.6), lensM = glow(0.2, 1.2, 1.6), coreM = glow(2.4, 0.9, 0.2);
  const finM = new THREE.MeshStandardMaterial({ color: 0x4a4038, metalness: 0.6, roughness: 0.5, flatShading: true, emissive: new THREE.Color(0, 0, 0) });
  // the monolith: six-sided, built in courses like laid stone (each course a little proud of the one above, the
  // joints turned), wider at the shoulders, leaning a little forward, with bronze bands let into it
  const ring = (y: number, rx: number, rz: number, z = 0) => ({ y, rx, rz, z });
  const course = (y0: number, y1: number, r0: [number, number], r1: [number, number], z0: number, z1: number, turn: number) =>
    place(loft([ring(y0, r0[0], r0[1], z0), ring(y1, r1[0], r1[1], z1)], 6), 0, 0, 0, 0, turn, 0);
  part(body, [
    course(-0.45, 0.3, [0.6, 0.48], [0.78, 0.6], 0, 0, 0),
    course(0.3, 0.78, [0.8, 0.62], [0.72, 0.56], 0, 0.02, 0.09),
    course(0.78, 1.16, [0.75, 0.58], [0.6, 0.48], 0.02, 0.03, -0.06),
    course(1.16, 1.7, [0.56, 0.45], [0.38, 0.3], 0.04, 0.06, 0.05),
    course(1.7, 1.92, [0.38, 0.3], [0.2, 0.17], 0.06, 0.07, 0),
  ], stone);
  part(body, [0.05, 0.78].map((y) => { const k = y < 0.5 ? 0.77 : 0.75; return place(new THREE.CylinderGeometry(k, k, 0.07, 6), 0, y, 0.01); }), bronze);
  // shoulders: two heavy blocks of the older stone over the front legs, a slab sloping off each like a pauldron, so
  // from the front it is broad at the top and narrow at the head, not a cone
  part(body, [-1, 1].flatMap((sx) => [
    place(new THREE.DodecahedronGeometry(0.4, 0), sx * 0.72, 1.02, 0.08, 0.2, sx * 0.4, 0, [1.05, 0.8, 1.1]),
    place(new THREE.BoxGeometry(0.62, 0.16, 0.7), sx * 0.86, 1.2, 0.05, 0, 0, -sx * 0.42),
    place(new THREE.BoxGeometry(0.5, 0.12, 0.6), sx * 0.98, 1.02, 0.05, 0, 0, -sx * 0.62),
  ]), dark);
  part(body, [-1, 1].map((sx) => place(new THREE.BoxGeometry(0.66, 0.05, 0.74), sx * 0.85, 1.26, 0.05, 0, 0, -sx * 0.42)), bronze, false);
  // a row of six marks on the middle band, cut by someone; nobody can read them
  part(body, Array.from({ length: 6 }, (_, i) => place(new THREE.BoxGeometry(0.035, 0.12, 0.04), (i - 2.5) * 0.09, 0.62, 0.66)), bronze, false);
  // moss and mineral crust on whatever faces up
  part(body, [[0.3, 1.62, 0.1, 0.32], [-0.35, 1.25, -0.2, 0.36], [0.15, 1.85, -0.05, 0.22], [-0.2, 0.32, 0.4, 0.28], [0.45, 0.3, -0.3, 0.3], [0.85, 1.32, -0.1, 0.26], [-0.9, 1.3, 0.1, 0.22]].map(([x, y, z, r]) => place(new THREE.IcosahedronGeometry(r * 0.8, 1), x * 0.8, y - r * 0.1, z * 0.8, 0, x * 3, 0, [1, 0.55, 1])), moss);
  // the face: one carved EYE SOCKET under a heavy frowning brow, cheek stones under its corners, a jaw stone below;
  // in the socket one big eye with a slit pupil and two small lenses in its corners. Before the beam the small ones
  // slide into the big one and the pupil closes so the light pours out.
  // No box and no flat panel (a square socket read as a screen), and not round (a round hollow read as a mouth or a
  // porthole): the socket is an almond, wider than tall with pointed corners and a hooded upper lid, turned on a
  // lathe round the line of sight, then drawn out sideways and roughened by hand.
  const FZ = 0.5, FY = 1.3;
  const rough = (a: number) => 1 + 0.09 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1) + 0.03 * Math.sin(9 * a + 0.3);
  const mask = (prof: [number, number][]) => {
    const g = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), 15).rotateX(Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // an almond: drawn out sideways, squeezed to points at the corners (the nearer a point is to the side, the
      // flatter), the upper lid hooded a little lower than the lower one; each angle its own chisel depth
      const x = p.getX(i), y = p.getY(i), a = Math.atan2(y, x), k = rough(a), pinch = 0.32 + 0.68 * Math.pow(Math.abs(Math.sin(a)), 0.8);
      p.setXYZ(i, x * k * 1.3, y * k * 0.62 * pinch * (y > 0 ? 0.88 : 1), p.getZ(i) + 0.012 * Math.sin(7 * a));
    }
    g.computeVertexNormals();
    return place(g, 0, FY, FZ);
  };
  // the mound: from inside the body, up over a thick uneven lip; the hollow: from the lip down to the eye
  part(body, [mask([[0.36, -0.22], [0.34, -0.06], [0.3, 0.06], [0.24, 0.12], [0.19, 0.13]])], stone, false);
  part(body, [mask([[0.19, 0.13], [0.16, 0.1], [0.13, 0.05], [0.09, 0.01], [0.05, -0.01], [0.0, -0.02]])], hollowM, false);
  // a heavy brow ridge straight over the socket, its two halves dipping to the middle (a frown: the face looks AT
  // you), cheek stones under the socket's corners, a chin stone: rounded weathered lumps, not slabs
  part(body, [
    place(new THREE.DodecahedronGeometry(0.17, 0), -0.17, FY + 0.17, FZ + 0.08, 0.35, 0.2, -0.2, [1.55, 0.45, 0.85]),
    place(new THREE.DodecahedronGeometry(0.17, 0), 0.17, FY + 0.175, FZ + 0.075, 0.3, -0.3, 0.2, [1.5, 0.47, 0.85]),
    place(new THREE.DodecahedronGeometry(0.1, 0), 0, FY + 0.13, FZ + 0.11, 0.6, 0.9, 0, [1.1, 0.55, 0.9]),
    place(new THREE.DodecahedronGeometry(0.12, 0), -0.25, FY - 0.15, FZ - 0.01, 0.2, 0.6, 0.5, [1.2, 0.7, 0.8]),
    place(new THREE.DodecahedronGeometry(0.12, 0), 0.25, FY - 0.14, FZ - 0.01, -0.3, -0.5, -0.5, [1.2, 0.7, 0.8]),
    place(new THREE.DodecahedronGeometry(0.15, 0), 0.02, FY - 0.36, FZ - 0.02, -0.3, 0.4, 0.05, [1.3, 0.6, 0.9]),
  ], stone);
  // the eye in the socket, wider than tall like the socket round it, two small lenses in the corners; before the
  // beam they slide into the big one
  const lens = (r: number, w: number) => new THREE.SphereGeometry(r, 12, 8).scale(w, 1, 0.45);
  const lenses = ([[0, -0.005, 0.072, 1.3], [-0.17, 0.0, 0.03, 1], [0.17, 0.0, 0.03, 1]] as const).map(([dx, dy, r, w]) => {
    const m = new THREE.Mesh(lens(r, w), lensM); m.position.set(dx, FY + dy, FZ + 0.02 + Math.abs(dx) * 0.2); body.add(m); return { m, dx, dy };
  });
  // a slit pupil across the big eye (an eye looks, a lamp does not); it closes before the beam to let the light out
  const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.12, 0.012), mat(0x08090a, { roughness: 0.5 }));
  pupil.position.set(0, FY - 0.005, FZ + 0.054); body.add(pupil);
  // a glowing seam down every edge of the six-sided stone: awake, its outline is drawn in light against the dark
  const edge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), l = d.length();
    const g = new THREE.CylinderGeometry(0.022, 0.022, l, 4).translate(0, l / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z);
    return place(g);
  };
  const seams: THREE.BufferGeometry[] = [];
  for (let j = 0; j < 6; j++) {
    // the front pair is behind the face, the side pairs behind the shoulders: only the edges that show
    if (j === 0) continue;
    const a = (j / 6) * Math.PI * 2, sx = Math.sin(a), cz = Math.cos(a), o = 1.04;
    seams.push(edge(sx * 0.8 * o, 0.3, cz * 0.62 * o, sx * 0.6 * o, 1.16, 0.03 + cz * 0.48 * o), edge(sx * 0.56 * o, 1.16, 0.04 + cz * 0.45 * o, sx * 0.38 * o, 1.7, 0.06 + cz * 0.3 * o));
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
  // four legs, each a two-bone limb solved to the ground every frame. Stone as thick as the weight it carries, laid in
  // three drums a bone (each drum's top a little narrower and turned, so the joints show), a boulder of a knee bound
  // in bronze, a broad stone foot with three blunt toes
  const drums = (r0: number, r1: number) => mergeGeometries([0, 1, 2].map((i) => {
    const k0 = i / 3, k1 = (i + 1) / 3, ra = r0 + (r1 - r0) * k0, rb = r0 + (r1 - r0) * k1;
    return place(new THREE.CylinderGeometry(rb * 0.86, ra, 0.34, 7), 0, (k0 + k1) / 2, 0, 0, i * 0.45, 0);
  }).concat([place(new THREE.BoxGeometry(0.12, 0.8, 0.14), 0, 0.5, r0 * 0.78, 0, 0, 0)]))!;
  // weathering in vertex colours: each drum darker at its foot (grime and wet in the joint), streaks of rain run
  // down it, pale grey-green lichen where a face looks up; the stone itself a cold basalt grey
  const weather = (g: THREE.BufferGeometry, seed: number, drumH = 1 / 3) => {
    const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z);
      const inDrum = drumH > 0 ? ((y / drumH) % 1 + 1) % 1 : 1;
      const streak = 0.5 + 0.5 * Math.sin(a * 7 + seed * 3.1) * Math.sin(a * 3 + seed);
      const mottle = 0.5 + 0.5 * Math.sin(x * 23 + seed) * Math.sin(y * 17 + z * 19 + seed * 2);
      let v = 0.5 + 0.18 * mottle - 0.16 * streak - 0.2 * (1 - Math.min(1, inDrum * 4));
      v = Math.max(0.18, v);
      const lichen = Math.max(0, n.getY(i) - 0.35) * (mottle > 0.6 ? 1 : 0.25);
      c[i * 3] = v * 0.96 + lichen * 0.18; c[i * 3 + 1] = v + lichen * 0.24; c[i * 3 + 2] = v * 1.05 + lichen * 0.12;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], i) => {
    const up = new THREE.Mesh(weather(drums(0.33, 0.24), i * 2), legStone), lo = new THREE.Mesh(weather(drums(0.25, 0.19), i * 2 + 1), legStone);
    const knee = new THREE.Mesh(weather(mergeGeometries([place(new THREE.DodecahedronGeometry(0.3, 0)), place(new THREE.TorusGeometry(0.27, 0.045, 4, 9), 0, 0, 0, Math.PI / 2, 0, 0)])!, i + 9, 0), legStone);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.04, 4, 9).rotateX(Math.PI / 2), bronze);
    const foot = new THREE.Mesh(weather(mergeGeometries([place(new THREE.CylinderGeometry(0.27, 0.36, 0.2, 7), 0, 0.1, 0)].concat([-0.6, 0, 0.6].map((a) => place(new THREE.DodecahedronGeometry(0.13, 0), Math.sin(a) * 0.3, 0.07, Math.cos(a) * 0.3, 0, a, 0, [1, 0.7, 1.4]))))!, i + 20, 0), legStone);
    for (const o of [up, lo, knee, foot, band]) { o.castShadow = true; o.frustumCulled = false; tilt.add(o); }
    return { sx, sz, up, lo, knee, foot, band, hip: new THREE.Vector3(sx * 0.52, -0.2, sz * 0.38), ph: i === 0 || i === 3 ? 0 : Math.PI };
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
      // asleep it has settled its weight into the ground (the lowest course sunk in), head bowed a little
      const rest = 1 - wake * (1 - sink);
      const lift = 0.36 + 1.19 * wake * (1 - sink) - crouch * 0.25 - slam * 0.2;
      body.position.set(0, lift + Math.sin(t * 1.1) * 0.025 * wake + rear * 0.35, rear * -0.2);
      body.rotation.set(-rear * 0.42 + crouch * 0.1 + slam * 0.1 + sink * 0.15 + rest * 0.06, 0, (s === 'stagger' || e.stunT > 0 ? Math.sin(t * 22) * 0.035 : 0) + fl * 0.03 + sink * 0.1);
      body.updateMatrix();
      for (const L of legs) {
        hipT.copy(L.hip).applyMatrix4(body.matrix);
        // awake: feet wide and planted, a trot when it walks, the front pair up when it rears. Asleep: folded like a
        // resting animal of stone. The front feet lie forward along the ground with the elbow out and back; the hind
        // feet are drawn up under the flank with the knee lying out behind. Knees on the ground, not up beside it.
        const ph = walk + L.ph, step = e.speed > 0.05 ? 1 : 0;
        const awakeX = L.sx * 1.31, awakeZ = L.sz * (0.42 + 0.63 * wake) + Math.sin(ph) * 0.4 * step;
        const restX = L.sx * (L.sz > 0 ? 0.62 : 0.82), restZ = L.sz > 0 ? 1.45 : 0.3;
        footT.set(awakeX + (restX - awakeX) * rest, 0, awakeZ + (restZ - awakeZ) * rest);
        footT.y = Math.max(0, Math.cos(ph)) * 0.22 * step * (1 - rest);
        if (L.sz > 0) { footT.y += rear * 1.1; footT.z += rear * 0.35; }
        // the knee's way: out and up awake; asleep out to the side and back, down at the ground
        pole.set(L.sx * (1 + rest * 0.6), 1.3 - rest * 1.15, L.sz * 0.4 * (1 - rest) - rest * (L.sz > 0 ? 0.9 : 1.4));
        reach(hipT, footT, 1.05, 1.3, pole, kneeT, wristT);
        strutTo(L.up, hipT, kneeT); strutTo(L.lo, kneeT, wristT);
        L.knee.position.copy(kneeT); L.knee.quaternion.copy(L.lo.quaternion);
        L.band.position.copy(kneeT); L.band.quaternion.copy(L.lo.quaternion);
        L.foot.position.copy(wristT); L.foot.rotation.y = L.sz > 0 ? L.sx * 0.2 * rest + L.sx * 0.5 * (1 - rest) : L.sx * 0.5;
      }
      // the lenses slide together into one line before the beam; one bright lens while it fires
      const over = e.phase ? 1 : 0;
      // idle the eye is a glint in the hollow (bright enough to find, not a lit panel); the wind-up brings it up
      const eye = e.dead ? 0 : s === 'strike' && beam ? 8 : wake * (1.1 + conv * 4);
      // in the second phase the eye burns white-hot rather than orange (the whole thing turning orange read as a
      // colour change, not as strain)
      // (white-hot at about 60% of the blue eye's level: all three channels high bloomed into a disc over the face, v12)
      lensM.color.setRGB(over ? 0.7 * eye + 0.25 * wake : 0.2 * eye, over ? 0.66 * eye + 0.2 * wake : 1.2 * eye, over ? 0.6 * eye + 0.16 * wake : 1.6 * eye);
      pupil.scale.set(Math.max(0.02, 1 - conv * 1.1), 1, 1); pupil.visible = !e.dead && conv < 0.9;
      // the hollow's walls take the eye's light (a cold glow deepening in the wind-up)
      hollowM.emissive.setRGB(0.03, 0.12, 0.16).multiplyScalar(Math.min(2, eye) * (over ? 0.5 : 1));
      lenses.forEach((l) => { const k = 1 - 0.9 * conv; l.m.position.x = l.dx * k; l.m.position.y = FY + l.dy * k; l.m.scale.setScalar(0.4 + 0.6 * wake + conv * 0.3); });
      // the second phase: the seams' cold light falters (a stutter, as if it were failing), with a pale amber edge,
      // not a body gone orange
      const stut = over ? (Math.sin(t * 13.0) * Math.sin(t * 5.3) > 0.35 ? 0.35 : 1) : 1;
      seamM.color.setRGB(over ? 0.75 : 0.25, over ? 0.7 : 1.0, over ? 0.65 : 1.2).multiplyScalar((0.08 + wake * (0.9 + Math.sin(t * 2.2) * 0.15)) * stut);
      // the seams' light on its own stone (a rim on the faces turning away) and the core's warmth
      const sk = e.dead ? 0 : wake * (1 - sink) * (0.85 + Math.sin(t * 2.2) * 0.15);
      rimU.value.setRGB(over ? 0.14 : 0.09, over ? 0.22 : 0.34, over ? 0.26 : 0.42).multiplyScalar(sk * stut);
      // the legs keep a faint cold rim only (the overload's orange on them read as tan-orange stone)
      legRimU.value.setRGB(0.09, 0.34, 0.42).multiplyScalar(sk * 0.45);
      // the core's warmth on the body's stone: faint, a little more while it vents (it was strong enough to turn the
      // whole body orange in the sun)
      coreU.value.setRGB(0.06, 0.026, 0.008).multiplyScalar(e.dead ? 0 : wake * (0.6 + vent * 0.9));
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

/**
 * A darter: a slim fish about 35 cm long. Countershaded the way a stream fish is: a dark olive-brown back with darker
 * bars across it grading down the flanks to a dull buff belly (dark from above, so from the bank it is a dark shape
 * and its shadow on the bottom, which is how a fish is actually spotted). Deep and round at the head and shoulders,
 * tapering to a narrow wrist and a forked tail, a back fin and a small fin under the tail; matt, never shiny or pale
 * (v2's leaf: a flat pale spindle with a metal sheen that took the sky). The body bends from the middle back as it
 * swims; held still, only the tail and fins stir. The controller puts the root where the fish is SEEN (raised by
 * refraction); the sim keeps where it is. Killed it rolls belly up and floats to the surface.
 */
function darter(): CreatureView {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const L = 0.34, RINGS = 15, AROUND = 12, H = 0.043, W = 0.026;
  // the body: rings from the nose (+z) back to the wrist of the tail (-z); a small mesh (15 x 12 points)
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  // (linear values: vertex colours are not converted; in sRGB about #383520 back, #615938 flank, #958c69 belly)
  const back = [0.04, 0.036, 0.014], flank = [0.12, 0.1, 0.04], belly = [0.3, 0.26, 0.14];
  for (let r = 0; r < RINGS; r++) {
    const u = r / (RINGS - 1), z = L * (0.5 - u);
    // blunt round head, deepest about a third of the way back, then a long taper to a narrow wrist
    const prof = u < 0.3 ? Math.sqrt(Math.max(0, 1 - Math.pow((0.3 - u) / 0.3, 2))) : 1 - 0.82 * Math.pow((u - 0.3) / 0.7, 1.25);
    const rr = r === RINGS - 1 ? 0.12 : prof;
    for (let k = 0; k < AROUND; k++) {
      const ang = (k / AROUND) * Math.PI * 2, cy = Math.sin(ang), cx = Math.cos(ang);
      // the back a little higher than the belly is deep; the belly a touch flatter
      const y = cy * H * rr * (cy < 0 ? 0.85 : 1), x = cx * W * rr;
      pos.push(x, y, z);
      // countershading: dark back, through the flank to the belly, darker bars across the back (parr marks)
      const kb = THREE.MathUtils.smoothstep(cy, -0.15, 0.75), kf = THREE.MathUtils.smoothstep(cy, -0.85, -0.1);
      const bar = kb * 0.016 * Math.max(0, Math.sin(u * 26)) * (u > 0.15 && u < 0.85 ? 1 : 0);
      for (let i = 0; i < 3; i++) { const lo = belly[i] + (flank[i] - belly[i]) * kf; col.push(Math.max(0, lo + (back[i] - lo) * kb - bar)); }
    }
  }
  for (let r = 0; r < RINGS - 1; r++) for (let k = 0; k < AROUND; k++) {
    const a = r * AROUND + k, b = r * AROUND + ((k + 1) % AROUND), c = a + AROUND, d = b + AROUND;
    idx.push(a, c, b, b, c, d);
  }
  // the nose and the end of the wrist, closed
  const nose = pos.length / 3; pos.push(0, -H * 0.05, L * 0.5 + 0.004); col.push(...flank);
  const end = pos.length / 3; pos.push(0, 0, -L * 0.5 - 0.004); col.push(...flank);
  for (let k = 0; k < AROUND; k++) { const k2 = (k + 1) % AROUND; idx.push(nose, k, k2); idx.push(end, (RINGS - 1) * AROUND + k2, (RINGS - 1) * AROUND + k); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const fins = new THREE.MeshStandardMaterial({ color: 0x2f2b1d, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
  body.add(new THREE.Mesh(g, skin));
  // an eye each side, dark, just behind the nose
  const eyeG = new THREE.SphereGeometry(0.0065, 6, 4), eyeM = new THREE.MeshStandardMaterial({ color: 0x0b0a07, roughness: 0.3 });
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(eyeG, eyeM); m.position.set(sx * W * 0.62, H * 0.28, L * 0.39); body.add(m); }
  const tri = (pts: number[][]) => { const q = new THREE.BufferGeometry().setFromPoints(pts.map((v) => new THREE.Vector3(v[0], v[1], v[2]))); q.computeVertexNormals(); return q; };
  // the tail: a forked fin on a hinge at the wrist of the tail (two lobes and the notch between them)
  const tail = new THREE.Group(); tail.position.z = -L * 0.49; body.add(tail);
  const B1 = [0, 0.012, 0.004], B2 = [0, -0.011, 0.004], U = [0, 0.058, -0.085], N = [0, 0, -0.048], D = [0, -0.052, -0.085];
  tail.add(new THREE.Mesh(tri([B1, U, N, B1, N, B2, B2, N, D]), fins));
  // a back fin over the deepest part of the body, and a small fin under the tail
  const df = tri([[0, H * 0.9, L * 0.12], [0, H * 0.9 + 0.045, L * 0.02], [0, H * 0.72, -L * 0.1]]);
  body.add(new THREE.Mesh(df, fins));
  const af = tri([[0, -H * 0.5, -L * 0.18], [0, -H * 0.5 - 0.025, -L * 0.27], [0, -H * 0.35, -L * 0.3]]);
  body.add(new THREE.Mesh(af, fins));
  const pf = [-1, 1].map((s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.022), fins); m.position.set(s * W * 0.95, -H * 0.55, L * 0.25); m.rotation.set(0.3, s * 0.6, s * 0.5); body.add(m); return m; });
  for (const o of [root]) o.traverse((q) => { q.castShadow = false; });
  // drawn to the sim's length (DARTER_LEN; the shapes above are for a 34 cm fish)
  body.scale.setScalar(DARTER_LEN / L);
  // its shadow on the bottom, under where the fish really is: how a fish is actually spotted from the bank. The
  // controller sets its height (root.userData.shadow) to the bottom; soft and dark, it moves with the fish
  const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vP; void main() { float r = length(vP); float a = 0.55 * smoothstep(1.0, 0.25, r); if (a < 0.01) discard; gl_FragColor = vec4(0.03, 0.04, 0.03, a); }',
  }));
  sh.scale.set(DARTER_LEN * 0.16, 1, DARTER_LEN * 0.55); sh.renderOrder = 1; root.add(sh); root.userData.shadow = sh;
  // so a dark fish reads against dark water (owner: "hard to see in the dark water"): the sun through the surface
  // lays a pale, moving net of light on the gravel under it, and the dark fish and its shadow sit on that patch; a
  // faint shaft of light comes down through the water to it. The controller sets their heights like the shadow's.
  const uT = { value: 0 };
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), bedLightMaterial(uT));
  patch.scale.setScalar(DARTER_LEN * 1.6); patch.renderOrder = 0; root.add(patch); root.userData.patch = patch;
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uT },
    vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uT; varying vec2 vU; void main() { float a = smoothstep(0.0, 0.5, vU.x) * smoothstep(1.0, 0.5, vU.x) * (0.25 + 0.75 * vU.y);'
      + ' a *= 0.8 + 0.2 * sin(uT * 1.7 + vU.x * 6.0); gl_FragColor = vec4(vec3(0.5, 0.55, 0.42) * a * 0.06, 1.0); }',
  }));
  shaft.scale.set(DARTER_LEN * 0.9, 1, 1); shaft.renderOrder = 2; root.add(shaft); root.userData.shaft = shaft;
  let sw = 0, roll = 0;
  return {
    root,
    flinch() { /* a fish hit is a fish taken */ },
    update(e, t, dt) {
      root.position.set(e.x, e.y + 0.04, e.z); root.rotation.y = e.yaw; uT.value = t;
      const sp = e.dead ? 0 : e.speed;
      // the body swings faster and wider the faster it goes; at rest a slow fan of the tail keeps it in place
      sw += dt * (2.2 + sp * 9);
      const amp = e.dead ? 0 : 0.12 + Math.min(0.45, sp * 0.12);
      tail.rotation.y = Math.sin(sw) * amp * 2.2; body.rotation.y = Math.sin(sw - 1.2) * amp * 0.35;
      pf.forEach((m, i) => { m.rotation.z = (i ? 1 : -1) * (0.5 + Math.sin(t * 5 + i) * 0.2); });
      roll += ((e.dead ? Math.PI : 0) - roll) * (1 - Math.exp(-dt * 2));
      body.rotation.z = roll;
    },
  };
}

/** A small animal's shadow is its body's alone: the head, tail and legs would each be drawn again for a few pixels. */
function small(v: CreatureView): CreatureView {
  let first = true;
  v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { if (!first) o.castShadow = false; first = false; } });
  return v;
}

/**
 * The sun's net of light on a stream bed (caustics): bright wavering lines only, no pale fill, an outline that is not a
 * circle, and the pattern fixed to the ground (world x, z), so a patch that moves with a fish uncovers the light on the
 * gravel instead of carrying a lit disc about (owner: the patches under the fish read as spotlights). The same material
 * lies, still, here and there over the shallows round a fishing spot (fx.bedLight), so the light belongs to the water.
 */
export function bedLightMaterial(uT: { value: number }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uT },
    vertexShader: 'varying vec2 vP; varying vec2 vW; void main() { vP = position.xz; vW = (modelMatrix * vec4(position, 1.0)).xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uT; varying vec2 vP; varying vec2 vW; void main() { float r = length(vP), an = atan(vP.y, vP.x);'
      + ' float edge = 0.78 + 0.14 * sin(an * 3.0 + vW.x * 0.7) + 0.08 * sin(an * 5.0 - vW.y * 0.9);'
      + ' float e = smoothstep(edge, edge * 0.25, r); if (e < 0.01) discard;'
      + ' vec2 q = vW * 6.5; float c = abs(sin(q.x * 1.7 + uT * 1.3) + sin(q.y * 1.3 - uT * 1.1) + sin((q.x + q.y) * 1.1 + uT * 0.7)) / 3.0;'
      + ' vec2 q2 = vW * 11.0 + 3.1; float c2 = abs(sin(q2.x * 1.3 - uT * 1.6) + sin(q2.y * 1.6 + uT * 1.2) + sin((q2.x - q2.y) * 0.9 - uT * 0.8)) / 3.0;'
      + ' float net = max(1.0 - smoothstep(0.0, 0.22, c), 0.6 * (1.0 - smoothstep(0.0, 0.18, c2)));'
      + ' gl_FragColor = vec4(vec3(0.85, 0.86, 0.66), e * net * 0.42); }',
  });
}

export function createCreature(kind: SpeciesId): CreatureView {
  switch (kind) {
    case 'hound': return hound();
    case 'lashbloom': return lashbloom();
    case 'guardian': return guardian();
    case 'darter': return darter();
    case 'skritch': return small(quadruped({ len: 0.75, girth: 0.17, legLen: 0.3, legR: 0.035, headLen: 0.3, neck: 0.1, tail: 0.5, ears: 0.9, hide: 0x4a3f33, belly: 0x8a7a62, ridge: [0.5, 1.5, 0.9], eye: [2.2, 1.6, 0.4], gait: 1.1 }));
    case 'nibbet': return small(quadruped({ len: 0.6, girth: 0.18, legLen: 0.3, legR: 0.034, headLen: 0.26, neck: 0.09, tail: 0.15, ears: 1.9, hide: 0x9a5f38, belly: 0xe2d6b4, ridge: [0.4, 1.1, 1.3], eye: [1.2, 1.4, 1.5], gait: 1.3, flag: 0xf1eee4, perk: 0.85 }));
    default: return quadruped({ len: 2.5, girth: 0.72, legLen: 0.95, legR: 0.16, headLen: 0.8, neck: 0.3, tail: 0.5, ears: 0.35, hide: 0x4b4f45, belly: 0x6f6a58, ridge: [0.4, 1.2, 0.5], eye: [1.6, 1.3, 0.5], plates: 1, moss: 0x3f7a4c, gait: 0.42 });
  }
}
