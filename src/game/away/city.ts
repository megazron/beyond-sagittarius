import * as THREE from 'three';
import { createCharacter, Character, CrewId, CrewPose } from '../../characters/character';
import { LINEAGES, randomLook, PlayerLook, defaultLook } from '../../characters/custom';
import type { AwayStage, AwayTask } from './stage';
import type { StageBody } from './kit';

/**
 * Port Sahil, Taravel, 2189: the last normal afternoon. One long bazaar street from the flat (north) to the
 * spaceport gate (south). The player's list runs down it, and each step teaches one control.
 *
 * Ground is exact by construction: height changes only across the street (road, kerb ramp, pavement), and the
 * ground mesh has a vertex column at every one of those breakpoints, so the drawn surface is the walkable one.
 */

const N = 78, S = -78; // street ends (z)
/** Across the street: [x, height]. Linear between, the same on both sides. */
const PROFILE: [number, number][] = [[0, 0], [4, 0], [4.35, 0.14], [9.5, 0.14]];
const hx = (x: number) => {
  const a = Math.abs(x);
  for (let i = 1; i < PROFILE.length; i++) {
    const [x0, y0] = PROFILE[i - 1], [x1, y1] = PROFILE[i];
    if (a <= x1) return y0 + (y1 - y0) * (a - x0) / (x1 - x0);
  }
  return PROFILE[PROFILE.length - 1][1];
};

export interface CityPerson { id: string; fig: Character; pos: THREE.Vector3; yaw: number; pose: CrewPose; line?: string; phase: number }

