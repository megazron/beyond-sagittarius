import * as THREE from 'three';
import type { Terrain } from './terrain';
import { grainNormal } from '../characters/shapes';

/**
 * "The Walker": an enormous, slow, four-legged silhouette glimpsed between
 * the trees. Feet are planted in world space and step procedurally.
 */
export function createCreature(terrain: Terrain, onStep: (pos: THREE.Vector3) => void) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x1b1a1f, roughness: 0.7, metalness: 0.05, normalMap: grainNormal(), normalScale: new THREE.Vector2(1.2, 1.2) });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.14, 0.8, 0.7) });
  const body = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skin);
  torso.scale.set(4.5, 3.2, 9);
  body.add(torso);
  const hump = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin);
  hump.scale.set(3, 2.4, 4); hump.position.set(0, 2.4, -1.5); body.add(hump);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.8, 9, 12), skin);
  neck.position.set(0, -1.5, 10); neck.rotation.x = 1.15; body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin);
  head.scale.set(1.6, 1.3, 3.2); head.position.set(0, -5.2, 13.6); head.rotation.x = 0.7; body.add(head);
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.28 + (i % 3) * 0.12, 8, 6), glow);
    const a = (i / 26) * Math.PI * 2 * 3;
    s.position.set(Math.cos(a) * 4.0, 1.2 + Math.sin(i * 1.7) * 1.2, -7 + (i / 26) * 14);
    body.add(s);
  }
  for (const sx of [-0.6, 0.6]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow);
    eye.position.set(sx, -5.0, 16.4); body.add(eye);
  }
  // a ridge of stone-like plates along the back
  for (let i = 0; i < 16; i++) {
    const h = 1.2 + Math.sin((i / 15) * Math.PI) * 2.4;
    const plate = new THREE.Mesh(new THREE.ConeGeometry(0.75, h, 6), skin);
    plate.scale.z = 0.35; plate.position.set(0, 3.05 + Math.sin((i / 15) * Math.PI) * 1.5, -8 + i * 1.05); plate.rotation.x = -0.35;
    body.add(plate);
  }
  root.add(body);

  const legMeshes: { upper: THREE.Mesh; lower: THREE.Mesh; foot: THREE.Vector3; target: THREE.Vector3; from: THREE.Vector3; t: number; hip: THREE.Vector3; phase: number }[] = [];
  const hips = [new THREE.Vector3(-3.8, 0, 5), new THREE.Vector3(3.8, 0, 5), new THREE.Vector3(-3.8, 0, -5), new THREE.Vector3(3.8, 0, -5)];
  hips.forEach((hip, i) => {
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 1, 8), skin);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 1, 8), skin);
    root.add(upper, lower);
    legMeshes.push({ upper, lower, foot: new THREE.Vector3(), target: new THREE.Vector3(), from: new THREE.Vector3(), t: 1, hip, phase: i === 0 || i === 3 ? 0 : 0.5 });
  });
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });

  const pathR = 205;
  let angle = 4.12; // starts beyond the lake, in clear view of the crash site
  const speed = 2.4; // m/s
  const bodyPos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), knee = new THREE.Vector3();
  let initialised = false;
  let stepClock = 0;

  const orient = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    tmp.subVectors(b, a);
    const len = tmp.length();
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(up, tmp.normalize());
  };

  const pathPos = (ang: number, out: THREE.Vector3) => {
    const r = pathR + Math.sin(ang * 3) * 30;
    out.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    out.y = terrain.height(out.x, out.z) + 27;
    return out;
  };

  return {
    root,
    position: bodyPos,
    update(dt: number) {
      angle += (speed / pathR) * dt;
      pathPos(angle, bodyPos);
      pathPos(angle + 0.02, tmp2);
      fwd.subVectors(tmp2, bodyPos).setY(0).normalize();
      body.position.copy(bodyPos);
      body.position.y += Math.sin(stepClock * Math.PI * 2) * 0.4;
      body.lookAt(tmp2.x, body.position.y - 1, tmp2.z);
      stepClock += dt / 2.6;
      for (const L of legMeshes) {
        const hipW = L.hip.clone().applyQuaternion(body.quaternion).add(body.position);
        const side = Math.sign(L.hip.x);
        const ideal = tmp.copy(hipW).addScaledVector(fwd, 7).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(side * 7));
        ideal.y = terrain.height(ideal.x, ideal.z);
        if (!initialised) { L.foot.copy(ideal); L.target.copy(ideal); L.t = 1; }
        const cyc = (stepClock + L.phase) % 1;
        if (L.t >= 1 && cyc < 0.05 && L.foot.distanceTo(ideal) > 4) {
          L.from.copy(L.foot); L.target.copy(ideal); L.t = 0;
        }
        if (L.t < 1) {
          L.t = Math.min(1, L.t + dt / 1.2);
          L.foot.lerpVectors(L.from, L.target, L.t);
          L.foot.y += Math.sin(L.t * Math.PI) * 5;
          if (L.t >= 1) onStep(L.foot);
        }
        knee.addVectors(hipW, L.foot).multiplyScalar(0.5);
        knee.y += 12;
        knee.addScaledVector(new THREE.Vector3(fwd.z, 0, -fwd.x), side * 3);
        orient(L.upper, hipW, knee);
        orient(L.lower, knee, L.foot);
      }
      initialised = true;
    },
  };
}
