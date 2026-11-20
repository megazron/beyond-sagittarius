import * as THREE from 'three';

/**
 * A body's rigid props (glasses, horns and their rings, belts, bags, pouches, phones, the inside of the mouth, the
 * teeth) were a mesh and a draw call each, in every pass: a dozen or more a body. Here they become skinned meshes on
 * the body's own skeleton, every vertex held 100% by the bone its piece hung from, so they move exactly as before.
 * Pieces of different colours, roughness, metalness and glow share one material: those are kept per vertex. Only the
 * normal map (none, woven cloth, leather grain) and the face culling split them, so a body draws its kit in one to three
 * calls. Transparent pieces, textured ones, pieces with their own shader (swaying scarves, the hair) and whatever the
 * game moves or hides later (`skip`: the splint, the halo, the tail) stay as they were.
 */

const rigidOk = (m: THREE.Material): m is THREE.MeshStandardMaterial => {
  const s = m as THREE.MeshStandardMaterial;
  return s.type === 'MeshStandardMaterial' && !s.transparent && s.opacity === 1 && !s.map && !s.emissiveMap && !s.roughnessMap && !s.metalnessMap && !s.alphaMap && !s.aoMap && !s.lightMap
    && !s.bumpMap && !s.displacementMap && !s.envMap && !s.vertexColors && !s.wireframe && !s.alphaTest && s.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && s.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey && s.blending === THREE.NormalBlending
    && s.envMapIntensity === 1 && s.depthWrite && s.depthTest && s.colorWrite && !s.polygonOffset && !s.clippingPlanes && s.toneMapped && s.fog && !s.flatShading;
};

const looks = new Map<string, THREE.MeshStandardMaterial>();
/** One material per normal map and side, shared by every body: colour, roughness, metalness and glow come per vertex. */
function rigidMaterial(normalMap: THREE.Texture | null, scale: THREE.Vector2, side: THREE.Side) {
  const key = `${normalMap?.uuid ?? '-'}|${scale.x},${scale.y}|${side}`;
  let m = looks.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, normalMap, normalScale: scale.clone(), side, roughness: 1, metalness: 1, emissive: 0xffffff });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec3 aPbr; attribute vec3 aGlow; varying vec3 vPbr; varying vec3 vGlow;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPbr = aPbr; vGlow = aGlow;');
      sh.fragmentShader = 'varying vec3 vPbr; varying vec3 vGlow;\n' + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vGlow;');
    };
    m.customProgramCacheKey = () => 'crew-rigid';
    looks.set(key, m);
  }
  return m;
}

const M = new THREE.Matrix4(), N3 = new THREE.Matrix3(), V = new THREE.Vector3();
/**
 * Merge the rigid props under `skeleton`'s bones into skinned meshes added to `host`, bound like the body. Returns the
 * new meshes; the old ones are taken out of the scene.
 */
export function mergeRigid(skeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4, host: THREE.Object3D, skip: Set<THREE.Object3D>, sphere: THREE.Sphere) {
  const bindInv = bindMatrix.clone().invert();
  const pieces = new Map<string, { mat: THREE.MeshStandardMaterial; list: { mesh: THREE.Mesh; bone: number; m: THREE.Matrix4 }[] }>();
  skeleton.bones.forEach((bone, bi) => {
    bone.updateWorldMatrix(true, false);
    const boneInv = bone.matrixWorld.clone().invert();
    // the bone's rest frame in the body's bind space: inverse of its inverse bind matrix
    const rest = skeleton.boneInverses[bi].clone().invert();
    // true when every piece under `o` was taken (a bag whose flap and buckle hang off it goes only with them)
    const walk = (o: THREE.Object3D): boolean => {
      let all = true;
      for (const c of o.children) {
        if ((c as THREE.Bone).isBone || skip.has(c) || !c.visible) { all = false; continue; }
        const sub = walk(c);
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) { all &&= sub; continue; }
        if (!sub || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material) || !rigidOk(mesh.material as THREE.Material)
          || Object.keys(mesh.geometry.morphAttributes).length || !mesh.geometry.attributes.normal) { all = false; continue; }
        mesh.updateWorldMatrix(true, false);
        // piece -> bone (as it hangs now) -> the bone's rest frame -> the skinned mesh's own space
        const m = bindInv.clone().multiply(rest).multiply(M.multiplyMatrices(boneInv, mesh.matrixWorld));
        if (m.determinant() <= 0) { all = false; continue; }
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const key = `${mat.normalMap?.uuid ?? '-'}|${mat.normalScale.x},${mat.normalScale.y}|${mat.side}`;
        const e = pieces.get(key) ?? pieces.set(key, { mat, list: [] }).get(key)!;
        e.list.push({ mesh, bone: bi, m });
      }
      return all;
    };
    walk(bone);
  });
  const out: THREE.SkinnedMesh[] = [];
  for (const { mat, list } of pieces.values()) {
    if (list.length < 2 && !list[0].mesh.children.length) continue;
    const uvs = !!mat.normalMap;
    let nv = 0, ni = 0;
    for (const p of list) { const g = p.mesh.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), pbr = new Float32Array(nv * 3), glow = new Float32Array(nv * 3);
    const uv = uvs ? new Float32Array(nv * 2) : null, si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let v0 = 0, i0 = 0;
    for (const p of list) {
      const g = p.mesh.geometry, P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, n = P.count;
      const pm = p.mesh.material as THREE.MeshStandardMaterial;
      N3.getNormalMatrix(p.m);
      const e = pm.emissive.clone().multiplyScalar(pm.emissiveIntensity);
      for (let i = 0; i < n; i++) {
        V.fromBufferAttribute(P, i).applyMatrix4(p.m); V.toArray(pos, (v0 + i) * 3);
        V.fromBufferAttribute(Nn, i).applyMatrix3(N3).normalize(); V.toArray(nor, (v0 + i) * 3);
        col.set([pm.color.r, pm.color.g, pm.color.b], (v0 + i) * 3);
        pbr.set([pm.roughness, pm.metalness, 0], (v0 + i) * 3);
        glow.set([e.r, e.g, e.b], (v0 + i) * 3);
        if (uv) uv.set(U ? [U.getX(i), U.getY(i)] : [0, 0], (v0 + i) * 2);
        si[(v0 + i) * 4] = p.bone; sw[(v0 + i) * 4] = 1;
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[i0 + i] = g.index.getX(i) + v0;
      else for (let i = 0; i < n; i++) idx[i0 + i] = v0 + i;
      i0 += g.index ? g.index.count : n; v0 += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const sm = new THREE.SkinnedMesh(geo, rigidMaterial(mat.normalMap, mat.normalScale, mat.side));
    sm.name = 'kit'; sm.boundingSphere = sphere; geo.boundingSphere = sphere;
    sm.castShadow = list.some((p) => p.mesh.castShadow); sm.receiveShadow = true;
    host.add(sm);
    sm.bind(skeleton, bindMatrix);
    for (const p of list) p.mesh.removeFromParent();
    out.push(sm);
  }
  return out;
}
