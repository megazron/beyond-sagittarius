import * as THREE from 'three';

/**
 * Rain on Verdaxis: streaks in a box that follows a point (him), one draw. `amount` 0..1 fades it in and out; `covered`
 * hides the streaks over a roof (looking up from inside the house they fell through the thatch).
 */
export function createRain(scene: THREE.Scene, rich: boolean) {
  const N = rich ? 4200 : 1400, R = 16, TOP = 14;
  const pos = new Float32Array(N * 6), seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { seed[i * 3] = Math.random() * 2 * R - R; seed[i * 3 + 1] = Math.random() * TOP; seed[i * 3 + 2] = Math.random() * 2 * R - R; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xa8b8c8, transparent: true, opacity: 0, depthWrite: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false; lines.visible = false; lines.name = 'rain'; lines.userData.ground = false;
  scene.add(lines);
  let amount = 0, want = 0, time = 0;
  return {
    lines,
    get amount() { return amount; },
    /** Fade towards `a` (0..1) over about a second. */
    set(a: number) { want = Math.max(0, Math.min(1, a)); },
    update(dt: number, at: THREE.Vector3, covered?: (x: number, z: number, y: number) => boolean) {
      amount += (want - amount) * Math.min(1, dt * 1.5);
      if (want === 0 && amount < 0.01) amount = 0;
      lines.visible = amount > 0.02;
      if (!lines.visible) return;
      time += dt;
      mat.opacity = 0.34 * amount;
      const fall = 11, show = Math.floor(N * amount);
      for (let i = 0; i < N; i++) {
        if (i >= show) { pos.fill(0, i * 6, i * 6 + 6); pos[i * 6 + 1] = pos[i * 6 + 4] = -1e4; continue; }
        let y = seed[i * 3 + 1] - ((time * fall + i * 0.37) % TOP);
        if (y < 0) y += TOP;
        const x = at.x + seed[i * 3], z = at.z + seed[i * 3 + 2], yy = at.y - 3 + y;
        if (covered && covered(x, z, yy)) { pos.fill(0, i * 6, i * 6 + 6); pos[i * 6 + 1] = pos[i * 6 + 4] = -1e4; continue; }
        pos[i * 6] = x; pos[i * 6 + 1] = yy; pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x + 0.03; pos[i * 6 + 4] = yy - 0.55; pos[i * 6 + 5] = z + 0.02;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}
export type Rain = ReturnType<typeof createRain>;
