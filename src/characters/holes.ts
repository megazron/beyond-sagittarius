import * as THREE from 'three';

/**
 * Small holes in a garment's own mesh (a missing patch at Nuvexa's collarbone, a few on other clothes) show the skin
 * under them. A hole is a loop of true boundary edges: edges only one triangle uses once vertices on the same spot
 * (split for UV seams) count as one. Loops up to `maxPerimeter` metres round are closed with a fan of the loop's own
 * vertices, so the patch is skinned exactly like the cloth around it. A garment's real openings (neck, cuffs, hems,
 * the coat's front) are far larger, so they stay open.
 */
export function fillSmallHoles(g: THREE.BufferGeometry, maxPerimeter = 0.11, maxEdges = 18): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, index = g.getIndex();
  if (!index || !pos) return 0;
  const n = pos.count, idx = index.array as ArrayLike<number>;
  // weld by position (0.1 mm): seam copies of a vertex are one point
  const pid = new Int32Array(n), keys = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keys.get(k);
    if (id === undefined) { id = keys.size; keys.set(k, id); }
    pid[i] = id;
  }
  // undirected edge use count by welded ends; the directed edge (with real vertex ids) of each single use
  const uses = new Map<number, number>(), dir = new Map<number, [number, number]>();
  const P = keys.size + 1;
  const ek = (a: number, b: number) => (a < b ? a * P + b : b * P + a);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3], k = ek(pid[a], pid[b]);
      uses.set(k, (uses.get(k) ?? 0) + 1);
      dir.set(k, [a, b]);
    }
  }
  // boundary: from the welded start point to its edge
  const next = new Map<number, [number, number]>();
  for (const [k, c] of uses) if (c === 1) { const [a, b] = dir.get(k)!; next.set(pid[a], [a, b]); }
  const seen = new Set<number>(), add: number[] = [];
  let filled = 0;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let at = start, len = 0, ok = true;
    for (let s = 0; s <= maxEdges + 1; s++) {
      const e = next.get(at);
      if (!e || seen.has(at)) { ok = at === start && loop.length > 2; break; }
      seen.add(at); loop.push(e[0]);
      pa.fromBufferAttribute(pos, e[0]); pb.fromBufferAttribute(pos, e[1]); len += pa.distanceTo(pb);
      at = pid[e[1]];
      if (at === start) { ok = loop.length > 2; break; }
      if (s === maxEdges + 1) ok = false;
    }
    if (!ok || at !== start || loop.length > maxEdges || len > maxPerimeter) continue;
    // the boundary runs one way round its triangles: the patch runs the other way, facing the same side
    for (let i = 1; i + 1 < loop.length; i++) add.push(loop[0], loop[i + 1], loop[i]);
    filled++;
  }
  if (!filled) return 0;
  const all = new (n > 65535 ? Uint32Array : Uint16Array)(idx.length + add.length);
  for (let i = 0; i < idx.length; i++) all[i] = idx[i];
  all.set(add, idx.length);
  g.setIndex(new THREE.BufferAttribute(all, 1));
  // the patch belongs to the garment's draw range
  if (g.drawRange.count !== Infinity) g.setDrawRange(g.drawRange.start, g.drawRange.count + add.length);
  return filled;
}

/**
 * Corners whose shading normal points away from their own triangle (a pocket flap welded to the cloth behind it when
 * the mesh was reduced) are lit from the wrong side and draw as pale or dark shards across a coat or a vest: thousands
 * on Draxum's vest and Lyrra's coat. Such a corner gets a vertex of its own carrying the triangle's own normal.
 * `rest` gives each vertex's rest position in one space (the meshes are quantised: their raw positions are not metres).
 */
export function fixOpposedNormals(g: THREE.BufferGeometry, rest: (i: number, out: THREE.Vector3) => void): number {
  const index = g.getIndex(), nor = g.getAttribute('normal') as THREE.BufferAttribute;
  if (!index || !nor) return 0;
  plain(g);
  const idx = Array.from(index.array as ArrayLike<number>), nt = idx.length / 3, count = nor.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  const extra: { from: number; x: number; y: number; z: number }[] = [];
  for (let t = 0; t < nt; t++) {
    rest(idx[t * 3], a); rest(idx[t * 3 + 1], b); rest(idx[t * 3 + 2], c);
    fn.copy(b).sub(a).cross(c.sub(a));
    if (fn.lengthSq() < 1e-16) continue;
    fn.normalize();
    for (let e = 0; e < 3; e++) {
      const i = idx[t * 3 + e];
      vn.fromBufferAttribute(nor, i).normalize();
      if (vn.dot(fn) >= 0.2) continue;
      extra.push({ from: i, x: fn.x, y: fn.y, z: fn.z });
      idx[t * 3 + e] = count + extra.length - 1;
    }
  }
  if (!extra.length) return 0;
  const total = count + extra.length;
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name] as THREE.BufferAttribute, old = at.array as unknown as { constructor: new (n: number) => ArrayLike<number> & { set(a: ArrayLike<number>): void; [i: number]: number } };
    const arr = new old.constructor(total * at.itemSize);
    arr.set(at.array as ArrayLike<number>);
    for (let j = 0; j < extra.length; j++) for (let k = 0; k < at.itemSize; k++) arr[(count + j) * at.itemSize + k] = (at.array as ArrayLike<number>)[extra[j].from * at.itemSize + k];
    const na = new THREE.BufferAttribute(arr as unknown as THREE.TypedArray, at.itemSize, at.normalized);
    if (name === 'normal') for (let j = 0; j < extra.length; j++) na.setXYZ(count + j, extra[j].x, extra[j].y, extra[j].z);
    g.setAttribute(name, na);
  }
  g.setIndex(new THREE.BufferAttribute(new (total > 65535 ? Uint32Array : Uint16Array)(idx), 1));
  return extra.length;
}

/** Attributes packed into a shared buffer (the loader does that to a garment's normals) become arrays of their own, as plain numbers. */
function plain(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute & { isInterleavedBufferAttribute?: boolean };
    if (!a.isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
}
