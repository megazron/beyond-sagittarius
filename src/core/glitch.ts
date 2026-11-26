import * as THREE from 'three';

/**
 * Test: physics glitches over time in whatever scene is drawn (tools/glitch_check.py, ?glitch=1 or __bs.glitch(true)).
 * Every character near the camera is followed frame to frame:
 *   pop     the body moves further in one frame than anyone can (a teleport in view), or snaps round
 *   snap    a limb (upper/lower arm or leg) turns further in one frame than a joint can
 *   floor   a foot under the ground (sinking or falling through)
 *   float   both feet well off the ground, standing, for longer than a jump
 *   jitter  the player's height flickering up and down while walking (stairs, kerbs, slopes)
 *   wall    the player inside a wall after the frame's own collision (the stage's collide still pushes them)
 * A cut (the camera jumping) excuses that frame's pops. Bodies through each other and through the set are the clip
 * probe's (core/clipprobe.ts), sampled by the runner.
 */
export type GlitchKind = 'pop' | 'snap' | 'floor' | 'float' | 'jitter' | 'wall';
export interface GlitchEvent { t: number; who: string; kind: GlitchKind; detail: string; at: [number, number, number] }

const LIMBS = ['upperarmL', 'upperarmR', 'lowerarmL', 'lowerarmR', 'upperlegL', 'upperlegR', 'lowerlegL', 'lowerlegR'];
const FEET = ['footL', 'footR'];
const NEAR = 24;

interface Track {
  pos: THREE.Vector3; yaw: number; bones: THREE.Bone[]; feet: THREE.Bone[]; quats: THREE.Quaternion[];
  floatT: number; seen: number; lastKind: Record<string, number>;
}

const P = new THREE.Vector3(), Q = new THREE.Vector3(), E = new THREE.Euler();

export class GlitchWatch {
  on = false;
  events: GlitchEvent[] = [];
  /** Frames looked at and bodies followed, for the runner's summary. */
  stats = { frames: 0, bodies: 0, maxBodies: 0 };
  private tracks = new WeakMap<THREE.Object3D, Track>();
  private cam = new THREE.Vector3();
  private camSet = false;
  private hist: { t: number; y: number }[] = [];
  private clock = 0;

  reset() { this.events = []; this.stats = { frames: 0, bodies: 0, maxBodies: 0 }; this.tracks = new WeakMap(); this.camSet = false; this.hist = []; }

