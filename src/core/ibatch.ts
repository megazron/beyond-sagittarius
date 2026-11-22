import * as THREE from 'three';

/**
 * Many models that share one material, drawn in ONE draw call per pass, each model as many times as it is listed.
 *
 * three.js's BatchedMesh draws every instance as its own sub-draw (multiDrawElements without instancing); an
 * InstancedMesh draws one geometry. This batch keeps BatchedMesh's per-instance matrices and colours (its data
 * textures) but draws each geometry ONCE, instanced, through WEBGL_multi_draw's instanced form: a sub-draw per geometry,
 * with as many instances as its list holds. The lists are the owner's (`setList`), not culled per pass: the owner
 * decides what is in view (the forest by distance rings and bearing sectors). The forest's ~40 species and scans were
 * ~120 instanced draws in each pass, about 35 us of the main thread each through ANGLE: now one per material.
 *
 * How a vertex finds its instance: the indirect texture holds, from texel 0, the start of each sub-draw's list in the
 * main pass (by gl_DrawID), from texel SHADOW_BASE the same for the shadow pass, and from LIST_BASE the lists of instance
 * ids themselves. index = ids[starts[gl_DrawID] + gl_InstanceID].
 *
 * Needs WEBGL_multi_draw with its instanced calls (`InstancedBatch.supported`); without it the owner keeps its
 * InstancedMeshes.
 */
const SHADOW_BASE = 256, LIST_BASE = 512;
/** Draw the forest with InstancedBatches (set by main once the renderer is up; `?batch=0` turns it off). */
export const BATCH = { on: false };
export const MAX_GEOMETRIES = SHADOW_BASE;

let pending: Int32Array | null = null;
const FR = new THREE.Frustum(), PV = new THREE.Matrix4();
let patched = false;
let info: THREE.WebGLInfo | null = null;
/** The next multi-draw is ours: draw it instanced with these counts (set right before three issues it). */
function patchExt(gl: WebGL2RenderingContext) {
  if (patched) return;
  const ext = gl.getExtension('WEBGL_multi_draw') as (Record<string, (...a: unknown[]) => void>) | null;
  if (!ext || !ext.multiDrawElementsInstancedWEBGL || !ext.multiDrawArraysInstancedWEBGL) return;
  patched = true;
  const el = ext.multiDrawElementsWEBGL.bind(ext), ar = ext.multiDrawArraysWEBGL.bind(ext);
  const eli = ext.multiDrawElementsInstancedWEBGL.bind(ext), ari = ext.multiDrawArraysInstancedWEBGL.bind(ext);
  // three counts a multi-draw's triangles once per sub-draw: add the other instances (and take out what drew none)
  const count = (counts: unknown, ic: Int32Array, n: unknown) => {
    if (!info) return;
    const c = counts as Int32Array; let extra = 0;
    for (let i = 0; i < (n as number); i++) extra += c[i] * (ic[i] - 1);
    info.render.triangles += extra / 3;
  };
  ext.multiDrawElementsWEBGL = (mode, counts, co, type, offsets, oo, n) => {
    const ic = pending; pending = null;
    if (ic) { eli(mode, counts, co, type, offsets, oo, ic, 0, n); count(counts, ic, n); } else el(mode, counts, co, type, offsets, oo, n);
  };
  ext.multiDrawArraysWEBGL = (mode, firsts, fo, counts, co, n) => {
    const ic = pending; pending = null;
    if (ic) { ari(mode, firsts, fo, counts, co, ic, 0, n); count(counts, ic, n); } else ar(mode, firsts, fo, counts, co, n);
  };
}

/** Can this renderer draw InstancedBatches? (Patches the extension on the first call.) */
export function batchSupported(r: THREE.WebGLRenderer): boolean {
  const gl = r.getContext() as WebGL2RenderingContext;
  info = r.info;
  const ext = gl.getExtension('WEBGL_multi_draw') as Record<string, unknown> | null;
  if (!ext || typeof ext.multiDrawElementsInstancedWEBGL !== 'function' || typeof ext.multiDrawArraysInstancedWEBGL !== 'function') return false;
  patchExt(gl);
  return patched;
}

