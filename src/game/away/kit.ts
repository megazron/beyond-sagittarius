import * as THREE from 'three';
import type { AwayStage, AwayTask } from './stage';
import { mulberry32, Simplex } from '../../core/noise';
import { loadTexture } from '../../core/assets';

export type Trait = 'frost' | 'plates' | 'lichen' | 'ember' | 'float';

export interface StageDef {
  sky: number; fog?: number; gravity: number; jump: number;
  /** Ground: one of the CC0 sets fetched by tools/fetch_assets.py, tinted. */
  tex: 'ice' | 'regolith' | 'hull' | 'frozen'; tint: number; rough: number; metal: number; repeat: number;
  /** How rough the ground is, metres, and how wide its features are. */
  relief: number; scale: number;
  sun: number; sunI: number; ambient: number; ambientG: number;
  /** Discs you stand on: x, z, radius, height. */
  pads: [number, number, number, number][];
  debris: { n: number; color: number; near: number; far: number; size: number };
  body?: { color: number; r: number; at: [number, number, number]; ring?: number };
  /** The wreck turns: the sun comes and goes on this period, seconds. */
  sunSwing?: number;
  /** Lakes of liquid methane between the pads. */
  lakes?: number;
  trait: Trait;
  /** Done before anything else (Skyvra's splint). */
  first?: { id: string; at: [number, number] };
  /** Things that belong to this place only. */
  props?: (scene: THREE.Scene, h: (x: number, z: number) => number) => void;
  gather: { id: string; color: number; spots: [number, number][] };
  steps: { id: string; at: [number, number]; need?: string[] }[];
}

/** One body the stage can light up or slow down: its lineage, made visible. */
export interface StageBody { root: THREE.Object3D; glow(k: number): void; slow(k: number): void }

