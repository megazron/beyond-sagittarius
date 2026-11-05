import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/noise';
import { LAKE, Terrain } from './terrain';
import type { Forest } from './forest';

/** Fixed story locations for "The First 24 Hours" (levels 4-10). */
export interface StoryLayout {
  pod: THREE.Vector3; // your crashed escape pod
  camp: THREE.Vector3; // fire pit centre
  shelter: THREE.Vector3;
  beacon: THREE.Vector3;
  ridge: THREE.Vector3; // high ground used to triangulate the signal
  pod2: THREE.Vector3; // the Explorer's escape pod
  crewSpot: THREE.Vector3; // where the injured crewmate waits
  campSeat: THREE.Vector3; // where a rescued crewmate sits by the fire
}

/** Deterministic: depends only on the terrain seed, so both quality presets agree. */
export function computeLayout(terrain: Terrain): StoryLayout {
  const at = (x: number, z: number) => new THREE.Vector3(x, terrain.height(x, z), z);
  // search on the analytic height so Web and Ultra (different grid sizes) agree
  const T = {
    height: (x: number, z: number) => terrain.rawHeight(x, z),
    normal(x: number, z: number, out: THREE.Vector3) {
      const e = 2;
      const hx = terrain.rawHeight(x + e, z) - terrain.rawHeight(x - e, z);
      const hz = terrain.rawHeight(x, z + e) - terrain.rawHeight(x, z - e);
      return out.set(-hx, 2 * e, -hz).normalize();
    },
  };
  const n = new THREE.Vector3();
  // highest walkable point on a ring around the crash site, away from the lake
  let best = { h: -Infinity, x: 150, z: 0, a: 0 };
  for (let a = 0; a < Math.PI * 2; a += 0.04) {
    for (let r = 110; r <= 205; r += 5) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 40) continue;
      const h = T.height(x, z);
      if (h > 60) continue;
      T.normal(x, z, n);
      if (n.y < 0.9) continue;
      // the approach must be climbable: sample the slope towards the camp
      let ok = true;
      for (let k = 1; k <= 6 && ok; k++) {
        const fx = x * (1 - k * 0.03), fz = z * (1 - k * 0.03);
        T.normal(fx, fz, n);
        if (n.y < 0.7) ok = false;
      }
      if (ok && h > best.h) best = { h, x, z, a };
    }
  }
  // the Explorer's pod: further out, on flat ground, ~60° around from the ridge
  let pod2 = { score: -Infinity, x: 0, z: 0 };
  for (let da = 0.5; da <= 1.3; da += 0.05) {
    for (let r = 230; r <= 300; r += 6) {
      const a = best.a + da;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 40) continue;
      const h = T.height(x, z);
      if (h < 2 || h > 45) continue;
      T.normal(x, z, n);
      const score = n.y * 10 - Math.abs(r - 260) * 0.02;
      if (n.y > 0.93 && score > pod2.score) pod2 = { score, x, z };
    }
  }
  if (!isFinite(pod2.score)) { pod2.x = Math.cos(best.a + 0.8) * 250; pod2.z = Math.sin(best.a + 0.8) * 250; }
  const camp = at(-9, 8);
  const pod2v = at(pod2.x, pod2.z);
  // she dragged herself a few metres from the pod, towards the crash site
  const toCamp = new THREE.Vector3(-pod2.x, 0, -pod2.z).normalize();
  const crewSpot = at(pod2.x + toCamp.x * 5 + toCamp.z * 2, pod2.z + toCamp.z * 5 - toCamp.x * 2);
  return {
    pod: at(4.5, -3.5),
    camp,
    shelter: at(camp.x - 4.2, camp.z + 2.6),
    beacon: at(camp.x + 3.6, camp.z + 4.4),
    ridge: at(best.x, best.z),
    pod2: pod2v,
    crewSpot,
    campSeat: at(camp.x + 1.6, camp.z - 1.3),
  };
}

