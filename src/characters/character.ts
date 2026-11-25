import * as THREE from 'three';
import { redFruitMesh } from '../world/fruit';
import { fillSmallHoles, fixOpposedNormals } from './holes';
import { underCloth, overCloth } from './under';
import { DECREEP } from './decreep';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp } from '../core/noise';
import { applySway, swayUniforms } from './sway';
import { buildHair, HAIRSTYLES, HAIR_CAP, HAIR_VOLUME, HAIR_ROUGH, HAIR_CARDS, skullFrom } from './hair';
import { LOOKS, CrewId, Look } from './looks';
import type { PlayerLook } from './custom';
import { voice } from '../core/voice';
import { AnimSet, CrewAsset, CrewMeta, animNow, assetNow, clipsFor, corneaMaterial, clothDetail, eyeMaterial, furMaterial, hasLod1, lashMaterial, sameSkeleton, loadAnim, loadAsset, lodOf, mouthMaterial, skinMaterial, tex, texturesReady } from './assets';
import { addKit, Kit } from './kit';
import { mergeRigid } from './rigid';
import { BODY_MERGE, BODY_PARTS, MAX_MORPHS, bodyDepthMaterial, bodyMaterial, hairPart, kitParts, mergeBodyGeometry, morphUniforms, morphVertex } from './bodymerge';
import { perfBody } from '../core/perfhud';

/** ?lensfade=old: a crowd body fades through a dithered half-shape from 2.2 m to 1.1 m of the camera (the old way). */
const LENS_BAND = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lensfade') === 'old';
export type { CrewId } from './looks';
export { preloadCrew } from './assets';
/** A direction in the body's own space: +x left, +y up, +z forward. */
export type Dir = [number, number, number];
/** Where the wrist goes for a hand to close on a thing whose centre is `at` (setHold with grasp): back from it along the
 * fingers to the palm's middle (`palm` of the way from the wrist to the middle finger's root), then out from the palm by
 * the hand's half thickness and the thing's radius. Hold targets were the wrist point, so a stone or a shaft drawn at
 * the target sat 8 cm short of the palm. */
export function graspWrist(out: THREE.Vector3, at: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, radius: number, palmLen: number, along = 0.6) {
  const f = fingers.lengthSq() > 1e-8 ? fingers.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const n = palm.clone(); n.addScaledVector(f, -n.dot(f)); if (n.lengthSq() < 1e-8) n.set(0, -1, 0); n.normalize();
  return out.copy(at).addScaledVector(f, -palmLen * along).addScaledVector(n, -(palmLen * 0.16 + radius));
}
/**
 * A hand-set body pose laid over the clip, for bodies no mocap covers (free fall,
 * crash landings). Directions are where each bone points, so the same pose fits
 * every build and no rig axes leak out of here.
 */
export interface Limbs { armL?: Dir; armR?: Dir; foreL?: Dir; foreR?: Dir; legL?: Dir; legR?: Dir; shinL?: Dir; shinR?: Dir; bend?: number; twist?: number; openHands?: boolean; hair?: Dir;
  /** These arms were solved by their caller (combat's melee rig puts both hands on a weapon): the rig's own push of the
   *  arms out of the torso (keepArmsOut) leaves them where they are set, so it never pulls a hand off the shaft. The
   *  caller keeps them clear of the body itself, against Character.torsoCapsules() if it wants the rig's own shapes. */
  ownArms?: 'L' | 'R' | 'both' }
export type Face = Partial<Record<'smile' | 'frown' | 'fear' | 'squint' | 'open' | 'blink', number>>;
/** A hand's finger shape for Character.setGrip. */
export interface Grip { shape: 'open' | 'relaxed' | 'grip' | 'pinch' | 'point'; radius?: number; amount?: number }
/** Something the hands do (Character.doTask): reach and pick up, put down, throw, use a thing in front of you, eat,
 * drink, type, open, carry, fix, give, plant, or talk with the hands. */
export type TaskKind = 'pickup' | 'putdown' | 'throw' | 'use' | 'eat' | 'drink' | 'type' | 'open' | 'carry' | 'fix' | 'give' | 'plant' | 'gesture' | 'phone';
/** Things a task puts in the hands: food, a cup, a phone, a parcel, a tool, a sheet of paper, a broad leaf folded into a
 * cone, a berry held between finger and thumb. */
export type PropKind = 'food' | 'cup' | 'phone' | 'box' | 'tool' | 'paper' | 'leaf' | 'berry' | 'stone' | 'flake' | 'spindle' | 'throwstick';
const PROP_DEF: Record<PropKind, () => THREE.Mesh> = {
  food: () => new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 18), new THREE.MeshStandardMaterial({ color: 0xc8893f, roughness: 0.85 })),
  cup: () => new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.075, 16), new THREE.MeshStandardMaterial({ color: 0xb5563a, roughness: 0.7 })),
  phone: () => new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.008, 0.15), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.4, emissive: 0x1a2a44, emissiveIntensity: 0.6 })),
  // a bent offcut of pale wood, held by one end: the end at the origin, the first arm up +y, the bend and the second arm
  // past it (the throwing stick of the lean-to, lean.ts: in his hand through the line and the wind up)
  throwstick: () => new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.02, 0.3, 0), new THREE.Vector3(0.16, 0.54, 0)), 12, 0.02, 6),
    new THREE.MeshStandardMaterial({ color: 0xd2b088, roughness: 0.7, emissive: 0x2a1e10 })),
  box: () => new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.22), new THREE.MeshStandardMaterial({ color: 0xa47a4c, roughness: 0.9 })),
  tool: () => new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.028, 0.028), new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.4, metalness: 0.8 })),
  paper: () => new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.003, 0.22), new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.95 })),
  leaf: () => {
    // a broad leaf rolled into a cone, open at the top, its point down, about a palm across (the cone's base is its
    // rim: flipped below); the leaf's own tip
    // stands up past the rim on one side, the midrib and veins lighter, the inside paler than the outside
    const R = 0.062, H = 0.17;
    const g = new THREE.ConeGeometry(R, H, 18, 4, true);
    const p = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
      // the rim: uneven, and drawn up into the leaf's tip on the side away from the seam
      if (y < -H * 0.45) p.setY(i, y - 0.012 * Math.sin(a * 3 + 0.6) - 0.07 * Math.pow(Math.max(0, Math.cos(a - 2.2)), 6));
      const vein = Math.max(Math.pow(Math.max(0, Math.cos(a - 2.2)), 40), 0.5 * Math.pow(Math.abs(Math.sin((a - 2.2) * 3)), 30));
      // a dark, waxy leaf green (lit by a scene's key light it went lime and glowed)
      const k = 0.6 + 0.4 * vein;
      col[i * 3] = 0.12 * k + 0.12 * vein; col[i * 3 + 1] = 0.28 * k + 0.12 * vein; col[i * 3 + 2] = 0.08 * k + 0.05 * vein;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateX(Math.PI); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
  },
  // the red fruit of 1.1, the same pod as on the bush (world/fruit.ts), held between finger and thumb
  berry: () => redFruitMesh(),
  // a fist-sized hammerstone (1.3) and the flint flake it knocks off
  stone: () => { const g = new THREE.IcosahedronGeometry(0.042, 2); g.scale(1.2, 0.85, 1); return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8d8c88, roughness: 0.8 })); },
  // the hand drill's spindle: a straight stem, finger thick, about half a metre (1.6)
  spindle: () => { const g = new THREE.CylinderGeometry(0.0055, 0.0065, 0.5, 8); g.translate(0, -0.18, 0); return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.8 })); },
  flake: () => { const g = new THREE.CylinderGeometry(0.0, 0.032, 0.1, 5, 1); g.scale(1, 1, 0.25); return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a4650, roughness: 0.12, metalness: 0.2 })); },
};
/** What each task holds unless told otherwise. */
const TASK_PROP: Partial<Record<TaskKind, PropKind>> = { throw: 'stone', eat: 'food', drink: 'cup', phone: 'phone', carry: 'box', fix: 'tool', type: 'phone' };
const LOW_TASKS: Partial<Record<TaskKind, number>> = { pickup: 1, putdown: 1, drink: 1, fix: 0.85, plant: 1 };
/** Authored actions (tools/build_animations.py, Quaternius CC0): a task with one plays it as the body's pose, stretched
 *  to the task's length, and IK only moves the hand the last few cm onto `at` round the moment of contact (`touch`, as a
 *  share of the clip). Without the clip in anim.glb the task falls back to the procedural reach. */
// touch: the moment the hand is on the thing (IK there, the prop taken or left); release: a throw's prop leaves the hand
// (OverhandThrow's hand is fastest at 0.24 of the clip, measured from the clip's own hand path); reverse: played
// backwards (putting down is picking up run back, its touch at 1 less the pick up's lowest hand, 0.47); prop: when the
// task's prop is in the hand ('after' the touch, 'before' it, 'all' of it)
const TASK_CLIPS: Partial<Record<TaskKind, { low?: string; high?: string; touch: number; hands: 'R' | 'both'; reverse?: boolean; release?: number; prop: 'after' | 'before' | 'all' }>> = {
  pickup: { low: 'pickup_low', high: 'pickup_table', touch: 0.42, hands: 'R', prop: 'after' },
  putdown: { low: 'pickup_low', high: 'pickup_table', touch: 0.55, hands: 'R', reverse: true, prop: 'before' },
  plant: { low: 'plant', touch: 0.45, hands: 'R', prop: 'before' },
  throw: { high: 'throw', touch: -1, release: 0.25, hands: 'R', prop: 'before' },
  // eat and drink: not the Consume clip. Retargeted, its LEFT hand goes out to 26 cm beside the face and 45 cm in front,
  // nowhere near the mouth, while the food stays in the right hand at the hip (tasksA2 GPU clip, 2026-11-23): the
  // procedural path takes the hand with the food to the mouth
};
/** What the fingers of every character did since the page loaded (read by the checks): the largest bend of any finger
 * joint from its rest, in radians, and the fastest any joint turned, in radians a second. */
export const HANDS = { maxCurl: 0, maxRate: 0, frames: 0 };

export type CrewPose = 'swim' | 'float' | 'stand' | 'idle' | 'walk' | 'sit' | 'injured' | 'wave' | 'lie' | 'point' | 'cheer' | 'facepalm' | 'selfie' | 'shout' | 'argue' | 'present' | 'write' | 'jump';

/**
 * What a body costs per frame, by how it is seen. A body no game camera has drawn for a few frames (behind you, round
 * a corner) is posed at a quarter of the frame rate, a far one at a half or a third; the pose-driven corrective
 * shapes are mixed only for a body drawn within `correctiveNear` metres (further off they cannot be told apart, and at
 * zero the GPU skips them); between half that and `correctiveNear` they are mixed every other pose. Past `shadowFar`
 * metres a body casts no shadow; past `lodFar` a full-detail body is swapped for its light build. A crowd body (townsfolk,
 * walkers, people in groups: `setCrowd`) never mixes correctives and takes the light build and loses its shadow sooner
 * (`crowdLodFar`, `crowdShadowFar`). Test pages that pose a body many times before drawing it once switch `throttle` off.
 */
/**
 * Cloth is drawn a little nearer the camera than it lies, by garment layer (the outfit's order: footwear 0.5, then 1, 2
 * and so on outwards): this many metres per layer, along the line of sight, so its outline on screen is unchanged. Where
 * skin and an inner garment come within a few millimetres of the layer over them in motion, the outer one still wins.
 * dev/chars.ts (the play capture) draws its passes the same way. 7 mm (was 3): in tools/play_capture.py Nuvexa's
 * flagged pixels fell from 33,600 to 25,800 over every action and view; the lab coat's count did not move (its inner
 * shirt really is outside the coat at the lapels, which needs the garment rebuilt).
 */
/** Rig switches for A/B tests (dev/animqa.ts): reach, the chest and collarbone helping a held hand get there. */
/** lipsLetGo: how much of the fingers' torso guard lets go with the hand at the lips (eating, drinking). */
/** throwTame: how much of the throw clip's lunge (legs and hips) is taken back towards the stance it began from. */
/** sipElbow, sipHead: an elbow way at the lips and a turn of the face away from the cup's hand (both off: they cleared the
 *  eyes on one body and not the next). hairGround 0 lets the tails into the ground (A/B). plantBend, plantReach, plantWin,
 *  plantHold: planting's back bend (rad), its IK reach (m), the touch window and the time held at the soil (task k). */
export const RIG_OPTS = { reach: true, lipsLetGo: 1, throwTame: 0.5, faceUp: 1, sipTip: 1.65, hairTurn: 1, contactEase: 9, sipYaw: -0.5, sipElbow: null as Dir | null, sipHead: 0, cupAlongSip: 0.6, cupFootSip: 0.018, cupPalm: 0.08, cupMax: 1.5, pocketReach: 1, hairGround: 1, plantBend: 0.5, plantReach: 0.6, plantWin: 0.24, plantHold: 0.08 };
/** How far a strand's tip falls towards the ground as the head turns from upright, per metre of strand and per unit of
 *  change in the ground's direction seen from the head (hair.ts uDrop; times the strand's sway squared, at most 1.6) */
const HAIR_DROP = 0.15;
export const CLOTH_PULL = 0.007;
/**
 * And every garment this much more on top of that, over the skin: a raised arm stretches a sweater thinner than the
 * skin under it was sunk for (Nuvexa's selfie on the deck showed her chest through it). The gap between two garments
 * stays CLOTH_PULL.
 */
export const CLOTH_LIFT = 0.006;
/** Holes closed in garment meshes since load (holes.ts), for the tests. */
export const CLOTH_HOLES = { filled: 0, normals: 0 };
/** Body vertices drawn as their garment since load (under.ts), for the tests. */
export const UNDER_CLOTH = { verts: 0, over: 0 };

/** Phones (the light build everywhere): face details past this many metres from the camera are not drawn. */
const FACE_FAR: Record<string, number> = { cornea: 3, lash: 3.5, eyes: 9 };
/** A crowd body further off than these is drawn without them (every preset): eyes, their shine and the lashes are a pixel or two. */
const CROWD_FACE_FAR: Record<string, number> = { cornea: 5, lash: 7, eyes: 12 };

// a body's shadow pass costs far more than its own draw on a laptop GPU (skinned and morphed depth): a crowd body never
// casts one (the stage lays a soft contact shadow under it instead), others only near the camera
/** Crowd light builds with only their shape morphs, one per source geometry. */
const STRIPPED = new WeakMap<THREE.BufferGeometry, { g: THREE.BufferGeometry; dict: Record<string, number> | undefined }>();
/** Where the game camera was when it last drew a body (for passers-by at the lens). */
const LENS = new THREE.Vector3(0, -1e6, 0);
export const CHAR_BUDGET = { throttle: true, correctiveNear: 9, lodFar: 11, shadowFar: 16, crowdLodFar: 6, crowdShadowFar: 0, lodSwapFar: 0 };

/** Mocap style per character: how they stand and how they walk. */
const STYLE: Record<string, { walk: string; idle: string; rate: number }> = {
  scientist: { walk: 'walk', idle: 'stand', rate: 1 },
  strong: { walk: 'walk', idle: 'stand', rate: 0.92 },
  medic: { walk: 'walk_formal', idle: 'stand', rate: 1 },
  explorer: { walk: 'walk', idle: 'stand', rate: 1.05 },
  builder: { walk: 'walk', idle: 'stand', rate: 1 },
  social: { walk: 'walk_formal', idle: 'stand', rate: 1 },
  megazron: { walk: 'walk_formal', idle: 'stand', rate: 0.8 },
};

/** Standing face of each kind of eye: morph weights on top of the real lids. */
const EYE_SHAPE: Record<string, { blink: number; squint: number; fear: number }> = {
  tired: { blink: 0.22, squint: 0, fear: 0 }, narrow: { blink: 0.1, squint: 0.55, fear: 0 }, calm: { blink: 0.12, squint: 0.1, fear: 0 },
  bright: { blink: 0, squint: 0, fear: 0.12 }, squint: { blink: 0.08, squint: 0.8, fear: 0 }, doll: { blink: 0, squint: 0, fear: 0.2 },
};
const MOUTH: Record<string, number> = { smirk: 0.18, flat: 0, soft: 0.1, grin: 0.4, wide: 0.28, gloss: 0.22 };
const EXPR: Partial<Record<CrewPose, Record<string, number>>> = {
  cheer: { smile: 0.95, open: 0.25 }, wave: { smile: 0.6 }, selfie: { smile: 0.85 }, present: { smile: 0.3 }, shout: { frown: 0.75, open: 0.65 },
  argue: { frown: 0.6 }, facepalm: { frown: 0.55, squint: 0.5 }, injured: { fear: 0.45, frown: 0.2 }, sit: { smile: 0.1 }, lie: { blink: 0.92 },
};
const FULL_BODY = new Set<CrewPose>(['sit', 'injured', 'lie', 'jump', 'float', 'swim']);
const MARK_OF: Record<string, string> = { dots: 'scientist', cracks: 'strong', veins: 'medic', stripes: 'explorer', plates: 'builder', stars: 'social' };

const bones = (root: THREE.Object3D) => { const m = new Map<string, THREE.Bone>(); root.traverse((o) => { if ((o as THREE.Bone).isBone) m.set(o.name, o as THREE.Bone); }); return m; };
const lip = { open: 0, round: 0, wide: 0 };
/** Smooth value noise in -1..1 for micro-movement (idle expressions, eye drift). */
const wob = (t: number, k: number) => Math.sin(t * 0.7 + k * 1.3) * 0.5 + Math.sin(t * 1.31 + k * 2.1) * 0.3 + Math.sin(t * 2.9 + k) * 0.2;
const Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler();
const TQ = new THREE.Quaternion(), TH = new THREE.Quaternion();
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), V4 = new THREE.Vector3(), V5 = new THREE.Vector3();

