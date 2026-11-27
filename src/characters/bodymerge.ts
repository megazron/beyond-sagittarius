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
/**
 * The rest of a crowd body's own draws go in too (they were two to three more a body: the rigid kit, rigid.ts, and the
 * hair, hair.ts). Kit vertices are parts 3 to 8: 3 + their normal map slot (0 none, 1 and 2 the kit's woven and grained
 * maps) + 3 if the piece was drawn front side only. Hair vertices are part 9, held 100% by the head bone. Their own
 * per-vertex values ride in attributes the skin and cloth already have, unused on kit and hair vertices: kit aUnder =
 * (colour, roughness), aOver = glow, aAccent = metalness; hair aUnder = (strand tangent in bind space, t along the
 * strand), aOver.x = its sway phase.
 */
export const KIT_PART = 3, HAIR_PART = 9;
/** The shapes a body is given once, when it is made: they are baked into a merged body's vertices. */
const STATIC_MORPH = /^(build_|ear_)/;
/** A part made in bind space for the merge (the kit or the hair): its geometry and a key for what it holds. */
type Extra = { geometry: THREE.BufferGeometry; part: number };
/** FNV-1a over the bytes of some arrays: bodies of one look carry the same kit and hair, and share one merged geometry. */
function hashOf(arrays: ArrayLike<number>[], seed = 2166136261) {
  let h = seed >>> 0;
  for (const a of arrays) {
    const u = a instanceof Float32Array ? new Uint32Array(a.buffer, a.byteOffset, a.length) : a;
    for (let i = 0; i < u.length; i++) { h ^= (u[i] as number) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
    h ^= a.length; h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
const rigidSlotKey = (m: THREE.MeshStandardMaterial) => `${m.normalMap?.uuid ?? '-'}|${m.normalScale.x},${m.normalScale.y}`;
/** True when every edge of the geometry (positions welded) is shared by two triangles: drawn both sides, it looks the same. */
function closed(g: THREE.BufferGeometry) {
  const P = g.attributes.position, ix = g.index, id = new Map<string, number>(), w: number[] = [];
  for (let i = 0; i < P.count; i++) { const k = `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`; let v = id.get(k); if (v === undefined) id.set(k, (v = id.size)); w.push(v); }
  const n = ix ? ix.count : P.count, at = (i: number) => w[ix ? ix.getX(i) : i], e = new Map<number, number>();
  for (let t = 0; t + 2 < n; t += 3) for (let j = 0; j < 3; j++) {
    const a = at(t + j), b = at(t + (j + 1) % 3); if (a === b) continue;
    const k = a < b ? a * 4194304 + b : b * 4194304 + a; e.set(k, (e.get(k) ?? 0) + 1);
  }
  for (const c of e.values()) if (c !== 2) return false;
  return true;
}
/** The body's rigid kit meshes (rigid.ts, already skinned in the body's bind space) as merge parts. */
export function kitParts(kit: THREE.SkinnedMesh[], slots: string[], bind: THREE.Matrix4) {
  const out: (Extra & { from: THREE.SkinnedMesh })[] = [];
  let cull = false;
  for (const sm of kit) {
    const mat = sm.material as THREE.MeshStandardMaterial;
    let g0 = sm.geometry;
    if (!sm.bindMatrix.equals(bind)) {
      const t = bind.clone().invert().multiply(sm.bindMatrix);
      g0 = g0.clone(); g0.applyMatrix4(t);
    }
    if (!mat.customProgramCacheKey?.().startsWith('crew-rigid')) continue; // (the city's atmosphere adds its own key: 'crew-rigid|atmo')
    let slot = 0;
    if (mat.normalMap) { const k = rigidSlotKey(mat); slot = slots.indexOf(k) + 1; if (!slot) { if (slots.length >= 2) continue; slots.push(k); slot = slots.length; } }
    const front = mat.side === THREE.FrontSide;
    if (front && !closed(g0)) cull = true;
    const n = g0.attributes.position.count, col = g0.getAttribute('color'), pbr = g0.getAttribute('aPbr'), glow = g0.getAttribute('aGlow');
    const under = new Float32Array(n * 4), over = new Float32Array(n * 3), acc = new Float32Array(n);
    for (let i = 0; i < n; i++) { under.set([col.getX(i), col.getY(i), col.getZ(i), pbr.getX(i)], i * 4); over.set([glow.getX(i), glow.getY(i), glow.getZ(i)], i * 3); acc[i] = pbr.getY(i); }
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) { const a = g0.getAttribute(k); if (a) g.setAttribute(k, a); }
    g.setAttribute('aUnder', new THREE.BufferAttribute(under, 4)); g.setAttribute('aOver', new THREE.BufferAttribute(over, 3)); g.setAttribute('aAccent', new THREE.BufferAttribute(acc, 1));
    g.setIndex(g0.index);
    const part = KIT_PART + slot + (front ? 3 : 0);
    g.userData.mergeKey = 'k' + hashOf([g0.attributes.position.array, under, over, acc, (g0.getAttribute('skinIndex').array as ArrayLike<number>), ...(g0.index ? [g0.index.array] : [])], part);
    out.push({ geometry: g, part, from: sm });
  }
  return { parts: out, cull };
}
/**
 * A head of hair (hair.ts, a rigid mesh on the head bone) as a merge part in the body's bind space: `m` takes it from
 * the hair's own space there (bind inverse x the bone's rest frame x the hair's place on the bone, as rigid.ts does).
 * Cut-out card hair (a texture, alpha to coverage) is left as it is.
 */
export function hairPart(hair: THREE.Mesh, bone: number, m: THREE.Matrix4): Extra | null {
  const mat = hair.material as THREE.MeshStandardMaterial, g0 = hair.geometry;
  if (mat.map || mat.alphaTest || mat.transparent || !mat.userData.film || mat.userData.film.kind !== 'hair' || m.determinant() <= 0) return null;
  const P = g0.attributes.position, Nn = g0.attributes.normal, T = g0.getAttribute('aT'), Tan = g0.getAttribute('aTan'), sw = g0.getAttribute('aSway'), ph = g0.getAttribute('aPhase');
  if (!Nn || !T || !Tan || !sw || !ph) return null;
  // hair that hangs, turns and keeps out of the arms and the ground (hair.ts aRoot, aDir, aLen; uDrop, uTilt, uCap,
  // uGround) is not in this shader yet: it stays its own mesh
  if (g0.getAttribute('aRoot')) return null;
  const n = P.count, N3 = new THREE.Matrix3().getNormalMatrix(m), M3 = new THREE.Matrix3().setFromMatrix4(m), v = new THREE.Vector3();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), under = new Float32Array(n * 4), over = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4), swt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(m).toArray(pos, i * 3);
    v.fromBufferAttribute(Nn, i).applyMatrix3(N3).normalize().toArray(nor, i * 3);
    v.fromBufferAttribute(Tan, i).applyMatrix3(M3); under.set([v.x, v.y, v.z, T.getX(i)], i * 4);
    over[i * 3] = ph.getX(i); si[i * 4] = bone; swt[i * 4] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(swt, 4));
  g.setAttribute('aUnder', new THREE.BufferAttribute(under, 4)); g.setAttribute('aOver', new THREE.BufferAttribute(over, 3));
  g.setAttribute('aSway', sw); g.setAttribute('aPhase', ph);
  g.setIndex(g0.index);
  g.userData.mergeKey = 'h' + hashOf([P.array, T.array, sw.array, ph.array, new Float32Array(m.elements), ...(g0.index ? [g0.index.array] : [])], bone);
  return { geometry: g, part: HAIR_PART };
}
/** The attributes the merged shader reads (everything else the glTF brought is left out). */
const KEEP: Record<string, number> = { position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4, aUnder: 4, aOver: 3, aAccent: 1, aSway: 1, aPhase: 1 };
const cache = new Map<string, { g: THREE.BufferGeometry; names: string[] }>();
/** The merged bodies kept for reuse (memory reports: __bs.memOwners). */
export const mergeCacheNow = () => [...cache.values()].map((c) => c.g);
const Q = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
/** `?bodymerge=0`: no merge at all; `?bodyextras=0`: skin, clothes and eyes only (the kit and the hair their own draws, as
 * before); `?bodymorphs=0`: three.js's own morph texture of every shape, as before (no baked build, no compact texture). */