export function reserveLayout(forest: Forest, L: StoryLayout) {
  forest.reserve(L.camp.x, L.camp.z, 9);
  forest.reserve(L.beacon.x, L.beacon.z, 3);
  forest.reserve(L.ridge.x, L.ridge.z, 7);
  forest.reserve(L.pod2.x, L.pod2.z, 11);
  forest.reserve(L.crewSpot.x, L.crewSpot.z, 3);
}

const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

/** Pulsing ground ring that marks a build site. */
function siteRing(radius: number) {
  const g = new THREE.RingGeometry(radius - 0.08, radius, 40);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.5), transparent: true, opacity: 0.6, depthWrite: false }));
  m.position.y = 0.06;
  return m;
}

function pole(len: number, r0: number, r1: number, mat: THREE.Material) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 5);
  g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Orient a +Y pole so it runs from a to b. */
function poleBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = pole(d.length(), r, r * 0.8, mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** The camp: fire pit, lean-to shelter and the radio beacon, each with build stages. */
export function createCamp(terrain: Terrain, forest: Forest, L: StoryLayout) {
  const root = new THREE.Group();
  const rnd = mulberry32(404);
  const wood = flat(0x5a4334);
  const woodDark = flat(0x3b2b22);
  const stone = flat(0x8a8494);
  const leafMat = flat(0x2f8f86, { side: THREE.DoubleSide, roughness: 0.65, emissive: 0x041a18 });
  const leafMat2 = flat(0x4b6f9a, { side: THREE.DoubleSide, roughness: 0.65 });

  // ---------- fire pit ----------
  const fire = new THREE.Group();
  fire.position.copy(L.camp);
  root.add(fire);
  const ring = new THREE.Group();
  const stoneGeo = new THREE.DodecahedronGeometry(0.17, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.Mesh(stoneGeo, stone);
    s.position.set(Math.cos(a) * 0.62, 0.06, Math.sin(a) * 0.62);
    s.scale.set(1 + rnd() * 0.4, 0.7 + rnd() * 0.3, 1 + rnd() * 0.3);
    s.rotation.set(rnd(), rnd() * 6, rnd());
    s.castShadow = true; s.receiveShadow = true;
    ring.add(s);
  }
  const logs = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.Vector3(Math.cos(a) * 0.45, 0.02, Math.sin(a) * 0.45);
    logs.add(poleBetween(b, new THREE.Vector3(0, 0.62, 0), 0.04, i % 2 ? wood : woodDark));
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), flat(0x1c1817));
  ash.rotation.x = -Math.PI / 2; ash.position.y = 0.03;
  logs.add(ash);
  ring.visible = false; logs.visible = false;
  fire.add(ring, logs);
  // flames: additive cones, flickered every frame
  const flameMats = [new THREE.Color(2.4, 0.75, 0.16), new THREE.Color(2.8, 1.3, 0.3), new THREE.Color(2.2, 1.9, 0.8)].map((c) =>
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  const flames = new THREE.Group();
  const flameGeo = new THREE.ConeGeometry(0.22, 0.9, 6, 1, true);
  flameGeo.translate(0, 0.45, 0);
  const flameParts: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(flameGeo, flameMats[i % 3]);
    const a = i * 2.4;
    m.position.set(Math.cos(a) * 0.12 * (i ? 1 : 0), 0.08, Math.sin(a) * 0.12 * (i ? 1 : 0));
    m.userData.s = 0.6 + rnd() * 0.6;
    flameParts.push(m);
    flames.add(m);
  }
  flames.visible = false;
  fire.add(flames);
  const embersN = 40;
  const emberPos = new Float32Array(embersN * 3);
  const emberSeed = Array.from({ length: embersN }, () => rnd());
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({ size: 0.05, color: new THREE.Color(8, 3, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  embers.frustumCulled = false;
  embers.visible = false;
  fire.add(embers);
  // sparks when striking stones
  const sparkN = 24;
  const sparkPos = new Float32Array(sparkN * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.07, color: new THREE.Color(9, 6, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  sparks.visible = false;
  fire.add(sparks);
  let sparkT = 1;
  // the light exists from the start (intensity 0) so lighting it never recompiles shaders
  const light = new THREE.PointLight(0xff9a4a, 0, 22, 1.6);
  light.position.set(0, 0.9, 0);
  fire.add(light);
  const fireSite = siteRing(0.9);
  fire.add(fireSite);

  // ---------- lean-to shelter ----------
  const shelter = new THREE.Group();
  shelter.position.copy(L.shelter);
  shelter.lookAt(L.camp.x, L.shelter.y, L.camp.z); // open side faces the fire
  root.add(shelter);
  const frame = new THREE.Group();
  const roof = new THREE.Group();
  const W = 2.6, H = 1.55, D = 2.1;
  for (const sx of [-W / 2, W / 2]) {
    frame.add(poleBetween(new THREE.Vector3(sx, -0.2, 0.2), new THREE.Vector3(sx, H, 0.2), 0.05, wood));
    frame.add(poleBetween(new THREE.Vector3(sx, H - 0.2, 0.2), new THREE.Vector3(sx + 0.15 * Math.sign(sx), H + 0.2, 0.25), 0.03, wood));
  }
  frame.add(poleBetween(new THREE.Vector3(-W / 2 - 0.2, H, 0.2), new THREE.Vector3(W / 2 + 0.2, H, 0.2), 0.045, woodDark));
  for (let i = 0; i < 6; i++) {
    const x = -W / 2 + (i / 5) * W;
    frame.add(poleBetween(new THREE.Vector3(x, H + 0.05, 0.25), new THREE.Vector3(x * 1.05, -0.1, -D), 0.03, i % 2 ? wood : woodDark));
  }
  // fronds layered like shingles on the slanted poles
  const leafGeo = new THREE.PlaneGeometry(0.9, 1.3, 1, 4);
  {
    const p = leafGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - Math.abs(y) * 0.45)); p.setZ(i, Math.abs(p.getX(i)) * 0.18); }
    leafGeo.computeVertexNormals();
  }
  const slope = Math.atan2(H + 0.15, D + 0.25);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      const lf = new THREE.Mesh(leafGeo, (row + i) % 3 ? leafMat : leafMat2);
      const u = (row + 0.5) / 3;
      lf.position.set(-W / 2 + 0.35 + i * ((W - 0.7) / 3) + (rnd() - 0.5) * 0.1, H - u * (H + 0.15) + 0.08, 0.25 - u * (D + 0.25) - 0.04);
      lf.rotation.set(-(Math.PI / 2 - slope), (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.25);
      lf.castShadow = true; lf.receiveShadow = true;
      roof.add(lf);
    }
  }
  const bed = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.12, D * 0.6), leafMat);
  bed.position.set(0, 0.04, -D * 0.45); bed.receiveShadow = true;
  roof.add(bed);
  frame.visible = false; roof.visible = false;
  shelter.add(frame, roof);
  const shelterSite = siteRing(1.6);
  shelterSite.position.z = -0.8;
  shelter.add(shelterSite);
  // the spear leans against the shelter once crafted
  const spearRest = new THREE.Group();
  spearRest.position.set(W / 2 + 0.25, 0, 0.3);
  shelter.add(spearRest);

  // ---------- radio beacon ----------
  const beacon = new THREE.Group();
  beacon.position.copy(L.beacon);
  root.add(beacon);
  const tripod = new THREE.Group();
  const top = new THREE.Vector3(0, 2.7, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    tripod.add(poleBetween(new THREE.Vector3(Math.cos(a) * 0.9, -0.15, Math.sin(a) * 0.9), top.clone().add(new THREE.Vector3(Math.cos(a) * 0.1, 0.25, Math.sin(a) * 0.1)), 0.04, wood));
  }
  const metal = flat(0xa9afb8, { metalness: 0.6, roughness: 0.45 });
  const stripe = flat(0xff7a2a, { emissive: 0x401000 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, 0.3), metal);
  box.position.set(0, 2.45, 0); box.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.31), stripe);
  band.position.set(0, 2.5, 0);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.18, 10, 1, true), metal);
  dish.position.set(0, 2.78, 0.05); dish.rotation.x = Math.PI;
  const mast = pole(1.1, 0.018, 0.012, flat(0x2a2e36));
  mast.position.set(0.12, 2.6, -0.05);
  const blinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.2, 0.2) });
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), blinkMat);
  blink.position.set(0.12, 3.72, -0.05);
  const panels = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const pnl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.025, 0.42), metal);
    const a = (i / 3) * Math.PI * 2 + 0.5;
    pnl.position.set(Math.cos(a) * 0.55, 1.1, Math.sin(a) * 0.55);
    pnl.rotation.set(0.25, -a, 0.6);
    pnl.castShadow = true;
    panels.add(pnl);
  }
  const device = new THREE.Group();
  device.add(box, band, dish, mast, blink, panels);
  tripod.visible = false; device.visible = false;
  beacon.add(tripod, device);
  // vertical beam when transmitting
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uOn: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; uniform float uOn; varying vec2 vUv;
      void main(){ float pulse = 0.55 + 0.45 * sin(vUv.y * 60.0 - uT * 6.0);
        float fall = 1.0 - vUv.y; fall *= fall;
        float a = fall * (0.3 + 0.7 * pulse) * uOn * 0.55;
        gl_FragColor = vec4(vec3(0.3, 1.0, 1.5) * a, a); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 260, 10, 1, true), beamMat);
  beam.position.y = 3.8 + 130;
  beam.visible = false;
  beam.frustumCulled = false;
  beacon.add(beam);
  const beaconSite = siteRing(1.0);
  beacon.add(beaconSite);

  forest.addObstacle(L.camp.x, L.camp.z, 0.75);
  let shelterObstacles = false, beaconObstacle = false;

  const state = { fireStage: 0, lit: false, shelter: false, beaconBuilt: false, beaconOn: false, sites: { fire: false, shelter: false, beacon: false } };

  return {
    root,
    light,
    spearRest,
    state,
    /** 0 = nothing, 1 = stone ring + logs laid, 2 = burning. */
    setFire(stage: number) {
      state.fireStage = stage;
      ring.visible = stage >= 1; logs.visible = stage >= 1;
      state.lit = stage >= 2;
      flames.visible = state.lit; embers.visible = state.lit;
    },
    setShelter(on: boolean) {
      state.shelter = on;
      frame.visible = on; roof.visible = on;
      if (on && !shelterObstacles) {
        shelterObstacles = true;
        // the back wall blocks, the open front lets the player crawl in
        const back = new THREE.Vector3(0, 0, -1.6).applyQuaternion(shelter.quaternion).add(L.shelter);
        forest.addObstacle(back.x, back.z, 0.9);
      }
    },
    setBeacon(built: boolean, on: boolean) {
      state.beaconBuilt = built; state.beaconOn = on;
      tripod.visible = built; device.visible = built;
      beam.visible = on;
      if (built && !beaconObstacle) { beaconObstacle = true; forest.addObstacle(L.beacon.x, L.beacon.z, 0.8); }
    },
    /** Which ghost rings to show (the next thing to build). */
    setSites(s: { fire: boolean; shelter: boolean; beacon: boolean }) { state.sites = s; },
    strikeSparks() { sparkT = 0; sparks.visible = true; },
    update(t: number, dt: number, player: THREE.Vector3) {
      const near = smoothstep(40, 8, player.distanceTo(L.camp));
      const pulse = (0.35 + 0.35 * Math.sin(t * 3)) * near;
      for (const [m, on] of [[fireSite, state.sites.fire], [shelterSite, state.sites.shelter], [beaconSite, state.sites.beacon]] as const) {
        m.visible = on && near > 0.01;
        (m.material as THREE.MeshBasicMaterial).opacity = pulse;
      }
      if (state.lit) {
        flameParts.forEach((m, i) => {
          const f = 0.75 + 0.25 * Math.sin(t * (9 + i * 1.7) + i) + 0.12 * Math.sin(t * 23 + i * 3);
          m.scale.set(m.userData.s * (0.8 + 0.2 * f), m.userData.s * f * (i ? 0.8 : 1.15), m.userData.s * (0.8 + 0.2 * f));
          m.rotation.y = t * (0.5 + i * 0.1);
        });
        light.intensity = 16 * (0.85 + 0.1 * Math.sin(t * 13) + 0.05 * Math.sin(t * 31));
        for (let i = 0; i < embersN; i++) {
          const life = (t * (0.35 + emberSeed[i] * 0.3) + emberSeed[i]) % 1;
          const a = emberSeed[i] * 40 + t * 0.6;
          emberPos[i * 3] = Math.cos(a) * 0.25 * life + Math.sin(t + i) * 0.1 * life;
          emberPos[i * 3 + 1] = 0.3 + life * 3.2;
          emberPos[i * 3 + 2] = Math.sin(a) * 0.25 * life;
        }
        emberGeo.attributes.position.needsUpdate = true;
      } else {
        light.intensity = 0;
      }
      if (sparks.visible) {
        sparkT += dt * 1.8;
        for (let i = 0; i < sparkN; i++) {
          const a = i * 2.39996, sp = 0.6 + (i % 5) * 0.2;
          sparkPos[i * 3] = Math.cos(a) * sparkT * sp;
          sparkPos[i * 3 + 1] = 0.3 + sparkT * 1.2 - sparkT * sparkT * 2.2;
          sparkPos[i * 3 + 2] = Math.sin(a) * sparkT * sp;
        }
        sparkGeo.attributes.position.needsUpdate = true;
        if (sparkT > 0.9) sparks.visible = false;
      }
      if (state.beaconBuilt) {
        const on = state.beaconOn ? (Math.sin(t * 6) > 0 ? 1 : 0) : (Math.sin(t * 1.5) > 0.9 ? 1 : 0);
        blinkMat.color.setRGB(on * 8 + 0.2, on * 1.2 + 0.1, on * 0.6 + 0.1);
        beamMat.uniforms.uT.value = t;
        beamMat.uniforms.uOn.value = state.beaconOn ? 1 : 0;
        dish.rotation.y = state.beaconOn ? t * 0.8 : 0;
      }
    },
  };
}

