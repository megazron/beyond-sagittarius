// The weapons held in the hand for a fight (spear, club, throwing stick, torch, a stone, a flake, the hand axe), held
// and swung the way the sim says, with three rules the owner asked for: the weapon never passes through the body, the
// hands stay on it through the whole motion (both hands on a spear's shaft), and nothing jumps between one pose and
// the next.
//
// How: every hold and every phase of an attack is a WEAPON frame in the body's own space (where the right hand grips,
// which way the shaft points, where along the shaft the left hand is, how the chest bends and turns). Frames are
// blended (never switched), then the shaft is pushed clear of a simple body (stacked elliptic cylinders: legs under
// the coat, chest, head), then both arms reach their hands with a two-bone solve, elbows out and down, and the arms
// themselves are kept outside the chest. The result is low-passed (about 40 ms) so a change of state eases instead of
// popping. The weapon is drawn where the right hand really is after the pose, along the solved shaft, so the grip
// never slips. Pure maths here (no DOM); tools/combat/pose_test.ts checks it frame by frame.
import * as THREE from 'three';
import type { Dir, Limbs } from '../../characters/character';
import type { WeaponId } from '../sim/weapons';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
export const smooth = (k: number) => { k = clamp01(k); return k * k * (3 - 2 * k); };
export const out3 = (k: number) => 1 - (1 - clamp01(k)) ** 3;

/** A weapon pose: right grip (body-local, +z ahead, +x to the body's left), the shaft's way from the grip to the
 * working end, the left hand's place along the shaft (metres from the grip; null: the left hand is not on it), and the
 * left hand's own mark when it is free (body-local), the chest's bend and turn. */
export interface WFrame { g: THREE.Vector3; d: THREE.Vector3; l: number | null; lh: THREE.Vector3; bend: number; twist: number }
const F = (g: [number, number, number], d: [number, number, number], l: number | null, lh: [number, number, number], bend = 0, twist = 0): WFrame =>
  ({ g: V(...g), d: V(...d).normalize(), l, lh: V(...lh), bend, twist });

/** The shaft of each weapon: how far it reaches behind the grip and ahead of it (metres), and its radius. */
export const SHAFT: Partial<Record<WeaponId, { back: number; front: number; r: number }>> = {
  spear: { back: 0.65, front: 1.57, r: 0.016 }, hafted: { back: 0.65, front: 1.53, r: 0.016 },
  club: { back: 0.13, front: 0.69, r: 0.03 }, torch: { back: 0.15, front: 0.75, r: 0.02 },
  throwstick: { back: 0.02, front: 0.68, r: 0.02 }, rock: { back: 0.04, front: 0.08, r: 0.05 },
  flake: { back: 0.02, front: 0.09, r: 0.02 }, handaxe: { back: 0.03, front: 0.15, r: 0.03 },
};
export const MELEE_GEAR = Object.keys(SHAFT) as WeaponId[];
const TWO = (w: WeaponId) => w === 'spear' || w === 'hafted';

// the free left hand's marks
const LH_GUARD: [number, number, number] = [0.24, 1.12, 0.3], LH_LOW: [number, number, number] = [0.27, 0.92, 0.08], LH_BAL: [number, number, number] = [0.38, 1.05, 0.18];
/** The frames, by weapon kind: carry (walking, nothing near), ready (up), back (wind-up), hit (the blow), and for the
 * club a second swing, for throwable things the throw's draw and release, and the spear's brace. */
