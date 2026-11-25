import * as THREE from 'three';
import { LAKE } from '../world/terrain';

/**
 * The objective marker's way on foot. The marker used to point straight at its target, and across the lake that is a
 * swim long enough to drown in (Episode Two's clay: a player who followed it swam, ran out of breath and died). When the
 * straight line runs into water deep enough to swim, the marker points instead at the next of a ring of dry points
 * round the lake, the shortest way on land. Only the lake is deep (heightfield.ts: the stream and the ponds are wadeable).
 */
const SWIM_DEPTH = 1.1; // player.ts swims from 1.25 m; a little less, so the way keeps clear of the edge
const STEP = 2;
const RING = 36;

type H = { height(x: number, z: number): number };
interface Node { p: THREE.Vector3; edges: { to: number; d: number }[] }

export class LandWay {
  private ring: Node[] | null = null;
  // routes worked out from the current 4 m cell, by target (the marker asks every frame, nearest() for each candidate)
  private cell = '';
  private cache = new Map<string, { via: THREE.Vector3; len: number }>();
  constructor(private terrain: H) {}

  /** Does the walk from a to b go into deep water once it has been on its feet? (Starting in the water, the way out is fine.) */
  wet(a: THREE.Vector3, b: THREE.Vector3) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
    let dry = this.terrain.height(a.x, a.z) > -SWIM_DEPTH;
    for (let i = 1; i <= n; i++) {
      const k = i / n, x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
      const deep = this.terrain.height(x, z) < -SWIM_DEPTH;
      if (deep && dry) return true;
      if (!deep) dry = true;
    }
    return false;
  }

  private build() {
    const ring: Node[] = [];
    for (const R of [LAKE.r + 24, LAKE.r + 40]) {
      for (let i = 0; i < RING; i++) {
        const a = (i / RING) * Math.PI * 2, x = LAKE.x + Math.cos(a) * R, z = LAKE.z + Math.sin(a) * R;
        const h = this.terrain.height(x, z);
        if (h < 0.2) continue;
        ring.push({ p: new THREE.Vector3(x, h, z), edges: [] });
      }
    }
    for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
      const a = ring[i].p, b = ring[j].p, d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 45 || this.wet(a, b)) continue;
      ring[i].edges.push({ to: j, d }); ring[j].edges.push({ to: i, d });
    }
    this.ring = ring;
  }

  /** The way from `from` to `to` on land: the first point to walk to (`to` itself when the line is dry) and the length. */
  route(from: THREE.Vector3, to: THREE.Vector3): { via: THREE.Vector3; len: number } {
    const cell = `${Math.round(from.x / 4)},${Math.round(from.z / 4)}`;
    if (cell !== this.cell || this.cache.size > 64) { this.cell = cell; this.cache.clear(); }
    const key = `${to.x.toFixed(1)},${to.z.toFixed(1)}`;
    const hit = this.cache.get(key); if (hit) return hit;
    const out = this.solve(from, to);
    this.cache.set(key, out);
    return out;
  }

  private solve(from: THREE.Vector3, to: THREE.Vector3): { via: THREE.Vector3; len: number } {
    const straight = Math.hypot(to.x - from.x, to.z - from.z);
    if (!this.wet(from, to)) return { via: to, len: straight };
    if (!this.ring) this.build();
    const ring = this.ring!, n = ring.length, S = n, T = n + 1;
    // Dijkstra over the ring with the start and the target joined to every ring point they can walk to dry
    const dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
    const toT = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) if (Math.hypot(ring[i].p.x - to.x, ring[i].p.z - to.z) < 70 && !this.wet(ring[i].p, to)) toT[i] = Math.hypot(ring[i].p.x - to.x, ring[i].p.z - to.z);
    dist[S] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === T) break;
      done[u] = 1;
      const relax = (v: number, d: number) => { if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; } };
      if (u === S) { for (let i = 0; i < n; i++) if (Math.hypot(ring[i].p.x - from.x, ring[i].p.z - from.z) < 70 && !this.wet(from, ring[i].p)) relax(i, Math.hypot(ring[i].p.x - from.x, ring[i].p.z - from.z)); continue; }
      for (const e of ring[u].edges) relax(e.to, e.d);
      if (toT[u] < Infinity) relax(T, toT[u]);
    }
    let via: THREE.Vector3 | null = null, len = straight;
    if (dist[T] < Infinity) {
      len = dist[T];
      // the first point on the way that is not where you stand (on a ring point, the next one)
      const path: number[] = []; for (let v = T; v !== S && v >= 0; v = prev[v]) path.unshift(v);
      const v = path.find((i) => i === T || Math.hypot(ring[i].p.x - from.x, ring[i].p.z - from.z) > 3) ?? T;
      via = v < n ? ring[v].p : to;
    }
    return { via: via ?? to, len };
  }
}

const WAYS = new WeakMap<object, LandWay>();
/** One way-finder per terrain. */
export function landWay(terrain: H) { let w = WAYS.get(terrain); if (!w) { w = new LandWay(terrain); WAYS.set(terrain, w); } return w; }
