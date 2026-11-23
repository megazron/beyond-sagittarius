import * as THREE from 'three';
import { DECREEP } from './decreep';
import type { SwayUniforms } from './sway';

/**
 * A crowd body's skin, clothes and eyes in ONE skinned mesh and one draw call (they were three, in every pass that drew
 * the body). One material does all three: each vertex carries its part (`aPart`: 0 skin, 1 cloth, 2 eye) and the
 * fragment shader takes that part's textures and shading, the same code as the three materials it replaces (assets.ts
 * skinMaterial and eyeMaterial, character.ts cloth). The parts keep their own uv into their own texture; a triangle is
 * one part, so a 2x2 pixel quad never mixes parts and the texture lookups in the branches keep their derivatives.
 * Cloth won over skin at the same depth by polygon offset: here it is pulled 2 mm more towards the camera instead.
 * The merged geometry is made once per source set (bodies of one look share it). Only the crowd uses it: the crew,
 * the player and the films keep their own meshes.
 */
type U = Record<string, { value: unknown }>;
const PARTS = { skin: 0, cloth: 1, eye: 2 } as const;
/** The attributes the merged shader reads (everything else the glTF brought is left out). */
const KEEP: Record<string, number> = { position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4, aUnder: 4, aOver: 3, aAccent: 1, aSway: 1, aPhase: 1 };
const cache = new Map<string, { g: THREE.BufferGeometry; names: string[] }>();
/** The merged bodies kept for reuse (memory reports: __bs.memOwners). */
export const mergeCacheNow = () => [...cache.values()].map((c) => c.g);
export const BODY_MERGE = { on: typeof location === 'undefined' || new URLSearchParams(location.search).get('bodymerge') !== '0', merged: 0, geometries: 0 };

