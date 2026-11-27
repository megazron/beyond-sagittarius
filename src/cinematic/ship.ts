import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createCharacter, Character, CrewId } from '../characters/character';
import { NOISE_GLSL } from '../core/glsl';
import { createPassage, PASSAGE, type Passage } from './passage';

/** Panel-line hull texture generated on a canvas. */
function hullTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9ced6'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const w = 20 + Math.random() * 120, h = 10 + Math.random() * 60;
    const v = 185 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
    g.fillRect(x, y, w, h);
  }
  g.strokeStyle = 'rgba(40,45,55,0.55)'; g.lineWidth = 1.5;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface Ship {
  group: THREE.Group;
  engineGlow: THREE.MeshBasicMaterial;
  plume: THREE.Mesh;
  ring: THREE.Group;
  lights: THREE.MeshBasicMaterial;
  pods: THREE.Group[];
  /** The hull in two torn halves, shown instead of `spine` when the ship breaks. */
  broken: { spine: THREE.Mesh; front: THREE.Mesh; rear: THREE.Mesh; hull: THREE.Material };
  /** The boarding hatch on the drive section (+y side): `open(k)` slides it round the hull, 0 shut, 1 open. */
  hatch: { panel: THREE.Mesh; open(k: number): void };
  /** Landing legs (only with `landed`): `deploy(k)`, 1 down (standing on them), 0 folded up against the drive. */
  legs: { group: THREE.Group; deploy(k: number): void } | null;
}

// (r, y) with y = 6 - z: nose at z 6, the drive's flare at z -4 to -5
const PROFILE = [[0, 0], [0.5, 0.2], [0.9, 1.2], [1.0, 3], [0.8, 4], [0.85, 6], [0.6, 7.5], [0.7, 9], [1.1, 10], [1.1, 11], [0.5, 11.6]];
/**
 * The liner's measurements in its own units (the films draw it at scale 1, Zenvora's pad at LINER_SCALE). Nose along
 * +z. The hatch is a hole in the hull on the +y side of the drive section with a lit vestibule behind it.
 */