const SPEAR = {
  carry: F([-0.27, 0.95, 0.1], [0.05, 1, 0.16], null, LH_LOW),
  ready: F([-0.24, 1.0, -0.02], [0.24, 0.2, 1], 0.45, LH_GUARD, 0.12, -0.3),
  back: F([-0.24, 1.06, -0.22], [0.26, 0.12, 1], 0.5, LH_GUARD, 0.08, -0.55),
  hit: F([-0.12, 1.2, 0.12], [0.14, 0.05, 1], 0.4, LH_GUARD, 0.3, 0.2),
  brace: F([-0.24, 0.84, -0.06], [0.22, 0.36, 1], 0.5, LH_GUARD, 0.36, -0.3),
  throwBack: F([-0.4, 1.58, -0.18], [0.06, 0.12, 1], null, [0.3, 1.25, 0.5], -0.12, -0.65),
  throwHit: F([-0.16, 1.42, 0.42], [0.03, -0.08, 1], null, [0.33, 0.95, -0.05], 0.34, 0.55),
};
const CLUB = {
  carry: F([-0.27, 0.88, 0.08], [-0.12, -0.5, 1], null, LH_LOW),
  ready: F([-0.29, 1.12, 0.28], [0.08, 0.88, 0.32], null, LH_GUARD, 0.1),
  back: F([-0.3, 1.6, -0.08], [0.06, 0.35, -1], null, LH_BAL, -0.12, -0.4),
  hit: F([-0.1, 1.02, 0.5], [0.05, -0.62, 0.8], null, [0.36, 0.9, 0.02], 0.44, 0.4),
  back2: F([-0.5, 1.2, -0.12], [-0.62, 0.22, -0.72], null, [0.33, 1.05, 0.35], 0, -0.7),
  hit2: F([0.12, 1.16, 0.5], [0.86, 0.05, 0.5], null, [0.42, 0.92, -0.05], 0.2, 0.7),
  throwBack: F([-0.4, 1.55, -0.25], [-0.2, 0.7, -0.6], null, [0.3, 1.25, 0.5], -0.15, -0.7),
  throwHit: F([-0.12, 1.3, 0.48], [0.05, 0.2, 1], null, [0.33, 0.95, -0.05], 0.36, 0.6),
};
const STICK = {
  ...CLUB,
  carry: F([-0.27, 0.9, 0.06], [-0.08, -0.4, 1], null, LH_LOW),
  ready: F([-0.3, 1.1, 0.22], [-0.28, 0.6, 0.72], null, LH_GUARD, 0.08),
  // the throwing stick goes side-arm: drawn back low at the right hip, flat, and let go level in front
  throwBack: F([-0.5, 1.15, -0.3], [-0.72, 0.08, -0.68], null, [0.3, 1.2, 0.5], 0, -0.75),
  throwHit: F([0.02, 1.18, 0.5], [0.72, 0.02, 0.7], null, [0.36, 0.95, -0.05], 0.3, 0.6),
};
const SMALL = {
  carry: F([-0.25, 0.9, 0.05], [0, -0.3, 1], null, LH_LOW),
  ready: F([-0.24, 1.15, 0.3], [0, 0.4, 1], null, LH_GUARD, 0.1),
  back: F([-0.27, 1.2, -0.05], [0, 0.3, 1], null, LH_GUARD, 0, -0.3),
  hit: F([-0.06, 1.3, 0.55], [0, 0, 1], null, [0.3, 1.05, 0.2], 0.15, 0.45),
  throwBack: F([-0.4, 1.6, -0.25], [-0.1, 0.5, -0.8], null, [0.3, 1.25, 0.5], -0.15, -0.7),
  throwHit: F([-0.12, 1.3, 0.5], [0, 0, 1], null, [0.33, 0.95, -0.05], 0.36, 0.6),
};
function frames(w: WeaponId) { return TWO(w) ? SPEAR : w === 'throwstick' ? STICK : w === 'club' || w === 'torch' ? CLUB : SMALL; }

/** Blend two frames. The left hand's place on the shaft and its free mark blend too: a hand comes on to the shaft or
 * leaves it by moving, never by jumping (the free mark stands in for "on the shaft" when only one frame grips). */
export function mixF(a: WFrame, b: WFrame, k: number, into: WFrame, w: WeaponId): WFrame {
  k = clamp01(k);
  into.g.copy(a.g).lerp(b.g, k);
  into.d.copy(a.d).lerp(b.d, k); if (into.d.lengthSq() < 1e-6) into.d.copy(b.d); into.d.normalize();
  const la = a.l === null ? null : V().copy(a.g).addScaledVector(a.d, a.l), lb = b.l === null ? null : V().copy(b.g).addScaledVector(b.d, b.l);
  if (la && lb) { into.l = a.l! + (b.l! - a.l!) * k; into.lh.copy(la).lerp(lb, k); }
  else if (!la && !lb) { into.l = null; into.lh.copy(a.lh).lerp(b.lh, k); }
  else {
    // one grips, one does not: the hand travels between the free mark and the shaft, and counts as on the shaft only
    // once it gets there (the last tenth)
    const on = la ? 1 - k : k, mark = la ? b.lh : a.lh, sl = (la ? a.l : b.l)!;
    const at = V().copy(into.g).addScaledVector(into.d, sl);
    into.lh.copy(mark).lerp(at, smooth(on));
    // across the front of the body, not through it: the hand's path bows forward on the way
    into.lh.z += Math.sin(Math.PI * smooth(on)) * 0.16;
    into.l = on > 0.9 ? sl : null;
  }
  into.bend = a.bend + (b.bend - a.bend) * k; into.twist = a.twist + (b.twist - a.twist) * k;
  void w;
  return into;
}

