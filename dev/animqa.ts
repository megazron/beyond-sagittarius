// Dev-only: the animation QA probe (tools/anim_qa.py drives it through dev/chars.html). One body runs one scenario (a
// clip, a task with its prop, a hold on a spear or a stone, an extreme joint range) from a settled stand, and every
// frame is measured the way a viewer would see it go wrong:
//   armPen   how far a hand, a finger, the forearm or the elbow goes inside the torso as the rig's guards see it
//            (Character.torsoDepth: an elliptic section per segment, measured from this body's skin and clothes), cm;
//            handPen is the hand and fingers only
//   meshIn   the same points against the torso's skinned surface itself (skin and cloth hips to neck), cm: the truth
//            the guards' shapes approximate
//   jerk     the largest one-frame change of velocity of an elbow, a wrist or a fingertip (second difference at 30 fps),
//            cm: smooth mocap moves a few cm; "all of a sudden the arms are somewhere else" is tens
//   holdErr  how far a hand is from what it holds, cm, once the hold has had 0.6 s to take: the wrist against its target
//            or, for a grasp, against where the palm closes on the thing; a prop on the hand, its middle against the target
//   propGap  how far a prop on the hand (a stone, a cup) sits from the palm, cm
//   mouth    eating and drinking: how near the bread or the cup comes to the lips, cm (the closest over the task)
//   flags    the play capture's own pixel passes (dev/chars.ts poke): skin out through cloth, an inner garment out
//            through an outer one, skin seen from behind; summed over the sampled views
import * as THREE from 'three';
import { graspWrist } from '../src/characters/character';
import type { Character, CrewPose, TaskKind, PropKind, Limbs } from '../src/characters/character';
import { bone, TORSO } from './qa_lib';

type Ctx = { c: Character; k: number; dt: number; P: (x: number, y: number, z: number) => THREE.Vector3; D: (x: number, y: number, z: number) => THREE.Vector3 };
type HoldSide = { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; radius?: number; grasp?: boolean };
interface Scenario {
  name: string; pose?: CrewPose; v?: number; w?: number; sec?: number;
  /** measured hold: every frame the targets the hands should be on (body space is turned into world by P/D) */
  hold?: (x: Ctx) => { L?: HoldSide; R?: HoldSide } | null;
  /** a hold that cannot be met on purpose (out of reach, inside the chest): holdErr is reported, not gated */
  holdFree?: boolean;
  setup?: (x: Ctx) => void; frame?: (x: Ctx) => void;
  /** only the six crew (the townsfolk run the short list) */
  crewOnly?: boolean;
}
// body space: x to the body's left, y up, z forward (the rig faces +z; its right hand is at -x)
const side = (s: 'L' | 'R') => (s === 'L' ? 1 : -1);
const grip = (x: Ctx, at: [number, number, number], fingers: [number, number, number], palm: [number, number, number], radius = 0.02): HoldSide =>
  ({ at: x.P(...at), fingers: x.D(...fingers).normalize(), palm: x.D(...palm).normalize(), radius });
// a thing in the hand: `at` is its middle (a stone's centre, the shaft's axis at this hand), the palm closes on it
const item = (x: Ctx, at: [number, number, number], fingers: [number, number, number], palm: [number, number, number], radius: number): HoldSide =>
  ({ ...grip(x, at, fingers, palm, radius), grasp: true });
// a spear: the butt low behind the right hip, the shaft up and forward; the hands on it 0.35 m apart
const spear = (x: Ctx, push: number, lift = 0) => {
  // the right hand low by the right hip, the left in front of the left chest; the shaft through both, its point ahead
  const r = new THREE.Vector3(-0.15, 0.95 + lift, 0.18 + push), l = new THREE.Vector3(0.02, 1.12 + lift, 0.38 + push);
  const f = l.clone().sub(r).normalize().toArray() as [number, number, number];
  return { R: item(x, r.toArray() as [number, number, number], f, [0, -1, 0], 0.015), L: item(x, l.toArray() as [number, number, number], f, [0, -1, 0], 0.015) };
};
const ease = (a: number) => a * a * (3 - 2 * a);
const tri = (s: number) => 1 - Math.abs(((s % 1) + 1) % 1 * 2 - 1);

