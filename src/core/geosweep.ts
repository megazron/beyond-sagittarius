import * as THREE from 'three';

/**
 * Geometry dropped from the planet without dispose(), freed. The story's scenes and builds take their props, sickles,
 * chaff, rows and walls out of the world with removeFromParent() and leave their GPU side behind: three keeps a vertex
 * array state per geometry (with its attributes) until dispose(), and its geometry count only went up while you played
 * on the planet (932 to 3000 in 30 minutes, heap 539 to 708 MB, glitch sweep G08). Every few seconds this looks at which
 * geometries are in the scenes it is given; one that was there and has been gone for two looks in a row is disposed.
 * Nothing is lost if it comes back: three uploads it again on its next draw, and a geometry that came back once is never
 * disposed again (a pool that takes things in and out of the scene would pay for an upload every time).
 * ?geosweep=0 turns it off.
 */
const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('geosweep') === '0';
const EVERY = 4;
let t = 0;
let last = new Set<THREE.BufferGeometry>();
const gone = new Map<THREE.BufferGeometry, number>();
const freed = new WeakSet<THREE.BufferGeometry>();
const keep = new WeakSet<THREE.BufferGeometry>();
export const sweepStats = { freed: 0, back: 0 };

export function geoSweep(dt: number, scenes: (THREE.Object3D | null | undefined)[]) {
  if (OFF) return;
  t += dt;
  if (t < EVERY) return;
  t = 0;
  const now = new Set<THREE.BufferGeometry>();
  for (const s of scenes) s?.traverse((o) => { const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (g?.isBufferGeometry) now.add(g); });
  for (const g of now) {
    gone.delete(g);
    if (freed.has(g)) { freed.delete(g); keep.add(g); sweepStats.back++; }
  }
  for (const g of last) if (!now.has(g) && !keep.has(g)) gone.set(g, 0);
  for (const [g, n] of gone) {
    if (n + 1 < 2) { gone.set(g, n + 1); continue; }
    gone.delete(g); g.dispose(); freed.add(g); sweepStats.freed++;
  }
  last = now;
}
