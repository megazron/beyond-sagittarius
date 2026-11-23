import * as THREE from 'three';

/**
 * Frees what a tree of objects holds on the GPU: every geometry, every material and the textures it uses, instanced and
 * batched meshes' own buffers, skeletons' bone textures, and a scene's environment and background. Used when a stage is
 * left: each visit to Zenvora or a crewmate's ground used to leave the whole place behind on the GPU (only the city
 * freed its geometries, the other stages nothing), so every visit added to what the next one had to fit beside.
 * Something shared with a place still on screen (an asset cache's mesh, a character's texture) is only uploaded again
 * the next time it is drawn: dispose() frees the GPU copy, not the data.
 */
export function disposeTree(root: THREE.Object3D, keep: THREE.Object3D[] = keepRoots()) {
  // whatever a place still on screen uses (the planet's crew share the characters' assets) is left alone: freeing a
  // material the planet still draws could cost a shader compile the moment you are back
  const kept = new Set<object>();
  for (const k of keep) k.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) kept.add(m.geometry);
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) for (const x of Array.isArray(mm) ? mm : [mm]) {
      kept.add(x);
      for (const v of Object.values(x)) if (v && (v as THREE.Texture).isTexture) kept.add(v as object);
      const u = (x as THREE.ShaderMaterial).uniforms;
      if (u) for (const n in u) { const v = u[n]?.value; if (v && (v as THREE.Texture).isTexture) kept.add(v as object); }
    }
  });
  const mats = new Set<THREE.Material>(), geos = new Set<THREE.BufferGeometry>(), texs = new Set<THREE.Texture>();
  const tex = (v: unknown) => { if (v && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture); };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) for (const x of Array.isArray(mm) ? mm : [mm]) mats.add(x);
    for (const k of ['customDepthMaterial', 'customDistanceMaterial'] as const) { const x = (o as THREE.Mesh)[k]; if (x) mats.add(x); }
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton?.dispose();
    if ((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.BatchedMesh).isBatchedMesh) (o as THREE.InstancedMesh).dispose();
  });
  for (const x of mats) {
    if (kept.has(x)) continue;
    for (const v of Object.values(x)) tex(v);
    const u = (x as THREE.ShaderMaterial).uniforms;
    if (u) for (const k in u) tex(u[k]?.value);
    x.dispose();
  }
  for (const g of geos) if (!kept.has(g)) g.dispose();
  const s = root as THREE.Scene;
  if (s.isScene) { tex(s.environment); tex(s.background); }
  for (const t of texs) if (!kept.has(t)) t.dispose();
}

let keepRoots: () => THREE.Object3D[] = () => [];
/** What must survive any disposeTree (main.ts: the planet's scene). */
export function setDisposeKeep(f: () => THREE.Object3D[]) { keepRoots = f; }

/** Every texture a material draws with: its maps, its uniforms' and its patched-in uniforms' (material.userData.u). */
function texturesOf(x: THREE.Material, out: Set<THREE.Texture>) {
  const add = (v: unknown) => { if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture); };
  for (const v of Object.values(x)) add(v);
  for (const u of [(x as THREE.ShaderMaterial).uniforms, (x.userData as { u?: Record<string, { value?: unknown }> } | undefined)?.u]) if (u) for (const k in u) add(u[k]?.value);
}

/**
 * Frees the GPU copies of the textures and geometry a set of trees draws, keeping the data (images, arrays): drawn
 * again, each is uploaded again then. Phones while they are away from the planet (main.ts): the planet, the films and
 * the vault held ~260 MB of textures and their geometry on the GPU behind the city. Whatever `keep` draws is left.
 * Returns what was let go, in MB (textures by their image size, geometry by its arrays).
 */
export function releaseGpu(roots: THREE.Object3D[], keep: THREE.Object3D[]) {
  const keepT = new Set<THREE.Texture>(), keepG = new Set<THREE.BufferGeometry>();
  for (const k of keep) k.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) keepG.add(m.geometry); const mm = m.material as THREE.Material | THREE.Material[] | undefined; if (mm) for (const x of Array.isArray(mm) ? mm : [mm]) texturesOf(x, keepT); });
  const texs = new Set<THREE.Texture>(), geos = new Set<THREE.BufferGeometry>();
  for (const r of roots) r.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.BatchedMesh).isBatchedMesh) geos.add(m.geometry);
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) for (const x of Array.isArray(mm) ? mm : [mm]) texturesOf(x, texs);
    const s = o as THREE.Scene; if (s.isScene && s.background && (s.background as THREE.Texture).isTexture) texs.add(s.background as THREE.Texture);
  });
  let tb = 0, gb = 0;
  for (const t of texs) {
    if (keepT.has(t) || (t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture || (t as THREE.VideoTexture).isVideoTexture) continue;
    const im = t.image as { width?: number; height?: number; data?: { byteLength: number } } | undefined;
    if (!im) continue; // nothing to upload it again from
    tb += im.data?.byteLength ?? (im.width ?? 0) * (im.height ?? 0) * 4;
    t.dispose();
  }
  for (const g of geos) {
    if (keepG.has(g)) continue;
    for (const k in g.attributes) gb += (g.attributes[k] as THREE.BufferAttribute).array?.byteLength ?? 0;
    g.dispose();
  }
  return { texMB: Math.round(tb / 1e6), geoMB: Math.round(gb / 1e6) };
}
