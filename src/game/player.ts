import * as THREE from 'three';
import { createCharacter, Character, CrewPose } from '../characters/character';
import type { PlayerLook } from '../characters/custom';
import { clamp } from '../core/noise';
import type { Terrain } from '../world/terrain';
import type { Forest } from '../world/forest';
import type { Input } from './input';
import { HALF } from '../world/terrain';
import { audio } from '../core/audio';

const angleTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * Third-person survivor controller. Weight comes from the velocity ramps; the
 * camera follows a damped focus point, bobs with the stride, kicks its FOV when
 * sprinting and pulls in softly when a tree comes between it and the player.
 */
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

  constructor(private terrain: Terrain, private forest: Forest, public camera: THREE.PerspectiveCamera, detail = 1) {
    this.model = createCharacter('scientist', detail);
    this.baseFov = camera.fov;
  }

  /** Swap in the player's look (character creator). */
  setLook(look: PlayerLook, detail: number, reattach: () => void) {
    const parent = this.model.root.parent;
    const old = this.model.root;
    this.model = createCharacter('scientist', detail, look);
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

  update(dt: number, input: Input, canMove: boolean, stamina: number, slow: number) {
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
      if (input.down('KeyW') || input.down('ArrowUp')) mz += 1;
      if (input.down('KeyS') || input.down('ArrowDown')) mz -= 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
      mx += input.touchMove.x; mz -= input.touchMove.y;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const moving = len > 0.05;
    this.sprinting = moving && canMove && (input.down('ShiftLeft') || input.down('ShiftRight')) && stamina > 2 && mz > 0;
    let speed = (this.sprinting ? 7.2 : 4.0) * slow;
    if (this.inWater) speed *= 0.55;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const wx = (fx * mz + rx * mx) * speed, wz = (fz * mz + rz * mx) * speed;
    // ramp up slower than you stop, slowest of all in the air
    const hsNow = Math.hypot(this.vel.x, this.vel.z), hsWant = Math.hypot(wx, wz);
    const rate = !this.onGround ? 1.6 : hsWant > hsNow ? (this.sprinting ? 4.2 : 7.5) : 9.5;
    const k = 1 - Math.exp(-dt * rate);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    if (canMove && this.onGround && input.hit('Space')) { this.vel.y = 5.2; this.onGround = false; }
    this.vel.y -= 14 * dt;

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
    if (gNext < -1.1 && gNext < gNow) { this.blockedDeep = true; next.x = this.pos.x; next.z = this.pos.z; }
    const climb = (gNext - gNow) / Math.max(1e-3, Math.hypot(next.x - this.pos.x, next.z - this.pos.z));
    if (climb > 1.6 && gNext > gNow) { next.x = this.pos.x; next.z = this.pos.z; }
    this.pos.x = next.x; this.pos.z = next.z;
    this.pos.y += this.vel.y * dt;
    const ground = this.terrain.height(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -4) audio.human('land', 0.5);
      if (!this.onGround && this.vel.y < -3) this.dipV -= Math.min(1.6, -this.vel.y * 0.2); // landing weight
      this.pos.y = ground; this.vel.y = 0; this.onGround = true;
    }
    else if (this.pos.y - ground > 0.15) this.onGround = false;
    this.inWater = ground < -0.25;

    // animate model
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hs;
    if (hs > 0.3) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * (1 - Math.exp(-dt * 10));
    }
    this.walkPhase += dt * hs * 2.1;
    this.model.root.position.copy(this.pos);
    if (this.inWater) this.model.root.position.y = Math.max(this.pos.y, -0.55);
    this.model.root.rotation.y = this.facing + Math.PI;
    this.model.root.updateMatrixWorld();
    this.model.animate(this.pose, this.walkPhase, clamp(hs / 4, 0, 1.3), performance.now() / 1000, dt);

    this.updateCamera(dt);
  }

  /** Orbit position around `focus` at `dist`, kept above the ground. */
  private orbit(out: THREE.Vector3, focus: THREE.Vector3, yaw: number, pitch: number, dist: number) {
    const cp = Math.cos(pitch);
    out.set(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp).multiplyScalar(dist);
    out.add(focus);
    out.y += 1.65;
    // walk the line from the head to the camera: stop short of hills and trunks
    const hx = focus.x, hy = focus.y + 1.65, hz = focus.z;
    let free = 1;
    for (let k = 1; k <= 10; k++) {
      const f = k / 10, x = hx + (out.x - hx) * f, y = hy + (out.y - hy) * f, z = hz + (out.z - hz) * f;
      if (y < this.terrain.height(x, z) + 0.3 || this.forest.blocks(x, z, 0.28)) { free = Math.max(0.16, (k - 1) / 10); break; }
    }
    // pull in at once, ease back out, so the view never pops
    this.camClip = free < this.camClip ? free : this.camClip + (free - this.camClip) * 0.05;
    out.x = hx + (out.x - hx) * this.camClip; out.y = hy + (out.y - hy) * this.camClip; out.z = hz + (out.z - hz) * this.camClip;
    const g = Math.max(this.terrain.height(out.x, out.z) + 0.3, 0.45);
    if (out.y < g) out.y = g;
    return out;
  }

  snapCamera() {
    this.focus.copy(this.pos);
    this.yawS = this.yaw; this.pitchS = this.pitch; this.distS = this.camDist;
    this.fovKick = 0; this.bobK = 0; this.lean = 0; this.dip = 0; this.dipV = 0;
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

    // soft collision: pull in fast when a trunk blocks the view, ease back out slowly
    const want = this.orbit(tmpA, this.focus, this.yawS, this.pitchS, this.camDist);
    const clear = this.forest.clearance(this.focus.x, this.focus.z, want.x, want.z, 0.4);
    const target = Math.max(1.3, this.camDist * clear);
    this.distS += (target - this.distS) * e(target < this.distS ? 16 : 2.5);
    this.orbit(this.camPos, this.focus, this.yawS, this.pitchS, this.distS);

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
    // a touch of bank into fast turns
    this.lean += (clamp(dyaw * 1.4, -0.03, 0.03) - this.lean) * e(6);
    if (Math.abs(this.lean) > 1e-4) this.camera.rotateZ(this.lean);

    // FOV kick while sprinting
    this.fovKick += ((this.sprinting ? 6.5 : 0) - this.fovKick) * e(this.sprinting ? 3.5 : 6);
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /** Unit vector the player is facing (horizontal). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
  }
}
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
