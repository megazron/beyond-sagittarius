import { DECREEP } from './decreep';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { swayUniforms } from './sway';
export { swayUniforms };

const BASE = `${import.meta.env.BASE_URL}models/${DECREEP ? 'crew_dc' : 'crew'}/`;

export interface ClipMeta { loop: boolean; speed: number; kind: string; dur: number; hand: string; take: string; }
export interface AnimSet { refLeg: number; refHip: number; meta: Record<string, ClipMeta>; clips: Map<string, THREE.AnimationClip>; }
export interface CrewMeta {
  height: number; skin: string; lash?: string; atlas: string;
  pivots: Record<string, [number, number, number]>;
  skull: { c: number[]; r: number[][] };
  fit: Record<'waist' | 'neck' | 'chest', [number, number, number, number]>;
  build_slim_pivots?: number[][]; build_heavy_pivots?: number[][];
  /** pose-driven correctives (tools/chars/pit.py), per region: the bone whose turn in ref's frame drives them, the key
   * turns (quaternions, the last is the bind pose), each key's weights for the n shapes, their limits, the kernel width */
  /** Each atlas tile's garment layer, in the outfit's order (footwear 0.5, then 1, 2 and so on outwards). */
  layers?: number[];
  pit?: Record<string, { bone: string; ref: string; dirs: number[][]; w: number[][]; lim: number[]; n: number; sigma: number }>;
}
export interface CrewAsset { scene: THREE.Group; meta: CrewMeta; }

const gltf = new GLTFLoader();
const assets = new Map<string, Promise<CrewAsset>>();
const loaded = new Map<string, CrewAsset>();
let animP: Promise<AnimSet> | null = null;
let anim: AnimSet | null = null;
const texCache = new Map<string, THREE.Texture>();
/** What the body caches hold (memory reports: __bs.memOwners). */
export const assetCacheNow = () => ({ scenes: [...loaded.values()].map((a) => a.scene), textures: [...texCache.values()] });
const pending = new Set<Promise<void>>();
const loadTex = (url: string) => {
  let done: () => void = () => {};
  const p = new Promise<void>((r) => { done = r; });
  pending.add(p);
  const fin = () => { pending.delete(p); done(); };
  return new THREE.TextureLoader().load(url, fin, undefined, () => { console.warn('[crew] texture', url); fin(); });
};
/** What releaseCrew let go (memory reports: __bs.memOwners). */
export const CREW_RELEASE = { textures: 0, assets: 0 };
/**
 * Phones, once a stage's bodies are all made: the body textures nothing under `keep` uses leave the GPU (the title's,
 * the creator's and the portraits' looks; three.js uploads one again if another scene draws it), and the loaded body
 * builds are forgotten (every body made already holds its own geometry; a later one loads its build again, from the
 * browser's cache). `?crewrelease=0` keeps them.
 */
export function releaseCrew(keep: THREE.Object3D) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('crewrelease') === '0') return;
  const used = new Set<THREE.Texture>();
  keep.traverse((o) => {
    const mt = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mt) ? mt : mt ? [mt] : []) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if ((v as THREE.Texture)?.isTexture) used.add(v as THREE.Texture);
      const u = (m as THREE.ShaderMaterial).uniforms; if (u) for (const x of Object.values(u)) if ((x?.value as THREE.Texture)?.isTexture) used.add(x.value as THREE.Texture);
    }
  });
  for (const t of texCache.values()) if (!used.has(t)) { t.dispose(); CREW_RELEASE.textures++; }
  CREW_RELEASE.assets += loaded.size;
  loaded.clear(); assets.clear();
}
/** Resolves when every texture requested so far has arrived. */
export const texturesReady = async () => { await Promise.all([...pending]); };

/** Web or phone: decides mesh LOD and texture size for everything loaded afterwards. */
export const lodOf = (detail: number) => (detail < 0.8 ? 1 : 0);

