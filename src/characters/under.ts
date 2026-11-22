import * as THREE from 'three';

/**
 * Skin that lies under a garment must never read as skin. The build deletes most of it, but what sits near a collar,
 * a hem or a gap in the garment's own mesh stays, and in close-ups it showed as a patch of bare body through the
 * clothes (Nuvexa's collarbone under her sweater). Here every body vertex learns, once per geometry, whether cloth
 * encloses it: seven rays in a cone about its normal, and it counts as under cloth when most of them hit the garment
 * within a few centimetres. Such a vertex carries the garment's texture coordinate at the hit (`aUnder`), and the skin
 * shader draws it in the garment's own colour. A gap then shows more sweater, not body. Skin at a real opening (the
 * neck above a collar, a wrist past a cuff) has open air in most of the cone and stays skin.
 */
const REACH = 0.05, CELL = 0.04, NEED = 5;

export function underCloth(skin: THREE.SkinnedMesh, cloth: THREE.SkinnedMesh): number {
  const g = skin.geometry;
  if (g.userData.under !== undefined) return g.userData.under as number;
  const cg = cloth.geometry, ci = cg.getIndex(), cuv = cg.getAttribute('uv'), cac = cg.getAttribute('_accent') ?? cg.getAttribute('aAccent');
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  if (!ci || !cuv || !pos || !nor) { g.userData.under = 0; return 0; }
  // both meshes in the rest pose, in one space (quantised meshes are unpacked by their skinning, not their node)
  const v = new THREE.Vector3();
  const rest = (m: THREE.SkinnedMesh) => {
    const p = m.geometry.getAttribute('position'), out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
    return out;
  };
  const C = rest(cloth), S = rest(skin), idx = ci.array as ArrayLike<number>, nt = idx.length / 3;
  // the garment's triangles in a grid
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const cell = (a: number) => Math.floor(a / CELL);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const x0 = cell(Math.min(C[a], C[b], C[c])), x1 = cell(Math.max(C[a], C[b], C[c]));
    const y0 = cell(Math.min(C[a + 1], C[b + 1], C[c + 1])), y1 = cell(Math.max(C[a + 1], C[b + 1], C[c + 1]));
    const z0 = cell(Math.min(C[a + 2], C[b + 2], C[c + 2])), z1 = cell(Math.max(C[a + 2], C[b + 2], C[c + 2]));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const k = key(x, y, z); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(t); }
  }
  const out = new Float32Array(pos.count * 4);
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  const seen = new Set<number>();
  let count = 0;
  /** Nearest hit of a ray with the garment within REACH: [distance, triangle, u, v] or null. */
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach = REACH) => {
    let best = reach, bt = -1, bu = 0, bv = 0;
    seen.clear();
    const ex = ox + dx * reach, ey = oy + dy * reach, ez = oz + dz * reach;
    for (let x = cell(Math.min(ox, ex)); x <= cell(Math.max(ox, ex)); x++) for (let y = cell(Math.min(oy, ey)); y <= cell(Math.max(oy, ey)); y++) for (let z = cell(Math.min(oz, ez)); z <= cell(Math.max(oz, ez)); z++) {
      const l = grid.get(key(x, y, z));
      if (!l) continue;
      for (const t of l) {
        if (seen.has(t)) continue;
        seen.add(t);
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        // Moeller-Trumbore, both faces
        const e1x = C[b] - C[a], e1y = C[b + 1] - C[a + 1], e1z = C[b + 2] - C[a + 2], e2x = C[c] - C[a], e2y = C[c + 1] - C[a + 1], e2z = C[c + 2] - C[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - C[a], ty = oy - C[a + 1], tz = oz - C[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > -0.004 && dist < best) { best = dist; bt = t; bu = u; bv = w; }
      }
    }
    return bt < 0 ? null : ([best, bt, bu, bv] as const);
  };
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i).normalize();
    // two directions across the normal, for the cone
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize(); t2.crossVectors(n, t1);
    const ox = S[i * 3], oy = S[i * 3 + 1], oz = S[i * 3 + 2];
    let hits = 0, first: readonly [number, number, number, number] | null = null;
    for (let r = 0; r < 7; r++) {
      if (r === 0) d.copy(n);
      else { const a = (r - 1) * Math.PI / 3; d.copy(n).addScaledVector(t1, Math.cos(a) * 0.9).addScaledVector(t2, Math.sin(a) * 0.9).normalize(); }
      const h = cast(ox, oy, oz, d.x, d.y, d.z);
      if (h) { hits++; if (!first || h[0] < first[0]) first = h; }
    }
    // Skin that pokes OUT through the garment (Nuvexa's side, under the arm) has air outside it, so the outward cone
    // finds nothing; but the garment is right behind it. Cast the cone inwards too: most rays meeting cloth within a
    // few centimetres means this is body that came through the clothes, and it is drawn as the garment. Skin past a
    // real opening (a wrist beyond a cuff, the neck above a collar) has body behind it, not cloth.
    if (hits < NEED) {
      let ins = 0, firstIn: readonly [number, number, number, number] | null = null;
      for (let r = 0; r < 7; r++) {
        if (r === 0) d.copy(n).negate();
        else { const a = (r - 1) * Math.PI / 3; d.copy(n).negate().addScaledVector(t1, Math.cos(a) * 0.9).addScaledVector(t2, Math.sin(a) * 0.9).normalize(); }
        const h = cast(ox, oy, oz, d.x, d.y, d.z);
        if (h) { ins++; if (!firstIn || h[0] < firstIn[0]) firstIn = h; }
      }
      if (ins >= NEED - 1 && firstIn) { hits = ins; first = firstIn; }
    }
    // A strip of body between two garments (Zenvik's waist between his shirt's hem and his trousers, under the open
    // coat): rays up and down along the body, tipped a little outwards, both meet cloth within a hand's width. A real
    // opening (the neck, a wrist) has cloth on one side only.
    if (hits < NEED && Math.abs(n.y) < 0.6) {
      const up = cast(ox, oy, oz, n.x * 0.35, 0.94, n.z * 0.35, 0.09), down = up && cast(ox, oy, oz, n.x * 0.35, -0.94, n.z * 0.35, 0.09);
      if (up && down) { hits = NEED; first = up[0] < down[0] ? up : down; }
    }
    if (hits < NEED || !first) continue;
    const [, t, u, w] = first, a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2], k = 1 - u - w;
    out[i * 4] = cuv.getX(a) * k + cuv.getX(b) * u + cuv.getX(c) * w;
    out[i * 4 + 1] = cuv.getY(a) * k + cuv.getY(b) * u + cuv.getY(c) * w;
    out[i * 4 + 2] = 1;
    out[i * 4 + 3] = cac ? cac.getX(a) * k + cac.getX(b) * u + cac.getX(c) * w : 0;
    count++;
  }
  g.setAttribute('aUnder', new THREE.BufferAttribute(out, 4));
  g.userData.under = count;
  return count;
}

