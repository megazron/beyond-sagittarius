import * as THREE from 'three';
import { createSpaceDome, createEarth, createOrbitalRing, createPlanet } from './space';
import { createShip, createInterior } from './ship';
import { easeInOut, clamp, smoothstep, lerp } from '../core/noise';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { Cutscene, Beat } from './cutscene';
import { deckScene, fightScene, stageDeck } from './scenes';
import type { Character, CrewId } from '../characters/character';

export interface CineUI {
  subtitle(key: string | null, speakerKey?: string): void;
  caption(key: string | null): void;
  chapter(keys: string[] | null): void;
  mission(keys: string[] | null): void;
  aiAlert(key: string | null): void;
  fade(color: 'black' | 'white', to: number, seconds: number): void;
}

interface Cue { t: number; fn: () => void; done?: boolean; voiced?: boolean }
interface Shot { start: number; end: number; enter?: () => void; update: (k: number, local: number) => void; done?: boolean }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class Cinematic {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 40000);
  time = 0;
  playing = false;
  readonly duration = 62;
  private dome = createSpaceDome();
  private sunDir = V(1, 0.22, 0.55).normalize();
  private earth = createEarth(100, this.sunDir);
  private ring = createOrbitalRing(128);
  private ship = createShip();
  private interior = createInterior(matchMedia('(pointer: coarse)').matches ? 0.6 : 1);
  private mars = createPlanet(60, 'mars', this.sunDir);
  private giant = createPlanet(260, 'giant', this.sunDir);
  private giantRing: THREE.Mesh;
  private sunLight = new THREE.DirectionalLight(0xfff2e0, 3.2);
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
    this.interior.group.position.set(60000, 0, 0);
    s.add(this.interior.group);
    this.mars.position.set(20000, 0, 0);
    s.add(this.mars);
    this.giant.position.set(40000, 0, 0);
    s.add(this.giant);
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
    const sun = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 26, 20) }));
    sun.position.copy(this.sunDir).multiplyScalar(7000);
    s.add(sun);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(100);
    s.add(this.sunLight);
    s.add(new THREE.AmbientLight(0x223355, 0.35));

    this.bhRot.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.22, 0, 0.32))).transpose();
    this.dome.uniforms.uBHRot.value = this.bhRot;
    this.buildTimeline();
    this.idle(0);
  }

  /** Slow orbital view of Earth used behind the title screen. */
  idle(dt: number) {
    this.time += dt;
    this.setVisible('earth');
    const a = this.time * 0.02;
    this.camera.position.set(Math.sin(a) * 40 - 70, 30, 300 + Math.cos(a) * 20);
    this.lookTarget.set(-20, 10, 0);
    this.camera.lookAt(this.lookTarget);
    this.ship.group.position.set(-28, 22, 205);
    this.ship.group.lookAt(V(-200, 40, 400));
    this.commonUpdate(dt);
  }

  start(onDone: () => void) {
    this.onDone = onDone;
    this.time = 0;
    this.playing = true;
    this.cues.forEach((c) => (c.done = false));
    this.shots.forEach((s) => (s.done = false));
    audio.startDrone();
  }

  /** Jump to a time (debug / screenshots). Earlier cues are marked done without firing. */
  seek(t: number) {
    if (!this.playing) return;
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
  private get cast() {
    const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social'];
    return Object.fromEntries(ids.map((id, i) => [id, this.interior.crew[i]])) as Record<CrewId, Character>;
  }
  /** Freeze the timeline for the character scene on the observation deck. */
  private holdDeck() {
    this.runStage(deckScene(this.cast, this.interior.group.position), () => {
      this.time = Math.max(this.time, 38.8);
      this.interior.crew.forEach((c) => c.root.rotation.set(0, Math.PI, 0));
    });
  }

  private runStage(beats: Beat[], done: () => void) {
    stageDeck(this.cast, -2.2);
    this.scene.updateMatrixWorld(true);
    this.stage = new Cutscene(beats, {
      camera: this.camera,
      actors: this.cast,
      subtitle: (k, sp) => this.ui.subtitle(k, sp),
      onDone: () => { this.stage = null; done(); },
    });
  }

  /** Back to the title backdrop. */
  resetIdle() { this.setVisible('earth'); this.dome.uniforms.uBH.value = 0; this.camera.fov = 45; this.camera.updateProjectionMatrix(); }

  /** Stand-alone flashback on the deck, used between levels. */
  playFlashback(done: () => void) {
    this.setVisible('interior');
    const d = this.dome.uniforms;
    d.uWarp.value = 0; d.uBH.value = 0; d.uNebula.value = 0.9;
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
      c.animate(poses?.[c.id as CrewId] ?? 'idle', 0, 0, this.clockT, dt);
    });
  }
  private clockT = 0;

  private finish() {
    this.playing = false;
    this.stage = null;
    audio.alarm(false);
    audio.stopDrone();
    this.ui.subtitle(null); this.ui.caption(null); this.ui.mission(null); this.ui.aiAlert(null); this.ui.chapter(null);
    const cb = this.onDone; this.onDone = null;
    cb?.();
  }

  private setVisible(group: 'earth' | 'mars' | 'giant' | 'interior' | 'deep') {
    this.earth.group.visible = group === 'earth';
    this.ring.visible = group === 'earth';
    this.mars.visible = group === 'mars';
    this.giant.visible = group === 'giant';
    this.giantRing.visible = group === 'giant';
    this.interior.group.visible = group === 'interior';
    this.ship.group.visible = group !== 'interior';
  }

  private cue(t: number, fn: () => void) { this.cues.push({ t, fn }); }
  /** A spoken cue: the timeline waits for the previous line to finish before firing it. */
  private vcue(t: number, key: string, fn: () => void) {
    this.cues.push({ t, voiced: true, fn: () => { this.speechEnd = this.clockT + (voice.duration(key) ?? 2) + 0.15; fn(); } });
  }
  private speechEnd = 0;

  private buildTimeline() {
    const ui = this.ui;
    const d = this.dome.uniforms;
    const ship = this.ship;
    const shipDir = V(-0.55, 0.12, 0.83).normalize();
    const shipStart = V(-6, 20, 170);

    // ---- Scene 1: Departure ----
    this.cue(0.3, () => ui.chapter(['cine.year', 'cine.chapter']));
    this.cue(5.0, () => ui.chapter(null));
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
    this.vcue(39.8, 'cine.ai1', () => { ui.subtitle(null); ui.aiAlert('cine.ai1'); audio.alarm(true); });
    this.cue(44.2, () => { ui.aiAlert(null); audio.alarm(false); });
    const intr = this.interior;
    this.shots.push({
      start: 33.4, end: 40.6,
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

    // ---- Approach Sagittarius A* ----
    this.cue(41.0, () => ui.caption('cine.approach'));
    this.vcue(43.0, 'op.19', () => ui.subtitle('op.19', 'crew.social.name'));
    this.vcue(45.4, 'op.20', () => { ui.caption(null); ui.subtitle('op.20', 'crew.scientist.name'); });
    this.vcue(46.2, 'cine.line6', () => ui.subtitle('cine.line6', 'crew.scientist.name'));
    this.cue(49.8, () => ui.subtitle(null));
    this.shots.push({
      start: 40.6, end: 46.6,
      enter: () => { this.setVisible('deep'); d.uBH.value = 1; d.uNebula.value = 0.8; },
      update: (k) => {
        const p = V(80000, 0, 0);
        ship.group.position.copy(p);
        ship.group.lookAt(p.clone().add(V(0, 0, -1)));
        (ship.plume.material as THREE.ShaderMaterial).uniforms.uPower.value = 0.3;
        ship.engineGlow.color.setRGB(0.5, 1.0, 2.5);
        this.camera.position.copy(p).add(V(lerp(5, 3, k), lerp(2.2, 1.4, k), lerp(14, 11, k)));
        this.lookTarget.copy(p).add(V(0, 0.8, -20));
        const dist = lerp(160, 70, easeInOut(k));
        d.uBHPos.value.set(-4, 7, -dist);
        d.uWarp.value = k * 0.15; d.uWarpDir.value.set(0, 0, -1);
        this.shake = k * 0.015;
      },
    });

    // ---- Scene 3: The Event ----
    this.vcue(46.7, 'cine.ai2', () => { ui.aiAlert('cine.ai2'); audio.alarm(true); audio.thud(); });
    this.vcue(50.6, 'cine.line7', () => { ui.aiAlert(null); ui.subtitle('cine.line7', 'crew.social.name'); });
    this.shots.push({
      start: 46.6, end: 52.4,
      enter: () => { this.setVisible('interior'); },
      update: (k, local) => {
        const b = intr.group.position;
        this.camera.position.copy(b).add(V(-3.0, 0.3, 2.6));
        this.lookTarget.copy(b).add(V(1.0, -0.6, -1.5));
        d.uBHPos.value.set(-6, 10, -lerp(60, 40, k));
        intr.alarmLight.intensity = (Math.sin(local * 9) * 0.5 + 0.5) * 70;
        intr.mainLight.intensity = 9 * (0.35 + 0.65 * (Math.sin(local * 37) > -0.6 ? 1 : 0.1)) * (1 - k * 0.5);
        intr.holo.uniforms.uAlarm.value = 1;
        intr.holo.uniforms.uSpike.value = 2;
        const g = smoothstep(0.3, 2.2, local);
        for (const f of intr.floaters) {
          const base = f.userData.base as THREE.Vector3;
          const spin = f.userData.spin as THREE.Vector3;
          f.position.y = base.y + g * f.userData.rise * local * 0.55;
          f.rotation.x += spin.x * 0.016 * g; f.rotation.y += spin.y * 0.016 * g; f.rotation.z += spin.z * 0.016 * g;
        }
        intr.crew.forEach((c, i) => {
          c.root.position.y = -2.2 + g * (0.15 + 0.08 * Math.sin(local * 1.3 + i));
          c.armL.rotation.z = -0.4 * g - 0.3 * Math.sin(local * 2 + i) * g;
          c.armR.rotation.z = 0.4 * g + 0.3 * Math.sin(local * 2.2 + i) * g;
          c.root.rotation.z = Math.sin(local * 0.7 + i) * 0.15 * g;
        });
        this.shake = 0.035 + 0.03 * Math.max(0, Math.sin(local * 3));
      },
    });

    this.vcue(52.6, 'cine.line8', () => ui.subtitle('cine.line8', 'crew.strong.name'));
    this.vcue(54.6, 'op.21', () => ui.subtitle('op.21', 'crew.explorer.name'));
    this.cue(56.6, () => ui.subtitle(null));
    this.cue(53.0, () => audio.whoosh());
    this.shots.push({
      start: 52.4, end: 57.6,
      enter: () => {
        this.setVisible('deep');
        ship.pods.forEach((p) => { p.visible = true; p.position.set(p.userData.dir.x * 0.95, p.userData.dir.y * 0.95, -0.5); });
      },
      update: (k, local) => {
        const p = V(80000, 0, 0);
        ship.group.position.copy(p);
        ship.group.rotation.z += 0.004;
        ship.ring.rotation.z += 0.03;
        for (const pod of ship.pods) {
          const dir = pod.userData.dir as THREE.Vector3;
          pod.position.set(dir.x * (0.95 + local * 2.2), dir.y * (0.95 + local * 2.2), -0.5 + dir.z * local * 2.2);
        }
        this.camera.position.copy(p).add(V(lerp(-7, -9, k), lerp(3, 4, k), lerp(11, 14, k)));
        this.lookTarget.copy(p).add(V(0, 1, -12));
        const dist = lerp(38, 16, easeInOut(k));
        d.uBHPos.value.set(-3, 2.5, -dist);
        d.uWarp.value = lerp(0.2, 1.0, k);
        d.uWarpDir.value.set(0, 0, -1);
        this.shake = 0.05 + k * 0.08;
      },
    });

    // ---- Glimpse of another universe → white out ----
    this.cue(59.2, () => ui.fade('white', 1, 1.2));
    this.cue(60.6, () => ui.fade('black', 1, 0.05));
    this.shots.push({
      start: 57.6, end: 60.6,
      update: (k) => {
        const p = V(80000, 0, 0);
        ship.group.visible = false;
        this.camera.position.copy(p);
        this.lookTarget.copy(p).add(V(0, 0, -10));
        d.uBHPos.value.set(0, 1.5, -lerp(14, 6, k));
        d.uBH.value = lerp(1, 0.2, k);
        d.uOther.value = smoothstep(0.1, 0.7, k);
        d.uWarp.value = 1.4;
        this.camera.fov = lerp(45, 95, easeInOut(k));
        this.camera.updateProjectionMatrix();
        this.shake = 0.06;
      },
    });
    this.cue(61.8, () => this.finish());
  }

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
        s.update(clamp(local / (s.end - s.start), 0, 1), local);
        break;
      }
    }
    this.camera.lookAt(this.lookTarget);
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
