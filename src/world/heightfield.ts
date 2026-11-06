import type { Simplex } from '../core/noise';

// local copies keep this file free of runtime imports, so node can run it for the bake
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Pure terrain shape: shared by the game and by tools/bake_erosion.ts. */
export const WORLD_SIZE = 1400;
export const HALF = WORLD_SIZE / 2;
export const LAKE = { x: -70, z: -125, r: 58 };

/** Ridged multifractal: each octave is weighted by the one before, so detail gathers on the crests. */
export function ridged(n: Simplex, x: number, z: number, oct: number): number {
  let sum = 0, amp = 0.5, w = 1, f = 1;
  for (let i = 0; i < oct; i++) {
    let s = 1 - Math.abs(n.noise2(x * f + i * 7.3, z * f - i * 3.1));
    s *= s;
    sum += s * amp * w;
    w = clamp(s * 1.6, 0, 1);
    amp *= 0.52;
    f *= 2.07;
  }
  return sum;
}

/** Height before the baked erosion is applied. */
export function baseHeight(n: Simplex, x: number, z: number): number {
  const wx = x + 35 * n.noise2(x * 0.0018, z * 0.0018);
  const wz = z + 35 * n.noise2(x * 0.0018 + 31.7, z * 0.0018 - 11.3);
  const base = n.fbm(wx * 0.0035, wz * 0.0035, 6);
  let h = 8 + base * 15;
  const ridge = 1 - Math.abs(n.noise2(wx * 0.0022 + 7.1, wz * 0.0022 - 3.3));
  const d0 = Math.hypot(x, z);
  h += ridge * ridge * ridge * 32 * smoothstep(90, 320, d0);
  h += n.noise2(x * 0.03, z * 0.03) * 0.7 + n.noise2(x * 0.09, z * 0.09) * 0.2;
  const clear = 1 - smoothstep(14, 55, d0);
  h = lerp(h, 6 + base * 3, clear);
  // ragged shoreline: bays and spits, not a circle
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + 11 * n.noise2(x * 0.015, z * 0.015) + 4.5 * n.noise2(x * 0.05 + 3, z * 0.05 - 8);
  const bed = -0.8 - 5.5 * clamp(1 - dl / LAKE.r, 0, 1);
  const tl = 1 - smoothstep(LAKE.r - 18, LAKE.r + 26, dl);
  h = lerp(h, bed, tl);
  // mountains around the valley: rock massifs with spurs reaching inwards
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const spur = 70 * n.noise2(x * 0.004 + 2.2, z * 0.004 - 6.1);
  const rim = smoothstep(400, 640, edge + spur);
  if (rim > 0) {
    const r = ridged(n, wx * 0.0021 + 11, wz * 0.0021 - 4, 6);
    h += rim * rim * (55 + 250 * r + 60 * ridge);
  }
  // rolling hills gain rocky ribs on the way to the mountains
  const mid = smoothstep(140, 380, d0);
  if (mid > 0) h += mid * (ridged(n, wx * 0.009 + 3, wz * 0.009 + 9, 4) - 0.28) * 16;
  return h;
}

/** How strongly the baked erosion applies at a point: nothing in the play valley, full on the mountains. */
export function erosionMask(x: number, z: number): number {
  return smoothstep(150, 330, Math.hypot(x, z));
}