export const LINER = {
  /** the hatch: its half-angle each side of +y (rad), its sill and lintel along z, the hull's radius there */
  doorHalf: Math.PI / 16, doorZ0: -4.95, doorZ1: -4.02, doorR: 1.1,
  /** the vestibule behind the hatch (x across, y in from the hull): the entry to hallY1, a hall across the ship from
   *  hallY1 down to hallY0 and out to +-hallX, then a dark passage each side out to +-passX (as far as hallY0..passY1) */
  vest: { hallY0: 0.35, hallY1: 0.8, hallX: 0.62, passX: 0.85, passY1: 0.65 },
  /** the soles of the landing legs when it stands on its tail */
  groundZ: -6.9,
  /** the habitat ring and the radiator wings */
  ringZ: 1.2, ringR: 3.2, ringTube: 0.32, wingZ: -2.6, wingX0: 1.15, wingX1: 5.65, wingHalfZ: 0.7, wingHalfY: 0.02,
  /** the engine bells: z of their mouths and their outer radius */
  bellZ0: -6.45, bellZ1: -5.55, bellR: 0.5, bellAt: 0.65,
  /** the hull's radius at z (the spine's lathe profile), 0 off its ends */
  radius(z: number) { const y = 6 - z, p = PROFILE; if (y <= p[0][1] || y >= p[p.length - 1][1]) return 0; for (let i = 1; i < p.length; i++) if (y <= p[i][1]) { const [r0, y0] = p[i - 1], [r1, y1] = p[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 0; },
};
/** Zenvora's liner on its pad is the films' ship at this size: a 35 m tourist liner, its hatch 2.8 m high. */
export const LINER_SCALE = 3;

/** Interstellar tourist liner: spine, habitat ring, observation dome, drive, boarding hatch. `landed`: on its legs. */
export function createShip(o: { landed?: boolean } = {}): Ship {
  const group = new THREE.Group();
  group.userData.design = 'liner'; // one ship everywhere: the films' and Zenvora's pad's are this same make (__bs.shipDesigns)
  const tex = hullTexture();
  tex.repeat.set(4, 2);
  const hull = new THREE.MeshStandardMaterial({ color: 0xe6e8ec, map: tex, metalness: 0.45, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272f, metalness: 0.8, roughness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a14a, metalness: 1, roughness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x2a5d8a, metalness: 0.2, roughness: 0.05, transmission: 0, emissive: 0x2a77aa, emissiveIntensity: 0.6 });
  // (cells, not a mirror: at 0.9 metal and 0.2 rough they showed the sky, white over a city and dark in space)
  const solar = new THREE.MeshStandardMaterial({ color: 0x0f2350, metalness: 0.5, roughness: 0.45, emissive: 0x050a20 });

  // Spine (lathe profile), nose along +Z
  const prof = PROFILE;
  // the same profile with two more rings at the hatch's sill and lintel, and the hatch's three segments left out of
  // the hull: a real opening (the vestibule is behind it), so whoever walks in goes through a door, not a wall
  const D = LINER, SEG = 48, pts: THREE.Vector2[] = [];
  for (const [r, y] of prof) { if (y === 11) pts.push(new THREE.Vector2(D.doorR, 6 - D.doorZ1), new THREE.Vector2(D.doorR, 6 - D.doorZ0)); pts.push(new THREE.Vector2(r, y)); }
  const spineGeo = new THREE.LatheGeometry(pts, SEG, -D.doorHalf);
  {
    const idx = spineGeo.getIndex()!, keep: number[] = [], P = pts.length, jDoor = pts.findIndex((v) => Math.abs(v.y - (6 - D.doorZ1)) < 1e-6), nDoor = Math.round(2 * D.doorHalf / (Math.PI * 2 / SEG));
    for (let i = 0; i < SEG; i++) for (let j = 0; j < P - 1; j++) { if (j === jDoor && i < nDoor) continue; const q = (i * (P - 1) + j) * 6; for (let k = 0; k < 6; k++) keep.push(idx.getX(q + k)); }
    spineGeo.setIndex(keep);
  }
  spineGeo.rotateX(-Math.PI / 2);
  spineGeo.translate(0, 0, 6);
  const spine = new THREE.Mesh(spineGeo, hull);
  group.add(spine);

  // the same hull torn across the middle: the free ends of the lathe get a ragged edge
  const half = (from: number, to: number, tornEnd: 'start' | 'end') => {
    const pr = prof.slice(from, to).map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pr, 48);
    const n = pr.length, pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= 48; i++) {
      const j = i % 48, v = i * n + (tornEnd === 'end' ? n - 1 : 0);
      const tear = (Math.sin(j * 1.7) * 0.5 + Math.sin(j * 4.1 + 1) * 0.32 + Math.sin(j * 9.3) * 0.18) * 0.55;
      pos.setY(v, pos.getY(v) + tear);
    }
    g.computeVertexNormals(); g.rotateX(-Math.PI / 2); g.translate(0, 0, 6);
    const m = new THREE.Mesh(g, brokenHull);
    m.visible = false; group.add(m);
    return m;
  };
  const brokenHull = hull.clone(); brokenHull.side = THREE.DoubleSide;
  const broken = { spine, front: half(0, 6, 'end'), rear: half(5, prof.length, 'start'), hull: brokenHull };

  // Bridge observation dome near the nose
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.position.set(0, 0.55, 4.2); dome.scale.set(1, 0.6, 1.4);
  group.add(dome);

  // Habitat ring with spokes
  const ring = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.32, 16, 96), hull);
  ring.add(torus);
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.0) });
  const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.06, 0.02), winMat, 96);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    m.makeRotationZ(a).setPosition(Math.cos(a) * 3.53, Math.sin(a) * 3.53, 0);
    m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    wins.setMatrixAt(i, m);
  }
  ring.add(wins);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6.4, 8), dark);
    spoke.rotation.z = (i / 4) * Math.PI; ring.add(spoke);
  }
  ring.position.z = 1.2;
  group.add(ring);

  // Solar / radiator wings
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.04, 1.4), solar);
    wing.position.set(s * 3.4, 0, -2.6); group.add(wing);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), dark);
    arm.rotation.z = Math.PI / 2; arm.position.set(s * 1.1, 0, -2.6); group.add(arm);
  }
  // Cargo / pod bays
  const pods: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bay = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.2, 12), gold);
    bay.rotation.x = Math.PI / 2;
    bay.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, -0.5);
    group.add(bay);
    const pod = new THREE.Group();
    const pb = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 12), hull);
    pb.rotation.x = Math.PI / 2; pod.add(pb);
    const pg = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, 0.4) }));
    pg.position.z = -0.4; pod.add(pg);
    pod.position.copy(bay.position); pod.visible = false;
    pod.userData.dir = new THREE.Vector3(Math.cos(a), Math.sin(a), -0.6).normalize();
    group.add(pod); pods.push(pod);
  }

  // Drive section
  const engineGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 4.0) });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 0.9, 20, 1, true), dark);
    bell.material.side = THREE.DoubleSide;
    bell.rotation.x = Math.PI / 2;
    bell.position.set(Math.cos(a) * 0.65, Math.sin(a) * 0.65, -6.0);
    group.add(bell);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), engineGlow);
    core.rotation.y = Math.PI; core.position.set(bell.position.x, bell.position.y, -6.2);
    group.add(core);
  }
  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 9, 24, 1, true),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); vec4 p = modelViewMatrix*vec4(position,1.0); vV = normalize(-p.xyz); gl_Position = projectionMatrix*p; }`,
      fragmentShader: `uniform float uTime, uPower; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float a = pow(vUv.y, 2.5) * uPower; float f = 0.8 + 0.2*sin(vUv.y*40.0 - uTime*30.0);
          // gas has no edge: thin to nothing at the silhouette of the cone
          float soft = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          gl_FragColor = vec4(vec3(0.35, 0.65, 1.6) * a * f * soft, 1.0); }`,
    }),
  );
  plume.rotation.x = Math.PI / 2;
  plume.position.z = -10.6;
  group.add(plume);

  // Running lights
  const lights = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) });
  for (const p of [[2.2, 0, -2.6], [-2.2, 0, -2.6], [0, 1.1, 0], [0, -1.1, -4]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lights);
    l.position.set(p[0], p[1], p[2]); group.add(l);
  }
  // Name band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.25, 32, 1, true), gold);
  band.rotation.x = Math.PI / 2; band.position.z = 3;
  group.add(band);

  // ---- the boarding hatch: the panel that fills the opening, slid round the hull to open; a frame; a lamp over it ----
  const hatchFrom = group.children.length;
  const dz = D.doorZ1 - D.doorZ0, zc = (D.doorZ0 + D.doorZ1) / 2;
  const arc = (r: number, h: number, half: number, z: number, mat: THREE.Material, segs = 6) => {
    const g = new THREE.CylinderGeometry(r, r, h, segs, 1, true, -half, half * 2); g.rotateX(-Math.PI / 2); g.translate(0, 0, z);
    const m = new THREE.Mesh(g, mat); group.add(m); return m;
  };
  const panel = arc(D.doorR + 0.004, dz, D.doorHalf, zc, hull);
  for (const z of [D.doorZ0, D.doorZ1]) arc(D.doorR + 0.012, 0.03, D.doorHalf + 0.012, z, dark, 8);
  for (const sx of [-1, 1]) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, dz + 0.03), dark);
    j.position.set(sx * Math.sin(D.doorHalf + 0.012) * (D.doorR + 0.012), Math.cos(D.doorHalf + 0.012) * (D.doorR + 0.012), zc); group.add(j);
  }
  // the vestibule behind the opening, warm and lit: a short entry, then a hall across the ship with a dark passage at
  // each end, all inside the hull (seen from outside only through the hatch). Whoever boards walks in, turns along the
  // hall and is gone round the corner, behind the hull, never through a wall.
  const vest = vestibule(D);
  group.add(vest);
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 0.9) });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), lampM); lamp.position.set(0, D.doorR + 0.02, D.doorZ1 + 0.06); group.add(lamp);
  const hatch = {
    panel,
    /** 0 shut, 1 open: the panel slides round the hull to one side; the lamp is green while it is open */
    open(k: number) { panel.rotation.z = -Math.min(1, Math.max(0, k)) * (D.doorHalf * 2 + 0.03); lampM.color.setRGB(k > 0.02 ? 0.4 : 2.6, k > 0.02 ? 2.6 : 1.2, k > 0.02 ? 0.9 : 0.2); },
  };
  hatch.open(0);
  // the hatch's parts (panel, frame, jambs, the vestibule, the lamp): the films' break-up hides them, the torn halves
  // have no door in them and the vestibule stood out of the gap as a long dark slab (owner, the pull's break-up)
  for (const c of group.children.slice(hatchFrom)) c.userData.hatchPart = true;

  // ---- landing legs: four struts from the drive section out to pads on the ground, between the hatch and the wings ----
  let legs: Ship['legs'] = null;
  if (o.landed) {
    const lg = new THREE.Group(); lg.userData.landing = true; group.add(lg);
    const hinges: THREE.Group[] = [], az = -4.6, ar = 0.95, footR = 2.0, dr = footR - ar, dzl = D.groundZ + 0.05 - az, L = Math.hypot(dr, dzl), down = Math.atan2(dzl, dr);
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const pivot = new THREE.Group(); pivot.position.set(Math.sin(a) * ar, Math.cos(a) * ar, az); pivot.rotation.z = -a; lg.add(pivot);
      const hinge = new THREE.Group(); pivot.add(hinge); hinges.push(hinge);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, L, 10).translate(0, L / 2, 0), dark); hinge.add(strut);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 16), dark); foot.position.set(0, L, 0); foot.rotation.x = -down; hinge.add(foot);
    }
    legs = { group: lg, deploy(k: number) { const c = Math.min(1, Math.max(0, k)); for (const h of hinges) h.rotation.x = down + (1 - c) * (Math.PI / 2 - 0.12 - down); } };
    legs.deploy(1);
  }

  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  vest.traverse((o) => { o.castShadow = false; }); lamp.castShadow = false;
  return { group, engineGlow, plume, ring, lights, pods, broken, hatch, legs };
}

export interface Interior {
  group: THREE.Group;
  crew: Character[];
  floaters: THREE.Mesh[];
  alarmLight: THREE.PointLight;
  holo: THREE.ShaderMaterial;
  consoleLight: THREE.PointLight;
  mainLight: THREE.PointLight;
  /** Earth's light through the window while the liner is docked (0 once it has left). */
  earthLight: THREE.PointLight;
  /** The lounge's ceiling strips, warm: the room's own light. */
  stripLight: THREE.PointLight;
  /** The mission text on the console's display (null hides it). */
  display(lines: string[] | null): void;
  /** Where each of the six sits or stands in the lounge for the departure (deck units, root on the floor). */
  seats: Record<string, { x: number; z: number; yaw: number }>;
  /** The passenger lounge's furniture (sofas, table, bag, runner): the deck is one room through the whole opening, so it
   *  stays in every shot of it (the owner: the sofas vanished between the departure and the pull). */
  lounge: THREE.Group;
  /** Floor footprints nobody may stand in (deck units, centre, turn, width along x, depth along z before the turn). */
  footprints: { name: string; x: number; z: number; yaw: number; w: number; d: number }[];
  /** The way aft: the hatch in the aft bulkhead, the passage behind it and the pod bay at its end (passage.ts). */
  passage: Passage;
  /** The navigation core, in its socket at the console's end (the pull: an arm's length from Zenvik at the call). */
  core: THREE.Group;
}

/** The lounge's furniture, in deck units: two low sofas either side of the console, backs to the window. */
const SOFA = { w: 1.9, d: 0.78, seat: 0.44, back: 0.86 } as const;
const SOFAS = [{ x: -2.35, z: -0.55, yaw: 0.5 }, { x: 2.35, z: -0.55, yaw: -0.5 }] as const;
/** A point on a sofa's seat: along its width (-1 one arm .. 1 the other) and out from the back cushion. */
export function onSofa(i: 0 | 1, along: number, out = 0.12) {
  const s = SOFAS[i], c = Math.cos(s.yaw), n = Math.sin(s.yaw), lx = along * (SOFA.w / 2 - 0.35), lz = out;
  return { x: s.x + lx * c + lz * n, z: s.z - lx * n + lz * c, yaw: s.yaw };
}

/** Observation deck with a panoramic window, a holo console and the crew. */
export function createInterior(detail = 1): Interior {
  const group = new THREE.Group();
  const tex = hullTexture(); tex.repeat.set(6, 2);
  const wall = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, map: tex, metalness: 0.5, roughness: 0.45, side: THREE.BackSide });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x30353f, metalness: 0.6, roughness: 0.5 });
  const trim = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.0) });

  // Curved shell with a gap on the -Z side acting as a panoramic window
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 12, 64, 1, true, Math.PI * 1.3, Math.PI * 1.4), wall);
  shell.rotation.z = Math.PI / 2;
  group.add(shell);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.2;
  group.add(floor);
  for (const z of [-2.4, 2.4]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(12, 0.03, 0.05), trim);
    strip.position.set(0, -2.15, z); group.add(strip);
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1f26, metalness: 0.8, roughness: 0.3 });
  for (let i = -5; i <= 5; i += 2.5) {
    const rg = new THREE.TorusGeometry(3.95, 0.08, 6, 48, Math.PI * 1.05);
    rg.rotateZ(Math.PI * 0.3); rg.rotateY(Math.PI / 2);
    const rib = new THREE.Mesh(rg, frameMat);
    rib.position.x = i; group.add(rib);
  }

  // Console + hologram
  const consoleMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.9), frameMat);
  consoleMesh.position.set(0, -1.75, -1.4);
  group.add(consoleMesh);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.16, 0.26) }));
  screen.rotation.x = -Math.PI / 3; screen.position.set(0, -1.28, -1.25);
  group.add(screen);
  const holo = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSpike: { value: 0 }, uAlarm: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSpike, uAlarm; varying vec2 vUv;
      ${NOISE_GLSL}
      void main(){
        vec2 uv = vUv;
        float grid = (step(0.97, fract(uv.x * 20.0)) + step(0.95, fract(uv.y * 8.0))) * 0.15;
        float x = uv.x * 12.0;
        float wave = 0.5 + 0.08 * sin(x * 3.0 + uTime * 4.0) + 0.04 * sin(x * 7.3 - uTime * 6.0);
        float sp = uSpike * exp(-pow((uv.x - 0.68) * 9.0, 2.0)) * 0.42 * (0.9 + 0.1 * sin(uTime * 20.0));
        wave += sp;
        float line = smoothstep(0.02, 0.0, abs(uv.y - wave));
        vec3 c = mix(vec3(0.2, 0.9, 1.4), vec3(2.0, 0.3, 0.2), clamp(uSpike * 0.8 + uAlarm, 0.0, 1.0));
        float scan = 0.7 + 0.3 * sin(uv.y * 200.0 + uTime * 10.0);
        float a = (line * 2.0 + grid) * scan;
        float edge = smoothstep(0.0, 0.03, uv.x) * smoothstep(1.0, 0.97, uv.x) * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
        gl_FragColor = vec4(c * a * edge + c * 0.04 * edge, 1.0);
      }`,
  });
  const holoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.1), holo);
  holoMesh.position.set(0, -0.55, -1.45);
  group.add(holoMesh);

  // Crew of six, distinct suit accents
  const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
  const crew: Character[] = [];
  const spots: [number, number, number][] = [[0.2, 0.55, 0], [-1.6, 0.3, 0.6], [1.8, -0.4, 0.4], [-3.2, 1.6, -0.2], [3.4, 1.2, -0.6], [-0.9, 1.9, 0.3]];
  for (let i = 0; i < 6; i++) {
    const a = createCharacter(ids[i], detail);
    const [x, z, ry] = spots[i];
    a.root.position.set(x, -2.2, z);
    a.root.rotation.y = Math.PI + ry;
    group.add(a.root);
    crew.push(a);
  }

  // Loose objects that float when gravity fails
  const floaters: THREE.Mesh[] = [];
  const fMats = [new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.5 }), frameMat];
  const fGeos = [new THREE.BoxGeometry(0.16, 0.02, 0.11), new THREE.CylinderGeometry(0.03, 0.03, 0.09, 10), new THREE.BoxGeometry(0.07, 0.03, 0.05), new THREE.SphereGeometry(0.035, 8, 6)];
  // where each one rests (x, z, the surface's height): the table, the console's top, the sofas' middles, the floor along
  // the window and at the ends, clear of the furniture and of everyone's marks. They were thrown at random over the
  // whole floor, up to 25 cm in the air, some inside the sofas (the continuity check found them)
  const REST: [number, number, number][] = [
    [0.62, 0.88, -1.755], [1.32, 0.6, -1.755], [0.95, 0.58, -1.755], // the table (the two cups are at 0.75/0.68 and 1.12/0.85)
    [-0.9, -1.62, -1.3], [0.9, -1.15, -1.3], [0.55, -1.72, -1.3], // the console's top
    [onSofa(0, 0.0, 0.15).x, onSofa(0, 0.0, 0.15).z, -1.76], [onSofa(1, 0.05, 0.15).x, onSofa(1, 0.05, 0.15).z, -1.76], // the sofas' middles
    [-4.6, -2.75, -2.2], [-3.3, -2.8, -2.2], [-2.0, -2.75, -2.2], [-0.4, -2.8, -2.2], [0.9, -2.75, -2.2], // along the window
    [-5.2, 1.7, -2.2], [-5.25, -0.9, -2.2], [5.2, -1.6, -2.2], [-0.95, 1.3, -2.2], [-0.15, 1.25, -2.2], // the ends, by the bag
  ];
  const HALF = [0.01, 0.045, 0.015, 0.035]; // each shape's half height, so it sits on the surface
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; // the same every run
  REST.forEach(([x, z, y], i) => {
    const f = new THREE.Mesh(fGeos[i % 4], fMats[i % 3]);
    f.position.set(x, y + HALF[i % 4], z); f.rotation.y = rnd() * Math.PI;
    f.userData.base = f.position.clone();
    f.userData.onFloor = y < -2.1; // only what is on the floor slides when the deck tilts
    f.userData.spin = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2);
    f.userData.rise = 0.3 + rnd() * 0.6;
    f.castShadow = true; f.name = `loose${i}`;
    group.add(f); floaters.push(f);
  });

  // ---- the lounge: sofas, a low table, a bag, end bulkheads with the hatch aft, ceiling strips, a runner ----
  const fabric = new THREE.MeshStandardMaterial({ color: 0x7d7268, roughness: 0.92 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x9a8c7e, roughness: 0.95 });
  const base = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.45 });
  const rb = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const lounge = new THREE.Group(); lounge.name = 'lounge'; group.add(lounge);
  let pn = 0; const put = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, m); o.name = `lounge${pn++}`; o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  for (const s of SOFAS) {
    const so = new THREE.Group(); so.position.set(s.x, -2.2, s.z); so.rotation.y = s.yaw; lounge.add(so);
    put(rb(SOFA.w, 0.08, SOFA.d - 0.04, 0.02), base, so, 0, 0.04, 0);
    put(rb(SOFA.w - 0.26, 0.14, SOFA.d - 0.22, 0.06), cushion, so, 0, SOFA.seat - 0.07, 0.05);
    put(rb(SOFA.w, 0.3, SOFA.d, 0.05), fabric, so, 0, 0.23, 0);
    put(rb(SOFA.w, SOFA.back - 0.32, 0.2, 0.07), fabric, so, 0, 0.32 + (SOFA.back - 0.32) / 2, -SOFA.d / 2 + 0.1);
    for (const sx of [-1, 1]) put(rb(0.14, 0.62, SOFA.d, 0.05), fabric, so, sx * (SOFA.w / 2 - 0.07), 0.31, 0);
  }
  // a low table with two cups, and Skyvra's bag open on the floor beside it
  put(rb(0.9, 0.05, 0.5, 0.02), new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.35, metalness: 0.1 }), lounge, 0.95, -1.78, 0.75);
  put(new THREE.CylinderGeometry(0.05, 0.05, 0.37, 12), base, lounge, 0.95, -2.0, 0.75);
  put(new THREE.CylinderGeometry(0.04, 0.034, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0xb5563a, roughness: 0.7 }), lounge, 0.75, -1.71, 0.68);
  put(new THREE.CylinderGeometry(0.04, 0.034, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0x3d7f8f, roughness: 0.7 }), lounge, 1.12, -1.71, 0.85);
  const bagM = new THREE.MeshStandardMaterial({ color: 0x41546b, roughness: 0.85 });
  put(rb(0.62, 0.3, 0.38, 0.08), bagM, lounge, -0.6, -2.05, 0.85).rotation.y = 0.4;
  put(rb(0.6, 0.03, 0.36, 0.015), bagM, lounge, -0.53, -1.86, 1.07).rotation.set(-1.1, 0.4, 0);
  put(rb(0.3, 0.05, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.9 }), lounge, -0.57, -1.88, 0.8).rotation.y = 0.9; // a jumper on top
  // a runner down the middle of the floor
  put(new THREE.PlaneGeometry(9, 1.5), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.97 }), lounge, 0, -2.195, 0.9).rotation.x = -Math.PI / 2;
  // end bulkheads close the shell; aft (+x) has the hatch to the passage to the habitat ring, its frame lit
  const bulk = new THREE.MeshStandardMaterial({ color: 0x8a929d, metalness: 0.45, roughness: 0.5 });
  // (the aft one is cut through for the hatch: the passage to the pods is really behind it, and its door really slides)
  bulk.side = THREE.DoubleSide;
  for (const ex of [-5.95, 5.95]) {
    const sh = new THREE.Shape(); sh.absarc(0, 0, 4, 0, Math.PI * 2, false);
    if (ex > 0) { const P = PASSAGE, h = new THREE.Path(), z0 = P.doorZ - P.doorW / 2, z1 = P.doorZ + P.doorW / 2; h.moveTo(z0, P.floor); h.lineTo(z1, P.floor); h.lineTo(z1, P.doorTop); h.lineTo(z0, P.doorTop); h.closePath(); sh.holes.push(h); }
    const w = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), bulk); w.position.x = ex; w.rotation.y = ex < 0 ? Math.PI / 2 : -Math.PI / 2; w.receiveShadow = true; group.add(w);
  }
  const hatchF = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.8) });
  const passage = createPassage(frameMat); group.add(passage.group);
  // the navigation core: a short cylinder with a lit band, in its socket at the console's right end
  const core = new THREE.Group(); core.name = 'core';
  core.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.8, roughness: 0.3 })));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.053, 0.035, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 2.6) })); core.add(band);
  core.position.set(1.02, -1.22, -1.2); group.add(core);
  for (const [y, h, z, d] of [[-0.07, 0.05, 0.9, 1.22], [-1.15, 2.18, 0.31, 0.05], [-1.15, 2.18, 1.49, 0.05]] as const) put(new THREE.BoxGeometry(0.03, h, d), hatchF, group, 5.88, y, z);
  // warm ceiling strips along the room (stripLight is the light they give)
  const stripM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.3) });
  for (const z of [-0.6, 1.6]) { const st = new THREE.Mesh(new THREE.BoxGeometry(10, 0.03, 0.12), stripM); st.position.set(0, Math.sqrt(16 - z * z) - 0.14, z); group.add(st); }

  // the mission text on the console's display: a canvas over the holo, drawn when it is shown (the language may change)
  const dc = document.createElement('canvas'); dc.width = 1024; dc.height = 512;
  const dTex = new THREE.CanvasTexture(dc); dTex.colorSpace = THREE.SRGBColorSpace;
  const dMat = new THREE.MeshBasicMaterial({ map: dTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const dMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), dMat); dMesh.position.set(0, -0.55, -1.43); dMesh.visible = false; group.add(dMesh);
  const FONT = (px: number) => `700 ${px}px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif`;
  const display = (lines: string[] | null) => {
    dMesh.visible = !!lines;
    if (!lines) return;
    const g = dc.getContext('2d')!; g.clearRect(0, 0, 1024, 512);
    g.strokeStyle = 'rgba(120,220,255,0.6)'; g.lineWidth = 3; g.strokeRect(24, 24, 976, 464);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      let px = 46; g.font = FONT(px);
      while (g.measureText(l).width > 920 && px > 18) g.font = FONT(px -= 2);
      g.fillStyle = i === lines.length - 1 ? '#8dffb0' : '#a8e8ff'; g.fillText(l, 512, 112 + i * 96);
    });
    dTex.needsUpdate = true;
  };
  // the departure's marks: Bolzar asleep and Draxum on the sofa screen left, Lyrra and Zenvik on the one screen right,
  // Skyvra at her open bag facing across the room to Zenvik, Nuvexa standing in front of the group, vlogging with
  // her phone up (the group behind her, in her phone's frame and ours)
  const seats: Interior['seats'] = {
    builder: onSofa(0, -0.7), strong: onSofa(0, 0.6), medic: onSofa(1, -0.6), scientist: onSofa(1, 0.7),
    explorer: { x: -0.95, z: 0.4, yaw: 1.3 }, social: { x: 0.25, z: 1.65, yaw: 0.05 },
  };

  const mainLight = new THREE.PointLight(0xcfe6ff, 9, 18, 1.6);
  mainLight.position.set(0, 2.5, 0.5); group.add(mainLight);
  // Earth's light through the window and the lounge's warm ceiling light: on for the departure only
  const earthLight = new THREE.PointLight(0x9cc4ff, 0, 16, 1.2);
  earthLight.position.set(0.5, -1.4, -3.4); group.add(earthLight);
  const stripLight = new THREE.PointLight(0xffd6a8, 0, 12, 1.5);
  stripLight.position.set(0, 2.6, 0.7); group.add(stripLight);
  const consoleLight = new THREE.PointLight(0x55ccff, 2.2, 6, 2);
  consoleLight.position.set(0, -0.6, -0.8); group.add(consoleLight);
  const alarmLight = new THREE.PointLight(0xff2a1a, 0, 20, 1.5);
  alarmLight.position.set(0, 2.0, 1.0); group.add(alarmLight);
  const amb = new THREE.HemisphereLight(0x8899bb, 0x111118, 0.6);
  group.add(amb);

  const footprints: Interior['footprints'] = [
    ...SOFAS.map((f, i) => ({ name: i ? 'sofaR' : 'sofaL', x: f.x, z: f.z, yaw: f.yaw, w: SOFA.w, d: SOFA.d })),
    { name: 'table', x: 0.95, z: 0.75, yaw: 0, w: 0.9, d: 0.5 }, { name: 'bag', x: -0.6, z: 0.85, yaw: 0.4, w: 0.62, d: 0.38 },
    { name: 'console', x: 0, z: -1.4, yaw: 0, w: 2.4, d: 0.9 },
  ];
  return { group, crew, floaters, alarmLight, holo, consoleLight, mainLight, earthLight, stripLight, display, seats, lounge, footprints, passage, core };
}