/** The vertex shader patch: the instance index from the two-level lists (BASE 0 for the main pass, SHADOW_BASE for depth). */
export function batchVertex(vs: string, shadow: boolean) {
  const col = THREE.ShaderChunk.color_vertex.split('getIndirectIndex( gl_DrawID )').join('bsIdx');
  return vs
    .replace('void main() {', `void main() {
#ifdef USE_BATCHING
  float bsIdx = getIndirectIndex( ${LIST_BASE} + int( getIndirectIndex( gl_DrawID + ${shadow ? SHADOW_BASE : 0} ) ) + gl_InstanceID );
#endif`)
    .replace('#include <batching_vertex>', '#ifdef USE_BATCHING\n  mat4 batchingMatrix = getBatchingMatrix( bsIdx );\n#endif')
    .replace('#include <color_vertex>', col);
}

/** A depth material for an InstancedBatch's shadow pass; `extra` patches it further (e.g. the trees' alpha cut). */
export function batchDepth(extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void, key = '') {
  const d = new THREE.MeshDepthMaterial();
  d.onBeforeCompile = (sh) => { extra?.(sh); sh.vertexShader = batchVertex(sh.vertexShader, true); };
  d.customProgramCacheKey = () => `ibatch-depth|${key}`;
  return d;
}

export class InstancedBatch extends THREE.BatchedMesh {
  private lists: { ids: Int32Array; n: number; shadow: boolean }[] = [];
  private dirty = true;
  private main = { starts: new Int32Array(SHADOW_BASE), counts: new Int32Array(SHADOW_BASE), inst: new Int32Array(SHADOW_BASE), geo: new Int32Array(SHADOW_BASE), cur: new Int32Array(SHADOW_BASE), n: 0 };
  private shad = { starts: new Int32Array(SHADOW_BASE), counts: new Int32Array(SHADOW_BASE), inst: new Int32Array(SHADOW_BASE), geo: new Int32Array(SHADOW_BASE), cur: new Int32Array(SHADOW_BASE), n: 0 };
  /** Per geometry: a world-space sphere to cull it by in each pass (frustum of the pass's camera), and a switch. */
  private spheres: (THREE.Sphere | null)[] = [];
  private hidden: boolean[] = [];
  private culls = false;

