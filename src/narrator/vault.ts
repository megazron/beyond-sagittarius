import * as THREE from 'three';
import { createSpaceDome } from '../cinematic/space';
import { createCharacter, Character, CrewPose } from '../characters/character';
import { voice } from '../core/voice';
import { t } from '../i18n';
import { smoothstep } from '../core/noise';
import { audio } from '../core/audio';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Soft round sprite so dust near the lens isn't a square. */
function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, '#fff'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** One spoken line with a gesture and a camera set-up. */
export interface VaultLine { key: string; pose?: CrewPose; shot?: VaultShot; after?: number }
export type VaultShot = 'wide' | 'push' | 'close' | 'hands' | 'orrery' | 'window' | 'profile' | 'low';

const SHOTS: Record<VaultShot, { a: THREE.Vector3; b: THREE.Vector3; to: THREE.Vector3 }> = {
  wide: { a: V(0.15, 2.2, 3.7), b: V(-0.2, 2.2, 3.1), to: V(0, 2.05, 0) },
  push: { a: V(-1.1, 1.9, 4.2), b: V(-0.75, 1.92, 3.1), to: V(0, 1.85, 0) },
  close: { a: V(0.42, 2.14, 1.42), b: V(0.3, 2.14, 1.16), to: V(0, 2.18, 0) },
  profile: { a: V(1.7, 2.12, 0.5), b: V(1.45, 2.14, 0.62), to: V(0, 2.1, 0.1) },
  low: { a: V(-1.2, 0.5, 2.4), b: V(-0.95, 0.56, 2.1), to: V(0, 2.2, 0) },
  hands: { a: V(0.9, 1.75, 1.75), b: V(0.75, 1.65, 1.5), to: V(0, 1.22, 0.75) },
  orrery: { a: V(-2.6, 1.35, 1.8), b: V(-2.45, 1.6, 1.3), to: V(-3.2, 2.9, -1.6) },
  window: { a: V(0.3, 1.5, 3.2), b: V(0.1, 1.55, 2.2), to: V(0, 4.6, -18) },
};

/**
 * The Vault of the Last Ledger: an observatory-archive on the rim of
 * Sagittarius A*. A circular basalt-and-brass hall under a great oculus, with
 * the black hole hanging in the window, walls of glowing ledger slates, the
 * six-world orrery, and MegaZroN at his writing desk.
 */