const sign = (text: string, bg: string, fg: string, w = 512, h = 128) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg; g.font = `700 ${Math.round(h * 0.5)}px Rajdhani, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
};

/** Shops on the bazaar: name, side (-1 west, 1 east), z, sign colours. The names are parodies on purpose. */
export const SHOPS: { id: string; name: string; side: number; z: number; bg: string; fg: string }[] = [
  { id: 'capple', name: 'Capple Store', side: 1, z: 44, bg: '#f4f4f6', fg: '#202024' },
  { id: 'lamazon', name: 'Lamazon Orbit', side: -1, z: 30, bg: '#232f3e', fg: '#ff9900' },
  { id: 'chai', name: 'Chai Cosmos', side: 1, z: 14, bg: '#7a2e12', fg: '#ffd27a' },
  { id: 'biryani', name: 'Biryani Supernova', side: -1, z: 0, bg: '#1d6b3a', fg: '#fff3c4' },
  { id: 'dawai', name: 'Dawai Dome', side: 1, z: -16, bg: '#e8f6f2', fg: '#0d7a5f' },
  { id: 'mehndi', name: 'Pixel Mehndi', side: -1, z: -30, bg: '#5a1f6e', fg: '#ffb6e6' },
];

/** The player's list, top to bottom. `label` keys live in the i18n files under `city.task.*`. */
const TASKS: { id: string; x: number; z: number; r?: number; need?: string[] }[] = [
  { id: 'paratha', x: 3, z: 70 },
  { id: 'pack', x: -2, z: 66, need: ['paratha'] },
  { id: 'phone', x: 7.5, z: 44, need: ['pack'] },
  { id: 'parcel', x: -7.5, z: 30, need: ['phone'] },
  { id: 'chai', x: 7.5, z: 14, need: ['parcel'] },
  { id: 'tram', x: -6, z: -6, need: ['chai'] },
  { id: 'ring', x: 2.5, z: -46, r: 2.2, need: ['tram'] },
  { id: 'gate', x: 0, z: -74, r: 4, need: ['ring'] },
];

/** Where the five are, and what they're doing when you get there. */
const FRIENDS: { id: CrewId; x: number; z: number; yaw: number; pose: CrewPose }[] = [
  { id: 'strong', x: -6.5, z: 2.5, yaw: Math.PI / 2, pose: 'idle' },
  { id: 'medic', x: 7, z: -14, yaw: -Math.PI / 2, pose: 'argue' },
  { id: 'explorer', x: 6.5, z: 16.5, yaw: -Math.PI / 2, pose: 'write' },
  { id: 'builder', x: -6.8, z: -8, yaw: Math.PI / 2, pose: 'present' },
  { id: 'social', x: -1.5, z: -44, yaw: 0, pose: 'selfie' },
];

/** Townsfolk: where they stand and the one line they give you. `city.npc.*` in the i18n files. */
const FOLK: { id: string; x: number; z: number; yaw: number; pose: CrewPose; lineage: PlayerLook['lineage'] }[] = [
  { id: 'chaiwala', x: 8.6, z: 12, yaw: -Math.PI / 2, pose: 'idle', lineage: 'ortek' },
  { id: 'aunty', x: -7.8, z: -28, yaw: Math.PI / 2, pose: 'argue', lineage: 'sirelle' },
  { id: 'clerk', x: 8.6, z: 46, yaw: -Math.PI / 2, pose: 'present', lineage: 'vael' },
  { id: 'driver', x: 3, z: 22, yaw: 0, pose: 'idle', lineage: 'korrath' },
  { id: 'kid1', x: -1, z: -60, yaw: 0.4, pose: 'cheer', lineage: 'tarnkin' },
  { id: 'kid2', x: 2, z: -63, yaw: -2.6, pose: 'point', lineage: 'ulari' },
  { id: 'queue1', x: -6.5, z: 4.2, yaw: Math.PI / 2, pose: 'idle', lineage: 'tarnkin' },
  { id: 'queue2', x: -6.5, z: 5.9, yaw: Math.PI / 2, pose: 'write', lineage: 'vael' },
  { id: 'pharma', x: 8.6, z: -17, yaw: -Math.PI / 2, pose: 'facepalm', lineage: 'ulari' },
  { id: 'tourist', x: 5.5, z: -36, yaw: 2.2, pose: 'selfie', lineage: 'sirelle' },
];

export function buildCity(label: (k: string) => string, detail = 1): AwayStage & { bind(b: StageBody): void; people: CityPerson[] } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2c48e);
  scene.fog = new THREE.Fog(0xf0c290, 60, 190);

  // late afternoon: a low warm sun down the street, cool sky fill
  scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x8a6a4a, 0.9));
  const sun = new THREE.DirectionalLight(0xffd1a0, 2.6);
  sun.position.set(-30, 26, -40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 140 });
  sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);

  // ---- ground: columns at the profile's breakpoints, rows every 2 m ----
  const xs = [...new Set([-24, -18, -12, ...PROFILE.flatMap(([x]) => [x, -x]), 12, 18, 24])].sort((a, b) => a - b);
  const rows = Math.round((N - S + 8) / 2), z0 = S - 4;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rows; j++) for (const x of xs) { const z = z0 + j * 2; pos.push(x, hx(x), z); uv.push(x / 3, z / 3); }
  const W = xs.length;
  for (let j = 0; j < rows; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeVertexNormals();
  const paving = new THREE.MeshStandardMaterial({ color: 0xb9a68e, roughness: 0.92 });
  const ground = new THREE.Mesh(gg, paving); ground.receiveShadow = true; ground.userData.ground = true; scene.add(ground);
  // the road surface reads darker: a thin decal strip a hair above the same plane
  // the road reads darker: drawn on the same plane, pulled forward in depth instead of lifted, and not walkable itself
  const road = new THREE.Mesh(new THREE.PlaneGeometry(8, N - S + 8), new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, (N + S) / 2); road.receiveShadow = true; road.userData.ground = false; scene.add(road);

  // ---- buildings: blocks along both sides, shops where the list sends you ----
  const blocks: THREE.Box3[] = [];
  const wallTints = [0xe9d3b0, 0xd9b48c, 0xc98f6a, 0xf0e2c8, 0xb8c9c0, 0xe4b9a8];
  let k = 0;
  for (const side of [-1, 1]) {
    for (let z = N; z > S; ) {
      const len = 9 + ((k * 7) % 6), h = 7 + ((k * 5) % 9), depth = 10;
      const zc = z - len / 2, xc = side * (9.5 + depth / 2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(depth, h, len - 0.4), new THREE.MeshStandardMaterial({ color: wallTints[k % wallTints.length], roughness: 0.9 }));
      m.position.set(xc, h / 2, zc); m.castShadow = m.receiveShadow = true; scene.add(m);
      blocks.push(new THREE.Box3().setFromObject(m));
      // awnings over the pavement, every block a colour
      const aw = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, len - 1.2), new THREE.MeshStandardMaterial({ color: [0xc0392b, 0x16a085, 0xf39c12, 0x8e44ad][k % 4], roughness: 0.8 }));
      aw.position.set(side * 8.4, 3.1, zc); aw.rotation.z = side * 0.18; aw.castShadow = true; scene.add(aw);
      z -= len; k++;
    }
  }
  for (const s of SHOPS) {
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: sign(s.name, s.bg, s.fg), emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: null, roughness: 0.6 }));
    sg.position.set(s.side * 9.45, 4.3, s.z); sg.rotation.y = -s.side * Math.PI / 2; scene.add(sg);
  }
  // the north end: the flat's front steps; the south end: the spaceport gate and the liner beyond it
  const gate = new THREE.Mesh(new THREE.TorusGeometry(9, 0.6, 12, 48, Math.PI), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.6, roughness: 0.3 }));
  gate.position.set(0, 0, S + 2); scene.add(gate);
  const liner = new THREE.Mesh(new THREE.CapsuleGeometry(14, 60, 8, 24), new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 0.5, roughness: 0.35 }));
  liner.rotation.z = Math.PI / 2; liner.position.set(0, 26, S - 70); scene.add(liner);
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.7, 32), new THREE.MeshStandardMaterial({ color: 0xcfc4b4, roughness: 0.7 }));
  fountain.position.set(0, 0.35, -44); fountain.castShadow = true; scene.add(fountain);
  blocks.push(new THREE.Box3().setFromObject(fountain));
  // walls at both ends so nobody walks off the map
  blocks.push(new THREE.Box3(new THREE.Vector3(-30, -1, N + 4), new THREE.Vector3(30, 20, N + 10)), new THREE.Box3(new THREE.Vector3(-30, -1, S - 12), new THREE.Vector3(30, 20, S - 6)));

  // ---- people ----
  const d = detail;
  const people: CityPerson[] = [];
  const place = (id: string, fig: Character, x: number, z: number, yaw: number, pose: CrewPose, line?: string) => {
    fig.root.position.set(x, hx(x), z); fig.root.rotation.y = yaw;
    fig.setGround((px) => hx(px));
    scene.add(fig.root);
    people.push({ id, fig, pos: fig.root.position, yaw, pose, line, phase: Math.random() * 10 });
  };
  for (const f of FRIENDS) place(f.id, createCharacter(f.id, d), f.x, f.z, f.yaw, f.pose, `city.friend.${f.id}`);
  FOLK.forEach((f, i) => {
    const look = { ...randomLook({ name: '', gender: i % 2 ? 'f' : 'm' }), lineage: f.lineage, ...LINEAGES[f.lineage] } as PlayerLook;
    place(f.id, createCharacter('scientist', d * 0.8, { ...defaultLook(), ...look }), f.x, f.z, f.yaw, f.pose, `city.npc.${f.id}`);
  });

  const tasks: AwayTask[] = TASKS.map((x) => ({ id: x.id, pos: new THREE.Vector3(x.x, hx(x.x), x.z), radius: x.r ?? 1.8, label: label(`city.task.${x.id}`), need: x.need }));
  // townsfolk and friends answer whenever you like; they never count towards leaving
  for (const p of people) tasks.push({ id: `talk.${p.id}`, pos: p.pos, radius: 1.6, label: label('city.talk'), optional: true, repeat: true });

  return {
    scene, gravity: 22, jump: 6.2, spawn: new THREE.Vector3(0, 0, 72), tasks, people,
    height: (x) => hx(x),
    collide(p, r) {
      for (const b of blocks) {
        if (p.y > b.max.y || p.y + 1.8 < b.min.y) continue;
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x)), cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        const dx = p.x - cx, dz = p.z - cz, dd = Math.hypot(dx, dz);
        if (dd < r) {
          if (dd > 1e-6) { p.x = cx + dx / dd * r; p.z = cz + dz / dd * r; }
          else { // inside: out through the nearest face
            const o = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z], m = Math.min(...o);
            if (m === o[0]) p.x = b.min.x - r; else if (m === o[1]) p.x = b.max.x + r; else if (m === o[2]) p.z = b.min.z - r; else p.z = b.max.z + r;
          }
        }
      }
      for (const q of people) { const dx = p.x - q.pos.x, dz = p.z - q.pos.z, dd = Math.hypot(dx, dz); if (dd < r + 0.3 && dd > 1e-6) { p.x = q.pos.x + dx / dd * (r + 0.3); p.z = q.pos.z + dz / dd * (r + 0.3); } }
    },
    bind() { /* the city asks nothing of the body: no lineage tricks on the last normal day */ },
    update(dt, time) {
      for (const q of people) { q.phase += dt; q.fig.animate(q.pose, q.phase, 0, time, dt); }
    },
    dispose() { scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); } }); },
  };
}