  private add(who: string, kind: GlitchKind, detail: string, p: THREE.Vector3, tr?: Track) {
    // one event per body and kind in any half second: a body stuck in the floor is one glitch, not sixty
    if (tr) { const last = tr.lastKind[kind] ?? -9; if (this.clock - last < 0.5) return; tr.lastKind[kind] = this.clock; }
    if (this.events.length < 2000) this.events.push({ t: +this.clock.toFixed(2), who, kind, detail, at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
  }

  /**
   * One frame, after everything has moved. `ground` gives the walkable height under a point (null where it is not
   * known: a deck, a vehicle); `player` adds the player's own checks; `collide` is the stage's wall push.
   */
  frame(scene: THREE.Scene, camera: THREE.Camera, dt: number, opts: {
    ground?: (x: number, z: number) => number | null;
    player?: { root: THREE.Object3D; onGround: boolean; speed: number; pos: THREE.Vector3 } | null;
    collide?: (p: THREE.Vector3, r: number) => void;
    zeroG?: boolean;
  } = {}) {
    if (!this.on || dt <= 0) return;
    this.clock += dt;
    this.stats.frames++;
    const cam = camera.getWorldPosition(Q);
    const cut = this.camSet && cam.distanceTo(this.cam) > 1.5;
    this.cam.copy(cam); this.camSet = true;
    const k = Math.max(1, dt * 60);
    let n = 0;
    scene.traverse((o) => {
      if (!o.userData.isCharacter) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
      o.getWorldPosition(P);
      if (P.distanceTo(cam) > NEAR) { this.tracks.delete(o); return; }
      n++;
      const who = (o.userData.id as string | undefined) ?? o.name ?? 'body';
      let tr = this.tracks.get(o);
      E.setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
      if (!tr) {
        const bones: THREE.Bone[] = [], feet: THREE.Bone[] = [];
        o.traverse((b) => { if ((b as THREE.Bone).isBone) { if (LIMBS.includes(b.name)) bones.push(b as THREE.Bone); else if (FEET.includes(b.name)) feet.push(b as THREE.Bone); } });
        tr = { pos: P.clone(), yaw: E.y, bones, feet, quats: bones.map((b) => b.quaternion.clone()), floatT: 0, seen: this.clock, lastKind: {} };
        this.tracks.set(o, tr);
        return;
      }
      const d = Math.hypot(P.x - tr.pos.x, P.z - tr.pos.z), dy = Math.abs(P.y - tr.pos.y);
      const turn = Math.abs(Math.atan2(Math.sin(E.y - tr.yaw), Math.cos(E.y - tr.yaw)));
      if (!cut && this.clock - tr.seen > 0.2) {
        if (d > Math.max(0.45, 12 * dt) || dy > Math.max(0.5, 15 * dt)) this.add(who, 'pop', `${d.toFixed(2)} m across, ${dy.toFixed(2)} m up in one frame`, P, tr);
        else if (turn > 1.2 * k && !opts.zeroG) this.add(who, 'pop', `turned ${(turn * 57.3).toFixed(0)} degrees in one frame`, P, tr);
        tr.bones.forEach((b, i) => {
          const a = 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.dot(tr!.quats[i]))));
          if (a > 1.0 * k) this.add(who, 'snap', `${b.name} turned ${(a * 57.3).toFixed(0)} degrees in one frame`, P, tr);
        });
      }
      tr.bones.forEach((b, i) => tr!.quats[i].copy(b.quaternion));
      tr.pos.copy(P); tr.yaw = E.y;
      // the ground under the body, where it is known
      const g = opts.ground && !opts.zeroG ? opts.ground(P.x, P.z) : null;
      if (g !== null && g !== undefined && tr.feet.length) {
        let low = Infinity;
        for (const f of tr.feet) low = Math.min(low, f.getWorldPosition(new THREE.Vector3()).y);
        if (low < g - 0.14 && P.y < g - 0.06) this.add(who, 'floor', `feet ${(g - low).toFixed(2)} m under the ground`, P, tr);
        const isPlayer = opts.player?.root === o;
        if (low > g + 0.28 && P.y > g + 0.25) tr.floatT += dt; else tr.floatT = 0;
        if (tr.floatT > (isPlayer ? 1.4 : 0.45)) { this.add(who, 'float', `feet ${(low - g).toFixed(2)} m off the ground for ${tr.floatT.toFixed(1)} s`, P, tr); tr.floatT = 0; }
      }
    });
    this.stats.bodies += n; this.stats.maxBodies = Math.max(this.stats.maxBodies, n);
    const pl = opts.player;
    if (pl) {
      // the player's height flickering while walking: up, down, up, down within half a second
      if (pl.onGround && pl.speed > 0.5) this.hist.push({ t: this.clock, y: pl.pos.y }); else this.hist = [];
      while (this.hist.length && this.clock - this.hist[0].t > 0.6) this.hist.shift();
      let flips = 0, sign = 0;
      for (let i = 1; i < this.hist.length; i++) {
        const v = this.hist[i].y - this.hist[i - 1].y;
        if (Math.abs(v) < 0.012) continue;
        const s = Math.sign(v); if (sign && s !== sign) flips++; sign = s;
      }
      if (flips >= 4) { this.add('player', 'jitter', `height flipped ${flips} times in 0.6 s while walking`, pl.pos); this.hist = []; }
      if (opts.collide) {
        const q = pl.pos.clone(); opts.collide(q, 0.3);
        const push = Math.hypot(q.x - pl.pos.x, q.z - pl.pos.z);
        if (push > 0.06) this.add('player', 'wall', `${push.toFixed(2)} m inside a wall after the frame`, pl.pos);
      }
    }
  }

  /** Counts by kind and the first few of each. */
  summary() {
    const by: Record<string, number> = {};
    for (const e of this.events) by[e.kind] = (by[e.kind] ?? 0) + 1;
    return { by, frames: this.stats.frames, meanBodies: this.stats.frames ? +(this.stats.bodies / this.stats.frames).toFixed(1) : 0, maxBodies: this.stats.maxBodies };
  }
}

export const glitch = new GlitchWatch();
