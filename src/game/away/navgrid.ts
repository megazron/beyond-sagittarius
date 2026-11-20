import type * as THREE from 'three';

/**
 * The GPS router for a walkable city: a 2 m grid of where a person can stand (from the stage's own collision boxes),
 * A* across it (roads cost a little more than pavements, so the line keeps to the pavement and crosses at junctions
 * when it can), then the corners pulled straight where the line of sight allows. Routes are cached: the same target
 * from about the same place reuses the last one.
 */
export function navGrid(bounds: [number, number, number, number], solids: THREE.Box3[], cost: (x: number, z: number) => number, cell = 2) {
  const [x0, z0, x1, z1] = bounds;
  const W = Math.ceil((x1 - x0) / cell), H = Math.ceil((z1 - z0) / cell);
  const block = new Uint8Array(W * H), extra = new Float32Array(W * H);
  for (const b of solids) {
    if (b.max.y < 0.5) continue;
    const i0 = Math.max(0, Math.floor((b.min.x - 0.35 - x0) / cell)), i1 = Math.min(W - 1, Math.floor((b.max.x + 0.35 - x0) / cell));
    const j0 = Math.max(0, Math.floor((b.min.z - 0.35 - z0) / cell)), j1 = Math.min(H - 1, Math.floor((b.max.z + 0.35 - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // a cell is blocked only if its centre is inside (thin posts must not cut pavements)
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
      if (cx > b.min.x - 0.3 && cx < b.max.x + 0.3 && cz > b.min.z - 0.3 && cz < b.max.z + 0.3) block[j * W + i] = 1;
    }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) extra[j * W + i] = cost(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
  const at = (x: number, z: number) => [Math.floor((x - x0) / cell), Math.floor((z - z0) / cell)] as const;
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && !block[j * W + i];
  const nearestFree = (i: number, j: number) => {
    if (free(i, j)) return [i, j] as const;
    for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && free(i + di, j + dj)) return [i + di, j + dj] as const;
    return null;
  };
  const sight = (ai: number, aj: number, bi: number, bj: number) => {
    const n = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    for (let k = 1; k < n; k++) { const t = k / n, i = Math.round(ai + (bi - ai) * t), j = Math.round(aj + (bj - aj) * t); if (!free(i, j) || extra[j * W + i] > 0.5) return false; }
    return true;
  };
  // A* with a binary heap
  const g = new Float32Array(W * H), from = new Int32Array(W * H), seen = new Uint32Array(W * H);
  let stamp = 0;
  const heap: number[] = [], key: number[] = [];
  const push = (n: number, f: number) => { heap.push(n); key.push(f); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= key[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [key[p], key[i]] = [key[i], key[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const ln = heap.pop()!, lk = key.pop()!; if (heap.length) { heap[0] = ln; key[0] = lk; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && key[l] < key[m]) m = l; if (r < heap.length && key[r] < key[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [key[m], key[i]] = [key[i], key[m]]; i = m; } } return top; };
  const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let last: { bx: number; bz: number; ax: number; az: number; path: [number, number][] } | null = null;
  function route(ax: number, az: number, bx: number, bz: number): [number, number][] {
    if (last && Math.hypot(last.bx - bx, last.bz - bz) < 0.5) {
      // still on the last route (within 4 m of it): carry on along it from the nearest leg
      const P = last.path; let best = 1e9, seg = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const [px, pz] = P[i], [qx, qz] = P[i + 1], dx = qx - px, dz = qz - pz, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((ax - px) * dx + (az - pz) * dz) / L2)), d = Math.hypot(px + dx * t - ax, pz + dz * t - az);
        if (d < best) { best = d; seg = i; }
      }
      if (best < 4) return [[ax, az], ...P.slice(seg + 1)];
    }
    const a = nearestFree(...at(ax, az)), b = nearestFree(...at(bx, bz));
    if (!a || !b) return [[ax, az], [bx, bz]];
    stamp++; heap.length = key.length = 0;
    const s = a[1] * W + a[0], t = b[1] * W + b[0];
    g[s] = 0; seen[s] = stamp; from[s] = -1; push(s, 0);
    let found = false, iters = 0;
    while (heap.length && iters++ < 400000) {
      const n = pop();
      if (n === t) { found = true; break; }
      const i = n % W, j = (n / W) | 0;
      for (const [di, dj, c] of D8) {
        const ni = i + di, nj = j + dj;
        if (!free(ni, nj) || (di && dj && (!free(i + di, j) || !free(i, j + dj)))) continue;
        const m = nj * W + ni, ng = g[n] + c * (1 + extra[m]);
        if (seen[m] === stamp && g[m] <= ng) continue;
        seen[m] = stamp; g[m] = ng; from[m] = n;
        push(m, ng + Math.hypot(ni - b[0], nj - b[1]));
      }
    }
    if (!found) return [[ax, az], [bx, bz]];
    const cells: [number, number][] = [];
    for (let n = t; n !== -1; n = from[n]) cells.push([n % W, (n / W) | 0]);
    cells.reverse();
    // string pulling: keep a corner only when the straight line past it is blocked
    const keep: [number, number][] = [cells[0]];
    let k = 0;
    while (k < cells.length - 1) {
      let far = k + 1;
      for (let m = cells.length - 1; m > k + 1; m--) if (sight(cells[k][0], cells[k][1], cells[m][0], cells[m][1])) { far = m; break; }
      keep.push(cells[far]); k = far;
    }
    const path: [number, number][] = [[ax, az], ...keep.slice(1, -1).map(([i, j]) => [x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell] as [number, number]), [bx, bz]];
    last = { bx, bz, ax, az, path };
    return path;
  }
  return { route, W, H };
}