/** The liner's vestibule (ship units): floor, ceiling and walls as one lit mesh and the passages' dark ends as another. */
function vestibule(D: typeof LINER) {
  const g = new THREE.Group(); g.userData.vest = true;
  const z0 = D.doorZ0, z1 = D.doorZ1, hw = D.doorR * Math.sin(D.doorHalf) - 0.004, yo = D.doorR * Math.cos(D.doorHalf) - 0.004;
  const V = D.vest;
  const lit: number[] = [], dark: number[] = [];
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  // floor and ceiling: the entry, the hall, the two passages
  const rects: [number, number, number, number][] = [[-hw, hw, V.hallY1, yo], [-V.hallX, V.hallX, V.hallY0, V.hallY1], [-V.passX, -V.hallX, V.hallY0, V.passY1], [V.hallX, V.passX, V.hallY0, V.passY1]];
  for (const [x0, x1, y0, y1] of rects) for (const z of [z0, z1]) quad(lit, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  const wall = (out: number[], x0: number, y0: number, x1: number, y1: number) => quad(out, [x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1]);
  for (const s of [-1, 1]) {
    wall(lit, s * hw, V.hallY1, s * hw, yo);                     // the entry's sides
    wall(lit, s * hw, V.hallY1, s * V.hallX, V.hallY1);          // the hall's front, each side of the entry
    wall(lit, s * V.hallX, V.passY1, s * V.hallX, V.hallY1);     // the hall's ends, above the passages
    wall(lit, s * V.hallX, V.passY1, s * V.passX, V.passY1);     // the passages' fronts
    wall(dark, s * V.passX, V.hallY0, s * V.passX, V.passY1);    // the passages' far ends, dark
  }
  wall(lit, -V.passX, V.hallY0, V.passX, V.hallY0);              // the back of the hall and the passages
  const mk = (pos: number[], mat: THREE.Material) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
  mk(lit, new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.85, metalness: 0.1, emissive: 0xffb070, emissiveIntensity: 0.08, side: THREE.DoubleSide }));
  mk(dark, new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide }));
  // a light strip along the hall's ceiling
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(V.hallX * 1.8, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.3), side: THREE.DoubleSide }));
  strip.position.set(0, (V.hallY0 + V.hallY1) / 2, z1 - 0.004); g.add(strip);
  return g;
}