/** Rotate a bone by a world-space rotation. */
const TORSO: [string, string][] = [['hips', 'spine1'], ['spine1', 'chest'], ['chest', 'neck']];
const SA = new THREE.Vector3(), SB = new THREE.Vector3();
const TORSO_BONES = new Set(['hips', 'spine', 'spine1', 'chest', 'neck']);
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) { const ab = SB.copy(b).sub(a), t = Math.max(0, Math.min(1, SA.copy(p).sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(SA.copy(a).addScaledVector(ab, t)); }

const smooth01 = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
function worldRotate(b: THREE.Object3D, dq: THREE.Quaternion) {
  b.getWorldQuaternion(Q);
  Q.premultiply(dq);
  b.parent!.getWorldQuaternion(Q2).invert();
  b.quaternion.copy(Q2.multiply(Q));
}

/** Two-bone leg IK in world space: the knee keeps its plane. */
function solveLeg(hip: THREE.Bone, knee: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3) {
  const a = hip.getWorldPosition(V1), b = knee.getWorldPosition(V2), c = foot.getWorldPosition(V3);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const d = clamp(a.distanceTo(target), Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
  const ab = V4.copy(b).sub(a), bc = V5.copy(c).sub(b);
  const axis = new THREE.Vector3().crossVectors(ab, bc);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0).applyQuaternion(hip.getWorldQuaternion(Q));
  axis.normalize();
  const cur = Math.acos(clamp((l1 * l1 + l2 * l2 - a.distanceToSquared(c)) / (2 * l1 * l2), -1, 1));
  const want = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  worldRotate(knee, new THREE.Quaternion().setFromAxisAngle(axis, cur - want));
  knee.updateWorldMatrix(true, true);
  const c2 = foot.getWorldPosition(new THREE.Vector3());
  const from = c2.sub(hip.getWorldPosition(V1)).normalize(), to = V2.copy(target).sub(V1).normalize();
  worldRotate(hip, new THREE.Quaternion().setFromUnitVectors(from, to));
}

/**
 * A crew member: a skinned MakeHuman body with mocap clips. Everything here is built around
 * plain Object3D handles, so callers can use a character the moment it is created;
 * the body drops in when its GLB has arrived (preloadCrew makes that instant).
 */
export function createCharacter(id: CrewId, detail = 1, custom?: PlayerLook, skinId?: string) {
  const L: Look = LOOKS[id];
  const human = skinId === 'suit';
  const P = L.persona;
  const lod = lodOf(detail);
  const key = custom ? `custom_${custom.gender}_${custom.outfit}` : human ? 'strong_suit' : id;
  const style = STYLE[custom ? custom.outfit : id];
  const heightM = (custom ? (custom.gender === 'f' ? 1.68 : 1.76) * custom.height : (human ? 2 : ({ scientist: 1.76, strong: 1.97, medic: 1.69, explorer: 1.71, builder: 1.57, social: 1.67, megazron: 2.08 } as Record<string, number>)[id]));
  const sway = swayUniforms();
  const root = new THREE.Group();
  root.userData.isCharacter = true; // stage mergers leave bodies alone
  root.userData.id = custom ? 'player' : id; // who it is, for tests (clipProbe)
  // shown again: back in three.js's matrix pass at once, whoever shows it (animate() takes it out while it is hidden)
  { let shown = true; Object.defineProperty(root, 'visible', { get: () => shown, set: (v: boolean) => { shown = v; if (v) root.matrixWorldAutoUpdate = true; } });
    // while hidden, three.js's matrix pass does not walk its sixty bones and its meshes at all
    const walk = THREE.Object3D.prototype.updateMatrixWorld; root.updateMatrixWorld = function (force?: boolean) { if (shown) walk.call(this, force); }; }
  const fig = new THREE.Group();
  fig.visible = false;
  root.add(fig);
  // handles that exist before the skeleton does
  const body = new THREE.Group(), chest = new THREE.Group(), head = new THREE.Group();
  const handL = new THREE.Group(), handR = new THREE.Group(), legL = new THREE.Group(), legR = new THREE.Group();
  // armL/armR take pose offsets from callers (thrusts, zero-g floats), applied over the clip
  const armL = new THREE.Group(), armR = new THREE.Group();
  head.position.y = heightM * 0.9;
  fig.add(body, chest, head, handL, handR, legL, legR);

  // ---- name tag ----
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 512; tagCanvas.height = 96;
  const tagTex = new THREE.CanvasTexture(tagCanvas); tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, fog: false }));
  tag.scale.set(1.6, 0.3, 1); tag.position.y = (heightM + 0.42); tag.renderOrder = 5; tag.visible = false;
  root.add(tag);
  let tagText = '';
  const setName = (name: string, role: string) => {
    const key = `${name}|${role}`;
    if (key === tagText) return;
    tagText = key;
    const g = tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 96);
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8;
    g.fillStyle = '#f2ebdd'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = "600 34px 'Barlow', 'Rajdhani', 'Noto Sans Devanagari', 'Noto Naskh Arabic', sans-serif"; g.fillText(name, 256, 36, 380);
    g.fillStyle = '#e8a33d'; g.font = "22px 'Barlow', 'Rajdhani', 'Noto Sans Devanagari', 'Noto Naskh Arabic', sans-serif"; g.fillText(role, 256, 70, 380);
    tagTex.needsUpdate = true;
  };

  // ---- runtime state ----
  let pendingSplint = false, soleLift = 0;
  const gazeAt = new THREE.Vector3();
  let gaze: THREE.Vector3 | null = null, gazeY = 0, gazeX = 0, gazeRate = 2.2;
  let B: Map<string, THREE.Bone> | null = null;
  const clipPose = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  // the forearm's own axis per side (rest frames carry no rotation, so it is the same in the twist bone and the hand)
  const twistAx: Record<string, THREE.Vector3> = {};
  let mixer: THREE.AnimationMixer | null = null;
  let clips: Map<string, THREE.AnimationClip> | null = null;
  let A: AnimSet | null = null;
  let legScale = 1;
  let kit: Kit | null = null;
  const faces: { dict: Record<string, number>; infl: number[] }[] = [];
  const acts = new Map<string, { a: THREE.AnimationAction; w: number; target: number; manual: boolean; v?: number }>();
  let ready: () => void = () => {};
  const whenReady = new Promise<void>((r) => { ready = r; });
  // and once the light build (when there is one) has loaded too: every mesh it will ever draw is in place
  let full: () => void = () => {}, lodLoad: Promise<unknown> = Promise.resolve();
  const whenFull = new Promise<void>((r) => { full = r; });
  let ground: ((x: number, z: number) => number) | null = null;
  const lookAt = { y: 0, x: 0 };
  const morph: Record<string, number> = {};
  let blinkAt = 2 + Math.random() * 3, blinkT = 0, speak = 0;
  let limbs: Limbs | null = null, faceSet: Face | null = null, armOwner: 'L' | 'R' | 'both' | null = null;
  // kneeling (0 standing, 1 on both knees) eases to its goal; a prop held outside any task
  let kneel = 0, kneelGoal = 0, heels = 0, heelsGoal = 0, heldProp: PropKind | null = null, heldShown = false;
  const kneelL: Limbs = {}, KD = new THREE.Vector3(), KQ = new THREE.Quaternion();
  // a task in the hands (doTask): time in, length, where the hand goes, which hands
  let task: { kind: TaskKind; t: number; dur: number; at: THREE.Vector3 | null; hands: 'L' | 'R' | 'both'; prop: PropKind | null; onContact?: (() => void) | null; clipOk?: boolean } | null = null;
  // the thing in the hand: made once per kind, parented to the hand (or held in front of the hips for a parcel)
  const props = new Map<PropKind, THREE.Mesh>();
  let propOn: THREE.Mesh | null = null;
  function showProp(bs: Map<string, THREE.Bone>, kind: PropKind | null, w: number) {
    const want = kind && w > 0.35 ? kind : null;
    if (propOn && (!want || props.get(want) !== propOn)) { propOn.removeFromParent(); propOn = null; }
    if (!want || propOn) return;
    let m = props.get(want);
    if (!m) { m = PROP_DEF[want](); castable.add(m); shSeen.add(m); props.set(want, m); }
    m.castShadow = shadowsOn; // a held prop casts only while its body does (phones' city: nobody)
    // the rig's rest pose has every rotation at identity (a T pose): the right hand's fingers point along -x, the palm down
    if (want === 'box') { bs.get('hips')!.add(m); m.position.set(0, 0.12, 0.3); m.rotation.set(0, 0, 0); }
    else {
      const h = bs.get('handR')!; h.add(m);
      if (want === 'phone' || want === 'paper') { m.position.set(-0.08, -0.03, 0.01); m.rotation.set(0, Math.PI / 2, 0.25); }
      else if (want === 'tool') { m.position.set(-0.07, -0.03, 0); m.rotation.set(0, Math.PI / 2, 0); }
      else if (want === 'cup' || want === 'food' || want === 'throwstick') placeOnPalm(bs, m, want);
      else if (want === 'leaf') { m.position.set(-0.07, -0.07, 0.0); m.rotation.set(Math.PI, 0, 0); } // upright on a palm turned up (the hand's -y is then up): the rim on top, the point in the palm
      else if (want === 'berry') { m.position.set(-0.11, -0.04, 0.03); m.rotation.set(0, 0, 0); }
      else if (want === 'stone') { m.position.set(-0.08, -0.05, 0.01); m.rotation.set(0, 0, 0); }
      else if (want === 'spindle') { m.position.set(-0.08, -0.03, 0.02); m.rotation.set(0, 0, 0); }
      else if (want === 'flake') { m.position.set(-0.1, -0.02, 0.02); m.rotation.set(0, 0, Math.PI / 2); }
      else { m.position.set(-0.08, -0.03, 0); m.rotation.set(0, 0, 0.3); }
    }
    propOn = m;
  }
  /** The hand's own frame read from its bones (they never move inside it): the way the fingers point, the way the palm
   *  faces (the fingertips curl that way), and the thumb's side, all in the hand bone's space. The fixed placements above
   *  assumed the fingers along the bone's -x; on these rigs they are not (Zenvik: (-0.44, -0.47, 0.77)), so the cup stood
   *  on its side off the hand and the bread hung off the wrist. */
  function handAxes(bs: Map<string, THREE.Bone>) {
    const hd = bs.get('handR')!, f3 = bs.get('finger3_1R')!, f1 = bs.get('finger1_3R'), f5 = bs.get('finger5_1R');
    const fl = f3.position.clone().normalize();
    const nl = new THREE.Vector3(0, -1, 0); nl.addScaledVector(fl, -nl.dot(fl)).normalize();
    // the thumb's side: from the little finger's root towards the thumb, across the fingers and the palm
    const th = new THREE.Vector3().crossVectors(fl, nl);
    if (f1 && f5) {
      hd.updateWorldMatrix(true, true);
      const s = hd.worldToLocal(f1.getWorldPosition(new THREE.Vector3())).sub(hd.worldToLocal(f5.getWorldPosition(new THREE.Vector3())));
      if (s.dot(th) < 0) th.negate();
    }
    return { fl, nl, th, palmLen: f3.position.length() };
  }
  /** A cup in the hand as one holds a cup: upright along the thumb's side, its side in the palm, the fingers round it;
   *  a flatbread pinched flat between the thumb and the fingers, most of it out past the fingertips. */
  function placeOnPalm(bs: Map<string, THREE.Bone>, m: THREE.Object3D, kind: 'cup' | 'food' | 'throwstick', sip = 0) {
    const { fl, nl, th, palmLen } = handAxes(bs);
    const s = 1 / Math.max(1e-3, bs.get('handR')!.getWorldScale(new THREE.Vector3()).x);
    const M = new THREE.Matrix4();
    if (kind === 'throwstick') {
      // through the fist as a cup is, along the thumb's side, its end a little below the little finger: the stick out
      // past the thumb and the forefinger (the grip's radius 0.02 closes the fingers on it)
      M.makeBasis(new THREE.Vector3().crossVectors(th, nl), th, nl);
      m.quaternion.setFromRotationMatrix(M);
      m.position.copy(fl).multiplyScalar(palmLen * 0.6).addScaledVector(nl, (0.02 + 0.014) * s);
    } else if (kind === 'cup') {
      // the cup's axis (+y) along the thumb's side, its middle out from the palm by its radius and the hand's half thickness
      M.makeBasis(new THREE.Vector3().crossVectors(th, nl), th, nl);
      m.quaternion.setFromRotationMatrix(M);
      // as big as the hand that holds it (cupScale): a big fist swallowed the small cup, and at the lips one saw a fist
      // over his face and no cup (Draxum, GPU take tasksE); it stands out above and below the fingers now
      const k = cupScale(bs); m.scale.setScalar(k);
      // held round its lower half (round its middle, tipped to sip, the hand sat at the rim over his nose)
      // at the lips (sip 1) the hand slides down the cup and towards its foot (RIG_OPTS.cupAlongSip, cupFootSip): the
      // fingertips hold it round its foot, the palm under it. Held round its lower half with the palm on its side, the
      // fingers rose in front of the eyes for the whole sip (GPU take tasks9: Draxum most, Zenvik too); 1.25 and 0.035:
      // no frame with a finger joint within 1.5 cm of the line from the camera to an eye, from the front, 3/4 or side,
      // standing or seated, on Zenvik, Draxum and Nuvexa (the old grip: 26 to 30 frames of 90 from the front)
      const along = 0.6 + (RIG_OPTS.cupAlongSip - 0.6) * sip, foot = 0.018 + (RIG_OPTS.cupFootSip - 0.018) * sip;
      m.position.copy(fl).multiplyScalar(palmLen * along).addScaledVector(nl, (0.031 * k + 0.014) * s).addScaledVector(th, foot * k * s);
    } else {
      // the bread flat in the fingers' plane (its +y out of the palm), its middle past the fingers' roots
      M.makeBasis(fl, nl, new THREE.Vector3().crossVectors(fl, nl));
      m.quaternion.setFromRotationMatrix(M);
      m.position.copy(fl).multiplyScalar(palmLen + 0.07 * s).addScaledVector(nl, 0.012 * s).addScaledVector(th, 0.01 * s);
    }
  }
  /** The cup's size for this hand: the palm's length (wrist to the middle finger's root, world) over RIG_OPTS.cupPalm,
   *  1 to RIG_OPTS.cupMax. */
  let cupK = 0;
  function cupScale(bs: Map<string, THREE.Bone>) {
    if (cupK) return cupK;
    const hd = bs.get('handR')!, f3 = bs.get('finger3_1R')!;
    const palm = f3.position.length() * hd.getWorldScale(new THREE.Vector3()).x;
    cupK = clamp(palm / RIG_OPTS.cupPalm, 1, RIG_OPTS.cupMax);
    return cupK;
  }
  /** Where a prop's contact lies in the hand bone's space, for the mouth: the bread's rim or the cup's top rim (its middle
   *  here; the side of the rim towards the face is picked once the hand's turn is known). Returns the rim's middle, its
   *  axis and its radius. */
  const PROP_RIM: Partial<Record<PropKind, { y: number; r: number }>> = { food: { y: 0, r: 0.07 }, cup: { y: 0.0375, r: 0.032 } };
  const taskQ = new Map<string, THREE.Quaternion>();
  // idle life: a look around now and then, the weight moving from foot to foot
  let idleLookAt = 3 + Math.random() * 5, idleLook = 0, idleLookWant = 0, idleShift = Math.random() * 6;
  const fingerRest = new Map<THREE.Bone, THREE.Quaternion>();
  // Hands are posed here and nowhere else. The clips' own finger keys are not played: they are a mix of tight fists,
  // claws and hand-keyed loops, and blending from one clip to the next made the fingers crunch. Each hand holds one
  // authored shape (at ease, open, round a thing, pointing) and moves to the next one smoothly, inside what a finger
  // can do.
  type HandShape = 'relaxed' | 'open' | 'grip' | 'point';
  const SHAPES: Record<HandShape, number[][]> = { // degrees of curl per joint: index, middle, ring, little, thumb
    relaxed: [[12, 28, 18], [18, 32, 22], [22, 36, 24], [26, 38, 26], [10, 12, 10]],
    open: [[2, 6, 4], [2, 6, 4], [3, 6, 4], [4, 8, 4], [0, 4, 4]],
    grip: [[48, 74, 46], [50, 76, 48], [52, 76, 48], [54, 76, 46], [16, 22, 24]],
    point: [[2, 6, 4], [58, 90, 60], [62, 90, 60], [64, 90, 58], [20, 28, 28]],
  };
  const fingers: { b: THREE.Bone; side: 'L' | 'R'; q: Record<HandShape, THREE.Quaternion>; cur: THREE.Quaternion; rest: THREE.Quaternion; hinge: THREE.Vector3; fi: number; j: number }[] = [];
  // Grip control (setGrip): per hand, a shape and, for 'grip', the radius of what is held. A thin thing (a bow string, a
  // sling cord) closes the fingers further than a thick one (a spear shaft, a yoke horn). Every joint is clamped to
  // what a finger can do, and the hand eases to its target (no per-frame noise is added, so it cannot jitter).
  const JOINT_MAX = [[95, 110, 85], [95, 110, 85], [95, 110, 85], [95, 110, 85], [55, 60, 75]]; // index, middle, ring, little, thumb (degrees)
  const PINCH = [[38, 52, 30], [46, 66, 40], [50, 70, 42], [54, 72, 42], [30, 28, 36]];
  const gripDeg = (g: Grip, fi: number, j: number) => {
    let d: number;
    if (g.shape === 'pinch') d = PINCH[fi][j];
    else if (g.shape === 'grip') {
      // curl for a round thing of radius r (metres): 'grip' as authored fits about 2 cm; thinner closes further
      const r = clamp(g.radius ?? 0.02, 0.002, 0.05), k = r < 0.02 ? 1 + (0.02 - r) / 0.018 * 0.3 : 1 - (r - 0.02) / 0.03 * 0.42;
      d = SHAPES.grip[fi][j] * k;
    } else d = SHAPES[g.shape][fi][j];
    d *= g.amount ?? 1;
    return clamp(d, 0, JOINT_MAX[fi][j]);
  };
  const gripSet: { L?: Grip; R?: Grip } = {};
  const CUP_GRIP: Grip = { shape: 'grip', radius: 0.034 }, cupGrip: Grip = { ...CUP_GRIP }, PINCH_GRIP: Grip = { shape: 'pinch' }, STICK_GRIP: Grip = { shape: 'grip', radius: 0.02 };
  const gripQ = new THREE.Quaternion();
  let handOpen = false, handsSet = false;
  let selfieT = 0, selfieHeld = false; const V4s = new THREE.Vector3();
  let pocketGate = 1; // the pocket reach let in (kit.ts pocketReach), eased
  /** A hand held on something in the scene (a control yoke, a rail): the wrist at a live world point, the fingers and
   *  the palm turned to given world directions, the fingers closed. Eased in and out. */
  // grasp: `at` is the middle of the held thing (a stone, a shaft at this hand's place on it), not the wrist; the palm
  // closes on it, `radius` out from the palm (graspWrist). along: where on the palm, 0 the wrist, 1 the knuckles (0.6)
  type HoldSide = { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; radius?: number; grasp?: boolean; along?: number };
  let hold: { L?: HoldSide; R?: HoldSide } | null = null; const holdW = { L: 0, R: 0 };
  const selfM = { a: new THREE.Vector3(), b: new THREE.Vector3(), l: new THREE.Matrix4(), q0: new THREE.Quaternion(), qi: new THREE.Quaternion(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion() };
  let gaitPhase = 0, inited = false, hipDrop = 0, sacAt = 1, sacX = 0, sacY = 0, firstFrame = true, eyeAimX = 0, eyeAimY = 0;
  const footOff = [0, 0];
  const pin = [new THREE.Vector3(), new THREE.Vector3()], pinOff = [new THREE.Vector3(), new THREE.Vector3()], pinned = [false, false];
  const trackPos = new THREE.Vector3();
  let tracked = false, trackYaw = 0, groundSpeed = 0, yawRate = 0, gaitOn = false, eyeY = 0;
  const lastPos = new THREE.Vector3(), swing = new THREE.Vector3(), swingV = new THREE.Vector3(), tmp = new THREE.Vector3();
  const drop = new THREE.Vector3(), dropV = new THREE.Vector3(), dropQ = new THREE.Quaternion();
  const eyeShape = EYE_SHAPE[custom ? custom.eye : human ? 'calm' : L.face.eye] ?? EYE_SHAPE.calm;
  const smileBase = MOUTH[L.face.mouth] ?? 0.1;

  const attach = (asset: CrewAsset, a: AnimSet) => {
    const scene = cloneSkinned(asset.scene) as THREE.Group;
    const M = asset.meta;
    const bs = bones(scene);
    B = bs; A = a; clipPose.clear();
    for (const sd of ['L', 'R']) twistAx[sd] = new THREE.Vector3(...M.pivots[`hand${sd}`]).sub(new THREE.Vector3(...M.pivots[`forearmtw${sd}`])).normalize();
    const piv = (n: string) => new THREE.Vector3(...M.pivots[n]);
    // creator build slider: move joints with the morphs, then rebind
    const build = custom ? custom.build : 0.5;
    const bw = custom ? { slim: Math.max(0, 1 - build * 2), heavy: Math.max(0, build * 2 - 1) } : { slim: 0, heavy: 0 };
    if (custom && M.build_slim_pivots && M.build_heavy_pivots) {
      const names = Object.keys(M.pivots);
      const pos = new Map<string, THREE.Vector3>();
      names.forEach((n, i) => {
        const v = piv(n);
        const s = M.build_slim_pivots![i], h = M.build_heavy_pivots![i];
        v.x += (s[0] - v.x) * bw.slim + (h[0] - v.x) * bw.heavy;
        v.y += (s[1] - v.y) * bw.slim + (h[1] - v.y) * bw.heavy;
        v.z += (s[2] - v.z) * bw.slim + (h[2] - v.z) * bw.heavy;
        pos.set(n, v);
      });
      for (const n of names) {
        const b = bs.get(n)!, par = b.parent as THREE.Bone;
        b.position.copy(pos.get(n)!);
        if (par?.isBone) b.position.sub(pos.get(par.name)!);
      }
      scene.updateMatrixWorld(true);
      scene.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) s.skeleton.calculateInverses(); });
    }
    // every skinned part on one skeleton (cloning gave each its own): three.js then poses the bones and uploads their
    // texture once a frame for the body instead of once per part
    { let main: THREE.Skeleton | null = null;
      scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (!main || m.name === 'skin_body')) main = m.skeleton; });
      if (main) scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.skeleton !== main && sameSkeleton(m.skeleton, main!)) m.skeleton = main!; }); }
    // materials
    const skinC = custom ? custom.skin : human ? 0xb5835f : L.face.skin; // a warm wheatish brown
    const shadeC = custom ? new THREE.Color(custom.skin).multiplyScalar(0.5).getHex() : human ? 0x6a4430 : L.face.shade;
    const lipC = custom ? new THREE.Color(custom.skin).lerp(new THREE.Color(0xa03040), 0.45).getHex() : human ? 0x7c463c : L.face.lip ? parseInt(L.face.lip.slice(1), 16) : new THREE.Color(L.face.shade).lerp(new THREE.Color(L.face.skin), 0.4).getHex();
    const glowC = custom ? custom.glow : human ? 0 : L.glow;
    const marks = custom ? MARK_OF[custom.marks] : human ? 'strong_suit' : id;
    const overC = marks === 'explorer' ? 0xf3e7cf : marks === 'strong' ? 0xe8c49a : 0x1e1e1e;
    const skin = skinMaterial(M.skin, marks, { skin: skinC, shade: shadeC, lip: lipC, glow: glowC, over: overC, glowK: human ? 0 : 1.15 }, lod);
    const irisC = custom ? custom.iris : human ? 0x1e120b : L.face.iris;
    const eyes = eyeMaterial(irisC, (custom ? custom.eyeGlow : !human) ? 0.55 : 0);
    const browC = custom ? new THREE.Color(custom.hairRoot).multiplyScalar(0.45).getHex() : human ? 0x2c1d14 : L.face.brow;
    const atlas = M.atlas;
    const cloth = new THREE.MeshStandardMaterial({ map: tex(`${atlas}_cloth`, lod, true), normalMap: tex(`${atlas}_cloth_n`, lod), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.82, side: THREE.DoubleSide });
    cloth.userData.film = { kind: 'cloth', atlas, satin: human, velvet: id === 'megazron' }; // the narrator's coat is velvet in the films
    const lay = M.layers ?? [];
    const accent = { uAccent: { value: new THREE.Color(custom?.accent ?? 0xffffff) }, uAccentK: { value: custom ? 1 : 0 }, uDetail: { value: clothDetail() }, uHeightM: { value: heightM }, uSatin: { value: human ? 1 : 0 }, uDust: { value: human ? 0.12 : 1 },
      uTiles: { value: lay.length }, uTileLayer: { value: new THREE.Vector4(...[...lay, 1, 1, 1, 1].slice(0, 4)) }, uPull: { value: lay.length ? CLOTH_PULL : 0 }, uLift: { value: lay.length ? CLOTH_LIFT : 0 } };
    cloth.userData.u = accent; cloth.userData.sway = sway; // the merged crowd body (bodymerge.ts) shares them
    applySway(cloth, sway, (sh) => {
      Object.assign(sh.uniforms, accent);
      sh.vertexShader = `attribute float aAccent; attribute vec3 aOver; varying vec3 vOver; varying float vAccent; varying float vBindY; uniform float uTiles, uPull, uLift; uniform vec4 uTileLayer;\n` + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vAccent = aAccent; vBindY = position.y; vOver = aOver;`)
        // the garment's layer from its atlas tile (tools/chars/paint.py tile_layout), and the pull towards the camera
        .replace('#include <project_vertex>', `#include <project_vertex>
        { int k = uTiles < 1.5 ? 0 : uTiles < 2.5 ? (uv.x >= 0.5 ? 1 : 0) : (uv.x >= 0.5 ? 1 : 0) + (uv.y >= 0.46875 ? 2 : 0);
          float L = k == 0 ? uTileLayer.x : k == 1 ? uTileLayer.y : k == 2 ? uTileLayer.z : uTileLayer.w;
          mvPosition.xyz *= max(0.0, 1.0 - (uLift + L * uPull) / max(length(mvPosition.xyz), 1e-3)); gl_Position = projectionMatrix * mvPosition; }`);
      sh.fragmentShader = `uniform vec3 uAccent; uniform float uAccentK, uHeightM, uSatin, uDust; uniform sampler2D uDetail; varying float vAccent; varying float vBindY; varying vec3 vOver;\n` + sh.fragmentShader
        // an inner garment that an outer one encloses is drawn as the outer one (under.ts)
        .replace('#include <map_fragment>', `#include <map_fragment>
        if (vOver.z > 0.995) diffuseColor.rgb = texture2D(map, vOver.xy).rgb * 0.92;
        diffuseColor.rgb = mix(diffuseColor.rgb, uAccent * (0.35 + dot(diffuseColor.rgb, vec3(1.1))), vAccent * uAccentK);
        // survivors of a crash: dust climbs from the ground, worn patches come and go
        float wearN = texture2D(uDetail, vMapUv * 5.0).b;
        float dust = (1.0 - smoothstep(0.0, 0.62, vBindY / uHeightM)) * 0.75 + smoothstep(0.55, 0.8, wearN) * 0.5;
        dust = clamp(dust * (0.45 + wearN), 0.0, 1.0) * uDust;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.6, 0.52) + vec3(0.035, 0.028, 0.02), dust);
        // the inside of a garment is in its own shade: the inside of the lab coat's back, seen between the legs through
        // the open front, was lit as brightly as its outside and read as a big grey mass (owner, 2026-11-23)
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.4;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = min(1.0, roughnessFactor + dust * 0.14);
        roughnessFactor = mix(roughnessFactor, 0.44, vAccent * uSatin);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 dn = texture2D(uDetail, vMapUv * 26.0).xy * 2.0 - 1.0; normal = normalize(normal + tbn * vec3(dn * 0.5 * (1.0 - vAccent * uSatin), 0.0)); }`);
    });
    cloth.customProgramCacheKey = () => 'crew-cloth2';
    // where cloth and the skin under it meet at the same depth (a cuff on the wrist, a collar on the neck), the cloth wins
    cloth.polygonOffset = true; cloth.polygonOffsetFactor = -1; cloth.polygonOffsetUnits = -2;
    const mouth = mouthMaterial(), cornea = corneaMaterial(), lash = lashMaterial(browC, M.lash);
    const fur = human ? furMaterial('strong_suit', 0x0e080b, 0x2a1d22, lod) : undefined;
    const sphere = new THREE.Sphere(new THREE.Vector3(0, heightM * 0.5, 0), heightM * 1.1);
    const dress = (sc: THREE.Object3D) => sc.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.boundingSphere = sphere;
      m.geometry.boundingSphere = sphere;
      const name = (m.material as THREE.Material).name;
      m.material = { skin, eyes, cornea, mouth, lash, cloth, fur }[name] ?? m.material;
      m.castShadow = name === 'skin' || name === 'cloth';
      if (m.castShadow) castable.add(m);
      m.receiveShadow = true;
      m.onBeforeRender = seen;
      if (name === 'fur') { m.castShadow = false; const ly = m.geometry.getAttribute('_layer'); if (ly) m.geometry.setAttribute('aLayer', ly); const dn = m.geometry.getAttribute('_dens'); m.geometry.setAttribute('aDens', dn ?? new THREE.BufferAttribute(new Float32Array(m.geometry.getAttribute('position').count).fill(1), 1)); }
      if (name === 'cloth') {
        const g = m.geometry;
        // small holes in the garment's own mesh are closed once per geometry (holes.ts)
        if (g.userData.holes === undefined) { g.userData.holes = fillSmallHoles(g); CLOTH_HOLES.filled += g.userData.holes; }
        const sw = g.getAttribute('_sway'), ac = g.getAttribute('_accent');
        if (sw && !g.getAttribute('aSway')) {
          g.setAttribute('aSway', sw);
          const p = g.getAttribute('position'), ph = new Float32Array(p.count);
          for (let i = 0; i < p.count; i++) ph[i] = Math.atan2(p.getX(i), p.getZ(i)) * 0.08;
          g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
        }
        if (ac) g.setAttribute('aAccent', ac);
      }
      if (m.morphTargetDictionary) {
        const f = { dict: m.morphTargetDictionary, infl: m.morphTargetInfluences! };
        faces.push(f);
        const put = (k: string, v: number) => { const i = f.dict[k]; if (i !== undefined) f.infl[i] = v; };
        put('build_slim', bw.slim); put('build_heavy', bw.heavy);
        const ears = custom ? custom.ears : human ? 'round' : ({ scientist: 'fin', medic: 'long', explorer: 'tuft', megazron: 'long' } as Record<string, string>)[id];
        if (ears && ears !== 'round') put(`ear_${ears}`, 1);
        for (const k in morph) put(k, morph[k]);
      }
    });
    dress(scene);
    // skin the garment encloses is drawn as the garment (under.ts), so a gap or a stretched seam never shows body
    { let sb: THREE.SkinnedMesh | null = null, cl: THREE.SkinnedMesh | null = null;
      scene.updateMatrixWorld(true);
      scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return; if (m.name === 'skin_body') sb = m; else if (m.name === 'cloth') cl = m; });
      // corners lit from the wrong side (welded flaps) get their triangle's own normal: once per geometry, before the
      // passes below read the mesh
      if (cl && (cl as THREE.SkinnedMesh).geometry.userData.normals === undefined) {
        const m = cl as THREE.SkinnedMesh, n0 = m.geometry.getAttribute('position').count;
        m.geometry.userData.normals = fixOpposedNormals(m.geometry, (i, out) => { if (i < n0) m.getVertexPosition(i, out); });
        CLOTH_HOLES.normals += m.geometry.userData.normals;
      }
      if (cl) UNDER_CLOTH.over += overCloth(cl, lay);
      if (sb && cl) { UNDER_CLOTH.verts += underCloth(sb, cl); const u = skin.userData.u as Record<string, { value: unknown }>; u.uCloth.value = cloth.map; u.uUnderAccent.value = accent.uAccent.value; u.uUnderAccentK.value = accent.uAccentK.value; } }
    // shoes reach below the bare sole: stand on them, not through them
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material) === cloth) { m.geometry.computeBoundingBox(); soleLift = Math.max(soleLift, -m.geometry.boundingBox!.min.y); }
    });
    scene.position.y = soleLift;
    fig.add(scene);
    scene.updateMatrixWorld(true);
    bs.forEach((b, n) => { if (n.startsWith('finger')) fingerRest.set(b, b.quaternion.clone()); });
    {
      const P3 = (n: string) => new THREE.Vector3(...M.pivots[n]);
      const col = [4, 0, 1, 2, 3]; // finger1 is the thumb
      for (const [sd, sg] of [['L', 1], ['R', -1]] as ['L' | 'R', number][]) {
        if (!M.pivots[`finger3_1${sd}`] || !M.pivots[`finger5_1${sd}`]) continue;
        const d = P3(`finger3_1${sd}`).sub(P3(`hand${sd}`)).normalize();
        const n = new THREE.Vector3().crossVectors(d, P3(`finger2_1${sd}`).sub(P3(`finger5_1${sd}`))).multiplyScalar(sg).normalize();
        for (let f = 1; f <= 5; f++) {
          if (!M.pivots[`finger${f}_2${sd}`]) continue;
          const hinge = new THREE.Vector3().crossVectors(P3(`finger${f}_2${sd}`).sub(P3(`finger${f}_1${sd}`)).normalize(), n).normalize();
          for (let j = 1; j <= 3; j++) {
            const b = bs.get(`finger${f}_${j}${sd}`); if (!b) continue;
            const rest = fingerRest.get(b)!;
            const q = {} as Record<HandShape, THREE.Quaternion>;
            for (const k of Object.keys(SHAPES) as HandShape[]) q[k] = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(hinge, SHAPES[k][col[f - 1]][j - 1] * Math.PI / 180));
            fingers.push({ b, side: sd, q, cur: q.relaxed.clone(), rest, hinge, fi: col[f - 1], j: j - 1 });
          }
        }
      }
    }
    // handles onto the skeleton
    const on = (g: THREE.Object3D, n: string) => { g.position.set(0, 0, 0); bs.get(n)!.add(g); };
    on(body, 'hips'); on(chest, 'chest'); on(head, 'head'); on(legL, 'upperlegL'); on(legR, 'upperlegR');
    for (const [g, s] of [[handL, 'L'], [handR, 'R']] as [THREE.Group, string][]) {
      on(g, `hand${s}`);
      // old hand space: -y down the fingers, +z towards the thumb side
      const d = piv(`finger3_1${s}`).sub(piv(`hand${s}`)).normalize().negate();
      const zz = piv(`finger2_1${s}`).sub(piv(`finger5_1${s}`));
      zz.addScaledVector(d, -zz.dot(d)).normalize();
      const xx = new THREE.Vector3().crossVectors(d, zz);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, d, zz));
    }
    // the torso as three capsules, measured from this body's own skin the first time it is posed (keepArmsOut)
    // the surface you see: body skin and the clothes over it (a full suit leaves almost no body skin)
    torsoR = null; torsoBody = []; thighR = null;
    scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (m.name === 'skin_body' || m.name === 'cloth')) torsoBody.push(m); });
    // hair on the real head
    const headP = piv('head');
    const hairId = custom ? custom.hair : human ? 'suit' : id;
    const hc = custom ? { root: new THREE.Color(custom.hairRoot).multiplyScalar(0.45).getHex(), mid: custom.hairRoot, tip: custom.hairTip, shine: new THREE.Color(custom.hairTip).lerp(new THREE.Color(0xffffff), 0.5).getHex() } : human ? { root: 0x0c0806, mid: 0x18100b, tip: 0x22170f, shine: 0x2e241e } : L.hair;
    const hair = buildHair(HAIRSTYLES[hairId](), hc, sway, detail, HAIR_CAP[hairId][0], HAIR_CAP[hairId][1], skullFrom(M.skull.c, M.skull.r), HAIR_VOLUME[hairId] ?? 0, HAIR_ROUGH[hairId] ?? 0.46, HAIR_CARDS[hairId] ?? false);
    bs.get('head')!.add(hair);
    // the hair's light build: a quarter of the strands' triangles, drawn with the body's own light build (pickLod)
    hairs = [hair, null];
    if (detail >= 0.8) {
      const low = buildHair(HAIRSTYLES[hairId](), hc, sway, 0.5, HAIR_CAP[hairId][0], HAIR_CAP[hairId][1], skullFrom(M.skull.c, M.skull.r), HAIR_VOLUME[hairId] ?? 0, HAIR_ROUGH[hairId] ?? 0.46, HAIR_CARDS[hairId] ?? false);
      low.visible = false; bs.get('head')!.add(low); hairs[1] = low;
    }
    // The decimated scan teeth break up in close-ups: use a clean mouth instead.
    const mouthBox = new THREE.Box3();
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material) === mouth) { m.geometry.computeBoundingBox(); mouthBox.union(m.geometry.boundingBox!); m.visible = false; } });
    if (!mouthBox.isEmpty()) {
      // bind-pose position, so it holds wherever the character happens to stand when the model arrives
      const c = mouthBox.getCenter(new THREE.Vector3()).sub(piv('head'));
      const inside = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), new THREE.MeshStandardMaterial({ color: 0x170708, roughness: 0.9 }));
      inside.scale.set(1.15, 0.6, 0.9); inside.position.copy(c); bs.get('head')!.add(inside);
      const teeth = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0042, 6, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.38 }));
      teeth.rotation.x = Math.PI / 2; teeth.rotation.z = Math.PI; teeth.position.set(c.x, c.y + 0.0045, c.z + 0.002); bs.get('head')!.add(teeth);
    }
    // MegaZroN's coat is open at the neck: a dark stock under it, so no bare chest shows
    if (id === 'megazron' && !custom) {
      const chestBone = bs.get('chest')!;
      const n = chestBone.worldToLocal(bs.get('neck')!.getWorldPosition(new THREE.Vector3()));
      const stock = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0x0c0d1c, roughness: 0.8 }));
      stock.scale.set(0.95, 1.7, 0.78); stock.position.set(n.x, n.y - 0.17, n.z + 0.02); chestBone.add(stock);
    }
    pitK = M.pit ?? null; corrRegions = [];
    // the light body for distance (game LOD): the full one near the camera, the .lod1 build further off. Both ride on
    // this skeleton and take the same materials and morphs; only one is drawn
    lodSets = [[], []];
    scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) lodSets[0].push(o as THREE.SkinnedMesh); });
    if (lod === 0 && CHAR_BUDGET.lodFar < Infinity && hasLod1(key)) {
      const skel = lodSets[0][0]?.skeleton;
      lodLoad = loadAsset(key, 1).then((as1) => {
        if (!skel || lodSets[0].length === 0) return;
        const s1 = cloneSkinned(as1.scene) as THREE.Group;
        // a crowd body's light build keeps only the shape morphs (build, ears): face and corrective targets are a loop
        // over fifty textures per vertex in every pass, for a face a few pixels high
        if (crowd) s1.traverse((o) => {
          const m = o as THREE.SkinnedMesh, dict = m.morphTargetDictionary;
          if (!m.isSkinnedMesh || !dict) return;
          const names = Object.keys(dict).sort((a, b) => dict[a] - dict[b]).filter((n) => n.startsWith('build_') || n.startsWith('ear_'));
          const g0 = m.geometry, done = STRIPPED.get(g0);
          if (done) { m.geometry = done.g; m.morphTargetDictionary = done.dict; m.morphTargetInfluences = done.dict ? names.map(() => 0) : undefined; return; }
          // shares the light build's buffers: only the list of morph targets is new
          const g = new THREE.BufferGeometry();
          for (const [k, a] of Object.entries(g0.attributes)) g.setAttribute(k, a);
          g.setIndex(g0.index); g.morphTargetsRelative = g0.morphTargetsRelative; g.boundingSphere = g0.boundingSphere; g.boundingBox = g0.boundingBox;
          for (const gr of g0.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
          if (names.length) for (const k of Object.keys(g0.morphAttributes) as ('position' | 'normal' | 'color')[]) { const src = m.geometry.morphAttributes[k]; if (src) g.morphAttributes[k] = names.map((n) => src[dict[n]]); }
          else g.morphAttributes = {} as THREE.BufferGeometry['morphAttributes'];
          m.geometry = g;
          m.morphTargetDictionary = names.length ? Object.fromEntries(names.map((n, i) => [n, i])) : undefined;
          m.morphTargetInfluences = names.length ? names.map(() => 0) : undefined;
          STRIPPED.set(g0, { g, dict: m.morphTargetDictionary });
        });
        dress(s1);
        const host = lodSets[0][0].parent!;
        const ms: THREE.SkinnedMesh[] = [];
        // a crowd body's light build leaves out its lashes and the cornea's gloss: a pixel or two from that far, and two
        // draw calls each (Ultra's bazaar drew 83 skinned meshes a frame)
        s1.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (m.material as THREE.Material) !== mouth && !(crowd && (m.name === 'lash' || m.name === 'cornea'))) ms.push(m); });
        for (const m of ms) { m.bind(skel, m.bindMatrix); host.add(m); m.visible = false; }
        lodSets[1] = ms; shDirty = true;
        mergeCrowd();
      }).catch(() => { /* no light build: the full body everywhere */ });
    }
    kit = addKit({ id, custom, human, bones: bs, meta: M, look: L, sway, skinC, glowC, shadeC, detail, heightM });
    kit.splint.visible = pendingSplint; shDirty = true;
    // the props, the mouth and the stock ride the skeleton as one to three skinned meshes instead of a dozen and more
    if (lodSets[0][0]) {
      const b0 = lodSets[0][0];
      try { rigid = mergeRigid(b0.skeleton, b0.bindMatrix, b0.parent!, new Set([...kit.live, hair, ...(hairs[1] ? [hairs[1]] : [])]), sphere); } catch (e) { console.warn('[crew] kit merge', e); }
      for (const m of rigid) { m.onBeforeRender = seen; if (m.castShadow) castable.add(m); m.castShadow &&= shadowsOn; }
    }
    // clips
    const leg = piv('upperlegL').distanceTo(piv('lowerlegL')) + piv('lowerlegL').distanceTo(piv('footL'));
    legScale = leg / a.refLeg;
    clips = clipsFor(`${key}`, legScale, a);
    mixer = new THREE.AnimationMixer(scene);
    fig.scale.setScalar(custom ? custom.height : 1);
    // what a passer-by fades out with near the lens (its own materials; the kit's are shared, it just goes)
    bodyMats = { skin, cloth, eyes, sphere };
    fadeSet = [skin, eyes, cloth, cornea, lash, ...(fur ? [fur] : []), ...hairs.filter((h): h is THREE.Mesh => !!h).map((h) => (h as THREE.Mesh).material as THREE.Material)].map((m) => ({ m, o: m.opacity, a: m.alphaTest }));
    prepFade();
    fig.visible = true;
    void texturesReady().then(ready);
    void Promise.all([lodLoad, texturesReady()]).then(() => full(), () => full());
  };

  // the fade near the lens (crowd bodies of the full build: Web, Ultra)
  let fadeSet: { m: THREE.Material; o: number; a: number }[] = [], fadeOn = false, fadeK = 1, fadeShown = 1, lensWant = 1;
  // a crowd body's skin, clothes and eyes as one mesh and one draw (bodymerge.ts); the crew and the player keep theirs
  let bodyMats: { skin: THREE.MeshStandardMaterial; cloth: THREE.MeshStandardMaterial; eyes: THREE.MeshStandardMaterial; sphere: THREE.Sphere } | null = null, bodyMat: THREE.MeshStandardMaterial | null = null;
  // the shapes a crowd body keeps: the face and the build (not the correctives: a crowd body has none)
  const crowdKeep = (n: string) => !/^(pit|nape|hip)[LR]?\d/.test(n), keepAll = (_n: string) => true;
  let mergeWanted = false, mergeLite = false;
  // what each set's merged mesh holds of the kit and the hair; those are then drawn only with the other set
  let mergeSrc: ((() => THREE.SkinnedMesh) | null)[] = [null, null], mergeRef: (THREE.SkinnedMesh | null)[] = [null, null], bodyDepth: THREE.MeshDepthMaterial | null = null;
  let kitIn: Set<THREE.SkinnedMesh>[] = [new Set(), new Set()], hairIn: (THREE.Object3D | null)[] = [null, null], kitSlots: string[] = [], kitCull = false, hairM: THREE.Matrix4 | null = null, kitShown = true;
  /** The separate kit and hair are drawn only where the set on show does not hold them. */
  function showKitHair() {
    shDirty = true;
    const sep = BODY_MERGE.separate, u = bodyMat?.userData.u as Record<string, { value: number }> | undefined;
    // the A/B: each merged set swaps for the body as main merged it (its morphs in three.js's texture, nothing baked)
    for (let s = 0; s < 2; s++) {
      const mk = mergeSrc[s], m = lodSets[s][0];
      if (!mk || !m) continue;
      if (BODY_MERGE.separateBody && sep && !mergeRef[s]) mergeRef[s] = mk();
      const ref = mergeRef[s];
      if (!ref) continue;
      if (sep && BODY_MERGE.separateBody && !ref.visible && m.visible) { ref.visible = true; m.visible = false; }
      else if (!sep && ref.visible) { ref.visible = false; m.visible = true; }
    }
    for (const m of rigid) park(m, kitShown && (sep || !kitIn[lodOn].has(m)), kitIn[0].has(m) || kitIn[1].has(m));
    if (u?.uKitOn) u.uKitOn.value = kitShown && !sep ? 1 : 0;
    if (u?.uHairOn) u.uHairOn.value = sep ? 0 : 1;
    hairs.forEach((h, i) => { if (h) park(h, (hairs[1] ? hairOn === i : i === 0) && (sep || !hairIn[lodOn]), hairIn[0] === h || hairIn[1] === h); });
  }
  // kit and hair a merged set holds are taken out of the scene graph while they are not drawn on their own (three.js's
  // matrix pass walked them every frame); they go back on their bone when they are
  const parkedOn = new Map<THREE.Object3D, THREE.Object3D>();
  function park(o: THREE.Object3D, show: boolean, merged: boolean) {
    o.visible = show;
    const at = parkedOn.get(o);
    if (show && at) { at.add(o); parkedOn.delete(o); }
    else if (!show && merged && !at && o.parent) { parkedOn.set(o, o.parent); o.removeFromParent(); }
  }
  function mergeCrowd() {
    if (!(crowd || mergeWanted) || !bodyMats || !BODY_MERGE.on) return;
    const { skin, cloth, eyes, sphere } = bodyMats;
    for (let s = 0; s < lodSets.length; s++) {
      const set = lodSets[s];
      if (!set.length || set.some((m) => m.material === bodyMat)) continue;
      const pick = (mat: THREE.Material) => set.find((m) => m.material === mat);
      const cl = pick(cloth), sk = pick(skin), ey = pick(eyes);
      if (!cl || !sk) continue;
      const parts = [{ mesh: cl, part: BODY_PARTS.cloth }, { mesh: sk, part: BODY_PARTS.skin }, ...(ey ? [{ mesh: ey, part: BODY_PARTS.eye }] : [])];
      // one skeleton, one bind, one parent and the same place: otherwise leave this set as it is
      if (parts.some((p) => p.mesh.parent !== sk.parent || !sameSkeleton(p.mesh.skeleton, sk.skeleton) || !p.mesh.bindMatrix.equals(sk.bindMatrix) || !p.mesh.matrix.equals(sk.matrix)
        || (p.mesh.geometry.morphAttributes.position && p.mesh.geometry.morphTargetsRelative !== sk.geometry.morphTargetsRelative) || Object.keys(p.mesh.geometry.morphAttributes).some((k) => k !== 'position'))) continue;
      // the rigid kit and the hair go in too (one draw a body, not three): the kit into every set; the light hair into
      // the light build; the one hair of a body without a light hair (phones) into both
      const extra: Parameters<typeof mergeBodyGeometry>[2] = [];
      let kitHere: THREE.SkinnedMesh[] = [], hairHere: THREE.Object3D | null = null;
      // the kit is skinned in the same bind space (rigid.ts binds it as the body's first mesh); a skinned mesh's own place
      // does not move its vertices (attached bind: its world matrix cancels), so only the skeleton and the bind must match
      // (a different bind is taken into this one's: sk bind inverse x the kit's bind)
      const bound = rigid.length && rigid.every((r) => sameSkeleton(r.skeleton, sk.skeleton));
      if (BODY_MERGE.extras && bound) {
        const k = kitParts(rigid, kitSlots, sk.bindMatrix);
        if (k.parts.length) { extra.push(...k.parts); kitHere = k.parts.map((p) => p.from); kitCull ||= k.cull; }
      }
      // a body with a light hair (Web, Ultra) keeps its near hair as its own mesh: the near set is merged before the
      // light build is in, and its far bodies drew their near hair until then (perf_gate's Web gate: 1.33 M triangles)
      const hs = s === 1 ? hairs[1] ?? hairs[0] : hairs[1] ? null : hairs[0];
      const hsAt = hs ? hs.parent ?? parkedOn.get(hs) ?? null : null;
      if (BODY_MERGE.extras && hs && (hs as THREE.Mesh).isMesh && hsAt) {
        const bi = sk.skeleton.bones.indexOf(hsAt as THREE.Bone);
        if (bi >= 0) {
          hs.updateMatrix();
          const hm = sk.bindMatrix.clone().invert().multiply(sk.skeleton.boneInverses[bi].clone().invert()).multiply(hs.matrix);
          const same = !hairM || hairM.elements.every((v, i) => Math.abs(v - hm.elements[i]) < 1e-6);
          const hp = same ? hairPart(hs as THREE.Mesh, bi, hm) : null;
          if (hp) { extra.push(hp); hairHere = hs; hairM ??= hm; }
        }
      }
      const keepN = crowd || mergeLite ? crowdKeep : keepAll;
      const { g, names } = mergeBodyGeometry(parts, keepN, extra);
      if (!bodyMat) { const f = showKitHair; BODY_MERGE.bodies.push(new WeakRef(f)); }
      bodyMat ??= bodyMaterial(skin, cloth, eyes, { kit: kitHere.length ? kitSlots.map((k) => rigid.map((r) => r.material as THREE.MeshStandardMaterial).find((m) => m.normalMap && `${m.normalMap.uuid}|${m.normalScale.x},${m.normalScale.y}` === k)!) : null, cull: kitCull, hair: hairHere && hairM ? { mat: (hairHere as THREE.Mesh).material as THREE.MeshStandardMaterial, m: hairM } : null, morphs: BODY_MERGE.morphs ? MAX_MORPHS : 0 });
      // a set merged after the material was made can only take what the material has
      const df = bodyMat.defines ?? {};
      if ((kitHere.length && df.BODY_KIT === undefined) || (kitCull && df.KIT_CULL === undefined)) console.warn('[crew] body merge: kit after the material');
      kitIn[s] = new Set(df.BODY_KIT !== undefined ? kitHere : []); hairIn[s] = df.BODY_HAIR !== undefined ? hairHere : null;
      const mesh = new THREE.SkinnedMesh(g, bodyMat);
      mesh.name = 'skin_body'; mesh.boundingSphere = sphere; g.boundingSphere = sphere;
      mesh.position.copy(sk.position); mesh.quaternion.copy(sk.quaternion); mesh.scale.copy(sk.scale);
      sk.parent!.add(mesh); mesh.bind(sk.skeleton, sk.bindMatrix);
      mesh.visible = sk.visible; mesh.receiveShadow = true; mesh.frustumCulled = sk.frustumCulled;
      // its own morph texture (bodymerge.ts): this mesh's shapes and weights before each draw, the shadow's too
      const bu = bodyMat.userData.u as Parameters<typeof morphUniforms>[0];
      mesh.onBeforeRender = function (r, sc, c) { morphUniforms(bu, mesh); seen.call(this, r, sc, c); };
      if (g.userData.morph) { mesh.onBeforeShadow = () => morphUniforms(bu, mesh); bodyDepth ??= bodyDepthMaterial(bodyMat); mesh.customDepthMaterial = bodyDepth; }
      mesh.castShadow = parts.some((p) => p.mesh.castShadow);
      if (parts.some((p) => castable.has(p.mesh))) castable.add(mesh);
      const weights = (ns: string[], m: THREE.SkinnedMesh) => { if (!ns.length) return; m.morphTargetDictionary = Object.fromEntries(ns.map((n, i) => [n, i])); m.morphTargetInfluences = ns.map((n) => { for (const p of parts) { const d = p.mesh.morphTargetDictionary; if (d && d[n] !== undefined) return p.mesh.morphTargetInfluences![d[n]]; } return morph[n] ?? 0; }); faces.push({ dict: m.morphTargetDictionary, infl: m.morphTargetInfluences }); };
      weights(names, mesh); morphVertex(mesh);
      // the test hook's other half (BODY_MERGE.setSeparate): the body as main drew it, for an A/B of one frame
      mergeSrc[s] = () => { const r = mergeBodyGeometry(parts, keepN, [], true); const m = new THREE.SkinnedMesh(r.g, bodyMat!); m.name = 'skin_body_ref'; m.boundingSphere = sphere; m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale); mesh.parent!.add(m); m.bind(mesh.skeleton, mesh.bindMatrix); m.visible = false; m.frustumCulled = mesh.frustumCulled; m.receiveShadow = true; m.castShadow = mesh.castShadow; m.onBeforeRender = () => morphUniforms(bu, m); weights(r.names, m); r.names.forEach((n, i) => { const j = mesh.morphTargetDictionary?.[n]; if (j !== undefined) m.morphTargetInfluences![i] = mesh.morphTargetInfluences![j]; }); return m; };
      for (const p of parts) {
        castable.delete(p.mesh); p.mesh.removeFromParent();
        const fi = faces.findIndex((f) => f.infl === p.mesh.morphTargetInfluences); if (fi >= 0) faces.splice(fi, 1);
        const ti = torsoBody.indexOf(p.mesh); if (ti >= 0) torsoBody.splice(ti, 1);
      }
      if (s === 0 && torsoR === null) torsoBody.unshift(mesh);
      lodSets[s] = [mesh, ...set.filter((m) => !parts.some((p) => p.mesh === m))];
      BODY_MERGE.merged++;
    }
    showKitHair();
    if (bodyMat && !fadeSet.some((f) => f.m === bodyMat)) {
      fadeSet = fadeSet.filter((f) => f.m !== skin && f.m !== cloth && f.m !== eyes);
      fadeSet.unshift({ m: bodyMat, o: bodyMat.opacity, a: bodyMat.alphaTest });
    }
  }
  function prepFade() {
    mergeCrowd();
    fadeOn = crowd && lod === 0 && fadeSet.length > 0;
    // solid materials fade by hashed alpha; see-through ones (cornea, lashes) by their opacity; cut-out ones (hair
    // cards) thin out by their alpha cut
    if (fadeOn) for (const f of fadeSet) if (!f.m.alphaHash && !f.m.transparent && f.m.alphaTest === 0) { f.m.alphaHash = true; f.m.needsUpdate = true; }
  }
  function setFade(k: number) {
    const vis = k > 0.03;
    if (fig.visible !== vis) fig.visible = vis;
    if (!vis || Math.abs(k - fadeShown) < 0.004) return;
    fadeShown = k;
    for (const f of fadeSet) { if (f.a > 0) f.m.alphaTest = 1 - (1 - f.a) * k; else f.m.opacity = f.o * k; }
    kitShown = k > 0.6; showKitHair();
  }
  let pitK: CrewMeta['pit'] | null = null;
  // per region: its shapes' morph names and the bones from just below its reference down to its driving bone
  let corrRegions: { k: NonNullable<CrewMeta['pit']>[string]; keys: string[]; chain: THREE.Object3D[]; phi: Float64Array }[] = [];
  // how this body is seen (CHAR_BUDGET): animate() calls since a game camera last drew it, and that camera's distance
  let perfStamp = 0;
  let sinceDrawn = 99, camD = 0, skipN = 0, skipDt = 0, corrOn = false, corrN = 0, crowd = false;
  let lodSets: THREE.SkinnedMesh[][] = [[], []], lodOn = 0, rigid: THREE.SkinnedMesh[] = [], hairs: [THREE.Object3D | null, THREE.Object3D | null] = [null, null], hairOn = 0;
  const castable = new Set<THREE.Object3D>(); // the meshes that cast a shadow when near
  // what casts: the first time a mesh under the body is seen (applyShadows), it casts if it was made to; from then on
  // only while the body casts (pickLod). Bits added later (the kit, the light build, a held phone) are switched with
  // it: on phones nothing that moves was meant to cast in the city, but the kit's phone, the player's body (Away.enter)
  // and held props did, so every redraw of the static sun shadow drew them (perf_gate's phone gate: 151 draws in that
  // frame, 117 in the others)
  const shSeen = new WeakSet<THREE.Object3D>();
  let shadowsOn = true, shDirty = true;
  function applyShadows() {
    shDirty = false;
    root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (!shSeen.has(m)) { shSeen.add(m); if (m.castShadow) castable.add(m); } m.castShadow = shadowsOn && castable.has(m); });
    for (const set of [...lodSets, rigid]) for (const m of set) m.castShadow = shadowsOn && castable.has(m);
  }
  function pickLod() {
    // not drawn last frame (hidden, off the screen, or never drawn yet): camD is from its last draw (0 if never), so a
    // body shown again took the build of where it was last seen; use the last camera's distance to where it is now
    if (sinceDrawn >= 1 && LENS.y > -1e5) {
      V5.copy(root.position); if (root.parent) V5.applyMatrix4(root.parent.matrixWorld);
      camD = V5.distanceTo(LENS);
    }
    // a far body's shadow is a few pixels: it is left out of the shadow map
    const sh = camD < (crowd ? CHAR_BUDGET.crowdShadowFar : CHAR_BUDGET.shadowFar) * (shadowsOn ? 1.1 : 0.9);
    if (sh !== shadowsOn || shDirty) { shadowsOn = sh; applyShadows(); }
    // phones: the corneas' shine and the lashes and brows are under a pixel past a few metres, and a draw call each
    if (lod === 1 || crowd) for (const m of lodSets[lod === 1 ? 0 : lodOn]) {
      const far = (crowd ? CROWD_FACE_FAR : FACE_FAR)[m.name];
      if (far) m.visible = camD < far * (m.visible ? 1.1 : 0.9);
    }
    for (const h of hairs) if (h) h.castShadow = sh;
    // in the city a body changes its build or hair only while it is off the screen (not drawn last frame) or far off
    // (CHAR_BUDGET.lodSwapFar, 0 elsewhere): switching at 6 m in front of you read as their clothes and hair changing
    if (sinceDrawn < 1 && camD < CHAR_BUDGET.lodSwapFar) return;
    const wantH = hairs[1] && camD > (crowd ? CHAR_BUDGET.crowdLodFar : CHAR_BUDGET.lodFar) * (hairOn ? 0.9 : 1.1) ? 1 : 0;
    if (wantH !== hairOn) { hairOn = wantH; showKitHair(); }
    if (!lodSets[1].length) return;
    const want = camD > (crowd ? CHAR_BUDGET.crowdLodFar : CHAR_BUDGET.lodFar) * (lodOn ? 0.9 : 1.1) ? 1 : 0;
    if (want === lodOn) return;
    lodOn = want;
    for (const m of lodSets[0]) m.visible = want === 0;
    for (const m of lodSets[1]) m.visible = want === 1;
    showKitHair();
  }
  function seen(this: THREE.Object3D, _r: THREE.WebGLRenderer, _s: THREE.Scene, c: THREE.Camera) {
    if (!(c as THREE.PerspectiveCamera).isPerspectiveCamera) return; // the sun's shadow camera does not count
    sinceDrawn = 0; perfStamp = perfBody(perfStamp);
    const a = c.matrixWorld.elements, b = this.matrixWorld.elements;
    LENS.set(a[12], a[13], a[14]);
    camD = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
  }
  // the torso as the arm guards see it: per segment (hips to spine1, spine1 to chest, chest to neck) an elliptic
  // cylinder round the bone line, its half width and its depth in front and behind measured from this body's skin and
  // clothes (bind units; torsoLen scales them to the posed segment). A round capsule could not fit: the hips are wider
  // than deep, and one radius either read a hand hanging beside the hip as 6 to 14 cm inside or let fingers into a
  // bulky sweater's side
  let thighR: { L: number; R: number } | null = null; // thighsOut: each thigh's radius, skin and cloth
  let torsoR: { x: number; f: number; b: number }[] | null = null, torsoLen: number[] = [], torsoBody: THREE.SkinnedMesh[] = []; // read by keepArmsOut
  const TI = { ab: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), f: new THREE.Vector3(), l: new THREE.Vector3(), q: new THREE.Quaternion() };
  /** How far p is inside torso segment j (a to b, world) grown by `margin`, m (negative outside); `out`, if given, gets
   *  the point on that grown surface straight out from the bone line through p. */
  function torsoIn(j: number, a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, margin: number, out?: THREE.Vector3) {
    const R = torsoR![j], ab = TI.ab.copy(b).sub(a), L2 = ab.lengthSq(); if (L2 < 1e-10) return -1;
    const t = clamp(TI.d.copy(p).sub(a).dot(ab) / L2, 0, 1), c = TI.c.copy(a).addScaledVector(ab, t), d = TI.d.copy(p).sub(c);
    const s = Math.sqrt(L2) / (torsoLen[j] || 1), axn = ab.normalize();
    const f = TI.f.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(TI.q)); f.addScaledVector(axn, -f.dot(axn)); if (f.lengthSq() < 1e-8) return -1; f.normalize();
    const l = TI.l.crossVectors(axn, f);
    // across the bone line the section is an ellipse; past either end (t clamped) the end is rounded like a capsule's
    const dx = d.dot(l), dz = d.dot(f), rx = R.x * s + margin, rz = (dz >= 0 ? R.f : R.b) * s + margin;
    const e = Math.hypot(dx / rx, dz / rz), dp = Math.hypot(dx, dz), dl = d.length();
    const rd = e < 1e-6 ? rz : dp / e;
    if (out) { if (dl < 1e-6) out.copy(c).addScaledVector(f, rz); else out.copy(c).addScaledVector(d, rd / dl); }
    return rd - dl;
  }
  const go = () => { const a = animNow(), as = assetNow(key, lod); if (a && as) { attach(as, a); return true; } return false; };
  if (!go()) Promise.all([loadAnim(), loadAsset(key, lod)]).then(([a, as]) => attach(as, a)).catch((e) => console.error('[crew]', key, e));

  function action(name: string, manual: boolean) {
    let s = acts.get(name);
    if (!s) {
      const clip = clips!.get(name)!;
      const a = mixer!.clipAction(clip);
      const meta = A!.meta[name];
      if (meta.kind === 'once') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play();
      a.setEffectiveWeight(0);
      if (!manual) a.time = Math.random() * clip.duration;
      s = { a, w: 0, target: 0, manual };
      acts.set(name, s);
    }
    return s;
  }

  function setMorph(k: string, v: number) { morph[k] = v; for (const f of faces) { const i = f.dict[k]; if (i !== undefined) f.infl[i] = v; } }
  const easeMorph = (k: string, v: number, r: number) => setMorph(k, (morph[k] ?? 0) + (v - (morph[k] ?? 0)) * r);

  let limpOn = false;

  /** Hands never sink into the thighs (seated, the clip's hands rest on the lap and wide trousers swallowed the fingers:
   *  the townsman's worst flag, 195 px): a capsule per thigh from its own skin and cloth, the hand moved out of it by
   *  the arm, the push eased per hand. */
  const thighPush = { L: new THREE.Vector3(), R: new THREE.Vector3() }, thighW = { L: 0, R: 0 };
  function thighsOut(bs: Map<string, THREE.Bone>, dt: number) {
    if (!torsoBody.length) return;
    const own = limbs?.ownArms ?? armOwner;
    root.updateWorldMatrix(true, true);
    const wp = (n: string) => new THREE.Vector3().setFromMatrixPosition(bs.get(n)!.matrixWorld);
    const legs = (['L', 'R'] as const).map((sd) => [wp(`upperleg${sd}`), wp(`lowerleg${sd}`)] as const);
    if (!thighR) {
      const per: { L: number[]; R: number[] } = { L: [], R: [] }, v = new THREE.Vector3();
      for (const m of torsoBody) {
        m.updateWorldMatrix(true, false);
        const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
        for (let i = 0, n = m.geometry.attributes.position.count; i < n; i += 3) {
          let mb = 0, mw = -1; for (let q = 0; q < 4; q++) { const wq = sw.getComponent(i, q); if (wq > mw) { mw = wq; mb = si.getComponent(i, q); } }
          const bn = m.skeleton.bones[mb]?.name; const sd = bn === 'upperlegL' ? 'L' : bn === 'upperlegR' ? 'R' : null; if (!sd) continue;
          m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
          const [a, b] = legs[sd === 'L' ? 0 : 1], ab = SB.copy(b).sub(a), tt = SA.copy(v).sub(a).dot(ab) / ab.lengthSq();
          if (tt < 0.2 || tt > 0.85) continue;
          per[sd].push(segDist(v, a, b));
        }
      }
      const pc = (x: number[]) => { x.sort((a, b) => a - b); return x.length ? x[Math.floor(x.length * 0.6)] : 0.08; };
      thighR = { L: pc(per.L), R: pc(per.R) };
    }
    for (const s of ['L', 'R'] as const) {
      const hd = bs.get(`hand${s}`)!, f = bs.get(`finger3_2${s}`), push = V4.set(0, 0, 0);
      // only where the hand can rest on a thigh: seated, crouched, kneeling (thigh within 50 degrees of level). Standing,
      // the hands hang beside upright thighs and the guard nudged them every frame (idle jerk 0.1 to 1.2 cm), and where
      // it then stopped for a hold or a task the arm snapped back (10 to 30 cm jerks: full9)
      const busy = own === 'both' || own === s || (hold?.[s] && holdW[s] > 0.01) || (task && (task.hands === 'both' || task.hands === s));
      if (!busy) for (const p of [wp(`hand${s}`), f ? wp(`finger3_2${s}`) : null]) {
        if (!p) continue;
        for (const [k, [a, b]] of legs.entries()) {
          if (Math.abs(V5.copy(b).sub(a).normalize().y) > 0.64) continue;
          const r = (k === 0 ? thighR.L : thighR.R) + 0.012, ab = SB.copy(b).sub(a), tt = clamp(SA.copy(p).sub(a).dot(ab) / ab.lengthSq(), 0, 1);
          const c = SA.copy(a).addScaledVector(ab, tt), d = V5.copy(p).sub(c), dl = d.length();
          if (dl < r && dl > 1e-5) { d.multiplyScalar((r - dl) / dl); if (d.length() > push.length()) push.copy(d); }
        }
      }
      if (push.length() > 0.06) push.setLength(0.06);
      if (own === 'both' || own === s) { thighW[s] = 0; thighPush[s].set(0, 0, 0); continue; }
      thighPush[s].lerp(push, 1 - Math.exp(-dt * 12));
      thighW[s] += (clamp(thighPush[s].length() / 0.01, 0, 1) - thighW[s]) * (1 - Math.exp(-dt * 8));
      if (thighW[s] < 0.01) continue;
      const up = bs.get(`upperarm${s}`)!, lo = bs.get(`lowerarm${s}`)!;
      armTo(bs, s, up, lo, hd, hd.getWorldPosition(new THREE.Vector3()).add(thighPush[s]), thighW[s], dt);
    }
  }
  /** Hands and forearms never sink into the torso: the upper arm swings out just enough to clear it. */
  function keepArmsOut(bs: Map<string, THREE.Bone>) {
    if (!torsoR && !torsoBody.length) return;
    root.updateWorldMatrix(true, true);
    // world matrices are fresh from the update above: read positions straight off them, no walk up the parents
    const wp = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const seg = TORSO.map(([a, b]) => [wp(bs.get(a)!), wp(bs.get(b)!)] as const);
    if (!torsoR) {
      // the skinned, morphed skin as it really stands, in world space: the raw attribute is not the body you see
      const per = TORSO.map(() => ({ x: [] as number[], f: [] as number[], b: [] as number[] })), v = new THREE.Vector3();
      // clothes count only above the hips: a coat's skirt flares away from the body and is not torso
      const hip = seg[0][0], up = seg[2][1].clone().sub(hip), upL2 = up.lengthSq();
      const fwdW = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
      for (const m of torsoBody) {
        m.updateWorldMatrix(true, false);
        const clothN = m.geometry.userData.clothCount ?? (m.name === 'cloth' ? Infinity : 0); // a merged crowd body: its cloth comes first
        const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
        for (let i = 0, n = m.geometry.userData.torsoCount ?? m.geometry.attributes.position.count; i < n; i += 2) {
          // the torso's own skin and cloth only (main bone hips to neck): arms and sleeves hang within 30 cm of the spine
          let mb = 0, mw = -1; for (let q = 0; q < 4; q++) { const wq = sw.getComponent(i, q); if (wq > mw) { mw = wq; mb = si.getComponent(i, q); } }
          if (!TORSO_BONES.has(m.skeleton.bones[mb]?.name)) continue;
          m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); let best = 9, k = -1;
          if (i < clothN && SA.copy(v).sub(hip).dot(up) / upL2 < .05) continue;
          seg.forEach(([a, b], j) => { const d = segDist(v, a, b); if (d < best) { best = d; k = j; } });
          // only the front half (within 50 degrees of straight ahead): a reaching arm crosses the front, and the hips are
          // wider than deep, so a radius mixing the two read a hand hanging beside the hip as 6 to 14 cm inside
          if (k < 0 || best >= .3) continue;
          // sorted by which way the skin lies from the bone line: to the side, in front or behind (within 40 degrees)
          const [a, b] = seg[k], ab = SB.copy(b).sub(a), tt = clamp(V2.copy(v).sub(a).dot(ab) / ab.lengthSq(), 0, 1), rad = V2.copy(v).sub(a).addScaledVector(ab, -tt);
          const fz = rad.dot(V3.copy(fwdW).addScaledVector(ab, -fwdW.dot(ab) / ab.lengthSq()).normalize()), rl = rad.length();
          if (fz > 0.77 * rl) per[k].f.push(best); else if (fz < -0.77 * rl) per[k].b.push(best); else if (Math.abs(fz) < 0.64 * rl) per[k].x.push(best);
        }
      }
      const pc = (x: number[], d: number) => { x.sort((a, b) => a - b); return x.length ? x[Math.floor(x.length * .45)] : d; };
      torsoR = per.map((q) => { const x = pc(q.x, .12); return { x, f: pc(q.f, x * .8), b: pc(q.b, x * .7) }; });
      torsoLen = seg.map(([a, b]) => a.distanceTo(b));
    }
    const own = limbs?.ownArms ?? armOwner;
    for (const s of ['L', 'R']) {
      if (own === 'both' || own === s) continue; // an external pose owner has these arms (claimArms, Limbs.ownArms)
      const upper = bs.get(`upperarm${s}`)!, sh = wp(upper);
      let turned = 0;
      for (let it = 0; it < 7 && turned < .7; it++) {
        let worst = 0, at: THREE.Vector3 | null = null, axisPt: THREE.Vector3 | null = null;
        for (const n of [`hand${s}`, `finger3_2${s}`, `lowerarm${s}`]) {
          const bn = bs.get(n); if (!bn) continue; const p = wp(bn);
          seg.forEach(([a, b], j) => {
            const pen = torsoIn(j, a, b, p, 0.015);
            if (pen > worst) { worst = pen; at = p; const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); axisPt = a.clone().addScaledVector(ab, t); }
          });
        }
        if (!at || !axisPt || worst <= 0) break;
        // swing the arm about the shoulder, towards where that point would be clear of the body
        const arm = (at as THREE.Vector3).clone().sub(sh), away = (at as THREE.Vector3).clone().sub(axisPt as THREE.Vector3);
        // deep inside, the way out from the spine says little: lean on the arm's own side, the elbow goes out
        const [ca, cb] = seg[1], cab = cb.clone().sub(ca), side = sh.clone().sub(ca.clone().addScaledVector(cab, Math.max(0, Math.min(1, sh.clone().sub(ca).dot(cab) / cab.lengthSq()))));
        side.addScaledVector(cab, -side.dot(cab) / cab.lengthSq());
        if (away.lengthSq() > 1e-8) away.normalize();
        if (side.lengthSq() > 1e-8) away.addScaledVector(side.normalize(), 1.5);
        if (away.lengthSq() < 1e-8) away.copy(new THREE.Vector3(s === 'L' ? 1 : -1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
        const axis = new THREE.Vector3().crossVectors(arm, away.normalize());
        if (axis.lengthSq() < 1e-8) break;
        const ang = Math.min(.5, .7 - turned, worst / Math.max(.2, arm.length()) * 1.3); turned += ang;
        worldRotate(upper, new THREE.Quaternion().setFromAxisAngle(axis.normalize(), ang));
        upper.updateWorldMatrix(false, true);
      }
    }
  }

  // ---- arm IK guards (setHold): a held hand never goes inside the body, and the elbow always points out and down ----
  // per hand: where the hand is aimed (the target plus an offset that springs to zero), the last target in body space
  // (a hold let go eases out from there), and the target's last position (a jump in it goes into the offset)
  type HoldState = { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; on: boolean; fresh?: boolean; off: THREE.Vector3; offV: THREE.Vector3; prev: THREE.Vector3; loc: THREE.Vector3; last: HoldSide };
  const holdS: { L?: HoldState; R?: HoldState } = {};
  const FA = { e: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion() };
  /** A hand target inside the torso (hips to neck capsules, plus a hand's thickness) is moved out to its surface. With
   *  `fingers` (the way the held hand's fingers point) and `reach` (wrist to fingertip, m), the middle of the fingers and
   *  their tips are kept out too, a finger's thickness off the surface: a hold starting from the side or reaching across
   *  ran the fingertips 3 to 5 cm into the chest (the wrist alone was guarded). */
  const fingerPush = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  const taskPushW = { L: 0, R: 0 };
  // a clip task's IK goal, followed with a lag so the hand eases into the contact (RIG_OPTS.contactEase per second)
  const taskTgt = { L: new THREE.Vector3(), R: new THREE.Vector3() }, taskTgtOn = { L: false, R: false };
  // at most this far per test point: a target given inside the chest with the fingers across it (reach_inside) pushed
  // the goal 10 cm and more sideways, the arm folded through the body (22.7 cm) and the hand jumped 30 cm
  const FINGER_PUSH_MAX = 0.04;
  const HO = { p0: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), o: new THREE.Vector3(), q: new THREE.Vector3() };
  function holdOut(bs: Map<string, THREE.Bone>, p: THREE.Vector3, fingers?: THREE.Vector3, reach = 0) {
    if (!torsoR) return p;
    // the fingers first, their whole push capped; then the wrist
    // (not when the wrist's own goal is inside: the wrist guard takes it out, and the two pushes fought, the hand
    // jumping 10 to 20 cm on a target given inside the chest)
    let wristIn = false;
    for (let j = 0; j < TORSO.length && !wristIn; j++) wristIn = torsoIn(j, bs.get(TORSO[j][0])!.getWorldPosition(HO.a), bs.get(TORSO[j][1])!.getWorldPosition(HO.b), p, 0.045) > 0;
    if (fingers && reach > 0 && !wristIn) {
      const p0 = HO.p0.copy(p);
      for (let it = 0; it < 2; it++) for (let j = 0; j < TORSO.length; j++) {
        const a = bs.get(TORSO[j][0])!.getWorldPosition(HO.a), b = bs.get(TORSO[j][1])!.getWorldPosition(HO.b);
        for (const k of [0.55, 1]) {
          const q = HO.q.copy(p).addScaledVector(fingers, reach * k);
          if (torsoIn(j, a, b, q, 0.012, HO.o) > 0) p.add(HO.o.sub(q));
        }
      }
      const d = HO.o.copy(p).sub(p0), l = d.length(); if (l > FINGER_PUSH_MAX) p.copy(p0).addScaledVector(d, FINGER_PUSH_MAX / l);
    }
    for (let j = 0; j < TORSO.length; j++) {
      const a = bs.get(TORSO[j][0])!.getWorldPosition(HO.a), b = bs.get(TORSO[j][1])!.getWorldPosition(HO.b);
      if (torsoIn(j, a, b, p, 0.045, HO.o) > 0) p.copy(HO.o);
    }
    return p;
  }
  /** Turn the arm about the shoulder-to-wrist line (the hand stays put) so the elbow points out from the body and down:
   *  the two-bone solve kept whatever bend plane the clip had, and a straightish arm flipped its elbow into the ribs. */
  // the elbow's way out, per arm, in body space: eased so it can never flip in a frame (the throw's wind back took the
  // hand to just where the pole points, the pole's part across the arm vanished and the elbow jumped 30 cm in 2 frames)
  const elbowDir = { L: new THREE.Vector3(), R: new THREE.Vector3() }, elbowAt = { L: -1, R: -1 };
  let rigClock = 0;
  function elbowOut(bs: Map<string, THREE.Bone>, sd: 'L' | 'R', up: THREE.Bone, lo: THREE.Bone, hd: THREE.Bone, dt: number, hint?: Dir) {
    const sh = up.getWorldPosition(new THREE.Vector3()), el = lo.getWorldPosition(new THREE.Vector3()), wr = hd.getWorldPosition(new THREE.Vector3());
    const ax = wr.clone().sub(sh); if (ax.lengthSq() < 1e-6) return; ax.normalize();
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    const sx = sd === 'L' ? 1 : -1;
    // out, down and a little back; where the arm itself points that way, out and up (a hand wound back over the shoulder)
    const across = (v: THREE.Vector3) => v.applyQuaternion(rq).addScaledVector(ax, -v.dot(ax));
    const p1 = across(new THREE.Vector3(sx, -0.9, -0.3)), p2 = across(new THREE.Vector3(sx * 0.8, 0.6, -0.2));
    const l1 = p1.length(), pw = clamp((l1 / Math.hypot(1, 0.9, 0.3) - 0.3) / 0.35, 0, 1);
    let pole = p1.normalize().multiplyScalar(pw).addScaledVector(p2.normalize(), 1 - pw);
    // a caller that knows the arm's job gives its own way out (a cup at the lips, the hand across the face seated: the arm
    // pointed across the body, the pole switched to "out and up" and the elbow swung 20 cm up in two frames)
    if (hint) { const h = across(new THREE.Vector3(hint[0] * sx, hint[1], hint[2])); if (h.lengthSq() > 0.04) pole = h.normalize(); }
    if (pole.lengthSq() < 1e-6) return;
    // eased in body space; a fresh solve (not run last frame) starts on the pole
    const want = pole.normalize().clone().applyQuaternion(rq.clone().invert()), st = elbowDir[sd];
    if (elbowAt[sd] < 0 || rigClock - elbowAt[sd] > 0.1 || st.lengthSq() < 0.5) st.copy(want); else st.lerp(want, 1 - Math.exp(-dt * 14)).normalize();
    elbowAt[sd] = rigClock;
    const goal = st.clone().applyQuaternion(rq); goal.addScaledVector(ax, -goal.dot(ax));
    const cur = el.sub(sh); cur.addScaledVector(ax, -cur.dot(ax));
    if (cur.lengthSq() < 1e-6 || goal.lengthSq() < 1e-6) return;
    cur.normalize(); goal.normalize();
    const ang = Math.atan2(new THREE.Vector3().crossVectors(cur, goal).dot(ax), cur.dot(goal));
    if (!Number.isFinite(ang) || Math.abs(ang) < 1e-3) return;
    worldRotate(up, new THREE.Quaternion().setFromAxisAngle(ax, ang));
    up.updateWorldMatrix(false, true);
    void bs;
  }

  /** How far the elbow or the middle of the forearm is inside the torso (capsules plus a forearm's thickness), m. */
  function forearmPen(bs: Map<string, THREE.Bone>, lo: THREE.Bone, hd: THREE.Bone) {
    if (!torsoR) return 0;
    const el = lo.getWorldPosition(FA.e), wr = hd.getWorldPosition(FA.w), mid = FA.m.copy(el).lerp(wr, 0.5);
    let pen = 0;
    for (let j = 0; j < TORSO.length; j++) {
      const a = bs.get(TORSO[j][0])!.getWorldPosition(FA.a), b = bs.get(TORSO[j][1])!.getWorldPosition(FA.b);
      for (const p of [el, mid]) pen = Math.max(pen, torsoIn(j, a, b, p, 0.035));
    }
    return pen;
  }
  /** After the solve: an elbow or forearm inside the body is swung out about the shoulder-to-wrist line (the hand stays
   *  on what it holds), the smallest turn that clears it ("the arms go inside the person": only the wrist point was
   *  kept out of the torso, and a hand held at the hip laid the forearm through it). */
  // the swing is eased per arm (picked fresh each frame from a few steps, the elbow flicked between them)
  const faAng = { L: 0, R: 0 };
  function forearmOut(bs: Map<string, THREE.Bone>, sd: 'L' | 'R', up: THREE.Bone, lo: THREE.Bone, hd: THREE.Bone, dt: number) {
    const p0 = forearmPen(bs, lo, hd);
    const sh = up.getWorldPosition(new THREE.Vector3()), ax = hd.getWorldPosition(new THREE.Vector3()).sub(sh);
    if (ax.lengthSq() < 1e-6) return; ax.normalize();
    const q0 = up.quaternion.clone(); let best = 0, bestPen = p0;
    // the search starts on the side the arm is already swung to, so the choice does not flip from side to side
    const sg = faAng[sd] < 0 ? -1 : 1;
    if (p0 > 0) for (const a of [0.15, 0.3, 0.5, 0.75, 1.0].flatMap((v) => [v * sg, -v * sg])) {
      up.quaternion.copy(q0); worldRotate(up, FA.q.setFromAxisAngle(ax, a)); up.updateWorldMatrix(false, true);
      const pn = forearmPen(bs, lo, hd);
      if (pn < bestPen - 1e-4) { bestPen = pn; best = a; }
      if (pn <= 0) break;
    }
    // ease towards the chosen swing; back to none once clear (a held swing, if that would put it back in, stays)
    let want = best;
    if (p0 <= 0 && faAng[sd]) {
      up.quaternion.copy(q0); worldRotate(up, FA.q.setFromAxisAngle(ax, faAng[sd] * 0.8)); up.updateWorldMatrix(false, true);
      if (forearmPen(bs, lo, hd) > 0) want = faAng[sd];
    }
    faAng[sd] += (want - faAng[sd]) * (1 - Math.exp(-dt * 10));
    if (Math.abs(faAng[sd]) < 1e-3) faAng[sd] = 0;
    up.quaternion.copy(q0); if (faAng[sd]) worldRotate(up, FA.q.setFromAxisAngle(ax, faAng[sd])); up.updateWorldMatrix(false, true);
  }

  /** An arm to a hand goal, weighted by w: solved in full with its guards, then the joint turns blended from the clip's
   *  by w (an arc about the shoulder). Blending the goal instead (tried 2026-11-23) ran a phone's hand straight through
   *  the head on the way down and made task starts jerk 10 to 40 cm. */
  function armTo(bs: Map<string, THREE.Bone>, sd: 'L' | 'R', up: THREE.Bone, lo: THREE.Bone, hd: THREE.Bone, goal: THREE.Vector3, w: number, dt: number, fingers?: THREE.Vector3, reach = 0, guard = 1, hint?: Dir) {
    const qu = AT.u.copy(up.quaternion), ql = AT.l.copy(lo.quaternion);
    if (guard >= 1) holdOut(bs, goal, fingers, reach); else if (guard > 0) goal.lerp(holdOut(bs, AT.g.copy(goal), fingers, reach), guard);
    solveLeg(up, lo, hd, goal); elbowOut(bs, sd, up, lo, hd, dt, hint); forearmOut(bs, sd, up, lo, hd, dt);
    up.quaternion.copy(qu.slerp(up.quaternion, w)); lo.quaternion.copy(ql.slerp(lo.quaternion, w)); up.updateWorldMatrix(false, true);
  }
  const AT = { u: new THREE.Quaternion(), l: new THREE.Quaternion(), g: new THREE.Vector3() };
  const handTurn = { L: new THREE.Quaternion(), R: new THREE.Quaternion() }, HT = { d: new THREE.Quaternion(), i: new THREE.Quaternion(), ax: new THREE.Vector3() };
  const GQ = { q0: new THREE.Quaternion(), qi: new THREE.Quaternion(), q: new THREE.Quaternion(), a: new THREE.Vector3(), b: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), l: new THREE.Matrix4(), m: new THREE.Matrix4() };
  const RA = { on: false, cur: new THREE.Quaternion(), want: new THREE.Quaternion(), cl: { L: new THREE.Quaternion(), R: new THREE.Quaternion() }, q: new THREE.Quaternion(), r: new THREE.Quaternion(), ri: new THREE.Quaternion(),
    c: new THREE.Vector3(), s: new THREE.Vector3(), e: new THREE.Vector3(), w: new THREE.Vector3(), f: new THREE.Vector3(), g: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), x: new THREE.Vector3() };
  /** How far a held hand's goal is past 0.92 of its arm from where its shoulder is (m, 0 if within), and the goal. */
  function reachShort(bs: Map<string, THREE.Bone>, sd: 'L' | 'R', h: HoldSide, sh: THREE.Vector3) {
    const lo = bs.get(`lowerarm${sd}`)!, hd = bs.get(`hand${sd}`)!, f3 = bs.get(`finger3_1${sd}`)!, up = bs.get(`upperarm${sd}`)!;
    const el = lo.getWorldPosition(RA.e), wr = hd.getWorldPosition(RA.w), len = up.getWorldPosition(RA.a).distanceTo(el) + el.distanceTo(wr);
    const goal = h.grasp ? graspWrist(RA.g, h.at, h.fingers, h.palm, clamp(h.radius ?? 0.02, 0, 0.08), wr.distanceTo(f3.getWorldPosition(RA.f)), h.along ?? 0.6) : RA.g.copy(h.at);
    if (!Number.isFinite(goal.x + goal.y + goal.z)) return 0;
    return Math.max(0, sh.distanceTo(goal) - 0.92 * len);
  }
  function reachFor(bs: Map<string, THREE.Bone>, spine1: THREE.Bone, chestB: THREE.Bone, dt: number) {
    root.updateWorldMatrix(true, true);
    root.getWorldQuaternion(RA.r); RA.ri.copy(RA.r).invert();
    const ek = 1 - Math.exp(-dt * 6);
    // the chest: the turn about its own joint that brings the shoulders nearer their goals
    const ch = chestB.getWorldPosition(RA.c), want = RA.want.identity();
    for (let it = 0; it < 2; it++) for (const sd of ['L', 'R'] as const) {
      const h = hold?.[sd]; if (!h || task || holdW[sd] < 0.01) continue;
      const sh = bs.get(`upperarm${sd}`)!.getWorldPosition(RA.s).sub(ch).applyQuaternion(want).add(ch);
      const short = reachShort(bs, sd, h, sh); if (short <= 0) continue;
      const a = sh.sub(ch), b = RA.b.copy(RA.g).sub(ch), ax = RA.x.crossVectors(a, b);
      if (ax.lengthSq() < 1e-10) continue;
      // never more than the angle between the shoulder's way and the goal's (near parallel, the cross product's axis
      // is noise: a full turn about it put the shoulder 5 cm off for a frame)
      want.premultiply(RA.q.setFromAxisAngle(ax.normalize(), Math.min(short / Math.max(0.15, a.length()), 0.35, a.angleTo(b)) * holdW[sd] * 0.6));
    }
    // at most 0.45 rad (26 degrees) in all; eased in body space so it rides with the body
    const ang = 2 * Math.acos(clamp(Math.abs(want.w), 0, 1)); if (ang > 0.45) want.slerp(RA.q.identity(), 1 - 0.45 / ang);
    RA.q.copy(RA.ri).multiply(want).multiply(RA.r);
    RA.cur.slerp(RA.q, ek);
    const big = 1 - Math.abs(RA.cur.w) > 1e-6;
    if (big) {
      const W = RA.q.copy(RA.r).multiply(RA.cur).multiply(RA.ri);
      // 40% in the spine below the chest, the rest in the chest
      worldRotate(spine1, new THREE.Quaternion().slerp(W, 0.4)); spine1.updateWorldMatrix(false, true);
      worldRotate(chestB, new THREE.Quaternion().slerp(W, 0.6)); chestB.updateWorldMatrix(false, true);
    }
    // the collarbone: what is still short, the shoulder brought forward or up (at most 0.3 rad)
    let on = big;
    for (const sd of ['L', 'R'] as const) {
      const cl = bs.get(`clavicle${sd}`), h = hold?.[sd];
      if (!cl) continue;
      RA.q.identity();
      if (h && !task && holdW[sd] >= 0.01) {
        const sh = bs.get(`upperarm${sd}`)!.getWorldPosition(RA.s), short = reachShort(bs, sd, h, sh);
        if (short > 0) {
          const c0 = cl.getWorldPosition(RA.c), a = sh.clone().sub(c0), b = RA.b.copy(RA.g).sub(c0), ax = RA.x.crossVectors(a, b);
          if (ax.lengthSq() > 1e-10) RA.q.setFromAxisAngle(ax.normalize(), Math.min(short / Math.max(0.08, a.length()), 0.3, a.angleTo(b)) * holdW[sd]).premultiply(RA.ri).multiply(RA.r);
        }
      }
      RA.cl[sd].slerp(RA.q, ek);
      if (1 - Math.abs(RA.cl[sd].w) > 1e-6) { on = true; worldRotate(cl, RA.q.copy(RA.r).multiply(RA.cl[sd]).multiply(RA.ri)); cl.updateWorldMatrix(false, true); }
    }
    RA.on = on;
  }

  function locomotion(speed: number, dt: number) {
    // stylised walk -> brisk walk -> run -> sprint, phase locked so feet stay in step
    const m = A!.meta;
    const walkV = (m[style.walk] ?? m.walk).speed * legScale, brisk = 1.25 * legScale * m.walk.speed, runV = m.run.speed * legScale * 1.15, sprintV = m.sprint.speed * legScale;
    const knots: [string, number][] = [[style.walk, Math.min(walkV * 1.2, brisk * 0.8)], ['walk', brisk], ['run', runV], ['sprint', sprintV]];
    const w = [0, 0, 0, 0];
    if (speed <= knots[0][1]) w[0] = 1;
    else if (speed >= knots[3][1]) w[3] = 1;
    else for (let i = 0; i < 3; i++) if (speed < knots[i + 1][1]) { const k = (speed - knots[i][1]) / (knots[i + 1][1] - knots[i][1]); w[i] = 1 - k; w[i + 1] = k; break; }
    let rate = 0, vel = 0;
    knots.forEach(([n], i) => { if (w[i] > 0) { const c = m[n]; rate += w[i] / c.dur; vel += w[i] * c.speed * legScale; } });
    gaitPhase = (gaitPhase + dt * rate * (speed / Math.max(vel, 0.05))) % 1;
    return knots.map(([n], i) => ({ n, w: w[i] }));
  }

  const aimAxis = new Map<string, THREE.Vector3>();
  /** Lays the set pose over the clip: each bone turns to point the requested way. */
  function applyLimbs(l: Limbs, bs: Map<string, THREE.Bone>) {
    if (l.bend) { bs.get('spine1')!.quaternion.multiply(Q.setFromEuler(E.set(l.bend * 0.5, 0, 0))); bs.get('chest')!.quaternion.multiply(Q.setFromEuler(E.set(l.bend * 0.5, 0, 0))); }
    if (l.twist) bs.get('chest')!.quaternion.multiply(Q.setFromEuler(E.set(0, l.twist, 0)));
    root.updateWorldMatrix(true, true);
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    const aim = (a: string, b: string, d?: Dir) => {
      if (!d) return;
      const p = bs.get(a)!, c = bs.get(b)!;
      p.updateWorldMatrix(true, true);
      const from = c.getWorldPosition(V3).sub(p.getWorldPosition(V4)).normalize();
      const to = V5.set(d[0], d[1], d[2]).normalize().applyQuaternion(rq);
      // nearly opposite, the shortest turn has no axis of its own and the limb's roll flips frame to frame:
      // keep turning about last frame's axis, then close the small gap that is left
      const ax = new THREE.Vector3().crossVectors(from, to), prev = aimAxis.get(a);
      if (ax.length() > .3 || !prev) { if (ax.lengthSq() > 1e-10) aimAxis.set(a, ax.normalize()); worldRotate(p, new THREE.Quaternion().setFromUnitVectors(from, to)); return; }
      const k = prev.clone().addScaledVector(from, -prev.dot(from));
      if (k.lengthSq() < 1e-6) { worldRotate(p, new THREE.Quaternion().setFromUnitVectors(from, to)); return; }
      k.normalize();
      const q1 = new THREE.Quaternion().setFromAxisAngle(k, Math.acos(THREE.MathUtils.clamp(from.dot(to), -1, 1)));
      const q = new THREE.Quaternion().setFromUnitVectors(from.clone().applyQuaternion(q1), to).multiply(q1);
      aimAxis.set(a, k); worldRotate(p, q);
    };
    aim('upperarmL', 'lowerarmL', l.armL); aim('lowerarmL', 'handL', l.foreL ?? l.armL);
    aim('upperarmR', 'lowerarmR', l.armR); aim('lowerarmR', 'handR', l.foreR ?? l.armR);
    aim('upperlegL', 'lowerlegL', l.legL); aim('lowerlegL', 'footL', l.shinL ?? l.legL);
    aim('upperlegR', 'lowerlegR', l.legR); aim('lowerlegR', 'footR', l.shinR ?? l.legR);
    if (l.openHands) handOpen = true;
  }

  /** On his knees: the thighs come down nearly upright (a little forward), the shins lie back along the ground, and the
   * hips drop until the knees touch it. Blended with whatever the clip does by how far down he is. */
  function kneelLegs(bs: Map<string, THREE.Bone>, hipsB: THREE.Bone) {
    root.updateWorldMatrix(true, true);
    KQ.copy(root.getWorldQuaternion(KQ)).invert();
    const dir = (a: string, b: string, want: Dir): Dir => {
      KD.copy(bs.get(b)!.getWorldPosition(V1)).sub(bs.get(a)!.getWorldPosition(V2)).normalize().applyQuaternion(KQ);
      KD.lerp(V3.set(want[0], want[1], want[2]).normalize(), kneel).normalize();
      return [KD.x, KD.y, KD.z];
    };
    // upright on the knees, or (heels) sat back on them: the thighs come forward towards level, the hips drop (upright
    // under a long coat it read as standing)
    const ty = -1 + heels * 0.55, tz = 0.3 + heels * 0.6;
    kneelL.legL = dir('upperlegL', 'lowerlegL', [0.13, ty, tz]); kneelL.legR = dir('upperlegR', 'lowerlegR', [-0.13, ty, tz]);
    applyLimbs({ legL: kneelL.legL, legR: kneelL.legR }, bs);
    kneelL.shinL = dir('lowerlegL', 'footL', [0.04, -0.12, -1]); kneelL.shinR = dir('lowerlegR', 'footR', [-0.04, -0.12, -1]);
    applyLimbs({ shinL: kneelL.shinL, shinR: kneelL.shinR }, bs);
    root.updateWorldMatrix(true, true);
    const base = root.getWorldPosition(V1).y;
    const knee = Math.min(bs.get('lowerlegL')!.getWorldPosition(V2).y, bs.get('lowerlegR')!.getWorldPosition(V3).y);
    // the knee joint sits about 6 cm above the ground it rests on
    const drop = Math.max(0, knee - base - 0.06) * kneel;
    hipsB.position.y -= drop / fig.scale.y;
    fig.updateWorldMatrix(true, true);
  }

  /** 0..1: how far into its task the body is (eases in, holds, eases out). */
  let taskClipName: string | null = null;
  const LOWER = ['hips', 'upperlegL', 'lowerlegL', 'footL', 'upperlegR', 'lowerlegR', 'footR'], lowerAt = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /** The authored clip for the running task, if anim.glb has it: low or high by where `at` is against the hips. */
  function taskClip() {
    const c = task ? TASK_CLIPS[task.kind] : undefined; if (!c || !clips) return null;
    let low = !!c.low && !c.high;
    if (c.low && c.high) { const hy = B?.get('hips')?.getWorldPosition(V1).y ?? 1; low = !task!.at || task!.at.y < hy - 0.35; }
    const n = low ? c.low : c.high ?? c.low;
    return n && clips.has(n) ? n : null;
  }
  function taskEnv() {
    if (!task) return 0;
    const a = Math.min(0.28, task.dur * 0.3), b = Math.min(0.35, task.dur * 0.3);
    return smooth01(task.t / a) * (1 - smooth01((task.t - (task.dur - b)) / b));
  }

  /** Where a hand goes for a task at time k (0..1 through it), in the world. */
  function handGoal(bs: Map<string, THREE.Bone>, sd: 'L' | 'R', k: number, t: number, out: THREE.Vector3) {
    const T = task!;
    root.updateWorldMatrix(true, false);
    const fwd = V4.set(0, 0, 1).transformDirection(root.matrixWorld), side = V5.set(sd === 'L' ? 1 : -1, 0, 0).transformDirection(root.matrixWorld);
    const head = bs.get('head')!.getWorldPosition(SA), hip = bs.get('hips')!.getWorldPosition(SB);
    const chestY = hip.y + (head.y - hip.y) * 0.55, waistY = hip.y + (head.y - hip.y) * 0.12;
    const mouth = () => out.copy(head).addScaledVector(fwd, 0.11).add(V1.set(0, -0.09, 0)).addScaledVector(side, -0.02);
    const front = (y: number, f: number, s: number) => out.copy(hip).setY(y).addScaledVector(fwd, f).addScaledVector(side, s);
    switch (T.kind) {
      case 'pickup': case 'putdown': case 'plant': {
        const reach = T.at ? out.copy(T.at).add(V1.set(0, 0.06, 0)) : front(hip.y - 0.55, 0.45, 0.12);
        if (k > 0.55) { const r = smooth01((k - 0.55) / 0.35); reach.lerp(V2.copy(hip).setY(waistY + 0.1).addScaledVector(fwd, 0.28).addScaledVector(side, 0.12), r); }
        if (T.kind === 'plant' && k > 0.3 && k < 0.6) reach.y += Math.sin(t * 14) * 0.03;
        return reach;
      }
      case 'drink': {
        if (T.prop) {
          // a cup: held at the chest, up to the lips twice
          const hold = V2.copy(hip).setY(chestY - 0.02).addScaledVector(fwd, 0.28).addScaledVector(side, 0.08);
          const sip = smooth01((Math.sin(k * Math.PI * 4 - Math.PI / 2) * 0.5 + 0.5) * 1.6 - 0.3);
          return mouth().lerp(hold, 1 - sip);
        }
        // cupped hands down to the water, then up to the mouth
        const low = V3.copy(front(hip.y - 0.5, 0.5, 0.06));
        const up = smooth01((k - 0.42) / 0.25) * (1 - smooth01((k - 0.85) / 0.15));
        return mouth().lerp(low, 1 - up);
      }
      case 'eat': {
        // twice from the hand to the mouth, a chew in between
        const hold = V2.copy(hip).setY(chestY - 0.05).addScaledVector(fwd, 0.3).addScaledVector(side, 0.1);
        const bite = Math.max(0, Math.sin(Math.min(1, k * 1.1) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
        return mouth().lerp(hold, 1 - bite);
      }
      case 'type': {
        front(waistY + 0.32, 0.36, 0.12);
        out.y += Math.max(0, Math.sin(t * 17 + (sd === 'L' ? 0 : 1.7))) * 0.025;
        out.addScaledVector(side, Math.sin(t * 5.3 + (sd === 'L' ? 0 : 2)) * 0.03);
        return out;
      }
      case 'carry': return front(waistY + 0.18, 0.34, 0.17);
      case 'open': {
        const p = T.at ? out.copy(T.at) : front(chestY + 0.05, 0.55, 0.15);
        return p.addScaledVector(fwd, -0.12 * smooth01((k - 0.5) / 0.4));
      }
      case 'give': return front(chestY - 0.02, 0.48 + 0.08 * Math.sin(k * Math.PI), 0.08);
      case 'fix': {
        const p = T.at ? out.copy(T.at) : front(hip.y - 0.25, 0.5, 0.1);
        if (sd === 'R') p.y += Math.max(0, Math.sin(t * 9)) * 0.09;
        return p;
      }
      case 'use': {
        const p = T.at ? out.copy(T.at) : front(chestY - 0.12, 0.42, 0.1);
        return p.addScaledVector(side, Math.sin(t * 3.1 + (sd === 'L' ? 0 : 1)) * 0.025);
      }
      case 'phone': {
        // one hand up at the ear, the other loose; a glance down at the screen now and then
        if (sd === 'R') { const glance = smooth01((Math.sin(t * 0.7) - 0.75) * 6); return mouth().addScaledVector(side, -0.07 + 0.02 * glance).add(V1.set(0, 0.08 - 0.12 * glance, 0)).addScaledVector(fwd, -0.06 + 0.2 * glance); }
        return front(waistY + 0.05, 0.12, 0.22);
      }
      case 'gesture': {
        // talking with the hands: beats on the words, palms up now and then
        const lift = 0.5 + 0.5 * Math.sin(t * 2.3 + (sd === 'L' ? 0 : 2.1));
        return front(waistY + 0.2 + lift * 0.18, 0.28 + lift * 0.08, 0.2 + 0.06 * Math.sin(t * 1.7 + (sd === 'L' ? 1 : 0)));
      }
    }
    return out.copy(hip);
  }

  // ---- eating, drinking from a cup: the bread's edge or the cup's rim on the lips, not the wrist ----
  // The wrist went to a point under the chin, so the bread stopped by the cheek a hand short of the mouth and the cup's
  // fingers went into the chest. Now the hand is turned a set way in the body's own frame (nothing read back from where
  // it ended up last frame: taking the prop's middle to the lips from the hand's last turn jerked 24 cm seated), and the
  // wrist goes where that turn puts the rim on the lips.
  // the lips' middle under the eye line, in the head's own space: measured on each of the crew from the front with a
  // ruler under the eye (cm in metres); anyone else at 1.15 times the eyes' spacing (the crew run 1.0 to 1.34)
  const LIPS_DROP: Partial<Record<CrewId, number>> = { scientist: 0.073, strong: 0.083, medic: 0.069, explorer: 0.062, builder: 0.069, social: 0.064, megazron: 0.077 };
  let lipsLocal: THREE.Vector3 | null = null;
  function lipsAt(bs: Map<string, THREE.Bone>, out: THREE.Vector3) {
    const head = bs.get('head')!;
    if (!lipsLocal) {
      const eL = bs.get('eyeL'), eR = bs.get('eyeR');
      if (eL && eR && eL.parent === head) {
        const drop = (custom ? undefined : LIPS_DROP[id]) ?? Math.abs(eL.position.x - eR.position.x) * 1.15;
        lipsLocal = new THREE.Vector3(0, (eL.position.y + eR.position.y) / 2 - drop, (eL.position.z + eR.position.z) / 2 + 0.018);
      } else lipsLocal = new THREE.Vector3(0, -0.06, 0.1);
    }
    head.updateWorldMatrix(true, false);
    return head.localToWorld(out.copy(lipsLocal));
  }
  let axesR: ReturnType<typeof handAxes> | null = null;
  // the elbow out to the side, down and a little forward, as one lifts a cup or a bite (x is outwards here)
  const ELBOW_MOUTH: Dir = [0.6, -1, 0.3];
  const rimLocal = new Map<PropKind, { c: THREE.Vector3; n: THREE.Vector3; r: number }>();
  const MA = { qh: new THREE.Quaternion(), qb: new THREE.Quaternion(), q: new THREE.Quaternion(), r: new THREE.Quaternion(), t: new THREE.Quaternion(), m: new THREE.Matrix4(), l: new THREE.Matrix4(),
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), h: new THREE.Vector3(), o: new THREE.Object3D(), fresh: true };
  /** The right hand's world turn with its fingers along fw and its palm facing pw (body-space directions). */
  function handTurnTo(rq: THREE.Quaternion, fwB: Dir, pwB: Dir, ax: ReturnType<typeof handAxes>, out: THREE.Quaternion) {
    const fw = MA.x.set(fwB[0], fwB[1], fwB[2]).normalize().applyQuaternion(rq), pw = MA.y.set(pwB[0], pwB[1], pwB[2]).applyQuaternion(rq);
    pw.addScaledVector(fw, -pw.dot(fw)).normalize();
    MA.l.makeBasis(ax.fl, MA.z.crossVectors(ax.nl, ax.fl), ax.nl);
    MA.m.makeBasis(fw, MA.z.crossVectors(pw, fw), pw).multiply(MA.l.transpose());
    return out.setFromRotationMatrix(MA.m);
  }
  /** How far into the task the hand is at the mouth (0 held in front of the chest, 1 on the lips). Eating: one bite, held
   *  a moment; drinking: two sips. */
  function mouthAmount(kind: TaskKind, k: number) {
    return kind === 'drink' ? smooth01((Math.sin(k * Math.PI * 4 - Math.PI / 2) * 0.5 + 0.5) * 1.6 - 0.3) : smooth01((k - 0.12) / 0.28) * (1 - smooth01((k - 0.62) / 0.26));
  }
  const FU = { q: new THREE.Quaternion(), p: new THREE.Quaternion(), i: new THREE.Quaternion(), r: new THREE.Quaternion(), f: new THREE.Vector3(), a: new THREE.Vector3() };
  /** Turn the face to a set pitch in the body's frame (up is +), by amt: the neck takes 40 per cent, the head the rest.
   *  The rig's rest pose is identity everywhere, so the head's own +z is the face's way at rest. */
  function faceUp(bs: Map<string, THREE.Bone>, rq: THREE.Quaternion, pitch: number, amt: number) {
    if (amt <= 0.001) return;
    const head = bs.get('head')!, neck = bs.get('neck');
    const inv = FU.r.copy(rq).invert();
    for (const [b, share] of (neck ? [[neck, 0.4], [head, 1]] : [[head, 1]]) as [THREE.Bone, number][]) {
      head.updateWorldMatrix(true, false);
      const f = FU.f.set(0, 0, 1).applyQuaternion(head.getWorldQuaternion(FU.q)).applyQuaternion(inv);
      const now = Math.atan2(f.y, Math.hypot(f.x, f.z));
      const c = clamp((pitch - now) * amt * share, -0.5, 0.9);
      if (Math.abs(c) < 1e-4) continue;
      // turning about the body's own x (its side): a turn by -c lifts the face by c
      const R = FU.q.setFromAxisAngle(FU.a.set(1, 0, 0).applyQuaternion(rq), -c);
      const pw = b.parent!.getWorldQuaternion(FU.p);
      b.quaternion.premultiply(R.premultiply(FU.i.copy(pw).invert()).multiply(pw));
    }
    head.updateWorldMatrix(true, false);
  }
  /** Turn the face about the body's vertical by a (radians, + to his left): the neck takes 40 per cent, the head the rest. */
  function headYaw(bs: Map<string, THREE.Bone>, rq: THREE.Quaternion, a: number) {
    if (Math.abs(a) < 1e-4) return;
    const head = bs.get('head')!, neck = bs.get('neck');
    for (const [b, share] of (neck ? [[neck, 0.4], [head, 0.6]] : [[head, 1]]) as [THREE.Bone, number][]) {
      const R = FU.q.setFromAxisAngle(FU.a.set(0, 1, 0).applyQuaternion(rq), a * share);
      const pw = b.parent!.getWorldQuaternion(FU.p);
      b.quaternion.premultiply(R.premultiply(FU.i.copy(pw).invert()).multiply(pw));
    }
    head.updateWorldMatrix(true, false);
  }
  function mouthArm(bs: Map<string, THREE.Bone>, T: NonNullable<typeof task>, k: number, w: number, dt: number, up: THREE.Bone, lo: THREE.Bone, hd: THREE.Bone) {
    const ax = axesR ??= handAxes(bs), kind = T.prop as PropKind;
    const at0 = mouthAmount(T.kind, k), slide = kind === 'cup' && (RIG_OPTS.cupAlongSip !== 0.6 || RIG_OPTS.cupFootSip !== 0.018);
    let rl = rimLocal.get(kind);
    if (!rl || slide) {
      const o = MA.o; placeOnPalm(bs, o, kind === 'cup' ? 'cup' : 'food', slide ? at0 : 0); const rim = PROP_RIM[kind] ?? { y: 0, r: 0.05 };
      const ck = kind === 'cup' ? o.scale.x : 1;
      rl = rl ?? { c: new THREE.Vector3(), n: new THREE.Vector3(), r: 0 };
      rl.c.set(0, rim.y * ck, 0).applyQuaternion(o.quaternion).add(o.position); rl.n.set(0, 1, 0).applyQuaternion(o.quaternion); rl.r = rim.r * ck;
      rimLocal.set(kind, rl);
      // the cup in the hand slides with it
      if (slide && propOn && propOn === props.get('cup')) { propOn.position.copy(o.position); propOn.quaternion.copy(o.quaternion); }
    }
    root.updateWorldMatrix(true, false);
    const rq = root.getWorldQuaternion(MA.r), cup = T.kind === 'drink';
    const fwd = MA.a.set(0, 0, 1).applyQuaternion(rq), side = MA.b.set(-1, 0, 0).applyQuaternion(rq);
    const hip = bs.get('hips')!.getWorldPosition(SA), head = bs.get('head')!.getWorldPosition(SB);
    const chestY = hip.y + (head.y - hip.y) * 0.55;
    const at = mouthAmount(T.kind, k);
    // the turn: held in front of the chest, then up to the mouth. The cup upright, the fingers round it (a handshake's
    // hand), its top tipped to the face to sip; the bread in the fingers, pointing up and in to the mouth for the bite
    if (cup) {
      handTurnTo(rq, [0.35, 0, 1], [1, 0, -0.3], ax, MA.qh);
      // the hand turned out round the cup (RIG_OPTS.sipYaw, about the vertical): at the sip it holds the cup from the side,
      // not over the nose and eyes (Draxum's big hand covered his face from the front: GPU take tasksD). -0.5 rad: one eye
      // clear; further (-0.7 to -1.1, both eyes clear) put his forearm 4.7 to 6.2 cm into his chest
      if (RIG_OPTS.sipYaw) MA.qh.premultiply(MA.qb.setFromAxisAngle(MA.x.set(0, 1, 0), RIG_OPTS.sipYaw));
      // tipped 1.65 rad (RIG_OPTS.sipTip) with the face lifted 0.22, past level, so what is in it would pour (at 1.0 the bottom stayed below the rim)
      MA.qb.setFromAxisAngle(MA.x.set(1, 0, 0).applyQuaternion(rq), -RIG_OPTS.sipTip).multiply(MA.qh);
    } else {
      handTurnTo(rq, [0.3, 0.45, 0.85], [0.6, -0.8, 0], ax, MA.qh);
      handTurnTo(rq, [0.3, 0.75, -0.45], [1, 0, 0.1], ax, MA.qb);
    }
    // (tipped late, as the rim reaches the lips: tipped all the way up, the fingers pointed up into his nose on the way)
    MA.q.copy(MA.qh).slerp(MA.qb, cup ? at * at : at);
    // the face up to it, whatever the clip does with the head: seated, Draxum's clip bows it, and with the rim on his lips
    // the hand that holds the cup ended over his nose. At the lips the face is turned to look a little up (the cup's
    // tip past level then pours into the mouth), eating a little less
    faceUp(bs, rq, cup ? 0.22 : 0.08, at * w * RIG_OPTS.faceUp);
    if (cup && RIG_OPTS.sipHead) headYaw(bs, rq, RIG_OPTS.sipHead * at * w);
    // what touches the lips, from the wrist, with the hand turned so: the bread's edge past the fingertips, the cup's rim
    const sc = hd.getWorldScale(MA.h).x;
    const off = MA.c.copy(rl.c).multiplyScalar(sc).applyQuaternion(MA.q), n = MA.n.copy(rl.n).applyQuaternion(MA.q);
    // (the cup: the rim's lowest point, on the lower lip. Its side towards the face was picked from the way back to the
    // face, and tipped to sip the cup points nearly that way: the side came out anywhere round the rim, 5 cm off the mouth)
    const d = cup ? MA.d.set(0, -1, 0) : MA.d.copy(ax.fl).applyQuaternion(MA.q);
    // (for the cup not made unit: upright it has no lowest point, and the rim point grows in smoothly as it tips)
    d.addScaledVector(n, -d.dot(n)); if (cup) off.addScaledVector(d, rl.r * sc); else if (d.lengthSq() > 1e-6) off.addScaledVector(d.normalize(), rl.r * sc);
    // where that goes: in front of the chest, or on the lips
    const hold = MA.h.copy(hip).setY(chestY + (cup ? 0.06 : 0.02)).addScaledVector(fwd, cup ? 0.3 : 0.46).addScaledVector(side, cup ? 0.06 : 0.08);
    const lips = lipsAt(bs, MA.z).addScaledVector(fwd, -0.004);
    const goal = hold.lerp(lips, at).sub(off).clone();
    // the fingers kept out of the chest as a held hand's are, the push eased
    // (the fingers as they point now, turned towards the set way by the task's weight: easing out, the set way alone let
    // the clip's fingers into the chest, 2 cm). At the lips the guard lets go (RIG_OPTS.lipsLetGo): there the round
    // shapes it keeps the hand out of reach up under the chin
    const fingersW = MA.x.copy(ax.fl).applyQuaternion(MA.q), palmLen = ax.palmLen * sc;
    const f3 = bs.get('finger3_1R')!; fingersW.lerp(f3.getWorldPosition(MA.y).sub(hd.getWorldPosition(MA.n)).normalize(), 1 - w).normalize();
    const g0 = goal.clone(), fp = fingerPush.R; holdOut(bs, goal, fingersW, palmLen * 2);
    fp.lerp(goal.sub(g0).multiplyScalar(1 - at * RIG_OPTS.lipsLetGo), 1 - Math.exp(-dt * 18)); goal.copy(g0).add(fp);
    // the wrist's own guard lets go at the lips too: under a big chin (Draxum) the wrist is inside the chest's round shape
    // and its margin, and it held the cup 6 cm off the mouth with nothing touching (the body's surface: 0)
    const se = cup ? RIG_OPTS.sipElbow : null;
    const hint: Dir = se ? [ELBOW_MOUTH[0] + (se[0] - ELBOW_MOUTH[0]) * at, ELBOW_MOUTH[1] + (se[1] - ELBOW_MOUTH[1]) * at, ELBOW_MOUTH[2] + (se[2] - ELBOW_MOUTH[2]) * at] : ELBOW_MOUTH;
    armTo(bs, 'R', up, lo, hd, goal, w, dt, undefined, 0, 1 - at * RIG_OPTS.lipsLetGo, hint);
    // the hand turned to it, by the task's weight, its way round kept from frame to frame
    hd.parent!.getWorldQuaternion(MA.t).invert().multiply(MA.q);
    const dq = HT.d.copy(MA.t).multiply(HT.i.copy(hd.quaternion).invert()), pd = handTurn.R;
    if (MA.fresh) MA.fresh = false; else if (pd.x * dq.x + pd.y * dq.y + pd.z * dq.z + pd.w * dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    pd.copy(dq);
    const ang = 2 * Math.acos(clamp(dq.w, -1, 1)), sn = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    if (sn > 1e-6) hd.quaternion.premultiply(HT.d.setFromAxisAngle(HT.ax.set(dq.x / sn, dq.y / sn, dq.z / sn), ang * w));
  }

  const RB = { p: new THREE.Vector3(), s: new THREE.Vector3(), e: new THREE.Vector3(), h: new THREE.Vector3(), b: new THREE.Vector3(), x: new THREE.Vector3(), q: new THREE.Quaternion() };
  /** Bend the back forward about the waist (spine1, then the chest a share) by as much as brings the shoulder within 0.9 of
   *  the arm's length of the goal, at most RIG_OPTS.plantBend rad, times w. */
  function reachBend(bs: Map<string, THREE.Bone>, up: THREE.Bone, lo: THREE.Bone, hd: THREE.Bone, goal: THREE.Vector3, w: number) {
    const sp = bs.get('spine1'), ch = bs.get('chest'); if (!sp || w <= 0.001) return;
    const len = up.getWorldPosition(RB.s).distanceTo(lo.getWorldPosition(RB.e)) + RB.e.distanceTo(hd.getWorldPosition(RB.h));
    const want = 0.9 * len;
    const a = RB.s.sub(sp.getWorldPosition(RB.p)), b = RB.b.copy(goal).sub(RB.p), la = a.length(), lb = b.length();
    if (la < 1e-4 || lb < 1e-4 || RB.p.distanceTo(goal) < 1e-4) return;
    const ax = RB.x.crossVectors(a, b); if (ax.lengthSq() < 1e-10) return; ax.normalize();
    const phi = Math.acos(clamp(a.dot(b) / (la * lb), -1, 1));
    const c = (la * la + lb * lb - want * want) / (2 * la * lb);
    const th = Math.min(RIG_OPTS.plantBend, c >= 1 ? phi : Math.max(0, phi - Math.acos(clamp(c, -1, 1)))) * w;
    if (th < 1e-4) return;
    // two thirds at the waist, a third at the chest (one bend at the waist folded him like a hinge)
    worldRotate(sp, RB.q.setFromAxisAngle(ax, th * 0.67)); sp.updateWorldMatrix(false, true);
    if (ch) { worldRotate(ch, RB.q.setFromAxisAngle(ax, th * 0.33)); ch.updateWorldMatrix(false, true); }
  }
  /** The hands go to the task's goal by two-bone IK, blended in and out with the task. */
  function taskArms(bs: Map<string, THREE.Bone>, kind: CrewPose, t: number, dt: number) {
    const T = task!;
    T.t += dt;
    const w = taskEnv();
    const k = clamp(T.t / T.dur, 0, 1), tcp = taskClipName ? TASK_CLIPS[T.kind] : undefined;
    // the moment of contact (or a throw's release): the prop goes into or out of the hand then, not as the task eases
    // in, and the caller hears of it (a stone on the ground taken away, a thrown one launched from the hand)
    // (the procedural reach, kneeling: its hand is lowest half way)
    const proc = !tcp && (T.kind === 'pickup' || T.kind === 'putdown' || T.kind === 'plant');
    const at = tcp ? (tcp.release ?? tcp.touch) : proc ? 0.5 : -1, past = at >= 0 && k >= at;
    if (past && T.onContact) { const cb = T.onContact; T.onContact = null; cb(); }
    if (T.t >= T.dur) { task = null; showProp(bs, null, 0); return; }
    const after = tcp ? tcp.prop === 'after' : T.kind === 'pickup';
    // (not while her own phone is still in that hand on its way to the pocket: the stone and the phone were in her hand
    // together for a quarter second, GPU take tasks9)
    showProp(bs, T.prop, kit && !kit.handFree() ? 0 : at < 0 || tcp?.prop === 'all' ? w : after === past ? 1 : 0);
    if (w <= 0.001) return;
    const sides: ('L' | 'R')[] = T.hands === 'both' || (taskClipName && TASK_CLIPS[T.kind]) ? ['L', 'R'] : [T.hands];
    root.updateWorldMatrix(true, true);
    for (const sd of sides) {
      const up = bs.get(`upperarm${sd}`), lo = bs.get(`lowerarm${sd}`), hd = bs.get(`hand${sd}`);
      if (!up || !lo || !hd) continue;
      const goal = handGoal(bs, sd, k, t, new THREE.Vector3());
      const tcd = taskClipName ? TASK_CLIPS[T.kind] : undefined;
      if (tcd) {
        // the clip does the reach; IK takes the hand the last few cm onto the thing round the moment of contact, at most
        // 12 cm, and none for a clip with no contact (eating: the hand to the mouth is the clip's)
        // the clip's fingers are kept out of the torso (planting's seed held at the chest put them 3 to 4 cm in), the
        // push eased as a hold's is
        const pk = T.kind === 'plant', near = tcd.touch < 0 || !T.at || sd !== 'R' ? 0 : 1 - smooth01(Math.max(0, Math.abs(k - tcd.touch) - (pk ? RIG_OPTS.plantHold : 0)) / (pk ? RIG_OPTS.plantWin : 0.18));
        // planting: the clip kneels and its hand stops at knee height (GPU take tasks9: the middle finger's root 36 to 44
        // cm over the soil at its lowest); round the touch the back bends forward as far as the hand needs (at most
        // RIG_OPTS.plantBend, weighted by near squared: by near alone the chest bent onto the seed hand still at the chest,
        // 2.8 cm in), IK takes the rest (RIG_OPTS.plantReach, not 12 cm) and holds it there a moment (plantHold). Bent 1.2
        // rad the hand reached the soil (finger root 0.5 to 5 cm) but the body folded with the head under the chest
        // (renders ~/bs-cap/holds/lk_p); at 0.5 the finger root is 17 / 20 / 21 cm over the soil (Zenvik, Draxum, Nuvexa),
        // arm in torso 0 / 1.2 / 0 cm. The rest needs a deeper kneel (the hips lower), not more back
        if (T.kind === 'plant' && near > 0 && RIG_OPTS.plantBend > 0) reachBend(bs, up, lo, hd, goal, near * near * w);
        const f3 = bs.get(`finger3_1${sd}`), cur = hd.getWorldPosition(V2).clone(), fp = fingerPush[sd];
        const fd = f3 ? f3.getWorldPosition(V3).sub(cur) : null, pl = fd ? fd.length() : 0;
        const pg = cur.clone(); if (fd && pl > 1e-4) holdOut(bs, pg, fd.normalize(), pl * 2);
        fp.lerp(pg.sub(cur), 1 - Math.exp(-dt * 18));
        const push = fp.length();
        const d = near > 0 ? V3.copy(goal).sub(cur) : V3.set(0, 0, 0), dmax = T.kind === 'plant' ? RIG_OPTS.plantReach : 0.12;
        if (d.length() > dmax) d.setLength(dmax);
        // the guard's own weight eased in time (taken from the push each frame it switched the arm from the clip's elbow to
        // the solve's in a frame or two: picking up jerked 10.7 cm on Lyrra)
        const pw = taskPushW[sd] += (clamp(push / 0.02, 0, 1) - taskPushW[sd]) * (1 - Math.exp(-dt * 5));
        const wt = Math.max(near, pw);
        // the goal is followed, not jumped to: planting ran the elbow forward 5 cm a frame and stopped it dead in one at
        // the touch (task_plant f36); a first order follow keeps the hand's speed continuous as it settles on the thing
        // (planting only: jerk 7.1 to 2.1 cm on Draxum, 6.9 to 2.0 on Nuvexa; on picking up it moved the jerk about, mixed)
        const tg = cur.add(d.multiplyScalar(wt > 0.001 ? near / wt : 0)).add(fp), ce = T.kind === 'plant' ? RIG_OPTS.contactEase : 0;
        if (!taskTgtOn[sd] || wt <= 0.001 || ce <= 0) { taskTgt[sd].copy(tg); taskTgtOn[sd] = wt > 0.001; }
        else taskTgt[sd].lerp(tg, 1 - Math.exp(-dt * ce));
        if (wt > 0.001) armTo(bs, sd, up, lo, hd, taskTgt[sd], w * wt, dt);
        continue;
      }
      if (sd === 'R' && T.prop && (T.kind === 'eat' || (T.kind === 'drink' && T.prop === 'cup'))) { mouthArm(bs, T, k, w, dt, up, lo, hd); continue; }
      armTo(bs, sd, up, lo, hd, goal, w, dt);
    }
    // eyes on the work
    if (T.at && T.kind !== 'gesture') { headLook(bs, T.at, w * 0.8); }
    void kind;
  }
  function headLook(bs: Map<string, THREE.Bone>, at: THREE.Vector3, w: number) {
    const head = bs.get('head')!, neck = bs.get('neck')!;
    head.getWorldPosition(V2); V3.copy(at).sub(V2);
    root.getWorldQuaternion(Q).invert(); V3.applyQuaternion(Q);
    const yaw = clamp(Math.atan2(V3.x, V3.z), -1, 1), pitch = clamp(-Math.atan2(V3.y, Math.hypot(V3.x, V3.z)), -0.3, 0.9);
    neck.quaternion.multiply(Q.setFromEuler(E.set(pitch * 0.45 * w, yaw * 0.4 * w, 0)));
    head.quaternion.multiply(Q.setFromEuler(E.set(pitch * 0.5 * w, yaw * 0.5 * w, 0)));
  }
  /** Standing still is never statue-still: the weight moves between the feet, and now and then a look around. */
  function idleLife(bs: Map<string, THREE.Bone>, t: number, dt: number) {
    idleLookAt -= dt;
    if (idleLookAt <= 0) { idleLookWant = idleLookWant ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.45); idleLookAt = idleLookWant ? 1.4 + Math.random() * 1.6 : 4 + Math.random() * 7; }
    idleLook += (idleLookWant - idleLook) * (1 - Math.exp(-dt * 2.4));
    const neck = bs.get('neck')!, head = bs.get('head')!, hips = bs.get('hips')!, sp = bs.get('spine1')!;
    neck.quaternion.multiply(Q.setFromEuler(E.set(0, idleLook * 0.4, 0)));
    head.quaternion.multiply(Q.setFromEuler(E.set(0.03 * Math.abs(idleLook), idleLook * 0.55, 0)));
    idleShift += dt;
    const sh = Math.sin(idleShift * 0.42) * 0.6 + Math.sin(idleShift * 0.17 + 1) * 0.4;
    hips.quaternion.premultiply(Q.setFromAxisAngle(V1.set(0, 0, 1), sh * 0.025));
    sp.quaternion.multiply(Q.setFromEuler(E.set(0, sh * 0.03, -sh * 0.03)));
  }

  function animate(kind: CrewPose, phase: number, amount: number, t: number, dt: number) {
    rigClock += Math.max(0, dt);
    if (!mixer || !B) return;
    if (CHAR_BUDGET.throttle && !firstFrame) { // the first pose is always set at once: never a frame of bind pose
      // a body its stage has hidden (a phone's far townsfolk, the crowd pool's idle bodies) is not posed at all; the
      // moment it shows again it is posed straight away
      // its sixty bones are not even carried along by three.js's matrix pass while it is hidden
      if (!root.visible) { skipDt = Math.min(skipDt + dt, 0.2); skipN = 99; root.matrixWorldAutoUpdate = false; return; }
      root.matrixWorldAutoUpdate = true;
      // a passer-by whose body reaches the lens (their hair filled a corner of the screen) is left out until they pass
      if (crowd) {
        const e = root.matrixWorld.elements, dy = LENS.y - e[13], d = Math.hypot(LENS.x - e[12], LENS.z - e[14]);
        if (fadeOn) {
          // Web and Ultra: they fade (hashed alpha) from 2.2 m in to gone at 1.1 m, and when the stage asks (in the
          // line from the camera to you), over a fifth of a second either way. From 1.3 m to 0.4 m a low camera looking
          // up saw a half-faded body fill ~40% of the screen as a dark dithered shape; gone by 1.1 m it is a quarter
          // of the width at most, and mostly faded long before
          // Now (the owner: "pedestrians change when touched or bumped"): that half-faded shape from 2.2 m to 1.1 m read as
          // the person changing. A body is whole until it is right at the lens (0.85 m, back at 1.1 m), and then gone in a
          // tenth of a second, all the way. ?lensfade=old: the band
          const band = dy > -0.3 && dy < 2.3;
          const x = LENS_BAND ? (band ? THREE.MathUtils.clamp((d - 1.1) / 1.1, 0, 1) : 1) : band && d < (fadeK > 0.5 ? 0.42 : 0.55) ? 0 : 1; // a last resort now: the city's camera keeps 0.9 m off bodies (keepOff)
          const want = Math.min(x * x * (3 - 2 * x), lensWant);
          // the v4 Web clips still caught the tenth of a second in between as a dithered half-shape: now a body is
          // hidden or shown at once, like on phones (?lensfade=old keeps the band's fade)
          if (LENS_BAND) { fadeK += (want - fadeK) * (1 - Math.exp(-dt * 12)); if (Math.abs(fadeK - want) < 0.01) fadeK = want; } else fadeK = want;
          setFade(fadeK);
        } else {
          const near = dy > -0.3 && dy < 2.3 && d < (fig.visible ? 0.42 : 0.55); // a last resort (the city's camera keeps 0.9 m off bodies)
          if (fig.visible === near) fig.visible = !near;
        }
      }
      pickLod();
      sinceDrawn++;
      // phones: a crowd body more than a few metres off is posed every other frame
      const every = sinceDrawn > 3 ? 4 : camD > 45 ? 3 : camD > 22 ? 2 : crowd && lod === 1 && camD > 6 ? 2 : 1;
      skipDt += dt;
      if (++skipN < every) return;
      dt = Math.min(skipDt, 0.2); skipN = 0; skipDt = 0;
    }
    const bs = B;
    // real ground speed and turn rate: gait follows the body, whatever the caller says about it
    root.getWorldPosition(tmp);
    root.getWorldQuaternion(Q);
    const yawNow = Math.atan2(2 * (Q.w * Q.y + Q.x * Q.z), 1 - 2 * (Q.y * Q.y + Q.x * Q.x));
    if (!tracked) { trackPos.copy(tmp); trackYaw = yawNow; tracked = true; }
    const sdt = Math.max(dt, 1 / 240);
    let inst = Math.hypot(tmp.x - trackPos.x, tmp.z - trackPos.z) / sdt;
    if (inst > 14) inst = 0; // teleport
    let dy = yawNow - trackYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    trackPos.copy(tmp); trackYaw = yawNow;
    const sr = 1 - Math.exp(-dt * 6);
    groundSpeed += (inst - groundSpeed) * sr;
    yawRate += (clamp(dy / sdt, -6, 6) - yawRate) * sr;
    const pivot = Math.abs(yawRate) > 1.1 ? Math.abs(yawRate) * 0.22 : 0; // turning on the spot still takes steps
    const speed = Math.max(groundSpeed > 0.08 ? groundSpeed : amount * 4, pivot);
    // a moving body stays moving until it has clearly stopped: no flicker between idle and gait
    gaitOn = gaitOn ? amount > 0.012 || groundSpeed > 0.14 || pivot > 0 : amount > 0.03 || groundSpeed > 0.32 || pivot > 0;
    const moving = gaitOn && !FULL_BODY.has(kind) && (kind === 'idle' || kind === 'walk' || kind === 'stand');
    const limp = limpOn || !!kit?.splint.visible;
    for (const s of acts.values()) s.target = 0;
    if (moving) {
      const parts = limp && speed < 2 ? [{ n: 'limp', w: 1 }] : locomotion(speed, dt);
      if (limp && speed < 2) gaitPhase = (gaitPhase + dt / A!.meta.limp.dur * (speed / Math.max(A!.meta.limp.speed * legScale, 0.05))) % 1;
      for (const p of parts) if (p.w > 0) action(p.n, true).target += p.w;
    } else {
      const name = kind === 'idle' ? style.idle : kind === 'walk' ? 'stand' : kind === 'swim' ? (speed > 0.35 ? 'swim' : 'swim_idle') : kind === 'selfie' ? style.idle : kind; // the selfie is acted on top of the idle (selfieArm), not a clip
      const s = action(clips!.has(name) ? name : 'stand', false);
      s.target = 1;
      s.a.timeScale = style.rate;
      // reaching low (picking up, drinking, fixing something on the ground): the knees go with it
      // the path (authored clip or procedural reach) is chosen once, as the task starts: a kneel still easing out when a pick
      // up began switched it to the clip mid-reach a few frames in (a 37 cm jerk, the townsman picking up after kneeling)
      const tc = task && !FULL_BODY.has(kind) && task.clipOk ? taskClip() : null;
      if (tc) { const c = action(tc, false); c.target = taskEnv(); s.target = 1 - taskEnv(); taskClipName = tc; }
      else {
        const low = task && !(task.kind === 'drink' && task.prop) ? (LOW_TASKS[task.kind] ?? 0) * taskEnv() * (FULL_BODY.has(kind) ? 0 : 1) : 0;
        if (low > 0 && clips!.has('crouch') && name !== 'crouch') { const c = action('crouch', false); c.target = low * 0.8; s.target = 1 - low * 0.8; }
      }
    }
    const rate = firstFrame ? 1 : 1 - Math.exp(-dt * 4.5);
    let sum = 0;
    for (const s of acts.values()) { s.w += (s.target - s.w) * rate; if (s.w < 0.004 && s.target === 0) s.w = 0; sum += s.w; }
    for (const s of acts.values()) {
      s.a.enabled = s.w > 0;
      s.a.setEffectiveWeight(sum > 0 ? s.w / sum : 0);
      if (s.manual) { s.a.timeScale = 0; s.a.time = gaitPhase * s.a.getClip().duration; }
    }
    // the task's clip runs on the task's own clock, stretched to its length
    if (taskClipName) { const s = acts.get(taskClipName); if (s) { const kk = clamp(task ? task.t / task.dur : 1, 0, 1), rv = task && TASK_CLIPS[task.kind]?.reverse; s.a.timeScale = 0; s.a.time = (rv ? 1 - kk : kk) * s.a.getClip().duration * 0.999; } if (!task) taskClipName = null; }
    // every bone back to the clip's own pose before the mixer runs: three's PropertyMixer writes a bone only when the
    // mixed value differs from last frame's, so where a clip held still (a crouch's last frames, a kneel) the bone kept
    // last frame's pose with every turn added on top (arms kept out, the elbow out, the reach), and they were added
    // again: an arm popped out for a frame and back
    if (clipPose.size) for (const [b, q] of clipPose) { b.quaternion.copy(q.q); b.position.copy(q.p); }
    mixer.update(firstFrame ? 0.001 : dt);
    firstFrame = false;
    for (const b of bs.values()) { const c = clipPose.get(b); if (c) { c.q.copy(b.quaternion); c.p.copy(b.position); } else clipPose.set(b, { q: b.quaternion.clone(), p: b.position.clone() }); }
    // the throw's legs: OverhandThrow lunges so deep a body nearly kneels (Nuvexa, GPU tasksA3). Its legs and hips are
    // taken part of the way back to the pose they had as the throw began (the arm and the chest keep the clip's whole throw)
    if (taskClipName && task?.kind === 'throw' && lowerAt.size) {
      const k = RIG_OPTS.throwTame * taskEnv();
      for (const [b, q] of lowerAt) { b.quaternion.slerp(q.q, k); if (b === bs.get('hips')) b.position.lerp(q.p, k); }
    } else if (!taskClipName) for (const n of LOWER) { const b = bs.get(n); if (!b) continue; const c = lowerAt.get(b); if (c) { c.q.copy(b.quaternion); c.p.copy(b.position); } else lowerAt.set(b, { q: b.quaternion.clone(), p: b.position.clone() }); }

    // ---- style on top of the clip ----
    const bp = Math.sin(t * 1.25);
    const breathe = bp * 0.005;
    const hipsB = bs.get('hips')!, spine1 = bs.get('spine1')!, chestB = bs.get('chest')!, neckB = bs.get('neck')!, headB = bs.get('head')!;
    const standing = !FULL_BODY.has(kind);
    if (standing) {
      spine1.quaternion.multiply(Q.setFromEuler(E.set(P.stoop * 0.12 + Math.min(speed / 4, 1.3) * P.lean * 0.15, 0, 0)));
      chestB.quaternion.multiply(Q.setFromEuler(E.set(P.stoop * 0.1 + breathe, 0, 0)));
      // lean into turns, shoulders lead the hips
      const lean = clamp(yawRate * Math.min(speed, 5) * 0.012, -0.09, 0.09);
      hipsB.quaternion.premultiply(Q.setFromAxisAngle(V1.set(0, 0, 1), -lean));
      spine1.quaternion.multiply(Q.setFromEuler(E.set(0, clamp(yawRate * 0.025, -0.07, 0.07), lean * 0.4)));
      // running bodies pitch forward, eyes stay on the road
      neckB.quaternion.multiply(Q.setFromEuler(E.set(-P.stoop * 0.15 - clamp((speed - 2.2) / 3.5, 0, 1) * 0.38, 0, 0)));
      // wide bodies carry their arms away from the torso
      const sp = (P.stance - 0.05) * 0.8;
      if (sp > 0) {
        bs.get('upperarmL')!.quaternion.premultiply(Q.setFromAxisAngle(V1.set(0, 0, 1), sp));
        bs.get('upperarmR')!.quaternion.premultiply(Q.setFromAxisAngle(V1.set(0, 0, 1), -sp));
      }
    }
    // caller offsets (one-frame handles: spear thrust, floating in zero g)
    for (const [g, n, sgn] of [[armL, 'upperarmL', 1], [armR, 'upperarmR', 1]] as [THREE.Group, string, number][]) {
      if (g.rotation.x || g.rotation.y || g.rotation.z) {
        bs.get(n)!.quaternion.premultiply(Q.setFromEuler(E.set(g.rotation.x * sgn, g.rotation.y, g.rotation.z)));
        g.rotation.set(0, 0, 0);
      }
    }
    if (limbs) applyLimbs(limbs, bs);
    kneel += (kneelGoal - kneel) * (1 - Math.exp(-dt * 3.2));
    heels += (heelsGoal - heels) * (1 - Math.exp(-dt * 2.4));
    if (kneelGoal === 0 && kneel < 0.004) kneel = 0;
    if (kneel > 0) kneelLegs(bs, hipsB);
    // a hand in the torso is a pixel or two further off; the check walks the whole body's matrices (a crowd's worth was
    // a few per cent of the frame)
    if (!CHAR_BUDGET.throttle || camD < (crowd ? 8 : 16)) keepArmsOut(bs);
    if (!CHAR_BUDGET.throttle || camD < (crowd ? 8 : 16)) thighsOut(bs, dt);
    // Nuvexa's own phone goes into her pocket while her right hand holds something else (a stone to throw, a cup)
    const busyR = (p: PropKind | null | undefined) => !!p && p !== 'phone' && p !== 'paper' && p !== 'box';
    // (planting too: its seed is not a prop, and the phone rode in her hand into the soil, GPU take tasksE)
    const handTask = !!task && (task.kind === 'plant' || task.kind === 'pickup' || task.kind === 'putdown' || task.kind === 'throw' || task.kind === 'fix');
    kit?.phoneLeft(busyR(task?.prop) || (handTask && task!.prop !== 'phone') || (!task && busyR(heldProp)) || !!hold?.R);
    // the right hand down to her pocket and back while the phone goes in or comes out (kit.ts pocketReach)
    // (standing still only: seated or kneeling the hand is by the pocket already, and the reach down put it into her thigh and
    // belly, anim_qa meshIn 2.9 to 3.5 cm; a task takes the hand over from 0.15 s; none while a hold has the hand: the
    // reach to the hold and down to the pocket together put her fingers 4.5 cm into her body, reach_across)
    const pr = kit?.pocketReach();
    if (!pr) pocketGate = moving || hold?.R ? 0 : 1;
    if (pr && RIG_OPTS.pocketReach && !(limbs?.ownArms ?? armOwner)) {
      const lA = bs.get('upperlegR')!.getWorldPosition(V5), lB = bs.get('lowerlegR')!.getWorldPosition(V1);
      const ax = V2.copy(lB).sub(lA), al = ax.length(), upright = clamp((-ax.y / Math.max(al, 1e-5) - 0.8) / 0.15, 0, 1);
      const taskW = task && (task.hands === 'R' || task.hands === 'both') ? smooth01((task.t - 0.15) / 0.2) : 0;
      // (nor walking or with a hold on the hand: walking with the leaf cup the reach jerked the hand, anim_qa 3.7 cm, and
      // running with the spear it took the spear's hand into her body, 6.8 cm; there the phone goes in at the hand)
      pocketGate += ((moving || hold?.R ? 0 : 1) - pocketGate) * (1 - Math.exp(-dt * 10));
      const w = pr.w * upright * (1 - taskW) * pocketGate;
      if (w > 0.005) {
        // the wrist a hand's length above the pocket and out from the thigh's line by a few centimetres
        const tt = clamp(V3.copy(pr.at).sub(lA).dot(ax) / Math.max(al * al, 1e-6), 0, 1), out = V3.copy(pr.at).sub(V4s.copy(lA).addScaledVector(ax, tt));
        out.y = 0; if (out.lengthSq() > 1e-8) out.normalize();
        const upR = bs.get('upperarmR')!, loR = bs.get('lowerarmR')!, hdR = bs.get('handR')!;
        armTo(bs, 'R', upR, loR, hdR, V4s.copy(pr.at).addScaledVector(out, 0.035).add(V1.set(0, 0.075, 0)), w, dt);
      }
    }
    if (task) taskArms(bs, kind, t, dt);
    else if (kind === 'idle' && !gaze && speak <= 0 && !moving) idleLife(bs, t, dt);
    else { idleLook *= Math.exp(-dt * 3); }
    // ---- the selfie: one authored action, not a clip ----
    // The arm comes up and out to her right, the phone stands upright with its screen to her face, she looks into it;
    // it is held with a slow breath of movement, and goes down the way it came. The clip that did this before swung
    // the hand through a half turn between keys.
    selfieT += ((kind === 'selfie' && !task ? 1 : 0) - selfieT) * (1 - Math.exp(-dt * 2.6));
    const sw = selfieT * selfieT * (3 - 2 * selfieT);
    if (sw > 0.004 && !task) {
      root.updateWorldMatrix(true, true);
      const up = bs.get('upperarmR')!, lo = bs.get('lowerarmR')!, hd = bs.get('handR')!, head = bs.get('head')!;
      const fwd = V4.set(0, 0, 1).transformDirection(root.matrixWorld), side = V5.set(-1, 0, 0).transformDirection(root.matrixWorld);
      head.getWorldPosition(SA);
      const goal = SB.copy(SA).addScaledVector(side, 0.27).addScaledVector(fwd, 0.4).add(V1.set(0, 0.1 + Math.sin(t * 0.9) * 0.008, 0));
      const qu = (taskQ.get('selfU') ?? taskQ.set('selfU', new THREE.Quaternion()).get('selfU')!).copy(up.quaternion);
      const ql = (taskQ.get('selfL') ?? taskQ.set('selfL', new THREE.Quaternion()).get('selfL')!).copy(lo.quaternion);
      solveLeg(up, lo, hd, goal.clone());
      up.quaternion.copy(qu.slerp(up.quaternion, sw)); lo.quaternion.copy(ql.slerp(lo.quaternion, sw));
      up.updateWorldMatrix(false, true);
      // the hand: fingers up, the screen (the hand's rest +z) towards her eyes
      hd.getWorldPosition(V4s);
      // which way the fingers and the screen lie in the hand's own frame, read from the skeleton as it is
      hd.getWorldQuaternion(selfM.q0);
      const fl = selfM.a.copy(bs.get('finger3_1R')!.getWorldPosition(V1)).sub(V4s).normalize().applyQuaternion(selfM.qi.copy(selfM.q0).invert());
      const nl = selfM.b.set(0, -1, 0); nl.addScaledVector(fl, -nl.dot(fl)).normalize(); // the palm: what holds the phone faces her
      selfM.y.crossVectors(nl, fl); selfM.l.makeBasis(fl, selfM.y, nl);
      const upW = selfM.x.set(0, 1, 0).addScaledVector(side, 0.1).addScaledVector(fwd, 0.1).normalize();
      const toHead = selfM.z.copy(SA).add(V1.set(0, 0.04, 0)).sub(V4s).normalize();
      toHead.addScaledVector(upW, -toHead.dot(upW)).normalize();
      selfM.y.crossVectors(toHead, upW);
      selfM.m.makeBasis(upW, selfM.y, toHead).multiply(selfM.l.transpose()); selfM.q.setFromRotationMatrix(selfM.m);
      hd.parent!.getWorldQuaternion(Q).invert(); selfM.q.premultiply(Q);
      hd.quaternion.slerp(selfM.q, sw);
      if (!gaze) headLook(bs, V4s, sw * 0.7);
      // Nuvexa's own phone is part of her; a crowd body (one merged draw) keeps its hands empty rather than add a draw
      if (id !== 'social' && !crowd) showProp(bs, 'phone', sw);
    } else if (selfieHeld && !task) showProp(bs, null, 0);
    if (!task && kind !== 'selfie' && (heldProp || heldShown)) { showProp(bs, heldProp, 1); heldShown = !!heldProp; }
    selfieHeld = sw > 0.004;
    // ---- reach: a held target past what the arm does from the clip's shoulder ----
    // the clips carry the shoulders as they like (the stand keeps the right one 10 cm back, the shoulder line turned
    // 18 degrees), and a spear's grips in front of the body were 1.1 to 1.2 arm lengths from it: the hand stopped short
    // of the shaft. The chest turns towards the target (split with the spine below it) and then the collarbone brings
    // the shoulder on, each within what a body does and eased, as a person reaches
    if (RIG_OPTS.reach && (hold || RA.on)) reachFor(bs, spine1, chestB, dt);
    // ---- hands held on something: two-bone IK to the wrist point, then the hand turned so the fingers and the palm
    // face where they are told (the same frame the selfie reads from the skeleton) ----
    for (const sd of ['L', 'R'] as const) {
      const h0 = hold?.[sd];
      // a task in the hands takes the arm: the hold eases out under it and back in after it (it was dropped in one
      // frame, and the arm jumped)
      holdW[sd] += ((h0 && !task ? 1 : 0) - holdW[sd]) * (1 - Math.exp(-dt * 5));
      const hw = holdW[sd] * holdW[sd] * (3 - 2 * holdW[sd]);
      const hs0 = holdS[sd];
      // let go (or taken by a task): the hand eases back to the clip from the last place it held, carried with the body
      // (the IK stopped the frame the hold was dropped, and the arm jumped to the clip's pose)
      let h = h0 && !task ? h0 : undefined;
      if (!h && hs0?.on) { h = hs0.last; root.localToWorld(h.at.copy(hs0.loc)); }
      if (!h || hw < 0.004) { if (hs0 && hw < 0.004) hs0.on = false; continue; }
      root.updateWorldMatrix(true, true);
      const up = bs.get(`upperarm${sd}`), lo = bs.get(`lowerarm${sd}`), hd = bs.get(`hand${sd}`), f3 = bs.get(`finger3_1${sd}`);
      if (!up || !lo || !hd || !f3) continue;
      // the hand follows a moving target exactly (eased towards it, a hand walking with a stone trailed it by 11 cm: "the
      // rocks are out of the hands"). Only a jump (the target faster than 4 m/s, a new scene step) goes into an offset
      // that springs back to zero, critically damped, so the arm travels there instead of teleporting; a fresh hold
      // starts from where the hand is now
      const hs = holdS[sd] ??= { at: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3(), on: false, off: new THREE.Vector3(), offV: new THREE.Vector3(), prev: new THREE.Vector3(), loc: new THREE.Vector3(), last: { at: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3() } };
      const ok = Number.isFinite(h.at.x + h.at.y + h.at.z);
      if (!hs.on || hw < 0.02) {
        hd.getWorldPosition(hs.at); hs.off.copy(hs.at); if (ok) hs.off.sub(h.at); else hs.off.set(0, 0, 0);
        hs.offV.set(0, 0, 0); hs.prev.copy(ok ? h.at : hs.at); hs.fingers.copy(h.fingers); hs.palm.copy(h.palm); hs.on = true; hs.fresh = true;
      } else if (ok) {
        const st = V1.copy(h.at).sub(hs.prev), len = st.length(), lim = 4 * dt;
        if (len > lim) hs.off.addScaledVector(st, -(len - lim) / len);
      }
      if (ok) hs.prev.copy(h.at);
      // the exact critically damped step (the explicit one damped the kicked velocity again in the same frame: at 30 fps
      // it ran at half speed, a hand still 15 cm off its stone after 0.6 s)
      const sw0 = 9, se = Math.exp(-sw0 * dt), sk = V1.copy(hs.offV).addScaledVector(hs.off, sw0).multiplyScalar(dt);
      hs.off.add(sk).multiplyScalar(se); hs.offV.addScaledVector(sk, -sw0).multiplyScalar(se);
      hs.at.copy(hs.prev).add(hs.off);
      if (h !== hs.last) { root.worldToLocal(hs.loc.copy(hs.prev)); hs.last.fingers.copy(h.fingers); hs.last.palm.copy(h.palm); hs.last.grasp = h.grasp; hs.last.radius = h.radius; hs.last.along = h.along; }
      const ek = 1 - Math.exp(-dt * 12);
      if (h.fingers.lengthSq() > 1e-8) hs.fingers.lerp(V1.copy(h.fingers).normalize(), ek).normalize();
      if (h.palm.lengthSq() > 1e-8) hs.palm.lerp(V1.copy(h.palm).normalize(), ek).normalize();
      // a grasp: the wrist where the palm closes on the thing (the eased directions, as the hand is turned below)
      const palmLen = hd.getWorldPosition(V1).distanceTo(f3.getWorldPosition(V2));
      let goal: THREE.Vector3;
      if (h.grasp && sd === 'R' && propOn && propOn.parent === hd) {
        // a prop on this hand (the hammerstone, a flake): the wrist where the prop's own place on the hand puts its
        // middle on the target, the hand turned as it is about to be (below)
        hd.getWorldQuaternion(GQ.q0);
        const fl = GQ.a.copy(f3.getWorldPosition(V1)).sub(hd.getWorldPosition(V2)).normalize().applyQuaternion(GQ.qi.copy(GQ.q0).invert());
        const nl = GQ.b.set(0, -1, 0); nl.addScaledVector(fl, -nl.dot(fl)).normalize();
        GQ.y.crossVectors(nl, fl); GQ.l.makeBasis(fl, GQ.y, nl);
        const fw = GQ.x.copy(hs.fingers).normalize(), pw = GQ.z.copy(hs.palm); pw.addScaledVector(fw, -pw.dot(fw)).normalize();
        GQ.y.crossVectors(pw, fw); GQ.m.makeBasis(fw, GQ.y, pw).multiply(GQ.l.transpose()); GQ.q.setFromRotationMatrix(GQ.m);
        const mid = (propOn.geometry.computeBoundingSphere(), propOn.geometry.boundingSphere!.center);
        goal = V3.copy(mid).applyQuaternion(propOn.quaternion).add(propOn.position).multiply(hd.getWorldScale(V2)).applyQuaternion(GQ.q).negate().add(hs.at).clone();
      } else goal = h.grasp ? graspWrist(new THREE.Vector3(), hs.at, hs.fingers, hs.palm, clamp(h.radius ?? 0.02, 0, 0.08), palmLen, h.along ?? 0.6) : hs.at.clone();
      // fingers: the way they will point once turned onto the hold, eased in with it from the clip's own
      // the push that keeps them out is eased (taken whole each frame it came and went with the clip: knapping jerked 3 cm more)
      HO.q.copy(f3.getWorldPosition(V1)).sub(hd.getWorldPosition(V2)).normalize().lerp(hs.fingers, hw).normalize();
      const fp = fingerPush[sd], g0 = goal.clone(); holdOut(bs, goal, HO.q.clone(), palmLen * 2);
      fp.lerp(goal.sub(g0), 1 - Math.exp(-dt * 18)); goal.copy(g0).add(fp);
      armTo(bs, sd, up, lo, hd, goal, hw, dt);
      hd.getWorldPosition(V4s); hd.getWorldQuaternion(selfM.q0);
      const fl = selfM.a.copy(f3.getWorldPosition(V1)).sub(V4s).normalize().applyQuaternion(selfM.qi.copy(selfM.q0).invert());
      const nl = selfM.b.set(0, -1, 0); nl.addScaledVector(fl, -nl.dot(fl)).normalize();
      selfM.y.crossVectors(nl, fl); selfM.l.makeBasis(fl, selfM.y, nl);
      const fw = selfM.x.copy(hs.fingers).normalize(), pw = selfM.z.copy(hs.palm); pw.addScaledVector(fw, -pw.dot(fw)).normalize();
      selfM.y.crossVectors(pw, fw);
      selfM.m.makeBasis(fw, selfM.y, pw).multiply(selfM.l.transpose()); selfM.q.setFromRotationMatrix(selfM.m);
      hd.parent!.getWorldQuaternion(Q).invert(); selfM.q.premultiply(Q);
      // the turn from the clip's hand to the held one, its way round kept from frame to frame: near half a turn the shortest
      // way switched sides between two frames and the fingertips jumped 17 cm (a palm turned up to hold a stone)
      const dq = HT.d.copy(selfM.q).multiply(HT.i.copy(hd.quaternion).invert()), pd = handTurn[sd];
      if (hs.fresh) hs.fresh = false; else if (pd.x * dq.x + pd.y * dq.y + pd.z * dq.z + pd.w * dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      pd.copy(dq);
      const ang = 2 * Math.acos(clamp(dq.w, -1, 1)), sn = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
      if (sn > 1e-6) hd.quaternion.premultiply(HT.d.setFromAxisAngle(HT.ax.set(dq.x / sn, dq.y / sn, dq.z / sn), ang * hw));
    }
    // head look-at, clamped and shared with the neck; the eyes lead
    // someone to look at: only within what a neck can do, otherwise ease back to the front
    let wantY = 0, wantX = 0;
    if (gaze) {
      headB.getWorldPosition(V2);
      V3.copy(gaze).sub(V2);
      root.getWorldQuaternion(Q).invert();
      V3.applyQuaternion(Q);
      const yawTo = Math.atan2(V3.x, V3.z);
      if (Math.abs(yawTo) < 1.7) { wantY = yawTo; wantX = -Math.atan2(V3.y, Math.hypot(V3.x, V3.z)); }
    }
    const gr = 1 - Math.exp(-dt * gazeRate);
    gazeY += (wantY - gazeY) * gr; gazeX += (wantX - gazeX) * gr;
    const ly = clamp(lookAt.y + gazeY + clamp(yawRate * 0.05, -0.15, 0.15), -1.1, 1.1), lx = clamp(lookAt.x + gazeX, -0.5, 0.5);
    if (ly || lx) {
      neckB.quaternion.multiply(Q.setFromEuler(E.set(lx * 0.4, ly * 0.4, 0)));
      headB.quaternion.multiply(Q.setFromEuler(E.set(lx * 0.6, ly * 0.6, 0)));
    }
    sacAt -= dt;
    if (sacAt <= 0) { sacAt = DECREEP ? 0.5 + Math.random() * 2.2 : 1.2 + Math.random() * 3; sacX = (Math.random() - 0.5) * 0.05; sacY = (Math.random() - 0.5) * 0.09; if (DECREEP && Math.random() < 0.18) blinkAt = Math.min(blinkAt, 0.05); }
    eyeY += (sacY + clamp(yawRate * 0.08, -0.25, 0.25) - eyeY) * (1 - Math.exp(-dt * 20));
    if (DECREEP) {
      // the eyes finish the look the head only half makes, converge on what they look at, and never sit dead still
      const restY = clamp(wantY - ly * 1.0, -0.45, 0.45) * (gaze ? 1 : 0), restX = clamp(wantX - lx * 1.0, -0.3, 0.3) * (gaze ? 1 : 0);
      eyeAimY += (restY - eyeAimY) * (1 - Math.exp(-dt * 14)); eyeAimX += (restX - eyeAimX) * (1 - Math.exp(-dt * 14));
      const dist = gaze ? Math.max(0.35, V2.distanceTo(gaze)) : 3, verg = Math.atan(0.032 / dist);
      const jx = wob(t * 9, 3) * 0.004, jy = wob(t * 11, 7) * 0.006;
      bs.get('eyeL')!.quaternion.setFromEuler(E.set(sacX + eyeAimX + jx, eyeY + eyeAimY - verg + jy, 0));
      bs.get('eyeR')!.quaternion.setFromEuler(E.set(sacX + eyeAimX + jx, eyeY + eyeAimY + verg + jy, 0));
    } else
    for (const n of ['eyeL', 'eyeR']) bs.get(n)!.quaternion.setFromEuler(E.set(sacX, eyeY, 0));
    chestB.scale.setScalar(1 + bp * 0.0025);

    // ---- wrists: half the hand's roll goes to the forearm ----
    // all of it on the hand pinched the wrist skin, which blends hand and forearm, into a fold you saw from inside
    // (linear skinning's candy wrapper); the hand still ends up exactly where the clip put it
    for (const sd of ['L', 'R']) {
      const hb = bs.get(`hand${sd}`), fb = bs.get(`forearmtw${sd}`), ax = twistAx[sd];
      if (!hb || !fb || !ax) continue;
      const q = hb.quaternion, d = q.x * ax.x + q.y * ax.y + q.z * ax.z;
      TQ.set(ax.x * d, ax.y * d, ax.z * d, q.w);
      if (TQ.lengthSq() < 1e-8) continue;
      TQ.normalize(); TH.identity().slerp(TQ, 0.5);
      fb.quaternion.multiply(TH);
      hb.quaternion.premultiply(TH.invert());
    }

    // ---- hands: one authored shape each, reached smoothly; nothing from the clips ----
    {
      const shapeR: HandShape = holdW.R > 0.5 ? 'grip' : handOpen ? 'open' : (propOn && propOn.parent === bs.get('handR')) || kind === 'selfie' || kind === 'write' ? 'grip' : kind === 'point' ? 'point' : 'relaxed';
      const shapeL: HandShape = holdW.L > 0.5 ? 'grip' : handOpen ? 'open' : 'relaxed';
      // round a cup's side; the bread pinched between the thumb and the fingers
      const inR = !!propOn && propOn.parent === bs.get('handR'), propGrip = inR && propOn === props.get('cup') ? (cupGrip.radius = 0.034 * (cupK || 1), cupGrip) : inR && propOn === props.get('food') ? PINCH_GRIP : inR && propOn === props.get('throwstick') ? STICK_GRIP : undefined;
      const a = handsSet ? 1 - Math.exp(-dt * 6) : 1;
      let worst = 0, step = 0;
      for (const f of fingers) {
        // an explicit grip wins; a hold without one closes round its own radius (or the authored grip)
        const g = gripSet[f.side] ?? (holdW[f.side] > 0.5 && hold?.[f.side]?.radius !== undefined ? { shape: 'grip' as const, radius: hold[f.side]!.radius } : f.side === 'R' ? propGrip : undefined);
        const to = g ? gripQ.copy(f.rest).multiply(Q.setFromAxisAngle(f.hinge, gripDeg(g, f.fi, f.j) * Math.PI / 180)) : f.q[f.side === 'R' ? shapeR : shapeL];
        if (dt > 0 && handsSet) step = Math.max(step, f.cur.angleTo(to) * a / dt);
        f.cur.slerp(to, a); f.b.quaternion.copy(f.cur);
        worst = Math.max(worst, f.cur.angleTo(fingerRest.get(f.b)!));
      }
      handsSet = true; handOpen = false;
      if (worst > HANDS.maxCurl) HANDS.maxCurl = worst;
      if (step > HANDS.maxRate) HANDS.maxRate = step;
      HANDS.frames++;
    }

    // ---- face ----
    const r = 1 - Math.exp(-dt * 10);
    const ex: Face = faceSet ?? EXPR[kind] ?? {};
    const hurt = (kind === 'injured' ? 1 : 0);
    // the mouth follows the voice clip itself; no clip, no movement
    if (speak > 0) { speak = Math.max(0, speak - dt); voice.mouth(lip); } else lip.open = lip.round = lip.wide = 0;
    const open = speak > 0 ? lip.open * 0.45 : ex.open ?? 0;
    easeMorph('open', open, 1 - Math.exp(-dt * 30));
    easeMorph('round', lip.round * 0.55, 1 - Math.exp(-dt * 22));
    easeMorph('wide', lip.wide * 0.5, 1 - Math.exp(-dt * 22));
    bs.get('jaw')!.rotation.x = (morph.open ?? 0) * 0.2;
    if (DECREEP) {
      // never a dead-neutral face: a soft resting smile that drifts, brows and cheeks that move with speech,
      // a mouth that shuts fully between syllables; the stare shapes (wide 'fear' eyes at rest) are gone
      const talk = speak > 0 ? lip.open : 0, idle = wob(t * 0.6, id.length * 3.1);
      if (speak > 0 && lip.open < 0.1) easeMorph('open', 0, 1 - Math.exp(-dt * 60));
      easeMorph('smile', (ex.smile ?? Math.max(smileBase, 0.24)) + idle * 0.05 + talk * 0.12, r);
      easeMorph('frown', ex.frown ?? 0, r);
      // brows barely lifted at rest (more reads as worry)
      easeMorph('fear', (ex.fear ?? 0.04) + hurt * 0.1 + talk * 0.08 + Math.max(0, wob(t * 0.35, 9)) * 0.06, r);
      easeMorph('squint', (ex.squint ?? 0) + eyeShape.squint * 0.3 + Math.max(0, idle) * 0.06 + (morph.smile ?? 0) * 0.12, r);
      // blinks: irregular, sometimes double, quick to close and slower to open
      blinkAt -= dt;
      if (blinkAt <= 0) { blinkT = 0.2; blinkAt = Math.random() < 0.15 ? 0.32 : 1.6 + Math.random() * Math.random() * 6.5; }
      if (blinkT > 0) blinkT -= dt;
      const bk = blinkT > 0 ? 1 - blinkT / 0.2 : 1, bl = blinkT > 0 ? (bk < 0.3 ? bk / 0.3 : 1 - (bk - 0.3) / 0.7) : 0;
      // the upper lid rests over the top of the iris: relaxed, never round and staring; it follows the eye down
      const restLid = Math.min(Math.max(ex.blink ?? eyeShape.blink, 0.15), ex.blink ?? 0.2) + clamp(eyeAimX + lx, 0, 0.4) * 0.35;
      setMorph('blink', Math.max(bl, Math.min(0.92, restLid)));
    } else {
    easeMorph('smile', ex.smile ?? smileBase, r);
    easeMorph('frown', ex.frown ?? 0, r);
    easeMorph('fear', (ex.fear ?? 0) + eyeShape.fear + hurt * 0.1, r);
    easeMorph('squint', (ex.squint ?? 0) + eyeShape.squint, r);
    blinkAt -= dt;
    if (blinkAt <= 0) { blinkT = 0.15; blinkAt = 2.4 + Math.random() * 3.6; }
    if (blinkT > 0) blinkT -= dt;
    const bl = blinkT > 0 ? Math.sin((blinkT / 0.15) * Math.PI) : 0;
    setMorph('blink', Math.max(bl, ex.blink ?? eyeShape.blink));
    }

    // ---- feet: planted where they land, on the real ground ----
    if (ground && standing && root.visible && kneel === 0) {
      // only the root's own matrix: each foot's getWorldPosition brings its own chain up to date
      root.updateWorldMatrix(true, false);
      const baseY = root.getWorldPosition(tmp).y;
      const rest = (kit?.footH ?? 0.09) + soleLift;
      let drop = 0, busy = false;
      const legs: { h: THREE.Bone; k: THREE.Bone; f: THREE.Bone; p: THREE.Vector3; q: THREE.Quaternion; n: THREE.Vector3; w: number }[] = [];
      (['L', 'R'] as const).forEach((s, i) => {
        const f = bs.get(`foot${s}`)!;
        const p = f.getWorldPosition(new THREE.Vector3());
        const stance = clamp((rest + 0.075 - (p.y - baseY)) / 0.05, 0, 1);
        // pin: from touchdown the foot stays put in the world, whatever the blend does
        if (moving && stance > 0.6 && speed < 8) {
          if (!pinned[i]) { pinned[i] = true; pin[i].set(p.x + pinOff[i].x, 0, p.z + pinOff[i].z); }
          pinOff[i].set(pin[i].x - p.x, 0, pin[i].z - p.z);
          if (pinOff[i].length() > 0.2) { pinned[i] = false; }
        } else {
          pinned[i] = false;
          pinOff[i].multiplyScalar(Math.exp(-dt * 14));
        }
        p.x += pinOff[i].x; p.z += pinOff[i].z;
        const g = ground!(p.x, p.z);
        // soles rest on the ground, heels still lift: mocap floors differ by a centimetre or two
        const sole = moving ? clamp((rest + 0.03 - (p.y - baseY)) / 0.03, 0, 1) : 0;
        footOff[i] += ((g - baseY) * stance + (rest - (p.y - baseY)) * sole - footOff[i]) * (1 - Math.exp(-dt * 9));
        drop = Math.min(drop, footOff[i]);
        const e = 0.14, n = new THREE.Vector3(ground!(p.x - e, p.z) - ground!(p.x + e, p.z), 2 * e, ground!(p.x, p.z - e) - ground!(p.x, p.z + e)).normalize();
        p.y += footOff[i];
        if (Math.abs(footOff[i]) > 0.006 || pinOff[i].lengthSq() > 4e-5 || n.y < 0.99) busy = true;
        legs.push({ h: bs.get(`upperleg${s}`)!, k: bs.get(`lowerleg${s}`)!, f, p, q: f.getWorldQuaternion(new THREE.Quaternion()), n, w: stance });
      });
      hipDrop += (drop - hipDrop) * (1 - Math.exp(-dt * 6));
      if (busy || Math.abs(hipDrop) > 0.002) {
        hipsB.position.y += hipDrop / fig.scale.y;
        // the hips and the legs only (the rest of the body is brought up to date when it is drawn)
        for (const l of legs) l.h.updateWorldMatrix(true, true);
        for (const l of legs) {
          solveLeg(l.h, l.k, l.f, l.p);
          l.h.updateWorldMatrix(true, true);
          // the sole keeps its animated attitude, tipped to the slope while it bears weight
          l.q.premultiply(Q2.setFromUnitVectors(V1.set(0, 1, 0), l.n).slerp(Q.identity(), 1 - l.w * 0.8));
          l.f.parent!.getWorldQuaternion(Q).invert();
          l.f.quaternion.copy(Q.multiply(l.q));
        }
      }
    }

    // ---- secondary motion: spring on the body's world velocity, in body space ----
    tmp.setFromMatrixPosition(root.matrixWorld);
    if (!inited) { lastPos.copy(tmp); inited = true; }
    const vel = tmp.clone().sub(lastPos).divideScalar(Math.max(dt, 1 / 120));
    lastPos.copy(tmp);
    if (vel.length() > 30) vel.set(0, 0, 0);
    if (limbs?.hair) vel.set(limbs.hair[0], limbs.hair[1], limbs.hair[2]).multiplyScalar(-8);
    const yaw = root.rotation.y, cs = Math.cos(-yaw), sn = Math.sin(-yaw);
    const lx2 = vel.x * cs + vel.z * sn, lz = -vel.x * sn + vel.z * cs;
    const target = tmp.set(-lx2 * 0.02, -Math.abs(Math.cos(gaitPhase * 12.566)) * 0.012 * amount + vel.y * -0.02, -lz * 0.02);
    target.x += Math.sin(t * 0.8) * 0.008; target.z += Math.cos(t * 0.63) * 0.006; // breeze
    // critically damped: hair and hems settle, they never ring
    const sdt2 = Math.min(dt, 1 / 30);
    swingV.addScaledVector(tmp.sub(swing), 49 * sdt2); swingV.multiplyScalar(Math.exp(-sdt2 * 14));
    swing.addScaledVector(swingV, sdt2);
    swing.clampLength(0, 0.2);
    sway.uSwing.value.copy(swing);
    // the hair hangs: where the ground is, seen from the head, against where it is with the head upright (the rig's rest:
    // the head's own -y), a little behind the head and a touch springy, in the head's own units
    const hb = bs.get('head');
    if (hb) {
      hb.getWorldQuaternion(dropQ).invert();
      const sc = hb.getWorldScale(V1).y || 1;
      // drop: the change in the ground's direction seen from the head, sprung (unscaled)
      tmp.set(0, -1, 0).applyQuaternion(dropQ); tmp.y += 1;
      dropV.addScaledVector(tmp.sub(drop), 70 * sdt2); dropV.multiplyScalar(Math.exp(-sdt2 * 11));
      drop.addScaledVector(dropV, sdt2);
      sway.uDrop.value.copy(drop).multiplyScalar(HAIR_DROP / sc);
      // the turn from the upright head's down (0,-1,0) to the sprung down, about the axis between them
      tmp.copy(drop); tmp.y -= 1;
      const gl = tmp.length();
      if (gl > 1e-4) {
        tmp.divideScalar(gl);
        const ang = Math.acos(Math.max(-1, Math.min(1, -tmp.y)));
        V1.set(0, -1, 0).cross(tmp);
        const al = V1.length();
        if (al > 1e-5) sway.uTilt.value.set(V1.x / al, V1.y / al, V1.z / al, ang * RIG_OPTS.hairTurn); else sway.uTilt.value.set(1, 0, 0, 0);
      }
    }
    // the arms and thighs as capsules in the head's space, for the long strands to hang round (hair.ts uCap); only as
    // the head bends (upright, the tails hang behind the shoulders as built)
    if (hb) {
      const on = clamp((sway.uTilt.value.w - 0.25) / 0.35, 0, 1), sc = hb.getWorldScale(V1).y || 1;
      const caps = [['upperarmL', 'lowerarmL', 0.05], ['upperarmR', 'lowerarmR', 0.05], ['lowerarmL', 'handL', 0.042], ['lowerarmR', 'handR', 0.042], ['upperlegL', 'lowerlegL', thighR?.L ?? 0.08], ['upperlegR', 'lowerlegR', thighR?.R ?? 0.08]] as const;
      caps.forEach(([a, b, r], i) => {
        const A = sway.uCap.value[i * 2], Bv = sway.uCap.value[i * 2 + 1], ba = bs.get(a), bb = bs.get(b);
        if (!on || !ba || !bb) { A.w = 0; return; }
        hb.worldToLocal(ba.getWorldPosition(tmp)); A.set(tmp.x, tmp.y, tmp.z, (r + 0.012) / sc * on);
        hb.worldToLocal(bb.getWorldPosition(tmp)); Bv.set(tmp.x, tmp.y, tmp.z, 0);
      });
    }
    // the ground under the body as a plane in the head's space, 1.5 cm up (hair.ts uGround): the long tails rest on it
    if (hb && !RIG_OPTS.hairGround) sway.uGround.value.set(0, 0, 0, 0);
    else if (hb) {
      root.getWorldPosition(V2); const gy = ground ? ground(V2.x, V2.z) : V2.y;
      hb.getWorldQuaternion(dropQ).invert();
      V1.set(0, 1, 0).applyQuaternion(dropQ);
      hb.worldToLocal(V2.setY(gy + 0.015));
      sway.uGround.value.set(V1.x, V1.y, V1.z, -V1.dot(V2));
    }
    sway.uTime.value = t;
    sway.uFlutter.value = 0.003 + Math.min(amount, 1) * 0.007;
    kit?.update(t, amount);
    if (pitK) {
      // only a body drawn close to a game camera: further off the shapes cannot be told apart, and a crowd never has them
      const near = !CHAR_BUDGET.throttle || (!crowd && sinceDrawn <= 2 && camD < CHAR_BUDGET.correctiveNear);
      if (near) { if (!CHAR_BUDGET.throttle || camD < CHAR_BUDGET.correctiveNear * 0.5 || (++corrN & 1)) correctives(bs); corrOn = true; }
      else if (corrOn) { corrOn = false; for (const r of corrRegions) for (const k of r.keys) setMorph(k, 0); }
    }
    void phase;
  }

  /** Pose-driven corrective shapes (tools/chars/pit.py) for the shoulders, the neck and the hips: each region's bone turn
   * in its parent's frame (the upper arm in the chest's) mixes its shapes by radial basis interpolation over the game's
   * own poses, so the armpit keeps its shape with the arm at the side, forward or up, where linear skinning folded it
   * through itself. */
  function correctives(bs: Map<string, THREE.Bone>) {
    if (!corrRegions.length) {
      for (const [name, k] of Object.entries(pitK!)) {
        const ref = bs.get(k.ref)!, chain: THREE.Object3D[] = [];
        for (let o: THREE.Object3D | null = bs.get(k.bone)!; o && o !== ref; o = o.parent) chain.unshift(o);
        corrRegions.push({ k, keys: Array.from({ length: k.n }, (_, m) => `${name}${m}`), chain, phi: new Float64Array(k.dirs.length) });
      }
    }
    for (const r of corrRegions) {
      const k = r.k;
      // the driving bone's turn in its reference's frame (which way it points and how it is rolled): the product of the
      // local turns between them, with no walk up to the root
      Q.identity(); for (const o of r.chain) Q.multiply(o.quaternion);
      for (let i = 0; i < k.dirs.length; i++) { const d = k.dirs[i]; const a = 2 * Math.acos(Math.min(1, Math.abs(Q.x * d[0] + Q.y * d[1] + Q.z * d[2] + Q.w * d[3]))) / k.sigma; r.phi[i] = Math.exp(-a * a); }
      for (let m = 0; m < k.n; m++) { let c = 0; for (let i = 0; i < r.phi.length; i++) c += r.phi[i] * k.w[i][m]; setMorph(r.keys[m], clamp(c, -k.lim[m], k.lim[m])); }
    }
  }

  return {
    id, root, body, chest, head, armL, armR, legL, legR, handL, handR, fig, look: L,
    animate,
    setName,
    /** Hurt and moving like it. */
    setLimp(on: boolean) { limpOn = on; },
    setSplint(on: boolean) { pendingSplint = on; if (kit) kit.splint.visible = on; },
    setTagVisible(v: number) { (tag.material as THREE.SpriteMaterial).opacity = v; tag.visible = v > 0.02; },
    /** Mouth moves while > 0 (seconds of speech left). */
    /** Hand-set pose over the clip (null gives the body back to the clip). */
    setLimbs(l: Limbs | null) { limbs = l; },
    /** Down on both knees (true) or back up (false); it takes about a second either way. */
    setKneel(on: boolean, sit = false) { kneelGoal = on ? 1 : 0; heelsGoal = on && sit ? 1 : 0; },
    get kneeling() { return kneel; },
    /** An external pose owner (combat's melee rig) claims the arms until it lets go (null): keepArmsOut does not move
     *  them. The same as Limbs.ownArms, for a caller that poses the bones itself instead of through setLimbs. */
    claimArms(side: 'L' | 'R' | 'both' | null) { armOwner = side; },
    /** The torso as the rig keeps arms out of it: three capsules (hips to spine1, spine1 to chest, chest to neck) in
     *  root space, radius in metres (measured from this body's skin and clothes the first time it is posed; null
     *  before). Last frame's pose: call it after animate(). */
    torsoCapsules() {
      if (!torsoR || !B) return null;
      root.updateMatrixWorld(true);
      return TORSO.map(([a, b], j) => {
        const pa = B!.get(a)!.getWorldPosition(new THREE.Vector3()), pb = B!.get(b)!.getWorldPosition(new THREE.Vector3());
        const k = pa.distanceTo(pb) / (torsoLen[j] || 1), R = torsoR![j];
        // r: one radius, the mean of the half width and the depth (rx, rf, rb: the elliptic shape the rig itself uses)
        return { a: root.worldToLocal(pa), b: root.worldToLocal(pb), r: (R.x + (R.f + R.b) / 2) / 2 * k, rx: R.x * k, rf: R.f * k, rb: R.b * k };
      });
    },
    /** How far a world point is inside the torso as the arm guards see it (torsoCapsules' elliptic shapes, grown by
     *  margin), m; negative outside; null before the body is first posed. */
    torsoDepth(p: THREE.Vector3, margin = 0) {
      if (!torsoR || !B) return null;
      let pen = -9;
      for (let j = 0; j < TORSO.length; j++) pen = Math.max(pen, torsoIn(j, B.get(TORSO[j][0])!.getWorldPosition(new THREE.Vector3()), B.get(TORSO[j][1])!.getWorldPosition(new THREE.Vector3()), p, margin));
      return pen;
    },
    /** Something held in the right hand outside any task (a leaf cup, a berry); null puts it away. */
    setProp(k: PropKind | null) { heldProp = k; },
    /** The hand-set pose in force (null: the clip alone). */
    get limbsNow() { return limbs; },
    /** One of a crowd (CHAR_BUDGET): no corrective shapes, the light build and no shadow from closer in. */
    setCrowd(on: boolean) { crowd = on; prepFade(); },
    /** Draw skin, clothes and eyes as one mesh (bodymerge.ts; crowd bodies always do). For the stages, not the films. */
    /** `lite` (the city's story people on phones): without the forty corrective shapes (armpits, nape, hips), as a crowd
     * body: about 8 MB less per body in the page and as much again in the GPU's morph texture. */
    /** Every mesh of this body casts while the body does (the body you play: Away.enter). */
    castAll() { root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { castable.add(o); shSeen.add(o); } }); shDirty = true; },
    mergeParts(lite = false) { mergeWanted = true; mergeLite = lite; mergeCrowd(); },
    /** A crowd body that can fade (Web, Ultra) fades out towards 0 and back in towards 1; false: the stage hides it. */
    setLensFade(target: number) { lensWant = target; return fadeOn; },
    get canFade() { return fadeOn; },
    /** Test hook (tools/pedglitch.js): which build and which hair are drawn (0 near, 1 far each: build + 2 x hair). */
    get lodState() { return lodOn + hairOn * 2; },
    /** Faded out at the lens (not drawn). */
    get faded() { return fadeOn && !fig.visible; },
    /** Held expression (null goes back to what the pose asks for). */
    setFace(f: Face | null) { faceSet = f; },
    say(seconds: number) { speak = Math.max(speak, seconds); },
    /** Where the lips' middle is now, in the world (what eating and drinking bring the bread or the cup to). */
    lipsAt(out = new THREE.Vector3()) { return B ? lipsAt(B, out) : out.set(NaN, NaN, NaN); },
    /** Do something with the hands for `seconds`: reach to `at` (world), eat, drink, type... See TaskKind. */
    doTask(kind: TaskKind, o: { at?: THREE.Vector3 | null; seconds?: number; hands?: 'L' | 'R' | 'both'; prop?: PropKind | null; onContact?: () => void } = {}) {
      const dur = o.seconds ?? ({ pickup: 1.1, putdown: 1.1, throw: 1.4, plant: 1.6, drink: 2.2, eat: 2.6, type: 2.4, carry: 2.0, open: 1.2, give: 1.3, fix: 2.4, use: 1.8, gesture: 3, phone: 3 } as Record<TaskKind, number>)[kind];
      const prop = o.prop === undefined ? TASK_PROP[kind] ?? null : o.prop;
      // drinking from a cup is one hand's; from cupped hands, both
      const hands = o.hands ?? (kind === 'type' || kind === 'carry' || (kind === 'drink' && !prop) || kind === 'gesture' || kind === 'fix' ? 'both' : 'R');
      MA.fresh = true;
      task = { kind, t: 0, dur, at: o.at ? o.at.clone() : null, hands, prop, onContact: o.onContact ?? null, clipOk: kneelGoal === 0 };
    },
    /** Hold on to something with one or both hands: live world points and directions (mutate them to move the hands
     *  with what they hold); null lets go. */
    setHold(h: { L?: HoldSide; R?: HoldSide } | null) { hold = h; },
    /** Per-hand finger control. side 'L', 'R' or 'both'; g null gives the hand back to the automatic shape (relaxed,
     *  or what the task or prop asks). Shapes: 'open', 'relaxed', 'grip' (radius: the held thing's radius in metres,
     *  0.002 a bow string or sling cord, 0.015 a spear shaft, 0.02 a yoke horn, 0.04 a club), 'pinch' (thumb to index:
     *  an arrow nock, a stone to place), 'point'. amount 0..1 scales the curl (a loosening grip). Joints are clamped
     *  to a finger's range and the hand eases to the target, so calling it every frame with the same values is still. */
    setGrip(side: 'L' | 'R' | 'both', g: Grip | null) { for (const sd of side === 'both' ? ['L', 'R'] as const : [side]) { if (g) gripSet[sd] = { ...g }; else delete gripSet[sd]; } },
    /** Let go of the task now (it eases out over a moment). */
    stopTask() { if (task) { const out = Math.min(0.35, task.dur * 0.3); task.dur = Math.min(task.dur, task.t + out); task.t = Math.max(task.t, task.dur - out); } },
    /** What the hands are busy with, or null. */
    get task() { return task ? { kind: task.kind, t: task.t, dur: task.dur } : null; },
    /** Head offset for looking at something (radians). */
    look2(y: number, x: number) { lookAt.y = y; lookAt.x = x; },
    /** World point to keep an eye on, or null. The neck clamps it. */
    setLookTarget(v: THREE.Vector3 | null) { if (v) { gaze = gazeAt.copy(v); } else gaze = null; },
    /** How fast the head turns to the look target (per second; null = the usual 2.2). A dart is about 8: the eyes still lead. */
    setGazeRate(r: number | null) { gazeRate = r ?? 2.2; },
    /** Height of the ground under a point: enables foot planting on slopes. */
    setGround(fn: ((x: number, z: number) => number) | null) { ground = fn; },
    /** Resolves when the skinned body is in place. */
    whenReady,
    /** Resolves when the skinned body and its light build (if it has one) are both in place. */
    whenFull,
  };
}

export type Character = ReturnType<typeof createCharacter>;