/** How many keys of each clip had their rotation's sign turned to match the key before (read by the checks). */
export const CLIP_FLIPS: Record<string, number> = {};
export function loadAnim() {
  animP ??= (async () => {
    const [g, j] = await Promise.all([gltf.loadAsync(`${BASE}anim.glb`), fetch(`${BASE}anim.json`).then((r) => r.json())]);
    // a rotation and its negative are the same pose, but blending from one key to the next goes the long way round
    // when their signs differ: the hand swung through a half turn between two keys of a held pose (the selfie's phone
    // went flat and upside down). Every rotation track is made to run on one side.
    for (const c of g.animations) for (const t of c.tracks) {
      if (!t.name.endsWith('.quaternion')) continue;
      const v = t.values;
      for (let i = 4; i < v.length; i += 4) {
        if (v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1] < 0) { v[i] = -v[i]; v[i + 1] = -v[i + 1]; v[i + 2] = -v[i + 2]; v[i + 3] = -v[i + 3]; CLIP_FLIPS[c.name] = (CLIP_FLIPS[c.name] ?? 0) + 1; }
      }
    }
    anim = { refLeg: j.refLeg, refHip: j.refHip, meta: j.clips, clips: new Map(g.animations.map((c) => [c.name, c])) };
    return anim;
  })();
  return animP;
}
export const animNow = () => anim;

/** Whether a body ships a light `.lod1` build (every body does now, the creator bodies too). */
export const hasLod1 = (_key: string) => true;
export function loadAsset(key: string, lod: number) {
  const file = lod && hasLod1(key) ? `${key}.lod1` : key;
  const id = `${file}`;
  let p = assets.get(id);
  if (!p) {
    p = (async () => {
      const [g, meta] = await Promise.all([gltf.loadAsync(`${BASE}${file}.glb`), fetch(`${BASE}${key}.json`).then((r) => r.json())]);
      try { joinSkin(g.scene); } catch (e) { console.warn("[crew] skin join", e); }
      const a: CrewAsset = { scene: g.scene, meta };
      loaded.set(id, a);
      return a;
    })();
    assets.set(id, p);
  }
  return p;
}
/**
 * The light build's head and body skin are one mesh: they share the material and the skeleton, and the head's face
 * shapes are the first of the body's, so the head takes zeros for the rest. One draw call a body less in every pass, for
 * every body a phone draws and every far one elsewhere. The body's vertices come first (`torsoCount`, read by
 * keepArmsOut, which measures the torso from the body alone); the full builds stay as they are (faces, films, play
 * capture).
 */
