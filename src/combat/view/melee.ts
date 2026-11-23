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
export interface WFrame { g: THREE.Vector3; d: THREE.Vector3; l: number | null; lh: THREE.Vector3; bend: number; twist: number; /** 0..1: how far the left hand is on the shaft (eases, unlike l) */ hold: number }
const F = (g: [number, number, number], d: [number, number, number], l: number | null, lh: [number, number, number], bend = 0, twist = 0): WFrame =>
  ({ g: V(...g), d: V(...d).normalize(), l, lh: V(...lh), bend, twist, hold: l === null ? 0 : 1 });

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
  ready: F([-0.24, 1.0, 0.05], [0.32, 0.2, 1], 0.45, LH_GUARD, 0.12, -0.3),
  back: F([-0.25, 1.06, -0.15], [0.34, 0.12, 1], 0.5, LH_GUARD, 0.08, -0.55),
  hit: F([-0.12, 1.2, 0.12], [0.14, 0.05, 1], 0.4, LH_GUARD, 0.3, 0.2),
  brace: F([-0.24, 0.92, 0.02], [0.3, 0.36, 1], 0.5, LH_GUARD, 0.36, -0.3),
  // (drawn back is the arm reached back along the throw, the hand behind the shoulder at its height, the spear along
  // the forearm's line over it: with the hand by the ear the folded arm had nowhere for its elbow but out behind him)
  throwBack: F([-0.42, 1.56, -0.44], [0.06, 0.12, 1], null, [0.3, 1.25, 0.5], -0.12, -0.65),
  throwHit: F([-0.16, 1.42, 0.42], [0.03, -0.08, 1], null, [0.33, 0.95, -0.05], 0.34, 0.55),
};
const CLUB = {
  carry: F([-0.27, 0.88, 0.08], [-0.12, -0.5, 1], null, LH_LOW),
  ready: F([-0.29, 1.12, 0.28], [0.08, 0.88, 0.32], null, LH_GUARD, 0.1),
  // the hand up above and behind the right shoulder, clear of the head and out of the face's way from the front; the
  // club over the shoulder behind
  back: F([-0.44, 1.7, -0.12], [-0.12, 0.95, -0.3], null, LH_BAL, -0.12, -0.4),
  hit: F([-0.1, 1.02, 0.5], [0.05, -0.62, 0.8], null, [0.36, 0.9, 0.02], 0.44, 0.4),
  back2: F([-0.5, 1.2, -0.08], [-0.78, 0.3, -0.5], null, [0.33, 1.05, 0.35], 0, -0.7),
  hit2: F([0.12, 1.16, 0.5], [0.86, 0.05, 0.5], null, [0.42, 0.92, -0.05], 0.2, 0.7),
  throwBack: F([-0.46, 1.52, -0.22], [-0.2, 0.7, -0.6], null, [0.3, 1.25, 0.5], -0.15, -0.7),
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
  throwBack: F([-0.42, 1.58, -0.36], [-0.1, 0.5, -0.8], null, [0.3, 1.25, 0.5], -0.15, -0.7),
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
  if (la && lb) { into.l = a.l! + (b.l! - a.l!) * k; into.lh.copy(la).lerp(lb, k); into.hold = 1; }
  else if (!la && !lb) { into.l = null; into.lh.copy(a.lh).lerp(b.lh, k); into.hold = 0; }
  else {
    // one grips, one does not: the hand travels between the free mark and the shaft, and counts as on the shaft only
    // once it gets there (the last tenth)
    const on = la ? 1 - k : k, mark = la ? b.lh : a.lh, sl = (la ? a.l : b.l)!;
    const at = V().copy(into.g).addScaledVector(into.d, sl);
    into.lh.copy(mark).lerp(at, smooth(on));
    // across the front of the body, not through it: the hand's path bows forward on the way
    into.lh.z += Math.sin(Math.PI * smooth(on)) * 0.16;
    into.l = on > 0.9 ? sl : null; into.hold = smooth(on);
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
  const copy = (f: WFrame) => copyFrame(f, into);
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
    if (k >= 0.3) return mixF(Fr.throwHit, rest, smooth((k - 0.3) / 0.7), into, w);
    // overarm: the hand comes up and over the shoulder on its way forward, not straight through it (from the hand
    // drawn right back the straight line passed through the shoulder); the side-arm stick stays level
    const u = out3(k / 0.3), r = mixF(Fr.throwBack, Fr.throwHit, u, into, w);
    if (w !== 'throwstick') { const lift = Math.sin(Math.PI * u); r.g.y += 0.17 * lift; r.g.x -= 0.07 * lift; }
    return r;
  }
  return copy(rest);
}