export class Vault {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 20000);
  host!: Character;
  private dome = createSpaceDome();
  private orrery = new THREE.Group();
  private worlds: { m: THREE.Mesh; r: number; s: number; a: number }[] = [];
  private motes!: THREE.Points;
  private quill = new THREE.Group();
  private page!: THREE.MeshStandardMaterial;
  private halo = new THREE.PointLight(0xffc36a, 0, 5);
  private key = new THREE.PointLight(0xffd9a0, 7, 11);
  private built = false;
  private lines: VaultLine[] = [];
  private i = -1;
  private left = 0;
  private shot: VaultShot = 'wide';
  private shotT = 0;
  private shotLen = 1;
  private pose: CrewPose = 'idle';
  private time = 0;
  private onDone: (() => void) | null = null;
  playing = false;

  constructor(private subtitle: (key: string | null, speaker?: string) => void, private detail = 1) {}

  private build() {
    this.built = true;
    const s = this.scene;
    s.add(this.dome.mesh);
    const d = this.dome.uniforms;
    d.uBH.value = 1; d.uNebula.value = 1;
    d.uBHPos.value.set(0, 11, -46);
    d.uBHRot.value = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.32, 0, -0.26))).transpose();

    const basalt = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.3, metalness: 0.45 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.72 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4e, roughness: 0.34, metalness: 0.95 });
    const brassDark = new THREE.MeshStandardMaterial({ color: 0x6a4e2c, roughness: 0.5, metalness: 0.9 });

    // polished floor with inlaid rings (the room reflects the disk)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(11, 96), basalt);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    for (const r of [1.6, 3.1, 5.2, 8.4]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.035, 128), brass);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; s.add(ring);
    }
    // back wall opens onto the black hole: a horseshoe of pillars and shelves
    const slates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.42, 0.03), new THREE.MeshStandardMaterial({ color: 0x0c0e14, emissive: 0xffb35c, emissiveIntensity: 0.16, roughness: 0.4 }), 620);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); let n = 0;
    for (let k = 0; k < 16; k++) {
      const a = 0.72 + (k / 15) * (Math.PI * 2 - 1.44);
      const x = Math.sin(a) * 10, z = -Math.cos(a) * 10;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 13, 14), stone);
      pil.position.set(x, 6.5, z); pil.castShadow = true; s.add(pil);
      const cap = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 20), brass);
      cap.rotation.x = Math.PI / 2; cap.position.set(x, 0.32, z); s.add(cap);
      if (k < 15) for (let row = 0; row < 9; row++) for (let c = 0; c < 4; c++) {
        const aa = a + ((c + 0.75) / 5) * ((Math.PI * 2 - 1.44) / 15);
        const r = 10.05, y = 0.9 + row * 0.66;
        if (n >= 620 || ((row * 7 + c * 3 + k) % 5 === 0)) continue;
        e.set(0, -aa + Math.PI, (((row + c + k) % 4) - 1.5) * 0.02);
        m4.compose(V(Math.sin(aa) * r, y, -Math.cos(aa) * r), q.setFromEuler(e), V(1, 1, 1));
        slates.setMatrixAt(n++, m4);
      }
    }
    slates.count = n; s.add(slates);
    for (let row = 0; row < 10; row++) {
      const shelf = new THREE.Mesh(new THREE.TorusGeometry(10.2, 0.05, 6, 96, Math.PI * 2 - 1.44).rotateZ(-Math.PI / 2 + 0.72), brassDark);
      shelf.rotation.x = Math.PI / 2; shelf.position.y = 0.58 + row * 0.66; s.add(shelf);
    }
    // ceiling ring around the oculus
    const roof = new THREE.Mesh(new THREE.TorusGeometry(10.6, 1.1, 10, 96), stone); roof.rotation.x = Math.PI / 2; roof.position.y = 13; s.add(roof);

    // the writing desk and the Ledger
    const desk = new THREE.Group(); desk.position.set(0, 0, 0.82); s.add(desk);
    const wood = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.42 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.72), wood); top.position.y = 1.08; top.rotation.x = 0.24; top.castShadow = true; desk.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.24, 1.04, 12), wood); leg.position.y = 0.52; desk.add(leg);
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!; g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(40,24,14,0.85)'; for (let y = 22; y < 240; y += 13) for (const x0 of [24, 272]) { let x = x0; while (x < x0 + 214) { const w = 8 + ((x * 7 + y * 3) % 26); g.fillRect(x, y, w, 2.2); x += w + 5; } }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(253, 0, 6, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.page = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0xffc98a, emissiveMap: tex, emissiveIntensity: 0.05 });
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.07, 0.56), [wood, wood, this.page, wood, wood, wood]);
    book.position.set(0, 1.15, 0); book.rotation.x = 0.24; desk.add(book);
    // quill that keeps writing without a hand
    const feather = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.34, 8).rotateZ(Math.PI).scale(0.5, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0xf0ece0, emissive: 0xffc36a, emissiveIntensity: 0.15, roughness: 0.6 }));
    feather.position.y = 0.17; this.quill.add(feather); this.quill.position.set(0.3, 1.26, 0.86); this.quill.rotation.z = -0.5; s.add(this.quill);

    // the six-world orrery on the host's right
    const orr = this.orrery; orr.position.set(-3.2, 2.9, -1.6); s.add(orr);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.26, 2.9, 12), brassDark); stem.position.set(-3.2, 1.45, -1.6); s.add(stem);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1, metalness: 1 })); orr.add(core);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 8, 48), new THREE.MeshStandardMaterial({ color: 0x331a06, emissive: 0xff9a3c, emissiveIntensity: 3.2 })); coreRing.rotation.x = 1.3; orr.add(coreRing);
    [0x57b3ad, 0xc77d33, 0xc3a8ee, 0xe68a78, 0x6fa867, 0x4d70e0].forEach((col, i) => {
      const r = 0.62 + i * 0.22;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 72), brass);
      const tilt = new THREE.Group(); tilt.rotation.set(0.25 + i * 0.12, 0, (i - 2.5) * 0.09); tilt.add(ring); ring.rotation.x = Math.PI / 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06 + (i === 0 ? 0.02 : 0), 16, 12), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.3 }));
      tilt.add(m); orr.add(tilt);
      this.worlds.push({ m, r, s: 0.6 - i * 0.06, a: i * 1.1 });
    });

    // dust in the shafts of light
    const N = 500, p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 14; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = (Math.random() - 0.5) * 12; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd9a8, size: 0.018, map: dot(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.add(this.motes);

    // lighting: warm desk pool, hot rim from the disk behind him, cold fill from the shelves
    this.key.position.set(0.5, 1.75, 1.5); s.add(this.key);
    const rim = new THREE.SpotLight(0xff9a50, 70, 30, 0.42, 0.6);
    rim.position.set(1.8, 5.5, -7); rim.target.position.set(0, 1.9, 0); rim.castShadow = true; rim.shadow.mapSize.set(1024, 1024); rim.shadow.bias = -0.0004; s.add(rim, rim.target);
    const rim2 = new THREE.SpotLight(0x8fb4ff, 60, 26, 0.5, 0.8); rim2.position.set(-6, 4, 1.5); rim2.target.position.set(0, 1.9, 0); s.add(rim2, rim2.target);
    s.add(new THREE.HemisphereLight(0x5a668f, 0x241410, 1.9));
    // soft front fill so his face and coat read even in the wide shots
    const fill = new THREE.SpotLight(0xffe9d2, 120, 14, 0.34, 0.9); fill.position.set(0.9, 3.0, 4.6); fill.target.position.set(0, 2.1, 0); s.add(fill, fill.target);
    this.halo.position.set(0, 2.5, -0.2); s.add(this.halo);

    this.host = createCharacter('megazron', this.detail);
    s.add(this.host.root);
    this.dome.mesh.position.set(0, 0, 0);
  }

  /**
   * Builds the room and compiles its shaders ahead of time. Done on the first
   * real-GPU test run, this stall held the fade-in back for seconds, so the
   * scene sat nearly black long after it had started.
   */
  prepare(r: THREE.WebGLRenderer) {
    if (!this.built) this.build();
    this.update(0.016);
    r.compile(this.scene, this.camera);
  }

  /** Runs a scene; `done` fires when it ends or is skipped. */
  play(lines: VaultLine[], done: () => void) {
    if (!this.built) this.build();
    this.lines = lines;
    this.onDone = done;
    this.i = -1; this.left = 0;
    this.playing = true;
    this.pose = 'idle';
    voice.preload(lines.map((l) => l.key));
    audio.startDrone();
  }

  skip() { if (this.playing) this.finish(); }

  private finish() {
    this.playing = false;
    this.subtitle(null);
    voice.stop();
    audio.stopDrone();
    const f = this.onDone; this.onDone = null;
    f?.();
  }

  get lineIndex() { return this.i; }

  private next() {
    this.i++;
    if (this.i >= this.lines.length) { this.finish(); return; }
    const l = this.lines[this.i];
    this.subtitle(l.key, 'mz.name');
    const dur = voice.duration(l.key) ?? Math.max(2.2, t(l.key).length * 0.07);
    this.host.say(dur);
    this.left = dur + (l.after ?? 0.5);
    this.pose = l.pose ?? 'idle';
    this.shot = l.shot ?? 'push';
    this.shotT = 0;
    this.shotLen = this.left;
  }

  update(dt: number) {
    if (!this.built) return;
    this.time += dt;
    const t0 = this.time;
    if (this.playing) {
      this.left -= dt;
      if (this.left <= 0) { this.next(); if (!this.playing) return; }
    }
    const sh = SHOTS[this.shot];
    const k = smoothstep(0, 1, Math.min(1, this.shotT / this.shotLen));
    this.shotT += dt;
    this.camera.position.lerpVectors(sh.a, sh.b, k);
    this.camera.lookAt(sh.to);
    this.dome.mesh.position.copy(this.camera.position);
    this.dome.uniforms.uTime.value = t0;
    this.host.root.updateMatrixWorld();
    this.host.animate(this.pose, 0, 0, t0, dt);
    this.host.look2(0, 0);
    this.host.setLookTarget(this.pose === 'write' ? null : this.camera.position);
    const lvl = voice.level();
    this.halo.intensity = 0.5 + lvl * 2.5;
    this.key.intensity = 7 + Math.sin(t0 * 7.3) * 0.12 + Math.sin(t0 * 3.1) * 0.2;
    this.page.emissiveIntensity = 0.1 + lvl * 0.14;
    this.quill.position.x = 0.28 + Math.sin(t0 * 2.6) * 0.14;
    this.quill.position.z = 0.84 + (Math.sin(t0 * 0.37) * 0.5 + 0.5) * 0.14;
    this.quill.rotation.x = Math.sin(t0 * 7) * 0.06;
    this.orrery.rotation.y = t0 * 0.05;
    for (const w of this.worlds) { const a = w.a + t0 * w.s; w.m.position.set(Math.cos(a) * w.r, 0, Math.sin(a) * w.r); }
    this.motes.rotation.y = t0 * 0.01;
    this.motes.position.y = Math.sin(t0 * 0.1) * 0.1;
  }
}

