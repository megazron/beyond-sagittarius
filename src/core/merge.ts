import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nearFade } from './nearfade';

/**
 * Fewer draw calls for things that never move apart. On a phone three.js spends most of a frame on its own work per
 * draw call (state, uniforms, matrices), not on triangles, so a group of boxes that share a look is cheaper as one mesh.
 *
 * `mergeChildren` merges a parent's direct children that are plain meshes, never move against the parent, share a
 * material (or one that looks exactly the same) and the same shadow flags, into one mesh per material, in place of the
 * first of them (so `children[i]` lookups on the others still find what they found). Named meshes, `userData.keep`,
 * blended transparency (its draw order matters), custom render hooks, mirrored transforms and morphs are left alone.
 */

const SKIP = new Set(['uuid', 'id', 'name', 'userData', 'version', 'type', 'uniformsNeedUpdate', 'needsUpdate', 'isMaterial']);
const sigOf = (v: unknown): string => {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
  const o = v as { isColor?: boolean; isTexture?: boolean; isVector2?: boolean; isVector3?: boolean; isVector4?: boolean; isEuler?: boolean; uuid?: string; getHexString?: () => string; toArray?: () => number[] };
  if (o.isColor) return `c${(v as THREE.Color).r},${(v as THREE.Color).g},${(v as THREE.Color).b}`;
  if (o.isTexture) return `t${o.uuid}`;
  if (o.isVector2 || o.isVector3 || o.isVector4 || o.isEuler) return `v${o.toArray!().join(',')}`;
  if (Array.isArray(v)) { const a = v.map(sigOf); return a.includes('o') ? 'o' : `[${a.join(',')}]`; }
  if (Object.getPrototypeOf(v) === Object.prototype) {
    const e = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, sigOf(x)]);
    return e.some(([, x]) => x === 'o') ? 'o' : `{${e.map(([k, x]) => `${k}:${x}`).join(',')}}`;
  }
  return 'o'; // anything else (plane lists, uniforms objects): only identity can tell, so such materials are not shared
};
/** Everything that decides how a material draws. Two materials with the same signature look the same. */
const PBR_KEYS = new Set(['color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity']);
export function materialSignature(m: THREE.Material, loose: false | 'tint' | 'pbr' = false): string {
  const r = m as unknown as Record<string, unknown>;
  // a shader patch may hold its own state (uniforms, the patch before it): only the same material is the same look
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return m.uuid;
  const parts = [m.type, m.customProgramCacheKey()];
  if (typeof m.userData.late === 'string') parts.push(`late=${m.userData.late}`); // its maps arrive later, from this set
  for (const k of Object.keys(r).sort()) {
    if (SKIP.has(k) || k.startsWith('_') || typeof r[k] === 'function' || (loose === 'tint' && k === 'color') || (loose === 'pbr' && PBR_KEYS.has(k))) continue;
    const s = sigOf(r[k]);
    if (s === 'o') return `${m.uuid}`; // e.g. ShaderMaterial uniforms: never shared
    parts.push(`${k}=${s}`);
  }
  return parts.join('|');
}

const plainHook = THREE.Object3D.prototype.onBeforeRender, plainAfter = THREE.Object3D.prototype.onAfterRender;
/** Can this mesh be merged with its siblings at all? */
export function mergeable(o: THREE.Object3D, anyBlend = false): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
  if (m.children.length || m.name || m.userData.keep || !m.visible || Array.isArray(m.material) || m.onBeforeRender !== plainHook || m.onAfterRender !== plainAfter) return false;
  const mat = m.material as THREE.Material;
  if ((mat.transparent && mat.blending !== THREE.AdditiveBlending && !anyBlend) || m.renderOrder !== 0 || !m.frustumCulled || m.layers.mask !== 1) return false;
  if (Object.keys(m.geometry.morphAttributes).length || m.geometry.drawRange.count !== Infinity || m.geometry.drawRange.start !== 0) return false;
  return true;
}