/** Two skeletons that pose a mesh the same way: the same bones in the same order, bound at the same rest pose. */
export function sameSkeleton(a: THREE.Skeleton, b: THREE.Skeleton) {
  if (a === b) return true;
  if (a.bones.length !== b.bones.length || a.bones.some((x, i) => x !== b.bones[i])) return false;
  return a.boneInverses.every((m, i) => m.elements.every((v, k) => Math.abs(v - b.boneInverses[i].elements[k]) < 1e-5));
}
function joinSkin(scene: THREE.Group) {
  let head: THREE.SkinnedMesh | null = null, body: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) { if (m.name === 'skin_head') head = m; else if (m.name === 'skin_body') body = m; } });
  if (!head || !body) return;
  const h = (head as THREE.SkinnedMesh).geometry, b = (body as THREE.SkinnedMesh).geometry;
  const hn = Object.keys((head as THREE.SkinnedMesh).morphTargetDictionary ?? {}), bn = Object.keys((body as THREE.SkinnedMesh).morphTargetDictionary ?? {});
  // the same attributes, the same types, the same skin, and the head's shapes a prefix of the body's: otherwise leave them
  const same = Object.keys(b.attributes).length === Object.keys(h.attributes).length && Object.entries(b.attributes).every(([k, a]) => {
    const o = h.attributes[k]; return !!o && o.itemSize === a.itemSize && o.normalized === a.normalized && (o as THREE.BufferAttribute).array.constructor === (a as THREE.BufferAttribute).array.constructor;
  });
  if (!same || !b.index || !h.index || hn.some((n, i) => bn[i] !== n) || !sameSkeleton((head as THREE.SkinnedMesh).skeleton, (body as THREE.SkinnedMesh).skeleton)
    || !(head as THREE.SkinnedMesh).bindMatrix.equals((body as THREE.SkinnedMesh).bindMatrix) || Object.keys(b.morphAttributes).some((k) => k !== 'position')) return;
  const nb = b.attributes.position.count, nh = h.attributes.position.count;
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(b.attributes)) {
    const A = a as THREE.BufferAttribute, H = h.attributes[k] as THREE.BufferAttribute, n = A.itemSize;
    if (!(A as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !(H as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const C = A.array.constructor as new (n: number) => THREE.TypedArray;
      const out = new C((nb + nh) * n);
      out.set(A.array as ArrayLike<number>, 0); out.set(H.array as ArrayLike<number>, nb * n);
      g.setAttribute(k, new THREE.BufferAttribute(out, n, A.normalized));
    } else {
      // quantized normals come interleaved (a stride of 4 bytes for 3): read them out as floats
      const out = new Float32Array((nb + nh) * n);
      [A, H].forEach((src, s) => { const o = s ? nb : 0; for (let i = 0; i < src.count; i++) for (let c = 0; c < n; c++) out[(o + i) * n + c] = src.getComponent(i, c); });
      g.setAttribute(k, new THREE.BufferAttribute(out, n));
    }
  }
  const bi = b.index.array, hi = h.index.array, idx = new Uint32Array(bi.length + hi.length);
  idx.set(bi, 0); for (let i = 0; i < hi.length; i++) idx[bi.length + i] = hi[i] + nb;
  g.setIndex(new THREE.BufferAttribute(nb + nh > 65535 ? idx : new Uint16Array(idx), 1));
  g.morphTargetsRelative = b.morphTargetsRelative;
  g.morphAttributes.position = (b.morphAttributes.position ?? []).map((t, i) => {
    const out = new Float32Array((nb + nh) * 3), ht = h.morphAttributes.position?.[i];
    out.set(t.array as ArrayLike<number>, 0);
    if (ht && i < hn.length) out.set(ht.array as ArrayLike<number>, nb * 3);
    return new THREE.BufferAttribute(out, 3);
  });
  g.userData.torsoCount = nb;
  (body as THREE.SkinnedMesh).geometry = g;
  (head as THREE.SkinnedMesh).removeFromParent();
}

export function assetNow(key: string, lod: number) {
  return loaded.get(lod && hasLod1(key) ? `${key}.lod1` : key);
}

/** Load everything the first frames need, so characters appear without a pop. */
export async function preloadCrew(keys: string[], detail = 1) {
  await Promise.all([loadAnim(), ...keys.map((k) => loadAsset(k, lodOf(detail)))]);
}

export function tex(name: string, lod: number, srgb = false) {
  const url = `${BASE}tex/${name}${lod ? '.m' : ''}.webp`;
  let t = texCache.get(url);
  if (!t) {
    t = loadTex(url);
    t.flipY = false;
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}
export function texPlain(name: string, srgb = false) {
  const url = `${BASE}tex/${name}.webp`;
  let t = texCache.get(url);
  if (!t) {
    t = loadTex(url);
    t.flipY = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}

/** Hips translations in the clips are authored for the reference legs; each body gets its own. */
const scaled = new Map<string, Map<string, THREE.AnimationClip>>();
export function clipsFor(key: string, legRatio: number, a: AnimSet) {
  const k = `${key}:${legRatio.toFixed(3)}`;
  let m = scaled.get(k);
  if (!m) {
    m = new Map();
    for (const [n, c] of a.clips) {
      const d = c.clone();
      d.tracks = d.tracks.map((t) => {
        if (!t.name.endsWith('.position')) return t;
        const u = t.clone();
        for (let i = 0; i < u.values.length; i++) u.values[i] *= legRatio;
        return u;
      });
      m.set(n, d);
    }
    scaled.set(k, m);
  }
  return m;
}

const col = (c: number) => new THREE.Color(c);
const detailTile = (n: string) => { const t = texPlain(n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
/** How far each channel wraps: skin passes its own hue deepest, as flesh passes red. */
const scatterOf = (skin: number) => { const c = col(skin), m = Math.max(c.r, c.g, c.b, 0.01); return new THREE.Vector3(0.12 + 0.3 * c.r / m, 0.12 + 0.3 * c.g / m, 0.12 + 0.3 * c.b / m); };
export const clothDetail = () => detailTile('detail_cloth');

export interface SkinLook { skin: number; shade: number; lip: number; glow: number; over: number; glowK: number; }

/** Photo detail, species colour: the neutral map is recoloured here, so every skin keeps its pores. */
export function skinMaterial(sex: string, marks: string, l: SkinLook, lod: number) {
  const m = new THREE.MeshStandardMaterial({ map: tex(`skin_${sex}`, lod), normalMap: tex(`skin_${sex}_n`, lod), normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.52 });
  m.userData.film = { kind: 'skin', sex, marks, ...l };
  const u = {
    uSkin: { value: col(l.skin) }, uShade: { value: col(l.shade) }, uLip: { value: col(l.lip) }, uGlow: { value: col(l.glow) }, uOver: { value: col(l.over) },
    uGlowK: { value: l.glowK }, uMarks: { value: texPlain(`${marks}_marks`) },
    uDetail: { value: detailTile('detail_skin') }, uScatter: { value: scatterOf(l.skin) },
    uCloth: { value: null as THREE.Texture | null }, uUnderAccent: { value: new THREE.Color(0xffffff) }, uUnderAccentK: { value: 0 },
  };
  m.userData.u = u; // stages turn a lineage's marks up and down
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    // skin a garment encloses is drawn as that garment (under.ts): aUnder = the cloth's uv, 1 when covered, its accent
    sh.vertexShader = `attribute vec4 aUnder; varying vec4 vUnder;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vUnder = aUnder;`);
    sh.fragmentShader = `uniform vec3 uSkin, uShade, uLip, uGlow, uOver, uScatter, uUnderAccent; uniform float uGlowK, uUnderAccentK; uniform sampler2D uMarks, uDetail, uCloth; varying vec4 vUnder;\n` + sh.fragmentShader
      // subsurface look: light wraps past the terminator, further in the skin's own colour
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `{ float nlw = dot( geometryNormal, directLight.direction );
           vec3 sss = saturate( ( nlw + uScatter ) / ( 1.0 + uScatter ) );
           sss *= mix( vec3( 1.0 ), sss, 0.5 );
           reflectedLight.directDiffuse += sss * directLight.color * BRDF_Lambert( material.diffuseColor ); }`))
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.56, 0.33, sk.g) - 0.05 * (texture2D(uDetail, vMapUv * 3.0).b - 0.5);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 dn = texture2D(uDetail, vMapUv * 16.0).xy * 2.0 - 1.0; normal = normalize(normal + tbn * vec3(dn * 0.32, 0.0)); }`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec4 sk = texture2D(map, vMapUv);
        float sr = sk.r * 2.0;
        vec3 mk = texture2D(uMarks, vMapUv).rgb;
        vec3 sc = mix(uShade, uSkin, clamp((sr - 0.45) / 0.55, 0.0, 1.0)) * pow(clamp(sr, 0.3, 1.45), 0.85);
        sc = mix(sc, uLip * 1.1, sk.g * 0.6);
        sc = mix(sc, uShade * 0.35, mk.g);
        sc = mix(sc, uOver * clamp(sr, 0.6, 1.2), mk.b);
        sc = mix(sc, uGlow, mk.r * 0.5);
        ${DECREEP ? /* glsl */ `
        // blood under the skin: a warm undertone everywhere, whatever the lineage's colour, and a little more in the lips
        sc = mix(sc, sc * vec3(1.16, 0.97, 0.92) + vec3(0.012, 0.0, 0.0), 0.6);
        sc = mix(sc, uLip * 1.05, sk.g * 0.25);` : ''}
        diffuseColor.rgb = sc;
        float under = step(0.995, vUnder.z);
        if (under > 0.5) {
          vec3 cl = texture2D(uCloth, vUnder.xy).rgb;
          cl = mix(cl, uUnderAccent * (0.35 + dot(cl, vec3(1.1))), vUnder.w * uUnderAccentK);
          diffuseColor.rgb = cl * 0.8; mk = vec3(0.0); // a touch darker: it sits in the garment's shade
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * mk.r * uGlowK;
        // light bleeding through thin skin at grazing angles
        float rimS = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += mix(sc, uSkin, 0.5) * rimS * 0.1;`);
  };
  m.customProgramCacheKey = () => (DECREEP ? 'crew-skin3' : 'crew-skin1u');
  return m;
}