// ---------------------------------------------------------------- the body, for keeping things out of it
/** Stacked elliptic cylinders in the body's frame (metres; the coat over both legs is one skirt). The chest and head
 * lean forward with the bend. */
export interface BodyShape { y0: number; y1: number; ax: number; az: number; cz: number; off: number; lean: number; bone: number }
/** Measured on the crew's own skin and clothes (tools: the GLB's body and cloth, |x| < 0.12): the front of the coat is
 * about 0.2 m ahead of the root and the back 0.13 behind, so the middle is 4 cm ahead; the chest bone sits near the
 * back (z -0.05), so the chest's middle is 9 cm ahead of its bone. `cz`: the middle without bones (the tests), `off`:
 * the middle ahead of its bone (in the game). setBodyFit replaces both with what a model's own skin says. */
const BODY0: BodyShape[] = [
  { y0: 0.0, y1: 0.98, ax: 0.2, az: 0.17, cz: 0.035, off: 0.03, lean: 0, bone: 0 },
  // (the chest between the arms: an arm hanging at the side is not in it; the top of it, under the collar bones, is
  // shallower and narrower than the belly and the coat's front)
  { y0: 0.98, y1: 1.32, ax: 0.165, az: 0.17, cz: 0.04, off: 0.09, lean: 0.55, bone: 1 },
  { y0: 1.32, y1: 1.46, ax: 0.15, az: 0.14, cz: 0.005, off: 0.05, lean: 0.75, bone: 1 },
  { y0: 1.46, y1: 1.8, ax: 0.11, az: 0.13, cz: 0.035, off: -0.01, lean: 1, bone: 2 },
];
export const BODY: BodyShape[] = BODY0.map((b) => ({ ...b }));
/** A model's own depth (from its skin, see body.ts fitBody): per shape the middle ahead of its bone and the half depth
 * (metres at the 1.75 m scale); null: the measured defaults. */
export interface BodyFit { off: number; az: number; ax?: number; cz?: number }
export function setBodyFit(fit: BodyFit[] | null) {
  for (let i = 0; i < BODY.length; i++) {
    const f = fit?.[i], b = BODY[i], b0 = BODY0[i];
    b.off = f ? Math.max(-0.08, Math.min(0.18, f.off)) : b0.off; b.az = f ? Math.max(0.1, Math.min(0.26, f.az)) : b0.az;
    b.ax = f?.ax ? Math.max(0.1, Math.min(0.28, f.ax)) : b0.ax; b.cz = f?.cz ?? b0.cz;
  }
}
/** Fit the body's shapes to a body's own skin and clothes at rest: points (root-local at rest, metres) and the rest
 * z of the hips, chest and head bones. Depth for every shape; width only for the coat and the head (between the arms
 * the chest's width cannot be told from the arms that hang beside it). */
export function fitBody(pts: ArrayLike<number>, boneZ: [number, number, number], k: number): BodyFit[] {
  const XL = [0.3, 0.25, 0.2, 0.15], fits: BodyFit[] = [];
  for (let i = 0; i < BODY0.length; i++) {
    const b = BODY0[i], lo = i === 0 ? Math.max(b.y0, 0.55) : b.y0, zs: number[] = [], xs: number[] = [];
    for (let j = 0; j + 2 < pts.length; j += 3) {
      const x = pts[j] / k, y = pts[j + 1] / k, z = pts[j + 2] / k;
      // (the width from the top of the coat, where a hand at the hip meets it, not the flare at the hem)
      if (y >= lo && y < b.y1 && Math.abs(x) < XL[i]) { zs.push(z); if (i !== 0 || y > b.y1 - 0.15) xs.push(Math.abs(x)); }
    }
    if (zs.length < 30 || xs.length < 10) { fits.push({ off: b.off, az: b.az }); continue; }
    zs.sort((a, c) => a - c); xs.sort((a, c) => a - c);
    const zlo = zs[Math.floor(zs.length * 0.02)], zhi = zs[Math.floor(zs.length * 0.98)], cz = (zlo + zhi) / 2;
    fits.push({ off: cz - boneZ[b.bone] / k, az: (zhi - zlo) / 2, cz, ax: i === 0 || i === 3 ? xs[Math.floor(xs.length * 0.98)] : undefined });
  }
  return fits;
}
/** How deep a point is inside the body (>0 inside, in metres, roughly), and the way out (horizontal). */
let BODY_K = 1;
/** Where the body really is this frame (body-local x, z of the hips, the chest and the head), from the rig's bones:
 * the frames were drawn round x = z = 0 and the body's shapes follow these; the lean comes with them. */
