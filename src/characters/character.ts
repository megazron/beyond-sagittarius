import * as THREE from 'three';
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
import { perfBody } from '../core/perfhud';

export type { CrewId } from './looks';
export { preloadCrew } from './assets';
/** A direction in the body's own space: +x left, +y up, +z forward. */
export type Dir = [number, number, number];
/**
 * A hand-set body pose laid over the clip, for bodies no mocap covers (free fall,
 * crash landings). Directions are where each bone points, so the same pose fits
 * every build and no rig axes leak out of here.
 */
export interface Limbs { armL?: Dir; armR?: Dir; foreL?: Dir; foreR?: Dir; legL?: Dir; legR?: Dir; shinL?: Dir; shinR?: Dir; bend?: number; twist?: number; openHands?: boolean; hair?: Dir }
export type Face = Partial<Record<'smile' | 'frown' | 'fear' | 'squint' | 'open' | 'blink', number>>;
/** Something the hands do (Character.doTask): reach and pick up, use a thing in front of you, eat, drink, type, open,
 * carry, fix, give, plant, or talk with the hands. */
export type TaskKind = 'pickup' | 'use' | 'eat' | 'drink' | 'type' | 'open' | 'carry' | 'fix' | 'give' | 'plant' | 'gesture' | 'phone';
/** Things a task puts in the hands: food, a cup, a phone, a parcel, a tool, a sheet of paper. */
export type PropKind = 'food' | 'cup' | 'phone' | 'box' | 'tool' | 'paper';
const PROP_DEF: Record<PropKind, () => THREE.Mesh> = {
  food: () => new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 18), new THREE.MeshStandardMaterial({ color: 0xc8893f, roughness: 0.85 })),
  cup: () => new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.075, 16), new THREE.MeshStandardMaterial({ color: 0xb5563a, roughness: 0.7 })),
  phone: () => new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.008, 0.15), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.4, emissive: 0x1a2a44, emissiveIntensity: 0.6 })),
  box: () => new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.22), new THREE.MeshStandardMaterial({ color: 0xa47a4c, roughness: 0.9 })),
  tool: () => new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.028, 0.028), new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.4, metalness: 0.8 })),
  paper: () => new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.003, 0.22), new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.95 })),
};
/** What each task holds unless told otherwise. */
const TASK_PROP: Partial<Record<TaskKind, PropKind>> = { eat: 'food', drink: 'cup', phone: 'phone', carry: 'box', fix: 'tool', type: 'phone' };
const LOW_TASKS: Partial<Record<TaskKind, number>> = { pickup: 1, drink: 1, fix: 0.85, plant: 1 };
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
export const CHAR_BUDGET = { throttle: true, correctiveNear: 9, lodFar: 11, shadowFar: 16, crowdLodFar: 6, crowdShadowFar: 0 };

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
  let gaze: THREE.Vector3 | null = null, gazeY = 0, gazeX = 0;
  let B: Map<string, THREE.Bone> | null = null;
  // the forearm's own axis per side (rest frames carry no rotation, so it is the same in the twist bone and the hand)
  const twistAx: Record<string, THREE.Vector3> = {};
  let mixer: THREE.AnimationMixer | null = null;
  let clips: Map<string, THREE.AnimationClip> | null = null;
  let A: AnimSet | null = null;
  let legScale = 1;
  let kit: Kit | null = null;
  const faces: { dict: Record<string, number>; infl: number[] }[] = [];
  const acts = new Map<string, { a: THREE.AnimationAction; w: number; target: number; manual: boolean }>();
  let ready: () => void = () => {};
  const whenReady = new Promise<void>((r) => { ready = r; });
  let ground: ((x: number, z: number) => number) | null = null;
  const lookAt = { y: 0, x: 0 };
  const morph: Record<string, number> = {};
  let blinkAt = 2 + Math.random() * 3, blinkT = 0, speak = 0;
  let limbs: Limbs | null = null, faceSet: Face | null = null;
  // a task in the hands (doTask): time in, length, where the hand goes, which hands
  let task: { kind: TaskKind; t: number; dur: number; at: THREE.Vector3 | null; hands: 'L' | 'R' | 'both'; prop: PropKind | null } | null = null;
  // the thing in the hand: made once per kind, parented to the hand (or held in front of the hips for a parcel)
  const props = new Map<PropKind, THREE.Mesh>();
  let propOn: THREE.Mesh | null = null;
  function showProp(bs: Map<string, THREE.Bone>, kind: PropKind | null, w: number) {
    const want = kind && w > 0.35 ? kind : null;
    if (propOn && (!want || props.get(want) !== propOn)) { propOn.removeFromParent(); propOn = null; }
    if (!want || propOn) return;
    let m = props.get(want);
    if (!m) { m = PROP_DEF[want](); m.castShadow = true; props.set(want, m); }
    // the rig's rest pose has every rotation at identity (a T pose): the right hand's fingers point along -x, the palm down
    if (want === 'box') { bs.get('hips')!.add(m); m.position.set(0, 0.12, 0.3); m.rotation.set(0, 0, 0); }
    else {
      const h = bs.get('handR')!; h.add(m);
      if (want === 'phone' || want === 'paper') { m.position.set(-0.08, -0.03, 0.01); m.rotation.set(0, Math.PI / 2, 0.25); }
      else if (want === 'tool') { m.position.set(-0.07, -0.03, 0); m.rotation.set(0, Math.PI / 2, 0); }
      else if (want === 'cup') { m.position.set(-0.07, -0.05, 0.02); m.rotation.set(0, 0, Math.PI / 2); }
      else { m.position.set(-0.08, -0.03, 0); m.rotation.set(0, 0, 0.3); }
    }
    propOn = m;
  }
  const taskQ = new Map<string, THREE.Quaternion>();
  // idle life: a look around now and then, the weight moving from foot to foot
  let idleLookAt = 3 + Math.random() * 5, idleLook = 0, idleLookWant = 0, idleShift = Math.random() * 6;
  const fingerRest = new Map<THREE.Bone, THREE.Quaternion>();
  let gaitPhase = 0, inited = false, hipDrop = 0, sacAt = 1, sacX = 0, sacY = 0, firstFrame = true, eyeAimX = 0, eyeAimY = 0;
  const footOff = [0, 0];
  const pin = [new THREE.Vector3(), new THREE.Vector3()], pinOff = [new THREE.Vector3(), new THREE.Vector3()], pinned = [false, false];
  const trackPos = new THREE.Vector3();
  let tracked = false, trackYaw = 0, groundSpeed = 0, yawRate = 0, gaitOn = false, eyeY = 0;
  const lastPos = new THREE.Vector3(), swing = new THREE.Vector3(), swingV = new THREE.Vector3(), tmp = new THREE.Vector3();
  const eyeShape = EYE_SHAPE[custom ? custom.eye : human ? 'calm' : L.face.eye] ?? EYE_SHAPE.calm;
  const smileBase = MOUTH[L.face.mouth] ?? 0.1;

  const attach = (asset: CrewAsset, a: AnimSet) => {
    const scene = cloneSkinned(asset.scene) as THREE.Group;
    const M = asset.meta;
    const bs = bones(scene);
    B = bs; A = a;
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
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.6, 0.52) + vec3(0.035, 0.028, 0.02), dust);`)
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
    torsoR = null; torsoBody = [];
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
      void loadAsset(key, 1).then((as1) => {
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
        lodSets[1] = ms;
      }).catch(() => { /* no light build: the full body everywhere */ });
    }
    kit = addKit({ id, custom, human, bones: bs, meta: M, look: L, sway, skinC, glowC, shadeC, detail, heightM });
    kit.splint.visible = pendingSplint;
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
    fig.visible = true;
    void texturesReady().then(ready);
  };

  let pitK: CrewMeta['pit'] | null = null;
  // per region: its shapes' morph names and the bones from just below its reference down to its driving bone
  let corrRegions: { k: NonNullable<CrewMeta['pit']>[string]; keys: string[]; chain: THREE.Object3D[]; phi: Float64Array }[] = [];
  // how this body is seen (CHAR_BUDGET): animate() calls since a game camera last drew it, and that camera's distance
  let perfStamp = 0;
  let sinceDrawn = 99, camD = 0, skipN = 0, skipDt = 0, corrOn = false, corrN = 0, crowd = false;
  let lodSets: THREE.SkinnedMesh[][] = [[], []], lodOn = 0, rigid: THREE.SkinnedMesh[] = [], hairs: [THREE.Object3D | null, THREE.Object3D | null] = [null, null], hairOn = 0;
  const castable = new Set<THREE.Object3D>(); // the meshes that cast a shadow when near
  let shadowsOn = true;
  function pickLod() {
    // a far body's shadow is a few pixels: it is left out of the shadow map
    const sh = camD < (crowd ? CHAR_BUDGET.crowdShadowFar : CHAR_BUDGET.shadowFar) * (shadowsOn ? 1.1 : 0.9);
    if (sh !== shadowsOn) { shadowsOn = sh; for (const set of [...lodSets, rigid]) for (const m of set) m.castShadow = sh && castable.has(m); }
    // phones: the corneas' shine and the lashes and brows are under a pixel past a few metres, and a draw call each
    if (lod === 1 || crowd) for (const m of lodSets[lod === 1 ? 0 : lodOn]) {
      const far = (crowd ? CROWD_FACE_FAR : FACE_FAR)[m.name];
      if (far) m.visible = camD < far * (m.visible ? 1.1 : 0.9);
    }
    for (const h of hairs) if (h) h.castShadow = sh;
    const wantH = hairs[1] && camD > (crowd ? CHAR_BUDGET.crowdLodFar : CHAR_BUDGET.lodFar) * (hairOn ? 0.9 : 1.1) ? 1 : 0;
    if (wantH !== hairOn) { hairOn = wantH; hairs[0]!.visible = wantH === 0; hairs[1]!.visible = wantH === 1; }
    if (!lodSets[1].length) return;
    const want = camD > (crowd ? CHAR_BUDGET.crowdLodFar : CHAR_BUDGET.lodFar) * (lodOn ? 0.9 : 1.1) ? 1 : 0;
    if (want === lodOn) return;
    lodOn = want;
    for (const m of lodSets[0]) m.visible = want === 0;
    for (const m of lodSets[1]) m.visible = want === 1;
  }
  function seen(this: THREE.Object3D, _r: THREE.WebGLRenderer, _s: THREE.Scene, c: THREE.Camera) {
    if (!(c as THREE.PerspectiveCamera).isPerspectiveCamera) return; // the sun's shadow camera does not count
    sinceDrawn = 0; perfStamp = perfBody(perfStamp);
    const a = c.matrixWorld.elements, b = this.matrixWorld.elements;
    camD = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
  }
  let torsoR: number[] | null = null, torsoLen: number[] = [], torsoBody: THREE.SkinnedMesh[] = []; // read by keepArmsOut
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

  /** Hands and forearms never sink into the torso: the upper arm swings out just enough to clear it. */
  function keepArmsOut(bs: Map<string, THREE.Bone>) {
    if (!torsoR && !torsoBody.length) return;
    root.updateWorldMatrix(true, true);
    // world matrices are fresh from the update above: read positions straight off them, no walk up the parents
    const wp = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const seg = TORSO.map(([a, b]) => [wp(bs.get(a)!), wp(bs.get(b)!)] as const);
    if (!torsoR) {
      // the skinned, morphed skin as it really stands, in world space: the raw attribute is not the body you see
      const per: number[][] = TORSO.map(() => []), v = new THREE.Vector3();
      // clothes count only above the hips: a coat's skirt flares away from the body and is not torso
      const hip = seg[0][0], up = seg[2][1].clone().sub(hip), upL2 = up.lengthSq();
      for (const m of torsoBody) {
        m.updateWorldMatrix(true, false);
        const cloth = m.name === 'cloth';
        for (let i = 0, n = m.geometry.userData.torsoCount ?? m.geometry.attributes.position.count; i < n; i += 2) {
          m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); let best = 9, k = -1;
          if (cloth && SA.copy(v).sub(hip).dot(up) / upL2 < .05) continue;
          seg.forEach(([a, b], j) => { const d = segDist(v, a, b); if (d < best) { best = d; k = j; } });
          if (k >= 0 && best < .3) per[k].push(best);
        }
      }
      torsoR = per.map((x) => { x.sort((a, b) => a - b); return x.length ? x[Math.floor(x.length * .45)] : .1; });
      torsoLen = seg.map(([a, b]) => a.distanceTo(b));
    }
    for (const s of ['L', 'R']) {
      const upper = bs.get(`upperarm${s}`)!, sh = wp(upper);
      let turned = 0;
      for (let it = 0; it < 7 && turned < .7; it++) {
        let worst = 0, at: THREE.Vector3 | null = null, axisPt: THREE.Vector3 | null = null;
        for (const n of [`hand${s}`, `finger3_2${s}`, `lowerarm${s}`]) {
          const bn = bs.get(n); if (!bn) continue; const p = wp(bn);
          seg.forEach(([a, b], j) => {
            const pen = torsoR![j] * (a.distanceTo(b) / (torsoLen[j] || 1)) + 0.015 - segDist(p, a, b); // bind units to world
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
    if (l.openHands) fingerRest.forEach((q, b) => b.quaternion.copy(q));
  }

  /** 0..1: how far into its task the body is (eases in, holds, eases out). */
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
      case 'pickup': case 'plant': {
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

  /** The hands go to the task's goal by two-bone IK, blended in and out with the task. */
  function taskArms(bs: Map<string, THREE.Bone>, kind: CrewPose, t: number, dt: number) {
    const T = task!;
    T.t += dt;
    const w = taskEnv();
    if (T.t >= T.dur) { task = null; showProp(bs, null, 0); return; }
    showProp(bs, T.prop, w);
    if (w <= 0.001) return;
    const k = clamp(T.t / T.dur, 0, 1);
    const sides: ('L' | 'R')[] = T.hands === 'both' ? ['L', 'R'] : [T.hands];
    root.updateWorldMatrix(true, true);
    for (const sd of sides) {
      const up = bs.get(`upperarm${sd}`), lo = bs.get(`lowerarm${sd}`), hd = bs.get(`hand${sd}`);
      if (!up || !lo || !hd) continue;
      const goal = handGoal(bs, sd, k, t, new THREE.Vector3());
      const qu = (taskQ.get(up.name) ?? taskQ.set(up.name, new THREE.Quaternion()).get(up.name)!).copy(up.quaternion);
      const ql = (taskQ.get(lo.name) ?? taskQ.set(lo.name, new THREE.Quaternion()).get(lo.name)!).copy(lo.quaternion);
      solveLeg(up, lo, hd, goal);
      up.quaternion.copy(qu.slerp(up.quaternion, w));
      lo.quaternion.copy(ql.slerp(lo.quaternion, w));
      up.updateWorldMatrix(false, true);
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
    if (!mixer || !B) return;
    if (CHAR_BUDGET.throttle && !firstFrame) { // the first pose is always set at once: never a frame of bind pose
      // a body its stage has hidden (a phone's far townsfolk, the crowd pool's idle bodies) is not posed at all; the
      // moment it shows again it is posed straight away
      // its sixty bones are not even carried along by three.js's matrix pass while it is hidden
      if (!root.visible) { skipDt = Math.min(skipDt + dt, 0.2); skipN = 99; root.matrixWorldAutoUpdate = false; return; }
      root.matrixWorldAutoUpdate = true;
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
      const name = kind === 'idle' ? style.idle : kind === 'walk' ? 'stand' : kind === 'swim' ? (speed > 0.35 ? 'swim' : 'swim_idle') : kind;
      const s = action(clips!.has(name) ? name : 'stand', false);
      s.target = 1;
      s.a.timeScale = style.rate;
      // reaching low (picking up, drinking, fixing something on the ground): the knees go with it
      const low = task ? (LOW_TASKS[task.kind] ?? 0) * taskEnv() * (FULL_BODY.has(kind) ? 0 : 1) : 0;
      if (low > 0 && clips!.has('crouch') && name !== 'crouch') { const c = action('crouch', false); c.target = low * 0.8; s.target = 1 - low * 0.8; }
    }
    const rate = firstFrame ? 1 : 1 - Math.exp(-dt * 4.5);
    let sum = 0;
    for (const s of acts.values()) { s.w += (s.target - s.w) * rate; if (s.w < 0.004 && s.target === 0) s.w = 0; sum += s.w; }
    for (const s of acts.values()) {
      s.a.enabled = s.w > 0;
      s.a.setEffectiveWeight(sum > 0 ? s.w / sum : 0);
      if (s.manual) { s.a.timeScale = 0; s.a.time = gaitPhase * s.a.getClip().duration; }
    }
    mixer.update(firstFrame ? 0.001 : dt);
    firstFrame = false;

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
    keepArmsOut(bs);
    if (task) taskArms(bs, kind, t, dt);
    else if (kind === 'idle' && !gaze && speak <= 0 && !moving) idleLife(bs, t, dt);
    else { idleLook *= Math.exp(-dt * 3); }
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
    const gr = 1 - Math.exp(-dt * 2.2);
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

    // the thumb's root bone turns in less than the clip asks: the skin from the thumb's base to the wrist blends it
    // with the hand and the forearm, and a full fist folded it over itself in a groove you saw into
    for (const sd of ['L', 'R']) { const t1 = bs.get(`finger1_1${sd}`); if (t1) t1.quaternion.slerp(Q.identity(), 0.45); }

    // relaxed hands: the clips close the fingers into tight fists and claws; a third of the way back to the open rest
    // pose reads as a hand at ease (a pointing finger stays pointing, a fist stays a loose fist)
    fingerRest.forEach((q, b) => { if (!b.name.startsWith('finger1_1')) b.quaternion.slerp(q, 0.3); });

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
    if (ground && standing && root.visible) {
      root.updateWorldMatrix(true, true);
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
        fig.updateWorldMatrix(true, true);
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
    /** One of a crowd (CHAR_BUDGET): no corrective shapes, the light build and no shadow from closer in. */
    setCrowd(on: boolean) { crowd = on; },
    /** Held expression (null goes back to what the pose asks for). */
    setFace(f: Face | null) { faceSet = f; },
    say(seconds: number) { speak = Math.max(speak, seconds); },
    /** Do something with the hands for `seconds`: reach to `at` (world), eat, drink, type... See TaskKind. */
    doTask(kind: TaskKind, o: { at?: THREE.Vector3 | null; seconds?: number; hands?: 'L' | 'R' | 'both'; prop?: PropKind | null } = {}) {
      const dur = o.seconds ?? ({ pickup: 1.1, plant: 1.6, drink: 2.2, eat: 2.6, type: 2.4, carry: 2.0, open: 1.2, give: 1.3, fix: 2.4, use: 1.8, gesture: 3, phone: 3 } as Record<TaskKind, number>)[kind];
      const hands = o.hands ?? (kind === 'type' || kind === 'carry' || kind === 'drink' || kind === 'gesture' || kind === 'fix' ? 'both' : 'R');
      task = { kind, t: 0, dur, at: o.at ? o.at.clone() : null, hands, prop: o.prop === undefined ? TASK_PROP[kind] ?? null : o.prop };
    },
    /** Let go of the task now (it eases out over a moment). */
    stopTask() { if (task) { const out = Math.min(0.35, task.dur * 0.3); task.dur = Math.min(task.dur, task.t + out); task.t = Math.max(task.t, task.dur - out); } },
    /** What the hands are busy with, or null. */
    get task() { return task ? { kind: task.kind, t: task.t, dur: task.dur } : null; },
    /** Head offset for looking at something (radians). */
    look2(y: number, x: number) { lookAt.y = y; lookAt.x = x; },
    /** World point to keep an eye on, or null. The neck clamps it. */
    setLookTarget(v: THREE.Vector3 | null) { if (v) { gaze = gazeAt.copy(v); } else gaze = null; },
    /** Height of the ground under a point: enables foot planting on slopes. */
    setGround(fn: ((x: number, z: number) => number) | null) { ground = fn; },
    /** Resolves when the skinned body is in place. */
    whenReady,
  };
}

export type Character = ReturnType<typeof createCharacter>;
