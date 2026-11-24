import * as THREE from 'three';
import { hasWords } from './canvastext';

/**
 * Words on a surface must read the right way round from the side you see them. For every mesh in a scene whose
 * texture holds words (src/core/canvastext.ts marks those canvases), each triangle is checked in world space:
 * - mirrored: the texture's across (u) and up (v) directions, seen from the face's front, make a left-handed pair,
 *   so the words read backwards;
 * - upside down: on an upright surface, the texture's up runs down the world;
 * - two-sided: a material drawn from both sides shows the words mirrored from behind. A sign seen from both sides is
 *   two faces back to back (`twoFaced` below), each reading forwards.
 * Atlases that hold words in some tiles and none in others (stripes, shop windows) are judged by the triangle's own
 * uvs only when they span the texture both ways: a flat stripe has no up and is skipped.
 */
export interface TextFaceIssue { name: string; why: 'mirrored' | 'upside down' | 'two-sided'; at: [number, number, number]; tris: number }

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3();
const N = new THREE.Vector3(), PU = new THREE.Vector3(), PV = new THREE.Vector3(), X = new THREE.Vector3();
const M = new THREE.Matrix4(), IM = new THREE.Matrix4();

function wordTexture(m: THREE.Material): THREE.Texture | null {
  const mm = m as THREE.MeshStandardMaterial;
  for (const t of [mm.map, mm.emissiveMap]) if (t && hasWords(t.image)) return t;
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const k of Object.keys(u)) { const t = u[k]?.value as THREE.Texture | undefined; if (t?.isTexture && hasWords(t.image)) return t; }
  return null;
}

export function auditTextFaces(root: THREE.Object3D, maxTris = 4000): { checked: number; issues: TextFaceIssue[] } {
  root.updateMatrixWorld(true);
  const issues: TextFaceIssue[] = [];
  let checked = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.uv || !mesh.geometry.attributes.position) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const g = mesh.geometry, pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute, idx = g.index;
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const copies = inst ? Math.min(inst.count, 64) : 1;
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0]; if (!mat) continue;
      const tex = wordTexture(mat); if (!tex) continue;
      const name = `${mesh.name || mesh.parent?.name || mesh.type}:${(tex.image as HTMLCanvasElement)?.width}x${(tex.image as HTMLCanvasElement)?.height}`;
      const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld), at: [number, number, number] = [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)];
      if (mat.side === THREE.DoubleSide && !mesh.userData.wordsBothWays) issues.push({ name, why: 'two-sided', at, tris: 0 });
      const vy = tex.flipY ? 1 : -1, back = mat.side === THREE.BackSide ? -1 : 1;
      let mirrored = 0, upside = 0, n = 0;
      const end = Math.min(gr.start + gr.count, idx ? idx.count : pos.count), step = Math.max(3, Math.floor((end - gr.start) / 3 / maxTris) * 3);
      for (let c = 0; c < copies; c++) {
        M.copy(mesh.matrixWorld);
        if (inst) { inst.getMatrixAt(c, IM); M.multiply(IM); }
        const flip = M.determinant() < 0 ? -1 : 1; // three.js turns the winding round for a mirrored transform
        for (let i = gr.start; i + 2 < end; i += step) {
          const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, cc = idx ? idx.getX(i + 2) : i + 2;
          const u1 = uv.getX(b) - uv.getX(a), v1 = uv.getY(b) - uv.getY(a), u2 = uv.getX(cc) - uv.getX(a), v2 = uv.getY(cc) - uv.getY(a);
          const det = u1 * v2 - u2 * v1; if (Math.abs(det) < 1e-9) continue; // a stripe: no up to read
          A.fromBufferAttribute(pos, a).applyMatrix4(M); B.fromBufferAttribute(pos, b).applyMatrix4(M); C.fromBufferAttribute(pos, cc).applyMatrix4(M);
          E1.subVectors(B, A); E2.subVectors(C, A); N.crossVectors(E1, E2);
          if (N.lengthSq() < 1e-12) continue;
          N.normalize().multiplyScalar(flip * back);
          PU.copy(E1).multiplyScalar(v2).addScaledVector(E2, -v1).divideScalar(det);
          PV.copy(E2).multiplyScalar(u1).addScaledVector(E1, -u2).divideScalar(det).multiplyScalar(vy);
          n++;
          if (X.crossVectors(PU, PV).dot(N) < 0) mirrored++;
          if (Math.abs(N.y) < 0.5 && PV.normalize().y < -0.5) upside++;
        }
      }
      checked += n;
      if (mirrored > n * 0.1) issues.push({ name, why: 'mirrored', at, tris: mirrored });
      if (upside > n * 0.1) issues.push({ name, why: 'upside down', at, tris: upside });
    }
  });
  return { checked, issues };
}

/**
 * A sign seen from both sides: the plane and the same plane turned half round about its own up, back to back, each
 * drawn from its front only, so the words read forwards from either side (a double-sided material shows them
 * mirrored from behind). The geometry is centred on its own origin, in the xy plane, as PlaneGeometry makes it.
 */
export function twoFaced(g: THREE.BufferGeometry) {
  const backG = g.clone().rotateY(Math.PI);
  const a = g.index ? g.toNonIndexed() : g, b = backG.index ? backG.toNonIndexed() : backG;
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(a.attributes)) {
    const x = a.attributes[k] as THREE.BufferAttribute, y = b.attributes[k] as THREE.BufferAttribute;
    const arr = new (x.array.constructor as Float32ArrayConstructor)(x.array.length + y.array.length);
    arr.set(x.array as Float32Array); arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(k, new THREE.BufferAttribute(arr, x.itemSize, x.normalized));
  }
  return out;
}

/** The audit's own check: a sign that reads, one mirrored, one upside down and one two-sided must come out as such. */
export function probeTextFaces() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d')!; g.font = '20px sans-serif'; g.fillText('AB', 4, 24);
  const t = new THREE.CanvasTexture(c), m = new THREE.MeshBasicMaterial({ map: t }), root = new THREE.Group();
  const mk = (name: string, f: (o: THREE.Mesh) => void, mat: THREE.Material = m) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), mat); o.name = name; f(o); root.add(o); };
  mk('good', (o) => o.rotation.set(0, 0.7, 0));
  mk('mirror', (o) => o.scale.set(-1, 1, 1));
  mk('upside', (o) => o.rotation.set(0, 0, Math.PI));
  mk('both', () => undefined, new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
  const two = new THREE.Mesh(twoFaced(new THREE.PlaneGeometry(2, 1)), m); two.name = 'twoFaced'; root.add(two);
  const r = auditTextFaces(root);
  const got = r.issues.map((i) => `${i.name.split(':')[0]} ${i.why}`).sort();
  root.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); t.dispose();
  return got;
}