const CLIPS: Scenario[] = [
  { name: 'stand' }, { name: 'idle', pose: 'idle', sec: 3 },
  { name: 'walk', v: 1.4 }, { name: 'run', v: 3.6 }, { name: 'sprint', v: 5.2, crewOnly: true }, { name: 'turn', v: 0.9, w: 2.2 },
  { name: 'limp', v: 1.0, setup: (x) => x.c.setLimp(true), crewOnly: true },
  { name: 'crouch', pose: 'crouch' as CrewPose }, { name: 'sit', pose: 'sit' },
  { name: 'kneel', setup: (x) => x.c.setKneel(true) }, { name: 'kneel_heels', setup: (x) => x.c.setKneel(true, true), crewOnly: true },
  ...(['injured', 'lie', 'wave', 'point', 'cheer', 'shout', 'argue', 'present', 'write', 'facepalm', 'selfie', 'jump', 'swim'] as CrewPose[]).map((p) => ({ name: p, pose: p, crewOnly: !['wave', 'point', 'argue', 'cheer'].includes(p) })),
];
const TASKS: Scenario[] = ([
  ['pickup', [0.05, 0.04, 0.42]], ['putdown', [0.05, 0.04, 0.42]], ['throw', null], ['plant', [0, 0.02, 0.45]], ['use', [0, 0.95, 0.42]], ['fix', [0, 0.5, 0.45]], ['open', [-0.15, 1.0, 0.5]],
  ['give', [0, 1.1, 0.55]], ['type', [0, 1.0, 0.35]], ['eat', null], ['drink', null], ['carry', null], ['gesture', null], ['phone', null],
] as [TaskKind, [number, number, number] | null][]).map(([kind, at]) => ({
  name: `task_${kind}`, sec: 3, crewOnly: !['pickup', 'eat', 'drink', 'carry'].includes(kind),
  setup: (x: Ctx) => x.c.doTask(kind, { at: at ? x.P(...at) : null, seconds: 2.4 }),
}));
const COMBOS: Scenario[] = [
  { name: 'walk_carry_box', v: 1.2, sec: 3, setup: (x) => x.c.doTask('carry', { seconds: 2.8 }) },
  { name: 'kneel_pickup_stone', sec: 3, setup: (x) => { x.c.setKneel(true); }, frame: (x) => { if (x.k === 25) x.c.doTask('pickup', { at: x.P(-0.1, 0.03, 0.4), prop: 'stone', seconds: 1.6 }); } },
  { name: 'kneel_use_stone', sec: 3, setup: (x) => { x.c.setKneel(true); }, frame: (x) => { if (x.k === 25) x.c.doTask('use', { at: x.P(0, 0.25, 0.4), prop: 'stone', seconds: 1.8 }); }, crewOnly: true },
  { name: 'sit_eat', pose: 'sit', sec: 3, setup: (x) => x.c.doTask('eat', { seconds: 2.6 }) },
  { name: 'sit_drink', pose: 'sit', sec: 3, setup: (x) => x.c.doTask('drink', { seconds: 2.4 }), crewOnly: true },
  { name: 'walk_berry', v: 1.2, setup: (x) => x.c.setProp('berry'), crewOnly: true },
  { name: 'walk_leafcup', v: 1.0, setup: (x) => x.c.setProp('leaf') },
];
const HOLDS: Scenario[] = [
  { name: 'spear_guard', sec: 3, hold: (x) => spear(x, 0) },
  { name: 'spear_thrust', sec: 3, hold: (x) => spear(x, 0.25 * ease(tri(x.k * x.dt * 0.9))) },
  { name: 'spear_walk', v: 1.3, sec: 3, hold: (x) => spear(x, 0, 0.02 * Math.sin(x.k * 0.4)) },
  { name: 'spear_run', v: 3.4, sec: 2, hold: (x) => spear(x, 0, 0.03 * Math.sin(x.k * 0.6)), crewOnly: true },
  { name: 'stone_carry_walk', v: 1.3, sec: 3, setup: (x) => x.c.setProp('stone'), hold: (x) => ({ R: item(x, [-0.18, 1.1, 0.26], [0.3, 0, 1], [0, 1, 0], 0.035) }) },
  { name: 'stone_chest_2h', v: 1.0, sec: 3, hold: (x) => ({ R: item(x, [0, 1.08, 0.33], [0.2, 0.3, 1], [1, 0.2, 0], 0.06), L: item(x, [0, 1.08, 0.33], [-0.2, 0.3, 1], [-1, 0.2, 0], 0.06) }) },
  { name: 'stone_knap', sec: 3, setup: (x) => { x.c.setKneel(true); x.c.setProp('stone'); },
    hold: (x) => ({ R: item(x, [-0.06, 0.48 + 0.14 * ease(tri(x.k * x.dt * 2.5)), 0.47], [0.4, -0.6, 1], [0, -1, 0], 0.035), L: item(x, [0.06, 0.46, 0.45], [-0.2, 0, 1], [0, 1, 0], 0.04) }) },
  { name: 'drill', sec: 3, setup: (x) => x.c.setKneel(true), crewOnly: true,
    hold: (x) => { const r = 0.05 * Math.sin(x.k * x.dt * Math.PI * 2 * 2.2); return { R: item(x, [r, 0.55, 0.4 - r * 0.3], [0, 0, 1], [1, 0, 0], 0.01), L: item(x, [r, 0.55, 0.4 + r * 0.3], [0, 0, 1], [-1, 0, 0], 0.01) }; } },
  // Episode Two's work holds (src/game/episode2.ts), sat back on the heels (settleWork), the same targets in body space
  // (his right is -x here): the vine that parts, the finished cord, bark split on the palm, the bow drill, coils of clay,
  // the lump of clay, resin stirred with a twig; standing, the hafted spear held and thrust
  { name: 'e2_vine', sec: 2.4, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => { const a = Math.min(1, Math.max(0, x.k * x.dt - 1.4) / 0.4) * 0.15; return { L: item(x, [0.2 + a, 0.5, 0.34], [0, 0, 1], [-1, 0, 0], 0.008), R: item(x, [-0.2 - a, 0.5, 0.34], [0, 0, 1], [1, 0, 0], 0.008) }; } },
  { name: 'e2_cord', sec: 2, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => ({ L: item(x, [0.25, 0.52, 0.34], [0, 0, 1], [-1, 0, 0], 0.01), R: item(x, [-0.25, 0.52, 0.34], [0, 0, 1], [1, 0, 0], 0.01) }) },
  { name: 'e2_bark', sec: 2.5, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => { const w = Math.sin(x.k * x.dt * 3) * 0.06; return { L: item(x, [0.15, 0.5, 0.42], [-1, 0, 0], [0, 1, 0], 0.004), R: item(x, [-0.12 - w, 0.5, 0.42], [1, 0, 0], [0, -1, 0], 0.004) }; } },
  { name: 'e2_bowdrill', sec: 3, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => { const w = Math.sin(x.k * x.dt * 5.5) * 0.18; return { L: item(x, [0, 0.37, 0.42], [0, 0, 1], [0, -1, 0], 0.03), R: item(x, [-(0.2 + w), 0.16, 0.4], [1, 0, 0], [0, 0, -1], 0.008) }; } },
  { name: 'e2_coil', sec: 3, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => { const t = x.k * x.dt, y = 0.04 + 0.2 * Math.min(1, 0.1 + t / 3); return { L: grip(x, [0.1, y, 0.42], [0, 0, 1], [-1, 0, 0], 0.01), R: grip(x, [-0.1, y, 0.42 + Math.sin(t * 6) * 0.02], [0, 0, 1], [1, 0, 0], 0.01) }; } },
  { name: 'e2_clay', sec: 2, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => ({ L: grip(x, [0.05, 0.52, 0.34], [0, 0, 1], [0, 1, 0], 0.05), R: grip(x, [-0.05, 0.58, 0.34], [0, 0, 1], [0, -1, 0], 0.05) }) },
  { name: 'e2_resin', sec: 3, setup: (x) => x.c.setKneel(true, true), crewOnly: true, hold: (x) => { const t = x.k * x.dt; return { R: item(x, [Math.cos(t * 4) * 0.025, 0.305, 0.37 + Math.sin(t * 4) * 0.025], [0, -1, 0.2], [1, 0, 0], 0.004) }; } },
  { name: 'e2_haft', sec: 3, crewOnly: true, hold: (x) => {
    // the butt by the right hip, level, then a short thrust down at a log 1.25 m out (episode2.ts haft)
    const t = x.k * x.dt, a = Math.min(1, t / 1.0), th = t < 1.5 ? 0 : Math.min(1, (t - 1.5) / 0.18);
    const lv = new THREE.Vector3(0, -0.03, 1).normalize(), butt = new THREE.Vector3(-0.15, 1.1, 0), aim = new THREE.Vector3(0, 0.24, 1.25).sub(butt).normalize();
    const dir = lv.clone().lerp(aim, a).normalize(), b = butt.clone().addScaledVector(dir, -0.1 * a + 0.22 * th);
    const rgt = new THREE.Vector3(-1, 0, 0), palm = dir.clone().cross(rgt).normalize();
    const at = (k: number) => b.clone().addScaledVector(dir, k).toArray() as [number, number, number];
    return { R: item(x, at(0.3), [1, 0, 0], palm.toArray() as [number, number, number], 0.02), L: item(x, at(0.58), [-1, 0, 0], palm.clone().negate().toArray() as [number, number, number], 0.02) };
  } },
  { name: 'throw_over', sec: 2.4, crewOnly: true, hold: (x) => {
    // wind back over the shoulder for 0.8 s, then forward and down in 0.25 s, then let go
    const s = x.k * x.dt; if (s > 1.3) return null;
    const back: [number, number, number] = [-0.26, 1.6, -0.12], fwd: [number, number, number] = [-0.14, 1.28, 0.42];
    const a = s < 0.8 ? ease(s / 0.8) : 1 - ease(Math.min(1, (s - 0.8) / 0.25));
    const p = back.map((b, i) => fwd[i] + (b - fwd[i]) * a) as [number, number, number];
    return { R: item(x, p, [0, 0.3, 1], [0, -1, 0], 0.035) };
  } },
  { name: 'reach_far', holdFree: true, crewOnly: true, hold: (x) => ({ R: grip(x, [-0.25, 1.2, 1.1], [0, 0, 1], [0, -1, 0]) }) },
  { name: 'reach_inside', holdFree: true, hold: (x) => ({ R: grip(x, [0, 1.15, 0.02], [1, 0, 0], [0, 0, -1]) }) },
  { name: 'reach_across', hold: (x) => ({ R: grip(x, [0.06, 1.08, 0.3], [1, -0.3, 0.3], [0, 0, -1]) }) },
  // a new target 40 cm away in one frame (a scene step): the hand must travel, not teleport
  { name: 'hold_jump', holdFree: true, sec: 3, hold: (x) => ({ R: grip(x, x.k < 40 ? [-0.25, 0.95, 0.35] : [-0.05, 1.3, 0.45], [0, 0, 1], [0, -1, 0]) }) },
];
const L = (o: Limbs) => (x: Ctx) => x.c.setLimbs(o);
const EXTREMES: Scenario[] = [
  { name: 'x_arms_up', setup: L({ armL: [0.1, 1, 0], armR: [-0.1, 1, 0], foreL: [0, 1, 0.1], foreR: [0, 1, 0.1] }) },
  { name: 'x_arms_across', setup: L({ armL: [-0.7, -0.3, 0.6], armR: [0.7, -0.3, 0.6], foreL: [-1, 0.2, 0.2], foreR: [1, 0.2, 0.2] }) },
  { name: 'x_arms_back', setup: L({ armL: [0.3, -0.6, -1], armR: [-0.3, -0.6, -1] }), crewOnly: true },
  { name: 'x_arms_out', setup: L({ armL: [1, 0, 0], armR: [-1, 0, 0], openHands: true }), crewOnly: true },
  { name: 'x_bend_twist', setup: L({ bend: 1, twist: 1 }) },
  { name: 'x_kick', setup: L({ legR: [0, -0.1, 1], shinR: [0, -0.3, 1] }), crewOnly: true },
  { name: 'x_squat', setup: L({ legL: [0.1, -0.2, 1], legR: [-0.1, -0.2, 1], shinL: [0, -1, -0.3], shinR: [0, -1, -0.3], bend: 0.6 }), crewOnly: true },
];
// (Nuvexa's own phone rides her hand too, now as its own mesh: it is not the scenario's prop)
const propMid = (c: Character) => {
  for (const ch of c.root.getObjectByName('handR')!.children) { const m = ch as THREE.Mesh; if (!m.isMesh || m.name === 'ownPhone') continue; m.geometry.computeBoundingSphere(); return m.geometry.boundingSphere!.center.clone().applyMatrix4(m.matrixWorld); }
  return null;
};
/** What the hands of the running scenario are told to hold this frame (dev/chars.ts qaLive draws it). */
export const live: { hold: { L?: HoldSide; R?: HoldSide } | null; name: string } = { hold: null, name: '' };
export const SCENARIOS: Scenario[] = [...CLIPS, ...TASKS, ...COMBOS, ...HOLDS, ...EXTREMES];

