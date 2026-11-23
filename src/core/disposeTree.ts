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