const TMP = new THREE.Vector3();
export interface MergeOpts {
  /** Split by place, so what is off screen is still culled: a key from the child's centre in the parent's space. */
  cell?: (c: THREE.Vector3) => string;
  /** Share materials that look the same (only for ones nothing changes later). */
  shared?: (m: THREE.Material) => boolean;
  /** Also merge shared materials that differ only in colour: the colour goes per vertex. */
  tint?: boolean;
  /** Also merge plain (untextured) standard materials that differ in colour, roughness, metalness or glow: all per vertex. */
  pbr?: boolean;
  /** Fewest meshes worth merging. */
  min?: number;
  /** Phones: transparent meshes merge too (their order within one merge is then fixed, not sorted by depth). */
  anyBlend?: boolean;
}

const tintable = (m: THREE.Material, g: THREE.BufferGeometry) => !g.attributes.color && !(m as THREE.MeshStandardMaterial).vertexColors
  && (m.type === 'MeshStandardMaterial' || m.type === 'MeshBasicMaterial' || m.type === 'MeshLambertMaterial' || m.type === 'MeshPhongMaterial');

const MAPS = ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap', 'envMap', 'specularMap'];
const pbrable = (m: THREE.Material, g: THREE.BufferGeometry) => m.type === 'MeshStandardMaterial' && !g.attributes.color && !(m as THREE.MeshStandardMaterial).vertexColors
  && !m.userData.late && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && MAPS.every((k) => !(m as unknown as Record<string, unknown>)[k]);
/** The look of `rep`, with colour, roughness, metalness and glow read per vertex (attributes color, aPbr, aGlow). */
function pbrMaterial(rep: THREE.MeshStandardMaterial) {
  const m = rep.clone();
  m.vertexColors = true; m.color.set(0xffffff); m.roughness = 1; m.metalness = 1; m.emissive.set(0xffffff); m.emissiveIntensity = 1;
  m.userData = {};
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 aPbr; attribute vec3 aGlow; varying vec2 vPbr; varying vec3 vGlow;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPbr = aPbr; vGlow = aGlow;');
    sh.fragmentShader = 'varying vec2 vPbr; varying vec3 vGlow;\n' + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vGlow;');
    nearFade(m, sh); // what it replaces dissolved at the lens like every plain material
  };
  m.customProgramCacheKey = () => 'merge-pbr|nearfade';
  return m;
}

/**
 * A material made for a merge of several tints. Maps that arrive later for the originals (`userData.late`) reach it
 * through `userData.followers`: whoever loads them calls `passMaps`.
 */
export function passMaps(m: THREE.Material) {
  const f = m.userData.followers as THREE.Material[] | undefined;
  if (!f) return;
  const src = m as THREE.MeshStandardMaterial;
  for (const x of f as THREE.MeshStandardMaterial[]) { x.map = src.map; x.normalMap = src.normalMap; x.emissiveMap = src.emissiveMap; x.roughnessMap = src.roughnessMap; x.needsUpdate = true; }
}

