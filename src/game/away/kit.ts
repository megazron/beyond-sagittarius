import * as THREE from 'three';
import type { AwayStage, AwayTask } from './stage';
import { mulberry32 } from '../../core/noise';

export interface StageDef {
  sky: number; ground: number; rough?: number; gravity: number; jump: number;
  sun: number; sunI: number; ambient: number;
  /** Discs you stand on: x, z, radius, height. */
  pads: [number, number, number, number][];
  /** Scattered background bodies, and how far out. */
  debris: { n: number; color: number; near: number; far: number };
  /** A big body in the sky. */
  body?: { color: number; r: number; at: [number, number, number] };
  fog?: number;
  /** Task id, label key, where, what it needs. `count` makes that many pickups around the pads. */
  gather: { id: string; color: number; spots: [number, number][] };
  steps: { id: string; at: [number, number]; need?: string[] }[];
}

/** A location from data: same controls, same rules, its own place and its own jobs. */
export function buildStage(name: string, d: StageDef, label: (k: string) => string): AwayStage {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(d.sky);
  if (d.fog) scene.fog = new THREE.FogExp2(d.sky, d.fog);
  const rnd = mulberry32(name.length * 91 + 7);
  const sun = new THREE.DirectionalLight(d.sun, d.sunI); sun.position.set(40, 26, 24); scene.add(sun, new THREE.HemisphereLight(d.sun, d.ground, d.ambient));
  const rock = new THREE.MeshStandardMaterial({ color: d.ground, roughness: d.rough ?? .8, flatShading: true });
  const pads = d.pads.map(([x, z, r, y]) => ({ x, z, r, y }));
  for (const b of pads) {
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + (Math.sin(v.x * 5 + b.x) + Math.sin(v.y * 7 + b.z) + Math.sin(v.z * 6)) * .05); p.setXYZ(i, v.x, Math.min(v.y, .55), v.z); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, rock); m.scale.set(b.r * 1.08, b.r * 1.5, b.r * 1.08); m.position.set(b.x, b.y - .55 * b.r * 1.5, b.z); scene.add(m);
  }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const belt = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: d.debris.color, roughness: .9, flatShading: true }), d.debris.n);
  for (let i = 0; i < d.debris.n; i++) { const a = rnd() * 6.283, r = d.debris.near + rnd() * (d.debris.far - d.debris.near), sc = .3 + rnd() * rnd() * 6; t.set(Math.cos(a) * r, (rnd() - .5) * 40 - 8, Math.sin(a) * r); q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)); s.setScalar(sc); belt.setMatrixAt(i, M.compose(t, q, s)); }
  scene.add(belt);
  if (d.body) { const m = new THREE.Mesh(new THREE.SphereGeometry(d.body.r, 48, 32), new THREE.MeshStandardMaterial({ color: d.body.color, roughness: .85 })); m.position.set(...d.body.at); scene.add(m); }
  const padAt = (x: number, z: number) => pads.reduce((h, b) => (Math.hypot(x - b.x, z - b.z) < b.r ? Math.max(h, b.y) : h), -60);
  const bits = d.gather.spots.map(([x, z]) => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(.5), new THREE.MeshStandardMaterial({ color: d.gather.color, emissive: d.gather.color, emissiveIntensity: .45, roughness: .25 })); m.position.set(x, padAt(x, z) + .6, z); scene.add(m); return m; });
  const tasks: AwayTask[] = [];
  const gatherIds = bits.map((_, i) => `${d.gather.id}${i}`);
  bits.forEach((m, i) => tasks.push({ id: gatherIds[i], pos: m.position.clone(), radius: 2.2, label: label(`away.${name}.${d.gather.id}`), run: () => { m.visible = false; } }));
  d.steps.forEach((k, i) => tasks.push({ id: k.id, pos: new THREE.Vector3(k.at[0], padAt(k.at[0], k.at[1]), k.at[1]), radius: 3, label: label(`away.${name}.${k.id}`), need: k.need ?? (i === 0 ? gatherIds : [d.steps[i - 1].id]) }));
  return {
    scene, gravity: d.gravity, jump: d.jump, spawn: new THREE.Vector3(pads[0].x, 0, pads[0].z + 2), tasks,
    height: padAt, collide() { /* the height function is the only wall */ },
    update(_dt, time) { bits.forEach((m, i) => { m.rotation.y = time * .7 + i; }); },
  };
}

const P = (...a: [number, number, number, number][]) => a;
export const STAGES: Record<string, StageDef> = {
  // Bolzar: a rubble pile, airless and barely holding itself together
  scree: { sky: 0x03040a, ground: 0x4a4640, gravity: 1.6, jump: 2.6, sun: 0xfff2e0, sunI: 3.6, ambient: .25, pads: P([0, 0, 9, 0], [14, 5, 5, 1], [24, -3, 5, 2.6], [-14, -6, 5.5, .6]), debris: { n: 700, color: 0x3a3632, near: 30, far: 400 }, gather: { id: 'plate', color: 0xc8d4dc, spots: [[6, -3], [14, 5], [-14, -6]] }, steps: [{ id: 'weld', at: [24, -3] }] },
  // Lyrra: no ground at all, a piece of the ship turning in the light
  wreck: { sky: 0x000208, ground: 0x8a9096, rough: .4, gravity: .9, jump: 2, sun: 0xffffff, sunI: 4.5, ambient: .12, pads: P([0, 0, 7, 0], [11, 2, 4, 0], [20, -2, 4, 0], [-11, 3, 4, 0]), debris: { n: 240, color: 0x6a7076, near: 24, far: 300 }, gather: { id: 'lichen', color: 0xb58cff, spots: [[3, 3], [11, 2], [-11, 3]] }, steps: [{ id: 'suture', at: [0, -3] }, { id: 'burst', at: [20, -2] }] },
  // Draxum: a methane moon, thick orange air, the giant filling the sky
  moon: { sky: 0xa8642a, fog: .012, ground: 0x6a4a34, gravity: 2.4, jump: 3.4, sun: 0xffb060, sunI: 1.6, ambient: .9, pads: P([0, 0, 12, 0], [20, 4, 7, 1.2], [-18, -5, 7, .8], [34, -4, 6, 2.8]), debris: { n: 300, color: 0x5a3e2c, near: 40, far: 240 }, body: { color: 0xd8a870, r: 900, at: [-500, 620, -1500] }, gather: { id: 'ice', color: 0xe8e0d0, spots: [[8, 5], [20, 4], [-18, -5]] }, steps: [{ id: 'break', at: [34, -4] }, { id: 'ember', at: [0, -6] }] },
  // Nuvexa: drifting in the one layer of a hot planet's clouds where the pressure is sane
  clouds: { sky: 0xd8b860, fog: .02, ground: 0xc8c0a8, rough: .5, gravity: 3.2, jump: 4, sun: 0xfff0c8, sunI: 2, ambient: 1.1, pads: P([0, 0, 7, 0], [13, 2, 4, .8], [22, -3, 4, 1.8], [-12, 4, 4, .5]), debris: { n: 160, color: 0xe8d8a0, near: 30, far: 200 }, gather: { id: 'patch', color: 0xffd23c, spots: [[3, -3], [13, 2], [-12, 4]] }, steps: [{ id: 'relay', at: [22, -3] }] },
};