/** One geometry from the parts (cloth first, then skin, then eyes), with the morph targets `keep` lets through. */
export function mergeBodyGeometry(parts: { mesh: THREE.SkinnedMesh; part: number }[], keep: (name: string) => boolean) {
  const key = parts.map((p) => `${p.mesh.geometry.uuid}:${p.part}`).join('|') + `|${keep.toString()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const counts = parts.map((p) => p.mesh.geometry.attributes.position.count), nv = counts.reduce((a, b) => a + b, 0);
  const g = new THREE.BufferGeometry();
  for (const [k, n] of Object.entries(KEEP)) {
    if (!parts.some((p) => p.mesh.geometry.getAttribute(k))) continue;
    const out = k === 'skinIndex' ? new Uint16Array(nv * n) : new Float32Array(nv * n);
    let o = 0;
    parts.forEach((p, pi) => {
      const a = p.mesh.geometry.getAttribute(k) as THREE.BufferAttribute | undefined;
      if (a) for (let i = 0; i < counts[pi]; i++) for (let c = 0; c < n; c++) out[(o + i) * n + c] = c < a.itemSize ? a.getComponent(i, c) : 0;
      o += counts[pi];
    });
    g.setAttribute(k, new THREE.BufferAttribute(out, n));
  }
  const part = new Float32Array(nv);
  { let o = 0; parts.forEach((p, pi) => { part.fill(p.part, o, o + counts[pi]); o += counts[pi]; }); }
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  let ni = 0; for (const p of parts) ni += p.mesh.geometry.index ? p.mesh.geometry.index.count : p.mesh.geometry.attributes.position.count;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  { let o = 0, v0 = 0; parts.forEach((p, pi) => { const ix = p.mesh.geometry.index; if (ix) for (let i = 0; i < ix.count; i++) idx[o + i] = ix.getX(i) + v0; else for (let i = 0; i < counts[pi]; i++) idx[o + i] = v0 + i; o += ix ? ix.count : counts[pi]; v0 += counts[pi]; }); }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // the morph targets: every kept name of any part, zeros where a part has no such shape
  const names: string[] = [];
  for (const p of parts) { const d = p.mesh.morphTargetDictionary; if (d) for (const n of Object.keys(d).sort((a, b) => d[a] - d[b])) if (keep(n) && !names.includes(n)) names.push(n); }
  if (names.length) {
    g.morphTargetsRelative = parts.find((p) => p.mesh.morphTargetDictionary)!.mesh.geometry.morphTargetsRelative;
    g.morphAttributes.position = names.map((n) => {
      const out = new Float32Array(nv * 3); let o = 0;
      parts.forEach((p, pi) => {
        const d = p.mesh.morphTargetDictionary, src = d && d[n] !== undefined ? p.mesh.geometry.morphAttributes.position?.[d[n]] : undefined;
        if (src) for (let i = 0; i < counts[pi]; i++) { out[(o + i) * 3] = src.getX(i); out[(o + i) * 3 + 1] = src.getY(i); out[(o + i) * 3 + 2] = src.getZ(i); }
        o += counts[pi];
      });
      return new THREE.BufferAttribute(out, 3);
    });
  }
  // keepArmsOut measures the torso from the first vertices: the cloth, then the body skin (not the head, not the eyes)
  const ci = parts.findIndex((p) => p.part === PARTS.cloth), si = parts.findIndex((p) => p.part === PARTS.skin);
  if (ci === 0 && si === 1) g.userData.torsoCount = counts[0] + (parts[1].mesh.geometry.userData.torsoCount ?? counts[1]);
  if (ci === 0) g.userData.clothCount = counts[0];
  const r = { g, names };
  cache.set(key, r); BODY_MERGE.geometries++;
  return r;
}

/** The one material of a merged crowd body; its uniforms are the replaced materials' own (the body's colours). */
export function bodyMaterial(skin: THREE.MeshStandardMaterial, cloth: THREE.MeshStandardMaterial, eyes: THREE.MeshStandardMaterial | null) {
  const m = new THREE.MeshStandardMaterial({ map: skin.map, normalMap: skin.normalMap, normalScale: skin.normalScale.clone(), roughness: 1, side: THREE.DoubleSide });
  const su = skin.userData.u as U, cu = cloth.userData.u as U, eu = (eyes?.userData.u ?? { uIris: { value: new THREE.Color(0) }, uEyeGlow: { value: 0 } }) as U;
  const sway = cloth.userData.sway as SwayUniforms;
  const u: U = {
    ...su, uAccent: cu.uAccent, uAccentK: cu.uAccentK, uDetailC: cu.uDetail, uHeightM: cu.uHeightM, uSatin: cu.uSatin, uDust: cu.uDust,
    uTiles: cu.uTiles, uTileLayer: cu.uTileLayer, uPull: cu.uPull, uLift: cu.uLift,
    uClothN: { value: cloth.normalMap }, uClothNS: { value: cloth.normalScale.clone() },
    uIris: eu.uIris, uEyeGlow: eu.uEyeGlow, uEyeMap: { value: eyes?.map ?? null },
    uTime: sway.uTime, uSwing: sway.uSwing, uFlutter: sway.uFlutter,
  };
  // the cloth's albedo is the skin's own under-cloth sampler (one texture unit, not two)
  if (!(su.uCloth as { value: unknown }).value) (su.uCloth as { value: unknown }).value = cloth.map;
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = /* glsl */ `attribute float aPart; attribute vec4 aUnder; attribute float aAccent; attribute vec3 aOver; attribute float aSway; attribute float aPhase;
uniform float uTime, uFlutter; uniform vec3 uSwing; uniform float uTiles, uPull, uLift; uniform vec4 uTileLayer;
varying float vPart; varying vec4 vUnder; varying vec3 vOver; varying float vAccent; varying float vBindY;\n` + sh.vertexShader
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
  vPart = aPart; vUnder = aUnder; vAccent = aAccent; vBindY = position.y; vOver = aOver;
  { float sw = aSway * aSway; float ph = aPhase * 6.2832;
    vec3 flut = vec3(sin(uTime * 2.1 + ph + position.y * 7.0), sin(uTime * 1.3 + ph) * 0.4, cos(uTime * 1.7 + ph * 1.3 + position.x * 6.0));
    transformed += (uSwing + flut * uFlutter) * sw; }`)
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
  if (aPart > 0.5 && aPart < 1.5) {
    int k = uTiles < 1.5 ? 0 : uTiles < 2.5 ? (uv.x >= 0.5 ? 1 : 0) : (uv.x >= 0.5 ? 1 : 0) + (uv.y >= 0.46875 ? 2 : 0);
    float L = k == 0 ? uTileLayer.x : k == 1 ? uTileLayer.y : k == 2 ? uTileLayer.z : uTileLayer.w;
    mvPosition.xyz *= max(0.0, 1.0 - (uLift + L * uPull + 0.002) / max(length(mvPosition.xyz), 1e-3)); gl_Position = projectionMatrix * mvPosition; }`);
    sh.fragmentShader = /* glsl */ `uniform vec3 uSkin, uShade, uLip, uGlow, uOver, uScatter, uUnderAccent; uniform float uGlowK, uUnderAccentK; uniform sampler2D uMarks, uDetail, uCloth;
