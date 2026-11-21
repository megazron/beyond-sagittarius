import * as THREE from 'three';
import { createSpaceDome, createEarth, createOrbitalRing, createPlanet } from './space';
import { createShip, createInterior } from './ship';
import { easeInOut, clamp, smoothstep, lerp } from '../core/noise';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { Cutscene, Beat, addCutsceneRig } from './cutscene';
import { deckScene, fightScene, stageDeck } from './scenes';
import { createCharacter, Character, CrewId, CrewPose, type Face } from '../characters/character';
import { flail, mixLimbs, FALL, STANDING } from './montage';
import { defaultLook, type PlayerLook, type CrewSkins } from '../characters/custom';
import { createInserts, type Inserts } from './inserts';

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
  private ins!: Inserts;
  private pilot!: Character;

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
    this.ins = createInserts(this.interior.group);
    this.pilot = createCharacter('scientist', matchMedia('(pointer: coarse)').matches ? 0.6 : 1, { ...defaultLook(), name: 'Pilot', gender: 'f', hair: 'medic', outfit: 'explorer', hairRoot: 0x2a1a14, hairTip: 0x6a4a34, accent: 0x6fe3ff, skin: 0xb98463, horns: false, tail: false });
    this.pilot.root.position.set(0, -2.2, -0.1); this.pilot.root.rotation.set(0, Math.PI, 0); this.ins.cockpit.add(this.pilot.root);
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
    if (t > 0) this.ui.chapter(null); // its hide cue was skipped with the rest: the card would stay over every shot
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
  async warm(draw: (scene: THREE.Scene, cam: THREE.PerspectiveCamera) => void | Promise<void>) {
    const shown = [this.earth.group, this.ring, this.mars, this.giant, this.giantRing, this.home, this.interior.group, this.ship.group, this.ins.cockpit];
    const was = shown.map((o) => o.visible);
    shown.forEach((o) => (o.visible = true));
    await Promise.all([...this.interior.crew, this.pilot].map((c) => c.whenReady));
    this.pilot.root.updateMatrixWorld(); this.pilot.animate('stand', 0, 0, 0, 0.016);
    // the deck with the whole crew in view: their shaders, buffers and textures
    stageDeck(this.cast, -2.2);
    this.interior.crew.forEach((c) => { c.root.updateMatrixWorld(); c.animate('stand', 0, 0, 0, 0.016); });
    const cam = new THREE.PerspectiveCamera(110, 16 / 9, 0.05, 40000);
    cam.position.copy(this.interior.group.position).add(V(0, -0.6, 5));
    cam.lookAt(this.interior.group.position.clone().add(V(0, -1.2, 0)));
    cam.updateMatrixWorld();
    await draw(this.scene, cam);
    shown.forEach((o, i) => (o.visible = was[i]));
    // and the exterior shots
    this.setVisible('earth');
    await draw(this.scene, this.camera);
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
    if (this.ins.cockpit.visible) { this.pilot.root.updateMatrixWorld(); this.pilot.animate('sit', 0, 0, this.clockT, dt); }
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

  private setVisible(group: 'earth' | 'mars' | 'giant' | 'interior' | 'deep' | 'home' | 'cockpit') {
    this.ins.cockpit.visible = group === 'cockpit';
    this.earth.group.visible = group === 'earth';
    this.ring.visible = group === 'earth';
    this.mars.visible = group === 'mars';
    this.giant.visible = group === 'giant';
    this.giantRing.visible = group === 'giant';
    this.interior.group.visible = group === 'interior';
    this.ship.group.visible = group !== 'interior' && group !== 'home' && group !== 'cockpit';
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
    // the crew are fetched again at every shot: setCast swaps the player's figure and Draxum's in after this was built,
    // and a reference taken here acted on figures that were no longer in the scene
    let [sci, drx, lyr, sky, bol, nuv] = intr.crew;
    const fresh = () => { [sci, drx, lyr, sky, bol, nuv] = intr.crew; };
    const put = (c: Character, x: number, z: number, ry: number, y = FLOOR) => { c.root.position.set(x, y, z); c.root.rotation.set(0, ry, 0); };
    const talk = (c: Character, key: string) => c.say((voice.duration(key) ?? 2));
    const calm = () => intr.crew.forEach((c) => { c.setLimbs(null); c.setFace(null); c.look2(0, 0); });
    const lounge = () => { put(drx, -0.3, 1.9, Math.PI * 0.62); put(nuv, -1.5, 1.35, -Math.PI * 0.35); put(lyr, 1.2, 1.8, Math.PI * 0.9); put(sky, 2.0, 0.9, Math.PI * 1.05); put(bol, -2.6, 0.7, Math.PI * 0.75); };
    const AMBER = new THREE.Color(0xffa020), RED = new THREE.Color(0xff2a1a), COOL = new THREE.Color(0xcfe6ff), GOLD = new THREE.Color(0xffc45a);
    // the console's screen only where someone is reading it; elsewhere it filled the frame behind the faces
    const holoMesh = intr.group.children.find((m) => (m as THREE.Mesh).material === intr.holo);
    const holoOn = (on: boolean) => { if (holoMesh) holoMesh.visible = on; };
    const floatUp = (g: number, local: number, slide = 0) => { for (const f of intr.floaters) { const base = f.userData.base as THREE.Vector3, spin = f.userData.spin as THREE.Vector3; f.position.set(base.x + slide * (0.6 + f.userData.rise), base.y + g * f.userData.rise * local * 0.5, base.z); f.rotation.x += spin.x * 0.016 * g; f.rotation.y += spin.y * 0.016 * g; f.rotation.z += spin.z * 0.016 * g; } };

    // ==== The pull into Sagittarius, shot by shot (~/bs-story/SHOTLIST_pull_and_fates.md, A1 to G7) ====
    // The line of action runs between Zenvik at the console's left end and the five by the window at the right: the
    // camera stays on the room side (+z), so Zenvik is always screen left, the group and the window screen right, the
    // ship travels left to right outside and the galactic centre sits screen right. Lenses are full-frame focal
    // lengths (vertical field of view 2 atan(12 / mm)). Every named thing has its insert; every line lands on a face.
    const lens = (mm: number) => { this.camera.fov = 2 * Math.atan(12 / mm) * 180 / Math.PI; this.camera.updateProjectionMatrix(); };
    const ins = this.ins;
    const head = (c: Character, dy = 0) => new THREE.Vector3().setFromMatrixPosition(c.head.matrixWorld).add(V(0, 0.1 + dy, 0));
    const hand = (c: Character, r = true) => (r ? c.handR : c.handL).getWorldPosition(new THREE.Vector3());
    const WIN = at(1.0, -0.6, -3.6); // a point out of the window, for eyelines
    const group = () => { put(drx, 2.3, -1.9, Math.PI * 1.15); put(nuv, 1.4, -1.6, Math.PI * 0.82); put(lyr, 3.2, -1.5, Math.PI * 1.1); put(sky, 2.7, -2.55, Math.PI); put(bol, 4.0, -2.2, Math.PI * 1.2); };
    const atConsole = () => put(sci, -0.85, -0.62, Math.PI);
    const exterior = (local: number, k: number, strain = 0) => {
      const p = V(80000, 0, 0);
      ship.group.position.copy(p); ship.group.lookAt(p.clone().add(V(1, 0, -0.08))); // left to right across the screen
      ship.group.rotateZ(Math.sin(local * 0.7) * 0.01 + strain * 0.05);
      (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 0.5 + strain * (0.9 + 0.5 * Math.abs(Math.sin(local * 5.3)));
      ship.engineGlow.color.setRGB(0.4 + strain, 1.2 + strain, 3 * (1 + strain));
      return { p, k };
    };
    const shotAt = (start: number, end: number, sh: Omit<Shot, 'start' | 'end'>) => this.shots.push({ start, end, enter: () => { fresh(); sh.enter?.(); }, update: (k, l) => { fresh(); sh.update(k, l); } });

    // ---- A. Something is wrong ----
    this.cue(S + 0.2, () => { calm(); audio.tone(58, 7, 'sine', 0.22, 0, -9); });
    // A1 extreme wide: the liner small, crossing left to right, the bright centre ahead at screen right
    shotAt(S, S + 3.2, {
      enter: () => { this.setVisible('deep'); d.uBH.value = 1; d.uNebula.value = 0.9; d.uWarp.value = 0; holoOn(true); ins.warn(null); group(); atConsole(); },
      update: (k, local) => {
        const { p } = exterior(local, k);
        lens(35); this.camera.position.copy(p).add(V(lerp(-60, -40, k), 6, 150)); this.lookTarget.copy(p).add(V(lerp(10, 25, k), 2, 0));
        d.uBHPos.value.set(260, 10, -420);
      },
    });
    // A2 the master: five laughing by the window, Zenvik alone at the console, back left
    shotAt(S + 3.2, S + 6.2, {
      enter: () => { this.setVisible('interior'); holoOn(false); group(); atConsole(); intr.mainLight.color.copy(COOL); intr.mainLight.intensity = 9; intr.mainLight.position.set(0, 2.5, 0.5); intr.alarmLight.intensity = 0; intr.holo.uniforms.uAlarm.value = 0; this.pullPose.social = 'selfie'; },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(0.9, -0.75, 3.1)); this.lookTarget.copy(at(1.1, -1.1, -1.4));
        for (const [c, ph] of [[drx, 0], [nuv, 0.7], [lyr, 1.3], [sky, 0.4], [bol, 1.9]] as [Character, number][]) { c.setFace({ smile: 0.55 + 0.25 * Math.max(0, Math.sin(local * 2.1 + ph)) }); c.setLookTarget(head(nuv)); }
        nuv.setLookTarget(head(drx)); sci.setFace({ squint: 0.2 }); sci.look2(0, 0.45);
        ins.gauge(-0.02 * k);
      },
    });
    // A3 insert: the nav gauge. The needle creeps a hair left; a tick; it creeps again
    this.cue(S + 7.3, () => audio.tone(2400, 0.02, 'square', 0.05));
    this.cue(S + 8.4, () => audio.tone(2400, 0.02, 'square', 0.05));
    shotAt(S + 6.2, S + 9.0, {
      update: (k, local) => {
        const g = ins.gaugeAt; g.updateMatrixWorld(); const c0 = g.getWorldPosition(new THREE.Vector3()), n = V(0, 0, 1).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()));
        lens(85); this.camera.position.copy(c0).addScaledVector(n, 0.5).add(V(-0.36, 0.12, 0)); this.lookTarget.copy(c0); // past his left hip, not through him
        ins.gauge(-0.02 - 0.05 * smoothstep(0.9, 1.3, local) - 0.05 * smoothstep(2.0, 2.4, local));
      },
    });
    // A4 close-up: Zenvik. He wants it to be a sensor fault. Brows draw together; a slow blink; eyes to the window and back
    shotAt(S + 9.0, S + 11.6, {
      update: (k, local) => {
        lens(85); const h = head(sci, -0.12); this.camera.position.copy(h).add(V(lerp(0.75, 0.62, k), -0.06, -1.55)); this.lookTarget.copy(h);
        sci.setFace({ frown: smoothstep(0, 0.8, local) * 0.55, squint: 0.25, blink: local > 1.1 && local < 1.35 ? 1 : 0 });
        sci.setLookTarget(local < 1.4 ? ins.gaugeAt.getWorldPosition(new THREE.Vector3()) : local < 2.1 ? WIN : ins.gaugeAt.getWorldPosition(new THREE.Vector3()));
      },
    });
    // A5 his eyeline through the window: near the core the stars are short arcs, all bent the same way
    shotAt(S + 11.6, S + 14.4, {
      update: (k) => { lens(50); this.camera.position.copy(at(-0.7, -0.5, -0.4)); this.lookTarget.copy(at(1.6, -0.2, -6)); d.uWarp.value = smoothstep(0, 1, k) * 0.55; d.uWarpDir.value.set(-0.6, 0.3, -1).normalize(); d.uBHPos.value.set(-40, 18, -lerp(420, 330, k)); },
    });
    // A6 Skyvra at the window, her back to us; she turns, head first, then her body; a half smile that does not hold
    this.vcue(S + 15.0, 'op.17', () => { ui.subtitle('op.17', 'crew.explorer.name'); talk(sky, 'op.17'); });
    shotAt(S + 14.4, S + 18.4, {
      enter: () => { this.pullPose = {}; },
      update: (k, local) => {
        lens(50); this.camera.position.copy(at(2.2, -0.6, 0.2)); this.lookTarget.copy(head(sky, -0.15));
        const turn = smoothstep(0.2, 1.1, local), body = smoothstep(0.6, 1.6, local);
        sky.root.rotation.y = Math.PI - body * 2.3; sky.look2(turn * 0.6 * (1 - body), 0);
        sky.setFace({ smile: 0.35 * smoothstep(0.8, 1.2, local) * (1 - smoothstep(2.4, 3.2, local)), frown: 0.3 * smoothstep(2.6, 3.4, local) });
        sky.setLookTarget(local > 1.4 ? head(drx) : null);
        d.uWarp.value = 0.55;
      },
    });

    // ---- B. Denial ----
    this.cue(S + 18.4, () => { drx.doTask('use', { seconds: 8, prop: 'cup', hands: 'R' }); this.pullPose.social = 'selfie'; });
    // B1 the last normal moment: Nuvexa filming Draxum, who poses with his cup
    shotAt(S + 18.4, S + 20.4, {
      enter: () => { sky.root.rotation.y = Math.PI - 2.3; put(drx, 2.3, -1.9, 0.25); put(nuv, 1.7, -0.9, 2.6); },
      update: (k) => {
        lens(50); const m = head(drx).add(head(nuv)).multiplyScalar(0.5); this.camera.position.copy(m).add(V(1.3, -0.25, 2.1)); this.lookTarget.copy(m).add(V(0, -0.25, 0));
        drx.setFace({ smile: 0.6 }); drx.look2(0, -0.15); nuv.setFace({ smile: 0.8 }); nuv.setLookTarget(head(drx));
      },
    });
    // B2 insert: the drink. Its surface leans and creeps up one side; a drop climbs the rim. The room stays level
    const CUP = at(2.25, -1.05, -1.45);
    this.cue(S + 20.6, () => audio.tone(180, 0.5, 'sine', 0.05, 0, -40));
    this.vcue(S + 21.9, 'pull.strong', () => { ui.subtitle('pull.strong', 'crew.strong.name'); talk(drx, 'pull.strong'); });
    shotAt(S + 20.4, S + 23.0, {
      update: (k, local) => {
        ins.cup(CUP, 0.42 * smoothstep(0.2, 2.0, local), smoothstep(0.8, 2.4, local), smoothstep(1.6, 2.6, local));
        lens(100); this.camera.position.copy(CUP).add(V(-0.05, 0.11, 0.34)); this.lookTarget.copy(CUP).add(V(0, 0.005, 0));
      },
    });
    // B3 close-up: Draxum looks down at the cup, blinks, looks up at the others; the joke shape stays a beat too long
    shotAt(S + 23.0, S + 25.4, {
      enter: () => ins.cup(null),
      update: (k, local) => {
        lens(85); const h = head(drx, -0.1); this.camera.position.copy(h).add(V(0.45, 0.18, 1.45)); this.lookTarget.copy(h);
        drx.setLookTarget(local < 1.0 ? hand(drx) : head(lyr)); drx.setFace({ smile: 0.45 * (1 - smoothstep(1.4, 2.0, local)), blink: local > 0.9 && local < 1.1 ? 1 : 0, fear: 0.25 * smoothstep(1.6, 2.4, local) });
      },
    });
    // B4 Bolzar by the hull panel. The first "It'll hold" a grin; the third flat; his hand stops on the panel
    this.vcue(S + 25.6, 'pull.builder', () => { ui.subtitle('pull.builder', 'crew.builder.name'); talk(bol, 'pull.builder'); });
    shotAt(S + 25.4, S + 29.4, {
      enter: () => { put(bol, 4.3, -1.6, Math.PI * 1.45); },
      update: (k, local) => {
        lens(50); const h = head(bol, -0.2); this.camera.position.copy(h).add(V(-1.3, -0.05, 1.5)); this.lookTarget.copy(h);
        bol.setLimbs(mixLimbs(STANDING, { ...STANDING, armL: [0.6, -0.1, 0.8], foreL: [0.5, 0.2, 0.9] }, smoothstep(0.2, 0.8, local)));
        bol.setFace({ smile: 0.6 * (1 - smoothstep(1.6, 2.6, local)), fear: 0.4 * smoothstep(2.4, 3.2, local) }); bol.setLookTarget(local < 2.4 ? head(drx) : at(5, -0.6, -1.6));
      },
    });

    // ---- C. The jokes die ----
    // C1 over Zenvik's shoulder: the group turning to him. He swallows before the line
    this.vcue(S + 30.1, 'cine.line4', () => { ui.subtitle('cine.line4', 'crew.scientist.name'); talk(sci, 'cine.line4'); });
    shotAt(S + 29.4, S + 31.8, {
      enter: () => { put(bol, 4.0, -2.2, Math.PI * 1.2); bol.setLimbs(null); sci.root.rotation.y = Math.PI * 0.55; this.pullPose = {}; drx.stopTask(); },
      update: (k, local) => {
        lens(50); const h = head(sci); this.camera.position.copy(h).add(V(-0.75, 0.05, 0.55)); this.lookTarget.copy(at(2.4, -0.8, -1.9));
        sci.setFace({ fear: 0.2 }); const turn = smoothstep(0.6, 1.6, local);
        for (const c of [drx, nuv, lyr, sky, bol]) { c.setLookTarget(turn > 0.3 ? head(sci) : null); c.setFace({ smile: 0.4 * (1 - turn) }); }
      },
    });
    // C2 reaction, held: five faces, the laughter gone, each stopping at a different moment (Lyrra first, Nuvexa last)
    shotAt(S + 31.8, S + 33.8, {
      update: (k, local) => {
        lens(35); this.camera.position.copy(at(0.6, -0.55, 0.9)); this.lookTarget.copy(at(2.8, -0.7, -1.9));
        const stop = (c: Character, t0: number) => { const g = smoothstep(t0, t0 + 0.4, local); c.setFace({ smile: 0.3 * (1 - g), fear: 0.3 * g }); c.setLookTarget(head(sci)); };
        stop(lyr, 0.0); stop(sky, 0.3); stop(drx, 0.5); stop(bol, 0.8); stop(nuv, 1.3);
        this.pullPose.social = local < 1.3 ? 'selfie' : undefined as unknown as CrewPose;
      },
    });
    // C3 insert: the console screen says it; amber washes over the room
    this.vcue(S + 34.0, 'cine.ai1', () => { ui.subtitle(null); ui.aiAlert('cine.ai1'); audio.alarm(true); });
    this.cue(S + 42.6, () => { ui.aiAlert(null); audio.alarm(false); });
    shotAt(S + 33.8, S + 42.6, {
      enter: () => { this.pullPose = {}; ins.warn(['WARNING', 'UNIDENTIFIED GRAVITATIONAL DISTURBANCE', 'NAVIGATION: ANOMALOUS DEVIATION']); holoOn(false); },
      update: (k, local) => {
        lens(50); const w = ins.warnAt; const c0 = w.getWorldPosition(new THREE.Vector3()), n = V(0, 0, 1).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
        this.camera.position.copy(c0).addScaledVector(n, lerp(2.0, 1.75, k)); this.lookTarget.copy(c0);
        intr.alarmLight.color.copy(AMBER); intr.alarmLight.intensity = 6 + Math.sin(local * 5) * 4;
      },
    });

    // ---- D. Loss of control: the cockpit, established wide before its close shots ----
    this.cue(S + 42.6, () => { audio.whoosh(); audio.tone(44, 13, 'sawtooth', 0.12, 0, 14); ins.warn(null); });
    // D1 wide from behind and above the pilot: she is already fighting it
    shotAt(S + 42.6, S + 44.8, {
      enter: () => { this.setVisible('cockpit'); d.uBHPos.value.set(-6, 4, -160); ins.attitude(0, 0); },
      update: (k, local) => {
        lens(24); const c = ins.cockpit.position; this.camera.position.copy(c).add(V(0.5, 0.0, 1.6)); this.lookTarget.copy(c).add(V(-0.1, -1.2, -1.6));
        this.pilot.setLimbs({ ...STANDING, armR: [-0.15, -0.55, 0.8], foreR: [-0.05, -0.2, 1], armL: [0.25, -0.6, 0.75], foreL: [0.1, -0.3, 1] });
        this.pilot.setLookTarget(c.clone().add(V(0, -0.9, -2.4))); this.pilot.setFace({ frown: 0.6, squint: 0.4 });
        ins.stick.rotation.x = -0.25 - Math.sin(local * 6) * 0.03; ins.attitude(0.08 + local * 0.03, -0.1);
        this.shake = 0.01;
      },
    });
    // D2 insert: her hands on the stick, pushing. Between the "come on"s a held breath
    this.vcue(S + 45.0, 'pull.pilot', () => { ui.subtitle('pull.pilot', 'crew.pilot.name'); this.pilot.say(voice.duration('pull.pilot') ?? 3.9); });
    shotAt(S + 44.8, S + 49.0, {
      update: (k, local) => {
        lens(50); const g = ins.stick.getWorldPosition(new THREE.Vector3()).add(V(0, 0.3, 0)); this.camera.position.copy(g).add(V(0.7, 0.55, 0.95)); this.lookTarget.copy(g);
        ins.stick.rotation.x = -0.3 - Math.sin(local * 5) * 0.04; this.shake = 0.008;
      },
    });
    // D3 insert: the attitude display; the horizon rolls the wrong way
    this.vcue(S + 49.3, 'pull.ai1', () => { ui.subtitle(null); ui.aiAlert('pull.ai1'); audio.thud(); });
    this.cue(S + 56.2, () => ui.aiAlert(null));
    shotAt(S + 49.0, S + 56.2, {
      update: (k, local) => {
        lens(50); const a = ins.attAt, c0 = a.getWorldPosition(new THREE.Vector3()), n = V(0, 0, 1).applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion()));
        this.camera.position.copy(c0).addScaledVector(n, 0.75); this.lookTarget.copy(c0);
        ins.attitude(0.2 + easeInOut(k) * 0.9, -0.1 - 0.5 * k, local > 0.4);
      },
    });
    // D4 extreme wide, as A1: engines flaring, the liner still drifting towards screen right
    shotAt(S + 56.2, S + 59.0, {
      enter: () => this.setVisible('deep'),
      update: (k, local) => {
        const { p } = exterior(local, k, 1);
        lens(35); this.camera.position.copy(p).add(V(-45, 6, 150)); this.lookTarget.copy(p).add(V(25, 2, 0));
        ship.group.position.x += k * 9; d.uBHPos.value.set(lerp(200, 150, k), 8, -300); this.shake = 0.01;
      },
    });

    // ---- E. Everything slides: the camera is fixed to the ship, so the room stays level and the people slide ----
    this.cue(S + 59.05, () => audio.thud());
    shotAt(S + 59.0, S + 61.4, {
      enter: () => { this.setVisible('interior'); holoOn(false); group(); put(sci, -0.85, -0.62, Math.PI * 0.6); },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(-1.6, -0.8, 2.6)); this.lookTarget.copy(at(1.6, -1.2, -1.3)); this.shake = 0.015;
        const sl = (c: Character, go: number) => { const g = smoothstep(go, go + 1.6, local); c.root.position.x += g * 0.012; c.setLimbs(mixLimbs(STANDING, { ...FALL.spread, legL: [0.35, -1, 0.1], legR: [-0.35, -1, -0.1] }, g * 0.6)); c.setFace({ fear: 0.5 * g }); return g; };
        sl(nuv, 0.2); sl(bol, 0.1); sl(sky, 0.4); sl(sci, 0.5); sl(drx, 0.3); sl(lyr, 0.6);
        floatUp(0, 0, smoothstep(0, 2.4, local) * 2.2);
        intr.alarmLight.color.copy(AMBER); intr.alarmLight.intensity = 5 + Math.sin(local * 5) * 3;
      },
    });
    // E2 insert: Lyrra's hand closes on Nuvexa's wrist as she slides past
    this.cue(S + 62.2, () => audio.tone(320, 0.18, 'sine', 0.05, 0, -120));
    shotAt(S + 61.4, S + 62.9, {
      enter: () => { put(nuv, 2.6, -1.6, Math.PI * 0.6); put(lyr, 3.2, -1.3, -Math.PI * 0.45); },
      update: (k, local) => {
        const g = smoothstep(0.1, 0.9, local);
        nuv.setLimbs(mixLimbs(STANDING, { ...FALL.spread, armL: [0.9, 0.35, 0.3], foreL: [1, 0.25, 0.3] }, 0.9)); nuv.setFace({ fear: 0.8, open: 0.4 });
        lyr.setLimbs(mixLimbs(STANDING, { ...STANDING, armR: [-0.9, 0.15, 0.45], foreR: [-1, 0.1, 0.3] }, g));
        const m = hand(lyr).add(hand(nuv, false)).multiplyScalar(0.5);
        lens(85); this.camera.position.copy(m).add(V(-0.1, -0.25, 0.85)); this.lookTarget.copy(m);
      },
    });
    // E3 Draxum plants his feet and takes Bolzar's weight on one arm; eyes on Bolzar, not on us
    this.vcue(S + 63.2, 'cine.line8', () => { ui.subtitle('cine.line8', 'crew.strong.name'); talk(drx, 'cine.line8'); });
    shotAt(S + 62.9, S + 65.8, {
      enter: () => { put(drx, 2.2, -1.2, Math.PI * 0.75); put(bol, 2.9, -1.5, Math.PI * 0.4); },
      update: (k, local) => {
        lens(35); const h = head(drx, -0.3); this.camera.position.copy(h).add(V(-1.6, -0.35, 1.3)); this.lookTarget.copy(h).add(V(0.4, 0, 0)); this.shake = 0.02;
        drx.setLimbs(mixLimbs(STANDING, { ...STANDING, legL: [0.45, -1, 0.1], shinL: [0.2, -1, 0], legR: [-0.4, -1, -0.15], shinR: [-0.2, -1, 0], armL: [1, -0.1, 0.35], foreL: [0.9, 0.2, 0.5] }, smoothstep(0, 0.8, local)));
        drx.setFace({ frown: 0.7, open: 0.2 }); drx.setLookTarget(head(bol));
        bol.setLimbs(mixLimbs(STANDING, FALL.spread, 0.5)); bol.setFace({ fear: 0.6 }); bol.setLookTarget(head(drx));
      },
    });

    // ---- F. It is the black hole ----
    // F1 over Zenvik's shoulder onto the main screen: the trajectory goes vertical; his hand stops on its frame
    shotAt(S + 65.8, S + 67.8, {
      enter: () => { holoOn(true); calm(); put(sci, 0.2, -0.95, Math.PI); },
      update: (k, local) => {
        lens(50); const h = head(sci); this.camera.position.copy(h).add(V(lerp(0.55, 0.45, k), 0.12, 0.9)); this.lookTarget.copy(at(0, -0.55, -1.45));
        intr.holo.uniforms.uSpike.value = 1 + 2 * k; intr.holo.uniforms.uAlarm.value = 0.8;
        sci.setLimbs(mixLimbs(STANDING, { ...STANDING, armR: [-0.35, -0.3, 0.9], foreR: [-0.2, 0.2, 1] }, smoothstep(0.3, 1.1, local)));
      },
    });
    // F2 close-up: he turns from the screen to the window, eyes before the head; quiet; a held moment after "bending"
    this.vcue(S + 68.1, 'pull.sci2', () => { ui.subtitle('pull.sci2', 'crew.scientist.name'); talk(sci, 'pull.sci2'); });
    shotAt(S + 67.8, S + 74.4, {
      update: (k, local) => {
        lens(85); const h = head(sci, -0.12); this.camera.position.copy(h).add(V(0.75, -0.05, -1.45)); this.lookTarget.copy(h);
        sci.setLimbs(null); sci.setLookTarget(local < 0.6 ? at(0, -0.55, -1.45) : WIN);
        sci.root.rotation.y = Math.PI - 0.5 * smoothstep(0.5, 1.4, local);
        sci.setFace({ fear: 0.35, open: 0.08, frown: 0.2, blink: local > 5.7 && local < 5.9 ? 1 : 0 });
        intr.mainLight.color.copy(COOL).lerp(GOLD, 0.3);
      },
    });
    // F3 his eyeline: the black fills the window; a faint flickering haze, a flare going round, stars bent into rings
    this.cue(S + 74.5, () => { ui.subtitle(null); audio.tone(36, 6, 'sine', 0.35, 0, 22); });
    shotAt(S + 74.4, S + 79.0, {
      update: (k) => {
        const e = easeInOut(k); lens(35);
        this.camera.position.copy(at(lerp(0.7, 0.4, e), -0.55, lerp(0.2, -0.4, e))); this.lookTarget.copy(at(0.4, -0.2, -6));
        d.uBHPos.value.set(lerp(-6, -2.5, e), lerp(9, 3.5, e), -lerp(70, 15, e)); d.uWarp.value = 0.4 + 0.4 * e;
        intr.mainLight.intensity = 9 - 3 * e + 4 * Math.max(0, Math.sin(this.clockT * 2.7)) * e; this.shake = 0.01 * e;
      },
    });
    // F4 five quick close-ups, each on its own eyeline to the window (screen right), lit by the glow
    const F4: [Character, Face][] = [[drx, { frown: 0.7, open: 0.1 }], [lyr, { fear: 0.5, open: 0.35 }], [sky, { smile: 0.4, fear: 0.5 }], [bol, { fear: 0.6, squint: 0.3 }], [nuv, { fear: 0.7, open: 0.2 }]];
    F4.forEach(([c, face], i) => shotAt(S + 79.0 + i * 1.1, S + 80.1 + i * 1.1, {
      enter: () => { group(); },
      update: (k, local) => {
        lens(85); const h = head(c, -0.12); this.camera.position.copy(h).add(V(-0.55, -0.05, -1.4)); this.lookTarget.copy(h);
        c.setLookTarget(WIN); c.setFace(i === 2 ? { smile: 0.4 * (1 - smoothstep(0.3, 0.7, local)), fear: 0.6 * smoothstep(0.4, 0.9, local) } : face);
        if (i === 3) c.setLookTarget(local > 0.5 ? at(5, -1.4, -1) : WIN); // Bolzar looks away
        if (i === 4) this.pullPose.social = local < 0.5 ? 'selfie' : undefined as unknown as CrewPose; // Nuvexa lowers the phone
      },
    }));

    // ---- G. The ship breaks ----
    this.vcue(S + 85.0, 'cine.ai2', () => { ui.aiAlert('cine.ai2'); audio.alarm(true); audio.thud(); });
    // G1 wide from the far end: lights fail section by section towards us; red strips; faces turn to each light
    shotAt(S + 84.5, S + 93.6, {
      enter: () => { this.pullPose = {}; group(); atConsole(); },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(-5.2, -0.7, 0.6)); this.lookTarget.copy(at(2.0, -1.0, -0.9)); this.shake = 0.02;
        const stepDown = local < 0.8 ? 1 : local < 1.7 ? 0.55 : local < 2.6 ? 0.2 : 0.04;
        intr.mainLight.color.copy(GOLD); intr.mainLight.intensity = 16 * stepDown; intr.consoleLight.intensity = 0.5;
        intr.alarmLight.color.copy(RED); intr.alarmLight.intensity = local > 2.6 ? (Math.sin(local * 9) * 0.5 + 0.5) * 22 : 0;
        const light = local < 0.8 ? at(4, 1.5, 0) : local < 1.7 ? at(1.5, 1.6, 0) : at(-1.5, 1.6, 0);
        intr.crew.forEach((c) => { c.setFace({ fear: 0.7, open: 0.2 }); c.setLookTarget(light); });
      },
    });
    // G2 insert: the comms panel. NO SIGNAL; the alarm stops mid-tone; a heartbeat comes in
    this.cue(S + 94.4, () => { ui.aiAlert(null); audio.alarm(false); audio.vacuum(true); ins.comms(['COMMS', 'NO SIGNAL'], '#ff5a3a'); });
    shotAt(S + 93.6, S + 96.2, {
      update: (k) => {
        lens(50); const m = ins.commsAt, c0 = m.getWorldPosition(new THREE.Vector3()); this.camera.position.copy(c0).add(V(-0.75, 0, 0)); this.lookTarget.copy(c0);
        intr.alarmLight.intensity = 5;
      },
    });
    // G3 gravity off: the cup, a tablet and hair lift; Draxum thrown to the ceiling; Skyvra catches the handrail
    this.cue(S + 97.4, () => { audio.thud(); this.shake = 0.12; });
    shotAt(S + 96.2, S + 102.4, {
      enter: () => { calm(); put(sci, 0.2, -0.9, Math.PI); put(drx, -1.3, -0.3, Math.PI); put(nuv, -2.3, 0.1, Math.PI); put(lyr, 1.5, -0.2, Math.PI); put(sky, 2.5, 0.1, Math.PI); put(bol, -3.3, 0.4, Math.PI); },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(lerp(3.9, 3.4, k), lerp(-1.5, -1.2, k), 2.7)); this.lookTarget.copy(at(-0.4, lerp(-0.6, 0.1, k), 0));
        const g = smoothstep(0.3, 1.6, local);
        floatUp(g, local, 2.4);
        intr.mainLight.intensity = 0.6; intr.alarmLight.color.copy(RED); intr.alarmLight.intensity = 5 + Math.sin(local * 2.2) * 3;
        const up = smoothstep(0.9, 2.9, local), hit = smoothstep(2.9, 3.05, local);
        drx.root.position.set(-1.3 + up * 0.3, FLOOR + up * up * 2.55, -0.3 + up * 0.5); drx.root.rotation.set(-up * 1.1 - hit * 0.25, Math.PI, up * 0.5);
        drx.setLimbs(flail(FALL.strong, local, 3.1, 0.3 + 0.3 * (1 - hit))); drx.setFace({ fear: 0.6, open: 0.5 * (1 - hit), frown: hit * 0.8, squint: hit * 0.7 });
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
    // G4 insert: the readout. How long, and that the danger is the ship, not the hole
    this.cue(S + 102.6, () => { audio.beep(); ins.readout(['EVENT HORIZON: 40 SECONDS', 'ENGINES OVERSTRESSED · HULL FAILING', 'TIDAL STRESS: NEGLIGIBLE'], '#ffb347'); });
    shotAt(S + 102.4, S + 106.0, {
      update: (k, local) => {
        lens(50); const m = ins.readoutAt, c0 = m.getWorldPosition(new THREE.Vector3()); this.camera.position.copy(c0).add(V(-1.15, 0, 0)); this.lookTarget.copy(c0);
        floatUp(1, 6 + local, 2.4);
      },
    });
    // G5 two-shot, close: Zenvik and Nuvexa floating, her phone still streaming. He tells her the truth gently
    this.vcue(S + 106.4, 'pull.sci3', () => { ui.subtitle('pull.sci3', 'crew.scientist.name'); talk(sci, 'pull.sci3'); });
    shotAt(S + 106.0, S + 114.4, {
      enter: () => { holoOn(false); put(sci, 0.2, -0.95, 0.35, FLOOR + 0.3); put(nuv, 0.95, -0.75, -0.55, FLOOR + 0.35); this.pullPose.social = 'selfie'; },
      update: (k, local) => {
        lens(50); const m = head(sci).add(head(nuv)).multiplyScalar(0.5); this.camera.position.copy(m).add(V(-0.3, -0.12, 1.55)); this.lookTarget.copy(m).add(V(0, -0.12, 0));
        sci.setLimbs(mixLimbs(STANDING, FALL.spread, 0.25)); sci.setFace({ fear: 0.4, squint: 0.15 }); sci.setLookTarget(local < 2.0 ? hand(nuv) : head(nuv));
        nuv.setLimbs(mixLimbs(STANDING, FALL.spread, 0.3)); nuv.setFace({ fear: 0.6, open: 0.1 }); nuv.setLookTarget(head(sci));
        if (local > 6.4) this.pullPose.social = undefined as unknown as CrewPose; // she holds the phone to her chest
        intr.alarmLight.intensity = 3 + Math.sin(local * 1.1) * 2;
        floatUp(1, 10 + local, 2.4);
      },
    });
    // G6 close-up to medium, a fast pull back as he turns: he takes charge, too late
    this.cue(S + 114.9, () => audio.vacuum(false));
    this.vcue(S + 115.2, 'pull.pods', () => { ui.subtitle('pull.pods', 'crew.scientist.name'); talk(sci, 'pull.pods'); audio.alarm(true); });
    shotAt(S + 114.4, S + 117.6, {
      enter: () => { this.pullPose = {}; },
      update: (k, local) => {
        const back = easeInOut(smoothstep(0.6, 1.6, local)); lens(lerp(50, 35, back));
        const h = head(sci, -0.1); this.camera.position.copy(h).add(V(lerp(0.35, 0.8, back), -0.05, lerp(1.0, 2.6, back))); this.lookTarget.copy(h).add(V(0, -0.2 * back, 0));
        sci.root.rotation.y = lerp(0.35, -0.2, smoothstep(0.3, 0.9, local));
        sci.setLimbs(local < 0.9 ? mixLimbs(STANDING, FALL.spread, 0.25) : { ...FALL.spread, armR: [-0.9, 0.5, 0.3], foreR: [-0.6, 0.9, 0.3] });
        sci.setFace({ fear: 0.7, open: smoothstep(0.7, 0.9, local) * 0.7, frown: 0.3 });
        intr.alarmLight.intensity = (Math.sin(local * 9) * 0.5 + 0.5) * 22; floatUp(1, 18 + local, 2.4);
      },
    });
    // G7 wide behind the group towards the hatch: they push off together; the hatch stays far; the walls open, silently
    this.cue(S + 118.0, () => { audio.alarm(false); audio.vacuum(true); ui.subtitle(null); });
    shotAt(S + 117.6, S + 121.2, {
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(-4.2, -0.9, 1.0)); this.lookTarget.copy(at(4.8, -1.0, 0.6));
        const push = smoothstep(0, 1.2, local);
        intr.crew.forEach((c, i) => { c.root.position.x = lerp(-1.6 + (i % 3) * 0.5, 0.2 + (i % 3) * 0.5, push * k); c.root.rotation.set(-0.5 * push, Math.PI * 0.5, 0); c.setLimbs(mixLimbs(STANDING, { ...FALL.spread, armR: [-0.3, 0.3, 1], foreR: [-0.2, 0.3, 1] }, push)); c.setLookTarget(at(5, -0.8, 0.6)); });
        intr.group.scale.set(1 + 0.05 * k, 1, 1); // the deck stretches away from them: the hatch never gets closer
        floatUp(1, 22 + local, 2.4);
      },
    });
    // the breaking apart, the white and the six fates are the title sequence: montage.ts
    this.cue(S + 121.2, () => { holoOn(true); ui.subtitle(null); audio.alarm(false); calm(); intr.crew.forEach((c) => { c.root.rotation.set(0, Math.PI, 0); c.setLookTarget(null); }); intr.group.scale.set(1, 1, 1); this.roll = 0; this.pullPose = {}; audio.vacuum(false); ins.cup(null); ins.warn(null); ins.comms(['COMMS', 'LINK OK']); ins.readout(['NAV', 'COURSE NOMINAL']); this.finish(); });
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
