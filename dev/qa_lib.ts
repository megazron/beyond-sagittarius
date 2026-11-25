// Dev-only: measuring helpers shared by rig.ts (tools/rig_check.py) and animqa.ts (tools/anim_qa.py).
import * as THREE from 'three';
import type { Character } from '../src/characters/character';

export const V = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
export const meshes = (c: Character, name: string) => { const out: THREE.SkinnedMesh[] = []; c.root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.name.startsWith(name)) out.push(m); }); return out; };
export const world = (m: THREE.SkinnedMesh) => { const n = m.geometry.attributes.position.count, f = new Float32Array(n * 3); for (let i = 0; i < n; i++) { m.getVertexPosition(i, V); V.applyMatrix4(m.matrixWorld); f[i * 3] = V.x; f[i * 3 + 1] = V.y; f[i * 3 + 2] = V.z; } return f; };
export const bone = (c: Character, n: string) => c.root.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
export function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) { const ab = B.copy(b).sub(a), t = Math.max(0, Math.min(1, P.copy(p).sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(A.copy(a).addScaledVector(ab, t)); }
export const TORSO: [string, string][] = [['hips', 'spine1'], ['spine1', 'chest'], ['chest', 'neck']];

/** Radius of each torso segment from the body at rest: how far the skin sits from the bone line. */
export function radii(c: Character) {
  // the surface you see: body skin, and clothes above the hips (a full suit leaves almost no body skin; a coat's skirt is not torso)
  const body = meshes(c, 'skin_body').map(world), cloth = meshes(c, 'cloth').map(world);
  const segs = TORSO.map(([a, b]) => [bone(c, a), bone(c, b)] as const);
  const hip = segs[0][0], up = segs[2][1].clone().sub(hip), upL2 = up.lengthSq(), Q = new THREE.Vector3();
  const per: number[][] = segs.map(() => []);
  for (const [list, isCloth] of [[body, false], [cloth, true]] as const) for (const f of list) for (let i = 0; i < f.length; i += 3) {
    V.set(f[i], f[i + 1], f[i + 2]); let best = 9, k = -1;
    if (isCloth && Q.copy(V).sub(hip).dot(up) / upL2 < .05) continue;
    segs.forEach(([a, b], j) => { const d = segDist(V, a, b); if (d < best) { best = d; k = j; } });
    if (k >= 0 && best < .3) per[k].push(best);
  }
  return per.map((x) => { x.sort((a, b) => a - b); return x[Math.floor(x.length * .45)] ?? .1; });
}

/** Cloth vertex normals from the deformed cloth, for the inside/outside test. */
export function clothNormals(m: THREE.SkinnedMesh, f: Float32Array) {
  const idx = m.geometry.index!.array, n = new Float32Array(f.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = f[b] - f[a], uy = f[b + 1] - f[a + 1], uz = f[b + 2] - f[a + 2], vx = f[c] - f[a], vy = f[c + 1] - f[a + 1], vz = f[c + 2] - f[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

export const BONE_NAMES = ['hips', 'spine1', 'chest', 'neck', 'head', 'upperarmL', 'upperarmR', 'lowerarmL', 'lowerarmR', 'upperlegL', 'upperlegR', 'lowerlegL', 'lowerlegR', 'footL', 'footR', 'clavicleL', 'clavicleR'];
export function nearestBone(c: Character, x: number, y: number, z: number) { let best = 9, n = ''; for (const b of BONE_NAMES) { const o = c.root.getObjectByName(b); if (!o) continue; const p = o.getWorldPosition(new THREE.Vector3()); const d = Math.hypot(p.x - x, p.y - y, p.z - z); if (d < best) { best = d; n = b; } } return n; }

/** Body skin against the deformed cloth: covered (inside at rest) and how far any covered vertex now sits outside. */
export function poke(c: Character, covered: Uint8Array[] | null) {
  const bodyM = meshes(c, 'skin_body'), cl = meshes(c, 'cloth');
  const bp = bodyM.map(world), cp = cl.map(world), cn = cl.map((m, i) => clothNormals(m, cp[i]));
  // open edges of the clothes (cuffs, collars, hems): skin sliding out past them is not skin through cloth
  const edge = cl.map((m, mi) => {
    const idx = m.geometry.index!.array, cnt = new Map<string, number>();
    for (let i = 0; i < idx.length; i += 3) for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) { const k = a < b ? `${a},${b}` : `${b},${a}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
    const f = cp[mi], pts: number[] = [];
    // the same cloth position appears on several uv seams: an edge only counts if no other face shares its positions
    for (const [k, n] of cnt) if (n === 1) { const [a] = k.split(',').map(Number); pts.push(f[a * 3], f[a * 3 + 1], f[a * 3 + 2]); }
    return pts;
  });
  const nearEdge = (x: number, y: number, z: number) => edge.some((pts) => { for (let i = 0; i < pts.length; i += 3) if (Math.hypot(pts[i] - x, pts[i + 1] - y, pts[i + 2] - z) < .035) return true; return false; });
  const cell = .05, grid = new Map<string, number[]>();
  cp.forEach((f, mi) => { for (let i = 0; i < f.length; i += 3) { const key = `${Math.floor(f[i] / cell)},${Math.floor(f[i + 1] / cell)},${Math.floor(f[i + 2] / cell)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(mi * 1e6 + i); } });
  const cov = bp.map((f) => new Uint8Array(f.length / 3));
  let max = 0, count = 0, worstAt = '';
  bp.forEach((f, bi) => {
    for (let i = 0; i < f.length; i += 3) {
      if (covered && !covered[bi][i / 3]) continue;
      const gx = Math.floor(f[i] / cell), gy = Math.floor(f[i + 1] / cell), gz = Math.floor(f[i + 2] / cell);
      let best = 1, bid = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const id of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const mi = Math.floor(id / 1e6), j = id % 1e6, q = cp[mi]; const d = Math.hypot(q[j] - f[i], q[j + 1] - f[i + 1], q[j + 2] - f[i + 2]); if (d < best) { best = d; bid = id; }
      }
      if (bid < 0) continue;
      const mi = Math.floor(bid / 1e6), j = bid % 1e6, q = cp[mi], nn = cn[mi];
      const out = (f[i] - q[j]) * nn[j] + (f[i + 1] - q[j + 1]) * nn[j + 1] + (f[i + 2] - q[j + 2]) * nn[j + 2];
      if (!covered) { if (best < .04 && out < -.001) cov[bi][i / 3] = 1; continue; }
      if (out > .006 && !nearEdge(q[j], q[j + 1], q[j + 2])) { count++; if (out > max) { max = out; worstAt = nearestBone(c, f[i], f[i + 1], f[i + 2]); } }
    }
  });
  return { covered: cov, max, count, worstAt };
}

