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
