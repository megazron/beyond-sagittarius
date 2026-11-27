import * as THREE from 'three';
import { createSpaceDome, createEarth, createOrbitalRing, createPlanet } from './space';
import { createShip, createInterior, onSofa } from './ship';
import { easeInOut, clamp, smoothstep, lerp } from '../core/noise';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { Cutscene, Beat, addCutsceneRig, type SceneBranch } from './cutscene';
import { departScene, fightScene, stageDeck, seatAt } from './scenes';
import { t } from '../i18n';
import { createCharacter, Character, CrewId, CrewPose, type Face, type Limbs } from '../characters/character';
import { flail, mixLimbs, nz, FALL, STANDING } from './montage';
import { defaultLook, type PlayerLook, type CrewSkins } from '../characters/custom';
import { createInserts, type Inserts } from './inserts';
import { FilmVideo } from './filmvideo';
import { ContinuityLog, overlaps, setPlaces, type StageState } from './continuity';
import { PASSAGE, ROUTE_PLACES } from './passage';
import { emptyBranch, test } from '../game/branch/engine';

export interface CineUI {
  subtitle(key: string | null, speakerKey?: string): void;
  caption(key: string | null): void;
  chapter(keys: string[] | null, solid?: boolean): void;
  mission(keys: string[] | null): void;
  aiAlert(key: string | null): void;
  fade(color: 'black' | 'white', to: number, seconds: number): void;
}

interface Cue { t: number; fn: () => void; done?: boolean; voiced?: boolean; key?: string; t0?: number; /** A choice or reflex the player has to answer here. */ moment?: string }
/** film: a rendered (Blender) take of this shot, played as video over the engine picture when its file is there. */
interface Shot { start: number; end: number; enter?: () => void; update: (k: number, local: number) => void; done?: boolean; film?: string; /** Its name in the shot list (continuity log). */ label?: string }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Seconds of black before the first shot, for the chapter card. */
const PRE = -4.4;
/** Where Earth sits from the deck while the liner is docked: as far as the docked liner is from it outside (Earth's
 * radius 100, the liner at ~171), below and ahead of the window, so it fills the lower window and the ring arcs past. */