/** Scene scripts. `s` says what the player actually did. */
export function vaultScript(id: 'intro' | 'l3' | 'l7' | 'ch1', s: { ateRed: boolean; deaths: number; bites: number; renamed: boolean }): VaultLine[] {
  switch (id) {
    case 'intro': return [
      { key: 'mz.intro.1', shot: 'wide', pose: 'stand' },
      { key: 'mz.intro.2', shot: 'push', pose: 'present' },
      { key: 'mz.intro.3', shot: 'orrery', pose: 'point' },
      { key: 'mz.intro.4', shot: 'hands', pose: 'write' },
      { key: 'mz.intro.5', shot: 'close', pose: 'idle' },
    ];
    case 'l3': return [
      { key: 'mz.l3.1', shot: 'wide', pose: 'stand' },
      { key: s.ateRed ? 'mz.l3.red' : 'mz.l3.safe', shot: 'hands', pose: 'write' },
      ...(s.deaths > 0 ? [{ key: 'mz.l3.died', shot: 'profile' as VaultShot, pose: 'present' as CrewPose }] : []),
      { key: 'j.8', shot: 'profile', pose: 'present' },
      { key: 'mz.l3.hint', shot: 'close', pose: 'idle' },
      { key: 'mz.l3.2', shot: 'window', pose: 'idle' },
    ];
    case 'l7': return [
      { key: 'mz.l7.1', shot: 'push', pose: 'present' },
      { key: s.bites === 0 ? 'mz.l7.clean' : 'mz.l7.bitten', shot: 'profile', pose: 'idle' },
      { key: 'mz.l7.2', shot: 'orrery', pose: 'point' },
      { key: 'mz.l7.hint', shot: 'close', pose: 'idle' },
    ];
    case 'ch1': return [
      { key: 'mz.ch1.1', shot: 'wide', pose: 'stand' },
      { key: s.renamed ? 'mz.ch1.names' : 'mz.ch1.nonames', shot: 'hands', pose: 'write' },
      { key: 'mz.ch1.2', shot: 'low', pose: 'present' },
      { key: 'mz.ch1.3', shot: 'window', pose: 'idle' },
      { key: 'mz.ch1.4', shot: 'close', pose: 'idle', after: 1.2 },
    ];
  }
}