/**
 * For a stage that draws the ship from afar and never breaks it: every mesh under `root` that does not move is merged
 * with the others of its material into one (about 10 draws instead of 40). `keep`: subtrees left as they are (the
 * hatch, the legs, the plume). Instanced meshes and hidden ones are left too.
 */
export function bakeStatic(root: THREE.Object3D, keep: THREE.Object3D[]) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), byMat = new Map<THREE.Material, THREE.BufferGeometry[]>(), drop: THREE.Mesh[] = [];
  const kept = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep.includes(p) || !p.visible) return true; return false; };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || kept(m) || Array.isArray(m.material)) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const l = byMat.get(m.material) ?? byMat.set(m.material, []).get(m.material)!; l.push(g); drop.push(m);
  });
  for (const m of drop) m.parent?.remove(m);
  for (const [mat, list] of byMat) {
    let n = 0; for (const g of list) n += g.getAttribute('position').count;
    const out = new THREE.BufferGeometry(), P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    let o = 0; for (const g of list) { const c = g.getAttribute('position').count; P.set(g.getAttribute('position').array as Float32Array, o * 3); N.set(g.getAttribute('normal').array as Float32Array, o * 3); U.set(g.getAttribute('uv').array as Float32Array, o * 2); o += c; }
    out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    const mesh = new THREE.Mesh(out, mat); mesh.castShadow = mesh.receiveShadow = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial; root.add(mesh);
  }
  return byMat.size;
}
