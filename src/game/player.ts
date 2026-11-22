import * as THREE from 'three';
import { createCharacter, Character, CrewId, CrewPose } from '../characters/character';
import type { PlayerLook } from '../characters/custom';
import { clamp } from '../core/noise';
import type { Terrain } from '../world/terrain';
import type { Forest } from '../world/forest';
import type { Input } from './input';
import { HALF } from '../world/terrain';
import { audio, type Surface } from '../core/audio';

const angleTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * Third-person survivor controller. Weight comes from the velocity ramps; the
 * camera follows a damped focus point, bobs with the stride, kicks its FOV when
 * sprinting and pulls in softly when a tree comes between it and the player.
 */
/** The lake's surface, where you start to swim, where you can stand again, and how low a swimmer floats. */
export const WATER_Y = 0;
const SWIM_IN = 1.25, SWIM_OUT = 1.05, FLOAT = 1.3;

export class Player {
  model: Character;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; // camera yaw
  pitch = -0.18;
  facing = 0;
  camDist = 5.2;
  onGround = true;
  walkPhase = 0;
  speedNow = 0;
  sprinting = false;
  blockedDeep = false;
  inWater = false;
  /** Out of your depth: floating, head above water. */
  swimming = false;
  private swimLift = 0;
  sensitivity = 1;
  invertY = false;
  /** Body pose (the wake-up lies down, cutscenes can override). */
  pose: CrewPose = 'idle';
  private camPos = new THREE.Vector3();
  private camClip = 1;
  /** Damped point the camera orbits, so it trails the body a little. */
  private focus = new THREE.Vector3();
  private yawS = 0;
  private pitchS = -0.18;
  /** Orbit distance after tree clearance. */
  private distS = 5.2;
  private baseFov: number;
  private fovKick = 0;
  private bobK = 0;
  private lean = 0;
  private dip = 0;
  private dipV = 0;

  /** What a footstep sounds like here (the planet is grass and moss). */
  surface: (x: number, z: number) => Surface = () => 'grass';
  private stepAcc = 0;
  /**
   * The fight's hold on the body (src/combat sets it every frame it needs it; null gives the body back). `scale` is how
   * much of walking speed is left, `force` a velocity that replaces the stick (a roll, a knock-back), `face` the way to
   * turn (radians, or null), `aim` 0 to 1 pulls the camera in over the right shoulder, `crouch` lowers the hips (metres),
   * `sprint` overrides the sprint button, `sneak` caps the speed to a creep.
   */
  combat: { scale: number; force: { x: number; z: number } | null; face: number | null; aim: number; crouch: number; sprint: boolean | null; sneak: boolean; jump: boolean; shoulder?: number; lift?: number;
    /** 0..1: the view swings round to look behind (a glance back in a chase); the walk keeps its own heading. */
    back?: number;
    /** radians: the view turns this far from the walk's heading (a look at a trap that springs nearby); view only. */
    turn?: number;
    /** 0..1: draw the view in a little (narrower field of view) on something the fight wants seen (a trap's catch). */
    zoom?: number } | null = null;
  private aimS = 0;
  /** How crowded it is round you (the stage's, 0 to 1): the camera rises over the heads and looks down at you. */
  crowdNear: (() => number) | null = null;
  private crowdS = 0;
  private backS = 0;
  private turnS = 0;
  private zoomS = 0;
  /** Stages other than Verdaxis set their own gravity, and let you jump across open gaps. */
  physics = { gravity: 14, jump: 5.2, gaps: false };

  constructor(private terrain: Pick<Terrain, 'height'>, private forest: Pick<Forest, 'collide' | 'blocks' | 'clearance'> & Partial<Pick<Forest, 'inFoliage'>>, public camera: THREE.PerspectiveCamera, detail = 1, id: CrewId = 'scientist', skin?: string) {
    this.model = createCharacter(id, detail, undefined, skin);
    this.baseFov = camera.fov;
    this.model.setGround((x, z) => this.terrain.height(x, z));
  }

  /** Swap in the player's look (character creator). */
  setLook(look: PlayerLook, detail: number, reattach: () => void) {
    const parent = this.model.root.parent;
    const old = this.model.root;
    this.model = createCharacter('scientist', detail, look);
    this.model.setGround((x, z) => this.terrain.height(x, z));
    this.model.root.position.copy(old.position);
    this.model.root.rotation.copy(old.rotation);
    if (parent) { parent.remove(old); parent.add(this.model.root); }
    reattach();
  }