  /** `instances`: how many instances it will hold; `vertices`, `indices`: of all its geometries together. */
  constructor(instances: number, vertices: number, indices: number, material: THREE.Material) {
    super(instances + LIST_BASE, vertices, indices, material);
    this.perObjectFrustumCulled = false;
    this.sortObjects = false;
    this.frustumCulled = false;
    // the main material's own patch (once per material)
    const m = material as THREE.Material & { userData: { ibatch?: boolean } };
    if (!m.userData.ibatch) {
      m.userData.ibatch = true;
      const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
      m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.vertexShader = batchVertex(sh.vertexShader, false); };
      m.customProgramCacheKey = () => `${key}|ibatch`;
    }
  }

  addGeometry(g: THREE.BufferGeometry, rv?: number, ri?: number): number {
    const id = super.addGeometry(g, rv, ri);
    if (id >= MAX_GEOMETRIES) throw new Error('InstancedBatch: too many geometries');
    this.lists[id] = { ids: new Int32Array(0), n: 0, shadow: true };
    return id;
  }

  /** Cull a geometry's sub-draw per pass by this world-space sphere (for static pieces drawn once each). */
  setCullSphere(geometryId: number, sphere: THREE.Sphere | null) { this.spheres[geometryId] = sphere; this.culls ||= !!sphere; }
  /** Leave a geometry out of every pass (e.g. what is only shown close by). */
  setHidden(geometryId: number, on: boolean) { this.hidden[geometryId] = on; this.culls = true; }
  isHidden(geometryId: number) { return !!this.hidden[geometryId]; }
  /** Leave a geometry out of the camera's passes only (it still casts its shadow). */
  setMainHidden(geometryId: number, on: boolean) { this.mainHidden[geometryId] = on; this.culls = true; }
  private mainHidden: boolean[] = [];

  /** Whether a geometry's list is drawn into the shadow maps too. */
  setShadow(geometryId: number, on: boolean) { this.lists[geometryId].shadow = on; this.dirty = true; }

  /** The instances to draw with a geometry this frame (copied). */
  setList(geometryId: number, ids: ArrayLike<number>, n: number) {
    const l = this.lists[geometryId];
    if (l.ids.length < n) l.ids = new Int32Array(Math.max(n, l.ids.length * 2, 16));
    for (let i = 0; i < n; i++) l.ids[i] = ids[i];
    l.n = n; this.dirty = true;
  }

  private layout() {
    this.dirty = false;
    const tex = this._ind(), data = tex.image.data as Uint32Array, cap = data.length;
    const index = this.geometry.getIndex(), bpe = index ? (index.array as Uint16Array | Uint32Array).BYTES_PER_ELEMENT : 1;
    const range = {} as THREE.BatchedMeshGeometryRange;
    let at = LIST_BASE;
    this.main.n = 0; this.shad.n = 0;
    for (let g = 0; g < this.lists.length; g++) {
      const l = this.lists[g];
      if (!l || !l.n || at + l.n > cap) continue;
      this.getGeometryRangeAt(g, range);
      const base = at - LIST_BASE;
      data.set(l.ids.subarray(0, l.n), at); at += l.n;
      for (const p of l.shadow ? [this.main, this.shad] : [this.main]) {
        const k = p.n++;
        p.starts[k] = range.start * bpe; p.counts[k] = range.count; p.inst[k] = l.n; p.geo[k] = g;
        data[(p === this.shad ? SHADOW_BASE : 0) + k] = base;
      }
    }
    tex.needsUpdate = true;
  }
  private _ind(): THREE.DataTexture { return (this as unknown as { _indirectTexture: THREE.DataTexture })._indirectTexture; }

  /** three calls this right before each pass draws the batch: point it at our sub-draws and arm the instanced call. */
  _updateDrawParameters(camera: THREE.Camera, _g: THREE.BufferGeometry, material: THREE.Material) {
    if (this.dirty) this.layout();
    const p = (material as THREE.MeshDepthMaterial).isMeshDepthMaterial || (material as THREE.MeshDistanceMaterial).isMeshDistanceMaterial ? this.shad : this.main;
    const self = this as unknown as { _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number };
    self._multiDrawStarts = p.starts; self._multiDrawCounts = p.counts; self._multiDrawCount = p.n;
    let inst = p.inst;
    if (this.culls) {
      // a culled sub-draw keeps its place (the lists' starts are by position) and draws no instances
      FR.setFromProjectionMatrix(PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      inst = p.cur;
      for (let k = 0; k < p.n; k++) {
        const g = p.geo[k], sp = this.spheres[g];
        inst[k] = this.hidden[g] || (p === this.main && this.mainHidden[g]) || (sp && !FR.intersectsSphere(sp)) ? 0 : p.inst[k];
      }
    }
    pending = p.n ? inst : null;
  }
}

const HIDE = new THREE.MeshBasicMaterial({ visible: false });
const FOLLOW = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'envMap', 'lightMap'];
const plainBefore = THREE.Object3D.prototype.onBeforeRender, ID = new THREE.Matrix4();
const BUILTIN = ['isMeshStandardMaterial', 'isMeshPhysicalMaterial', 'isMeshBasicMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial', 'isMeshToonMaterial'];

/**
 * Static meshes under `root` that share a material (and shadow flags and attributes) drawn by one InstancedBatch each:
 * every mesh one geometry drawn once, culled per pass by its own bounding sphere, so a material costs one draw call
 * per pass however many places (stretches of street, zones) it is merged into. Only frozen meshes (matrixAutoUpdate
 * false) that `accept` lets through, opaque, single-material, plain. A batched mesh keeps its place in the tree but
 * draws nothing itself; setting its `visible` shows or hides its part of the batch. Returns the draw calls saved per
 * pass (meshes batched minus batches made).
 */