/** Crystal outcrop on the ridge: the highest ground near the crash site. */
export function createRidge(L: StoryLayout) {
  const root = new THREE.Group();
  root.position.copy(L.ridge);
  const rnd = mulberry32(77);
  const crystal = new THREE.MeshStandardMaterial({ color: 0xc9c3e6, roughness: 0.25, metalness: 0.1, flatShading: true, emissive: new THREE.Color(0.25, 0.2, 0.6), emissiveIntensity: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 3.2) });
  for (let i = 0; i < 9; i++) {
    const h = 0.8 + rnd() * 2.6;
    const g = new THREE.CylinderGeometry(0, 0.22 + rnd() * 0.2, h, 5);
    g.translate(0, h / 2, 0);
    const m = new THREE.Mesh(g, i < 2 ? glow : crystal);
    const a = rnd() * Math.PI * 2, r = 1.6 + rnd() * 2.4;
    m.position.set(Math.cos(a) * r, -0.2, Math.sin(a) * r);
    m.rotation.set((rnd() - 0.5) * 0.6, rnd() * 6, (rnd() - 0.5) * 0.6);
    m.castShadow = true;
    root.add(m);
  }
  // a flat rock to stand on
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 7), flat(0x6c6676));
  slab.position.y = 0.05; slab.receiveShadow = true; slab.castShadow = true;
  root.add(slab);
  return { root };
}