const CENTRE = [{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: 0 }]; let LIVE = false;
/** `yaw`: how far each part is turned about the vertical from facing ahead (radians, the twist's way): the chest and
 * the head turn with the chest bone, so a twisted or side-on chest is not checked as if it faced ahead. */
export function setBodyCentres(c: { x: number; z: number; yaw?: number }[] | null) {
  LIVE = !!c; for (let i = 0; i < 3; i++) { CENTRE[i].x = c ? c[i].x : 0; CENTRE[i].z = c ? c[i].z : 0; CENTRE[i].yaw = c ? c[i].yaw ?? 0 : 0; }
}
/** Without live bones (the tests): the chest's turn, from the frame's twist (clearShaft and solveArms set it). */
let TWIST = 0;
export function setBodyTwist(t: number) { TWIST = t; }
/** The body's size against the frames' (a 1.75 m man): the frames and the body shape scale with it. */
/** The chest between the arms is no wider than the shoulder joints allow: an upper arm hanging from a joint at
 * |x| = half (metres, live, half the span between the shoulders) clears it by its own thickness. The shapes' default
 * width (0.165) is not fitted (the arms hang beside it), and the game rig's shoulders in its idle sit at 0.10-0.14:
 * every hanging arm read as 8-10 cm inside the chest. */
export function capChestWidth(half: number) {
  const w = Math.max(0.07, half / BODY_K - 0.055);
  for (const i of [1, 2]) BODY[i].ax = Math.min(BODY[i].ax, w);
}
export function setBodyScale(k: number) { BODY_K = k > 0.5 && k < 1.5 ? k : 1; }
export function bodyScale() { return BODY_K; }
export function depth(pw: THREE.Vector3, bend: number, rw: number, outN?: THREE.Vector3): number {
  return depthN(V().copy(pw).divideScalar(BODY_K), bend, rw / BODY_K, outN) * BODY_K;
}
function depthN(p: THREE.Vector3, bend: number, r: number, outN?: THREE.Vector3): number {
  let best = -9;
  for (let i = 0; i < BODY.length; i++) {
    const b = BODY[i];
    if (p.y < b.y0 - r || p.y > b.y1 + r) continue;
    // live: the bone's own place (it already leans); else the lean from the bend
    // turned with its bone: the middle sits `off` ahead along the part's own front, and the ellipse is read in the
    // part's own frame
    const C = CENTRE[b.bone], yaw = LIVE ? C.yaw : b.bone === 0 ? 0 : TWIST, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fz = LIVE ? b.off : b.cz + Math.sin(bend) * (p.y - 0.95) * b.lean * 0.9;
    const cx = (LIVE ? C.x / BODY_K : 0) + sy * fz, cz = (LIVE ? C.z / BODY_K : 0) + cy * fz;
    const qx = p.x - cx, qz = p.z - cz, lx = qx * cy - qz * sy, lz = qx * sy + qz * cy;
    const ex = b.ax + r, ez = b.az + r, dx = lx / ex, dz = lz / ez, rho = Math.hypot(dx, dz);
    const dpt = (1 - rho) * Math.min(ex, ez);
    if (dpt > best) {
      best = dpt;
      if (outN) { if (rho < 1e-4) outN.set(-cy, 0, sy); else { const nx = dx / rho, nz = dz / rho; outN.set(nx * cy + nz * sy, 0, -nx * sy + nz * cy).normalize(); } }
    }
  }
  return best;
}

/** Push the shaft out of the body: turn it about the grip when the trouble is away from the hand, move the hand when
 * it is the hand. Returns the worst depth left (<= 0 is clear). */
