import * as THREE from 'three';
import { createSpaceDome, createEarth, createOrbitalRing, createPlanet } from './space';
import { createShip, createInterior } from './ship';
import { easeInOut, clamp, smoothstep, lerp } from '../core/noise';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { Cutscene, Beat, addCutsceneRig } from './cutscene';
import { deckScene, fightScene, stageDeck } from './scenes';
import { createCharacter, Character, CrewId, CrewPose } from '../characters/character';
import { flail, mixLimbs, FALL, STANDING } from './montage';
import type { PlayerLook, CrewSkins } from '../characters/custom';

export interface CineUI {
  subtitle(key: string | null, speakerKey?: string): void;
  caption(key: string | null): void;
  chapter(keys: string[] | null, solid?: boolean): void;
  mission(keys: string[] | null): void;
  aiAlert(key: string | null): void;
  fade(color: 'black' | 'white', to: number, seconds: number): void;
}

interface Cue { t: number; fn: () => void; done?: boolean; voiced?: boolean; key?: string; t0?: number }
interface Shot { start: number; end: number; enter?: () => void; update: (k: number, local: number) => void; done?: boolean }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Seconds of black before the first shot, for the chapter card. */
const PRE = -4.4;

export class Cinematic {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 40000);
  time = 0;
  playing = false;
  readonly duration = 120;
  private dome = createSpaceDome();
  private sunDir = V(1, 0.22, 0.55).normalize();
  private earth = createEarth(100, this.sunDir);
  private ring = createOrbitalRing(128);
  private ship = createShip();
  private interior = createInterior(matchMedia('(pointer: coarse)').matches ? 0.6 : 1);
  private mars = createPlanet(60, 'mars', this.sunDir);
  private giant = createPlanet(260, 'giant', this.sunDir);
  private home = createPlanet(400, 'home', V(0.86, 0.22, -0.46).normalize());
  private giantRing: THREE.Mesh;
  private sunLight = new THREE.DirectionalLight(0xfff2e0, 3.2);
  private sunDisc!: THREE.Mesh;
  private cues: Cue[] = [];
  private shots: Shot[] = [];
  private shake = 0;
  private lookTarget = new THREE.Vector3();
  private onDone: (() => void) | null = null;
  private bhRot = new THREE.Matrix3();

  constructor(private ui: CineUI) {
    const s = this.scene;
    s.add(this.dome.mesh);
    s.add(this.earth.group);
    this.ring.rotation.set(0.18, 0, 0.05);
    s.add(this.ring);
    s.add(this.ship.group);
    // at the origin, not parked far away: skinned faces lose centimetres of float precision out there.
    // Earth shares the spot, but the two are never on screen together.
    s.add(this.interior.group);
    this.mars.position.set(20000, 0, 0);
    s.add(this.mars);
    this.giant.position.set(40000, 0, 0);
    s.add(this.giant);
    this.home.visible = false;
    s.add(this.home);
    this.giantRing = new THREE.Mesh(
      new THREE.RingGeometry(330, 560, 128, 1),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        uniforms: { uSun: { value: this.sunDir } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vP; void main(){ float r = length(vP); float b = 0.5+0.5*sin(r*0.21)*sin(r*0.057);
          float a = smoothstep(330.0,350.0,r)*smoothstep(560.0,520.0,r)*(0.25+0.6*b);
          gl_FragColor = vec4(vec3(0.85,0.75,0.6)*1.2*b, a); }`,
      }),
    );
    this.giantRing.position.copy(this.giant.position);
    this.giantRing.rotation.set(-1.2, 0.2, 0);
    s.add(this.giantRing);

    // The sun
    const sun = this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 26, 20) }));
    sun.position.copy(this.sunDir).multiplyScalar(7000);
    s.add(sun);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(100);
    s.add(this.sunLight);
    s.add(new THREE.AmbientLight(0x223355, 0.35));

    this.bhRot.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.22, 0, 0.32))).transpose();
    this.dome.uniforms.uBHRot.value = this.bhRot;
    addCutsceneRig(this.scene);
    this.buildTimeline();
    this.idle(0);
  }

  private titleShift = 0;
  /** Slow orbital view of Earth used behind the title screen. */
  idle(dt: number) {
    this.time += dt;
    this.setVisible('earth');
    const a = this.time * 0.02;
    // Urdu puts the menu on the right: the planet eases over to the left so the menu never sits on it
    const want = document.documentElement.dir === 'rtl' && this.camera.aspect > 1.2 ? 0.36 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 300 * this.camera.aspect : 0;
    this.titleShift += (want - this.titleShift) * (dt > 0 ? 1 - Math.exp(-dt * 3) : 1);
    this.camera.position.set(Math.sin(a) * 40 - 70 + this.titleShift, 30, 300 + Math.cos(a) * 20);
    this.lookTarget.set(-20 + this.titleShift, 10, 0);
    this.camera.lookAt(this.lookTarget);
    this.ship.group.position.set(-28, 22, 205);
    this.ship.group.lookAt(V(-200, 40, 400));
    this.commonUpdate(dt);
  }

  start(onDone: () => void) {
    this.onDone = onDone;
    this.time = PRE;
    this.playing = true;
    this.fitToVoice();
    this.cues.forEach((c) => (c.done = false));
    this.shots.forEach((s) => (s.done = false));
    audio.startDrone();
  }

  /** Jump to a time (debug / screenshots). Earlier cues are marked done without firing. */
  seek(t: number) {
    if (!this.playing) return;
    t = this.warp(t);
    this.time = t;
    this.cues.forEach((c) => { if (c.t < t) c.done = true; });
    this.shots.forEach((s) => { if (s.end <= t) { s.enter?.(); s.done = true; } });
    this.ui.fade('black', 0, 0.2);
  }

  skip() {
    if (this.stage) { this.stage.skip(); return; } // skip the scene; a second tap skips the rest
    if (!this.playing) return;
    this.finish();
  }

  private stage: Cutscene | null = null;
  get staged() { return !!this.stage; }
  private get cast() {
    const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
    return Object.fromEntries(ids.map((id, i) => [id, this.interior.crew[i]])) as Record<CrewId, Character>;
  }
  /** Freeze the timeline for the character scene on the observation deck. */
  private holdDeck() {
    this.runStage(deckScene(this.cast, this.interior.group.position), () => {
      this.time = Math.max(this.time, this.warp(38.8));
      this.interior.crew.forEach((c) => c.root.rotation.set(0, Math.PI, 0));
    });
  }

  private runStage(beats: Beat[], done: () => void) {
    stageDeck(this.cast, -2.2);
    this.scene.updateMatrixWorld(true);
    this.stage = new Cutscene(beats, {
      camera: this.camera,
      scene: this.scene,
      actors: this.cast,
      subtitle: (k, sp) => this.ui.subtitle(k, sp),
      // inside the hull, off the floor, clear of the console
      cameraOk: (p) => Math.hypot(p.y, p.z) < 3.75 && p.y > -2.05 && Math.abs(p.x) < 5.6 && !(Math.abs(p.x) < 1.7 && p.z < -0.7),
      onDone: () => { this.stage = null; done(); },
    });
  }

  /** The player's figure and any crew skins on the deck. */
  setCast(look: PlayerLook, skins: CrewSkins) {
    const g = this.interior.group, crew = this.interior.crew, d = matchMedia('(pointer: coarse)').matches ? 0.6 : 1;
    const swap = (i: number, c: Character) => { const o = crew[i]; c.root.position.copy(o.root.position); c.root.rotation.copy(o.root.rotation); g.remove(o.root); g.add(c.root); crew[i] = c; };
    swap(0, createCharacter('scientist', d, look));
    swap(1, createCharacter('strong', d, undefined, skins.strong === 'suit' ? 'suit' : undefined));
  }

  /** Test hook: next beat of the running scene. */
  debugNext() { this.stage?.debugNext(); }

  /** Compile everything, including what is hidden at the title, so no shot stalls later. */
  async warm(draw: (scene: THREE.Scene, cam: THREE.PerspectiveCamera) => void) {
    const shown = [this.earth.group, this.ring, this.mars, this.giant, this.giantRing, this.home, this.interior.group, this.ship.group];
    const was = shown.map((o) => o.visible);
    shown.forEach((o) => (o.visible = true));
    await Promise.all(this.interior.crew.map((c) => c.whenReady));
    // the deck with the whole crew in view: their shaders, buffers and textures
    stageDeck(this.cast, -2.2);
    this.interior.crew.forEach((c) => { c.root.updateMatrixWorld(); c.animate('stand', 0, 0, 0, 0.016); });
    const cam = new THREE.PerspectiveCamera(110, 16 / 9, 0.05, 40000);
    cam.position.copy(this.interior.group.position).add(V(0, -0.6, 5));
    cam.lookAt(this.interior.group.position.clone().add(V(0, -1.2, 0)));
    cam.updateMatrixWorld();
    draw(this.scene, cam);
    shown.forEach((o, i) => (o.visible = was[i]));
    // and the exterior shots
    this.setVisible('earth');
    draw(this.scene, this.camera);
  }

  /** Back to the title backdrop. */
  resetIdle() { this.setVisible('earth'); this.dome.uniforms.uBH.value = 0; this.camera.fov = 45; this.camera.updateProjectionMatrix(); }

  /** Stand-alone flashback on the deck, used between levels. */
  playFlashback(done: () => void) {
    this.setVisible('interior');
    const d = this.dome.uniforms;
    d.uWarp.value = 0; d.uBH.value = 0; d.uNebula.value = 0.9;
    // a memory of the day before: nothing of the disaster may leak into it
    const i = this.interior;
    i.holo.uniforms.uAlarm.value = 0; i.holo.uniforms.uSpike.value = 0; i.alarmLight.intensity = 0; i.mainLight.intensity = 9; i.consoleLight.intensity = 2.2;
    for (const f of i.floaters) { f.position.copy(f.userData.base as THREE.Vector3); f.rotation.set(0, 0, 0); }
    this.interior.crew.forEach((c) => { c.armL.rotation.set(0, 0, 0); c.armR.rotation.set(0, 0, 0); });
    this.camera.fov = 42; this.camera.updateProjectionMatrix();
    this.flashback = true;
    this.runStage(fightScene(this.cast, this.interior.group.position), () => { this.flashback = false; done(); });
  }
  private flashback = false;
  get inFlashback() { return this.flashback; }

  private animateCrew(dt: number) {
    if (!this.interior.group.visible) return;
    const poses = this.stage?.poses;
    this.interior.crew.forEach((c) => {
      c.root.updateMatrixWorld();
      c.animate(poses?.[c.id as CrewId] ?? this.pullPose[c.id as CrewId] ?? 'stand', 0, 0, this.clockT, dt);
    });
  }
  private clockT = 0;

  private finish() {
    this.playing = false;
    this.stage = null;
    audio.alarm(false); audio.vacuum(false);
    audio.stopDrone();
    this.ui.subtitle(null); this.ui.caption(null); this.ui.mission(null); this.ui.aiAlert(null); this.ui.chapter(null);
    const cb = this.onDone; this.onDone = null;
    cb?.();
  }

  /** What the title sequence shoots with. */
  get set() {
    return { scene: this.scene, camera: this.camera, dome: this.dome, ship: this.ship, interior: this.interior, home: this.home, sun: this.sunLight, show: (g: 'interior' | 'deep' | 'home') => this.setVisible(g), tick: (dt: number) => { this.clockT += dt; this.time += dt; this.commonUpdate(dt); } };
  }

  private setVisible(group: 'earth' | 'mars' | 'giant' | 'interior' | 'deep' | 'home') {
    this.earth.group.visible = group === 'earth';
    this.ring.visible = group === 'earth';
    this.mars.visible = group === 'mars';
    this.giant.visible = group === 'giant';
    this.giantRing.visible = group === 'giant';
    this.interior.group.visible = group === 'interior';
    this.ship.group.visible = group !== 'interior' && group !== 'home';
    this.home.visible = group === 'home';
    this.sunDisc.visible = group === 'earth' || group === 'mars' || group === 'giant';
    this.sunLight.intensity = group === 'interior' ? 1.2 : 3.2; // no sun reaches the deck like open space
  }

  private cue(t: number, fn: () => void) { this.cues.push({ t, fn }); }
  /** A spoken cue: the timeline waits for the previous line to finish before firing it. */
  private vcue(t: number, key: string, fn: () => void) {
    this.cues.push({ t, voiced: true, key, fn: () => { this.speechEnd = this.clockT + (voice.duration(key) ?? 2) + 0.15; fn(); } });
  }
  private speechEnd = 0;
  private inserts: { at: number; by: number }[] = [];

  /**
   * Picture follows speech: where a line is longer than the time it was given, the shots around it stretch,
   * so nothing freezes and no line runs on after its action. Per language, since the takes differ in length.
   */
  private fitToVoice() {
    for (const c of this.cues) { c.t = c.t0 ??= c.t; }
    for (const s of this.shots as (Shot & { s0?: number; e0?: number })[]) { s.start = s.s0 ??= s.start; s.end = s.e0 ??= s.end; }
    this.inserts = [];
    const voiced = this.cues.filter((c) => c.key).sort((a, b) => a.t - b.t);
    voiced.forEach((c, i) => {
      const d = voice.duration(c.key!) ?? 2;
      const shot = this.shots.find((s) => s.start <= c.t && c.t < s.end);
      const next = voiced[i + 1]?.t ?? Infinity;
      const edge = Math.min(next, shot?.end ?? Infinity);
      const need = c.t + d + 0.2 - edge;
      if (need <= 0 || edge === Infinity) return;
      this.inserts.push({ at: edge - 0.001, by: need });
      for (const x of this.cues) if (x.t >= edge - 0.001) x.t += need;
      for (const s of this.shots) { if (s.start >= edge - 0.001) s.start += need; if (s.end >= edge - 0.001) s.end += need; }
    });
  }

  /** A time on the written timeline, on the stretched one. */
  private warp(t: number) { let o = t; for (const k of this.inserts) if (o >= k.at) o += k.by; return o; }

  private buildTimeline() {
    const ui = this.ui;
    const d = this.dome.uniforms;
    const ship = this.ship;
    const shipDir = V(-0.55, 0.12, 0.83).normalize();
    const shipStart = V(-6, 20, 170);

    // ---- Scene 1: Departure ----
    // the chapter card stands on its own black before the first picture, never on top of the planet
    // (the card brings its own black: the fade layer sits above the cinematic and would hide it)
    this.cue(-4.1, () => { ui.chapter(['cine.year', 'cine.chapter'], true); ui.fade('black', 0, 0); });
    this.cue(-0.02, () => { ui.fade('black', 1, 0); ui.chapter(null); });
    this.vcue(5.4, 'cine.caption1', () => ui.caption('cine.caption1'));
    this.cues.push({ t: 14.0, voiced: true, fn: () => ui.caption(null) });
    this.vcue(14.2, 'cine.line1', () => ui.subtitle('cine.line1', 'crew.explorer.name'));
    this.vcue(16.0, 'cine.line2', () => ui.subtitle('cine.line2', 'crew.strong.name'));
    this.vcue(18.0, 'cine.line3', () => ui.subtitle('cine.line3', 'crew.social.name'));
    this.cue(22.2, () => ui.subtitle(null));
    this.cue(15.4, () => { ui.mission(['cine.mission1', 'cine.mission2', 'cine.mission3', 'cine.mission4']); audio.beep(); });
    this.cue(21.6, () => ui.mission(null));
    this.cue(17.5, () => audio.whoosh());

    this.shots.push({
      start: 0, end: 7.5,
      enter: () => { this.setVisible('earth'); ui.fade('black', 0, 2.5); d.uNebula.value = 0.5; d.uBH.value = 0; d.uWarp.value = 0; d.uOther.value = 0; },
      update: (k) => {
        const e = easeInOut(k);
        this.camera.position.lerpVectors(V(-140, 70, 380), V(-60, 32, 265), e);
        this.lookTarget.lerpVectors(V(0, 0, 0), V(-10, 14, 120), e);
        ship.group.position.copy(shipStart);
        ship.group.lookAt(shipStart.clone().add(shipDir));
        (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 0;
      },
    });
    this.shots.push({
      start: 7.5, end: 15.2,
      update: (k) => {
        const a = lerp(-0.9, 0.5, easeInOut(k));
        const dist = lerp(16, 12, k);
        const c = shipStart.clone().add(V(Math.sin(a) * dist, 3.5 - k * 1.5, Math.cos(a) * dist));
        this.camera.position.copy(c);
        this.lookTarget.copy(shipStart).add(V(0, 0.5, 0));
        ship.ring.rotation.z += 0.004;
      },
    });
    this.shots.push({
      start: 15.2, end: 22.2,
      update: (k, local) => {
        const accel = Math.max(0, local - 1.8);
        const travel = accel * accel * 3.5;
        const p = shipStart.clone().addScaledVector(shipDir, travel);
        ship.group.position.copy(p);
        (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = smoothstep(1.2, 2.4, local) * 1.4;
        ship.engineGlow.color.setRGB(0.6 + smoothstep(1, 2.5, local) * 3, 1.4 + smoothstep(1, 2.5, local) * 4, 4 + smoothstep(1, 2.5, local) * 8);
        const camBase = shipStart.clone().add(V(-9, 2.5, -14));
        this.camera.position.copy(camBase).addScaledVector(shipDir, travel * 0.25);
        this.lookTarget.copy(p);
        this.shake = smoothstep(1.5, 2.5, local) * 0.06 * (1 - k);
        ship.ring.rotation.z += 0.004;
      },
    });

    // ---- Scene 2: Journey montage ----
    this.vcue(22.4, 'cine.caption2', () => ui.caption('cine.caption2'));
    this.cue(27.5, () => ui.caption(null));
    this.cue(28.6, () => ui.caption('cine.montage'));
    this.cue(32.6, () => ui.caption(null));
    this.shots.push({
      start: 22.2, end: 28.2,
      enter: () => { this.setVisible('mars'); ui.fade('black', 0, 0.6); d.uWarp.value = 0.25; },
      update: (k) => {
        const base = this.mars.position;
        const p = base.clone().add(V(lerp(-160, 160, k), 30, 110));
        ship.group.position.copy(p);
        ship.group.lookAt(p.clone().add(V(1, 0, 0.05)));
        (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 1.2;
        this.camera.position.copy(base).add(V(lerp(-140, 120, k) - 14, 34, 128));
        this.lookTarget.copy(p);
        d.uWarpDir.value.set(1, 0, 0);
        this.mars.rotation.y += 0.0008;
      },
    });
    this.shots.push({
      start: 28.2, end: 33.4,
      enter: () => { this.setVisible('giant'); d.uNebula.value = 1.15; d.uWarp.value = 0.15; },
      update: (k) => {
        const base = this.giant.position;
        const p = base.clone().add(V(lerp(-480, -220, k), 140, 620));
        ship.group.position.copy(p);
        ship.group.lookAt(p.clone().add(V(1, -0.1, -0.3)));
        this.camera.position.copy(p).add(V(lerp(-18, -10, k), 4, 22));
        this.lookTarget.copy(p).lerp(base, 0.0004 + k * 0.0004);
        this.giant.rotation.y += 0.0006;
      },
    });

    // ---- Interior: the impossible reading ----
    this.cue(33.5, () => this.holdDeck());
    const intr = this.interior;
    this.shots.push({
      start: 33.4, end: 39.0,
      enter: () => {
        this.setVisible('interior'); d.uWarp.value = 0; d.uNebula.value = 0.9; d.uBH.value = 1;
      },
      update: (k, local) => {
        const b = intr.group.position;
        const e = easeInOut(k);
        this.camera.position.copy(b).add(V(lerp(2.6, 1.2, e), lerp(-0.4, -0.7, e), lerp(3.4, 2.4, e)));
        this.lookTarget.copy(b).add(V(lerp(0.2, 0, e), -0.8, -2.2));
        d.uBHPos.value.set(-40, 18, -420);
        intr.holo.uniforms.uSpike.value = smoothstep(0.5, 2.5, local) + smoothstep(5.5, 7, local);
        intr.holo.uniforms.uAlarm.value = smoothstep(6.3, 7, local);
        const sci = intr.crew[0];
        sci.root.rotation.y = Math.PI + lerp(0, 0.9, smoothstep(0.5, 1.5, local)) - lerp(0, 0.9, smoothstep(2.5, 3.5, local));
        for (let i = 1; i < intr.crew.length; i++) {
          const c = intr.crew[i];
          const lean = smoothstep(1.2 + i * 0.25, 3 + i * 0.25, local);
          c.root.position.z = lerp(c.root.position.z, 0.2 + (i % 2) * 0.5, lean * 0.02);
        }
        intr.alarmLight.intensity = local > 6.4 ? (Math.sin(local * 8) * 0.5 + 0.5) * 40 : 0;
      },
    });

    // ---- The pull into Sagittarius (Scene 3 of the design doc, beat for beat) ----
    // Tension in steps, each small and each worse than the last; then control goes; then the Event. One cause, then
    // its effect. Nobody with nothing to do moves. The tearing apart itself is the title sequence (montage.ts).
    const S = 39.0, FLOOR = -2.2;
    const at = (x: number, y: number, z: number) => intr.group.position.clone().add(V(x, y, z));
    const [sci, drx, lyr, sky, bol, nuv] = intr.crew;
    const put = (c: Character, x: number, z: number, ry: number, y = FLOOR) => { c.root.position.set(x, y, z); c.root.rotation.set(0, ry, 0); };
    const talk = (c: Character, key: string) => c.say((voice.duration(key) ?? 2));
    const calm = () => intr.crew.forEach((c) => { c.setLimbs(null); c.setFace(null); c.look2(0, 0); });
    const lounge = () => { put(drx, -0.3, 1.9, Math.PI * 0.62); put(nuv, -1.5, 1.35, -Math.PI * 0.35); put(lyr, 1.2, 1.8, Math.PI * 0.9); put(sky, 2.0, 0.9, Math.PI * 1.05); put(bol, -2.6, 0.7, Math.PI * 0.75); };
    const AMBER = new THREE.Color(0xffa020), RED = new THREE.Color(0xff2a1a), COOL = new THREE.Color(0xcfe6ff), GOLD = new THREE.Color(0xffc45a);
    // the console's screen only where someone is reading it; elsewhere it filled the frame behind the faces
    const holoMesh = intr.group.children.find((m) => (m as THREE.Mesh).material === intr.holo);
    const holoOn = (on: boolean) => { if (holoMesh) holoMesh.visible = on; };
    const floatUp = (g: number, local: number, slide = 0) => { for (const f of intr.floaters) { const base = f.userData.base as THREE.Vector3, spin = f.userData.spin as THREE.Vector3; f.position.set(base.x + slide * (0.6 + f.userData.rise), base.y + g * f.userData.rise * local * 0.5, base.z); f.rotation.x += spin.x * 0.016 * g; f.rotation.y += spin.y * 0.016 * g; f.rotation.z += spin.z * 0.016 * g; } };

    // 1. The instruments drift. Zenvik alone at the console; the needle creeps; the hum is one note lower.
    this.cue(S + 0.2, () => { calm(); audio.tone(58, 7, 'sine', 0.22, 0, -9); });
    this.shots.push({
      start: S, end: S + 3.4,
      enter: () => { holoOn(true); this.setVisible('interior'); lounge(); put(sci, 0.15, -0.75, Math.PI); intr.alarmLight.intensity = 0; intr.mainLight.color.copy(COOL); intr.mainLight.intensity = 9; intr.mainLight.position.set(0, 2.5, 0.5); intr.holo.uniforms.uAlarm.value = 0; d.uBH.value = 1; d.uWarp.value = 0; },
      update: (k, local) => {
        this.camera.position.copy(at(lerp(1.5, 1.25, k), -0.85, -2.5)); this.lookTarget.copy(at(0.1, -0.7, -0.8));
        intr.holo.uniforms.uSpike.value = 0.15 + local * 0.22 + (local > 1.7 ? 0.25 : 0);
        sci.setFace({ squint: 0.3 + 0.3 * k, frown: 0.25 * k }); sci.look2(0, 0.25);
        d.uBHPos.value.set(-40, 18, -420);
      },
    });
    // 2. The stars smear, all bent the same way. He has not looked up yet. We have.
    this.shots.push({
      start: S + 3.4, end: S + 6.4,
      update: (k) => {
        this.camera.position.copy(at(0.9, -0.5, 2.7)); this.lookTarget.copy(at(lerp(0.2, -0.6, k), lerp(-0.3, 0.2, k), -6));
        d.uWarp.value = smoothstep(0, 1, k) * 0.55; d.uWarpDir.value.set(-0.6, 0.3, -1).normalize();
        d.uBHPos.value.set(-40, 18, -lerp(420, 300, k));
      },
    });
    // 3. Denial. The drink leans in the glass. The last laugh in the film.
    this.cue(S + 6.45, () => { drx.doTask('use', { seconds: 6.5, prop: 'cup', hands: 'R' }); });
    this.vcue(S + 6.9, 'pull.strong', () => { ui.subtitle('pull.strong', 'crew.strong.name'); talk(drx, 'pull.strong'); });
    this.vcue(S + 9.6, 'pull.builder', () => { ui.subtitle('pull.builder', 'crew.builder.name'); talk(bol, 'pull.builder'); });
    this.shots.push({
      start: S + 6.4, end: S + 13.4,
      update: (k, local) => {
        this.camera.position.copy(at(lerp(1.9, 1.5, k), -0.9, 3.5)); this.lookTarget.copy(at(-0.9, -0.85, 1.5));
        this.roll = 0.035 * smoothstep(0, 1, k);
        this.pullPose.social = 'selfie'; // she is filming him
        drx.setFace({ squint: 0.2, frown: 0.2 }); drx.look2(0.5, 0.35);
        nuv.setFace({ smile: 0.7 * (1 - smoothstep(4.5, 6, local)) }); lyr.setFace({ smile: 0.4 * (1 - smoothstep(3, 5, local)) });
        bol.setFace(local > 3.2 ? { smile: 0.5 * (1 - smoothstep(4.6, 6.2, local)), fear: 0.4 * smoothstep(5, 6.5, local) } : null);
        floatUp(0, 0, k * 0.25);
        d.uWarp.value = 0.55;
      },
    });
    // 4. The jokes die. Zenvik, too calm. Then the ship says it.
    this.vcue(S + 13.7, 'cine.line4', () => { ui.subtitle('cine.line4', 'crew.scientist.name'); talk(sci, 'cine.line4'); });
    this.vcue(S + 16.1, 'cine.ai1', () => { ui.subtitle(null); ui.aiAlert('cine.ai1'); audio.alarm(true); });
    this.cue(S + 20.4, () => { ui.aiAlert(null); audio.alarm(false); });
    this.shots.push({
      start: S + 13.4, end: S + 20.5,
      enter: () => { holoOn(true); this.pullPose = {}; },
      update: (k, local) => {
        this.camera.position.copy(at(lerp(-2.0, -1.85, k), -0.75, -1.9)); // outside the screen's edge this.lookTarget.copy(at(0.2, -0.7, lerp(-0.6, 0.6, smoothstep(2.4, 4, local))));
        this.roll = 0.035;
        sci.root.rotation.y = Math.PI - lerp(0, 2.2, smoothstep(0.1, 1.0, local)) + lerp(0, 2.2, smoothstep(2.6, 3.6, local));
        sci.setFace({ fear: 0.25, squint: 0.2 }); sci.look2(0, 0);
        const turn = smoothstep(1.2, 2.6, local);
        for (const c of [drx, lyr, sky, bol, nuv]) { c.setFace({ fear: 0.2 * turn }); c.root.rotation.y = lerp(c.root.rotation.y, Math.PI, turn * 0.06); }
        intr.holo.uniforms.uSpike.value = 1 + smoothstep(2.6, 4, local); intr.holo.uniforms.uAlarm.value = smoothstep(2.6, 3.2, local) * 0.6;
        intr.alarmLight.color.copy(AMBER); intr.alarmLight.intensity = local > 2.7 ? 6 + Math.sin(local * 5) * 4 : 0;
      },
    });

    // 5. The pilot fights it. The engines answer and the ship does not.
    this.vcue(S + 20.9, 'pull.pilot', () => ui.subtitle('pull.pilot', 'crew.pilot.name'));
    this.vcue(S + 23.6, 'pull.ai1', () => { ui.subtitle(null); ui.aiAlert('pull.ai1'); audio.thud(); });
    this.cue(S + 27.9, () => ui.aiAlert(null));
    this.cue(S + 20.6, () => { audio.whoosh(); audio.tone(44, 6.5, 'sawtooth', 0.12, 0, 14); });
    this.shots.push({
      start: S + 20.5, end: S + 28.0,
      enter: () => { this.setVisible('deep'); d.uBH.value = 1; d.uNebula.value = 0.8; calm(); },
      update: (k, local) => {
        const p = V(80000, 0, 0);
        ship.group.position.copy(p).add(V(Math.sin(local * 1.3) * 0.25, 0, 0));
        ship.group.lookAt(p.clone().add(V(-0.12 * k, 0.05 * k, -1)));
        ship.group.rotateZ(0.32 * easeInOut(k) + Math.sin(local * 2.1) * 0.02);
        const strain = 0.9 + 0.7 * Math.abs(Math.sin(local * 5.3)) * (local < 3.6 ? 1 : Math.max(0, 1 - (local - 3.6) * 1.4));
        (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = strain;
        ship.engineGlow.color.setRGB(0.4 * strain, 1.2 * strain, 3 * strain);
        this.camera.position.copy(p).add(V(lerp(6, 3.5, k), lerp(2.6, 1.5, k), lerp(15, 11.5, k)));
        this.lookTarget.copy(p).add(V(0, 0.8, -20));
        d.uBHPos.value.set(-4, 7, -lerp(170, 95, easeInOut(k)));
        d.uWarp.value = 0.2 + k * 0.2; d.uWarpDir.value.set(0, 0, -1);
        this.shake = 0.02 + 0.03 * k;
      },
    });
    // 6. Everything slides. The floor is no longer down.
    this.cue(S + 28.05, () => audio.thud());
    this.vcue(S + 29.0, 'cine.line8', () => { ui.subtitle('cine.line8', 'crew.strong.name'); talk(drx, 'cine.line8'); });
    this.shots.push({
      start: S + 28.0, end: S + 33.6,
      enter: () => { holoOn(false); this.setVisible('interior'); lounge(); put(sci, 0.15, -0.75, Math.PI); },
      update: (k, local) => {
        const tilt = easeInOut(clamp(local / 2.2, 0, 1));
        this.camera.position.copy(at(-4.3, -0.7, 2.2)); this.lookTarget.copy(at(0.2, -0.9, 0.9));
        this.roll = 0.035 + 0.3 * tilt; this.shake = 0.02;
        const sl = (c: Character, x0: number, z0: number, go: number, ry: number) => { const g = smoothstep(0, 1, clamp((local - go) / 2.4, 0, 1)); put(c, x0 + g * 1.5, z0 - g * 0.2, ry); return g; };
        // Lyrra catches Nuvexa's wrist as she goes past
        const gn = sl(nuv, -1.5, 1.35, 0.3, Math.PI * 0.6); nuv.setLimbs(mixLimbs(STANDING, { ...FALL.spread, armL: [0.9, 0.35, 0.3], foreL: [1, 0.25, 0.3] }, gn)); nuv.setFace({ fear: 0.7 * gn, open: 0.4 * gn });
        put(lyr, 1.25, 1.5, -Math.PI * 0.45); lyr.setLimbs(mixLimbs(STANDING, { ...STANDING, armR: [-0.9, 0.15, 0.45], foreR: [-1, 0.1, 0.3], legL: [0.3, -1, 0.1], legR: [-0.25, -1, -0.1] }, smoothstep(1.2, 2.2, local))); lyr.setFace({ frown: 0.5, squint: 0.3 });
        // Draxum plants his feet and takes Bolzar's weight on one arm
        put(drx, -0.3, 1.9, Math.PI * 0.75); drx.setLimbs(mixLimbs(STANDING, { ...STANDING, legL: [0.45, -1, 0.1], shinL: [0.2, -1, 0], legR: [-0.4, -1, -0.15], shinR: [-0.2, -1, 0], armL: [1, -0.1, 0.35], foreL: [0.9, 0.2, 0.5] }, smoothstep(0.2, 1.4, local))); drx.setFace({ frown: 0.7, open: 0.2 });
        const gb = sl(bol, -2.6, 0.7, 0.1, Math.PI * 0.4); bol.root.position.x = Math.min(bol.root.position.x, -1.15); bol.setLimbs(mixLimbs(STANDING, FALL.spread, gb * 0.7)); bol.setFace({ fear: 0.6 * gb });
        const gs = sl(sky, 2.0, 0.9, 0.5, Math.PI); sky.setLimbs(mixLimbs(STANDING, FALL.spread, gs * 0.5)); sky.setFace({ fear: 0.4 * gs });
        const gz = sl(sci, 0.15, -0.75, 0.6, Math.PI); sci.root.position.x = Math.min(sci.root.position.x, 0.75); sci.setLimbs(mixLimbs(STANDING, { ...STANDING, armL: [0.5, -0.2, 0.9], foreL: [0.3, 0.1, 1] }, gz)); sci.setFace({ fear: 0.4 });
        floatUp(0, 0, 0.25 + tilt * 2.2);
        intr.alarmLight.color.copy(AMBER); intr.alarmLight.intensity = 5 + Math.sin(local * 5) * 3;
      },
    });
    // 7. Zenvik reaches the main screen. It is not simply the black hole.
    this.vcue(S + 34.0, 'pull.sci2', () => { ui.subtitle('pull.sci2', 'crew.scientist.name'); talk(sci, 'pull.sci2'); });
    this.shots.push({
      start: S + 33.6, end: S + 39.6,
      enter: () => { holoOn(true); calm(); put(sci, 0.2, -0.95, Math.PI); },
      update: (k, local) => {
        // from beyond the screen's edge, so its grid never lies across his face
        this.camera.position.copy(at(lerp(1.7, 1.55, k), -0.6, lerp(-1.6, -1.7, k))); this.lookTarget.copy(at(0.15, -0.62, -0.95));
        this.roll = 0.3;
        intr.holo.uniforms.uSpike.value = 2 + k; intr.holo.uniforms.uAlarm.value = 0.8;
        sci.setLimbs({ ...STANDING, armL: [0.35, -0.5, 0.8], foreL: [0.2, 0.1, 1], armR: [-0.35, -0.5, 0.8], foreR: [-0.2, 0.1, 1] });
        sci.setFace({ fear: 0.45 + 0.25 * k, open: 0.1 }); sci.look2(lerp(0, -0.5, smoothstep(2.8, 3.8, local)), lerp(0.3, -0.25, smoothstep(2.8, 3.8, local)));
        intr.alarmLight.color.copy(AMBER); intr.alarmLight.intensity = 5 + Math.sin(local * 5) * 3;
      },
    });
    // 8. The black fills the windows. No golden disk: the gas round Sagittarius A* is thin and faint, a haze that
    // flickers, a flare going round at a third of the speed of light, stars bent into rings round the black.
    this.cue(S + 39.7, () => { ui.subtitle(null); audio.tone(36, 6, 'sine', 0.35, 0, 22); });
    this.shots.push({
      start: S + 39.6, end: S + 45.4,
      enter: () => { holoOn(false); calm(); put(sci, 0.2, -0.9, Math.PI); put(drx, -1.3, -0.3, Math.PI); put(nuv, -2.3, 0.1, Math.PI); put(lyr, 1.5, -0.2, Math.PI); put(sky, 2.5, 0.1, Math.PI); put(bol, -3.3, 0.4, Math.PI); intr.alarmLight.intensity = 0; },
      update: (k) => {
        const e = easeInOut(k);
        this.camera.position.copy(at(lerp(0.7, 0.3, e), lerp(-0.9, -0.6, e), lerp(3.6, 2.9, e))); this.lookTarget.copy(at(-0.4, lerp(-0.4, 0.1, e), -6));
        this.roll = 0.3 - 0.1 * e;
        d.uBHPos.value.set(lerp(-6, -2.5, e), lerp(9, 3.5, e), -lerp(70, 15, e)); d.uWarp.value = 0.4 + 0.4 * e;
        intr.mainLight.color.copy(COOL).lerp(GOLD, e * 0.5); intr.mainLight.position.set(lerp(0, -3.2, e), lerp(2.5, 0.4, e), lerp(0.5, -2.6, e)); intr.mainLight.intensity = 9 - 3 * e + 4 * Math.max(0, Math.sin(this.clockT * 2.7)) * e; // the gas round it is thin and faint; a flare goes by
        intr.crew.forEach((c, i) => { c.setFace({ fear: 0.3 + 0.4 * e, open: 0.15 * e }); c.look2(0.25 - i * 0.05, -0.3 * e); });
        this.shake = 0.012 * e;
      },
    });
    // 9. The lights fail, deck by deck, towards us. Red strips. The ship gives its numbers.
    this.vcue(S + 45.9, 'cine.ai2', () => { ui.aiAlert('cine.ai2'); audio.alarm(true); audio.thud(); });
    this.shots.push({
      start: S + 45.4, end: S + 51.2,
      update: (k, local) => {
        this.camera.position.copy(at(-4.6, -0.55, 0.9)); this.lookTarget.copy(at(1.2, -0.8, 0.2));
        this.roll = 0.2; this.shake = 0.03;
        const stepDown = local < 0.7 ? 1 : local < 1.5 ? 0.55 : local < 2.3 ? 0.2 : 0.04;
        intr.mainLight.color.copy(GOLD); intr.mainLight.intensity = 16 * stepDown; intr.consoleLight.intensity = 0.5;
        intr.alarmLight.color.copy(RED); intr.alarmLight.intensity = local > 2.3 ? (Math.sin(local * 9) * 0.5 + 0.5) * 22 : 0;
        intr.crew.forEach((c) => c.setFace({ fear: 0.7, open: 0.2 }));
      },
    });

    // 10. The alarms scream, then cut out one by one. No signal. What is left is a rumble, breath and a heartbeat.
    this.cue(S + 51.3, () => { ui.aiAlert(null); audio.alarm(false); audio.vacuum(true); ui.mission(['pull.nosignal']); });
    this.cue(S + 54.2, () => ui.mission(null));
    // 11. The artificial gravity shuts down. Objects float. Draxum hits the ceiling. Skyvra has the handrail.
    this.cue(S + 54.1, () => { audio.thud(); this.shake = 0.12; });
    this.shots.push({
      start: S + 51.2, end: S + 57.6,
      update: (k, local) => {
        this.camera.position.copy(at(lerp(3.9, 3.4, k), lerp(-1.5, -1.2, k), 2.7)); this.lookTarget.copy(at(-0.4, lerp(-0.6, 0.1, k), 0));
        this.roll = 0.2 - 0.2 * k;
        const g = smoothstep(0.3, 1.6, local);
        floatUp(g, local, 2.4);
        intr.mainLight.intensity = 0.6; intr.alarmLight.color.copy(RED); intr.alarmLight.intensity = 5 + Math.sin(local * 2.2) * 3;
        // Draxum: thrown upward, takes it on the shoulder
        const up = smoothstep(0.9, 2.9, local), hit = smoothstep(2.9, 3.05, local);
        drx.root.position.set(-1.3 + up * 0.3, FLOOR + up * up * 2.55, -0.3 + up * 0.5); drx.root.rotation.set(-up * 1.1 - hit * 0.25, Math.PI, up * 0.5);
        drx.setLimbs(flail(FALL.strong, local, 3.1, 0.3 + 0.3 * (1 - hit))); drx.setFace({ fear: 0.6, open: 0.5 * (1 - hit), frown: hit * 0.8, squint: hit * 0.7 });
        // Skyvra: one hand on the rail, her body swinging out
        const sw = smoothstep(0.6, 2.4, local);
        sky.root.position.set(2.5, FLOOR + sw * 0.75, 0.1 - sw * 0.5); sky.root.rotation.set(sw * (0.9 + Math.sin(local * 1.6) * 0.18), Math.PI, sw * Math.sin(local * 1.3) * 0.25);
        sky.setLimbs(mixLimbs(STANDING, { ...FALL.spread, armR: [-0.25, 0.6, 1], foreR: [-0.1, 0.5, 1] }, sw)); sky.setFace({ fear: 0.6 * sw, frown: 0.3 });
        for (const [c, i] of [[sci, 0], [lyr, 2], [bol, 4], [nuv, 5]] as [Character, number][]) {
          const u = smoothstep(1 + i * 0.12, 4.5, local);
          c.root.position.y = FLOOR + u * (0.35 + (i % 3) * 0.12) + Math.sin(local * 1.4 + i) * 0.04 * u;
          c.root.rotation.x = -u * 0.25; c.root.rotation.z = (i % 2 ? 1 : -1) * u * 0.22;
          c.setLimbs(mixLimbs(STANDING, flail({ ...FALL.spread, openHands: true }, local, i * 2.9, 0.2), u * 0.8)); c.setFace({ fear: 0.7, open: 0.25 });
        }
      },
    });
    // 12. The edge is close. At a black hole this big the tide across the ship is under one per cent of a g: what is
    // breaking the ship is its own engines, run past their limits to climb out. Outside, the black is past half the
    // sky and the rest of the universe is squeezing into a bright band behind them.
    this.cue(S + 57.8, () => { audio.tone(41, 4.6, 'sine', 0.2, 0, -6); ui.mission(['pull.horizon1', 'pull.horizon2', 'pull.horizon3']); audio.beep(); });
    this.cue(S + 62.2, () => ui.mission(null));
    this.shots.push({
      start: S + 57.6, end: S + 62.0,
      update: (k, local) => {
        const e = easeInOut(k);
        this.camera.position.copy(at(lerp(0.9, 0.5, e), lerp(-0.4, -0.2, e), lerp(2.2, 1.2, e))); this.lookTarget.copy(at(-0.3, lerp(-0.1, 0.4, e), -6));
        d.uBHPos.value.set(-1.5, lerp(3, 0.5, e), -lerp(15, 6.5, e)); d.uWarp.value = 0.8; d.uNebula.value = 0.9 + 0.8 * e;
        floatUp(1, 6 + local, 2.4);
        intr.mainLight.intensity = 0.6 + 5 * e; intr.alarmLight.intensity = 3 + Math.sin(local * 2.2) * 2;
      },
    });
    // 13. What home will see. Zenvik, quietly: to anyone watching from outside they never cross. They slow, redden, and
    // fade at the edge. Nuvexa's stream is the last thing that got out.
    this.vcue(S + 62.6, 'pull.sci3', () => { ui.subtitle('pull.sci3', 'crew.scientist.name'); talk(sci, 'pull.sci3'); });
    this.shots.push({
      start: S + 62.0, end: S + 66.6,
      enter: () => { holoOn(false); put(sci, 0.2, -0.95, Math.PI * 0.85, FLOOR + 0.3); put(nuv, 1.0, -0.6, Math.PI * 1.3, FLOOR + 0.35); },
      update: (k, local) => {
        sci.root.getWorldPosition(this.lookTarget).add(V(0.25, 1.6, 0));
        this.camera.position.copy(this.lookTarget).add(V(lerp(0.2, 0.35, k), 0.05, -1.5));
        sci.setLimbs(mixLimbs(STANDING, FALL.spread, 0.25)); sci.setFace({ fear: 0.5, squint: 0.2 }); sci.look2(-0.3, -0.1);
        nuv.setLimbs(mixLimbs(STANDING, FALL.spread, 0.3)); nuv.setFace({ fear: 0.7 }); nuv.look2(0.5, 0.2); this.pullPose.social = 'selfie';
        intr.alarmLight.intensity = 3 + Math.sin(local * 1.1) * 2;
      },
    });
    // 14. The screens stop making sense. Then his line, in full voice.
    this.cue(S + 68.9, () => audio.vacuum(false));
    this.vcue(S + 69.2, 'pull.pods', () => { ui.subtitle('pull.pods', 'crew.scientist.name'); talk(sci, 'pull.pods'); audio.alarm(true); });
    this.shots.push({
      start: S + 66.6, end: S + 72.4,
      enter: () => { holoOn(true); this.pullPose = {}; put(sci, -0.9, -0.95, Math.PI * 1.25, FLOOR + 0.35); },
      update: (k, local) => {
        const along = easeInOut(clamp(local / 2.4, 0, 1));
        sci.root.position.set(lerp(-0.9, 0.15, along), FLOOR + 0.35 + Math.sin(local * 2.4) * 0.03, -0.95);
        const turn = smoothstep(2.5, 3.1, local);
        sci.root.rotation.set(-0.3 * (1 - turn), lerp(Math.PI * 1.25, Math.PI * 0.15, turn), 0.15 * (1 - turn));
        const reach = Math.sin(local * 3.2);
        sci.setLimbs(turn < 0.5 ? { ...FALL.spread, armL: [0.3, 0.1, 1], foreL: [0.2, reach > 0 ? 0.3 : -0.2, 1], armR: [-0.3, 0.1, 1], foreR: [-0.2, reach > 0 ? -0.2 : 0.3, 1] } : { ...FALL.spread, armR: [-0.9, 0.5, 0.3], foreR: [-0.6, 0.9, 0.3] });
        sci.setFace({ fear: 0.8, open: turn * 0.7, frown: 0.3 });
        this.camera.position.copy(at(lerp(0.9, 0.6, k), -0.9, lerp(-2.6, 0.9, turn))); this.lookTarget.copy(at(sci.root.position.x, FLOOR + 1.85, -0.95));
        intr.holo.uniforms.uSpike.value = 3 + Math.sin(local * 23) * 1.5; intr.holo.uniforms.uAlarm.value = 1;
        intr.alarmLight.intensity = turn > 0.5 ? (Math.sin(local * 9) * 0.5 + 0.5) * 22 : 5;
        floatUp(1, 11 + local, 2.4);
      },
    });
    // the tearing apart, the white and the scatter are the title sequence: montage.ts
    this.cue(S + 72.4, () => { holoOn(true); ui.subtitle(null); audio.alarm(false); calm(); intr.crew.forEach((c) => c.root.rotation.set(0, Math.PI, 0)); intr.group.scale.set(1, 1, 1); this.roll = 0; this.pullPose = {}; audio.vacuum(false); this.finish(); });
  }

  /** Camera roll for the shot in hand (the deck tilting), and poses the pull gives the crew outside a staged scene. */
  private roll = 0;
  private pullPose: Partial<Record<CrewId, CrewPose>> = {};

  update(dt: number) {
    this.clockT += dt;
    if (this.stage) {
      this.stage.update(dt);
      this.animateCrew(dt);
      this.commonUpdate(dt);
      return;
    }
    if (!this.playing) return;
    const next = this.time + dt;
    // hold the picture rather than talk over a line (Hindi and Urdu run longer)
    const blocked = this.clockT < this.speechEnd && this.cues.some((c) => c.voiced && !c.done && c.t <= next);
    if (!blocked) this.time = next;
    const t = this.time;
    for (const c of this.cues) if (!c.done && t >= c.t) { c.done = true; c.fn(); if (!this.playing) return; }
    this.animateCrew(dt);
    for (const s of this.shots) {
      if (t >= s.start && t < s.end) {
        if (!s.done) {
          s.done = true;
          this.camera.fov = 45; this.camera.updateProjectionMatrix();
          s.enter?.();
        }
        const local = t - s.start;
        this.roll = 0;
        s.update(clamp(local / (s.end - s.start), 0, 1), local);
        break;
      }
    }
    this.camera.lookAt(this.lookTarget);
    if (this.roll) this.camera.rotateZ(this.roll);
    this.commonUpdate(dt);
  }

  private commonUpdate(dt: number) {
    const time = this.time;
    if (this.shake > 0) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.3;
    }
    this.dome.mesh.position.copy(this.camera.position);
    this.dome.uniforms.uTime.value = time;
    this.earth.uniforms.uTime.value = time;
    this.earth.earth.rotation.y += dt * 0.01;
    this.earth.clouds.rotation.y += dt * 0.013;
    (this.ship.plume.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    this.interior.holo.uniforms.uTime.value = time;
    this.ship.lights.color.setRGB(Math.sin(time * 4) > 0.6 ? 6 : 0.3, 0.3, 0.2);
    this.shake = Math.max(0, this.shake - dt * 0.02);
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => mm.dispose());
      }
    });
  }
}
