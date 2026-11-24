import * as THREE from 'three';

/**
 * Hot air over a fire: each burning fire says where it is every frame it is drawn (src/world/flame.ts), and the
 * renderer bends the picture in a column over the nearest ones (the sanitize pass, Web and up; not on phones).
 * A fire that has not said so for a quarter of a second is out of the picture.
 */
export interface HeatSource { pos: THREE.Vector3; size: number; k: number; at: number }
export const heatSources: HeatSource[] = [];

export function heatAt(pos: THREE.Vector3, size: number, k: number) {
  const now = performance.now();
  // a fire within half a metre of one already here this frame is the same fire (the camp's own and the fight's)
  for (const h of heatSources) if (h.pos.distanceToSquared(pos) < 0.25) { if (now - h.at > 250 || size * k >= h.size * h.k) { h.pos.copy(pos); h.size = size; h.k = k; } h.at = now; return; }
  for (let i = heatSources.length - 1; i >= 0; i--) if (now - heatSources[i].at > 1000) heatSources.splice(i, 1);
  if (heatSources.length < 8) heatSources.push({ pos: pos.clone(), size, k, at: now });
}
