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
const SHADOW_BASE = 64, LIST_BASE = 128;
/** Draw the forest with InstancedBatches (set by main once the renderer is up; `?batch=0` turns it off). */
export const BATCH = { on: false };
export const MAX_GEOMETRIES = SHADOW_BASE;

let pending: Int32Array | null = null;
let patched = false;
/** The next multi-draw is ours: draw it instanced with these counts (set right before three issues it). */
function patchExt(gl: WebGL2RenderingContext) {
  if (patched) return;
  const ext = gl.getExtension('WEBGL_multi_draw') as (Record<string, (...a: unknown[]) => void>) | null;
  if (!ext || !ext.multiDrawElementsInstancedWEBGL || !ext.multiDrawArraysInstancedWEBGL) return;
  patched = true;
  const el = ext.multiDrawElementsWEBGL.bind(ext), ar = ext.multiDrawArraysWEBGL.bind(ext);
  const eli = ext.multiDrawElementsInstancedWEBGL.bind(ext), ari = ext.multiDrawArraysInstancedWEBGL.bind(ext);
  ext.multiDrawElementsWEBGL = (mode, counts, co, type, offsets, oo, n) => {
    const ic = pending; pending = null;
    if (ic) eli(mode, counts, co, type, offsets, oo, ic, 0, n); else el(mode, counts, co, type, offsets, oo, n);
  };
  ext.multiDrawArraysWEBGL = (mode, firsts, fo, counts, co, n) => {
    const ic = pending; pending = null;
    if (ic) ari(mode, firsts, fo, counts, co, ic, 0, n); else ar(mode, firsts, fo, counts, co, n);
  };
}

/** Can this renderer draw InstancedBatches? (Patches the extension on the first call.) */
export function batchSupported(r: THREE.WebGLRenderer): boolean {
  const gl = r.getContext() as WebGL2RenderingContext;
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
  private main = { starts: new Int32Array(SHADOW_BASE), counts: new Int32Array(SHADOW_BASE), inst: new Int32Array(SHADOW_BASE), n: 0 };
  private shad = { starts: new Int32Array(SHADOW_BASE), counts: new Int32Array(SHADOW_BASE), inst: new Int32Array(SHADOW_BASE), n: 0 };

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
        p.starts[k] = range.start * bpe; p.counts[k] = range.count; p.inst[k] = l.n;
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
    pending = p.n ? p.inst : null;
    void camera;
  }
}