/** `alive`: the living eye (limbal ring, corneal highlight, lid shadow, no lamp-like glow); the narrator always has it. */
export function eyeMaterial(iris: number, glow: number, alive: boolean | 'film' = DECREEP) {
  const film = alive === 'film';
  const m = new THREE.MeshStandardMaterial({ map: texPlain('eye'), roughness: alive ? 0.1 : 0.18 });
  m.userData.film = { kind: 'eye', iris, glow };
  const u = { uIris: { value: col(iris) }, uEyeGlow: { value: glow } };
  m.userData.alive = alive; // the merged body draws the eyes itself and has to know
  m.userData.u = u; // the merged crowd body (bodymerge.ts) shares them
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = `uniform vec3 uIris; uniform float uEyeGlow;\n` + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 ey = texture2D(map, vMapUv).rgb;
        vec3 sclera = vec3(0.78, 0.8, 0.84) * pow(ey.r, 1.6) * 1.2;
        vec3 irisC = uIris * (0.35 + ey.r * 1.3);
        diffuseColor.rgb = mix(sclera, irisC, ey.g) * (1.0 - ey.b * 0.97);
        ${alive ? /* glsl */ `
        // a living eye: a warm, slightly darker white; depth in the iris (dark limbal ring, lighter towards the pupil);
        // the upper lid's soft shadow over the top of the ball
        vec3 scl = vec3(0.80, 0.77, 0.74) * pow(ey.r, 1.3) * 1.1;
        float limb = smoothstep(0.35, 0.95, ey.g) ;
        // pale irises read as blank, dead eyes: every iris is deepened and saturated towards its own hue
        float iLum = dot(uIris, vec3(0.3, 0.6, 0.1)); vec3 hue = mix(vec3(iLum), uIris, 1.7); hue = max(hue, vec3(0.0)) * (0.5 / max(iLum, 0.25));
        vec3 irs = hue * (0.10 + 0.95 * ey.r * limb);
        diffuseColor.rgb = diffuse * mix(scl, irs, ey.g) * (1.0 - ey.b * 0.98); // (the material's colour is white unless a scene shades the eyes down)
        ${film ? /* glsl */ `
        { // the narrator's eye, filmed close under lamps and bloom: nothing in it shines by itself. A deep amber iris with
          // a dark rim and a lighter ring round a pupil large enough to read from across the room (drawn here by
          // distance from the iris's centre in the map: the map's own pupil is a third of this), a white that is grey
          float rI = min(distance(vMapUv, vec2(0.705, 0.297)), distance(vMapUv, vec2(0.291, 0.703))) / 0.118;
          float pupil = 1.0 - smoothstep(0.42, 0.48, rI), inIris = 1.0 - smoothstep(0.95, 1.03, rI);
          vec3 amber = uIris * vec3(0.92, 0.6, 0.34);
          vec3 fIris = amber * (0.12 + 0.34 * smoothstep(0.46, 0.76, rI)) * (0.7 + 0.3 * ey.r) + amber * 0.16 * (1.0 - smoothstep(0.46, 0.66, rI));
          fIris *= 1.0 - 0.78 * smoothstep(0.8, 1.0, rI);
          vec3 fScl = vec3(0.6, 0.585, 0.575) * pow(ey.r, 1.3);
          diffuseColor.rgb = diffuse * mix(mix(fScl, fIris, inIris), vec3(0.003), pupil); }` : ''}
        float lidSh = smoothstep(0.05, 0.75, normalize(vNormal).y);
        diffuseColor.rgb *= 1.0 - 0.55 * lidSh;` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uIris * ey.g * (1.0 - ey.b) * uEyeGlow * (0.3 + ey.r) * ${film ? '0.0' : alive ? '0.08' : '1.0'};
        ${alive ? /* glsl */ `
        { // the cornea's highlight: a small bright window and a soft second one, from a key that sits up and to the side
          vec3 Nn = normalize(vNormal), Vv = normalize(vViewPosition);
          float h1 = pow(max(dot(reflect(-normalize(vec3(-0.35, 0.55, 0.75)), Nn), Vv), 0.0), ${film ? '240.0' : '420.0'});
          float h2 = pow(max(dot(reflect(-normalize(vec3(0.45, -0.15, 0.85)), Nn), Vv), 0.0), 160.0);
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.95) * ${film ? '(h1 * 1.1)' : '(h1 * 1.6 + h2 * 0.12)'} * (1.0 - 0.6 * lidSh);
          // the wet line along the lower lid
          totalEmissiveRadiance += vec3(0.9) * smoothstep(-0.55, -0.8, Nn.y) * 0.05; }` : ''}`);
  };
  m.customProgramCacheKey = () => (film ? 'crew-eye3' : alive ? 'crew-eye2' : 'crew-eye');
  return m;
}

export function lashMaterial(brow: number, map = 'lash') {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, alphaMap: texPlain(map), transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02 });
  m.forceSinglePass = true; // both faces in one draw (a double-sided see-through material is otherwise drawn twice)
  m.userData.film = { kind: 'lash', brow, map };
  const u = { uBrow: { value: col(brow) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = `uniform vec3 uBrow;\n` + sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.rgb = vAlphaMapUv.x < 0.5 ? vec3(0.012) : uBrow;');
  };
  m.customProgramCacheKey = () => 'crew-lash';
  return m;
}

/** Stacked shells of the real skin: each layer shows only the strands that reach it. */
export function furMaterial(key: string, root: number, tip: number, lod: number) {
  const m = new THREE.MeshStandardMaterial({ map: tex(`${key}_fur`, lod), roughness: 0.88, envMapIntensity: 0.3, alphaToCoverage: true }); // matte: short black hair shows no grey sheet of reflection
  m.userData.film = { kind: 'fur', key, root, tip };
  const u = { uRoot: { value: col(root) }, uTip: { value: col(tip) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = `attribute float aLayer; attribute float aDens; varying float vLayer; varying float vDens;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vLayer = aLayer; vDens = aDens;`);
    sh.fragmentShader = `uniform vec3 uRoot, uTip; varying float vLayer; varying float vDens;\n` + sh.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
      vec4 fs = texture2D(map, vMapUv);
      // fewer strands where the hair thins out: the edge frays, it never ends on a triangle
      // and a soft strand edge (alpha-to-coverage where the scene is multisampled): no hard, pixel-stepped outline
      float edge = 1.0 - smoothstep(0.0, 0.22, vDens); // only the outermost band thins: the beard itself stays full
      // at the edge each strand's own tone decides whether it is there: a ragged, natural line, never a smooth curve
      float fth = 0.06 + vLayer * 0.9 + edge * (0.35 + (fs.g - 0.5) * 0.6);
      float fa = clamp((fs.r - fth) / 0.16 + 0.5, 0.0, 1.0);
      if (fa < 0.3) discard; // without multisampling this is the cut; with it the rest of the ramp becomes partial coverage
      diffuseColor.rgb = mix(uRoot, uTip, vLayer * vLayer) * (0.65 + 0.7 * fs.g); diffuseColor.a = (fa - 0.3) / 0.7;`);
  };
  m.customProgramCacheKey = () => 'crew-fur';
  return m;
}

export const mouthMaterial = () => new THREE.MeshStandardMaterial({ map: texPlain('teeth', true), roughness: 0.34 });
export const corneaMaterial = () => new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0.0, depthWrite: false });