/**
 * The same for one garment under another: Lyrra's shirt came through her coat as jagged shards in close-ups. A cloth
 * vertex whose cone of rays mostly hits a garment of a higher layer (the coat over the shirt) is drawn with that outer
 * garment's texture (`aOver`). Where the outer garment is open (a coat's front) the cone finds air and the inner one
 * shows as itself. `layers` is the body's layer per atlas tile, as the cloth shader reads it.
 */
export function overCloth(cloth: THREE.SkinnedMesh, layers: number[]): number {
  const g = cloth.geometry;
  if (g.userData.over !== undefined) return g.userData.over as number;
  const index = g.getIndex(), uv = g.getAttribute('uv'), pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  if (!index || !uv || !pos || !nor || layers.length < 2) { g.userData.over = 0; return 0; }
  const tiles = layers.length;
  const layerOf = (i: number) => { const u = uv.getX(i), w = uv.getY(i); const k = tiles < 3 ? (u >= 0.5 ? 1 : 0) : (u >= 0.5 ? 1 : 0) + (w >= 0.46875 ? 2 : 0); return layers[k] ?? 1; };
  const v = new THREE.Vector3(), C = new Float32Array(pos.count * 3), L = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { cloth.getVertexPosition(i, v); v.applyMatrix4(cloth.matrixWorld); C[i * 3] = v.x; C[i * 3 + 1] = v.y; C[i * 3 + 2] = v.z; L[i] = layerOf(i); }
  const idx = index.array as ArrayLike<number>, nt = idx.length / 3;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const cell = (a: number) => Math.floor(a / CELL);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    for (let x = cell(Math.min(C[a], C[b], C[c])); x <= cell(Math.max(C[a], C[b], C[c])); x++)
      for (let y = cell(Math.min(C[a + 1], C[b + 1], C[c + 1])); y <= cell(Math.max(C[a + 1], C[b + 1], C[c + 1])); y++)
        for (let z = cell(Math.min(C[a + 2], C[b + 2], C[c + 2])); z <= cell(Math.max(C[a + 2], C[b + 2], C[c + 2])); z++) { const k = key(x, y, z); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(t); }
  }
  const REACH2 = 0.04, seen = new Set<number>();
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, above: number) => {
    let best = REACH2, bt = -1, bu = 0, bv = 0;
    seen.clear();
    const ex = ox + dx * REACH2, ey = oy + dy * REACH2, ez = oz + dz * REACH2;
    for (let x = cell(Math.min(ox, ex)); x <= cell(Math.max(ox, ex)); x++) for (let y = cell(Math.min(oy, ey)); y <= cell(Math.max(oy, ey)); y++) for (let z = cell(Math.min(oz, ez)); z <= cell(Math.max(oz, ez)); z++) {
      const l = grid.get(key(x, y, z));
      if (!l) continue;
      for (const t of l) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (L[idx[t * 3]] <= above) continue; // only garments over this one
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const e1x = C[b] - C[a], e1y = C[b + 1] - C[a + 1], e1z = C[b + 2] - C[a + 2], e2x = C[c] - C[a], e2y = C[c + 1] - C[a + 1], e2z = C[c + 2] - C[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - C[a], ty = oy - C[a + 1], tz = oz - C[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > -0.004 && dist < best) { best = dist; bt = t; bu = u; bv = w; }
      }
    }
    return bt < 0 ? null : ([best, bt, bu, bv] as const);
  };
  const top = Math.max(...layers);
  const out = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < pos.count; i++) {
    if (L[i] >= top) continue;
    n.fromBufferAttribute(nor, i).normalize();
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize(); t2.crossVectors(n, t1);
    let hits = 0, first: readonly [number, number, number, number] | null = null;
    for (let r = 0; r < 7; r++) {
      if (r === 0) d.copy(n);
      else { const a = (r - 1) * Math.PI / 3; d.copy(n).addScaledVector(t1, Math.cos(a) * 0.9).addScaledVector(t2, Math.sin(a) * 0.9).normalize(); }
      const h = cast(C[i * 3], C[i * 3 + 1], C[i * 3 + 2], d.x, d.y, d.z, L[i]);
      if (h) { hits++; if (!first || h[0] < first[0]) first = h; }
    }
    if (hits < NEED || !first) continue;
    const [, t, u, w] = first, a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2], k = 1 - u - w;
    out[i * 3] = uv.getX(a) * k + uv.getX(b) * u + uv.getX(c) * w;
    out[i * 3 + 1] = uv.getY(a) * k + uv.getY(b) * u + uv.getY(c) * w;
    out[i * 3 + 2] = 1;
    count++;
  }
  g.setAttribute('aOver', new THREE.BufferAttribute(out, 3));
  g.userData.over = count;
  return count;
}
