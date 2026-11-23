// Everything in a fight that is not a body: pooled particles (one draw), pooled projectiles (one draw per shape),
// the marks on the ground that say an attack is coming, traps, fires and things to pick up. Nothing here allocates
// while a fight runs.
import * as THREE from 'three';
import type { CombatSim, Trap } from '../sim/sim';
import type { WeaponId } from '../sim/weapons';

const N_PART = 384;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
// the snare's pole: bent over the noose when set (tip about a hand above the loop), near upright once sprung
const SNARE_SET = 0.66, SNARE_UP = 0.12;
const Y1 = new THREE.Vector3(0, 1, 0);
/** A unit cylinder (base at 0, up +y) stretched from a to b. */
function seg(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a), l = d.length();
  o.position.copy(a); o.quaternion.setFromUnitVectors(Y1, l > 1e-6 ? d.divideScalar(l) : Y1); o.scale.set(1, Math.max(1e-4, l), 1);
}

export type Puff = 'dust' | 'spark' | 'chip' | 'ember' | 'spore' | 'flash' | 'leaf' | 'arc' | 'smoke' | 'splash';
const PUFF: Record<Puff, { n: number; c: [number, number, number]; size: number; life: number; speed: number; up: number; g: number; add?: boolean; a?: number }> = {
  dust: { n: 9, c: [0.62, 0.56, 0.46], size: 0.5, life: 0.7, speed: 1.6, up: 1.2, g: 1.5 },
  chip: { n: 7, c: [0.86, 0.8, 0.66], size: 0.08, life: 0.55, speed: 3.6, up: 2.6, g: 9 },
  leaf: { n: 6, c: [0.3, 0.55, 0.32], size: 0.2, life: 0.9, speed: 2.2, up: 2.4, g: 5 },
  spark: { n: 10, c: [3, 2.1, 0.8], size: 0.05, life: 0.35, speed: 5.5, up: 2.5, g: 9, add: true },
  ember: { n: 3, c: [3, 1.2, 0.3], size: 0.035, life: 1.1, speed: 0.5, up: 1.8, g: -0.6, add: true },
  spore: { n: 14, c: [0.55, 0.8, 0.3], size: 0.7, life: 4.5, speed: 1.1, up: 0.4, g: -0.05 },
  flash: { n: 1, c: [2.5, 2.3, 2], size: 1.3, life: 0.09, speed: 0, up: 0, g: 0, add: true },
  arc: { n: 8, c: [0.8, 2.2, 3], size: 0.06, life: 0.3, speed: 4, up: 1, g: 0, add: true },
  // wood smoke: rises slowly and leans with the wind, so the camp shows which way the breeze carries the food's smell
  smoke: { n: 1, c: [0.3, 0.29, 0.28], size: 0.5, life: 4.5, speed: 0.2, up: 0.5, g: -0.04, a: 0.16 },
  // water thrown up where a spear goes in: a crown of drops falling back
  splash: { n: 14, c: [0.78, 0.84, 0.86], size: 0.09, life: 0.6, speed: 1.4, up: 2.6, g: 9.8, a: 0.7 },
};

export class CombatFx {
  group = new THREE.Group();
  private pos = new Float32Array(N_PART * 3);
  private col = new Float32Array(N_PART * 4);
  private size = new Float32Array(N_PART);
  private vel = new Float32Array(N_PART * 3);
  private life = new Float32Array(N_PART);
  private max = new Float32Array(N_PART);
  private grav = new Float32Array(N_PART);
  private next = 0;
  private points: THREE.Points;
  private stones: THREE.InstancedMesh; private shafts: THREE.InstancedMesh; private bolts: THREE.InstancedMesh;
  private blurs: THREE.InstancedMesh; private blurU = { uA: { value: 0 }, uCol: { value: new THREE.Color(0x9a7a55) } }; private lastSimT = 0;
  private tele: { mesh: THREE.Mesh; id: number; t: number; dur: number; ring: boolean; mat: THREE.ShaderMaterial }[] = [];
  private props = new Map<number, THREE.Object3D>();
  private flames: { o: THREE.Object3D; id: number; light: THREE.PointLight | null }[] = [];
  private numbers: { el: HTMLDivElement; t: number; p: THREE.Vector3 }[] = [];
  private numRoot: HTMLDivElement;
  private emberT = 0;
  showNumbers = false;

