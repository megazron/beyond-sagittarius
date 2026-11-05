import * as THREE from 'three';
import { createCharacter, Character, CrewPose } from '../characters/character';
import { clamp } from '../core/noise';
import type { Terrain } from '../world/terrain';
import type { Forest } from '../world/forest';
import type { Input } from './input';
import { HALF } from '../world/terrain';

/** Third-person survivor controller with an orbit camera that avoids terrain. */
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

  constructor(private terrain: Terrain, private forest: Forest, public camera: THREE.PerspectiveCamera, detail = 1) {
    this.model = createCharacter('scientist', detail);
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
    const k = 1 - Math.exp(-dt * 10);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    if (canMove && this.onGround && input.hit('Space')) { this.vel.y = 5.2; this.onGround = false; }
    this.vel.y -= 14 * dt;

    const next = this.pos.clone();
    next.x += this.vel.x * dt;
    next.z += this.vel.z * dt;
    this.forest.collide(next, 0.35);
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
    if (this.pos.y <= ground) { this.pos.y = ground; this.vel.y = 0; this.onGround = true; }
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

  private desiredCam(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    out.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.camDist);
    out.add(this.pos).add(new THREE.Vector3(0, 1.65, 0));
    const g = Math.max(this.terrain.height(out.x, out.z) + 0.5, 0.45);
    if (out.y < g) out.y = g;
    return out;
  }

  snapCamera() {
    this.desiredCam(this.camPos);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.pos.x, this.pos.y + 1.5, this.pos.z);
  }

  private updateCamera(dt: number) {
    const want = this.desiredCam(new THREE.Vector3());
    this.camPos.lerp(want, 1 - Math.exp(-dt * 14));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.pos.x, this.pos.y + 1.45, this.pos.z);
  }

  /** Unit vector the player is facing (horizontal). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
  }
}