export const BODY_MERGE = { on: Q?.get('bodymerge') !== '0', extras: Q?.get('bodyextras') !== '0', morphs: Q?.get('bodymorphs') !== '0', merged: 0, geometries: 0,
  /** Test hook: true draws every merged body's kit and hair as their own meshes again (an A/B of one frame). */
  separate: false, separateBody: true, bodies: [] as WeakRef<() => void>[],
  /** `body` false: only the kit and the hair go back to their own meshes (the merged body stays as it is). */
  setSeparate(on: boolean, body = true) { BODY_MERGE.separate = on; BODY_MERGE.separateBody = body; BODY_MERGE.bodies = BODY_MERGE.bodies.filter((w) => { const f = w.deref(); f?.(); return !!f; }); },
};

/** One geometry from the parts (cloth first, then skin, then eyes), with the morph targets `keep` lets through. */
/** The most shapes a merged body's own morph texture takes (more: three.js's morph texture, as before). */
export const MAX_MORPHS = 64;
/** `plain`: as main merged a body (every kept shape in three.js's morph texture, nothing baked): the test hook's half. */
export function mergeBodyGeometry(body: { mesh: THREE.SkinnedMesh; part: number }[], keep: (name: string) => boolean, extra: Extra[] = [], plain = false) {
  const own = BODY_MERGE.morphs && !plain;
  const parts: { mesh: Pick<THREE.SkinnedMesh, 'geometry' | 'morphTargetDictionary' | 'morphTargetInfluences'>; part: number }[] = [...body, ...extra.map((e) => ({ mesh: { geometry: e.geometry, morphTargetDictionary: undefined, morphTargetInfluences: undefined }, part: e.part }))];
  // the shapes set once when the body is made (its build, its ears) go into the vertices, at this body's values
  const baked: Record<string, number> = {};
  if (own) for (const p of parts) { const d = p.mesh.morphTargetDictionary; if (d) for (const n in d) if (STATIC_MORPH.test(n) && keep(n) && baked[n] === undefined) baked[n] = p.mesh.morphTargetInfluences![d[n]]; }
  const key = parts.map((p) => `${p.mesh.geometry.userData.mergeKey ?? p.mesh.geometry.uuid}:${p.part}`).join('|') + `|${keep.toString()}|${JSON.stringify(baked)}|${own}`;
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
  let names: string[] = [];
  for (const p of parts) { const d = p.mesh.morphTargetDictionary; if (d) for (const n of Object.keys(d).sort((a, b) => d[a] - d[b])) if (keep(n) && !names.includes(n)) names.push(n); }
  const relative = parts.find((p) => p.mesh.morphTargetDictionary)?.mesh.geometry.morphTargetsRelative ?? true;
  const deltas = (n: string) => {
    const out = new Float32Array(nv * 3); let o = 0;
    parts.forEach((p, pi) => {
      const d = p.mesh.morphTargetDictionary, src = d && d[n] !== undefined ? p.mesh.geometry.morphAttributes.position?.[d[n]] : undefined;
      if (src) for (let i = 0; i < counts[pi]; i++) { out[(o + i) * 3] = src.getX(i); out[(o + i) * 3 + 1] = src.getY(i); out[(o + i) * 3 + 2] = src.getZ(i); }
      o += counts[pi];
    });
    return out;
  };
  if (relative && Object.keys(baked).length) {
    const pos = g.attributes.position.array as Float32Array;
    for (const [n, w] of Object.entries(baked)) { if (w) { const dl = deltas(n); for (let i = 0; i < pos.length; i++) pos[i] += dl[i] * w; } }
    names = names.filter((n) => baked[n] === undefined);
  }
  if (names.length && relative && own && names.length <= MAX_MORPHS) {
    // The rest (the face; the correctives of a full body) in a texture of their own that holds only the vertices they
    // move (three.js's holds every vertex of the mesh for every shape, a row of 16384 at a time): `aMorphIx` is a
    // vertex's place in it, -1 for none. bodyMaterial's shader adds them as three.js's morph pass did.
    const dl = names.map(deltas), ix = new Float32Array(nv).fill(-1);
    let na = 0;
    for (let i = 0; i < nv; i++) if (dl.some((a) => a[i * 3] !== 0 || a[i * 3 + 1] !== 0 || a[i * 3 + 2] !== 0)) ix[i] = na++;
    const w = Math.max(1, Math.min(na, 4096)), h = Math.max(1, Math.ceil(na / w)), data = new Float32Array(w * h * 4 * names.length);
    const cpu = dl.map(() => new Float32Array(na * 3));
    for (let i = 0; i < nv; i++) { const k = ix[i]; if (k < 0) continue; dl.forEach((a, l) => { for (let c = 0; c < 3; c++) { data[(l * w * h + k) * 4 + c] = a[i * 3 + c]; cpu[l][k * 3 + c] = a[i * 3 + c]; } }); }
    const tex = new THREE.DataArrayTexture(data, w, h, names.length);
    tex.type = THREE.FloatType; tex.needsUpdate = true;
    g.setAttribute('aMorphIx', new THREE.BufferAttribute(ix, 1));
    g.userData.morph = { tex, w, n: names.length, ix, cpu };
  } else if (names.length) {
    g.morphTargetsRelative = relative;
    g.morphAttributes.position = names.map((n) => new THREE.BufferAttribute(deltas(n), 3));
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
export interface BodyExtras {
  /** The kit's normal-mapped looks (rigid.ts materials) for slots 1 and 2; none: no kit merged. */
  kit: THREE.MeshStandardMaterial[] | null;
  /** Some front-side-only kit piece is open (its back faces would show): those fragments are culled by hand. */
  cull: boolean;
  /** The hair's material (its colours and roughness) and its place in bind space; none: no hair merged. */
  hair: { mat: THREE.MeshStandardMaterial; m: THREE.Matrix4 } | null;
  /** The most shapes a set's own morph texture holds (mergeBodyGeometry's `userData.morph`); 0: none. */
  morphs?: number;
}
const MORPH_VERT_HEAD = /* glsl */ `
#ifdef BODY_MORPHS
attribute float aMorphIx; uniform highp sampler2DArray uMorphTex; uniform int uMorphW, uMorphN; uniform float uMorphInf[BODY_MORPHS];
#endif
`;
/** The shapes a merged body keeps, added as three.js's morph pass adds relative targets (after begin_vertex). */
const MORPH_VERT = /* glsl */ `
#ifdef BODY_MORPHS
  if (aMorphIx > -0.5) { int k = int(aMorphIx + 0.5); ivec2 mc = ivec2(k % uMorphW, k / uMorphW);
    for (int i = 0; i < BODY_MORPHS; i++) { if (i >= uMorphN) break; float w = uMorphInf[i]; if (w != 0.0) transformed += texelFetch(uMorphTex, ivec3(mc, i), 0).xyz * w; } }
#endif
`;
/** Points a merged body's material at this mesh's own morph texture and weights (before each of its draws). */
export function morphUniforms(u: U, mesh: THREE.SkinnedMesh) {
  const mo = mesh.geometry.userData.morph as { tex: THREE.DataArrayTexture; w: number; n: number } | undefined;
  if (!u.uMorphN) return;
  u.uMorphN.value = mo ? mo.n : 0;
  if (mo) { u.uMorphTex.value = mo.tex; u.uMorphW.value = mo.w; u.uMorphInf.value = mesh.morphTargetInfluences; }
}
/** keepArmsOut reads a merged body's vertices as they stand: its own morph texture's shapes, then the bones. */
export function morphVertex(mesh: THREE.SkinnedMesh) {
  const mo = mesh.geometry.userData.morph as { ix: Float32Array; cpu: Float32Array[] } | undefined;
  if (!mo) return;
  const P = mesh.geometry.attributes.position;
  mesh.getVertexPosition = (i, t) => {
    t.fromBufferAttribute(P, i);
    const k = mo.ix[i], w = mesh.morphTargetInfluences;
    if (k >= 0 && w) for (let l = 0; l < mo.cpu.length; l++) { const x = w[l]; if (x) { const a = mo.cpu[l]; t.x += a[k * 3] * x; t.y += a[k * 3 + 1] * x; t.z += a[k * 3 + 2] * x; } }
    return mesh.applyBoneTransform(i, t);
  };
}
/** The shadow of a merged body with its own morph texture: three.js's depth pass with the same shapes. */
export function bodyDepthMaterial(body: THREE.MeshStandardMaterial) {
  const u = body.userData.u as U, d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.defines = { BODY_MORPHS: body.defines!.BODY_MORPHS };
  d.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uMorphTex: u.uMorphTex, uMorphW: u.uMorphW, uMorphN: u.uMorphN, uMorphInf: u.uMorphInf });
    sh.vertexShader = MORPH_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + MORPH_VERT);
  };
  d.customProgramCacheKey = () => 'crew-body-depth1';
  return d;
}
export function bodyMaterial(skin: THREE.MeshStandardMaterial, cloth: THREE.MeshStandardMaterial, eyes: THREE.MeshStandardMaterial | null, extras: BodyExtras = { kit: null, cull: false, hair: null }) {
  const m = new THREE.MeshStandardMaterial({ map: skin.map, normalMap: skin.normalMap, normalScale: skin.normalScale.clone(), roughness: 1, side: THREE.DoubleSide });
  // the living eye (no lamp glow, a limbal ring, a corneal highlight): a build flag for the crew, always for the narrator
  const alive = DECREEP || !!eyes?.userData.alive;
  const su = skin.userData.u as U, cu = cloth.userData.u as U, eu = (eyes?.userData.u ?? { uIris: { value: new THREE.Color(0) }, uEyeGlow: { value: 0 } }) as U;
  const sway = cloth.userData.sway as SwayUniforms;
  const u: U = {
    ...su, uAccent: cu.uAccent, uAccentK: cu.uAccentK, uDetailC: cu.uDetail, uHeightM: cu.uHeightM, uSatin: cu.uSatin, uDust: cu.uDust,
    uTiles: cu.uTiles, uTileLayer: cu.uTileLayer, uPull: cu.uPull, uLift: cu.uLift,
    uClothN: { value: cloth.normalMap }, uClothNS: { value: cloth.normalScale.clone() },
    uIris: eu.uIris, uEyeGlow: eu.uEyeGlow, uEyeMap: { value: eyes?.map ?? null },
    uTime: sway.uTime, uSwing: sway.uSwing, uFlutter: sway.uFlutter,
  };
  const defines: Record<string, string> = {};
  if (extras.kit) {
    defines.BODY_KIT = '';
    if (extras.cull) defines.KIT_CULL = '';
    extras.kit.forEach((k, i) => {
      k.normalMap!.updateMatrix();
      u[`uKitN${i + 1}`] = { value: k.normalMap }; u[`uKitNS${i + 1}`] = { value: k.normalScale.clone() }; u[`uKitNT${i + 1}`] = { value: k.normalMap!.matrix };
    });
    for (let i = extras.kit.length; i < 2; i++) { u[`uKitN${i + 1}`] = { value: null }; u[`uKitNS${i + 1}`] = { value: new THREE.Vector2() }; u[`uKitNT${i + 1}`] = { value: new THREE.Matrix3() }; }
    u.uKitOn = { value: 1 };
  }
  if (extras.hair) u.uHairOn = { value: 1 };
  if (extras.morphs) {
    defines.BODY_MORPHS = String(extras.morphs);
    Object.assign(u, { uMorphTex: { value: null }, uMorphW: { value: 1 }, uMorphN: { value: 0 }, uMorphInf: { value: new Array(extras.morphs).fill(0) } });
  }
  if (extras.hair) {
    defines.BODY_HAIR = '';
    const f = extras.hair.mat.userData.film as { root: number; mid: number; tip: number; shine: number };
    Object.assign(u, { uRoot: { value: new THREE.Color(f.root) }, uMid: { value: new THREE.Color(f.mid) }, uTip: { value: new THREE.Color(f.tip) }, uShine: { value: new THREE.Color(f.shine) },
      uHairRough: { value: extras.hair.mat.roughness }, uHairM: { value: extras.hair.m.clone() }, uHairInv: { value: extras.hair.m.clone().invert() } });
  }
  m.defines = defines;
  // the cloth's albedo is the skin's own under-cloth sampler (one texture unit, not two)
  if (!(su.uCloth as { value: unknown }).value) (su.uCloth as { value: unknown }).value = cloth.map;
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = MORPH_VERT_HEAD + /* glsl */ `attribute float aPart; attribute vec4 aUnder; attribute float aAccent; attribute vec3 aOver; attribute float aSway; attribute float aPhase;
uniform float uTime, uFlutter; uniform vec3 uSwing; uniform float uTiles, uPull, uLift; uniform vec4 uTileLayer;
varying float vPart; varying vec4 vUnder; varying vec3 vOver; varying float vAccent; varying float vBindY;
#ifdef BODY_KIT
uniform float uKitOn; varying vec2 vUv0;
#endif
#ifdef BODY_HAIR
uniform mat4 uHairM, uHairInv; uniform float uHairOn; varying vec3 vTan;
#endif
\n` + sh.vertexShader
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
${MORPH_VERT}
  vPart = aPart; vUnder = aUnder; vAccent = aAccent; vBindY = position.y; vOver = aOver;
#ifdef BODY_KIT
  vUv0 = uv;
#endif
#ifdef BODY_HAIR
  // the hair sways in its own space on the head bone, as it did as its own mesh (hair.ts, sway.ts)
  if (aPart > 8.5) { float sw = aSway * aSway; float ph = aPhase * 6.2832; vec3 lp = (uHairInv * vec4(position, 1.0)).xyz;
    vec3 flut = vec3(sin(uTime * 2.1 + ph + lp.y * 7.0), sin(uTime * 1.3 + ph) * 0.4, cos(uTime * 1.7 + ph * 1.3 + lp.x * 6.0));
    transformed += mat3(uHairM) * ((uSwing + flut * uFlutter) * sw);
    vTan = normalMatrix * (mat3(skinMatrix) * aUnder.xyz); } else
#endif
  { float sw = aSway * aSway; float ph = aPhase * 6.2832;
    vec3 flut = vec3(sin(uTime * 2.1 + ph + position.y * 7.0), sin(uTime * 1.3 + ph) * 0.4, cos(uTime * 1.7 + ph * 1.3 + position.x * 6.0));
    transformed += (uSwing + flut * uFlutter) * sw; }`)
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
  if (aPart > 0.5 && aPart < 1.5) {
    int k = uTiles < 1.5 ? 0 : uTiles < 2.5 ? (uv.x >= 0.5 ? 1 : 0) : (uv.x >= 0.5 ? 1 : 0) + (uv.y >= 0.46875 ? 2 : 0);
    float L = k == 0 ? uTileLayer.x : k == 1 ? uTileLayer.y : k == 2 ? uTileLayer.z : uTileLayer.w;
    mvPosition.xyz *= max(0.0, 1.0 - (uLift + L * uPull + 0.002) / max(length(mvPosition.xyz), 1e-3)); gl_Position = projectionMatrix * mvPosition; }
#ifdef BODY_KIT
  // the kit hidden (a body fading at the lens hid its props): its triangles go outside the view
  if (aPart > 2.5 && aPart < 8.5 && uKitOn < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
#ifdef BODY_HAIR
  if (aPart > 8.5 && uHairOn < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif`);
    sh.fragmentShader = /* glsl */ `uniform vec3 uSkin, uShade, uLip, uGlow, uOver, uScatter, uUnderAccent; uniform float uGlowK, uUnderAccentK; uniform sampler2D uMarks, uDetail, uCloth;
uniform vec3 uAccent; uniform float uAccentK, uHeightM, uSatin, uDust; uniform sampler2D uDetailC, uClothN; uniform vec2 uClothNS;
uniform vec3 uIris; uniform float uEyeGlow; uniform sampler2D uEyeMap;
varying float vPart; varying vec4 vUnder; varying vec3 vOver; varying float vAccent; varying float vBindY;
#ifdef BODY_KIT
uniform sampler2D uKitN1, uKitN2; uniform vec2 uKitNS1, uKitNS2; uniform mat3 uKitNT1, uKitNT2; varying vec2 vUv0;
#endif
#ifdef BODY_HAIR
uniform vec3 uRoot, uMid, uTip, uShine; uniform float uHairRough; varying vec3 vTan;
#endif
\n` + sh.fragmentShader
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
  }
