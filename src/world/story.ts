import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/noise';
import { LAKE, Terrain } from './terrain';
import type { Forest } from './forest';
import { makeFire } from './flame';

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

/**
 * A giant fern frond painted into a texture (no canvas: it is built in plain arrays, so it runs in the tests too): a
 * pale rib, pairs of leaflets angled to the tip, each a little different in green, browning at the tips; `dry` for an
 * older frond, olive going brown. u runs across, v from the stalk (0) to the tip (1).
 */
function frondTexture(seed: number, dry: boolean) {
  const Wd = 128, Ht = 256, data = new Uint8Array(Wd * Ht * 4), rnd = mulberry32(seed);
  const base = dry ? [104, 98, 52] : [58, 92, 48], brown = dry ? [122, 88, 48] : [96, 92, 50];
  for (let i = 0; i < Wd * Ht; i++) { data[i * 4] = base[0]; data[i * 4 + 1] = base[1]; data[i * 4 + 2] = base[2]; data[i * 4 + 3] = 0; }
  const stamp = (x: number, y: number, r: number, c: number[]) => {
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= Wd || yy >= Ht || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      const k = (yy * Wd + xx) * 4; data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
    }
  };
  const N = 19;
  for (let k = 0; k < N; k++) for (const sg of [-1, 1]) {
    const v0 = 0.07 + (k / N) * 0.88, reach = Math.sin(Math.PI * (0.12 + 0.88 * (k / N))) * (0.46 - 0.12 * (k / N)) * (0.9 + rnd() * 0.15);
    const ang = 0.95 + rnd() * 0.2, len = reach / Math.sin(ang), wid = 2.2 + 2.4 * Math.sin(Math.PI * (k + 1) / (N + 1));
    const tone = 0.82 + rnd() * 0.3, brownAt = 0.55 + rnd() * 0.4;
    const n = Math.ceil(len * Ht * 1.2);
    for (let j = 0; j <= n; j++) {
      const t = j / n, x = 0.5 + sg * Math.sin(ang) * len * t, y = v0 + Math.cos(ang) * len * t * 0.5;
      const b = Math.max(0, (t - brownAt) / (1 - brownAt)) * (dry ? 1 : 0.8);
      const c = base.map((q, ci) => Math.min(255, (q + (brown[ci] - q) * b) * tone * (0.9 + 0.2 * t)));
      stamp(x * Wd, y * Ht, wid * (1 - t * 0.75), c);
    }
  }
  for (let y = 0; y < Ht * 0.985; y++) stamp(Wd / 2, y, 1.6 - (y / Ht) * 0.9, dry ? [140, 124, 70] : [118, 128, 66]);
  const tex = new THREE.DataTexture(data, Wd, Ht, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

/** The camp: fire pit, lean-to shelter and the radio beacon, each with build stages. */
export function createCamp(terrain: Terrain, forest: Forest, L: StoryLayout) {
  const root = new THREE.Group();
  const rnd = mulberry32(404);
  const wood = flat(0x5a4334);
  const woodDark = flat(0x3b2b22);
  const stone = flat(0x8a8494);
  // the lean-to's fronds: cut from the giant ferns round the camp, fresh green ones and a few that have browned (they
  // read as flat teal and blue tarps before: owner). Leaflets cut out of a painted frond, not a coloured sheet
  const leafMat = new THREE.MeshStandardMaterial({ map: frondTexture(11, false), side: THREE.DoubleSide, roughness: 0.7, alphaTest: 0.45 });
  const leafMat2 = new THREE.MeshStandardMaterial({ map: frondTexture(29, true), side: THREE.DoubleSide, roughness: 0.75, alphaTest: 0.45 });
  const bedMat = flat(0x4a4a2a, { roughness: 0.95 });

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
  // flames: noise-shaded tongues and a coal bed (src/world/flame.ts; they were additive six-sided cones, pale and blocky
  // up close: owner); this fire's own embers below, its light further down
  const flameFx = makeFire({ size: 1.05, tongues: 8, embers: 0, light: null, seed: 3 });
  const flames = flameFx.group;
  for (let i = 0; i < 7; i++) rnd(); // (the old cones took seven draws: kept, so everything after is placed as before)
  flames.position.y = 0.04;
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
  // (about full daylight on someone a metre away, falling off gently; at 16 with a fall-off of 1.6 a white coat by the fire
  // took several times full daylight and burned out to flat orange-white: combat agent, owner's complaint)
  const light = new THREE.PointLight(0xff9a4a, 0, 22, 1.0);
  light.position.set(0, 0.9, 0);
  fire.add(light);
  // a work light for the hand-drill at dusk, also there from the start and off: the last glow of the sky after sunset,
  // put where the western sky is (Episode One 1.6 was too dark to read at 18:30). The ember's own small glow borrows
  // the fire's light while the fire is not lit (one more light in the scene costs every pixel of every frame)
  const skyGlow = new THREE.PointLight(0xffb48a, 0, 9, 1.4);
  root.add(skyGlow);
  const work = { sky: 0, ember: 0, at: new THREE.Vector3(), skyAt: new THREE.Vector3() };
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
  // fronds laid on the slanted poles like shingles: each one's stalk up at the ridge, its tip down the slope, the
  // rows from the ridge down overlapping the row below on the outside (the rain runs off)
  const FL = 1.45, FW = 0.82;
  const leafGeo = new THREE.PlaneGeometry(FW, FL, 4, 8);
  {
    const p = leafGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), t = p.getY(i) / FL + 0.5; // 0 at the stalk, 1 at the tip
      // folded a little along the rib, arched, and the tip hanging on to the roof
      p.setXYZ(i, x * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t * 1.6))), t * FL, -Math.abs(x) * 0.16 + Math.sin(Math.PI * t) * 0.06);
    }
    leafGeo.computeVertexNormals();
  }
  const S = Math.hypot(H + 0.15, D + 0.25), down = new THREE.Vector3(0, -(H + 0.15), -(D + 0.25)).normalize();
  const out = new THREE.Vector3(1, 0, 0).cross(down); // the roof's outer side (up and back)
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), down, out);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      const lf = new THREE.Mesh(leafGeo, (row * 4 + i) % 3 === 1 ? leafMat2 : leafMat);
      const u = (row + 0.5) / 3, x = -W / 2 + 0.33 + i * ((W - 0.66) / 3) + (rnd() - 0.5) * 0.1;
      // the stalk end, up the slope from the row's middle; upper rows a little further out (they lie over the next)
      const s0 = Math.max(0, u * S - FL * 0.5 - 0.05);
      lf.position.set(x, H + 0.05, 0.25).addScaledVector(down, s0).addScaledVector(out, 0.05 + (2 - row) * 0.025);
      lf.quaternion.setFromRotationMatrix(basis).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.18)));
      lf.castShadow = true; lf.receiveShadow = true;
      roof.add(lf);
    }
  }
  const bed = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.12, D * 0.6), bedMat);
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

  // the fire ring: knee high (the camera passes over it; as a trunk of no height it pulled the night watch's view in
  // to over his head in one frame each time he came to the fire: 2:06 in v14, 2:13, 2:38 and 3:08 in v15)
  forest.addObstacle(L.camp.x, L.camp.z, 0.75, 0.9);
  let shelterObstacles = false, beaconObstacle = false, baseQ: THREE.Quaternion | null = null;

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
      if (baseQ) shelter.quaternion.copy(baseQ);
      frame.visible = on; roof.visible = on;
      for (const c of [...frame.children, ...roof.children]) c.visible = true;
      if (on && !shelterObstacles) {
        shelterObstacles = true;
        // the back wall blocks, the open front lets the player crawl in
        const back = new THREE.Vector3(0, 0, -1.6).applyQuaternion(shelter.quaternion).add(L.shelter);
        forest.addObstacle(back.x, back.z, 0.9);
      }
    },
    /**
     * The lean-to going up, for Episode One's build (lean.ts): 0 nothing, 1 the uprights and the ridge pole, 2 the
     * leaning poles, 3 to 5 the thatch rows from the bottom up (5 adds the bed). `thin`: every other frond of the
     * newest row left out (light through the roof). `turn`: the whole frame turned about its upright (the wrong way
     * to the wind), in radians. setShelter(true) is stage 5, untouched.
     */
    shelterStage(k: number, thin = false, turn = 0) {
      if (!baseQ) baseQ = shelter.quaternion.clone();
      shelter.quaternion.copy(baseQ); if (turn) shelter.rotateY(turn);
      frame.visible = k >= 1; roof.visible = k >= 3;
      frame.children.forEach((c, i) => { c.visible = i < 5 ? k >= 1 : k >= 2; });
      const fronds = roof.children.slice(0, 12);
      fronds.forEach((c, i) => {
        const row = Math.floor(i / 4), need = 5 - row; // row 2 is the bottom: it goes on first (stage 3)
        c.visible = k >= need && !(thin && k === need && i % 2 === 1);
      });
      roof.children.slice(12).forEach((c) => { c.visible = k >= 5; });
    },
    /** Where the lean-to stands and which way its open side faces (towards the fire). */
    shelterAt() { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(baseQ ?? shelter.quaternion); return { at: L.shelter.clone(), open: f.setY(0).normalize() }; },
    setBeacon(built: boolean, on: boolean) {
      state.beaconBuilt = built; state.beaconOn = on;
      tripod.visible = built; device.visible = built;
      beam.visible = on;
      if (built && !beaconObstacle) { beaconObstacle = true; forest.addObstacle(L.beacon.x, L.beacon.z, 0.8); }
    },
    /** Which ghost rings to show (the next thing to build). */
    setSites(s: { fire: boolean; shelter: boolean; beacon: boolean }) { state.sites = s; },
    strikeSparks() { sparkT = 0; sparks.visible = true; },
    /**
     * Light for work at dusk (the drill): `sky` 0..1 the sky's last glow from `skyAt` (a point out towards the sunset,
     * coloured like the horizon), `ember` 0..1 an ember at `at`. null puts both out.
     */
    workLight(o: { sky?: number; skyAt?: THREE.Vector3; color?: THREE.Color; ember?: number; at?: THREE.Vector3 } | null) {
      if (!o) { work.sky = work.ember = 0; return; }
      if (o.sky !== undefined) work.sky = o.sky;
      if (o.ember !== undefined) work.ember = o.ember;
      if (o.skyAt) work.skyAt.copy(o.skyAt);
      if (o.at) work.at.copy(o.at);
      if (o.color) skyGlow.color.copy(o.color);
    },
    update(t: number, dt: number, player: THREE.Vector3) {
      const near = smoothstep(40, 8, player.distanceTo(L.camp));
      const pulse = (0.35 + 0.35 * Math.sin(t * 3)) * near;
      for (const [m, on] of [[fireSite, state.sites.fire], [shelterSite, state.sites.shelter], [beaconSite, state.sites.beacon]] as const) {
        m.visible = on && near > 0.01;
        (m.material as THREE.MeshBasicMaterial).opacity = pulse;
      }
      if (state.lit) {
        flameFx.update(1, 0);
        light.intensity = 3.5 * (0.82 + 0.08 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.05 * Math.sin(t * 4.1 + 0.4) + 0.04 * Math.sin(t * 37.1));
        light.position.set(Math.sin(t * 5.3) * 0.04, 0.9 + Math.sin(t * 7.9) * 0.05, Math.cos(t * 4.7) * 0.04);
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
      // the fire's light, unlit, as the ember's glow (a small warm light low at the notch, short reach)
      const emb = !state.lit && work.ember > 0;
      light.distance = emb ? 2.2 : 22; light.color.setHex(emb ? 0xff6a24 : 0xff9a4a);
      if (emb) { light.position.copy(work.at).sub(L.camp); light.position.y += 0.06; light.intensity = work.ember * (1.1 + 0.35 * Math.sin(t * 7.3) + 0.2 * Math.sin(t * 17.1)); }
      else light.position.set(0, 0.9, 0);
      // root sits at the origin of the world (the fire pit group carries the camp's position)
      skyGlow.intensity = 20 * work.sky; skyGlow.position.copy(work.skyAt);
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