export function batchStatic(root: THREE.Object3D, accept: (m: THREE.Mesh) => boolean = () => true, min = 3, keep?: Set<THREE.Material>): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, THREE.Mesh[]>(), M = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh, mat = m.material as THREE.Material;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return;
    if (!mat || Array.isArray(mat) || mat.transparent || !mat.visible || m.matrixAutoUpdate || !m.visible || m.onBeforeRender !== plainBefore || m.renderOrder !== 0) return;
    if (m.customDepthMaterial || Object.keys(m.geometry.morphAttributes).length || m.geometry.drawRange.count !== Infinity || !accept(m)) return;
    for (let p = m.parent; p && p !== root; p = p.parent) if (!p.visible || p.matrixAutoUpdate) return;
    // the built-in mesh materials only (their shaders read the batch); one with its own shader hook only where the
    // piece sits at the batch's origin (a hook may place things by modelMatrix alone, the facades do)
    if (!BUILTIN.some((k) => (mat as unknown as Record<string, boolean>)[k])) return;
    if (mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile && !M.multiplyMatrices(inv, m.matrixWorld).equals(ID)) return;
    const g = m.geometry, attrs = Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}`).join(',');
    const key = `${mat.uuid}|${m.castShadow}|${m.receiveShadow}|${attrs}|${!!g.index}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  });
  let saved = 0;
  // the batched pieces themselves move into one hidden group: three.js then no longer walks them, one by one, in every
  // pass of every frame (thousands of nodes that draw nothing). Names, `visible` and the portals' hooks still find them
  const held = new THREE.Group(); held.name = 'batched'; held.visible = false; held.matrixAutoUpdate = false;
  root.add(held); held.updateMatrixWorld(true);
  // a material on more pieces than one batch holds is drawn by several (in the order they were found: neighbours)
  const lists = [...groups.values()].flatMap((l) => { const out: THREE.Mesh[][] = []; for (let i = 0; i < l.length; i += MAX_GEOMETRIES) out.push(l.slice(i, i + MAX_GEOMETRIES)); return out; });
  for (const list of lists) {
    if (list.length < min) continue;
    let verts = 0, idx = 0;
    for (const m of list) { verts += m.geometry.attributes.position.count; idx += m.geometry.index ? m.geometry.index.count : 0; }
    const mat = list[0].material as THREE.Material;
    const b = new InstancedBatch(list.length, verts, Math.max(1, idx), mat);
    b.castShadow = list[0].castShadow; b.receiveShadow = list[0].receiveShadow;
    if (b.castShadow) b.customDepthMaterial = batchDepth();
    b.name = `static:${mat.name || mat.type}`;
    b.matrixAutoUpdate = false;
    for (const m of list) {
      const geo = b.addGeometry(m.geometry), id = b.addInstance(geo);
      M.multiplyMatrices(inv, m.matrixWorld); b.setMatrixAt(id, M);
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      b.setCullSphere(geo, m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld));
      b.setList(geo, [id], 1);
      // drawn by the batch: three skips it at the layer test (no frustum test, no draw) in every pass
      m.material = HIDE; m.frustumCulled = false; m.layers.mask = 0;
      m.userData.batchHide = (on: boolean) => b.setMainHidden(geo, on); // for the flat's portals (city.ts)
      const mw = m.matrixWorld.clone(); m.removeFromParent(); held.add(m);
      m.matrixAutoUpdate = false; m.matrix.multiplyMatrices(inv, mw); m.matrixWorld.copy(mw);
      Object.defineProperty(m, 'visible', { get: () => !b.isHidden(geo), set: (v: boolean) => b.setHidden(geo, !v), configurable: true });
    }
    root.add(b);
    saved += list.length - 1;
  }
  if (!held.children.length) root.remove(held);
  // whatever still draws one of the batches' materials on its own (a piece left out, an instanced prop) gets its own copy:
  // a material drawn both batched and plain switched its program on every such draw (three.js rebuilt its parameters
  // and looked the program up again, a few per cent of a frame). `keep`: materials changed later, which stay shared
  const batchedMats = new Set<THREE.Material>();
  root.traverse((o) => { if ((o as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) batchedMats.add((o as THREE.Mesh).material as THREE.Material); });
  const copies = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    if (!batchedMats.has(mat) || keep?.has(mat) || !mat.visible) return;
    let c = copies.get(mat);
    if (!c) {
      c = mat.clone(); c.userData = { ...mat.userData }; delete c.userData.followers;
      // maps that arrive later (set on the original by whoever loads them) are picked up at its next draw
      const src = mat as unknown as Record<string, unknown>, dst = c as unknown as Record<string, unknown>, cc = c;
      c.onBeforeRender = () => {
        let changed = false;
        for (const k of FOLLOW) if (dst[k] !== src[k]) { dst[k] = src[k]; changed = true; }
        if (cc.visible !== mat.visible) cc.visible = mat.visible;
        if (changed) cc.needsUpdate = true;
      };
      copies.set(mat, c);
    }
    m.material = c;
  });
  return saved;
}