/** Merge a parent's static child meshes by material; returns how many draw calls it saved. */
export function mergeChildren(parent: THREE.Object3D, opts: MergeOpts = {}) {
  const groups = new Map<string, THREE.Mesh[]>(), ids = new Map<string, string>();
  const keyOf = (mat: THREE.Material, g: THREE.BufferGeometry) => {
    const loose = opts.pbr && pbrable(mat, g) ? 'pbr' : opts.tint && tintable(mat, g) ? 'tint' : false, id = `${mat.uuid}|${loose}`;
    let k = ids.get(id);
    if (k === undefined) { k = opts.shared?.(mat) ? `${loose || ''}:${materialSignature(mat, loose)}` : mat.uuid; ids.set(id, k); }
    return k;
  };
  for (const o of parent.children) {
    if (!mergeable(o, opts.anyBlend)) continue;
    o.updateMatrix();
    if (o.matrix.determinant() <= 0) continue;
    const g = o.geometry, mat = o.material as THREE.Material;
    // untextured standard materials merge whatever their geometry carries: only positions and normals are kept
    const bare = !!opts.pbr && pbrable(mat, g) && !!g.attributes.normal;
    const attrs = bare ? 'bare' : Object.entries(g.attributes).map(([k, a]) => `${k}:${a.itemSize}:${(a as THREE.BufferAttribute).array.constructor.name}:${a.normalized}`).sort().join(',');
    let cell = '';
    if (opts.cell) { if (!g.boundingBox) g.computeBoundingBox(); cell = opts.cell(g.boundingBox!.getCenter(TMP).applyMatrix4(o.matrix)); }
    let ud = ''; try { ud = JSON.stringify(o.userData); } catch { continue; }
    const key = [keyOf(mat, g), +o.castShadow, +o.receiveShadow, cell, attrs, bare ? false : !!g.index, ud].join('|');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }
  let saved = 0;
  for (const list of groups.values()) {
    if (list.length < (opts.min ?? 2)) continue;
    const mats = [...new Set(list.map((m) => m.material as THREE.Material))] as THREE.MeshStandardMaterial[];
    const look = (m: THREE.MeshStandardMaterial) => `${m.color?.getHex()}|${m.roughness}|${m.metalness}|${m.emissive?.getHex()}|${m.emissiveIntensity}`;
    const pbr = mats.length > 1 && !!opts.pbr && mats.every((m) => pbrable(m, list[0].geometry)) && new Set(mats.map(look)).size > 1;
    const tinted = !pbr && new Set(mats.map((m) => m.color?.getHex())).size > 1;
    const geos = list.map((m) => {
      let g = m.geometry.clone().applyMatrix4(m.matrix); const mm = m.material as THREE.MeshStandardMaterial;
      if (opts.pbr && pbrable(mm, m.geometry) && g.attributes.normal) { if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); }
      const n = g.attributes.position.count;
      const fill = (name: string, v: number[]) => { const a = new Float32Array(n * v.length); for (let i = 0; i < n; i++) a.set(v, i * v.length); g.setAttribute(name, new THREE.BufferAttribute(a, v.length)); };
      if (tinted || pbr) fill('color', [mm.color.r, mm.color.g, mm.color.b]);
      if (pbr) { fill('aPbr', [mm.roughness, mm.metalness]); const e = mm.emissive.clone().multiplyScalar(mm.emissiveIntensity); fill('aGlow', [e.r, e.g, e.b]); }
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const a = list[0];
    let mat = a.material as THREE.Material;
    if (pbr) mat = pbrMaterial(a.material as THREE.MeshStandardMaterial);
    else if (tinted) {
      mat = mat.clone(); (mat as THREE.MeshStandardMaterial).vertexColors = true; (mat as THREE.MeshStandardMaterial).color.set(0xffffff);
      mat.userData = { ...mat.userData }; delete mat.userData.followers;
      for (const src of mats) ((src.userData.followers ??= []) as THREE.Material[]).push(mat);
    }
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = a.castShadow; out.receiveShadow = a.receiveShadow; out.userData = { ...a.userData };
    out.matrixAutoUpdate = false; // it sits at its parent's origin for good
    // in the first one's place: index lookups on the children that stay still find them
    const at = parent.children.indexOf(a);
    parent.children[at] = out; out.parent = parent; a.parent = null; a.dispatchEvent({ type: 'removed' });
    for (let i = 1; i < list.length; i++) parent.remove(list[i]);
    saved += list.length - 1;
  }
  return saved;
}
/** What may change later in a subtree: snapshot it, run its updates, and see what moved, hid or was recoloured. */
export function watchChanges(root: THREE.Object3D) {
  const before = new Map<THREE.Object3D, string>(), mats = new Map<THREE.Material, string>();
  const state = (o: THREE.Object3D) => `${o.position.toArray()}|${o.quaternion.toArray()}|${o.scale.toArray()}|${o.visible}`;
  root.traverse((o) => {
    before.set(o, state(o));
    const m = (o as THREE.Mesh).material;
    if (m) for (const x of Array.isArray(m) ? m : [m]) if (!mats.has(x)) mats.set(x, materialSignature(x));
  });
  return {
    /** Objects whose transform or visibility changed, and materials whose look changed. */
    changed() {
      const moved = new Set<THREE.Object3D>(), recoloured = new Set<THREE.Material>();
      for (const [o, s] of before) if (state(o) !== s) moved.add(o);
      for (const [m, s] of mats) if (materialSignature(m) !== s) recoloured.add(m);
      return { moved, recoloured, materials: mats };
    },
  };
}

/** For a subtree that never moves: compose its local matrices once and stop three.js recomposing them every frame. */
export function freezeTree(root: THREE.Object3D) {
  root.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  root.updateMatrixWorld(true);
}

/**
 * Many small canvases, one texture. A street is full of things that each painted their own canvas (a shop's shelves, a
 * sign, a poster, a banner): each is then its own material and its own draw call. This packs the canvases of every
 * mesh under `root` that `take` allows into a few big atlases, points each mesh's uvs at its place, and gives all the
 * meshes with the same kind of material one material per atlas, so `mergeChildren` can then merge them. A texture that
 * is redrawn later (`texture.userData.live`), tiles (repeat wrapping) or is offset is left alone.
 */
export function atlasCanvases(root: THREE.Object3D, take: (o: THREE.Mesh, m: THREE.Material) => boolean, size = 4096, oneSide = false) {
  type Std = THREE.MeshStandardMaterial;
  // a lit canvas's own brightness is painted into the atlas (dimmer ones darker), so lit signs of every brightness
  // share one material; with `oneSide`, single- and double-sided ones do too (all drawn double-sided)
  // phones (`oneSide`): the colour a canvas is multiplied by and its opacity are painted into the atlas as well, so
  // every opaque unlit canvas shares one material, every see-through one another, every lit one a third
  const sig = (m: Std) => oneSide ? [m.type, m.transparent, m.blending, m.toneMapped, m.depthWrite, m.fog, m.polygonOffset ? m.polygonOffsetFactor : 0, m.emissiveMap ? 'lit' : '', m.map?.colorSpace].join('|') : [m.type, oneSide ? 0 : m.side, m.transparent, m.blending, m.toneMapped, m.color?.getHexString(), m.opacity, m.depthWrite, m.depthTest, m.fog, m.alphaTest, m.polygonOffset, m.polygonOffsetFactor,
    m.roughness, m.metalness, m.emissive?.getHexString(), m.emissiveMap ? 'lit' : m.emissiveIntensity, !!m.emissiveMap, m.map?.colorSpace, m.envMapIntensity].join('|');
  const groups = new Map<string, { mesh: THREE.Mesh; mat: Std; cv: HTMLCanvasElement }[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh, m = mesh.material as Std;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m) || !m || !take(mesh, m)) return;
    if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshBasicMaterial') return;
    if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
    const t = m.map, cv = t?.image as HTMLCanvasElement | undefined;
    if (!t || !(t as THREE.CanvasTexture).isCanvasTexture || !cv || !cv.getContext || t.userData.live || t.wrapS === THREE.RepeatWrapping || t.wrapT === THREE.RepeatWrapping) return;
    if (t.offset.x || t.offset.y || t.repeat.x !== 1 || t.repeat.y !== 1 || t.rotation || !t.flipY) return;
    if ((m.emissiveMap && m.emissiveMap !== t) || m.normalMap || m.alphaMap || m.roughnessMap || m.metalnessMap || m.aoMap) return;
    if (cv.width > size / 2 || cv.height > size / 2 || !mesh.geometry.attributes.uv) return;
    const k = sig(m);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({ mesh, mat: m, cv });
  });
  let saved = 0;
  const PAD = 4;
  for (const list of groups.values()) {
    if (new Set(list.map((x) => x.cv)).size < 2) continue;
    // shelf packing, tallest first; a canvas used by several meshes is placed once
    const cvs = [...new Set(list.map((x) => x.cv))].sort((a, b) => b.height - a.height);
    const lit = !!list[0].mat.emissiveMap, K = lit ? Math.max(...list.map((x) => x.mat.emissiveIntensity)) : 1;
    const gain = new Map<HTMLCanvasElement, number>(); if (lit) for (const x of list) gain.set(x.cv, Math.max(gain.get(x.cv) ?? 0, x.mat.emissiveIntensity / K));
    // the tint and the opacity of each canvas's material (loose mode); KC keeps colours brighter than white (glowing panels)
    const KC = oneSide && !lit ? Math.max(1, ...list.map((x) => Math.max(x.mat.color.r, x.mat.color.g, x.mat.color.b))) : 1;
    const tint = new Map<HTMLCanvasElement, { c: THREE.Color; a: number }>();
    if (oneSide && !lit) for (const x of list) if (!tint.has(x.cv)) tint.set(x.cv, { c: x.mat.color.clone().multiplyScalar(1 / KC), a: x.mat.transparent ? x.mat.opacity : 1 });
    const sheets: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; x: number; y: number; row: number; at: Map<HTMLCanvasElement, [number, number]> }[] = [];
    const sheet = () => { const c = document.createElement('canvas'); c.width = c.height = size; const s = { c, g: c.getContext('2d')!, x: PAD, y: PAD, row: 0, at: new Map<HTMLCanvasElement, [number, number]>() }; sheets.push(s); return s; };
    let cur = sheet();
    const where = new Map<HTMLCanvasElement, typeof cur>();
    for (const cv of cvs) {
      if (cur.x + cv.width + PAD > size) { cur.x = PAD; cur.y += cur.row + PAD; cur.row = 0; }
      if (cur.y + cv.height + PAD > size) cur = sheet();
      const tn = tint.get(cv);
      if (tn && (tn.a < 0.999 || tn.c.r < 0.999 || tn.c.g < 0.999 || tn.c.b < 0.999)) {
        const tmp = document.createElement('canvas'); tmp.width = cv.width; tmp.height = cv.height; const tg = tmp.getContext('2d')!;
        tg.drawImage(cv, 0, 0); tg.globalCompositeOperation = 'multiply'; tg.fillStyle = `#${tn.c.clone().convertLinearToSRGB().getHexString()}`; tg.fillRect(0, 0, cv.width, cv.height);
        tg.globalCompositeOperation = 'destination-in'; tg.drawImage(cv, 0, 0);
        cur.g.globalAlpha = tn.a; cur.g.drawImage(tmp, cur.x, cur.y); cur.g.globalAlpha = 1;
      } else cur.g.drawImage(cv, cur.x, cur.y);
      const gk = gain.get(cv) ?? 1; if (gk < 0.999) { cur.g.fillStyle = `rgba(0,0,0,${(1 - gk).toFixed(3)})`; cur.g.fillRect(cur.x, cur.y, cv.width, cv.height); }
      cur.at.set(cv, [cur.x, cur.y]); where.set(cv, cur);
      cur.x += cv.width + PAD; cur.row = Math.max(cur.row, cv.height);
    }
    const mats = new Map<typeof cur, Std>();
    const done = new Set<THREE.BufferGeometry>();
    for (const it of list) {
      const s = where.get(it.cv)!, [x, y] = s.at.get(it.cv)!;
      let m = mats.get(s);
      if (!m) {
        // the sheet is cut down to what it holds
        const used = Math.min(size, s.y + s.row + PAD), c2 = document.createElement('canvas'); c2.width = size; c2.height = Math.max(4, used);
        c2.getContext('2d')!.drawImage(s.c, 0, 0); s.c = c2;
        const t = new THREE.CanvasTexture(c2); t.colorSpace = it.mat.map!.colorSpace; t.anisotropy = it.mat.map!.anisotropy;
        m = it.mat.clone(); m.map = t; if (it.mat.emissiveMap) { m.emissiveMap = t; m.emissiveIntensity = K; } if (oneSide) { m.side = THREE.DoubleSide; if (!lit) { m.color.setScalar(KC); m.opacity = 1; } else m.color.set(0xffffff); } m.userData = { ...it.mat.userData }; mats.set(s, m);
      }
      const H = s.c.height;
      // a geometry shared with other meshes gets its own copy before its uvs move
      let g = it.mesh.geometry;
      if (done.has(g) || true) { g = g.clone(); it.mesh.geometry = g; }
      done.add(g);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * it.cv.width) / size, 1 - (y + (1 - uv.getY(i)) * it.cv.height) / H);
      uv.needsUpdate = true;
      it.mesh.material = m; saved++;
    }
    for (const it of list) it.mat.map?.dispose();
  }
  return saved;
}