/** A location from data: textured ground with real relief, shadows, a sky, and the lineage trait in play. */
export function buildStage(name: string, d: StageDef, label: (k: string) => string, job = 0): AwayStage & { bind(b: StageBody): void } {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(d.sky);
  if (d.fog) scene.fog = new THREE.FogExp2(d.sky, d.fog);
  const rnd = mulberry32(name.length * 91 + 7), noise = new Simplex(name.length * 13 + 3);
  const pads = d.pads.map(([x, z, r, y]) => ({ x, z, r, y }));
  // walkable height and the ground mesh come from the same function, so what you see is what you stand on
  const surf = (x: number, z: number, b: { y: number }) => b.y + d.relief * noise.fbm(x / d.scale, z / d.scale, 4);
  // a flat top, then a broken edge falling away into nothing
  const vert = (x: number, z: number, b: { x: number; z: number; r: number; y: number }) => {
    const edge = Math.max(0, Math.hypot(x - b.x, z - b.z) / b.r - .96);
    return surf(x, z, b) - (edge * edge * 60 + edge * 9 + noise.fbm(x * .3, z * .3, 3) * edge * 4);
  };
  const lattice = (b: { r: number }) => { const size = b.r * 2.5, seg = Math.round(Math.min(160, 40 + b.r * 9)); return { size, seg, step: size / seg }; };
  // the drawn surface: the pad mesh's own lattice and triangles (PlaneGeometry splits each quad along b to d)
  const drawn = (x: number, z: number, b: { x: number; z: number; r: number; y: number }) => {
    const { size, step } = lattice(b), x0 = b.x - size / 2, z0 = b.z - size / 2;
    const gx = (x - x0) / step, gz = (z - z0) / step, i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
    const X = x0 + i * step, Z = z0 + j * step;
    const hb = vert(X, Z + step, b), hd = vert(X + step, Z, b);
    if (tx + tz <= 1) { const ha = vert(X, Z, b); return ha + (hd - ha) * tx + (hb - ha) * tz; }
    const hc = vert(X + step, Z + step, b);
    return hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
  };
  const padAt = (x: number, z: number) => pads.reduce((h, b) => (Math.hypot(x - b.x, z - b.z) < b.r ? Math.max(h, drawn(x, z, b)) : h), -60);

  const ground = new THREE.MeshStandardMaterial({ color: d.tint, roughness: d.rough, metalness: d.metal });
  const rockM = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.tint).multiplyScalar(.82), roughness: Math.min(1, d.rough + .1), metalness: d.metal * .6, flatShading: false });
  void Promise.all([loadTexture(d.tex, 'diff', '1k'), loadTexture(d.tex, 'nor', '1k')]).then(([a, n]) => {
    for (const t of [a, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(d.repeat, d.repeat); t.anisotropy = 8; }
    a.colorSpace = THREE.SRGBColorSpace;
    for (const m of [ground, rockM]) { m.map = a; m.normalMap = n; m.normalScale.set(1.2, 1.2); m.needsUpdate = true; }
  }).catch(() => undefined);

  const rockGeo = (seed: number) => {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + .32 * noise.fbm(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3, 3)); p.setXYZ(i, v.x, v.y, v.z); }
    const f = g.toNonIndexed(); f.computeVertexNormals(); return f;
  };
  for (const b of pads) {
    const { size, seg } = lattice(b);
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + b.x, z = p.getZ(i) + b.z;
      p.setXYZ(i, x, vert(x, z, b), z);
      uv.setXY(i, x / 12, z / 12);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, ground); m.receiveShadow = true; m.castShadow = true; scene.add(m);
    // stones and loose blocks on top: the eye reads scale from them
    const rg = rockGeo(b.x);
    const n = Math.round(b.r * 2.2), rocks = new THREE.InstancedMesh(rg, rockM, n);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, rr = (.35 + .6 * Math.sqrt(rnd())) * b.r, x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr, sc = .15 + rnd() * rnd() * .9;
      t.set(x, surf(x, z, b) + sc * .25, z); q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)); s.set(sc * (1 + rnd() * .6), sc * (.5 + rnd() * .5), sc * (1 + rnd() * .6));
      rocks.setMatrixAt(i, M.compose(t, q, s));
    }
    rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);
  }
  // everything else out there: the ring, the belt, the rest of the ship
  { const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    const bg = rockGeo(3);
    const belt = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: d.debris.color, roughness: .9, metalness: d.metal * .3, flatShading: true }), d.debris.n);
    for (let i = 0; i < d.debris.n; i++) { const a = rnd() * 6.283, r = d.debris.near + Math.pow(rnd(), .7) * (d.debris.far - d.debris.near), sc = .3 + rnd() * rnd() * d.debris.size; t.set(Math.cos(a) * r, (rnd() - .5) * r * .12 - 6, Math.sin(a) * r * .7); q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)); s.set(sc, sc * (.6 + rnd() * .5), sc * (.8 + rnd() * .4)); belt.setMatrixAt(i, M.compose(t, q, s)); }
    scene.add(belt); }
  if (d.lakes) {
    const lake = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: 0x1a0e06, roughness: .06, metalness: .2 }));
    lake.rotation.x = -Math.PI / 2; lake.position.y = d.lakes; lake.receiveShadow = true; scene.add(lake);
  }
  if (d.body) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(d.body.r, 64, 40), new THREE.MeshStandardMaterial({ color: d.body.color, roughness: .9 })); b.position.set(...d.body.at); scene.add(b);
    if (d.body.ring) { const r = new THREE.Mesh(new THREE.RingGeometry(d.body.r * 1.3, d.body.r * d.body.ring, 128, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(d.body.color).lerp(new THREE.Color(0xffffff), .45), transparent: true, opacity: .22, side: THREE.DoubleSide, fog: false, depthWrite: false })); r.position.copy(b.position); r.lookAt(0, 0, 0); r.rotateX(1.42); scene.add(r); }
  }
  { const n = 4000, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize().multiplyScalar(3000); p.set([v.x, v.y, v.z], i * 3); const w = .5 + rnd() * .5; c.set([w, w * (.9 + rnd() * .1), w * (.85 + rnd() * .2)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: d.fog ? .15 : 1 }))); }

  // light: a hard sun that throws shadows around wherever you are, and very little else
  const sun = new THREE.DirectionalLight(d.sun, d.sunI); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 140 }); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
  scene.add(sun, sun.target, new THREE.HemisphereLight(d.sun, d.ambientG, d.ambient));
  const sunDir = new THREE.Vector3(.55, .62, .4).normalize();

  // a job on a later visit: the work is in new places each time
  const spots: [number, number][] = job ? d.gather.spots.map((_, i) => { const r2 = mulberry32(job * 31 + i * 7); const b = pads[1 + ((i + job) % (pads.length - 1))] ?? pads[0]; const a = r2() * 6.283, rr = r2() * b.r * .7; return [b.x + Math.cos(a) * rr, b.z + Math.sin(a) * rr]; }) : d.gather.spots;
  const bits = spots.map(([x, z]) => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(.42), new THREE.MeshStandardMaterial({ color: d.gather.color, emissive: d.gather.color, emissiveIntensity: .55, roughness: .25 })); m.position.set(x, padAt(x, z) + .7, z); m.castShadow = true; scene.add(m); return m; });
  const tasks: AwayTask[] = [];
  if (d.first && !job) tasks.push({ id: d.first.id, pos: new THREE.Vector3(d.first.at[0], padAt(d.first.at[0], d.first.at[1]), d.first.at[1]), radius: 3, label: label(`away.${name}.${d.first.id}`) });
  d.props?.(scene, padAt);
  const gatherIds = bits.map((_, i) => `${d.gather.id}${i}`);
  bits.forEach((m, i) => tasks.push({ id: gatherIds[i], pos: m.position.clone(), radius: 2.2, label: label(`away.${name}.${d.gather.id}`), need: d.first && !job ? [d.first.id] : undefined, run: () => { m.visible = false; } }));
  d.steps.forEach((k, i) => tasks.push({ id: k.id, pos: new THREE.Vector3(k.at[0], padAt(k.at[0], k.at[1]), k.at[1]), radius: 3, label: label(`away.${name}.${k.id}`), need: k.need ?? (i === 0 ? gatherIds : [d.steps[i - 1].id]) }));

  // the trait, in play
  let body: StageBody | null = null;
  const puffs: { m: THREE.Mesh; t: number }[] = [];
  const puffM = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: .35, depthWrite: false });
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), puffM.clone()); m.visible = false; scene.add(m); puffs.push({ m, t: 9 }); }
  let nextPuff = 0;
  const head = new THREE.Vector3();

  return {
    scene, gravity: d.gravity, jump: d.jump, spawn: new THREE.Vector3(pads[0].x, 0, pads[0].z + 2), tasks,
    height: padAt, collide() { /* the height function is the only wall */ },
    bind(b) { body = b; },
    update(dt, time) {
      bits.forEach((m, i) => { m.rotation.y = time * .7 + i; });
      const at = body?.root.position ?? new THREE.Vector3();
      // light that follows: the shadow box stays on the player
      let dir = sunDir, lit = 1;
      if (d.sunSwing) { const a = time / d.sunSwing * Math.PI * 2; dir = new THREE.Vector3(Math.cos(a), .35 + .3 * Math.sin(a * .5), Math.sin(a)).normalize(); lit = THREE.MathUtils.smoothstep(Math.sin(a) + .15, -.05, .35); }
      sun.intensity = d.sunI * lit; sun.position.copy(at).addScaledVector(dir, 60); sun.target.position.copy(at); sun.target.updateMatrixWorld();
      if (!body) return;
      if (d.trait === 'lichen') { body.glow(.25 + 1.4 * lit); body.slow(.45 + .55 * lit); }  // dormant in the dark, quick in the light
      else if (d.trait === 'plates') body.glow(.6 + .5 * Math.max(0, Math.sin(time * 1.3)));    // plates sealing on each held breath
      else if (d.trait === 'ember') body.glow(1.1 + .35 * Math.sin(time * 3.1) * Math.sin(time * 1.7));
      else if (d.trait === 'frost') {
        // breath that freezes as it leaves her
        body.root.getWorldPosition(head); head.y += 1.6;
        if (time > nextPuff) { nextPuff = time + 2.6; const p = puffs.find((x) => x.t > 1.6); if (p) { p.t = 0; p.m.position.copy(head); p.m.visible = true; } }
      }
      for (const p of puffs) { if (p.t > 1.6) { p.m.visible = false; continue; } p.t += dt; p.m.position.y += dt * .25; p.m.scale.setScalar(1 + p.t * 2.2); (p.m.material as THREE.MeshBasicMaterial).opacity = .35 * (1 - p.t / 1.6); }
    },
  };
}