export function clearShaft(f: WFrame, w: WeaponId): number {
  const S = SHAFT[w]; if (!S) return -1;
  setBodyTwist(f.twist);
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
export interface Solved { limbs: Limbs; f: WFrame; eL: THREE.Vector3; wL: THREE.Vector3; eR: THREE.Vector3; wR: THREE.Vector3; lt: THREE.Vector3; rt: THREE.Vector3; missL: number; missR: number; penetration: number; armIn: number }

/** Keep the grip within the right arm's reach: a hand cannot hold what it cannot get to (the spear's low brace asked
 * for a grip 12 cm past the real arm). A two-handed shaft slides through the hand (its line stays); anything else
 * comes in towards the shoulder. */
export function reachGrip(f: WFrame, w: WeaponId, k: Skel) {
  // (with slack: the shoulders the grip is checked against are last frame's, and a walk's bob moves them)
  const maxR = (k.a + k.b + k.palm) * 0.94, toS = V().subVectors(f.g, k.sR), dist = toS.length();
  if (dist <= maxR) return 0;
  if (TWO(w)) {
    const rel = V().subVectors(k.sR, f.g), s0 = rel.dot(f.d), h2 = rel.lengthSq() - s0 * s0;
    if (h2 < maxR * maxR * 0.98) {
      const c = Math.sqrt(maxR * maxR * 0.98 - h2), s = Math.abs(s0 - c) < Math.abs(s0 + c) ? s0 - c : s0 + c;
      // a slide of at most 0.45 m (past that the hold itself is wrong; come in)
      if (Math.abs(s) < 0.45) { f.g.addScaledVector(f.d, s); return dist - maxR; }
    }
  }
  f.g.copy(k.sR).addScaledVector(toS.normalize(), maxR);
  return dist - maxR;
}

/** Arms for a frame: the right hand on the grip, the left on the shaft (or at its free mark), elbows out, the arms kept
 * out of the chest by swinging the elbow further out. */
/** What the arm solve remembers between frames: how far each elbow is swung round its shoulder-to-hand line. */
export interface ArmMem { L: number; R: number; pL?: THREE.Vector3; pR?: THREE.Vector3; /** where along the shaft the front hand last held it, and whether it is letting go from there */ slide?: number; peel?: boolean }
export function solveArms(f: WFrame, w: WeaponId, k: Skel, leftW: number, rightW: number, lPrev: number | null = null, dt = 1 / 60, mem: ArmMem = { L: 0, R: 0 }): Solved {
  setBodyTwist(f.twist);
  reachGrip(f, w, k);
  // a two-handed shaft comes to the front hand: a body with short arms would otherwise have the left hand reach right
  // across its chest to a shaft that passes too far from its left shoulder
  if (TWO(w) && f.hold > 0) {
    const hMax = (k.a + k.b + k.palm) * 0.62;
    for (let it = 0; it < 4; it++) {
      const rel = V().subVectors(k.sL, f.g), s0 = Math.max(0.3, rel.dot(f.d)), perp = rel.addScaledVector(f.d, -rel.dot(f.d)), h = perp.length();
      if (h <= hMax) break;
      f.d.addScaledVector(perp.normalize(), (h - hMax) / s0 * f.hold).normalize();
    }
  }
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
    // (a hand just come on to the shaft starts where it took hold, then slides)
    const from = lPrev ?? f.l, l0 = f.l;
    f.l = from + Math.max(-2.5 * dt, Math.min(2.5 * dt, want - from));
    mem.slide = f.l; mem.peel = true; void l0;
  } else if (f.hold < 0.01) mem.peel = false;
  // a hand letting go leaves from where it really held the shaft (after its slide and the shaft's turn to it), not
  // from the frame's own mark: it peels off as the hold eases away
  const lt = V().copy(f.lh);
  if (f.l === null && mem.peel && mem.slide !== undefined && TWO(w)) lt.lerp(V().copy(f.g).addScaledVector(f.d, mem.slide), smooth(f.hold));
  // taking hold: the hand closes the last of the gap as the (eased) hold comes up, so it never jumps on to the shaft
  if (f.l !== null) lt.lerp(V().copy(f.g).addScaledVector(f.d, f.l), smooth((f.hold - 0.55) / 0.43));
  // a free hand is not reached for: it hangs or guards within an easy reach, so the elbow stays bent (on a body whose
  // shoulders sit higher than the frames', a fixed mark pulled the free arm straight: 12 degrees of bend)
  const easy = (k.a + k.b + k.palm) * 0.92, toL = V().subVectors(lt, k.sL), dL = toL.length(), free = 1 - smooth(f.hold);
  if (dL > easy && free > 0) lt.copy(k.sL).addScaledVector(toL, (dL + (easy - dL) * free) / dL);
  const rt = V().copy(f.g);
  const n = V();
  for (const t of [lt, rt]) { const dp = depth(t, f.bend, 0.05, n); if (dp > 0) t.addScaledVector(n, dp + 0.005); }
  const eL = V(), wL = V(), eR = V(), wR = V();
  const A = k.a, B = k.b + k.palm;
  let armIn = 0;
  const arm = (s: THREE.Vector3, t: THREE.Vector3, side: number, e: THREE.Vector3, wr: THREE.Vector3, key: 'L' | 'R') => {
    // elbow out to the side, down, a little back; if the arm would go through the body, the elbow swings round the
    // shoulder-to-hand line (the hand stays where it is) to the nearest place where the arm is clear
    // the pole leans on where the elbow was last frame (as seen from the shoulder): a hand passing close to the
    // shoulder or along the pole's own line would otherwise flip the elbow to the other side in one frame
    // (elbows hang down and back by the ribs, a little out; out to the side read as wings, and a free left elbow 22 cm
    // out from its shoulder as a hand on the hip. A free arm's elbow goes further back, its forearm forward)
    const freeK = key === 'L' ? 1 - smooth(f.hold) : 0;
    const pk = key === 'L' ? 'pL' : 'pR', prev = mem[pk], across = clamp01((t.x - s.x) * -side / 0.3),
      pole = V(side * (0.32 - 0.16 * freeK + 0.45 * across), -0.75 + 0.2 * freeK, -0.6 - 0.3 * freeK + 0.3 * across);
    // (a hand across the body takes the elbow out round it, as the old wide pole did; by the side it hangs down)
    // a hand drawn back above and behind its shoulder (a spear or stone drawn to throw, the club over the shoulder):
    // the elbow under the hand's line and out to the side, pointing down, not out behind him (the owner: "the right
    // elbow sticking out behind him" with the spear drawn back). Continuous in where the hand is, so no flip.
    if (key === 'R') {
      const over = clamp01((t.y - s.y + 0.02) / 0.12) * clamp01((s.z - t.z) / 0.12);
      if (over > 0) pole.normalize().lerp(V(side * 0.5, -0.85, 0.22).normalize(), over);
    }
    if (prev) pole.normalize().addScaledVector(prev, key === "L" ? 2.2 - 1.6 * freeK : 2.2);
    const miss = reach2(s, t, A, B, pole, e, wr);
    // the pole is remembered without the swing (the swing is kept on its own)
    { const ax = V().subVectors(wr, s).normalize(), c = V().copy(s).addScaledVector(ax, V().subVectors(e, s).dot(ax)); (mem[pk] ??= V()).copy(e).sub(c).normalize(); }
    armIn = Math.max(armIn, swingOut(s, e, wr, f.bend, mem, key, dt));
    return miss;
  };
  const missR = arm(k.sR, rt, -1, eR, wR, 'R'), missL = arm(k.sL, lt, 1, eL, wL, 'L');
  // the wrist is the palm's length short of the hand target: the bone handed to the rig is the forearm to the wrist
  const wristR = V().copy(eR).lerp(wR, k.b / B), wristL = V().copy(eL).lerp(wL, k.b / B);
  const dir = (a: THREE.Vector3, b: THREE.Vector3): Dir => { const d = V().subVectors(a, b).normalize(); return [d.x, d.y, d.z]; };
  const limbs: Limbs = { bend: f.bend, twist: f.twist };
  if (rightW > 0) { limbs.armR = dir(eR, k.sR); limbs.foreR = dir(wristR, eR); }
  if (leftW > 0) { limbs.armL = dir(eL, k.sL); limbs.foreL = dir(wristL, eL); }
  return { limbs, f, eL, wL, eR, wR, lt, rt, missL, missR, penetration, armIn };
}