/** What the controller knows of the player this frame (a subset of the sim's player). */
export interface ActState { weapon: WeaponId; act: string; actT: number; combo: number; charge: number; charging: string; blocking: boolean; blockT: number; up: number; since: number; thrown: boolean; windup: number; active: number; recover: number }

/** The frame the body should be in for this state (before collision and smoothing). */
export function targetFrame(s: ActState, into: WFrame, tmp: WFrame): WFrame {
  const w = s.weapon, Fr = frames(w) as typeof CLUB & Partial<typeof SPEAR>;
  const rest = mixF(Fr.carry, Fr.ready, smooth(s.up), tmp, w);
  const copy = (f: WFrame) => { into.g.copy(f.g); into.d.copy(f.d); into.l = f.l; into.lh.copy(f.lh); into.bend = f.bend; into.twist = f.twist; return into; };
  if (s.blocking && Fr.brace) return mixF(rest, Fr.brace, out3(s.blockT / 0.12), into, w);
  if (s.blocking) return mixF(rest, Fr.ready, 1, into, w);
  if (s.act === 'charge') return mixF(rest, Fr.throwBack, out3(s.charge), into, w);
  const second = w === 'club' && s.combo === 1;
  const back = second ? Fr.back2 : Fr.back, hit = second ? Fr.hit2 : Fr.hit;
  if (s.act === 'windup') return mixF(rest, back, out3(s.actT / (s.windup * 0.8)), into, w);
  if (s.act === 'active') return mixF(back, hit, out3(s.actT / (s.active * 0.6)), into, w);
  if (s.act === 'recover' && s.combo !== 9) return mixF(hit, rest, smooth(s.actT / s.recover), into, w);
  if (s.thrown && s.since < 0.5) {
    const k = s.since / 0.5;
    return k < 0.3 ? mixF(Fr.throwBack, Fr.throwHit, out3(k / 0.3), into, w) : mixF(Fr.throwHit, rest, smooth((k - 0.3) / 0.7), into, w);
  }
  return copy(rest);
}

// ---------------------------------------------------------------- the body, for keeping things out of it
/** Stacked elliptic cylinders in the body's frame (metres; the coat over both legs is one skirt). The chest and head
 * lean forward with the bend. */
export interface BodyShape { y0: number; y1: number; ax: number; az: number; cz: number; lean: number }
export const BODY: BodyShape[] = [
  { y0: 0.0, y1: 0.98, ax: 0.2, az: 0.14, cz: 0, lean: 0 },
  // (the chest between the arms: an arm hanging at the side is not in it)
  { y0: 0.98, y1: 1.46, ax: 0.165, az: 0.14, cz: 0, lean: 0.55 },
  { y0: 1.46, y1: 1.8, ax: 0.11, az: 0.12, cz: 0.02, lean: 1 },
];
/** How deep a point is inside the body (>0 inside, in metres, roughly), and the way out (horizontal). */
let BODY_K = 1;
/** The body's size against the frames' (a 1.75 m man): the frames and the body shape scale with it. */
export function setBodyScale(k: number) { BODY_K = k > 0.5 && k < 1.5 ? k : 1; }
export function bodyScale() { return BODY_K; }
export function depth(pw: THREE.Vector3, bend: number, rw: number, outN?: THREE.Vector3): number {
  return depthN(V().copy(pw).divideScalar(BODY_K), bend, rw / BODY_K, outN) * BODY_K;
}
function depthN(p: THREE.Vector3, bend: number, r: number, outN?: THREE.Vector3): number {
  let best = -9;
  for (const b of BODY) {
    if (p.y < b.y0 - r || p.y > b.y1 + r) continue;
    const cz = b.cz + Math.sin(bend) * (p.y - 0.95) * b.lean * 0.9;
    const ex = b.ax + r, ez = b.az + r, dx = p.x / ex, dz = (p.z - cz) / ez, rho = Math.hypot(dx, dz);
    const dpt = (1 - rho) * Math.min(ex, ez);
    if (dpt > best) { best = dpt; if (outN) { if (rho < 1e-4) outN.set(-1, 0, 0); else outN.set(dx / rho, 0, dz / rho).normalize(); } }
  }
  return best;
}