const P = (...a: [number, number, number, number][]) => a;
export const STAGES: Record<string, StageDef> = {
  // Skyvra: the giant's ring, a river of ice; the giant fills half the sky
  ring: { sky: 0x02030a, gravity: 3.4, jump: 3.6, tex: 'ice', tint: 0xdcecf8, rough: .35, metal: 0, repeat: 1, relief: .7, scale: 9, sun: 0xfff1dc, sunI: 3.6, ambient: .35, ambientG: 0x1c2a40,
    pads: P([0, 0, 10, 0], [15, -6, 6, 1.2], [26, 5, 5.5, 3], [38, 1, 6.5, 4.5], [-13, 9, 5.5, -.6], [-23, -3, 5.5, 1.4]), debris: { n: 900, color: 0xbcd0e2, near: 60, far: 700, size: 9 },
    body: { color: 0xc89a6a, r: 900, at: [-1500, 260, -1400], ring: 2.1 }, trait: 'frost', first: { id: 'splint', at: [1.5, 1.5] },
    props(scene, h) {
      // pod 2, wedged in the ice, and the dish she rigs from it
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1.8, 8, 18), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: .45, metalness: .35 }));
      pod.rotation.z = 1.2; pod.position.set(-3, h(-3, -3.5) + .7, -3.5); pod.castShadow = pod.receiveShadow = true; scene.add(pod);
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: .9, transparent: true, opacity: .55, depthWrite: false })); scorch.rotation.x = -Math.PI / 2; scorch.position.set(-3, h(-3, -3.5) + .03, -3.5); scene.add(scorch);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(.9, 24, 12, 0, 6.283, 0, 1.1), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: .75, roughness: .3, side: THREE.DoubleSide }));
      dish.position.set(38, h(38, 1) + 1.1, 1); dish.rotation.x = -.7; dish.castShadow = true; scene.add(dish);
    },
    gather: { id: 'ice', color: 0xa6e4ff, spots: [[6, 4], [15, -6], [-13, 9]] }, steps: [{ id: 'cracker', at: [-3, -3.5] }, { id: 'dish', at: [38, 1] }] },
  // Bolzar: a rubble pile, airless, barely holding itself together
  scree: { sky: 0x03040a, gravity: 1.6, jump: 2.6, tex: 'regolith', tint: 0x8a847a, rough: .95, metal: 0, repeat: 1, relief: 1.4, scale: 6, sun: 0xfff2e0, sunI: 4.2, ambient: .12, ambientG: 0x0a0a10,
    pads: P([0, 0, 10, 0], [16, 5, 6, 1.4], [27, -3, 6, 3], [-15, -6, 6.5, .6]), debris: { n: 700, color: 0x4a4640, near: 45, far: 480, size: 7 }, trait: 'plates',
    gather: { id: 'plate', color: 0xc8d4dc, spots: [[6, -3], [16, 5], [-15, -6]] }, steps: [{ id: 'weld', at: [27, -3] }] },
  // Lyrra: no ground at all, a piece of the ship turning slowly through light and dark
  wreck: { sky: 0x000208, gravity: .9, jump: 2, tex: 'hull', tint: 0xb4bcc4, rough: .5, metal: .35, repeat: 1, relief: .08, scale: 20, sun: 0xffffff, sunI: 5, ambient: .22, ambientG: 0x10141c, sunSwing: 40,
    pads: P([0, 0, 8, 0], [12, 2, 4.5, 0], [21, -2, 4.5, 0], [-12, 3, 4.5, 0]), debris: { n: 320, color: 0x7a8288, near: 24, far: 320, size: 4 }, trait: 'lichen',
    gather: { id: 'lichen', color: 0xb58cff, spots: [[3, 3], [12, 2], [-12, 3]] }, steps: [{ id: 'suture', at: [0, -3] }, { id: 'burst', at: [21, -2] }] },
  // Draxum: a methane moon: thick orange air, black lakes, the giant overhead
  moon: { sky: 0xa8642a, fog: .016, gravity: 2.4, jump: 3.4, tex: 'frozen', tint: 0x9a6a48, rough: .85, metal: 0, repeat: 1, relief: 1.1, scale: 11, sun: 0xffb060, sunI: 1.4, ambient: 1, ambientG: 0x3a1e10, lakes: -1.2,
    pads: P([0, 0, 13, 0], [21, 4, 7.5, 1.2], [-19, -5, 7.5, .8], [35, -4, 6.5, 2.8]), debris: { n: 260, color: 0x5a3e2c, near: 40, far: 260, size: 9 },
    body: { color: 0xd8a870, r: 900, at: [-500, 620, -1500] }, trait: 'ember',
    gather: { id: 'ice', color: 0xe8e0d0, spots: [[8, 5], [21, 4], [-19, -5]] }, steps: [{ id: 'break', at: [35, -4] }, { id: 'ember', at: [0, -6] }] },
  // Nuvexa: drifting in the one layer of a hot planet's clouds where the pressure is sane
  clouds: { sky: 0xd8b860, fog: .02, gravity: 3.2, jump: 4, tex: 'hull', tint: 0xe0d0a0, rough: .5, metal: .3, repeat: 1, relief: .05, scale: 20, sun: 0xfff0c8, sunI: 2, ambient: 1.1, ambientG: 0x8a6a30,
    pads: P([0, 0, 7, 0], [13, 2, 4, .8], [22, -3, 4, 1.8], [-12, 4, 4, .5]), debris: { n: 160, color: 0xe8d8a0, near: 30, far: 200, size: 6 }, trait: 'float',
    gather: { id: 'patch', color: 0xffd23c, spots: [[3, -3], [13, 2], [-12, 4]] }, steps: [{ id: 'relay', at: [22, -3] }] },
};
