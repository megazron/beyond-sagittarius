import * as THREE from 'three';
import type { AwayStage, AwayTask } from './stage';
import { mulberry32 } from '../../core/noise';

/** The Long Ice: a chain of boulders in the giant's ring. Nearly no gravity, no air, and the sun is small. */
export function createRing(label: (k: string) => string): AwayStage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);
  const rnd = mulberry32(44);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4); sun.position.set(40, 22, 30); scene.add(sun, new THREE.HemisphereLight(0x8ca8d8, 0x101828, .5));
  const ice = new THREE.MeshStandardMaterial({ color: 0xc8dcea, roughness: .42, metalness: .05, flatShading: true });
  // what you stand on: flat-topped boulders, each a disc you can jump between
  const rocks: { x: number; z: number; r: number; y: number }[] = [{ x: 0, z: 0, r: 9, y: 0 }, { x: 15, z: -6, r: 5.5, y: 1.2 }, { x: 25, z: 5, r: 5, y: 3 }, { x: 37, z: 1, r: 6, y: 4.5 }, { x: -13, z: 9, r: 5, y: -.6 }, { x: -22, z: -3, r: 5, y: 1.4 }];
  for (const b of rocks) {
    const g = new THREE.IcosahedronGeometry(1, 3); const p = g.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + (Math.sin(v.x * 5 + b.x) + Math.sin(v.y * 7 + b.z) + Math.sin(v.z * 6)) * .05; v.multiplyScalar(n); p.setXYZ(i, v.x, v.y > .55 ? .55 : v.y, v.z); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, ice); m.scale.set(b.r * 1.08, b.r * 1.5, b.r * 1.08); m.position.set(b.x, b.y - .55 * b.r * 1.5, b.z); scene.add(m);
  }
  // the rest of the ring: a river of ice to the horizon
  const belt = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), ice, 900); const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < 900; i++) { const a = rnd() * 6.283, d = 40 + rnd() * 500, sc = .3 + rnd() * rnd() * 7; t.set(Math.cos(a) * d, (rnd() - .5) * 14 - 6, Math.sin(a) * d * .55); q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)); s.setScalar(sc); belt.setMatrixAt(i, M.compose(t, q, s)); } scene.add(belt);
  const giant = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), new THREE.MeshStandardMaterial({ color: 0xc89a6a, roughness: .8 })); giant.position.set(-1500, 260, -1400); scene.add(giant);
  { const n = 2500, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const v = new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize().multiplyScalar(3200); p.set([v.x, v.y, v.z], i * 3); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false }))); }
  // pod 2, wedged in the ice, and what she makes of it
  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1.8, 6, 14), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: .5, metalness: .3 })); pod.rotation.z = 1.2; pod.position.set(-3, .9, -3.5); scene.add(pod);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(.9, 16, 8, 0, 6.283, 0, 1.1), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: .7, roughness: .35, side: THREE.DoubleSide })); dish.position.set(37, 5.6, 1); dish.rotation.x = -.7; scene.add(dish);
  const shards = [[6, 4], [15, -6], [-13, 9]].map(([x, z]) => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(.5), new THREE.MeshStandardMaterial({ color: 0xa6e4ff, roughness: .08, emissive: 0x2a6a8a })); const b = rocks.find((r) => Math.hypot(r.x - x, r.z - z) < r.r)!; m.position.set(x, b.y + .6, z); scene.add(m); return m; });
  const tasks: AwayTask[] = [
    { id: 'splint', pos: new THREE.Vector3(1.5, 0, 1.5), radius: 3, label: label('away.ring.splint') },
    ...shards.map((m, i) => ({ id: `ice${i}`, pos: m.position.clone(), radius: 2.2, label: label('away.ring.ice'), need: ['splint'], run: () => { m.visible = false; } })),
    { id: 'cracker', pos: pod.position.clone(), radius: 3.4, label: label('away.ring.cracker'), need: ['ice0', 'ice1', 'ice2'] },
    { id: 'dish', pos: dish.position.clone(), radius: 3, label: label('away.ring.dish'), need: ['cracker'] },
  ];
  return {
    scene, gravity: 3.4, jump: 3.6, spawn: new THREE.Vector3(0, 0, 3), tasks,
    height(x, z) { let h = -60; for (const b of rocks) if (Math.hypot(x - b.x, z - b.z) < b.r) h = Math.max(h, b.y); return h; },
    collide() { /* open space: the height function is the only wall */ },
    update(_dt, time) { shards.forEach((m, i) => { m.rotation.y = time * .7 + i; }); },
  };
}