uniform vec3 uAccent; uniform float uAccentK, uHeightM, uSatin, uDust; uniform sampler2D uDetailC, uClothN; uniform vec2 uClothNS;
uniform vec3 uIris; uniform float uEyeGlow; uniform sampler2D uEyeMap;
varying float vPart; varying vec4 vUnder; varying vec3 vOver; varying float vAccent; varying float vBindY;\n` + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */ `
  vec4 sk = vec4(0.0); vec3 mk = vec3(0.0), sc = vec3(0.0), ey = vec3(0.0); float dust = 0.0, lidSh = 0.0;
  if (vPart < 0.5) {
    sk = texture2D(map, vMapUv);
    float sr = sk.r * 2.0;
    mk = texture2D(uMarks, vMapUv).rgb;
    sc = mix(uShade, uSkin, clamp((sr - 0.45) / 0.55, 0.0, 1.0)) * pow(clamp(sr, 0.3, 1.45), 0.85);
    sc = mix(sc, uLip * 1.1, sk.g * 0.6);
    sc = mix(sc, uShade * 0.35, mk.g);
    sc = mix(sc, uOver * clamp(sr, 0.6, 1.2), mk.b);
    sc = mix(sc, uGlow, mk.r * 0.5);
    ${DECREEP ? `sc = mix(sc, sc * vec3(1.16, 0.97, 0.92) + vec3(0.012, 0.0, 0.0), 0.6);
    sc = mix(sc, uLip * 1.05, sk.g * 0.25);` : ''}
    diffuseColor.rgb = sc;
    if (vUnder.z > 0.995) {
      vec3 cl = texture2D(uCloth, vUnder.xy).rgb;
      cl = mix(cl, uUnderAccent * (0.35 + dot(cl, vec3(1.1))), vUnder.w * uUnderAccentK);
      diffuseColor.rgb = cl * 0.8; mk = vec3(0.0);
    }
  } else if (vPart < 1.5) {
    diffuseColor.rgb = texture2D(uCloth, vMapUv).rgb;
    if (vOver.z > 0.995) diffuseColor.rgb = texture2D(uCloth, vOver.xy).rgb * 0.92;
    diffuseColor.rgb = mix(diffuseColor.rgb, uAccent * (0.35 + dot(diffuseColor.rgb, vec3(1.1))), vAccent * uAccentK);
    float wearN = texture2D(uDetailC, vMapUv * 5.0).b;
    dust = (1.0 - smoothstep(0.0, 0.62, vBindY / uHeightM)) * 0.75 + smoothstep(0.55, 0.8, wearN) * 0.5;
    dust = clamp(dust * (0.45 + wearN), 0.0, 1.0) * uDust;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.6, 0.52) + vec3(0.035, 0.028, 0.02), dust);
  } else {
    ey = texture2D(uEyeMap, vMapUv).rgb;
    vec3 sclera = vec3(0.78, 0.8, 0.84) * pow(ey.r, 1.6) * 1.2;
    vec3 irisC = uIris * (0.35 + ey.r * 1.3);
    diffuseColor.rgb = mix(sclera, irisC, ey.g) * (1.0 - ey.b * 0.97);
    ${DECREEP ? `vec3 scl = vec3(0.80, 0.77, 0.74) * pow(ey.r, 1.3) * 1.1;
    float limb = smoothstep(0.35, 0.95, ey.g);
    float iLum = dot(uIris, vec3(0.3, 0.6, 0.1)); vec3 hue = mix(vec3(iLum), uIris, 1.7); hue = max(hue, vec3(0.0)) * (0.5 / max(iLum, 0.25));
    vec3 irs = hue * (0.10 + 0.95 * ey.r * limb);
    diffuseColor.rgb = mix(scl, irs, ey.g) * (1.0 - ey.b * 0.98);
    lidSh = smoothstep(0.05, 0.75, normalize(vNormal).y);
    diffuseColor.rgb *= 1.0 - 0.55 * lidSh;` : ''}
  }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
  if (vPart < 0.5) roughnessFactor = mix(0.56, 0.33, sk.g) - 0.05 * (texture2D(uDetail, vMapUv * 3.0).b - 0.5);
  else if (vPart < 1.5) { roughnessFactor = min(1.0, 0.82 + dust * 0.14); roughnessFactor = mix(roughnessFactor, 0.44, vAccent * uSatin); }
  else roughnessFactor = ${DECREEP ? '0.1' : '0.18'};`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
  if (vPart < 0.5) {
    #include <normal_fragment_maps>
    { vec2 dn = texture2D(uDetail, vMapUv * 16.0).xy * 2.0 - 1.0; normal = normalize(normal + tbn * vec3(dn * 0.32, 0.0)); }
  } else if (vPart < 1.5) {
    vec3 mapN = texture2D(uClothN, vNormalMapUv).xyz * 2.0 - 1.0; mapN.xy *= uClothNS; normal = normalize(tbn * mapN);
    { vec2 dn = texture2D(uDetailC, vMapUv * 26.0).xy * 2.0 - 1.0; normal = normalize(normal + tbn * vec3(dn * 0.5 * (1.0 - vAccent * uSatin), 0.0)); }
  }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
  if (vPart < 0.5) {
    totalEmissiveRadiance += uGlow * mk.r * uGlowK;
    float rimS = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
    totalEmissiveRadiance += mix(sc, uSkin, 0.5) * rimS * 0.1;
  } else if (vPart > 1.5) {
    totalEmissiveRadiance += uIris * ey.g * (1.0 - ey.b) * uEyeGlow * (0.3 + ey.r) * ${DECREEP ? '0.08' : '1.0'};
    ${DECREEP ? `{ vec3 Nn = normalize(vNormal), Vv = normalize(vViewPosition);
      float h1 = pow(max(dot(reflect(-normalize(vec3(-0.35, 0.55, 0.75)), Nn), Vv), 0.0), 420.0);
      float h2 = pow(max(dot(reflect(-normalize(vec3(0.45, -0.15, 0.85)), Nn), Vv), 0.0), 160.0);
      totalEmissiveRadiance += vec3(1.0, 0.98, 0.95) * (h1 * 1.6 + h2 * 0.12) * (1.0 - 0.6 * lidSh);
      totalEmissiveRadiance += vec3(0.9) * smoothstep(-0.55, -0.8, Nn.y) * 0.05; }` : ''}
  }`);
  };
  m.customProgramCacheKey = () => (DECREEP ? 'crew-body-dc1' : 'crew-body1');
  return m;
}
export { PARTS as BODY_PARTS };
if (typeof window !== 'undefined') (window as unknown as { __bodyMerge: typeof BODY_MERGE }).__bodyMerge = BODY_MERGE;