/** Swing an elbow round its shoulder-to-hand line (the hand stays put) to the nearest place where the upper arm and
 * forearm are out of the body; the swing is remembered in `mem` and changes at most 10 rad/s, so the elbow never jumps
 * from one way out to another, and drifts back to the plain pose when that is clear. Returns how deep the arm still
 * is (metres, <= 0 clear). Moves `e`. */
export function swingOut(s: THREE.Vector3, e: THREE.Vector3, wr: THREE.Vector3, bend: number, mem: ArmMem, key: 'L' | 'R', dt: number, handEnd = 1): number {
  const inside = (el: THREE.Vector3) => {
    let worst = 0;
    for (let i = 1; i <= 6; i++) {
      const q = i <= 3 ? V().copy(s).lerp(el, 0.35 + i * 0.2) : V().copy(el).lerp(wr, (i - 3) / 3 * handEnd);
      worst = Math.max(worst, depth(q, bend, 0.04));
    }
    return worst;
  };
  const ax = V().subVectors(wr, s); if (ax.lengthSq() < 1e-8) return inside(e); ax.normalize();
  const c = V().copy(s).addScaledVector(ax, V().subVectors(e, s).dot(ax)), r0 = V().subVectors(e, c);
  const at = (a: number) => V().copy(c).add(V().copy(r0).applyAxisAngle(ax, a));
  const a0 = mem[key], cost = (a: number) => {
    const el = at(a);
    // an elbow up and in front of the face is no way out: prefer swings that keep it below the shoulder
    // (the pull home must outweigh the stickiness: with them the other way round an elbow once swung out never came back,
    // and a free arm stayed out at the side after a spear hold: "sticks straight out")
    return inside(el) * 10 + Math.max(0, el.y - s.y - 0.05) * 2 + Math.abs(a - a0) * 0.003 + Math.abs(a) * 0.01;
  };
  let bestA = a0, best = cost(a0);
  for (let j = -14; j <= 14; j++) { const a = j * 0.13; const cs = cost(a); if (cs < best - 1e-5) { best = cs; bestA = a; } }
  const step = 10 * dt, aNew = a0 + Math.max(-step, Math.min(step, bestA - a0));
  mem[key] = aNew; e.copy(at(aNew));
  return inside(e);
}

