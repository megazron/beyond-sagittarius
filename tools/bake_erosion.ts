/**
 * Bakes hydraulic erosion for the mountains: raindrops run down the heightfield
 * from src/world/heightfield.ts, carving gullies and depositing sediment. The
 * game only loads the result, so it costs nothing at start-up.
 *
 * Output (public/models/world/): erosion_<res>.bin = Int16 height delta in
 * centimetres, then one Uint8 per cell of water flow (gullies, scree).
 *
 * Usage: node --experimental-strip-types tools/bake_erosion.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Simplex, mulberry32 } from '../src/core/noise.ts';
import { baseHeight, erosionMask, WORLD_SIZE, HALF } from '../src/world/heightfield.ts';

const RES = 1024;
const n = new Simplex(2189);
const cell = WORLD_SIZE / (RES - 1);
const H = new Float32Array(RES * RES);
for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) H[j * RES + i] = baseHeight(n, -HALF + i * cell, -HALF + j * cell);
const start = H.slice();
const flow = new Float32Array(RES * RES);
const mask = new Float32Array(RES * RES);
for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) mask[j * RES + i] = erosionMask(-HALF + i * cell, -HALF + j * cell);

// brush: erosion is spread over a small disc so it doesn't dig single-cell pits
const R = 3, brush: [number, number, number][] = [];
let bsum = 0;
for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
  const w = Math.max(0, 1 - Math.hypot(x, y) / R);
  if (w > 0) { brush.push([x, y, w]); bsum += w; }
}
brush.forEach((b) => (b[2] /= bsum));

const rnd = mulberry32(99);
const DROPS = 2_200_000, STEPS = 70;
const inertia = 0.06, capK = 7, minSlope = 0.02, deposit = 0.28, erode = 0.26, evap = 0.018, gravity = 9;
function sample(x: number, y: number) {
  const i = x | 0, j = y | 0, u = x - i, v = y - j, o = j * RES + i;
  const a = H[o], b = H[o + 1], c = H[o + RES], d = H[o + RES + 1];
  return { h: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, gx: (b - a) * (1 - v) + (d - c) * v, gy: (c - a) * (1 - u) + (d - b) * u };
}
for (let k = 0; k < DROPS; k++) {
  let x = 4 + rnd() * (RES - 9), y = 4 + rnd() * (RES - 9);
  if (mask[(y | 0) * RES + (x | 0)] < 0.05) continue;
  let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
  for (let s = 0; s < STEPS; s++) {
    const i = x | 0, j = y | 0, o = j * RES + i, u = x - i, v = y - j;
    const p = sample(x, y);
    dx = dx * inertia - p.gx * (1 - inertia);
    dy = dy * inertia - p.gy * (1 - inertia);
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) break;
    dx /= l; dy /= l;
    x += dx; y += dy;
    if (x < 4 || y < 4 || x > RES - 5 || y > RES - 5) break;
    const dh = sample(x, y).h - p.h;
    const cap = Math.max(-dh, minSlope) * speed * water * capK;
    const m = mask[o];
    if (sed > cap || dh > 0) {
      const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * deposit;
      sed -= amt;
      H[o] += amt * (1 - u) * (1 - v); H[o + 1] += amt * u * (1 - v); H[o + RES] += amt * (1 - u) * v; H[o + RES + 1] += amt * u * v;
    } else {
      const amt = Math.min((cap - sed) * erode, -dh, 0.3) * m; // the limit stops pits feeding on themselves
      for (const [bx, by, w] of brush) {
        const q = (j + by) * RES + i + bx;
        if (q < 0 || q >= H.length) continue;
        H[q] -= amt * w;
      }
      sed += amt;
    }
    flow[o] += water * 0.02;
    speed = Math.min(5, Math.sqrt(Math.max(speed * speed - dh * gravity * cell * 0.25, 0.01)));
    water *= 1 - evap;
  }
  if (k % 400000 === 0) console.log(`${k} drops`);
}

function write(res: number) {
  const step = (RES - 1) / (res - 1);
  const delta = new Int16Array(res * res), fl = new Uint8Array(res * res);
  let max = 0;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const o = Math.round(j * step) * RES + Math.round(i * step);
    const d = Math.max(-30, Math.min(30, H[o] - start[o])) * mask[o];
    delta[j * res + i] = Math.max(-32000, Math.min(32000, Math.round(d * 100)));
    max = Math.max(max, Math.abs(d));
    fl[j * res + i] = Math.min(255, Math.sqrt(flow[o]) * 90);
  }
  mkdirSync('public/models/world', { recursive: true });
  writeFileSync(`public/models/world/erosion_${res}.bin`, Buffer.concat([Buffer.from(delta.buffer), Buffer.from(fl.buffer)]));
  console.log(`erosion_${res}: max change ${max.toFixed(1)} m`);
}
write(1024);
write(512);