/** Push the shaft out of the body: turn it about the grip when the trouble is away from the hand, move the hand when
 * it is the hand. Returns the worst depth left (<= 0 is clear). */
export function clearShaft(f: WFrame, w: WeaponId): number {
  const S = SHAFT[w]; if (!S) return -1;
  const n = V(), p = V();
  for (let it = 0; it < 8; it++) {
    let worst = 0, ws = 0;
    // the grip itself (the hand) is kept out too
    for (let s = -S.back; s <= S.front + 1e-6; s += 0.05) {
      p.copy(f.g).addScaledVector(f.d, s);
      const dp = depth(p, f.bend, S.r + 0.012);
      if (dp > worst) { worst = dp; ws = s; }
    }
    if (worst <= 0) return 0;
    p.copy(f.g).addScaledVector(f.d, ws); depth(p, f.bend, S.r + 0.012, n);
    if (Math.abs(ws) < 0.15) f.g.addScaledVector(n, worst + 0.01);
    else { p.addScaledVector(n, worst + 0.012); f.d.copy(p.sub(f.g)).multiplyScalar(Math.sign(ws)).normalize(); }
  }
  let worst = -1;
  for (let s = -S.back; s <= S.front + 1e-6; s += 0.05) worst = Math.max(worst, depth(p.copy(f.g).addScaledVector(f.d, s), f.bend, S.r));
  return worst;
}

/** Two-bone reach (root-local): the elbow and wrist that put the wrist at `t` from shoulder `s`, the elbow towards
 * `pole`. Returns the distance left between the wrist and `t` (0 when it reaches). */
export function reach2(s: THREE.Vector3, t: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, elbow: THREE.Vector3, wrist: THREE.Vector3) {
  const d = V().subVectors(t, s); let len = d.length();
  const want = len, maxL = (a + b) * 0.995, minL = Math.abs(a - b) + 0.02;
  len = Math.min(maxL, Math.max(minL, len || minL));
  d.normalize();
  wrist.copy(s).addScaledVector(d, len);
  const x = (a * a - b * b + len * len) / (2 * len), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = pole.clone().addScaledVector(d, -pole.dot(d));
  if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0).addScaledVector(d, d.y);
  pp.normalize();
  elbow.copy(s).addScaledVector(d, x).addScaledVector(pp, h);
  return Math.abs(want - len);
}

/** The skeleton the arms are solved on: shoulders (body-local, this frame) and the two arm bone lengths. */
export interface Skel { sL: THREE.Vector3; sR: THREE.Vector3; a: number; b: number; palm: number }
export interface Solved { limbs: Limbs; f: WFrame; eL: THREE.Vector3; wL: THREE.Vector3; eR: THREE.Vector3; wR: THREE.Vector3; missL: number; missR: number; penetration: number; armIn: number }

/** Arms for a frame: the right hand on the grip, the left on the shaft (or at its free mark), elbows out, the arms kept
 * out of the chest by swinging the elbow further out. */