const DOCKED_EARTH = new THREE.Vector3(-70, -105, -112);

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
  /** The deck's crew: the light builds and textures on a phone or on the Mobile preset (the full ones are 2048 px
   * textures, about 400 MB decoded for the six, kept in memory through the whole game). */
  private interior: ReturnType<typeof createInterior>;
  private crewDetail: number;
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
  /** Continuity log (?contlog=1, __bs.continuity): the set and the six at every cut. */
  readonly cont = new ContinuityLog();
  /** The story's choices over the opening (main.ts: the opening's save). Without it the opening plays as one film. */
  branch: SceneBranch | null = null;
  /** How fast the film runs while a choice is open (the choice layer's: a decision nearly stops it, a reflex slows it). */
  momentScale: () => number = () => 1;
  /** A choice or reflex is open over the timeline. */
  private waiting: string | null = null;
  /** A skip is passing the film from choice to choice. */
  private skipping = false;
  /** Has this moment been answered, and how. */
  chose(decision: string, option: string) { return this.branch?.test({ chose: [decision, option] }) ?? false; }
  passed(qte: string) { return this.branch?.test({ passed: qte }) ?? false; }
  answered(id: string) { return this.branch?.test({ decided: id }) ?? false; }
  /** No story attached (a replay from the title, the tests): every scene plays its first way and asks nothing. */
  private passive: SceneBranch = {
    test: (c) => { const st = { branch: emptyBranch(), flags: {}, level: 0, day: 0, timeOfDay: 0, inventory: {}, stats: { health: 100, thirst: 0, hunger: 0, stamina: 100 } }; return test(st, c); },
    line: (b) => ({ key: b.key, who: b.who }), apply: () => {}, answered: () => true, ask: (_, d) => d(), quick: (_, d) => d(),
  };
  get choosing() { return this.waiting; }

  constructor(private ui: CineUI, light = false) {
    this.crewDetail = light || matchMedia('(pointer: coarse)').matches ? 0.6 : 1;
    this.interior = createInterior(this.crewDetail);
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
    this.pilot.root.position.set(0, -2.2, -0.05); this.pilot.root.rotation.set(0, Math.PI, 0); this.ins.cockpit.add(this.pilot.root);
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
    this.cont.on = new URLSearchParams(location.search).get('contlog') === '1';
    setPlaces(ROUTE_PLACES);
    this.cont.footprints = this.interior.footprints.map((f) => ({ ...f, furniture: f.name !== 'console' }));
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
    this.waiting = null; this.skipping = false; this.zenSlide = 0.5; this.drxGive = 0;
    this.resetEvent();
    this.fitToVoice();
    this.cues.forEach((c) => (c.done = false));
    this.shots.forEach((s) => (s.done = false));
    audio.startDrone();
    void this.openFilms();
  }

  // ---- rendered takes (BLENDER shots): muted video over the engine picture, on the cinematic's own clock, under the
  // game's sound and subtitles. A shot without its file plays in the engine as before.
  private films = new Map<string, FilmVideo>();
  private filmEl: HTMLElement | null = null;
  private filmOn: string | null = null;
  private async openFilms() {
    if (!this.filmEl) {
      const el = document.createElement('div'); el.id = 'cine-film';
      el.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;display:none;background:#000';
      document.body.appendChild(el); this.filmEl = el;
    }
    const small = window.matchMedia?.('(max-width: 900px)').matches ?? false;
    // every take made so far has the player in it (A4 is Zenvik): only the default look gets them
    if (!this.playerDefault) return;
    for (const name of new Set(this.shots.map((s) => s.film).filter(Boolean) as string[])) {
      if (this.films.has(name)) continue;
      const v = await FilmVideo.open(name, this.filmEl, small);
      if (v) this.films.set(name, v);
    }
  }
  /** Show the shot's rendered take at its local time, or hide the video. */
  private filmAt(name: string | undefined, local: number) {
    const v = name ? this.films.get(name) : undefined;
    if (!this.filmEl) return;
    if (!v) { if (this.filmOn) { this.filmEl.style.display = 'none'; this.filmOn = null; } return; }
    if (this.filmOn !== name) { this.filmEl.style.display = 'block'; this.filmOn = name!; for (const [n, f] of this.films) f.visible(n === name); }
    v.sync(local);
  }

  /** Jump to a time (debug / screenshots). Earlier cues are marked done without firing. */
  seek(t: number, raw = false) {
    if (!this.playing) return;
    if (!raw) t = this.warp(t);
    this.time = t;
    this.cues.forEach((c) => { if (c.t < t) c.done = true; });
    this.shots.forEach((s) => { if (s.end <= t) { s.enter?.(); s.done = true; } });
    if (t > 0) this.ui.chapter(null); // its hide cue was skipped with the rest: the card would stay over every shot
    this.ui.fade('black', 0, 0.2);
  }

  skip() {
    if (this.stage) { this.stage.skip(); return; } // skip the scene; a second tap skips the rest
    if (!this.playing) return;
    if (this.waiting) return; // a skip never answers for the player
    // skipping passes the film, never a choice: on to the next one still open, then the end
    const open = this.branch ? this.cues.filter((c) => c.moment && !c.done && !this.branch!.answered(c.moment)).sort((a, b) => a.t - b.t)[0] : undefined;
    if (open) { voice.stop(); this.ui.subtitle(null); this.skipping = true; this.seek(Math.max(this.time, open.t - 0.6), true); return; }
    this.finish();
  }

  private stage: Cutscene | null = null;
  get staged() { return !!this.stage; }
  private get cast() {
    const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
    return Object.fromEntries(ids.map((id, i) => [id, this.interior.crew[i]])) as Record<CrewId, Character>;
  }
  /**
   * Scene 1, Departure: the lounge while the liner is still docked at Earth's orbital ring (Earth and the ring are set
   * below and ahead of the deck so they fill the window), then the timeline goes on with the liner leaving.
   */
  private holdDepart() {
    const i = this.interior, d = this.dome.uniforms;
    this.setVisible('interior');
    this.earth.group.visible = this.ring.visible = true;
    this.earth.group.position.copy(DOCKED_EARTH); this.ring.position.copy(DOCKED_EARTH);
    d.uBH.value = 0; d.uWarp.value = 0; d.uNebula.value = 0.5;
    i.holo.uniforms.uAlarm.value = 0; i.holo.uniforms.uSpike.value = 0; i.alarmLight.intensity = 0;
    i.mainLight.intensity = 3.2; i.consoleLight.intensity = 1.0; i.earthLight.intensity = 11; i.stripLight.intensity = 5;
    this.runStage(departScene(this.cast, i.group.position, i.seats, {
      display: (on) => i.display(on ? ['cine.mission1', 'cine.mission2', 'cine.mission3', 'cine.mission4'].map((k) => t(k)) : null),
      laugh: () => audio.human('laugh', 0.75),
    }), () => {
      this.time = Math.max(this.time, this.warp(15.2));
      this.earth.group.position.set(0, 0, 0); this.ring.position.set(0, 0, 0);
      i.display(null); i.earthLight.intensity = 0; i.stripLight.intensity = 0; i.mainLight.intensity = 9; i.consoleLight.intensity = 2.2;
      i.crew.forEach((c) => { c.setLookTarget(null); c.setFace(null); c.setLimbs(null); c.root.position.y = i.group.position.y - 2.2; c.root.rotation.set(0, Math.PI, 0); });
      this.setVisible('earth');
    });
  }

  private runStage(beats: Beat[], done: () => void) {
    stageDeck(this.cast, -2.2);
    this.scene.updateMatrixWorld(true);
    this.stage = new Cutscene(beats, {
      camera: this.camera,
      scene: this.scene,
      actors: this.cast,
      branch: this.branch ?? this.passive,
      subtitle: (k, sp) => this.ui.subtitle(k, sp),
      // inside the hull, off the floor, clear of the console
      cameraOk: (p) => Math.hypot(p.y, p.z) < 3.75 && p.y > -2.05 && Math.abs(p.x) < 5.6 && !(Math.abs(p.x) < 1.7 && p.z < -0.7),
      onDone: () => { this.stage = null; done(); },
    });
  }

  /** The player's figure and any crew skins on the deck. */
  /** A rendered take shows the default Zenvik: with any other look for the player it would show the wrong person, so
   *  those shots stay in the engine (the look is compared field by field, the name aside). */
  private playerDefault = true;
  setCast(look: PlayerLook, skins: CrewSkins) {
    const dl = defaultLook() as unknown as Record<string, unknown>, lk = look as unknown as Record<string, unknown>;
    this.playerDefault = Object.keys(dl).every((k) => k === 'name' || JSON.stringify(dl[k]) === JSON.stringify(lk[k]));
    const g = this.interior.group, crew = this.interior.crew, d = this.crewDetail;
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
    // (the pilot is posed after the shot has moved the yoke: posed before it, her hands held last frame's yoke, a frame
    // behind a yoke that shakes, and slid round the horns) // seated by setLimbs: the sit clip sits on the ground, far forward of its root
    if (!this.interior.group.visible) return;
    const poses = this.stage?.poses;
    // whoever sits on a sofa in the pull: the chair legs and the hips on the cushion every frame, whatever a shot did
    for (const [c, st] of this.seated) {
      seatAt(c, this.interior.group.position.y - 2.2, st.k, st.hands);
      if (st.extra) c.setLimbs({ ...c.limbsNow, ...st.extra });
      if (st.k <= 0) this.seated.delete(c);
    }
    this.interior.crew.forEach((c) => {
      c.root.updateMatrixWorld();
      c.animate(poses?.[c.id as CrewId] ?? this.pullPose[c.id as CrewId] ?? 'stand', 0, 0, this.clockT, dt);
    });
  }
  private clockT = 0;
  /** The pilot's wrists in the yoke's own frame, a row a frame while the cockpit shows (yokeReport; null: off). */
  yokeRows: { t: number; L: number[]; R: number[] }[] | null = null;
  private yokeLog = () => {};
  /** Seated on a sofa in the pull (1 sat, 0 up), the hands free or on a task, and an arm pose over the seated one. */
  private seated = new Map<Character, { k: number; hands: boolean; extra?: Limbs }>();

  /** The event's one-way state (continuity): how far the hull has gone (0 whole, 1 strained, 2 a seam, 3 torn, 4 broken
   *  apart), whether gravity and the air are gone. It only goes forward from the pull's first shot to the white. */
  damage = 0; airOut = false; gravOff = false;
  /** Where the run to the pods left each of the six (the title sequence goes on from there), or null. */
  runEnd: Record<string, { p: THREE.Vector3; q: THREE.Quaternion }> | null = null;
  /** The ship as it was before the event: whole, the hatch shut, the passage dark. */
  resetEvent() {
    const p = this.interior.passage;
    this.damage = 0; this.airOut = false; this.gravOff = false; this.runEnd = null;
    p.door(0); p.tear(0, 0); p.lamps(0, 0, true); p.show(false);
    this.interior.crew.forEach((c) => { c.setHold(null); c.setGrip('both', null); });
  }
  /** `carry`: the title sequence follows and goes on from this state (the torn passage, the six where they are). */
  private finish(carry = false) {
    if (!carry) this.resetEvent();
    this.playing = false;
    this.waiting = null;
    this.seated.clear();
    this.stage = null;
    this.filmAt(undefined, 0); for (const f of this.films.values()) f.close(); this.films.clear();
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
  /** A choice (kind 'choice') or a reflex ('qte') over the film at time t: the film slows behind it until it is answered. */
  private mcue(t: number, id: string, kind: 'choice' | 'qte', after?: () => void) {
    this.cues.push({ t, moment: id, fn: () => {
      const br = this.branch;
      if (!br || br.answered(id)) { after?.(); return; }
      this.waiting = id;
      const done = () => { if (this.waiting === id) this.waiting = null; after?.(); if (this.skipping) { this.skipping = false; this.skip(); } };
      if (kind === 'choice') br.ask(id, done); else br.quick(id, done);
    } });
  }
  /** A spoken cue: the timeline waits for the previous line to finish before firing it. */
  private vcue(t: number, key: string, fn: () => void) {
    this.cues.push({ t, voiced: true, key, fn: () => { this.speechEnd = this.clockT + (voice.duration(key) ?? 2) + 0.15; this.subClearAt = t >= 39 ? this.speechEnd + 0.3 : 0; fn(); } });
  }
  private speechEnd = 0;
  /** From the pull on, a line's subtitle goes when the line ends (it stayed up into the next shots before). */
  private subClearAt = 0;
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
    // inside: the six in the lounge, the mission on the display, the owner's two lines (scenes.ts departScene)
    this.cue(14.2, () => this.holdDepart());
    this.cue(22.2, () => ui.subtitle(null));
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
    // the friends' talk is in the departure now (holdDepart): the journey cuts straight to the pull's first shot
    this.cue(33.45, () => { this.time = Math.max(this.time, this.warp(39.0)); });
    // (the reading's old interior shot from 33.4 s is gone: the cue above jumps past it, but its first frame still drew
    // the deck with the six as the departure left them, a one-frame flash between the gas giant and the pull)
    const intr = this.interior;

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
    // the line placed a little towards where the speaker is in frame (the take starts a moment later, once decoded)
    const talk = (c: Character, key: string) => { c.say((voice.duration(key) ?? 2)); const p = new THREE.Vector3().setFromMatrixPosition(c.head.matrixWorld).project(this.camera); voice.pan = p.z < 1 && Math.abs(p.x) < 1.2 ? clamp(p.x * 0.3, -0.3, 0.3) : 0; };
    const calm = () => intr.crew.forEach((c) => { c.setLimbs(null); c.setFace(null); c.look2(0, 0); });
    const lounge = () => { put(drx, -0.3, 1.9, Math.PI * 0.62); put(nuv, -1.5, 1.35, -Math.PI * 0.35); put(lyr, 1.2, 1.8, Math.PI * 0.9); put(sky, 2.0, 0.9, Math.PI * 1.05); put(bol, -2.6, 0.7, Math.PI * 0.75); };
    const AMBER = new THREE.Color(0xffa020), RED = new THREE.Color(0xff2a1a), COOL = new THREE.Color(0xcfe6ff), GOLD = new THREE.Color(0xffc45a);
    // the console's screen only where someone is reading it; elsewhere it filled the frame behind the faces
    const holoMesh = intr.group.children.find((m) => (m as THREE.Mesh).material === intr.holo);
    const holoOn = (on: boolean) => { if (holoMesh) holoMesh.visible = on; };
    // Loose things on the deck: what is on the floor slides when it tilts (and stays slid), and once gravity goes everything
    // rises from where it lay at its own rate, on one clock across the shots (each shot restarted it: things jumped at cuts)
    let slid = 0, offAt = -1;
    const floatUp = (g: number, _local: number, slide = 0) => {
      slid = Math.max(slid, slide);
      if (g > 0.02 && offAt < 0) { offAt = this.clockT; this.gravOff = true; }
      const up = offAt < 0 ? 0 : this.clockT - offAt;
      for (const f of intr.floaters) {
        const base = f.userData.base as THREE.Vector3, spin = f.userData.spin as THREE.Vector3, r = f.userData.rise as number;
        f.position.set(f.userData.onFloor ? Math.min(5.6, base.x + slid * (0.6 + r)) : base.x, base.y + Math.min(3.2, r * 0.5 * up * up / (up + 1)), base.z);
        f.rotation.set(spin.x * up, spin.y * up + (f.userData.yaw0 ??= f.rotation.y), spin.z * up);
      }
    };
    const resetLoose = () => { slid = 0; offAt = -1; this.gravOff = false; floatUp(0, 0, 0); };

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
    // A4's eyeline: further along the window, so from the close-up's camera his look passes well left of the lens (WIN
    // itself lies almost on the lens axis there, and he looked straight into it)
    const WIN_A4 = WIN.clone().add(V(1.6, 0, 0.8));
    // The deck is one room through the whole opening: the lounge's sofas are still there 41 days on, and the pull is
    // blocked round them. It opens as the departure left them: Lyrra on her end of the right sofa with her list, Bolzar on
    // its other end; the other three stand behind it at the window with Nuvexa's phone. Lyrra and Bolzar are seen to get
    // up (C2) before anyone needs them on their feet. Marks only change on screen or in time to walk there (the
    // continuity check, tools/continuity_check.py).
    const SEAT_L = onSofa(1, -0.6), SEAT_B = onSofa(1, 0.7);
    const sit = (c: Character, st: { x: number; z: number; yaw: number }) => { put(c, st.x, st.z, st.yaw); this.seated.set(c, { k: 1, hands: c.id !== 'medic' }); };
    /** Everyone's pose back to standing, except whoever is still sitting. */
    const keepSit = () => { const k: Partial<Record<CrewId, CrewPose>> = {}; for (const [id, p] of Object.entries(this.pullPose)) if (p === 'sit') k[id as CrewId] = p; this.pullPose = k; };
    /** The party at the window (A to C: facing each other and the phone) or the five looking out (F and G). */
    const group = (party = false) => {
      put(drx, 2.3, -1.9, party ? -0.7 : Math.PI * 1.15); put(nuv, 1.4, -1.95, party ? 1.52 : Math.PI * 0.82); put(sky, 2.7, -2.55, Math.PI);
      if (party) { sit(lyr, SEAT_L); sit(bol, SEAT_B); return; }
      put(lyr, 3.2, -1.5, Math.PI * 1.1); put(bol, 4.0, -2.2, Math.PI * 1.2); this.seated.clear();
    };
    /** Up off the sofa: weight forward, the seat left behind, onto the feet in front of it, over about a second. */
    const rise = (c: Character, along: number, t0: number, local: number) => {
      const g = smoothstep(t0, t0 + 1.1, local), st = this.seated.get(c);
      if (g <= 0 || !st) return;
      st.k = 1 - smoothstep(0.2, 1, g); st.extra = undefined; st.hands = true; if (g > 0.05) c.stopTask();
      // the hips go forward over the feet first, then up
      const f = onSofa(1, along, 0.12 + 0.52 * smoothstep(0, 0.4, g)); c.root.position.x = f.x; c.root.position.z = f.z;
    };
    const atConsole = () => put(sci, -0.85, -0.62, Math.PI);
    const exterior = (local: number, k: number, strain = 0) => {
      const p = V(80000, 0, 0);
      ship.group.position.copy(p); ship.group.lookAt(p.clone().add(V(1, 0, -0.08))); // left to right across the screen
      ship.group.rotateZ(Math.sin(local * 0.7) * 0.01 + strain * 0.05);
      (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 0.5 + strain * (0.9 + 0.5 * Math.abs(Math.sin(local * 5.3)));
      ship.engineGlow.color.setRGB(0.4 + strain, 1.2 + strain, 3 * (1 + strain));
      return { p, k };
    };
    // a close shot may cheat the others out of the frame (they would stand between the lens and the face): every
    // shot starts with all six shown, and `only` hides the rest for that shot
    const only = (...cs: Character[]) => intr.crew.forEach((c) => { c.root.visible = cs.length === 0 || cs.includes(c); });
    const LABELS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'D4', 'E1', 'E2', 'E3', 'F1', 'F2', 'F3', 'F4a', 'F4b', 'F4c', 'F4d', 'F4e', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G6b', 'G6c', 'G7'];
    let nth = 0;
    const shotAt = (start: number, end: number, sh: Omit<Shot, 'start' | 'end'>) => this.shots.push({ start, end, film: sh.film, label: sh.label ?? LABELS[nth++], enter: () => { fresh(); only(); sh.enter?.(); }, update: (k, l) => { fresh(); sh.update(k, l); } });

    // ---- A. Something is wrong ----
    this.cue(S + 0.2, () => { calm(); audio.tone(58, 7, 'sine', 0.22, 0, -9); });
    // A1 extreme wide: the liner small, crossing left to right, the bright centre ahead at screen right
    shotAt(S, S + 3.2, {
      enter: () => { this.setVisible('deep'); d.uBH.value = 1; d.uNebula.value = 0.9; d.uWarp.value = 0; holoOn(true); ins.warn(null); group(true); atConsole(); resetLoose(); lyr.doTask('use', { seconds: 30, prop: 'paper', hands: 'both' }); },
      update: (k, local) => {
        const { p } = exterior(local, k);
        lens(35); this.camera.position.copy(p).add(V(lerp(-60, -40, k), 6, 150)); this.lookTarget.copy(p).add(V(lerp(10, 25, k), 2, 0));
        d.uBHPos.value.set(260, 10, -420);
      },
    });
    // A2 the master: five laughing by the window, Zenvik alone at the console, back left
    shotAt(S + 3.2, S + 6.2, {
      enter: () => { this.setVisible('interior'); holoOn(false); group(true); atConsole(); intr.mainLight.color.copy(COOL); intr.mainLight.intensity = 9; intr.mainLight.position.set(0, 2.5, 0.5); intr.alarmLight.intensity = 0; intr.holo.uniforms.uAlarm.value = 0; this.pullPose.social = 'selfie'; },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(0.9, -0.75, 3.1)); this.lookTarget.copy(at(1.1, -1.1, -1.4));
        for (const [c, ph] of [[drx, 0], [nuv, 0.7], [lyr, 1.3], [sky, 0.4], [bol, 1.9]] as [Character, number][]) { c.setFace({ smile: 0.55 + 0.25 * Math.max(0, Math.sin(local * 2.1 + ph)) }); c.setLookTarget(head(nuv)); }
        lyr.setLookTarget(local < 1.6 ? hand(lyr, false) : head(drx)); // her list first, then the joke
        nuv.setLookTarget(head(drx)); sci.setFace({ squint: 0.2 }); sci.look2(0, 0.45);
        ins.gauge(-0.02 * k);
      },
    });
    // A3 insert: the nav gauge. The needle creeps a hair left; a tick; it creeps again
    this.cue(S + 7.3, () => audio.tone(2400, 0.02, 'square', 0.05));
    this.cue(S + 8.4, () => audio.tone(2400, 0.02, 'square', 0.05));
    this.cue(S + 6.9, () => sci.doTask('use', { seconds: 0.7, at: ins.gaugeAt.getWorldPosition(new THREE.Vector3()).add(V(0, 0, 0.02)), hands: 'L', prop: null }));
    this.cue(S + 8.0, () => sci.doTask('use', { seconds: 0.6, at: ins.gaugeAt.getWorldPosition(new THREE.Vector3()).add(V(0, 0, 0.02)), hands: 'L', prop: null }));
    shotAt(S + 6.2, S + 9.0, {
      enter: () => put(sci, -0.55, -0.6, Math.PI),
      update: (k, local) => {
        const g = ins.gaugeAt; g.updateMatrixWorld(); const c0 = g.getWorldPosition(new THREE.Vector3()), n = V(0, 0, 1).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()));
        lens(85); this.camera.position.copy(c0).addScaledVector(n, 0.55).add(V(-0.3, 0.1, 0)); this.lookTarget.copy(c0); // from his left; he stands to its right
        sci.setLookTarget(c0); // his eyes are on the gauge already, so A4 does not open on his head swinging down to it
        ins.gauge(-0.02 - 0.05 * smoothstep(0.9, 1.3, local) - 0.05 * smoothstep(2.0, 2.4, local));
      },
    });
    // A4 close-up: Zenvik (back at the gauge's end of the console). He wants it to be a sensor fault. Brows draw together; a slow blink; eyes to the window and back
    shotAt(S + 9.0, S + 11.6, {
      film: 'pull_a4',
      enter: () => atConsole(),
      update: (k, local) => {
        // slightly low (the shot list): under his eyeline as he looks down at the gauge, so his eyes read, not his lids
        lens(85); const h = head(sci, -0.12); this.camera.position.copy(h).add(V(lerp(0.5, 0.42, k), -0.17, -1.04)); this.lookTarget.copy(h).add(V(0, -0.04, 0)); // a close-up: about a metre, the push in by the lerp
        // no smile at all (his look's resting smile showed teeth and read as a smirk)
        sci.setFace({ frown: smoothstep(0, 0.8, local) * 0.55, squint: 0.25, smile: 0, blink: local > 1.1 && local < 1.35 ? 1 : 0 });
        // the dart: the eyes jump to the window and the head follows them fast, then both come back to the gauge
        sci.setGazeRate(local < 0.1 ? 80 : local > 1.3 ? 9 : 2.2); // the first frames settle his head on the gauge under the cut
        sci.setLookTarget(local < 1.4 ? ins.gaugeAt.getWorldPosition(new THREE.Vector3()) : local < 2.1 ? WIN_A4 : ins.gaugeAt.getWorldPosition(new THREE.Vector3()));
      },
    });
    // A5 his eyeline through the window: near the core the stars are short arcs, all bent the same way
    shotAt(S + 11.6, S + 14.4, {
      enter: () => sci.setGazeRate(null),
      update: (k) => { lens(50); this.camera.position.copy(at(0.2, -0.45, -0.55)); this.lookTarget.copy(at(1.6, -0.2, -6)); d.uWarp.value = smoothstep(0, 1, k) * 0.55; d.uWarpDir.value.set(-0.6, 0.3, -1).normalize(); d.uBHPos.value.set(-40, 18, -lerp(420, 330, k)); },
    });
    // A6 Skyvra at the window, her back to us; she turns, head first, then her body; a half smile that does not hold
    this.vcue(S + 15.0, 'op.17', () => { ui.subtitle('op.17', 'crew.explorer.name'); talk(sky, 'op.17'); });
    shotAt(S + 14.4, S + 18.4, {
      enter: () => { keepSit(); },
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
      enter: () => { sky.root.rotation.y = Math.PI - 2.3; },
      update: (k) => {
        lens(50); const m = head(drx).add(head(nuv)).multiplyScalar(0.5); this.camera.position.copy(m).add(V(0.6, -0.2, 2.2)); this.lookTarget.copy(m).add(V(0, -0.25, 0));
        drx.setFace({ smile: 0.6 }); drx.look2(0, -0.15); nuv.setFace({ smile: 0.8 }); nuv.setLookTarget(head(drx));
      },
    });
    // B2 insert: the drink. Its surface leans and creeps up one side; a drop climbs the rim. The room stays level
    const CUP = at(2.25, -1.05, -1.45);
    const cupAt = () => CUP.copy(drx.root.position).add(intr.group.position).addScaledVector(V(Math.sin(drx.root.rotation.y), 0, Math.cos(drx.root.rotation.y)), 0.36).setY(intr.group.position.y - 1.05);
    this.cue(S + 20.6, () => audio.tone(180, 0.5, 'sine', 0.05, 0, -40));
    this.vcue(S + 21.9, 'pull.strong', () => { ui.subtitle('pull.strong', 'crew.strong.name'); talk(drx, 'pull.strong'); });
    shotAt(S + 20.4, S + 23.0, {
      enter: () => cupAt(),
      update: (k, local) => {
        ins.cup(CUP, 0.42 * smoothstep(0.2, 2.0, local), smoothstep(0.8, 2.4, local), smoothstep(1.6, 2.6, local));
        lens(85); this.camera.position.copy(CUP).add(V(-0.05, 0.25, 0.24)); this.lookTarget.copy(CUP).add(V(0, 0.012, 0)); // high enough to see into it
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
      update: (k, local) => {
        lens(50); const h = head(bol, -0.2); this.camera.position.copy(h).add(V(-1.3, -0.05, 1.5)); this.lookTarget.copy(h);
        // seated: only his left arm is posed (the clip keeps the legs on the seat), out to the sofa's arm beside him
        const st = this.seated.get(bol);
        if (st) st.extra = mixLimbs({ armL: [0.22, -0.85, 0.42], foreL: [0.02, -0.3, 1] }, { armL: [0.75, -0.55, 0.25], foreL: [0.5, -0.6, 0.6] }, smoothstep(0.2, 0.8, local));
        bol.setFace({ smile: 0.6 * (1 - smoothstep(1.6, 2.6, local)), fear: 0.4 * smoothstep(2.4, 3.2, local) }); bol.setLookTarget(local < 2.4 ? head(drx) : at(5, -0.6, -1.6));
      },
    });

    // ---- C. The jokes die ----
    // C1 over Zenvik's shoulder: the group turning to him. He swallows before the line
    // the first choice of the pull (Zenvik): tell them now, or check it once more and say nothing (the silent default)
    this.mcue(S + 29.55, 'e1.reading', 'choice');
    this.vcue(S + 30.1, 'cine.line4', () => { if (this.chose('e1.reading', 'check')) return; ui.subtitle('cine.line4', 'crew.scientist.name'); talk(sci, 'cine.line4'); });
    shotAt(S + 29.4, S + 31.8, {
      enter: () => { const st = this.seated.get(bol); if (st) st.extra = undefined; sci.root.rotation.y = Math.PI * 0.55; keepSit(); drx.stopTask(); lyr.stopTask(); },
      update: (k, local) => {
        lens(50); const h = head(sci); this.camera.position.copy(h).add(V(-0.75, 0.05, 0.55)); this.lookTarget.copy(at(2.4, -0.8, -1.9));
        sci.setFace({ fear: 0.2 }); const turn = smoothstep(0.6, 1.6, local);
        // checking again: his eyes go back down to the gauge and only Lyrra turns, to his face, not to anything he said
        const quiet = this.chose('e1.reading', 'check');
        if (quiet) sci.setLookTarget(ins.gaugeAt.getWorldPosition(new THREE.Vector3()));
        for (const c of [drx, nuv, lyr, sky, bol]) { const t2 = quiet && c !== lyr ? 0 : turn; c.setLookTarget(t2 > 0.3 ? head(sci) : null); c.setFace({ smile: 0.4 * (1 - t2) }); }
      },
    });
    // C2 reaction, held: five faces, the laughter gone, each stopping at a different moment (Lyrra first, Nuvexa last)
    shotAt(S + 31.8, S + 33.8, {
      update: (k, local) => {
        lens(35); this.camera.position.copy(at(0.6, -0.55, 0.9)); this.lookTarget.copy(at(2.8, -0.7, -1.9));
        const stop = (c: Character, t0: number) => { const g = smoothstep(t0, t0 + 0.4, local); c.setFace({ smile: 0.3 * (1 - g), fear: 0.3 * g }); c.setLookTarget(head(sci)); };
        stop(lyr, 0.0); stop(sky, 0.3); stop(drx, 0.5); stop(bol, 0.8); stop(nuv, 1.3);
        rise(lyr, -0.6, 0.2, local); rise(bol, 0.7, 0.75, local);
        this.pullPose.social = local < 1.3 ? 'selfie' : undefined as unknown as CrewPose;
      },
    });
    // C3 insert: the console screen says it; amber washes over the room
    this.vcue(S + 34.0, 'cine.ai1', () => { ui.subtitle('cine.ai1'); audio.alarm(true); }); // the screen insert carries it: no alert box over it
    this.cue(S + 42.6, () => { ui.subtitle(null); audio.alarm(false); });
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
    // D1 wide from behind and above the pilot, over her right shoulder: the seat, her hands on the yoke, the panel and
    // the canopy with the core beyond. She is already fighting it
    // Two-hand grip on the horns (the owner: "the hand placement when steering is glitching"). Each hand closes round
    // its horn (grasp: the palm on the horn's outer side, the fingers round its front, curled to its 19 mm), turns with
    // the yoke at once (rigid), and the pilot is posed after the yoke has moved each frame (see update)
    const YH = { L: { at: V(0, 0, 0), fingers: V(0, 0, -1), palm: V(1, 0, 0), radius: 0.019, grasp: true, along: 0.5, rigid: true }, R: { at: V(0, 0, 0), fingers: V(0, 0, -1), palm: V(-1, 0, 0), radius: 0.019, grasp: true, along: 0.5, rigid: true } };
    const HORN = { L: V(0.17, 0.03, 0), R: V(-0.17, 0.03, 0) };
    const yoke = (local: number, haul: number) => { // she hauls back and fights the roll; the hands go with the yoke
      // a slow haul and roll she fights, a small tremor of effort on top (the 11 Hz rattle read as the hands glitching)
      // on the film's own clock, not each shot's: restarted at every cut, the roll jumped 0.1 rad and the hands chased it
      const tt = this.clockT; void local;
      ins.stick.position.z = -0.4 + 0.05 * haul + Math.sin(tt * 2.3) * 0.004;
      ins.stick.rotation.z = Math.sin(tt * 1.9) * 0.12 * haul + Math.sin(tt * 4.1) * 0.006;
      ins.yokeHold(YH);
      for (const sd of ['L', 'R'] as const) YH[sd].at.copy(HORN[sd]).applyMatrix4(ins.stick.matrixWorld);
    };
    this.yokeLog = () => {
      if (!this.yokeRows) return;
      const inv = ins.stick.matrixWorld.clone().invert(), w = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).toArray().map((v) => +v.toFixed(4));
      this.yokeRows.push({ t: +this.clockT.toFixed(3), L: w(this.pilot.handL), R: w(this.pilot.handR) });
    };
    shotAt(S + 42.6, S + 44.8, {
      enter: () => { this.setVisible('cockpit'); d.uBHPos.value.set(-6, 4, -160); ins.attitude(0, 0); ins.mfd(['THRUST', '112%'], ['NAV', 'DEVIATION +2.1°'], '#ffb347'); yoke(0, 0.6); this.pilot.setHold(YH); this.pilot.setGrip('both', { shape: 'grip', radius: 0.019 });
        // in a chair: thighs forward, shins down; the hip joints just above the cushion (top at y -1.69)
        this.pilot.setLimbs({ legL: [0.06, -0.12, 1], legR: [-0.06, -0.12, 1], shinL: [0.04, -1, 0.12], shinR: [-0.04, -1, 0.12] });
        const r = this.pilot.root; r.position.y = -2.2; r.updateMatrixWorld(true);
        const hipH = this.pilot.legL.getWorldPosition(new THREE.Vector3()).y - r.getWorldPosition(new THREE.Vector3()).y;
        r.position.y = -1.69 + 0.09 - hipH; },
      update: (k, local) => {
        lens(24); const c = ins.cockpit.position; this.camera.position.copy(c).add(V(0.62, -0.62, 0.95)); this.lookTarget.copy(c).add(V(-0.12, -1.18, -1.6));
        yoke(local, 0.6 + 0.2 * k);
        this.pilot.setLookTarget(c.clone().add(V(0, -0.7, -3))); this.pilot.setFace({ frown: 0.6, squint: 0.4 });
        ins.attitude(0.08 + local * 0.03, -0.1);
        this.shake = 0.01;
      },
    });
    // D2 insert: her hands on the yoke, from in front, low by the panel: knuckles tight, hauling back. Between the
    // "come on"s a held breath
    this.vcue(S + 45.0, 'pull.pilot', () => { ui.subtitle('pull.pilot', 'crew.pilot.name'); this.pilot.say(voice.duration('pull.pilot') ?? 3.9); });
    shotAt(S + 44.8, S + 49.0, {
      update: (k, local) => {
        yoke(local, 0.8 + 0.2 * smoothstep(0.5, 3.5, local));
        // from just over the glare shield, a little right of the column: both horns and both hands clear of the hub, her
        // face above them in the same frame (the camera sits between the shield's back edge, z -1.15, and the yoke)
        lens(26); const g = ins.stick.getWorldPosition(new THREE.Vector3()), hp = head(this.pilot, -0.1);
        this.camera.position.copy(ins.cockpit.position).add(V(0.05, -0.8, -0.98)); this.lookTarget.copy(g).lerp(hp, 0.45); // nearly on her axis and higher: from 0.17 to the side her right coat sleeve covered that hand
        this.pilot.setFace({ frown: 0.75, squint: 0.5, open: Math.max(0, Math.sin(local * 2.4)) * 0.25 }); this.pilot.setLookTarget(ins.cockpit.position.clone().add(V(0, -0.7, -3)));
        this.shake = 0.008;
      },
    });
    // D3 insert: the attitude display straight on, the side displays at its edges; the horizon rolls the wrong way
    this.vcue(S + 49.3, 'pull.ai1', () => { ui.subtitle('pull.ai1'); audio.thud(); });
    this.cue(S + 56.2, () => { ui.subtitle(null); this.pilot.setHold(null); this.pilot.setGrip('both', null); this.pilot.setLimbs(null); });
    shotAt(S + 49.0, S + 56.2, {
      update: (k, local) => {
        yoke(local, 1);
        lens(50); const a = ins.attAt, c0 = a.getWorldPosition(new THREE.Vector3()), n = V(0, 0, 1).applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion()));
        this.camera.position.copy(c0).addScaledVector(n, 0.8); this.lookTarget.copy(c0);
        ins.attitude(0.2 + easeInOut(k) * 0.9, -0.1 - 0.5 * k, local > 0.4);
        if (local > 0.4) ins.mfd(['THRUST', local > 3 ? 'OVERSTRESS' : '118%'], ['NAV', `DEVIATION +${(2.1 + local * 1.3).toFixed(1)}°`], local > 3 ? '#ff5a3a' : '#ffb347');
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
      enter: () => { this.setVisible('interior'); holoOn(false); group(); put(sci, -0.85, -0.62, Math.PI * 0.6); slideFrom.clear(); },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(-1.6, -0.8, 2.6)); this.lookTarget.copy(at(1.6, -1.2, -1.3)); this.shake = 0.015;
        // how far each one goes before their feet hold: Nuvexa furthest (she goes past Lyrra, E2), Bolzar least (the aft wall)
        const SLIDE: Record<string, number> = { social: 1.3, builder: 0.3, explorer: 0.6, scientist: 0.5, strong: 0.7, medic: 0.15 };
        // his own slide follows the reflex: caught on the console's edge, or carried into the sofa (eased, never a jump)
        const want = this.passed('e1.brace') ? 0.12 : this.answered('e1.brace') ? 1.0 : 0.5;
        this.zenSlide += (want - this.zenSlide) * (1 - Math.exp(-(1 / 60) * 4)); SLIDE.scientist = this.zenSlide;
        const sl = (c: Character, go: number) => { const g = smoothstep(go, go + 1.6, local); if (!slideFrom.has(c)) slideFrom.set(c, c.root.position.x); c.root.position.x = slideFrom.get(c)! + g * SLIDE[c.id]; c.setLimbs(mixLimbs(STANDING, { ...FALL.spread, legL: [0.35, -1, 0.1], legR: [-0.35, -1, -0.1] }, g * 0.6)); c.setFace({ fear: 0.5 * g }); return g; };
        sl(nuv, 0.2); sl(bol, 0.1); sl(sky, 0.4); sl(sci, 0.5); sl(drx, 0.3); sl(lyr, 0.6);
        floatUp(0, 0, smoothstep(0, 2.4, local) * 2.2);
        intr.alarmLight.color.copy(AMBER); intr.alarmLight.intensity = 5; // steady: the alarm's tone stopped with the cockpit shots, a flashing lamp with no alarm heard read as the sound dropping out
      },
    });
    const slideFrom = new Map<Character, number>();
    this.mcue(S + 59.45, 'e1.brace', 'qte');
    // E2 insert: Lyrra's hand closes on Nuvexa's wrist as she slides past
    this.cue(S + 62.2, () => audio.tone(320, 0.18, 'sine', 0.05, 0, -120));
    shotAt(S + 61.4, S + 62.9, {
      enter: () => { const l = lyr.root.position; put(lyr, l.x, l.z, -Math.PI * 0.45); put(nuv, l.x - 0.6, l.z - 0.3, Math.PI * 0.6); only(nuv, lyr); nuvFrom.copy(nuv.root.position); }, // where the slide left them
      update: (k, local) => {
        // Lyrra's choice: her hand closes on Nuvexa's wrist, or she turns for Bolzar and Nuvexa slides on past her hand
        const caught = !this.answered('e1.reach') || this.chose('e1.reach', 'nuvexa');
        const g = caught ? smoothstep(0.1, 0.9, local) : 0.35 * smoothstep(0.1, 0.6, local);
        if (!caught) { nuv.root.position.x = nuvFrom.x + 0.9 * smoothstep(0.2, 1.4, local); lyr.setLookTarget(local > 0.3 ? at(3.2, -0.8, -1.6) : null); }
        nuv.setLimbs(mixLimbs(STANDING, { ...FALL.spread, armL: [0.9, 0.35, 0.3], foreL: [1, 0.25, 0.3] }, 0.9)); nuv.setFace({ fear: 0.8, open: 0.4 });
        lyr.setLimbs(mixLimbs(STANDING, { ...STANDING, armR: [-0.9, 0.15, 0.45], foreR: [-1, 0.1, 0.3] }, g));
        const m = hand(lyr).add(hand(nuv, false)).multiplyScalar(0.5);
        lens(50); this.camera.position.copy(m).add(V(0.15, 0.35, 1.05)); this.lookTarget.copy(m);
      },
    });
    const nuvFrom = new THREE.Vector3();
    this.mcue(S + 61.5, 'e1.reach', 'choice', () => { if (!this.chose('e1.reach', 'nuvexa')) this.cue(this.time + 0.5, () => { audio.thud(); audio.human('yelp', 0.7); }); });
    // E3 Draxum plants his feet and takes Bolzar's weight on one arm; eyes on Bolzar, not on us
    this.vcue(S + 63.2, 'cine.line8', () => { ui.subtitle('cine.line8', 'crew.strong.name'); talk(drx, 'cine.line8'); });
    shotAt(S + 62.9, S + 65.8, {
      enter: () => { const p = drx.root.position; put(drx, p.x, p.z, -0.35); put(bol, p.x + 0.65, p.z - 0.25, -0.9); this.bolY0 = bol.root.position.y; this.drxGive = 0; }, // Bolzar has fallen against him
      update: (k, local) => {
        lens(35); const h = head(drx, -0.3); this.camera.position.copy(h).add(V(-0.7, -0.3, 2.1)); this.lookTarget.copy(h).add(V(0.3, 0, 0)); this.shake = 0.02;
        drx.setLimbs(mixLimbs(STANDING, { ...STANDING, legL: [0.45, -1, 0.1], shinL: [0.2, -1, 0], legR: [-0.4, -1, -0.15], shinR: [-0.2, -1, 0], armL: [1, -0.1, 0.35], foreL: [0.9, 0.2, 0.5] }, smoothstep(0, 0.8, local)));
        drx.setFace({ frown: 0.7, open: 0.2 }); drx.setLookTarget(head(bol));
        bol.setLimbs(mixLimbs(STANDING, FALL.spread, 0.5)); bol.setFace({ fear: 0.6 }); bol.setLookTarget(head(drx));
        // the hold lost: his arm gives at the elbow and Bolzar's weight takes him down to one knee (eased in)
        if (this.answered('e1.hold') && !this.passed('e1.hold')) {
          this.drxGive = Math.min(1, this.drxGive + 1 / 60 / 0.5);
          const gv = smoothstep(0, 1, this.drxGive);
          drx.setLimbs(mixLimbs(STANDING, { ...STANDING, legL: [0.45, -1, 0.1], shinL: [0.2, -1, 0], legR: [-0.4, -1, -0.15], shinR: [-0.2, -1, 0], armL: [0.6, -0.7, 0.3], foreL: [0.2, -0.9, 0.4], bend: 0.35 * gv }, 1));
          drx.setFace({ frown: 0.4, open: 0.5, squint: 0.8 * gv });
          bol.root.position.y = this.bolY0 - 0.18 * gv;
        }
      },
    });

    this.mcue(S + 63.05, 'e1.hold', 'qte', () => { if (!this.passed('e1.hold')) { audio.human('grunt', 0.9); audio.thud(); } });
    // ---- F. It is the black hole ----
    // F1 over Zenvik's shoulder onto the main screen: the trajectory goes vertical; his hand stops on its frame
    shotAt(S + 65.8, S + 67.8, {
      enter: () => { holoOn(true); calm(); put(sci, 0.2, -0.72, Math.PI); },
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
        holoOn(false); sci.setLimbs(null); sci.setLookTarget(local < 0.6 ? at(0, -0.55, -1.45) : WIN);
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
        this.camera.position.copy(at(lerp(1.5, 1.2, e), -0.5, lerp(0.2, -0.4, e))); this.lookTarget.copy(at(0.4, -0.2, -6));
        d.uBHPos.value.set(lerp(-6, -2.5, e), lerp(9, 3.5, e), -lerp(70, 15, e)); d.uWarp.value = 0.4 + 0.4 * e;
        intr.mainLight.intensity = 9 - 3 * e + 4 * Math.max(0, Math.sin(this.clockT * 2.7)) * e; this.shake = 0.01 * e;
      },
    });
    // F4 five quick close-ups, each on its own eyeline to the window (screen right), lit by the glow
    // (by crew index, resolved per frame: the figures are swapped after this is built)
    const F4: [number, Face][] = [[1, { frown: 0.7, open: 0.1 }], [2, { fear: 0.5, open: 0.35 }], [3, { smile: 0.4, fear: 0.5 }], [4, { fear: 0.6, squint: 0.3 }], [5, { fear: 0.7, open: 0.2 }]];
    F4.forEach(([ci, face], i) => shotAt(S + 79.0 + i * 1.1, S + 80.1 + i * 1.1, {
      // facing the glass, turned a little to the lens; Lyrra (i 1) turned further and shot more from the front, or her
      // hair (it hangs on the lens side) hides her face
      enter: () => { group(); only(intr.crew[ci]); intr.crew[ci].root.rotation.y = Math.PI - (i === 1 ? 0.85 : 0.5); },
      update: (k, local) => {
        const c = intr.crew[ci];
        lens(85); const h = head(c, -0.12); this.camera.position.copy(h).add(i === 1 ? V(0.72, -0.05, -0.92) : V(1.05, -0.05, -0.55)); this.lookTarget.copy(h);
        // each looks straight out through the glass, a little towards the lens side: screen right
        const out = h.clone().add(i === 1 ? V(-1.2, 0.2, -4) : V(0.6, 0.2, -4)); // Lyrra's lens is more frontal: her look goes further screen right to match
        c.setLookTarget(out); c.setFace(i === 2 ? { smile: 0.4 * (1 - smoothstep(0.3, 0.7, local)), fear: 0.6 * smoothstep(0.4, 0.9, local) } : face);
        if (i === 3) c.setLookTarget(local > 0.5 ? h.clone().add(V(-2, -1.2, 1)) : out); // Bolzar looks away
        if (i === 4) this.pullPose.social = local < 0.5 ? 'selfie' : undefined as unknown as CrewPose; // Nuvexa lowers the phone
      },
    }));

    // ---- G. The ship breaks ----
    this.vcue(S + 85.0, 'cine.ai2', () => { ui.aiAlert('cine.ai2'); audio.alarm(true); audio.thud(); });
    // G1 wide from the hatch end: they have turned from the window to the room; the lights fail section by section from
    // the far end towards us and their faces follow each one; the red strips by the hatch come on and light them
    const SECT = [-3.6, -1.2, 1.3, 3.6], FAIL = [0.8, 1.7, 2.6, 3.5];
    shotAt(S + 84.5, S + 93.6, {
      enter: () => { this.damage = Math.max(this.damage, 1); this.pullPose = {}; group(); for (const c of [drx, nuv, lyr, sky, bol]) c.root.rotation.y = 0.35 + (c.root.position.x - 2.6) * 0.12; put(sci, -0.6, -0.4, 0.9); },
      update: (k, local) => {
        lens(24); this.camera.position.copy(at(4.7, -0.7, 1.3)); this.lookTarget.copy(at(0.9, -1.15, -1.5)); this.shake = 0.015;
        const gone = FAIL.filter((f) => local >= f).length; // sections dark so far, from the far end
        const lit = SECT.slice(gone);
        intr.mainLight.color.copy(GOLD).lerp(COOL, 0.5);
        if (lit.length) { intr.mainLight.position.set(lit.reduce((a, b) => a + b, 0) / lit.length, 1.2, 0.6); intr.mainLight.intensity = 3 + 3.2 * lit.length; }
        else intr.mainLight.intensity = 0.8; // only the strips
        intr.consoleLight.intensity = 0.6;
        // the red strips at the hatch end: low, in front of them, so the faces stay readable in the dark
        intr.alarmLight.color.copy(RED); intr.alarmLight.position.set(4.2, -0.6, 1.0);
        intr.alarmLight.intensity = local > 2.6 ? 14 + (Math.sin(local * 9) * 0.5 + 0.5) * 18 : 0;
        const failing = at(SECT[Math.min(gone, SECT.length - 1)], 1.4, 0);
        intr.crew.forEach((c, i) => { c.setFace({ fear: 0.55 + 0.1 * gone, open: 0.15 + 0.05 * (i % 3) }); c.setLookTarget(local > FAIL[0] - 0.4 + i * 0.06 ? failing : null); });
      },
    });
    // G2 insert: the comms panel. NO SIGNAL; the alarm stops mid-tone; a heartbeat comes in
    this.cue(S + 94.4, () => { ui.aiAlert(null); audio.alarm(false); audio.vacuum(true); ins.comms(['COMMS', 'NO SIGNAL'], '#ff5a3a'); });
    this.mcue(S + 94.6, 'e1.breath', 'qte', () => { if (!this.passed('e1.breath')) audio.humanInner('gasp', 0.9); });
    shotAt(S + 93.6, S + 96.2, {
      enter: () => { intr.alarmLight.position.set(0, 2.0, 1.0); intr.mainLight.position.set(0, 2.5, 0.5); ins.comms(['COMMS', 'NO SIGNAL'], '#ff5a3a'); ui.aiAlert(null); }, // (the panel showed LINK OK under the alert for 0.8 s before its cue)
      update: (k) => {
        lens(50); const m = ins.commsAt, c0 = m.getWorldPosition(new THREE.Vector3()); this.camera.position.copy(c0).add(V(-0.75, 0, 0)); this.lookTarget.copy(c0);
        intr.alarmLight.intensity = 5;
      },
    });
    const gStart = new Map<Character, THREE.Vector3>();
    // G3 gravity off: the cup, a tablet and hair lift; Draxum thrown to the ceiling; Skyvra catches the handrail
    this.cue(S + 97.4, () => { audio.thud(); this.shake = 0.12; });
    shotAt(S + 96.2, S + 102.4, {
      enter: () => { calm(); for (const c of intr.crew) gStart.set(c, c.root.position.clone()); },
      update: (k, local) => {
        // low, from the room side under the console's end, up at the five by the window as they leave the floor
        lens(24); this.camera.position.copy(at(-0.3, lerp(-1.55, -1.3, k), 2.4)); this.lookTarget.copy(at(2.5, lerp(-0.7, 0.3, k), -1.7));
        const g = smoothstep(0.3, 1.6, local);
        floatUp(g, local, 2.4);
        intr.mainLight.intensity = 0.6; intr.alarmLight.color.copy(RED); intr.alarmLight.intensity = 5 + Math.sin(local * 2.2) * 3;
        const from = (c: Character) => gStart.get(c) ?? c.root.position;
        // Draxum, the heaviest, is thrown up and hits the ceiling over where he stood (the hull's curve: 3.5 m up here)
        const up = smoothstep(0.9, 2.9, local), hit = smoothstep(2.9, 3.05, local), d0 = from(drx);
        drx.root.position.set(d0.x + up * 0.3, FLOOR + up * up * 4.6, d0.z + up * 0.3); drx.root.rotation.set(-up * 1.1 - hit * 0.25, Math.PI, up * 0.5);
        drx.setLimbs(flail(FALL.strong, local, 3.1, 0.3 + 0.3 * (1 - hit))); drx.setFace({ fear: 0.6, open: 0.5 * (1 - hit), frown: hit * 0.8, squint: hit * 0.7 });
        // Skyvra catches the window's rail as she lifts: her body swings out from the hand
        const sw = smoothstep(0.6, 2.4, local), s0 = from(sky);
        sky.root.position.set(s0.x, FLOOR + sw * 0.75, s0.z + sw * 0.5); sky.root.rotation.set(sw * (0.9 + Math.sin(local * 1.6) * 0.18), Math.PI, sw * Math.sin(local * 1.3) * 0.25);
        sky.setLimbs(mixLimbs(STANDING, { ...FALL.spread, armR: [-0.25, 0.6, 1], foreR: [-0.1, 0.5, 1] }, sw)); sky.setFace({ fear: 0.6 * sw, frown: 0.3 });
        for (const [c, i] of [[sci, 0], [lyr, 2], [bol, 4], [nuv, 5]] as [Character, number][]) {
          const u = smoothstep(1 + i * 0.12, 4.5, local), c0 = from(c);
          c.root.position.set(c0.x, FLOOR + u * (0.35 + (i % 3) * 0.12) + Math.sin(local * 1.4 + i) * 0.04 * u, c0.z);
          c.root.rotation.x = -u * 0.25; c.root.rotation.z = (i % 2 ? 1 : -1) * u * 0.22;
          c.setLimbs(mixLimbs(STANDING, flail({ ...FALL.spread, openHands: true }, local, i * 2.9, 0.2), u * 0.8)); c.setFace({ fear: 0.7, open: 0.25 });
        }
      },
    });
    // G4 insert: the readout. How long, and that the danger is the ship, not the hole
    this.cue(S + 102.6, () => { audio.beep(); ins.readout(['EVENT HORIZON: 40 SECONDS', 'ENGINES OVERSTRESSED · HULL FAILING', 'TIDAL STRESS: NEGLIGIBLE'], '#ffb347'); });
    shotAt(S + 102.4, S + 106.0, {
      enter: () => ins.readout(['EVENT HORIZON: 40 SECONDS', 'ENGINES OVERSTRESSED · HULL FAILING', 'TIDAL STRESS: NEGLIGIBLE'], '#ffb347'),
      update: (k, local) => {
        lens(50); const m = ins.readoutAt, c0 = m.getWorldPosition(new THREE.Vector3()); this.camera.position.copy(c0).add(V(-1.15, 0, 0)); this.lookTarget.copy(c0);
        floatUp(1, 6 + local, 2.4);
      },
    });
    // G5 two-shot, close: Zenvik and Nuvexa floating, her phone still streaming. He tells her the truth gently
    this.vcue(S + 106.4, 'pull.sci3', () => { ui.subtitle('pull.sci3', 'crew.scientist.name'); talk(sci, 'pull.sci3'); });
    shotAt(S + 106.0, S + 114.4, {
      enter: () => { holoOn(false); put(sci, 0.2, -0.6, 0.35, FLOOR + 0.3); put(nuv, 0.95, -0.55, -0.55, FLOOR + 0.35); this.pullPose.social = 'selfie'; },
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
        // not both arms flung out (a T: the owner's "unrealistic"): his right hand keeps its hold on the console's edge,
        // the breath in, then the left arm goes out to the hatch (aft, his left) as he shouts, and stays there
        const call = smoothstep(0.75, 1.15, local), held = { armR: [-0.35, -0.55, 0.75] as [number, number, number], foreR: [-0.15, -0.45, 1] as [number, number, number] };
        const point: Limbs = { ...mixLimbs(STANDING, FALL.spread, 0.2), ...held, armL: [0.72, 0.62 + 0.05 * Math.sin(local * 3), 0.12], foreL: [0.8, 0.55, 0.05] }; // up and over Nuvexa's head (level, it went through her face in the GPU take)
        sci.setLimbs(mixLimbs({ ...mixLimbs(STANDING, FALL.spread, 0.25), ...held, armL: [0.45, -0.7, 0.4], foreL: [0.35, -0.4, 0.8] }, point, call));
        sci.setLookTarget(local < 0.9 ? head(nuv) : at(5.5, -0.9, 0.9)); // eyes to the hatch before the arm
        sci.setFace({ fear: 0.7, open: smoothstep(0.7, 0.9, local) * 0.7, frown: 0.3 });
        intr.alarmLight.intensity = (Math.sin(this.clockT * 9) * 0.5 + 0.5) * 22; floatUp(1, 18 + local, 2.4);
      },
    });
    // ==== The run to the pods (G6b to P5): one clock, one state ====
    // The owner: "the cutscenes going to the pods scene is still not proper, doesn't show continuity." Before, each shot
    // placed and moved the six on its own, the hatch never got nearer and the next thing seen was the liner from outside.
    // Now where each of the six is at film time t comes from their own route from where the call found them, through the
    // hatch aft, along the passage's rails towards the pod bay; every shot is only a camera on that one movement, so no
    // cut can move anyone, and the answers given (Lyrra's reach, Draxum's hold, the hand or the core) decide who tows
    // whom, with which arm, and who is last. The passage tears open ahead of them.
    const RUN = S + 117.6, TEAR = 20.2, RUN_END = 24.6;
    const pas = intr.passage, PA = PASSAGE;
    type Key = [number, number, number, number]; // t, then where the chest is (deck units)
    const kTmp = new THREE.Vector3();
    /** A route at time t: a smooth curve through its keys (no stop at a key unless its neighbours hold it there). */
    const route = (keys: Key[], t: number, out: THREE.Vector3) => {
      const n = keys.length;
      if (t <= keys[0][0]) return out.set(keys[0][1], keys[0][2], keys[0][3]);
      if (t >= keys[n - 1][0]) return out.set(keys[n - 1][1], keys[n - 1][2], keys[n - 1][3]);
      let i = 0; while (i < n - 2 && t >= keys[i + 1][0]) i++;
      const a = keys[i], b = keys[i + 1], h = b[0] - a[0], u = (t - a[0]) / h, u2 = u * u, u3 = u2 * u;
      const slope = (j: number, c: number) => { if (j <= 0 || j >= n - 1) return 0; const p = keys[j - 1], q = keys[j + 1]; return (q[c] - p[c]) / (q[0] - p[0]); };
      for (let c = 1; c <= 3; c++) {
        const m0 = slope(i, c) * h, m1 = slope(i + 1, c) * h;
        kTmp.setComponent(c - 1, (2 * u3 - 3 * u2 + 1) * a[c] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b[c] + (u3 - u2) * m1);
      }
      return out.copy(kTmp);
    };
    const lane = (x: number, side: 'L' | 'R' | 'M'): [number, number, number] => side === 'L' ? [x, -1.22, PA.doorZ - 0.5] : side === 'R' ? [x, -1.0, PA.doorZ + 0.5] : [x, -0.62, PA.doorZ];
    const D0: [number, number, number] = [5.2, -1.15, PA.doorZ], D1: [number, number, number] = [PA.doorX + 0.1, -1.15, PA.doorZ];
    const runStart = new Map<string, { chest: THREE.Vector3; q: THREE.Quaternion; up: number }>();
    /** The routes for the answers given so far. Every branch shares its keys up to 3.2 s (the choice is answered by then). */
    const routes = () => {
      const st = (id: string): [number, number, number] => { const s = runStart.get(id)!.chest; return [s.x, s.y, s.z]; };
      const hand = this.chose('e1.handcore', 'hand'), core = this.chose('e1.handcore', 'core');
      const hurtN = this.answered('e1.reach') && !this.chose('e1.reach', 'nuvexa'), hurtD = this.answered('e1.hold') && !this.passed('e1.hold');
      const late = hurtN ? 0.5 : 0, slow = hurtD ? 0.6 : 0; // a hurt one makes their pair later through the hatch
      const z0 = st('scientist'), s0 = st('explorer'), l0 = st('medic'), n0 = st('social'), d0 = st('strong'), b0 = st('builder');
      const meet: [number, number, number] = [n0[0] + (l0[0] - n0[0]) * 0.35 + 0.4, (n0[1] + l0[1]) / 2, n0[2] + (l0[2] - n0[2]) * 0.35];
      const sofa: [number, number, number] = [3.38, -1.2, -0.86]; // Bolzar behind the right sofa's back, at its aft end
      const R: Record<string, Key[]> = {};
      // Skyvra pushes off the window's frame towards Zenvik, her hand out, in every branch
      const reachZ: [number, number, number] = [z0[0] + 1.25, z0[1] - 0.05, z0[2] + 0.1];
      if (hand) {
        R.scientist = [[0, ...z0], [3.2, ...z0], [5.9, 3.3, -1.1, 0.45], [7.5, ...D0], [8.2, ...D1], [9.7, ...lane(7.5, 'R')], [12.4, ...lane(9.5, 'R')], [15.6, ...lane(11.2, 'R')], [19, ...lane(12.3, 'R')], [TEAR + 0.6, ...lane(12.8, 'R')], [RUN_END, ...lane(13.0, 'R')]];
        R.explorer = [[0, ...s0], [2.8, ...s0], [3.9, ...reachZ], [6.3, 3.0, -1.15, 0.05], [8.0, 5.1, -1.2, PA.doorZ - 0.1], [8.8, ...D1], [10.3, ...lane(7.3, 'L')], [13.0, ...lane(9.2, 'L')], [16.2, ...lane(10.9, 'L')], [19.5, ...lane(11.9, 'L')], [TEAR + 0.6, ...lane(12.3, 'L')], [RUN_END, ...lane(12.5, 'L')]];
      } else {
        // the core: he turns back to the console for it and comes last; frozen: he hangs a beat and follows her alone
        R.scientist = core
          ? [[0, ...z0], [3.2, ...z0], [4.4, 0.55, -1.0, -0.72], [6.2, 0.6, -1.0, -0.7], [9.0, 3.3, -1.1, 0.45], [11.9, ...D0], [13.0, ...D1], [14.8, ...lane(7.3, 'M')], [17.6, ...lane(8.5, 'M')], [TEAR + 0.6, ...lane(9.2, 'M')], [RUN_END, ...lane(9.35, 'M')]]
          : [[0, ...z0], [3.2, ...z0], [4.3, z0[0] + 0.05, z0[1], z0[2]], [6.8, 3.3, -1.1, 0.45], [8.5, ...D0], [9.1, ...D1], [10.6, ...lane(7.3, 'R')], [13.4, ...lane(9.0, 'R')], [16.6, ...lane(10.6, 'R')], [19.6, ...lane(11.5, 'R')], [TEAR + 0.6, ...lane(11.8, 'R')], [RUN_END, ...lane(11.95, 'R')]];
        R.explorer = [[0, ...s0], [2.8, ...s0], [3.9, ...reachZ], [4.7, reachZ[0] + 0.1, reachZ[1], reachZ[2] + 0.1], [6.5, 3.6, -1.1, 0.5], [7.6, ...D0], [8.2, ...D1], [9.8, ...lane(7.6, 'R')], [12.6, ...lane(9.6, 'R')], [15.8, ...lane(11.4, 'R')], [19.2, ...lane(12.5, 'R')], [TEAR + 0.6, ...lane(12.9, 'R')], [RUN_END, ...lane(13.05, 'R')]];
      }
      // Lyrra goes to Nuvexa and takes her wrist; she tows her down the left rail
      R.medic = [[0, ...l0], [1.7, meet[0] + 0.45, meet[1], meet[2] - 0.1], [2.9 + late, meet[0] + 0.55, meet[1], meet[2]], [6.6 + late, 3.6, -1.15, 0.55], [8.9 + late, ...D0], [9.6 + late, ...D1], [11.1 + late, ...lane(7.4, 'L')], [13.8 + late, ...lane(8.9, 'L')], [16.8 + late, ...lane(10.2, 'L')], [19.6, ...lane(10.9, 'L')], [TEAR + 0.6, ...lane(11.2, 'L')], [RUN_END, ...lane(11.35, 'L')]];
      R.social = [[0, ...n0], [1.7, n0[0] + (meet[0] - n0[0]) * 0.4, meet[1], n0[2] + (meet[2] - n0[2]) * 0.4], [2.9 + late, meet[0] - 0.1, meet[1], meet[2] + 0.05], [7.2 + late, 3.5, -1.2, 0.5], [9.6 + late, ...D0], [10.3 + late, ...D1], [11.8 + late, ...lane(7.2, 'L')], [14.5 + late, ...lane(8.3, 'L')], [17.5 + late, ...lane(9.5, 'L')], [19.9, ...lane(9.6, 'L')], [TEAR + 0.6, ...lane(9.85, 'L')], [RUN_END, ...lane(9.95, 'L')]];
      // Draxum comes off the ceiling for Bolzar, who has hold of the sofa's back; he sends him through the hatch ahead of
      // him and follows (with his arm hurt he cannot work the rail: he goes down the middle off the ribs, slower)
      const dl = hurtD ? 'M' : 'R';
      R.strong = [[0, ...d0], [1.0, d0[0] + 0.1, d0[1] - 0.25, d0[2] + 0.1], [4.4, sofa[0] + 0.3, sofa[1] + 0.45, sofa[2] - 0.3], [5.2, sofa[0] + 0.32, sofa[1] + 0.42, sofa[2] - 0.28], [8.0 + slow, 4.3, -1.0, 0.45], [10.4 + slow, 5.5, -0.8, PA.doorZ + 0.8], [11.5 + slow, 5.52, -0.8, PA.doorZ + 0.78], [12.4 + slow, ...D1], [13.6 + slow, ...lane(7.0, dl)], [16.4 + slow, ...lane(7.8, dl)], [19.2 + slow, ...lane(8.3 - slow * 0.5, dl)], [TEAR + 0.9, ...lane(8.6 - slow * 0.6, dl)], [RUN_END, ...lane(8.7 - slow * 0.6, dl)]];
      R.builder = [[0, ...b0], [2.6, ...b0], [3.9, ...sofa], [5.0, ...sofa], [8.2 + slow, 4.75, -1.25, 0.5], [10.3 + slow, 5.3, -1.2, PA.doorZ - 0.05], [11.3 + slow, ...D1], [12.7 + slow, ...lane(7.0, 'L')], [15.4 + slow, ...lane(7.3, 'L')], [18.6 + slow, ...lane(7.7, 'L')], [TEAR + 0.9, ...lane(7.95, 'L')], [RUN_END, ...lane(8.05, 'L')]];
      return { R, hand, core, hurtN, hurtD };
    };
    const qA = new THREE.Quaternion(), eA = new THREE.Euler(), pA = new THREE.Vector3(), pB = new THREE.Vector3(), upV = new THREE.Vector3();
    /** How each one carries the body along a route: how far they lean into the travel, a roll of their own, the pull's length. */
    const BODY: Record<string, { lean: number; roll: number; step: number; seed: number }> = {
      scientist: { lean: 1.05, roll: -0.12, step: 0.95, seed: 1.3 }, explorer: { lean: 1.2, roll: 0.16, step: 0.8, seed: 4.1 }, medic: { lean: 0.95, roll: 0.08, step: 0.85, seed: 7.7 },
      social: { lean: 0.8, roll: -0.2, step: 0.9, seed: 10.9 }, strong: { lean: 1.15, roll: 0.1, step: 1.15, seed: 14.2 }, builder: { lean: 0.9, roll: 0.3, step: 0.7, seed: 17.5 },
    };
    const railGrip = { L: { at: V(0, 0, 0), fingers: V(0, 1, 0), palm: V(0, 0, -1), radius: 0.018, grasp: true }, R: { at: V(0, 0, 0), fingers: V(0, 1, 0), palm: V(0, 0, 1), radius: 0.018, grasp: true } };
    const holdAt = new Map<string, THREE.Vector3>();
    const core = intr.core, coreHome = core.position.clone();
    /** Everyone where the run has them at t seconds after the call. */
    const run = (tau: number) => {
      const { R, hand: hd, core: cr, hurtN, hurtD } = routes();
      const flash = Math.sin(this.clockT * 9) * 0.5 + 0.5, torn = smoothstep(TEAR, RUN_END, tau) * 0.8;
      // the room and the passage: the hatch opens at the call's end, the lamps go with the hull
      pas.show(true); pas.door(smoothstep(4.7, 5.9, tau));
      pas.lamps(tau < TEAR ? 0.55 + 0.45 * flash : 0.25 * (1 - smoothstep(TEAR, TEAR + 0.5, tau)), tau < TEAR + 0.4 ? 1 : 0.5, tau < 18.6);
      pas.tear(torn, this.clockT);
      this.damage = Math.max(this.damage, tau >= TEAR ? 2 + smoothstep(TEAR, TEAR + 1.5, tau) : 1); this.airOut = tau >= TEAR;
      intr.mainLight.intensity = 0.6; intr.alarmLight.color.copy(RED); intr.alarmLight.intensity = tau < TEAR ? flash * 22 : 0;
      floatUp(1, 0, 2.4);
      for (const c of intr.crew) {
        const id = c.id as CrewId, keys = R[id], b = BODY[id], s0 = runStart.get(id)!;
        route(keys, tau, pA); route(keys, tau + 0.5, pB); pB.sub(route(keys, tau - 0.25, upV));
        const sp = pB.length() / 0.75, moving = smoothstep(0.12, 0.6, sp);
        // the heading follows the travel; when nearly still it keeps to the way aft
        // the heading is where the route goes over the next second and more, not this instant's velocity: tied to
        // the speed it swung a body 80 to 110 degrees in a frame as it started to move (the check's pops in G6c)
        const far = route(keys, tau + 1.2, new THREE.Vector3()).sub(route(keys, tau - 0.2, new THREE.Vector3())), yaw = Math.hypot(far.x, far.z) > 0.04 ? Math.atan2(far.x, far.z) : Math.PI / 2;
        const sway = nz(tau * 0.9, b.seed) * 0.08;
        const inP = smoothstep(PA.doorX - 0.6, PA.doorX + 0.8, pA.x), trail = Math.max(moving, 0.7 * inP);
        eA.set(0.4 + (b.lean - 0.2) * trail + sway, yaw, b.roll * moving + nz(tau * 0.7, b.seed + 3) * 0.1, 'YXZ'); qA.setFromEuler(eA);
        // out of the pose the call found them in, over their first second of moving
        let j0 = 0; while (j0 < keys.length - 2 && keys[j0 + 1][1] === keys[0][1] && keys[j0 + 1][2] === keys[0][2] && keys[j0 + 1][3] === keys[0][3]) j0++;
        const tStart = keys[j0][0];
        const ease = smoothstep(tStart, tStart + 1.3, tau);
        c.root.quaternion.copy(s0.q).slerp(qA, ease);
        upV.set(0, s0.up, 0).applyQuaternion(c.root.quaternion);
        c.root.position.copy(pA).sub(upV);
        // nobody's feet in the floor: a body that slows and comes upright rides higher
        if (ease > 0) c.root.position.y += Math.max(0, FLOOR + 0.22 - c.root.position.y) * ease;
        // ---- what each body does on the way: authored per person, driven by how far they have come, not by a clock ----
        const inPass = smoothstep(PA.doorX + 0.2, PA.doorX + 1.2, pA.x), dist = pA.x; // metres along the way aft
        const sideRail = keys[keys.length - 1][3] > PA.doorZ + 0.2 ? 'R' : keys[keys.length - 1][3] < PA.doorZ - 0.2 ? 'L' : null;
        const ph = (dist / b.step) % 1, pull = Math.sin(ph * Math.PI * 2); // one pull on the rail per step of travel
        // trailing legs, a small kick of their own on each pull
        const legs: Limbs = { legL: [0.1, -1, -0.12 - 0.12 * pull * moving], shinL: [0.06, -1, -0.35 - 0.2 * moving], legR: [-0.1, -1, -0.12 + 0.12 * pull * moving], shinR: [-0.06, -1, -0.3 - 0.25 * moving] };
        // the free arms: ahead for the next hold while travelling, loose when still
        const ahead = (s: 1 | -1, k: number): Limbs => s > 0 ? { armL: [0.45, 0.75 * k - 0.3 * (1 - k), 0.35], foreL: [0.25, 0.9 * k - 0.2 * (1 - k), 0.3] } : { armR: [-0.45, 0.75 * k - 0.3 * (1 - k), 0.35], foreR: [-0.25, 0.9 * k - 0.2 * (1 - k), 0.3] };
        let limbs: Limbs = { ...mixLimbs(STANDING, FALL.spread, 0.2), ...legs, ...ahead(1, moving * (0.5 + 0.5 * pull)), ...ahead(-1, moving * (0.5 - 0.5 * pull)), openHands: true, hair: [0, 0.3, -1] };
        let face: Face = { fear: 0.55, open: 0.2 }, look: THREE.Vector3 | null = at(pA.x + 4, -0.9, PA.doorZ);
        const hold: { L?: typeof railGrip.L; R?: typeof railGrip.R } = {};
        // a hand on the rail in the passage: it stays where it closed while the body passes, then lets go for the next
        if (sideRail && inPass > 0.5 && tau < RUN_END + 5) {
          const sgn = sideRail === 'R' ? 1 : -1, zr = PA.doorZ + sgn * (PA.half - PA.railOff);
          const lead = 0.5, k0 = Math.floor((dist + lead) / b.step), gx = Math.min(PA.tearX - 0.25, k0 * b.step + 0.12), g = holdAt.get(id) ?? V(gx, PA.railY, zr);
          // the reach to the next hold: off the rail, forward, on (a third of the step)
          const u = smoothstep(0, 0.35, ((dist + lead) / b.step) % 1), from = Math.min(PA.tearX - 0.25, (k0 - 1) * b.step + 0.12);
          g.set(lerp(from, gx, u), PA.railY + Math.sin(u * Math.PI) * 0.06, zr - sgn * Math.sin(u * Math.PI) * 0.1); holdAt.set(id, g);
          const h = { at: at(g.x, g.y, g.z), fingers: V(0.3, 1, 0).normalize(), palm: V(0, 0, sgn), radius: 0.018, grasp: true };
          if (sideRail === 'R') hold.R = h; else hold.L = h;
        }
        if (id === 'scientist') {
          face = { fear: 0.6, frown: 0.35, open: 0.15 };
          if (hd) { limbs = { ...limbs, armL: [0.8, -0.25, -0.35], foreL: [0.85, -0.35, -0.3] }; look = tau > 10.5 && tau < 11.6 ? head(sky) : look; } // his hand back for hers
          if (cr) {
            // at the console: both hands to the core, a wrench, then it rides under his left arm
            const grab = smoothstep(3.6, 4.4, tau) * (1 - smoothstep(5.9, 6.3, tau)), carry = smoothstep(5.9, 6.4, tau);
            if (grab > 0) { limbs = { ...limbs, armL: [0.25, -0.35, 0.9], foreL: [0.1, -0.3, 1], armR: [-0.25, -0.35, 0.9], foreR: [-0.1, -0.3, 1], bend: 0.3 * grab }; look = core.getWorldPosition(new THREE.Vector3()); }
            if (carry > 0) { limbs = { ...limbs, armL: [0.35, -0.75, 0.5], foreL: [-0.75, 0.15, 0.6] }; delete hold.L; }
            c.root.quaternion.slerp(qA.setFromEuler(eA.set(0.25, Math.PI, 0, 'YXZ')), smoothstep(3.3, 4.2, tau) * (1 - smoothstep(5.9, 6.8, tau))); // back to the console, then round for the hatch
            upV.set(0, s0.up, 0).applyQuaternion(c.root.quaternion); c.root.position.copy(pA).sub(upV); c.root.position.y += Math.max(0, FLOOR + 0.22 - c.root.position.y);
          }
          if (!hd && !cr && tau < 4.4) { limbs = mixLimbs(STANDING, FALL.spread, 0.25); face = { fear: 0.8, open: 0.1 }; look = head(sky); } // frozen
        } else if (id === 'explorer') {
          face = { fear: 0.5, open: 0.3 };
          const reach = smoothstep(2.8, 3.7, tau);
          if (tau < 4.8) { limbs = { ...limbs, ...mixLimbs(FALL.explorer, { ...FALL.explorer, armR: [-0.3, 0.45, 1], foreR: [-0.2, 0.3, 1] }, reach) }; look = head(sci); }
          if (hd && tau >= 3.9) hold.R = { at: hand(sci, false), fingers: V(1, 0.2, 0).normalize(), palm: V(0, -1, 0), radius: 0.03, grasp: true }; // her hand in his
          if (!hd && tau > 4.0 && tau < 4.8) face = { fear: 0.6, frown: 0.5, open: 0.1 }; // her hand closed on nothing
          {
            // she goes to him and then back the way she came, for the hatch: her route turns right round at his side, so
            // her facing is set here (to him, then round to the way aft over a second), not read off a route that reverses
            const z = sci.root.position, toHim = Math.atan2(z.x - c.root.position.x, z.z - c.root.position.z), w = 1 - smoothstep(4.5, 5.7, tau);
            if (w > 0) {
              qA.setFromEuler(eA.set(0.55, toHim, 0.1, 'YXZ')); const now = c.root.quaternion.clone();
              c.root.quaternion.copy(s0.q).slerp(qA, ease).slerp(now, 1 - w);
              upV.set(0, s0.up, 0).applyQuaternion(c.root.quaternion); c.root.position.copy(pA).sub(upV); c.root.position.y += Math.max(0, FLOOR + 0.22 - c.root.position.y) * ease;
            }
          }
          if (!hd && ((tau > 9.6 && tau < 11.0) || (tau > 14.2 && tau < 15.4))) look = head(sci); // she looks back for him
        } else if (id === 'medic') {
          face = { frown: 0.45, fear: 0.35, open: 0.1 };
          const go = smoothstep(0.1, 1.6, tau);
          limbs = { ...limbs, armR: [-0.55, -0.45 + 0.5 * (1 - go), -0.5 + 1.2 * (1 - go)], foreR: [-0.5, -0.6 + 0.5 * (1 - go), -0.5 + 1.3 * (1 - go)], weight: smoothstep(0, 0.35, tau) }; // an arm for Nuvexa: out to her, then back as she tows
          look = tau < 2.4 ? hand(nuv, false) : (tau > 12.6 && tau < 13.6) || (tau > 17.4 && tau < 18.3) ? head(nuv) : look;
        } else if (id === 'social') {
          face = hurtN ? { fear: 0.6, squint: 0.7, open: 0.2 } : { fear: 0.75, open: 0.25 };
          limbs = { ...limbs, armR: [-0.35, -0.3, 0.6], foreR: [0.4, 0.3, 0.6], legL: [0.14, -1, hurtN ? 0.25 : -0.1], shinL: [0.1, -1, hurtN ? -0.7 : -0.4], bend: hurtN ? 0.35 : 0.1 }; // the phone to her chest
          delete hold.L; delete hold.R;
          if (tau >= 1.5) hold.L = { at: hand(lyr), fingers: V(1, 0, 0), palm: V(0, -1, 0), radius: 0.03, grasp: true }; // her wrist in Lyrra's hand
          look = tau < 2.6 ? head(lyr) : tau > 19 ? at(16, -0.9, 0.9) : head(lyr);
        } else if (id === 'strong') {
          face = { frown: 0.85, open: 0.25 };
          // off the ceiling: knees to the chest, then the shove; at the sofa an arm for Bolzar; at the hatch a hand on its frame
          const tuck = smoothstep(0.2, 0.9, tau) * (1 - smoothstep(1.0, 1.9, tau));
          if (tuck > 0) limbs = { ...limbs, legL: [0.35, -0.5 + 0.3 * tuck, 0.2 + 0.7 * tuck], legR: [-0.35, -0.5 + 0.3 * tuck, 0.2 + 0.7 * tuck], shinL: [0.2, -1, -0.3 * tuck], shinR: [-0.2, -1, -0.3 * tuck] };
          const tow: Limbs = hurtD ? { armR: [-0.7, -0.5, -0.2], foreR: [-0.6, -0.7, -0.2], armL: [0.3, -0.7, 0.55], foreL: [-0.7, 0.2, 0.6] } : { armL: [0.7, -0.5, -0.2], foreL: [0.6, -0.7, -0.2] };
          if (tau > 4.2) limbs = { ...limbs, ...tow };
          if (hurtD) { delete hold.L; delete hold.R; face = { frown: 0.7, squint: 0.6, open: 0.3 }; }
          if (tau > 10.2 + (hurtD ? 0.6 : 0) && tau < 12.0 + (hurtD ? 0.6 : 0) && !hurtD) hold.R = { at: at(PA.doorX - 0.03, -0.72, PA.doorZ + PA.doorW / 2 + 0.03), fingers: V(1, 0, 0), palm: V(0, 0, -1), radius: 0.03, grasp: true }; // the hatch's frame, beside it while Bolzar goes through
          look = tau > 2.0 && tau < 12.4 ? head(bol) : look;
        } else if (id === 'builder') {
          face = { fear: 0.75, squint: 0.4 };
          limbs = { ...FALL.builder, ...legs, bend: 0.5 - 0.2 * moving };
          // his arms go out for the sofa's back before the hands close on it, and stay out between it and Draxum's arm: a
          // hold switched on from a tucked arm turned his upper arm 134 degrees in a frame (glitch_pull)
          const out = smoothstep(2.9, 3.7, tau); limbs = { ...limbs, armL: [0.3, -0.4 + 0.5 * out, 0.9], foreL: [-0.4 + 0.5 * out, 0.15, 1], armR: [-0.3, -0.4 + 0.5 * out, 0.9], foreR: [0.4 - 0.5 * out, 0.15, 1] };
          if (tau > 3.85 && tau < 4.85) { const back = at(3.15, -1.33, -0.45), al = V(0.14, 0, 0.077); hold.L = { at: back.clone().add(al), fingers: V(-0.3, -0.4, 0.86).normalize(), palm: V(0, -1, 0), radius: 0.05, grasp: true }; hold.R = { at: back.clone().sub(al), fingers: V(-0.3, -0.4, 0.86).normalize(), palm: V(0, -1, 0), radius: 0.05, grasp: true }; look = back; }
          else if (tau >= 5.35) {
            // both hands (one, if the fall hurt him) round the arm that tows him
            const arm = (hurtD ? drx.handR : drx.handL).getWorldPosition(new THREE.Vector3()), g = { at: arm, fingers: V(0, 1, 0), palm: V(-1, 0, 0), radius: 0.045, grasp: true };
            hold.R = g; if (this.chose('e1.reach', 'nuvexa')) limbs = { ...limbs, armL: [0.3, -0.75, 0.5], foreL: [-0.6, 0.1, 0.7] }; else hold.L = { ...g, at: arm.clone().add(V(0, 0.07, 0)) };
            look = tau < 12.6 ? at(PA.doorX, -1, PA.doorZ) : look;
          }
        }
        // the breach: the air goes aft and takes them a little with it; hands fly to the rail, faces to the gap
        if (tau > TEAR) { const g = smoothstep(TEAR, TEAR + 0.8, tau); face = { ...face, fear: 0.9, open: 0.45 * g + (face.open ?? 0) * (1 - g) }; look = at(PA.tearX + 2.5, -0.4, PA.doorZ - 0.6); limbs = { ...limbs, hair: [0, 1, 0.4] }; }
        c.setLimbs(limbs); c.setFace(face); c.setLookTarget(look);
        c.setHold(hold.L || hold.R ? hold : null);
        c.setGrip('both', hold.L || hold.R ? { shape: 'grip', radius: 0.02 } : null);
      }
      // the core: on the console until he takes it, then under his arm
      if (cr && tau > 5.0) { const g = smoothstep(5.0, 5.8, tau); const want = sci.handL.getWorldPosition(new THREE.Vector3()); intr.group.worldToLocal(want); core.position.copy(coreHome).lerp(want, g); } else core.position.copy(coreHome);
      this.pullPose = { social: 'selfie' };
    };
    const runShot = (t0: number, t1: number, label: string, cam: (tau: number, k: number) => void, enter?: () => void) => shotAt(RUN + t0, RUN + t1, { label, enter, update: (k, local) => { run(t0 + local); this.scene.updateMatrixWorld(); cam(t0 + local, k); } }); // (by the shot's own time: the film's clock is stretched by the lines before it, RUN is not)
    // G6b: they hear him. Lyrra pushes off to Nuvexa and takes her wrist; above them Draxum tucks against the ceiling and shoves off
    runShot(0, 2.6, 'G6b', () => {
      const m = head(lyr).lerp(head(nuv), 0.5);
      lens(35); this.camera.position.copy(m).add(V(-0.9, 0.05, 3.1)); this.lookTarget.copy(m).add(V(0.15, 0.1, 0));
    }, () => {
      runStart.clear(); holdAt.clear(); this.scene.updateMatrixWorld(true);
      for (const c of intr.crew) { const ch = c.chest.getWorldPosition(new THREE.Vector3()), r = c.root.getWorldPosition(new THREE.Vector3()); runStart.set(c.id, { chest: intr.group.worldToLocal(ch.clone()), q: c.root.quaternion.clone(), up: ch.distanceTo(r) }); }
    });
    // G6c: Bolzar has hold of the sofa's back and will not let go; Draxum is coming down to him. Skyvra pushes off the
    // window frame towards Zenvik, her hand out for his: the choice
    runShot(2.6, 4.6, 'G6c', () => {
      lens(35); const m = head(bol).lerp(head(sky), 0.45); this.camera.position.copy(m).add(V(-2.1, -0.2, 2.8)); this.lookTarget.copy(m);
    });
    this.mcue(RUN + 2.75, 'e1.handcore', 'choice');
    // G7 the way out, established: the hatch aft slides open on the passage, lit red, ESCAPE PODS over it; they go for it
    // from where they float, in the order the answers made, and the first go through it
    this.cue(RUN + 4.7, () => { audio.tone(90, 1.1, 'sawtooth', 0.09, 0, 60); audio.thud(); });
    runShot(4.6, 9.4, 'G7', (tau, k) => {
      lens(24); this.camera.position.copy(at(lerp(-2.1, -1.2, k), -1.0, 2.35)); this.lookTarget.copy(at(5.2, -1.1, 0.6)); this.shake = 0.006;
    });
    // P1 the threshold, from inside the passage: they come through the hatch one after another, the lounge behind them
    runShot(9.4, 13.7, 'P1', () => {
      lens(28); this.camera.position.copy(at(8.7, -0.22, PA.doorZ + 0.72)); this.lookTarget.copy(at(PA.doorX, -1.05, PA.doorZ - 0.05)); this.shake = 0.006;
    });
    // P2 the passage, established down its length: the rails, the signs, and at its end the pod bay, six lit hatches
    runShot(13.7, 17.2, 'P2', (tau, k) => {
      lens(24); this.camera.position.copy(at(lerp(6.35, 6.9, k), -0.3, PA.doorZ + 0.66)); this.lookTarget.copy(at(18.5, -1.05, PA.doorZ - 0.1)); this.shake = 0.006;
    });
    // P3 their faces, from ahead of them, backing off as they come hand over hand: who holds whom
    runShot(17.2, TEAR, 'P3', (tau) => {
      const lead = Math.max(sci.chest.getWorldPosition(new THREE.Vector3()).x, sky.chest.getWorldPosition(new THREE.Vector3()).x);
      lens(30); this.camera.position.copy(at(lead + 2.1, -0.12, PA.doorZ + 0.8)); this.lookTarget.copy(at(lead - 1.4, -1.15, PA.doorZ - 0.05)); this.shake = 0.008 + 0.02 * smoothstep(18.6, TEAR, tau);
    });
    this.cue(RUN + 18.6, () => { audio.tone(48, 1.8, 'sawtooth', 0.16, 0, -8); audio.beep(); }); // the hull groans; the pod lamps go red
    // P4 insert, the cause: a seam opens across the passage ahead; the light of the hole comes through it; the air goes
    this.cue(RUN + TEAR, () => { audio.thud(); this.shake = 0.14; audio.alarm(false); audio.vacuum(true); ui.subtitle(null); });
    runShot(TEAR, TEAR + 1.5, 'P4', (tau) => {
      lens(40); this.camera.position.copy(at(PA.tearX - 2.7, -0.14, PA.doorZ + 0.25)); this.lookTarget.copy(at(PA.tearX + 1.3, -0.1, PA.doorZ - 0.55)); void tau; // over their heads
    });
    // P5 over their shoulders: the passage comes apart plate by plate, without a sound; the bay and its six lit hatches
    // drift away; nobody is getting there
    runShot(TEAR + 1.5, RUN_END, 'P5', (tau, k) => {
      lens(24); this.camera.position.copy(at(lerp(7.4, 7.9, k), -0.28, PA.doorZ + 0.7)); this.lookTarget.copy(at(17, -0.95, PA.doorZ - 0.15)); this.shake = 0.01;
    });
    // the breaking apart, the white and the six fates are the title sequence: montage.ts (it goes on from this state)
    this.cue(RUN + RUN_END, () => {
      this.runEnd = Object.fromEntries(intr.crew.map((c) => [c.id, { p: c.root.position.clone(), q: c.root.quaternion.clone() }]));
      holoOn(true); intr.crew.forEach((c) => { c.root.visible = true; c.setHold(null); c.setGrip('both', null); }); ui.subtitle(null); calm(); intr.crew.forEach((c) => c.setLookTarget(null));
      intr.group.scale.set(1, 1, 1); this.roll = 0; this.pullPose = {}; ins.cup(null); ins.warn(null); ins.comms(['COMMS', 'LINK OK']); ins.readout(['NAV', 'COURSE NOMINAL']); core.position.copy(coreHome);
      this.finish(true);
    });
  }

  /** Camera roll for the shot in hand (the deck tilting), and poses the pull gives the crew outside a staged scene. */
  private roll = 0;
  /** The pull's choices, as staged: Zenvik's slide (e1.brace), Draxum's arm giving (e1.hold). */
  private zenSlide = 0.5;
  private drxGive = 0;
  private bolY0 = 0;
  private pullPose: Partial<Record<CrewId, CrewPose>> = {};

  update(dt: number) {
    this.clockT += dt;
    if (this.stage) {
      this.stage.update(dt);
      this.animateCrew(dt);
      this.logCut(`${this.flashback ? 'fb' : 'L'}${(this.stage?.shotBeat ?? -1) + 1}`, this.flashback ? 'flashback' : 'departure');
      this.commonUpdate(dt);
      return;
    }
    if (!this.playing) return;
    let next = this.time + dt * (this.waiting ? this.momentScale() : 1);
    if (this.waiting) { const sh = this.shots.find((x) => this.time >= x.start && this.time < x.end); if (sh) next = Math.min(next, sh.end - 0.02); }
    // hold the picture rather than talk over a line (Hindi and Urdu run longer)
    const blocked = this.clockT < this.speechEnd && this.cues.some((c) => c.voiced && !c.done && c.t <= next);
    if (!blocked) this.time = next;
    const t = this.time;
    for (const c of this.cues) if (!c.done && t >= c.t) { c.done = true; c.fn(); if (!this.playing) return; }
    if (this.subClearAt && this.clockT > this.subClearAt) { this.subClearAt = 0; this.ui.subtitle(null); }
    this.animateCrew(dt);
    let film = false, label = '', cut = false;
    for (const s of this.shots) {
      if (t >= s.start && t < s.end) {
        label = s.label ?? `t${s.start.toFixed(1)}`;
        if (!s.done) {
          s.done = true; cut = true;
          this.camera.fov = 45; this.camera.updateProjectionMatrix();
          s.enter?.();
        }
        const local = t - s.start;
        this.roll = 0;
        s.update(clamp(local / (s.end - s.start), 0, 1), local);
        this.filmAt(s.film, local); film = true;
        break;
      }
    }
    if (!film) this.filmAt(undefined, 0);
    // a shot's first frame: the crew posed again after it (animateCrew ran before it, so the poses it set showed a frame
    // late: the cut frame with the last shot's arms, then a jump with no cut to hide it: Lyrra's forearm 84 and 104
    // degrees in a frame at the push-off and the pods, glitch_planet). dt 0: poses only, no time passes
    if (cut) this.animateCrew(0);
    if (this.ins.cockpit.visible) { this.pilot.root.updateMatrixWorld(); this.pilot.animate('stand', 0, 0, this.clockT, dt); this.yokeLog(); }
    if (label) this.logCut(label, t < 39 ? 'journey' : 'pull');
    this.camera.lookAt(this.lookTarget);
    if (this.roll) this.camera.rotateZ(this.roll);
    this.commonUpdate(dt);
  }

  /** Loose floor props (at rest) inside a piece of the lounge's furniture: pairs of names (continuity check). */
  deckOverlaps() {
    const f = this.interior.floaters, was = f.map((m) => m.position.clone());
    f.forEach((m) => m.position.copy(m.userData.base as THREE.Vector3));
    this.interior.group.updateMatrixWorld(true);
    const furniture: THREE.Object3D[] = []; this.interior.lounge.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.position.y > -2.19) furniture.push(o); });
    const out = overlaps(f, furniture);
    f.forEach((m, i) => m.position.copy(was[i]));
    return out;
  }

  private logCut(shot: string, scene: string) {
    if (!this.cont.on) return;
    const set = this.interior.group.visible ? 'deck' : this.ins.cockpit.visible ? 'cockpit' : 'space';
    this.scene.updateMatrixWorld();
    this.cont.frame(shot, scene, set, this.clockT, this.interior.lounge.visible, this.interior.crew, this.interior.group.position.y - 2.2, this.camera, this.stageState());
  }
  private lampWas = 0; private lampMoved = -9;
  /** The ship's state and the sound bed now (continuity log). */
  stageState(): StageState {
    const i = this.interior, a = i.alarmLight.intensity;
    if (Math.abs(a - this.lampWas) > 0.05) this.lampMoved = this.clockT; this.lampWas = a;
    return { gravity: this.gravOff ? 0 : 1, power: clamp(i.mainLight.intensity / 9, 0, 1), damage: this.damage, loose: this.gravOff ? 1 : 0, door: i.passage.open, air: this.airOut ? 0 : 1,
      alarm: audio.filmBeds.alarm, drone: audio.filmBeds.drone, score: audio.filmBeds.score, muffle: audio.filmBeds.muffle, lamp: a > 1 && this.clockT - this.lampMoved < 0.5 ? 1 : 0 };
  }
  /** The title sequence's shots inside the ship, on the same log as the pull (one event, one time). */
  logFilm(shot: string, crew: Character[]) {
    if (!this.cont.on) return;
    this.scene.updateMatrixWorld();
    this.cont.frame(shot, 'pull', 'deck', this.clockT, this.interior.lounge.visible, crew, this.interior.group.position.y - 2.2, this.camera, this.stageState());
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