// the torso as drawn: body skin and clothes whose main bone is hips to neck (every second vertex), for a penetration
// measured against the surface itself; the capsules are round and the hips are not (a hand passing in front of the
// hip read 6 to 14 cm "inside" a capsule whose radius mixes the hip's width with its depth)
const torsoVerts = new WeakMap<Character, { m: THREE.SkinnedMesh; idx: number[] }[]>();
const TB = new Set(['hips', 'spine', 'spine1', 'chest', 'neck']);
function surfaceOf(c: Character) {
  let t = torsoVerts.get(c);
  if (!t) {
    t = [];
    c.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh; if (!m.isSkinnedMesh || !(m.name.startsWith('skin_body') || m.name === 'cloth')) return;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, idx: number[] = [];
      for (let i = 0; i < si.count; i += 2) { let b = 0, w = -1; for (let j = 0; j < 4; j++) { const wj = sw.getComponent(i, j); if (wj > w) { w = wj; b = si.getComponent(i, j); } } if (TB.has(m.skeleton.bones[b]?.name)) idx.push(i); }
      t!.push({ m, idx });
    });
    torsoVerts.set(c, t);
  }
  const out: number[] = [], V = new THREE.Vector3();
  for (const { m, idx } of t) for (const i of idx) { m.getVertexPosition(i, V); V.applyMatrix4(m.matrixWorld); out.push(V.x, V.y, V.z); }
  return out;
}
/** How far p is inside the torso surface: the nearest surface point within 20 cm, its outward direction taken from the
 * torso's bone line; negative outside. */