export function solveArms(f: WFrame, w: WeaponId, k: Skel, leftW: number, rightW: number, lPrev: number | null = null, dt = 1 / 60): Solved {
  const penetration = clearShaft(f, w);
  // the left hand's target: on the shaft (the far side of it from the body by the shaft's radius) or its free mark;
  // kept out of the body as well
  // a two-handed shaft slides through the front hand (it guides, the back hand drives): the left hand takes the
  // place on the shaft it can comfortably reach, ahead of the shoulder, not a fixed mark that a thrust would tear
  // out of its grip
  if (f.l !== null) {
    const R = (k.a + k.b + k.palm) * 0.9, rel = V().subVectors(k.sL, f.g), s0 = rel.dot(f.d);
    const h = rel.addScaledVector(f.d, -s0).length();
    const want = Math.min(1.0, Math.max(0.3, s0 + Math.sqrt(Math.max(0, R * R - h * h)) * 0.55));
    // the slide is a slide: at most 2.5 m/s along the shaft
    f.l = lPrev === null ? want : lPrev + Math.max(-2.5 * dt, Math.min(2.5 * dt, want - lPrev));
  }
  const lt = f.l !== null ? V().copy(f.g).addScaledVector(f.d, f.l) : V().copy(f.lh);
  const rt = V().copy(f.g);
  const n = V();
  for (const t of [lt, rt]) { const dp = depth(t, f.bend, 0.05, n); if (dp > 0) t.addScaledVector(n, dp + 0.005); }
  const eL = V(), wL = V(), eR = V(), wR = V();
  const A = k.a, B = k.b + k.palm;
  let armIn = 0;
  const arm = (s: THREE.Vector3, t: THREE.Vector3, side: number, e: THREE.Vector3, wr: THREE.Vector3) => {
    let miss = 0;
    // elbow out to the side, down, a little back; further out if the arm would go through the chest
    for (let o = 0; o < 5; o++) {
      const pole = V(side * (0.75 + o * 0.35), -0.65 + o * 0.08, -0.25);
      miss = reach2(s, t, A, B, pole, e, wr);
      let worst = 0;
      for (let i = 1; i <= 6; i++) {
        const q = i <= 3 ? V().copy(s).lerp(e, 0.35 + i * 0.2) : V().copy(e).lerp(wr, (i - 3) / 3);
        worst = Math.max(worst, depth(q, f.bend, 0.04));
      }
      if (worst <= 0.002 || o === 4) { armIn = Math.max(armIn, worst); break; }
    }
    return miss;
  };
  const missR = arm(k.sR, rt, -1, eR, wR), missL = arm(k.sL, lt, 1, eL, wL);
  // the wrist is the palm's length short of the hand target: the bone handed to the rig is the forearm to the wrist
  const wristR = V().copy(eR).lerp(wR, k.b / B), wristL = V().copy(eL).lerp(wL, k.b / B);
  const dir = (a: THREE.Vector3, b: THREE.Vector3): Dir => { const d = V().subVectors(a, b).normalize(); return [d.x, d.y, d.z]; };
  const limbs: Limbs = { bend: f.bend, twist: f.twist };
  if (rightW > 0) { limbs.armR = dir(eR, k.sR); limbs.foreR = dir(wristR, eR); }
  if (leftW > 0) { limbs.armL = dir(eL, k.sL); limbs.foreL = dir(wristL, eL); }
  return { limbs, f, eL, wL, eR, wR, missL, missR, penetration, armIn };
}

/** A frame's smoothed copy: follows the target with a time constant (seconds), directions turned, not snapped. */
export function follow(cur: WFrame, tgt: WFrame, dt: number, tau = 0.04, maxTurn = 24) {
  const k = 1 - Math.exp(-dt / tau);
  cur.g.lerp(tgt.g, k); cur.lh.lerp(tgt.lh, k);
  // the shaft turns towards its target, at most maxTurn radians a second (a cancelled blow swings back, not snaps)
  const ang = cur.d.angleTo(tgt.d), step = Math.min(ang * k, maxTurn * dt);
  if (ang > 1e-5) {
    const ax = V().crossVectors(cur.d, tgt.d);
    if (ax.lengthSq() < 1e-10) ax.set(0, 1, 0).cross(cur.d).lengthSq() < 1e-8 ? ax.set(1, 0, 0) : ax.set(0, 1, 0).cross(cur.d);
    cur.d.applyAxisAngle(ax.normalize(), step).normalize();
  }
  cur.l = tgt.l === null ? null : cur.l === null ? tgt.l : cur.l + (tgt.l - cur.l) * k;
  cur.bend += (tgt.bend - cur.bend) * k; cur.twist += (tgt.twist - cur.twist) * k;
}
export function newFrame(): WFrame { return { g: V(), d: V(0, 0, 1), l: null, lh: V(), bend: 0, twist: 0 }; }
export function copyFrame(a: WFrame, into: WFrame) { into.g.copy(a.g); into.d.copy(a.d); into.l = a.l; into.lh.copy(a.lh); into.bend = a.bend; into.twist = a.twist; return into; }
