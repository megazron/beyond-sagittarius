import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp } from '../core/noise';
import { applySway, swayUniforms } from './sway';
import { buildHair, HAIRSTYLES, HAIR_CAP, HAIR_VOLUME, HAIR_ROUGH, HAIR_CARDS, skullFrom } from './hair';
import { LOOKS, CrewId, Look } from './looks';
import type { PlayerLook } from './custom';
import { voice } from '../core/voice';
import { AnimSet, CrewAsset, animNow, assetNow, clipsFor, corneaMaterial, clothDetail, eyeMaterial, furMaterial, lashMaterial, loadAnim, loadAsset, lodOf, mouthMaterial, skinMaterial, tex, texturesReady } from './assets';
import { addKit, Kit } from './kit';

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
export type CrewPose = 'swim' | 'float' | 'stand' | 'idle' | 'walk' | 'sit' | 'injured' | 'wave' | 'lie' | 'point' | 'cheer' | 'facepalm' | 'selfie' | 'shout' | 'argue' | 'present' | 'write' | 'jump';

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
const Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler();
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), V4 = new THREE.Vector3(), V5 = new THREE.Vector3();

/** Rotate a bone by a world-space rotation. */
const TORSO: [string, string][] = [['hips', 'spine1'], ['spine1', 'chest'], ['chest', 'neck']];
const SA = new THREE.Vector3(), SB = new THREE.Vector3();
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) { const ab = SB.copy(b).sub(a), t = Math.max(0, Math.min(1, SA.copy(p).sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(SA.copy(a).addScaledVector(ab, t)); }

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
  const fingerRest = new Map<THREE.Bone, THREE.Quaternion>();
  let gaitPhase = 0, inited = false, hipDrop = 0, sacAt = 1, sacX = 0, sacY = 0, firstFrame = true;
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
    const accent = { uAccent: { value: new THREE.Color(custom?.accent ?? 0xffffff) }, uAccentK: { value: custom ? 1 : 0 }, uDetail: { value: clothDetail() }, uHeightM: { value: heightM }, uSatin: { value: human ? 1 : 0 }, uDust: { value: human ? 0.12 : 1 } };
    applySway(cloth, sway, (sh) => {
      Object.assign(sh.uniforms, accent);
      sh.vertexShader = `attribute float aAccent; varying float vAccent; varying float vBindY;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vAccent = aAccent; vBindY = position.y;`);
      sh.fragmentShader = `uniform vec3 uAccent; uniform float uAccentK, uHeightM, uSatin, uDust; uniform sampler2D uDetail; varying float vAccent; varying float vBindY;\n` + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
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
    cloth.customProgramCacheKey = () => 'crew-cloth';
    const mouth = mouthMaterial(), cornea = corneaMaterial(), lash = lashMaterial(browC, M.lash);
    const fur = human ? furMaterial('strong_suit', 0x0e080b, 0x2a1d22, lod) : undefined;
    const sphere = new THREE.Sphere(new THREE.Vector3(0, heightM * 0.5, 0), heightM * 1.1);
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.boundingSphere = sphere;
      m.geometry.boundingSphere = sphere;
      const name = (m.material as THREE.Material).name;
      m.material = { skin, eyes, cornea, mouth, lash, cloth, fur }[name] ?? m.material;
      m.castShadow = name === 'skin' || name === 'cloth';
      m.receiveShadow = true;
      if (name === 'fur') { m.castShadow = false; const ly = m.geometry.getAttribute('_layer'); if (ly) m.geometry.setAttribute('aLayer', ly); const dn = m.geometry.getAttribute('_dens'); m.geometry.setAttribute('aDens', dn ?? new THREE.BufferAttribute(new Float32Array(m.geometry.getAttribute('position').count).fill(1), 1)); }
      if (name === 'cloth') {
        const g = m.geometry;
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
      }
    });
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
    const hair = buildHair(HAIRSTYLES[hairId](), hc, sway, detail, HAIR_CAP[hairId][0], HAIR_CAP[hairId][1], skullFrom(M.skull.c, M.skull.r), HAIR_VOLUME[hairId] ?? 0, HAIR_ROUGH[hairId] ?? 0.46, !!HAIR_CARDS[hairId]);
    bs.get('head')!.add(hair);
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
    kit = addKit({ id, custom, human, bones: bs, meta: M, look: L, sway, skinC, glowC, shadeC, detail, heightM });
    kit.splint.visible = pendingSplint;
    // clips
    const leg = piv('upperlegL').distanceTo(piv('lowerlegL')) + piv('lowerlegL').distanceTo(piv('footL'));
    legScale = leg / a.refLeg;
    clips = clipsFor(`${key}`, legScale, a);
    mixer = new THREE.AnimationMixer(scene);
    fig.scale.setScalar(custom ? custom.height : 1);
    fig.visible = true;
    void texturesReady().then(ready);
  };

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
        for (let i = 0; i < m.geometry.attributes.position.count; i += 2) {
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

  function animate(kind: CrewPose, phase: number, amount: number, t: number, dt: number) {
    if (!mixer || !B) return;
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
    if (sacAt <= 0) { sacAt = 1.2 + Math.random() * 3; sacX = (Math.random() - 0.5) * 0.05; sacY = (Math.random() - 0.5) * 0.09; }
    eyeY += (sacY + clamp(yawRate * 0.08, -0.25, 0.25) - eyeY) * (1 - Math.exp(-dt * 20));
    for (const n of ['eyeL', 'eyeR']) bs.get(n)!.quaternion.setFromEuler(E.set(sacX, eyeY, 0));
    chestB.scale.setScalar(1 + bp * 0.0025);

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
    easeMorph('smile', ex.smile ?? smileBase, r);
    easeMorph('frown', ex.frown ?? 0, r);
    easeMorph('fear', (ex.fear ?? 0) + eyeShape.fear + hurt * 0.1, r);
    easeMorph('squint', (ex.squint ?? 0) + eyeShape.squint, r);
    blinkAt -= dt;
    if (blinkAt <= 0) { blinkT = 0.15; blinkAt = 2.4 + Math.random() * 3.6; }
    if (blinkT > 0) blinkT -= dt;
    const bl = blinkT > 0 ? Math.sin((blinkT / 0.15) * Math.PI) : 0;
    setMorph('blink', Math.max(bl, ex.blink ?? eyeShape.blink));

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
    void phase;
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
    /** Held expression (null goes back to what the pose asks for). */
    setFace(f: Face | null) { faceSet = f; },
    say(seconds: number) { speak = Math.max(speak, seconds); },
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