function meshPen(p: THREE.Vector3, S: number[], segs: (readonly [THREE.Vector3, THREE.Vector3])[]) {
  let best = 0.2 * 0.2, k = -1;
  for (let i = 0; i < S.length; i += 3) { const d = (S[i] - p.x) ** 2 + (S[i + 1] - p.y) ** 2 + (S[i + 2] - p.z) ** 2; if (d < best) { best = d; k = i; } }
  if (k < 0) return -1;
  const v = new THREE.Vector3(S[k], S[k + 1], S[k + 2]);
  let bd = 9, ax = v;
  for (const [a, b] of segs) { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, v.clone().sub(a).dot(ab) / ab.lengthSq())), q = a.clone().addScaledVector(ab, t), d = q.distanceTo(v); if (d < bd) { bd = d; ax = q; } }
  const n = v.clone().sub(ax); if (n.lengthSq() < 1e-8) return -1; n.normalize();
  // only straight in from that surface point: a fingertip below a flared hem has the hem above it, not round it
  const dv = v.sub(p), along = dv.dot(n);
  if (dv.addScaledVector(n, -along).length() > 0.03) return -1;
  return along;
}
const R0 = (c: Character) => { c.root.updateMatrixWorld(true); return c.root; };
const PTS = (s: 'L' | 'R') => [`hand${s}`, `finger3_2${s}`, `finger2_3${s}`, `lowerarm${s}`];

