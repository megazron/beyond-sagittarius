import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createCharacter, Character, CrewId } from '../characters/character';
import { NOISE_GLSL } from '../core/glsl';

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
}

/** Interstellar tourist liner: spine, habitat ring, observation dome, drive. */
export function createShip(): Ship {
  const group = new THREE.Group();
  const tex = hullTexture();
  tex.repeat.set(4, 2);
  const hull = new THREE.MeshStandardMaterial({ color: 0xe6e8ec, map: tex, metalness: 0.45, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272f, metalness: 0.8, roughness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a14a, metalness: 1, roughness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x2a5d8a, metalness: 0.2, roughness: 0.05, transmission: 0, emissive: 0x2a77aa, emissiveIntensity: 0.6 });
  const solar = new THREE.MeshStandardMaterial({ color: 0x0f2350, metalness: 0.9, roughness: 0.2, emissive: 0x050a20 });

  // Spine (lathe profile), nose along +Z
  const pts: THREE.Vector2[] = [];
  const prof = [[0, 0], [0.5, 0.2], [0.9, 1.2], [1.0, 3], [0.8, 4], [0.85, 6], [0.6, 7.5], [0.7, 9], [1.1, 10], [1.1, 11], [0.5, 11.6]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const spineGeo = new THREE.LatheGeometry(pts, 32);
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

  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, engineGlow, plume, ring, lights, pods, broken };
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
  /** A body's place (deck units, x and z) moved out of the furniture (the sofas, the table, the console) by r. */
  keepOut(x: number, z: number, r?: number): [number, number];
}

/** The lounge's furniture, in deck units: two low sofas either side of the console, backs to the window. */
const SOFA = { w: 1.9, d: 0.78, seat: 0.44, back: 0.86 } as const;
const SOFAS = [{ x: -2.35, z: -0.55, yaw: 0.5 }, { x: 2.35, z: -0.55, yaw: -0.5 }] as const;
/** A point on a sofa's seat: along its width (-1 one arm .. 1 the other) and out from the back cushion. */
function onSofa(i: 0 | 1, along: number, out = 0.12) {
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
  for (let i = 0; i < 26; i++) {
    const f = new THREE.Mesh(fGeos[i % 4], fMats[i % 3]);
    f.position.set((Math.random() - 0.5) * 8, -2.15 + Math.random() * 0.3, (Math.random() - 0.5) * 3.5);
    f.userData.base = f.position.clone();
    f.userData.spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2);
    f.userData.rise = 0.3 + Math.random() * 0.6;
    f.castShadow = true;
    group.add(f); floaters.push(f);
  }

  // ---- the lounge: sofas, a low table, a bag, end bulkheads with the hatch aft, ceiling strips, a runner ----
  const fabric = new THREE.MeshStandardMaterial({ color: 0x7d7268, roughness: 0.92 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x9a8c7e, roughness: 0.95 });
  const base = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.45 });
  const rb = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const lounge = new THREE.Group(); lounge.name = 'lounge'; group.add(lounge);
  const put = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
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
  for (const ex of [-5.95, 5.95]) { const w = new THREE.Mesh(new THREE.CircleGeometry(4, 48), bulk); w.position.x = ex; w.rotation.y = ex < 0 ? Math.PI / 2 : -Math.PI / 2; w.receiveShadow = true; group.add(w); }
  const hatchF = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.8) });
  put(rb(0.06, 2.1, 1.1, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a4049, metalness: 0.7, roughness: 0.35 }), group, 5.9, -1.15, 0.9);
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
  // Earth's light through the window while docked (off once the liner has left), and the warm ceiling strips
  const earthLight = new THREE.PointLight(0x9cc4ff, 0, 16, 1.2);
  earthLight.position.set(0.5, -1.4, -3.4); group.add(earthLight);
  const stripLight = new THREE.PointLight(0xffd6a8, 2.2, 12, 1.5);
  stripLight.position.set(0, 2.6, 0.7); group.add(stripLight);
  const consoleLight = new THREE.PointLight(0x55ccff, 2.2, 6, 2);
  consoleLight.position.set(0, -0.6, -0.8); group.add(consoleLight);
  const alarmLight = new THREE.PointLight(0xff2a1a, 0, 20, 1.5);
  alarmLight.position.set(0, 2.0, 1.0); group.add(alarmLight);
  const amb = new THREE.HemisphereLight(0x8899bb, 0x111118, 0.6);
  group.add(amb);

  // the furniture as boxes on the floor (centre, half sizes, turn): a body thrown about in the event stops against them
  const boxes = [...SOFAS.map((q) => ({ x: q.x, z: q.z, hx: SOFA.w / 2, hz: SOFA.d / 2, yaw: q.yaw })), { x: 0, z: -1.4, hx: 1.2, hz: 0.45, yaw: 0 }, { x: 0.95, z: 0.75, hx: 0.45, hz: 0.25, yaw: 0 }];
  const keepOut = (x: number, z: number, r = 0.3): [number, number] => {
    for (const b of boxes) {
      const c = Math.cos(b.yaw), n = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * n, lz = dx * n + dz * c, ex = b.hx + r - Math.abs(lx), ez = b.hz + r - Math.abs(lz);
      if (ex <= 0 || ez <= 0) continue;
      const ox = ex < ez ? Math.sign(lx) * ex : 0, oz = ex < ez ? 0 : Math.sign(lz) * ez;
      x += ox * c + oz * n; z += -ox * n + oz * c;
    }
    return [x, z];
  };

  return { group, crew, floaters, alarmLight, holo, consoleLight, mainLight, earthLight, stripLight, display, seats, keepOut };
}