/** A frame's smoothed copy: follows the target with a time constant (seconds), directions turned, not snapped. */
export function follow(cur: WFrame, tgt: WFrame, dt: number, tau = 0.04, maxTurn = 24) {
  const k = 1 - Math.exp(-dt / tau);
  cur.g.lerp(tgt.g, k);
  cur.lh.lerp(tgt.lh, k);
  // the shaft turns towards its target, at most maxTurn radians a second (a cancelled blow swings back, not snaps)
  const ang = cur.d.angleTo(tgt.d), step = Math.min(ang * k, maxTurn * dt);
  if (ang > 1e-5) {
    const ax = V().crossVectors(cur.d, tgt.d);
    if (ax.lengthSq() < 1e-10) ax.set(0, 1, 0).cross(cur.d).lengthSq() < 1e-8 ? ax.set(1, 0, 0) : ax.set(0, 1, 0).cross(cur.d);
    cur.d.applyAxisAngle(ax.normalize(), step).normalize();
  }
  cur.l = tgt.l === null ? null : cur.l === null ? tgt.l : cur.l + (tgt.l - cur.l) * k;
  cur.bend += (tgt.bend - cur.bend) * k; cur.twist += (tgt.twist - cur.twist) * k; cur.hold += (tgt.hold - cur.hold) * k;
}
export function newFrame(): WFrame { return { g: V(), d: V(0, 0, 1), l: null, lh: V(), bend: 0, twist: 0, hold: 0 }; }
export function copyFrame(a: WFrame, into: WFrame) { into.g.copy(a.g); into.d.copy(a.d); into.l = a.l; into.lh.copy(a.lh); into.bend = a.bend; into.twist = a.twist; into.hold = a.hold; return into; }

/** Turn a bone so its child lands on `to` (world), by weight w. */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, to: THREE.Vector3, w: number) {
  const bp = bone.getWorldPosition(new THREE.Vector3()), cp = child.getWorldPosition(new THREE.Vector3());
  const from = cp.sub(bp), dir = to.clone().sub(bp);
  if (from.lengthSq() < 1e-10 || dir.lengthSq() < 1e-10 || !bone.parent) return;
  const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), dir.normalize());
  if (w < 1) q.copy(new THREE.Quaternion().slerp(q, w));
  const bw = bone.getWorldQuaternion(new THREE.Quaternion()), pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pw.invert().multiply(q.multiply(bw)));
  bone.updateWorldMatrix(false, true);
}
