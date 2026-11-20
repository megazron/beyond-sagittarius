import * as THREE from 'three';

/**
 * The GPS line in the world: chevrons on the ground along the route, from a few metres ahead of you to about forty
 * metres on, pointing the way (so a turn shows as the chevrons turning). One instanced draw.
 */
const N = 16, STEP = 2.6, START = 2.2;

export class GpsTrail {
  readonly mesh: THREE.InstancedMesh;
  private M = new THREE.Matrix4(); private Q = new THREE.Quaternion(); private P = new THREE.Vector3(); private S = new THREE.Vector3(1, 1, 1);
  private E = new THREE.Euler();

  constructor() {
    const s = new THREE.Shape();
    s.moveTo(0, 0.42); s.lineTo(0.42, -0.06); s.lineTo(0.27, -0.2); s.lineTo(0, 0.08); s.lineTo(-0.27, -0.2); s.lineTo(-0.42, -0.06); s.closePath();
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); // flat on the ground, pointing -z
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8a33d).multiplyScalar(1.6), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    m.userData.noNearFade = true;
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 2; this.mesh.name = 'gps';
  }

  /** Lay the chevrons along `route` (x, z pairs from the player) on `ground`; null hides them. */
  update(route: [number, number][] | null, ground: (x: number, z: number) => number, time: number) {
    const im = this.mesh;
    if (!route || route.length < 2) { im.count = 0; return; }
    let n = 0, seg = 0, along = START - ((time * 1.6) % STEP) + STEP, acc = 0; // they creep forward, so the line reads as moving
    while (n < N && seg < route.length - 1) {
      const [ax, az] = route[seg], [bx, bz] = route[seg + 1], L = Math.hypot(bx - ax, bz - az);
      if (along > acc + L) { acc += L; seg++; continue; }
      const k = (along - acc) / Math.max(L, 1e-6), x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      const fade = Math.min(1, (N - n) / 4);
      this.P.set(x, ground(x, z) + 0.05, z);
      this.E.set(0, Math.atan2(-(bx - ax), -(bz - az)), 0); this.Q.setFromEuler(this.E);
      this.S.setScalar(0.9 * fade);
      im.setMatrixAt(n++, this.M.compose(this.P, this.Q, this.S));
      along += STEP;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true;
  }

  /** Follow the stage on screen. */
  attach(scene: THREE.Object3D) { if (this.mesh.parent !== scene) scene.add(this.mesh); }
}