export interface QaHooks {
  /** one frame of the body: advance the clock and animate */
  step: (c: Character, pose: CrewPose, amount: number, dt: number) => void;
  /** pixel flags over the views the probe samples, summed */
  flags: (() => { skinPoke: number; clothPoke: number; back: number }) | null;
  settle: (c: Character) => void;
}
/** sampleEvery > 0 also records every bone's local turn every that many frames (tools/chars/capture_poses.py: the builder's
 * coverage mask and corrective shapes learn every pose the probe plays, not six clips) */
export function runScenario(c: Character, name: string, h: QaHooks, every = 10, sampleEvery = 0) {
  const g = scenarioFrames(c, name, h, every, sampleEvery); let r = g.next(); while (!r.done) r = g.next(); return r.value;
}
/** The same, one frame per next() (dev/chars.ts qaLive draws each frame on the GPU for the review clips). */
export function* scenarioFrames(c: Character, name: string, h: QaHooks, every = 10, sampleEvery = 0) {
  const sc = SCENARIOS.find((s) => s.name === name); if (!sc) throw new Error(`no scenario ${name}`);
  const dt = 1 / 30, frames = Math.round((sc.sec ?? 2) * 30);
  // a clean start: everything let go, the stand settled, the body at the origin facing +z
  c.setLimbs(null); c.setHold(null); c.stopTask(); c.setProp(null); c.setKneel(false); c.setLimp(false); c.setFace(null); c.setLookTarget(null);
  h.settle(c);
  // body space is in a 1.76 m body's metres: scaled by this body's neck height (1.57 m to 2.08 m), so a target is as
  // far from every body's shoulder
  const S = R0(c).worldToLocal(bone(c, 'neck')).y / 1.47;
  const R = c.root, x: Ctx = { c, k: 0, dt, P: (a, b, d) => R.localToWorld(new THREE.Vector3(a * S, b * S, d * S)), D: (a, b, d) => new THREE.Vector3(a, b, d).applyQuaternion(R.getWorldQuaternion(new THREE.Quaternion())) };
  sc.setup?.(x);
  const tracks = new Map<string, THREE.Vector3[]>();
  let reach = 0, armPen = 0, handPen = 0, penAt = '', jerk = 0, jerkAt = '', holdErr = 0, holdAt = '', propGap = 0, propAt = '', holdStart = -1;
  const holdErrs: number[] = [], holdK: string[] = []; let meshIn = 0, meshAt = ''; let mouth = Infinity, mouthAt = ''; let lastHold: { L?: HoldSide; R?: HoldSide } | null = null;
  const poses: { pose: string; q: Record<string, number[]> }[] = [];
  const fl = { skinPoke: 0, clothPoke: 0, back: 0, samples: 0, worst: 0, worstK: -1 };
  for (let k = 0; k < frames; k++) {
    x.k = k;
    // the body moves first and the hands are given this frame's targets (given before, they were a frame behind: 4 cm
    // at a walk)
    if (sc.w) R.rotation.y += sc.w * dt;
    if (sc.v) { R.position.x += Math.sin(R.rotation.y) * sc.v * dt; R.position.z += Math.cos(R.rotation.y) * sc.v * dt; }
    R.updateMatrixWorld(true);
    const hold = sc.hold ? sc.hold(x) : null;
    // the hold's targets are live points: the same objects are handed back each frame, moved (as the scenes do)
    if (hold) {
      if (!lastHold || !!lastHold.L !== !!hold.L || !!lastHold.R !== !!hold.R) { lastHold = hold; c.setHold(hold); if (holdStart < 0) holdStart = k; }
      else for (const s of ['L', 'R'] as const) if (hold[s] && lastHold[s]) { lastHold[s]!.at.copy(hold[s]!.at); lastHold[s]!.fingers.copy(hold[s]!.fingers); lastHold[s]!.palm.copy(hold[s]!.palm); }
    } else if (lastHold) { c.setHold(null); lastHold = null; }
    sc.frame?.(x);
    live.hold = lastHold; live.name = name;
    h.step(c, sc.pose ?? 'stand', (sc.v ?? 0) / 4, dt);
    R.updateMatrixWorld(true);
    // arms into the torso
    const segs = TORSO.map(([a, b]) => [bone(c, a), bone(c, b)] as const);
    const surf = k % 2 === 0 ? surfaceOf(c) : null;
    for (const s of ['L', 'R'] as const) {
      const pts = PTS(s).map((n) => [n, bone(c, n)] as const);
      pts.push(['forearm' + s, pts[3][1].clone().lerp(pts[0][1], 0.5)]);
      // the rig's own torso shapes (Character.torsoDepth: elliptic, as keepArmsOut, holdOut and forearmOut see it)
      for (const [n, p] of pts) {
        const pen = c.torsoDepth(p) ?? -1;
        if (pen > armPen) { armPen = pen; penAt = `${n} f${k}`; }
        if (n.startsWith('hand') || n.startsWith('finger')) handPen = Math.max(handPen, pen);
      }
      if (surf) for (const [n, p] of pts) { const mp = meshPen(p, surf, segs); if (mp > meshIn) { meshIn = mp; meshAt = `${n} f${k}`; } }
      // the joints' paths: a one-frame change of velocity
      for (const [n, p] of pts) {
        const tr = tracks.get(n) ?? tracks.set(n, []).get(n)!; tr.push(p.clone());
        if (tr.length >= 3) { const a = tr[tr.length - 1], b = tr[tr.length - 2], d = tr[tr.length - 3]; const j = Math.hypot(a.x - 2 * b.x + d.x, a.y - 2 * b.y + d.y, a.z - 2 * b.z + d.z); if (j > jerk) { jerk = j; jerkAt = `${n} f${k}`; } }
      }
      // the hand on what it holds
      const hs = lastHold?.[s];
      if (hs && holdStart >= 0 && k - holdStart >= ((globalThis as { __qaFrom?: number }).__qaFrom ?? 18)) {
        // a grasp: the wrist against where it must be for the palm to close on the thing
        const goal = hs.grasp ? graspWrist(new THREE.Vector3(), hs.at, hs.fingers, hs.palm, hs.radius ?? 0.02, bone(c, `hand${s}`).distanceTo(bone(c, `finger3_1${s}`))) : hs.at;
        // a prop on the hand (a stone): its middle against the target, which is what is seen
        const pm = hs.grasp && s === 'R' ? propMid(c) : null;
        const e = pm ? pm.distanceTo(hs.at) : bone(c, `hand${s}`).distanceTo(goal); holdErrs.push(e);
        holdK.push(`${s}${k}:${(e * 100).toFixed(1)}`);
        // how far the target is, as a share of the arm's length: over 0.97 the arm cannot get there (the scenario's
        // fault, or a scene's), and the error says nothing about the rig
        const sh = bone(c, `upperarm${s}`), el = bone(c, `lowerarm${s}`), wr = bone(c, `hand${s}`);
        reach = Math.max(reach, sh.distanceTo(goal) / (sh.distanceTo(el) + el.distanceTo(wr)));
        if (e > holdErr) { holdErr = e; holdAt = `${s} f${k}`; }
      }
    }
    // a prop on the hand: its middle to the palm's (between the wrist and the middle finger's root, a little palm-side)
    const hr = c.root.getObjectByName('handR')!;
    for (const ch of hr.children) {
      const m = ch as THREE.Mesh; if (!m.isMesh) continue;
      m.geometry.computeBoundingSphere(); const mid = m.geometry.boundingSphere!.center.clone().applyMatrix4(m.matrixWorld);
      const palm = bone(c, 'handR').lerp(bone(c, 'finger3_1R'), 0.55);
      // a flat thing (the bread, pinched at its edge with most of it out past the fingers) from its nearest point: from its
      // middle it read 7 to 8 cm off a palm it touches
      m.geometry.computeBoundingBox(); const bx = m.geometry.boundingBox!.getSize(new THREE.Vector3());
      // (its radius as drawn: a cup is scaled to the hand that holds it, character.ts cupScale)
      let g = Math.max(0, mid.distanceTo(palm) - m.geometry.boundingSphere!.radius * m.matrixWorld.getMaxScaleOnAxis() * 0.6);
      if (Math.min(bx.x, bx.y, bx.z) < 0.25 * Math.max(bx.x, bx.y, bx.z) && m.geometry.type === 'CylinderGeometry') {
        const pa = m.geometry.attributes.position, V = new THREE.Vector3(); let near = Infinity;
        for (let i = 0; i < pa.count; i++) near = Math.min(near, V.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld).distanceTo(palm));
        g = Math.min(g, Math.max(0, near - 0.02));
      }
      if (g > propGap) { propGap = g; propAt = `f${k}`; }
    }
    // eating and drinking: how near the bread or the cup comes to the lips (its nearest vertex), the closest over the task
    if (/eat|drink/.test(name)) {
      const lp = c.lipsAt(new THREE.Vector3()), V = new THREE.Vector3();
      for (const ch of hr.children) {
        const m = ch as THREE.Mesh; if (!m.isMesh) continue; const pa = m.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) { const dd = V.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld).distanceTo(lp); if (dd < mouth) { mouth = dd; mouthAt = `f${k}`; } }
      }
    }
    if (sampleEvery > 0 && k >= 10 && (k - 10) % sampleEvery === 0) {
      const q: Record<string, number[]> = {}; R.traverse((o) => { if ((o as THREE.Bone).isBone) q[o.name] = [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map((v) => Math.round(v * 1e4) / 1e4); });
      poses.push({ pose: name, q });
    }
    if (h.flags && k % every === every - 1) {
      const f = h.flags(); fl.skinPoke += f.skinPoke; fl.clothPoke += f.clothPoke; fl.back += f.back; fl.samples++;
      const s = f.skinPoke + f.clothPoke; if (s > fl.worst) { fl.worst = s; fl.worstK = k; }
    }
    yield k;
  }
  c.setLimbs(null); c.setHold(null); c.stopTask(); c.setProp(null); c.setKneel(false); c.setLimp(false);
  holdErrs.sort((a, b) => a - b);
  const cm = (v: number) => +(v * 100).toFixed(1);
  return {
    scenario: name, armPenCm: cm(Math.max(0, armPen)), handPenCm: cm(Math.max(0, handPen)), penAt, jerkCm: cm(jerk), jerkAt,
    holdErrCm: cm(holdErr), holdP50Cm: cm(holdErrs[holdErrs.length >> 1] ?? 0), holdAt, holdFree: !!sc.holdFree, reach: +reach.toFixed(2), propGapCm: cm(propGap), propAt, flags: fl, poses, holdK, meshInCm: cm(meshIn), meshAt, mouthCm: Number.isFinite(mouth) ? cm(mouth) : 0, mouthAt,
  };
}
export const scenarioNames = (crew: boolean) => SCENARIOS.filter((s) => crew || !s.crewOnly).map((s) => s.name);
void side; void ({} as PropKind);