#ifdef BODY_KIT
  // the kit (rigid.ts): its colour per vertex
  else if (vPart > 2.5 && vPart < 8.5) {
#ifdef KIT_CULL
    if (vPart > 5.5 && !gl_FrontFacing) discard;
#endif
    diffuseColor.rgb = vUnder.rgb;
  }
#endif
#ifdef BODY_HAIR
  // the hair (hair.ts): root to tip
  else if (vPart > 8.5) diffuseColor.rgb = mix(mix(uRoot, uMid, smoothstep(0.0, 0.35, vUnder.w)), uTip, smoothstep(0.45, 1.0, vUnder.w));
#endif
  else {
    ey = texture2D(uEyeMap, vMapUv).rgb;
    vec3 sclera = vec3(0.78, 0.8, 0.84) * pow(ey.r, 1.6) * 1.2;
    vec3 irisC = uIris * (0.35 + ey.r * 1.3);
    diffuseColor.rgb = mix(sclera, irisC, ey.g) * (1.0 - ey.b * 0.97);
    ${alive ? `vec3 scl = vec3(0.80, 0.77, 0.74) * pow(ey.r, 1.3) * 1.1;
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
#ifdef BODY_KIT
  else if (vPart > 2.5 && vPart < 8.5) roughnessFactor = vUnder.a;
#endif
#ifdef BODY_HAIR
  else if (vPart > 8.5) roughnessFactor = uHairRough;
#endif
  else roughnessFactor = ${alive ? '0.1' : '0.18'};`)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `#include <metalnessmap_fragment>
#ifdef BODY_KIT
  if (vPart > 2.5 && vPart < 8.5) metalnessFactor = vAccent;
#endif`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
  if (vPart < 0.5) {
    #include <normal_fragment_maps>
    { vec2 dn = texture2D(uDetail, vMapUv * 16.0).xy * 2.0 - 1.0; normal = normalize(normal + tbn * vec3(dn * 0.32, 0.0)); }
  } else if (vPart < 1.5) {
    vec3 mapN = texture2D(uClothN, vNormalMapUv).xyz * 2.0 - 1.0; mapN.xy *= uClothNS; normal = normalize(tbn * mapN);
    { vec2 dn = texture2D(uDetailC, vMapUv * 26.0).xy * 2.0 - 1.0; normal = normalize(normal + tbn * vec3(dn * 0.5 * (1.0 - vAccent * uSatin), 0.0)); }
  }
#ifdef BODY_KIT
  else if (vPart > 2.5 && vPart < 8.5) {
    float slot = mod(floor(vPart + 0.5) - 3.0, 3.0);
    if (slot > 0.5) {
      // as the kit's own material drew it: its map's own repeat, its own tangent frame from that uv
      vec2 kuv = ((slot < 1.5 ? uKitNT1 : uKitNT2) * vec3(vUv0, 1.0)).xy;
      mat3 ktbn = getTangentFrame(- vViewPosition, normal, kuv);
      ktbn[0] *= faceDirection; ktbn[1] *= faceDirection;
      vec3 mapN = (slot < 1.5 ? texture2D(uKitN1, kuv).xyz : texture2D(uKitN2, kuv).xyz) * 2.0 - 1.0;
      mapN.xy *= slot < 1.5 ? uKitNS1 : uKitNS2;
      normal = normalize(ktbn * mapN);
    }
  }
#endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
  if (vPart < 0.5) {
    totalEmissiveRadiance += uGlow * mk.r * uGlowK;
    float rimS = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
    totalEmissiveRadiance += mix(sc, uSkin, 0.5) * rimS * 0.1;
  } else if (vPart > 1.5 && vPart < 2.5) {
    totalEmissiveRadiance += uIris * ey.g * (1.0 - ey.b) * uEyeGlow * (0.3 + ey.r) * ${alive ? '0.08' : '1.0'};
    ${alive ? `{ vec3 Nn = normalize(vNormal), Vv = normalize(vViewPosition);
      float h1 = pow(max(dot(reflect(-normalize(vec3(-0.35, 0.55, 0.75)), Nn), Vv), 0.0), 420.0);
      float h2 = pow(max(dot(reflect(-normalize(vec3(0.45, -0.15, 0.85)), Nn), Vv), 0.0), 160.0);
      totalEmissiveRadiance += vec3(1.0, 0.98, 0.95) * (h1 * 1.6 + h2 * 0.12) * (1.0 - 0.6 * lidSh);
      totalEmissiveRadiance += vec3(0.9) * smoothstep(-0.55, -0.8, Nn.y) * 0.05; }` : ''}
  }
#ifdef BODY_KIT
  else if (vPart > 2.5 && vPart < 8.5) totalEmissiveRadiance += vOver;
#endif
#ifdef BODY_HAIR
  else if (vPart > 8.5) {
    // hair.ts: the Kajiya-Kay strand highlight, shifted per lock and along its length; a soft self-shadow at the roots
    vec3 Tn = normalize(vTan), Vv = normalize(vViewPosition);
    #if NUM_DIR_LIGHTS > 0
      vec3 Lv = directionalLights[0].direction; float Li = min(length(directionalLights[0].color) * 0.22, 1.2);
    #else
      vec3 Lv = normalize(vec3(0.3, 0.8, 0.5)); float Li = 0.6;
    #endif
    vec3 Hh = normalize(Lv + Vv);
    float th = dot(Tn, Hh) + (vOver.x - 0.5) * 0.28 + (vUnder.w - 0.35) * 0.55;
    float s = sqrt(max(0.0, 1.0 - th * th));
    float band = pow(s, 90.0) * 0.55 + pow(s, 16.0) * 0.06;
    totalEmissiveRadiance += uShine * band * Li;
    diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(0.0, 0.3, vUnder.w);
  }
#endif`);
  };
  m.customProgramCacheKey = () => (DECREEP ? 'crew-body-dc1' : alive ? 'crew-body1-ae' : 'crew-body1');
  return m;
}
export { PARTS as BODY_PARTS };
if (typeof window !== 'undefined') (window as unknown as { __bodyMerge: typeof BODY_MERGE }).__bodyMerge = BODY_MERGE;
