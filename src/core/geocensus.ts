import * as THREE from 'three';

/**
 * Test (?geocensus=1, tools/leak_probe.py): which geometries are on the GPU and no longer in any scene. The renderer's
 * geometry count only goes up while you play on the planet (932 to 3000 in 30 minutes in the glitch sweep's take w06)
 * and falls back on a reload: that is geometry drawn once and then dropped from the scene without dispose(). Every
 * geometry drawn is remembered (weakly) with where it was first drawn; `census(scenes)` groups the ones still alive,
 * not disposed and not under any of the scenes now, by that place.
 */
interface Seen { label: string; disposed: boolean }
const seen = new WeakMap<THREE.BufferGeometry, Seen>();
const refs: WeakRef<THREE.BufferGeometry>[] = [];
let on = false;

function labelOf(o: THREE.Object3D, g: THREE.BufferGeometry) {
  const names: string[] = [];
  for (let p: THREE.Object3D | null = o; p && names.length < 3; p = p.parent) if (p.name) names.push(p.name);
  return `${g.type}${g.name ? ` "${g.name}"` : ''} in ${names.join(' < ') || '(unnamed)'}`;
}

export function startCensus() {
  if (on) return; on = true;
  const was = THREE.Object3D.prototype.onBeforeRender;
  THREE.Object3D.prototype.onBeforeRender = function (this: THREE.Object3D, ...a: Parameters<typeof was>) {
    const g = (this as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g && !seen.has(g)) {
      const s: Seen = { label: labelOf(this, g), disposed: false };
      seen.set(g, s); refs.push(new WeakRef(g));
      g.addEventListener('dispose', () => { s.disposed = true; });
    }
    return was.apply(this, a);
  };
}

/** Live, undisposed geometries drawn at some time that are under none of `roots`, grouped by where they were drawn. */
export function census(roots: THREE.Object3D[]) {
  const inScene = new Set<THREE.BufferGeometry>();
  for (const r of roots) r.traverse((o) => { const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (g) inScene.add(g); });
  const by = new Map<string, number>(), held = new Map<string, number>();
  let alive = 0, lost = 0;
  for (const w of refs) {
    const g = w.deref(); if (!g) continue;
    const s = seen.get(g); if (!s || s.disposed) continue;
    alive++;
    if (inScene.has(g)) { held.set(s.label, (held.get(s.label) ?? 0) + 1); continue; }
    lost++; by.set(s.label, (by.get(s.label) ?? 0) + 1);
  }
  // (and the ones still in a scene, by the same label: the growth in the sweep was mostly these, leak_q5)
  const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  return { alive, inScene: inScene.size, lost, top: sort(by), held: sort(held) };
}