  constructor(private height: (x: number, z: number) => number, private lights: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec4 aCol; attribute float aSize; varying vec4 vCol; uniform float uScale;
        void main() { vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = max(0.1, -mv.z);
          // nothing swells over the lens: capped in size, and faded out right in front of the camera
          gl_PointSize = min(aSize * uScale / d, 0.18 * uScale); vCol.a *= smoothstep(0.7, 2.8, d); }`,
      fragmentShader: `varying vec4 vCol; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, d) * vCol.a; if (a < 0.01) discard; gl_FragColor = vec4(vCol.rgb, a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false; this.points.renderOrder = 4;
    this.group.add(this.points);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => { const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = false; this.group.add(im); return im; };
    this.stones = inst(new THREE.DodecahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9, flatShading: true }), 20);
    const shaft = new THREE.CylinderGeometry(0.012, 0.012, 1, 5); shaft.rotateX(Math.PI / 2);
    this.shafts = inst(shaft, new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.8 }), 20);
    const bolt = new THREE.CylinderGeometry(0.03, 0.03, 1, 5); bolt.rotateX(Math.PI / 2);
    this.bolts = inst(bolt, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3, 4) }), 12);
    // a spinning throwing stick seen at a game's frame rate turns a third of a turn between frames: by eye (and on a
    // camera) it is a blurred disc swept by the stick, densest at the hub (every angle passes there). The stick is
    // drawn as well; the disc is the stick's sweep over the frame, so it fades out in slow motion
    const disc = new THREE.CircleGeometry(0.375, 20); disc.rotateX(-Math.PI / 2);
    this.blurs = inst(disc, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: this.blurU,
      vertexShader: 'varying vec2 vP; void main() { vP = position.xz / 0.375; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uA; uniform vec3 uCol; varying vec2 vP; void main() { float r = length(vP); float a = uA * clamp(0.09 / (r + 0.06), 0.0, 1.0) * smoothstep(1.0, 0.82, r); if (a < 0.004) discard; gl_FragColor = vec4(uCol, a); }',
    }), 6);
    this.blurs.renderOrder = 3;
    this.numRoot = document.createElement('div'); this.numRoot.className = 'cb-numbers'; document.body.append(this.numRoot);
  }

  /** How lit the smoke is (the controller sets it low at night). */
  smokeK = 1;

  puff(kind: Puff, x: number, y: number, z: number, dx = 0, dz = 0, scale = 1) {
    const d = PUFF[kind];
    for (let k = 0; k < Math.ceil(d.n * scale); k++) {
      const i = this.next; this.next = (this.next + 1) % N_PART;
      const a = Math.random() * 6.283, r = Math.random();
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * d.speed * r + dx * d.speed; this.vel[i * 3 + 1] = d.up * (0.4 + Math.random() * 0.6); this.vel[i * 3 + 2] = Math.sin(a) * d.speed * r + dz * d.speed;
      // smoke is lit by what is round it: at night only the fire's glow, so it is a dim grey, not white puffs
      const lit = kind === 'smoke' ? this.smokeK : 1;
      this.col[i * 4] = d.c[0] * lit; this.col[i * 4 + 1] = d.c[1] * lit; this.col[i * 4 + 2] = d.c[2] * lit; this.col[i * 4 + 3] = d.a ?? (d.add ? 1 : 0.55);
      this.size[i] = d.size * (0.6 + Math.random() * 0.7); this.life[i] = this.max[i] = d.life * (0.7 + Math.random() * 0.5); this.grav[i] = d.g;
    }
  }

  /** A mark on the ground for an attack that is coming: a strip along its line, or a ring round its reach. It fills as the wind-up runs out. */
  telegraph(id: number, ring: boolean, dur: number, x: number, z: number, dx: number, dz: number, len: number, r: number, warn = false) {
    let t = this.tele.find((q) => q.t >= q.dur);
    if (!t) {
      if (this.tele.length >= 8) return;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4,
        uniforms: { uK: { value: 0 }, uRing: { value: 0 }, uW: { value: 0.1 }, uCol: { value: new THREE.Color(1, 0.25, 0.1) } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform float uK, uRing, uW; uniform vec3 uCol;
          void main() { float a;
            if (uRing > 0.5) { float d = length(vUv - 0.5) * 2.0; if (d > 1.0) discard; a = smoothstep(1.0 - uW * 1.6, 1.0 - uW * 0.4, d) * 0.9 + step(d, uK) * 0.16; }
            else { float e = min(vUv.x, 1.0 - vUv.x); a = (smoothstep(0.0, 0.08, e) < 0.6 ? 0.55 : 0.0) + step(vUv.y, uK) * 0.2; a *= smoothstep(1.0, 0.85, vUv.y) ; }
            gl_FragColor = vec4(uCol, a * (0.55 + 0.45 * uK)); }`,
      });
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      t = { mesh: new THREE.Mesh(g, mat), id, t: 0, dur, ring, mat };
      t.mesh.renderOrder = 3; t.mesh.frustumCulled = false;
      this.group.add(t.mesh); this.tele.push(t);
    }
    t.id = id; t.t = 0; t.dur = dur; t.ring = ring;
    t.mat.uniforms.uRing.value = ring ? 1 : 0;
    (t.mat.uniforms.uCol.value as THREE.Color).setRGB(warn ? 1.6 : 2.2, warn ? 1.1 : 0.3, 0.1);
    this.placeTele(t, x, z, dx, dz, len, r);
    t.mesh.visible = true;
  }
  private placeTele(t: CombatFx['tele'][number], x: number, z: number, dx: number, dz: number, len: number, r: number) {
    const m = t.mesh;
    if (t.ring) { m.position.set(x, this.height(x, z) + 0.12, z); m.scale.set(r * 2, 1, r * 2); m.rotation.set(0, 0, 0); t.mat.uniforms.uW.value = Math.min(0.12, 0.3 / Math.max(0.5, r)); }
    else {
      len = Math.max(1.2, len);
      const cx = x + dx * len * 0.5, cz = z + dz * len * 0.5;
      const y0 = this.height(x, z), y1 = this.height(x + dx * len, z + dz * len);
      m.position.set(cx, (y0 + y1) / 2 + 0.15, cz);
      m.scale.set(Math.max(0.8, r * 2), 1, len);
      // the plane's v runs along -z: turn it to the line and tip it to the slope (never more than a hillside; a short
      // lunge over a bump once stood the strip on its end like a sign)
      const tip = Math.max(-0.35, Math.min(0.35, Math.atan2(y1 - y0, len)));
      m.rotation.set(tip, Math.atan2(-dx, -dz), 0, 'YXZ');
    }
  }
  /** A beam's line follows the machine as it turns. */
  moveTelegraph(id: number, x: number, z: number, dx: number, dz: number, len: number, r: number) { const t = this.tele.find((q) => q.id === id && q.t < q.dur); if (t && !t.ring) this.placeTele(t, x, z, dx, dz, len, r); }
  endTelegraph(id: number) { for (const t of this.tele) if (t.id === id) { t.t = t.dur; t.mesh.visible = false; } }

  number(n: number, x: number, y: number, z: number, weak: boolean) {
    if (!this.showNumbers || n < 0.5) return;
    const el = document.createElement('div');
    el.textContent = String(Math.round(n)); if (weak) el.className = 'weak';
    this.numRoot.append(el);
    this.numbers.push({ el, t: 0, p: new THREE.Vector3(x, y, z) });
  }

  private makeTrap(tr: Trap): THREE.Object3D {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.9 }), vine = new THREE.MeshStandardMaterial({ color: 0x3f6a44, roughness: 0.9 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; g.add(o); return o; };
    if (tr.kind === 'snare') {
      // a spring-pole snare: a sapling bent over the noose and held by a trigger; a foot in the loop trips it, the pole
      // whips up and the cord holds the leg. Children: 0 noose, 1 pole (pivot at its foot), 2 cord
      add(new THREE.TorusGeometry(0.32, 0.018, 5, 14), vine, 0, 0.04, 0, Math.PI / 2);
      const pole = add(new THREE.CylinderGeometry(0.018, 0.035, 1.7, 5).translate(0, 0.85, 0), wood, 1.1, 0, 0, 0, SNARE_SET);
      void pole;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4).translate(0, 0.5, 0), vine); cord.frustumCulled = false; g.add(cord);
    }
    else if (tr.kind === 'stakes') for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.05, 0.9, 5), wood, (i - 2.5) * 0.36, 0.36, (i % 2) * 0.2, -0.75);
    else if (tr.kind === 'rattle') { add(new THREE.CylinderGeometry(0.02, 0.025, 1.1, 5), wood, 0, 0.55, 0); for (let i = 0; i < 3; i++) add(new THREE.DodecahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0x8a8580, flatShading: true }), 0.1 + i * 0.06, 0.95 - i * 0.14, 0); }
    else if (tr.kind === 'deadfall') {
      // children: 0 the slab (pivot at its back edge on the ground), 1 to 3 the figure-four sticks, 4 the bait
      const slab = new THREE.Group(); slab.position.set(0, 0, -0.32); g.add(slab);
      const sm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.62).translate(0, 0.035, 0.31), new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95, flatShading: true }));
      sm.castShadow = true; slab.add(sm); slab.rotation.x = -0.5;
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 4), wood, 0, 0.17, 0.02);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.42, 4), wood, 0, 0.3, -0.02, 0, 1.0);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), wood, 0.02, 0.1, 0.08, 1.45, 0);
      add(new THREE.SphereGeometry(0.06, 7, 5), new THREE.MeshStandardMaterial({ color: 0x3f6fd0, roughness: 0.5 }), 0.02, 0.06, 0.25);
    }
    else if (tr.kind === 'bait') add(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3f6fd0, roughness: 0.5 }), 0, 0.1, 0);
    else for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 4), wood, (i - 2) * 0.75, 0.04, Math.sin(i * 3) * 0.2, 0, Math.PI / 2);
    return g;
  }
  private makeFlame(id: number, big: boolean): { o: THREE.Object3D; id: number; light: THREE.PointLight | null } {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.75, 0.18), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < (big ? 5 : 3); i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 + (i % 2) * 0.06, 0.6 + (i % 3) * 0.2, 5), m); c.position.set(Math.cos(i * 2.4) * 0.16 * (big ? 1.6 : 1), 0.3, Math.sin(i * 2.4) * 0.16 * (big ? 1.6 : 1)); g.add(c); }
    if (big) { const logs = new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 1 }); for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1, 5), logs); l.rotation.set(Math.PI / 2, i * 0.8, 0.35); l.position.y = 0.12; g.add(l); } }
    let light: THREE.PointLight | null = null;
    // (the camp fire's light, against the sun's 4.6 at noon: at 70 with a fall-off of 1.7 (and the story's own camp-fire
    // light, 16, on top) a white coat a metre from the fire took about ten times full daylight and burned out to flat
    // orange-white (v16, v25, v26). Now about daylight at a metre, falling off gently: 2 at 3 m, 1.1 at 6 m)
    if (this.lights) { light = new THREE.PointLight(0xff9a45, big ? 5 : 16, big ? 22 : 9, big ? 0.9 : 1.7); light.position.y = 1.1; g.add(light); }
    return { o: g, id, light };
  }

  /** Bring the picture in line with the simulation: projectiles, traps, fires, pickups. */
  /** Rings of water spreading from the legs of someone standing in it (wading reads as wading, not as standing on
   * a floor that happens to be wet): one every half second or so standing, faster when the legs move. */
  private wadeRings: { m: THREE.Mesh; age: number }[] = []; private wadeT = 0;
  /** Faint rings on the surface over a fish (fx.wade's frame moves them on). */
  private fishRings: { m: THREE.Mesh; age: number }[] = [];
  ripple(x: number, z: number, surf: number, r0: number) {
    if (!this.fishRings.length) for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe6efe9, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 2; this.group.add(m); this.fishRings.push({ m, age: 9 });
    }
    const r = this.fishRings.reduce((a, b) => (b.age > a.age ? b : a));
    r.age = 0; r.m.position.set(x, surf + 0.01, z); r.m.userData.r0 = r0;
  }
  wade(x: number, z: number, surf: number | null, legs: number, moving: number, dt: number) {
    if (!this.wadeRings.length) for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdfe8e4, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 2; this.group.add(m); this.wadeRings.push({ m, age: 9 });
    }
    this.wadeT -= dt * (surf === null ? 0 : 1.6 + moving * 4);
    if (surf !== null && this.wadeT <= 0) {
      this.wadeT = 1;
      const r = this.wadeRings.reduce((a, b) => (b.age > a.age ? b : a));
      r.age = 0; r.m.position.set(x, surf + 0.012, z); r.m.userData.r0 = legs;
    }
    for (const r of this.fishRings) {
      r.age += dt; const k = r.age / 1.3;
      r.m.visible = k < 1;
      if (k < 1) { r.m.scale.setScalar((r.m.userData.r0 as number) + k * 0.38); (r.m.material as THREE.MeshBasicMaterial).opacity = 0.34 * (1 - k) * Math.min(1, k * 8); }
    }
    for (const r of this.wadeRings) {
      r.age += dt; const k = r.age / 1.6;
      r.m.visible = k < 1;
      if (k < 1) { const rad = (r.m.userData.r0 as number) + k * 0.55; r.m.scale.setScalar(rad); (r.m.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - k) * Math.min(1, k * 8); }
    }
  }

  sync(sim: CombatSim, dt: number, t: number, cam: THREE.Camera) {
    // particles
    for (let i = 0; i < N_PART; i++) {
      if (this.life[i] <= 0) { if (this.size[i]) this.size[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], k * 1.4);
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    const pg = this.points.geometry;
    pg.attributes.position.needsUpdate = true; pg.attributes.aCol.needsUpdate = true; pg.attributes.aSize.needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = window.innerHeight * 0.9;
    // projectiles
    let ns = 0, nh = 0, nb = 0, nd = 0;
    // how far the stick turns between two frames (50 rad/s of fight time): a full disc at a quarter turn a frame or more
    const simDt = Math.max(0, sim.t - this.lastSimT); this.lastSimT = sim.t;
    // (a faint sweep stays in slow motion too: without it the stick was a thin dark line lost in the grass, v7)
    this.blurU.uA.value = Math.max(0.2, Math.min(1, (simDt * 50) / 1.6)) * 0.55 * (0.35 + 0.65 * this.smokeK);
    for (const q of sim.proj) {
      if (!q.alive) continue;
      tmpV.set(q.vx, q.vy, q.vz).normalize();
      tmpQ.setFromUnitVectors(tmpS.set(0, 0, 1), tmpV);
      const w: WeaponId = q.weapon;
      if (w === 'rock' || w === 'sling') { tmpM.compose(tmpV.set(q.x, q.y, q.z), tmpQ, tmpS.set(1, 1, 1)); if (ns < 20) this.stones.setMatrixAt(ns++, tmpM); }
      else if (w === 'coil') { tmpM.compose(tmpV.set(q.x, q.y, q.z), tmpQ, tmpS.set(1, 1, 1.6)); if (nb < 12) this.bolts.setMatrixAt(nb++, tmpM); }
      else if (w === 'throwstick') {
        // end over end: it turns about the axis across its flight, about eight turns a second of the fight's own time
        // (wall time strobed it in slow motion: 125 degrees a frame at 23 frames a second)
        tmpM.compose(tmpV.set(q.x, q.y, q.z), tmpQ, tmpS.set(1, 1, 1)); if (nd < 6) this.blurs.setMatrixAt(nd++, tmpM);
        tmpQ.multiply(tmpQ2.setFromAxisAngle(tmpS.set(0, 1, 0), (sim.t * 50) % 6.283));
        // slowed down, the stick is seen turning rather than smeared: drawn a little fuller so it is not a thread
        const slowK = Math.max(0, Math.min(1, 1 - (simDt * 50) / 0.8)), th = 2.6 + 1.2 * slowK;
        tmpM.compose(tmpV.set(q.x, q.y, q.z), tmpQ, tmpS.set(th, th, 0.75 + 0.08 * slowK)); if (nh < 20) this.shafts.setMatrixAt(nh++, tmpM);
      }
      else { const sp = w === 'spear' || w === 'hafted', len = sp ? 2 : w === 'atlatl' ? 1.7 : w === 'crossbow' ? 0.45 : 0.75, thick = sp ? 1.9 : w === 'atlatl' ? 1.3 : 1.25; tmpM.compose(tmpV.set(q.x, q.y, q.z), tmpQ, tmpS.set(thick, thick, len)); if (nh < 20) this.shafts.setMatrixAt(nh++, tmpM); }
    }
    // spears and arrows that stuck stay where they fell until picked up
    for (const k of sim.pickups) {
      const y = this.height(k.x, k.z);
      if (k.weapon === 'throwstick') { tmpQ.setFromAxisAngle(tmpS.set(0, 1, 0), k.id * 1.7); tmpM.compose(tmpV.set(k.x, y + 0.04, k.z), tmpQ, tmpS.set(2.6, 2.6, 0.75)); if (nh < 20) this.shafts.setMatrixAt(nh++, tmpM); }
      else if (k.weapon === 'spear' || k.weapon === 'hafted' || k.item === 'arrow' || k.item === 'bolt' || k.item === 'dart') { tmpQ.setFromAxisAngle(tmpS.set(1, 0, 0), 0.9 + (k.id % 5) * 0.1); tmpM.compose(tmpV.set(k.x, y + (k.weapon ? 0.7 : 0.25), k.z), tmpQ, tmpS.set(k.weapon ? 1.9 : 1, k.weapon ? 1.9 : 1, k.weapon ? 2 : 0.75)); if (nh < 20) this.shafts.setMatrixAt(nh++, tmpM); }
      else if (k.item === 'stone') { tmpM.compose(tmpV.set(k.x, y + 0.06, k.z), tmpQ.identity(), tmpS.set(1.2, 1.2, 1.2)); if (ns < 20) this.stones.setMatrixAt(ns++, tmpM); }
    }
    this.stones.count = ns; this.shafts.count = nh; this.bolts.count = nb; this.blurs.count = nd; this.blurs.instanceMatrix.needsUpdate = true;
    this.stones.instanceMatrix.needsUpdate = true; this.shafts.instanceMatrix.needsUpdate = true; this.bolts.instanceMatrix.needsUpdate = true;
    // telegraphs
    for (const q of this.tele) { if (q.t >= q.dur) continue; q.t += dt; q.mat.uniforms.uK.value = Math.min(1, q.t / q.dur); if (q.t >= q.dur) q.mesh.visible = false; }
    // traps
    const seen = new Set<number>();
    for (const tr of sim.traps) {
      seen.add(tr.id);
      let o = this.props.get(tr.id);
      if (!o) { o = this.makeTrap(tr); o.position.set(tr.x, this.height(tr.x, tr.z), tr.z); this.group.add(o); this.props.set(tr.id, o); }
      o.visible = tr.kind === 'fireline' ? true : tr.armed || tr.kind === 'stakes' || tr.kind === 'snare';
      if (tr.kind === 'snare') this.snare(o, tr, sim, t);
      else if (tr.kind === 'deadfall') {
        // the stone comes down in a fifth of a second; the sticks and the bait are gone with it
        const k = tr.sprungT >= 0 ? Math.min(1, (sim.t - tr.sprungT) / 0.2) : 0;
        o.children[0].rotation.x = -0.5 * (1 - k * k) + (k >= 1 ? Math.sin((sim.t - tr.sprungT) * 30) * 0.02 * Math.max(0, 1 - (sim.t - tr.sprungT) * 3) : 0);
        for (let i = 1; i < o.children.length; i++) o.children[i].visible = k < 0.3;
        o.visible = true;
      }
    }
    for (const [id, o] of this.props) if (!seen.has(id)) { this.group.remove(o); this.props.delete(id); }
    // fires
    this.emberT -= dt;
    for (const f of sim.fires) {
      if (f.torch) continue;
      let fl = this.flames.find((q) => q.id === f.id);
      if (!fl) { fl = this.makeFlame(f.id, !f.burnsOut); fl.o.position.set(f.x, this.height(f.x, f.z), f.z); this.group.add(fl.o); this.flames.push(fl); }
      const k = Math.max(0, f.fuel / f.max), flick = 0.85 + Math.sin(t * 13 + f.id) * 0.1 + Math.sin(t * 7.3) * 0.07;
      fl.o.visible = true;
      fl.o.children.forEach((c, i) => { if ((c as THREE.Mesh).material instanceof THREE.MeshBasicMaterial) { c.visible = k > 0; c.scale.set(0.5 + k * 0.7, (0.3 + k * 1.1) * (0.8 + Math.sin(t * 9 + i * 2) * 0.25), 0.5 + k * 0.7); } });
      if (fl.light) fl.light.intensity = (f.burnsOut ? 16 : 5) * Math.sqrt(k) * flick;
      if (k > 0 && this.emberT <= 0) {
        this.puff('ember', f.x, this.height(f.x, f.z) + 0.5, f.z, 0, 0, 0.5);
        if (!f.burnsOut) this.puff('smoke', f.x, this.height(f.x, f.z) + 0.9 + k * 0.4, f.z, sim.windX * 5, sim.windZ * 5, 1);
      }
    }
    for (let i = this.flames.length - 1; i >= 0; i--) if (!sim.fires.some((f) => f.id === this.flames[i].id)) { this.group.remove(this.flames[i].o); this.flames.splice(i, 1); }
    if (this.emberT <= 0) this.emberT = 0.18;
    // spore clouds keep breathing while they hang
    for (const c of sim.clouds) if (Math.random() < dt * 5) this.puff('spore', c.x + (Math.random() - 0.5) * c.r, this.height(c.x, c.z) + 0.6, c.z + (Math.random() - 0.5) * c.r, 0, 0, 0.15);
    // numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i]; n.t += dt;
      tmpV.copy(n.p); tmpV.y += n.t * 0.9; tmpV.project(cam);
      n.el.style.transform = `translate(${((tmpV.x + 1) / 2) * window.innerWidth}px, ${((1 - tmpV.y) / 2) * window.innerHeight}px)`;
      n.el.style.opacity = String(Math.max(0, 1 - n.t / 0.9));
      if (n.t > 0.9 || tmpV.z > 1) { n.el.remove(); this.numbers.splice(i, 1); }
    }
    void UP;
  }

  /** The spring pole: bent and set, then snapped up with an overshoot; the cord runs to the caught leg while it holds. */
  private snare(o: THREE.Object3D, tr: Trap, sim: CombatSim, t: number) {
    const noose = o.children[0], pole = o.children[1], cord = o.children[2];
    if (!pole || !cord) return;
    const e = tr.caught ? sim.enemies.find((q) => q.id === tr.caught) : undefined;
    const since = tr.sprungT >= 0 ? sim.t - tr.sprungT : -1;
    const held = !!e && !e.dead && !e.gone && e.heldT > 0;
    let rz = SNARE_SET;
    if (since >= 0) {
      // a damped spring from bent to upright: about a tenth of a second up, then it shivers
      const up = SNARE_UP + (SNARE_SET - SNARE_UP) * Math.exp(-since * 9) * Math.cos(since * 26);
      rz = held ? up + Math.sin(t * 17) * 0.05 * Math.min(1, since * 3) + 0.18 : up;
    }
    pole.rotation.z = rz;
    noose.visible = since < 0;
    const tip = tmpV.set(0, 1.7, 0).applyEuler(pole.rotation).add(pole.position);
    if (since < 0) seg(cord, tmpS.set(0, 0.04, 0), tip);
    // to the caught hind leg, not the middle of the body
    else if (held) { const bx = e!.x - Math.sin(e!.yaw) * e!.def.radius * 0.8, bz = e!.z - Math.cos(e!.yaw) * e!.def.radius * 0.8; seg(cord, tip, o.worldToLocal(tmpS.set(bx, this.height(bx, bz) + 0.25, bz))); }
    else seg(cord, tip, tmpS.copy(tip).add(tmpV2.set(0.05, -0.5, 0)));
    cord.visible = true;
  }

  /** A fight is over: take its things off the ground. */
  clear() {
    for (const [, o] of this.props) this.group.remove(o);
    this.props.clear();
    for (const f of this.flames) this.group.remove(f.o);
    this.flames = [];
    for (const t of this.tele) { t.t = t.dur; t.mesh.visible = false; }
    for (const n of this.numbers) n.el.remove();
    this.numbers = [];
    this.life.fill(0); this.size.fill(0);
    this.stones.count = this.shafts.count = this.bolts.count = 0;
  }
}
