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
}
export interface CrewAsset { scene: THREE.Group; meta: CrewMeta; }

const gltf = new GLTFLoader();
const assets = new Map<string, Promise<CrewAsset>>();
const loaded = new Map<string, CrewAsset>();
let animP: Promise<AnimSet> | null = null;
let anim: AnimSet | null = null;
const texCache = new Map<string, THREE.Texture>();
const pending = new Set<Promise<void>>();
const loadTex = (url: string) => {
  let done: () => void = () => {};
  const p = new Promise<void>((r) => { done = r; });
  pending.add(p);
  const fin = () => { pending.delete(p); done(); };
  return new THREE.TextureLoader().load(url, fin, undefined, () => { console.warn('[crew] texture', url); fin(); });
};
/** Resolves when every texture requested so far has arrived. */
export const texturesReady = async () => { await Promise.all([...pending]); };

/** Web or phone: decides mesh LOD and texture size for everything loaded afterwards. */
export const lodOf = (detail: number) => (detail < 0.8 ? 1 : 0);

export function loadAnim() {
  animP ??= (async () => {
    const [g, j] = await Promise.all([gltf.loadAsync(`${BASE}anim.glb`), fetch(`${BASE}anim.json`).then((r) => r.json())]);
    anim = { refLeg: j.refLeg, refHip: j.refHip, meta: j.clips, clips: new Map(g.animations.map((c) => [c.name, c])) };
    return anim;
  })();
  return animP;
}
export const animNow = () => anim;

export function loadAsset(key: string, lod: number) {
  const custom = key.startsWith('custom_');
  const file = lod && !custom ? `${key}.lod1` : key;
  const id = `${file}`;
  let p = assets.get(id);
  if (!p) {
    p = (async () => {
      const [g, meta] = await Promise.all([gltf.loadAsync(`${BASE}${file}.glb`), fetch(`${BASE}${key}.json`).then((r) => r.json())]);
      const a: CrewAsset = { scene: g.scene, meta };
      loaded.set(id, a);
      return a;
    })();
    assets.set(id, p);
  }
  return p;
}
export function assetNow(key: string, lod: number) {
  return loaded.get(lod && !key.startsWith('custom_') ? `${key}.lod1` : key);
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
  };
  m.userData.u = u; // stages turn a lineage's marks up and down
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = `uniform vec3 uSkin, uShade, uLip, uGlow, uOver, uScatter; uniform float uGlowK; uniform sampler2D uMarks, uDetail;\n` + sh.fragmentShader
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
        diffuseColor.rgb = sc;`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * mk.r * uGlowK;
        // light bleeding through thin skin at grazing angles
        float rimS = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += mix(sc, uSkin, 0.5) * rimS * 0.1;`);
  };
  m.customProgramCacheKey = () => (DECREEP ? 'crew-skin2' : 'crew-skin');
  return m;
}

export function eyeMaterial(iris: number, glow: number) {
  const m = new THREE.MeshStandardMaterial({ map: texPlain('eye'), roughness: DECREEP ? 0.1 : 0.18 });
  m.userData.film = { kind: 'eye', iris, glow };
  const u = { uIris: { value: col(iris) }, uEyeGlow: { value: glow } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = `uniform vec3 uIris; uniform float uEyeGlow;\n` + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 ey = texture2D(map, vMapUv).rgb;
        vec3 sclera = vec3(0.78, 0.8, 0.84) * pow(ey.r, 1.6) * 1.2;
        vec3 irisC = uIris * (0.35 + ey.r * 1.3);
        diffuseColor.rgb = mix(sclera, irisC, ey.g) * (1.0 - ey.b * 0.97);
        ${DECREEP ? /* glsl */ `
        // a living eye: a warm, slightly darker white; depth in the iris (dark limbal ring, lighter towards the pupil);
        // the upper lid's soft shadow over the top of the ball
        vec3 scl = vec3(0.80, 0.77, 0.74) * pow(ey.r, 1.3) * 1.1;
        float limb = smoothstep(0.35, 0.95, ey.g) ;
        // pale irises read as blank, dead eyes: every iris is deepened and saturated towards its own hue
        float iLum = dot(uIris, vec3(0.3, 0.6, 0.1)); vec3 hue = mix(vec3(iLum), uIris, 1.7); hue = max(hue, vec3(0.0)) * (0.5 / max(iLum, 0.25));
        vec3 irs = hue * (0.10 + 0.95 * ey.r * limb);
        diffuseColor.rgb = mix(scl, irs, ey.g) * (1.0 - ey.b * 0.98);
        float lidSh = smoothstep(0.05, 0.75, normalize(vNormal).y);
        diffuseColor.rgb *= 1.0 - 0.55 * lidSh;` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uIris * ey.g * (1.0 - ey.b) * uEyeGlow * (0.3 + ey.r) * ${DECREEP ? '0.08' : '1.0'};
        ${DECREEP ? /* glsl */ `
        { // the cornea's highlight: a small bright window and a soft second one, from a key that sits up and to the side
          vec3 Nn = normalize(vNormal), Vv = normalize(vViewPosition);
          float h1 = pow(max(dot(reflect(-normalize(vec3(-0.35, 0.55, 0.75)), Nn), Vv), 0.0), 420.0);
          float h2 = pow(max(dot(reflect(-normalize(vec3(0.45, -0.15, 0.85)), Nn), Vv), 0.0), 160.0);
          totalEmissiveRadiance += vec3(1.0, 0.98, 0.95) * (h1 * 1.6 + h2 * 0.12) * (1.0 - 0.6 * lidSh);
          // the wet line along the lower lid
          totalEmissiveRadiance += vec3(0.9) * smoothstep(-0.55, -0.8, Nn.y) * 0.05; }` : ''}`);
  };
  m.customProgramCacheKey = () => (DECREEP ? 'crew-eye2' : 'crew-eye');
  return m;
}

export function lashMaterial(brow: number, map = 'lash') {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, alphaMap: texPlain(map), transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02 });
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