  spawn(x: number, z: number, yaw: number) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.yaw = yaw; this.facing = yaw;
    this.vel.set(0, 0, 0);
    this.model.root.position.copy(this.pos);
    this.snapCamera();
  }

  /** Seconds the body is busy with its hands (act): it stays where it is, turned to the work. */
  private busyT = 0;
  private busyFace: number | null = null;
  /** Do a task with the hands (see Character.doTask), standing still for it and turned towards `at`. */
  act(kind: import('../characters/character').TaskKind, at?: THREE.Vector3 | null, seconds?: number, prop?: import('../characters/character').PropKind | null) {
    this.model.doTask(kind, { at, seconds, prop });
    const t = this.model.task;
    this.busyT = Math.max(this.busyT, (t?.dur ?? 1) * 0.85);
    this.busyFace = at ? Math.atan2(-(at.x - this.pos.x), -(at.z - this.pos.z)) : null;
    if (at && Math.hypot(at.x - this.pos.x, at.z - this.pos.z) < 0.05) this.busyFace = null;
  }
  get busy() { return this.busyT > 0; }
  /** Stop what the hands are doing (a panel closed, the job is over). */
  endAct() { this.model.stopTask(); this.busyT = 0; this.busyFace = null; }

  update(dt: number, input: Input, canMove: boolean, stamina: number, slow: number) {
    if (this.busyT > 0) {
      this.busyT -= dt; canMove = false;
      if (this.busyFace !== null) { const d = angleTo(this.facing, this.busyFace); this.facing += d * (1 - Math.exp(-dt * 8)); }
    }
    // look
    const sens = 0.0024 * this.sensitivity;
    this.yaw -= input.lookDX * sens;
    this.pitch -= input.lookDY * sens * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.2, 0.55);
    this.camDist = clamp(this.camDist + input.wheel * 0.6, 2.4, 10);
    if (input.down('ArrowLeft')) this.yaw += dt * 2;
    if (input.down('ArrowRight')) this.yaw -= dt * 2;

    // move
    let mx = 0, mz = 0;
    if (canMove) {
      if (input.held('forward')) mz += 1;
      if (input.held('back')) mz -= 1;
      if (input.held('left')) mx -= 1;
      if (input.held('right')) mx += 1;
      mx += input.touchMove.x + input.padMove.x; mz -= input.touchMove.y + input.padMove.y;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const moving = len > 0.05;
    const cb = this.combat;
    this.sprinting = moving && canMove && (cb?.sprint ?? input.held('sprint')) && stamina > 2 && mz > 0 && !(cb && (cb.scale < 0.9 || cb.sneak));
    let speed = (this.sprinting ? 7.2 : 4.0) * slow * (cb ? cb.scale : 1);
    if (cb?.sneak) speed = Math.min(speed, 1.9);
    if (this.swimming) speed = (this.sprinting ? 2.6 : 1.7) * slow;
    else if (this.inWater) speed *= 0.55;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const wx = (fx * mz + rx * mx) * speed, wz = (fz * mz + rz * mx) * speed;
    // ramp up slower than you stop, slowest of all in the air
    const hsNow = Math.hypot(this.vel.x, this.vel.z), hsWant = Math.hypot(wx, wz);
    const rate = !this.onGround ? 1.6 : hsWant > hsNow ? (this.sprinting ? 4.2 : 7.5) : 9.5;
    const k = 1 - Math.exp(-dt * rate);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    if (cb?.force) { this.vel.x = cb.force.x; this.vel.z = cb.force.z; }

    if (canMove && this.onGround && !this.swimming && input.act('jump') && (!cb || cb.jump)) { this.vel.y = this.physics.jump; this.onGround = false; }
    this.vel.y -= this.physics.gravity * dt;

    const next = this.pos.clone();
    next.x += this.vel.x * dt;
    next.z += this.vel.z * dt;
    const px = next.x, pz = next.z;
    this.forest.collide(next, 0.35);
    // brushing a trunk slides along it: drop only the velocity going into the tree
    const ox = next.x - px, oz = next.z - pz, ol = Math.hypot(ox, oz);
    if (ol > 1e-4) {
      const vn = (this.vel.x * ox + this.vel.z * oz) / ol;
      if (vn < 0) { this.vel.x -= (ox / ol) * vn; this.vel.z -= (oz / ol) * vn; }
    }
    next.x = clamp(next.x, -HALF + 80, HALF - 80);
    next.z = clamp(next.z, -HALF + 80, HALF - 80);
    // prevent wading into deep water and climbing cliffs
    const gNext = this.terrain.height(next.x, next.z);
    const gNow = this.terrain.height(this.pos.x, this.pos.z);
    this.blockedDeep = false;
    if (!this.physics.gaps) {
      const climb = (gNext - gNow) / Math.max(1e-3, Math.hypot(next.x - this.pos.x, next.z - this.pos.z));
      if (climb > 1.6 && gNext > gNow) { next.x = this.pos.x; next.z = this.pos.z; }
    } else if (gNext > this.pos.y + .35) { next.x = this.pos.x; next.z = this.pos.z; } // a ledge above you is a wall
    this.pos.x = next.x; this.pos.z = next.z;
    this.pos.y += this.vel.y * dt;
    const ground = this.terrain.height(this.pos.x, this.pos.z);
    // chest deep and you swim; shallow enough to stand and you walk out
    const depth = WATER_Y - ground;
    if (!this.physics.gaps) this.swimming = this.swimming ? depth > SWIM_OUT : depth > SWIM_IN;
    if (this.swimming) { this.pos.y = WATER_Y - FLOAT; this.vel.y = 0; this.onGround = true; }
    else {
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -4) audio.human('land', 0.5);
      if (!this.onGround && this.vel.y < -3) this.dipV -= Math.min(1.6, -this.vel.y * 0.2); // landing weight
      this.pos.y = ground; this.vel.y = 0; this.onGround = true;
    }
    // walking downhill keeps your feet on the ground instead of stepping off into the air
    else if (this.onGround && this.vel.y <= 0 && this.pos.y - ground < 0.45) { this.pos.y = ground; this.vel.y = 0; }
    else if (this.pos.y - ground > 0.15) this.onGround = false;
    }
    this.inWater = !this.physics.gaps && ground < -0.25;

    // animate model
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hs;
    if (cb && cb.face !== null) {
      const d = angleTo(this.facing, cb.face);
      this.facing += d * (1 - Math.exp(-dt * 16));
    } else if (hs > 0.3) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * (1 - Math.exp(-dt * 10));
    }
    this.walkPhase += dt * hs * 2.1;
    // a footstep every stride's length: longer strides the faster you go
    if (this.onGround && !this.swimming && hs > 0.6) {
      this.stepAcc += hs * dt;
      const stride = 0.6 + 0.22 * hs;
      if (this.stepAcc >= stride) {
        this.stepAcc -= stride;
        if (this.inWater) audio.sample('splash', 0.12, { rate: 1.3 });
        else audio.step(this.surface(this.pos.x, this.pos.z), this.sprinting ? 0.55 : 0.38);
      }
    } else this.stepAcc = Math.min(this.stepAcc, 0.3);
    this.model.root.position.copy(this.pos);
    if (cb?.crouch) this.model.root.position.y -= cb.crouch;
    if (this.inWater && !this.swimming) this.model.root.position.y = Math.max(this.pos.y, -0.55);
    // treading water keeps the head up; swimming lies the body flat along the surface
    if (this.swimming) { this.swimLift += (clamp(hs / 1.4, 0, 1) - this.swimLift) * (1 - Math.exp(-dt * 3)); this.model.root.position.y = WATER_Y - FLOAT + this.swimLift * 0.85; }
    this.model.root.rotation.y = this.facing + Math.PI;
    this.model.root.updateMatrixWorld();
    this.model.animate(this.swimming && this.pose === 'idle' ? 'swim' : this.onGround || this.pose !== 'idle' ? this.pose : 'jump', this.walkPhase, clamp(hs / 4, 0, 1.3), performance.now() / 1000, dt);

    this.updateCamera(dt);
  }

  /** Orbit position around `focus` at `dist`, kept above the ground. */
  private orbit(out: THREE.Vector3, focus: THREE.Vector3, yaw: number, pitch: number, dist: number) {
    const cp = Math.cos(pitch);
    out.set(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp).multiplyScalar(dist);
    out.add(focus);
    out.y += 1.65 + 0.3 * this.crowdS;
    // walk the line from the head to the camera: stop short of hills and trunks
    const hx = focus.x, hy = focus.y + 1.65, hz = focus.z;
    let free = 1;
    for (let k = 1; k <= 10; k++) {
      const f = k / 10, x = hx + (out.x - hx) * f, y = hy + (out.y - hy) * f, z = hz + (out.z - hz) * f;
      if (y < this.terrain.height(x, z) + 0.3 || this.forest.blocks(x, z, 0.28) || (k > 2 && this.forest.inFoliage?.(x, y, z))) { free = Math.max(0.16, (k - 1) / 10); break; }
    }
    // pull in at once, ease back out, so the view never pops
    this.camClip = free < this.camClip ? free : this.camClip + (free - this.camClip) * 0.05;
    out.x = hx + (out.x - hx) * this.camClip; out.y = hy + (out.y - hy) * this.camClip; out.z = hz + (out.z - hz) * this.camClip;
    // the lens itself keeps half a metre off any trunk: the line test passes a trunk the camera ends up grazing from
    // the side (a dark wall over a third of the picture, or the inside of the bark for a frame as the view swings)
    // (a search along the line, not fixed steps, so the pull is smooth as the view swings)
    // (not when the player stands against the trunk: then every spot near the head is 'too close')
    if (this.forest.blocks(out.x, out.z, 0.5) && !this.forest.blocks(hx, hz, 0.5)) {
      let lo = 0, hi = 1;
      for (let s = 0; s < 7; s++) { const m = (lo + hi) / 2; if (this.forest.blocks(hx + (out.x - hx) * m, hz + (out.z - hz) * m, 0.5)) hi = m; else lo = m; }
      const f = Math.max(0.16, lo);
      out.x = hx + (out.x - hx) * f; out.y = hy + (out.y - hy) * f; out.z = hz + (out.z - hz) * f;
    }
    // pulled in hard (a slope, a log or the camp's stones behind the player) the camera would sit inside the head:
    // keep it a metre off by rising over the head instead, looking down past it
    const near = Math.min(dist, 1.05), ox = out.x - hx, oz = out.z - hz, oh = Math.hypot(ox, oz);
    if (Math.hypot(oh, out.y - hy) < near) out.y = hy + Math.sqrt(Math.max(0, near * near - oh * oh));
    const g =Math.max(this.terrain.height(out.x, out.z) + 0.3, 0.45);
    if (out.y < g) out.y = g;
    return out;
  }

  snapCamera() {
    this.focus.copy(this.pos);
    this.yawS = this.yaw; this.pitchS = this.pitch; this.distS = this.camDist;
    this.fovKick = 0; this.bobK = 0; this.lean = 0; this.dip = 0; this.dipV = 0; this.backS = 0; this.turnS = 0; this.zoomS = 0;
    if (this.camera.fov !== this.baseFov) { this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); }
    this.camClip = 1;
    this.orbit(this.camPos, this.focus, this.yaw, this.pitch, this.camDist);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.pos.x, this.pos.y + 1.5, this.pos.z);
  }

  private updateCamera(dt: number) {
    const e = (r: number) => 1 - Math.exp(-dt * r);
    // the body leads, the camera catches up: more slack vertically, so steps and jumps feel soft
    this.focus.x += (this.pos.x - this.focus.x) * e(12);
    this.focus.z += (this.pos.z - this.focus.z) * e(12);
    this.focus.y += (this.pos.y - this.focus.y) * e(8);
    // look keeps a very short filter: smooths mouse steps and touch jitter, adds no felt delay
    const dyaw = angleTo(this.yawS, this.yaw);
    this.yawS += dyaw * e(32);
    this.pitchS += (this.pitch - this.pitchS) * e(32);

    // a glance back: the view only, eased so it reads as a turn of the head, not a cut
    const backWant = this.combat?.back ?? 0;
    this.backS += (backWant - this.backS) * e(backWant > this.backS ? 7 : 5);
    const back = this.backS * this.backS * (3 - 2 * this.backS);
    // in a thick crowd the camera does not sit low among the heads looking up: it rises and looks down (eased in and out)
    const cw = this.crowdNear ? this.crowdNear() : 0;
    this.crowdS += (cw - this.crowdS) * e(cw > this.crowdS ? 2.5 : 1.2);
    // a look aside (a trap springing nearby): eased in like a turn of the head, a little slower back
    const turnWant = this.combat?.turn ?? 0;
    this.turnS += (turnWant - this.turnS) * e(Math.abs(turnWant) > Math.abs(this.turnS) ? 4.5 : 2.2);
    const turnK = Math.min(1, Math.abs(this.turnS) / 0.6);
    const yawV = this.yawS + back * 2.75 + this.turnS, pitchV = this.pitchS + (Math.min(this.pitchS, -0.38) - this.pitchS) * this.crowdS - back * 0.12 - turnK * 0.07;
    // soft collision: pull in fast when a trunk blocks the view, ease back out slowly
    const want = this.orbit(tmpA, this.focus, yawV, pitchV, this.camDist);
    const clear = this.forest.clearance(this.focus.x, this.focus.z, want.x, want.z, 0.4);
    const target = Math.max(1.3, this.camDist * clear);
    this.distS += (target - this.distS) * e(target < this.distS ? 16 : 2.5);
    // aiming: in close, over the right shoulder, looking where the shot will go instead of at the body
    const aimWant = this.combat?.aim ?? 0;
    this.aimS += (aimWant - this.aimS) * e(aimWant > this.aimS ? 12 : 8);
    const aim = this.aimS;
    this.orbit(this.camPos, this.focus, yawV, pitchV, this.distS * (1 - aim) + Math.min(this.distS, 3.1) * aim);

    // stride: vertical twice per cycle, sideways once, growing with speed
    const run = clamp(this.speedNow / 7.2, 0, 1);
    this.bobK += ((this.onGround ? run : 0) - this.bobK) * e(8);
    const bobY = Math.sin(this.walkPhase * 2) * (0.018 + 0.05 * this.bobK) * Math.min(1, this.bobK * 4);
    const bobX = Math.cos(this.walkPhase) * 0.03 * this.bobK;
    // landing spring
    this.dipV += (-this.dip * 90 - this.dipV * 14) * dt;
    this.dip += this.dipV * dt;
    tmpB.set(Math.cos(this.yawS), 0, -Math.sin(this.yawS)).multiplyScalar(bobX);
    this.camera.position.copy(this.camPos).add(tmpB);
    this.camera.position.y += bobY + this.dip * 0.12;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.focus.x, this.focus.y + 1.45 + bobY * 0.4 + this.dip * 0.05, this.focus.z);
    if (aim > 0.002) {
      const cp = Math.cos(this.pitchS), fx = -Math.sin(this.yawS) * cp, fy = Math.sin(this.pitchS), fz = -Math.cos(this.yawS) * cp;
      const rx = Math.cos(this.yawS), rz = -Math.sin(this.yawS);
      tmpA.copy(this.camera.position);
      const sh = this.combat?.shoulder ?? 0.85, lift = this.combat?.lift ?? 0.12;
      tmpA.x += rx * sh * aim; tmpA.z += rz * sh * aim; tmpA.y += lift * aim;
      tmpC.copy(this.camera.quaternion);
      this.camera.position.copy(tmpA);
      this.camera.lookAt(tmpA.x + fx * 30, tmpA.y + fy * 30, tmpA.z + fz * 30);
      this.camera.quaternion.slerpQuaternions(tmpC, this.camera.quaternion, aim);
    }
    // a touch of bank into fast turns
    this.lean += (clamp(dyaw * 1.4, -0.03, 0.03) - this.lean) * e(6);
    if (Math.abs(this.lean) > 1e-4) this.camera.rotateZ(this.lean);

    // FOV kick while sprinting
    this.fovKick += ((this.sprinting ? 6.5 : 0) - this.fovKick) * e(this.sprinting ? 3.5 : 6);
    const zw = this.combat?.zoom ?? 0;
    this.zoomS += (zw - this.zoomS) * e(zw > this.zoomS ? 2.2 : 1.6);
    const fov = this.baseFov + this.fovKick - 9 * aim - 15 * this.zoomS;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /** Unit vector the player is facing (horizontal). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
  }
}
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Quaternion();
