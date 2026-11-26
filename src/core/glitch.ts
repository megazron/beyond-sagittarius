import * as THREE from 'three';

/**
 * Test: physics glitches over time in whatever scene is drawn (tools/glitch_check.py, ?glitch=1 or __bs.glitch(true)).
 * Every character near the camera is followed frame to frame:
 *   pop     the body moves further in one frame than anyone can (a teleport in view), or snaps round
 *   snap    a limb (upper/lower arm or leg) turns further in one frame than a joint can
 *   floor   a foot under the ground (sinking or falling through)
 *   float   both feet well off the ground, standing, for longer than a jump
 *   jitter  the player's height flickering up and down while walking (kerbs, slopes, steps)
 *   wall    the player inside a wall after the frame's own collision (the stage's collide still pushes them)
 * A cut (the camera jumping) excuses that frame's pops. A body not drawn in the frame before (hidden, out of range,
 * just given to a walker by a pool) starts a new track: it is compared with where it was drawn last, never with where
 * it was before it was hidden. Bodies through each other are the clip probe's (core/clipprobe.ts), sampled by the runner.
 *
 * The watch reads the bodies at the end of the frame, after every update that places them (the city's pools set each
 * walker's root every frame), so a test poke made between frames is undone before it is read. `inject()` puts a test
 * glitch in at the read itself: the body or the limb is moved just before the watch reads it and put back just after,
 * and the events it causes are marked as the test's (`test`), so the runner can prove each kind is caught there.
 */
export type GlitchKind = 'pop' | 'snap' | 'floor' | 'float' | 'jitter' | 'wall';
export interface GlitchEvent { t: number; who: string; kind: GlitchKind; detail: string; at: [number, number, number]; test?: number; /** the film's own time, in a film */ film?: number }
/** One test glitch: what, on whom, whether the watch caught it, and why not when it could not be put in. */
export interface GlitchTest { id: number; kind: GlitchKind; on: 'npc' | 'player'; who: string; t: number; state: 'waiting' | 'on' | 'caught' | 'missed' | 'n/a'; why?: string }

const LIMBS = ['upperarmL', 'upperarmR', 'lowerarmL', 'lowerarmR', 'upperlegL', 'upperlegR', 'lowerlegL', 'lowerlegR'];
const FEET = ['footL', 'footR'];
const NEAR = 24;

interface Track {
  pos: THREE.Vector3; yaw: number; bones: THREE.Bone[]; feet: THREE.Bone[]; quats: THREE.Quaternion[];
  floatT: number; seen: number; frame: number; lastKind: Record<string, number>;
}
interface Live extends GlitchTest { target?: THREE.Object3D; frames: number; left: number; grace: number; wait: number; undo?: () => void; flip: number }

const P = new THREE.Vector3(), Q = new THREE.Vector3(), E = new THREE.Euler(), W = new THREE.Vector3(), WQ = new THREE.Quaternion();

/** How long each test glitch is held (frames at 30 fps, on a body / on the player): past the kind's own threshold. */
const HOLD: Record<GlitchKind, [number, number]> = { pop: [1, 1], snap: [1, 1], floor: [1, 1], float: [24, 60], jitter: [18, 18], wall: [1, 1] };

interface FrameOpts {
  ground?: (x: number, z: number) => number | null;
  player?: { root: THREE.Object3D; onGround: boolean; speed: number; pos: THREE.Vector3; swimming?: boolean; doing?: () => string } | null;
  collide?: (p: THREE.Vector3, r: number) => void;
  zeroG?: boolean;
  /** The body played, even when it is not in the player's hands (a scene): never a test's "other body". */
  self?: THREE.Object3D | null;
  /** The film's clock, logged with each event in a film. */
  film?: number;
}

export class GlitchWatch {
  on = false;
  events: GlitchEvent[] = [];
  tests: GlitchTest[] = [];
  /** Frames looked at and bodies followed, for the runner's summary. */
  stats = { frames: 0, bodies: 0, maxBodies: 0, groundKnown: 0, playerFrames: 0, collideFrames: 0 };
  private tracks = new WeakMap<THREE.Object3D, Track>();
  private cam = new THREE.Vector3();
  private camSet = false;
  private hist: { t: number; y: number }[] = [];
  private clock = 0;
  private nFrame = 0;
  private live: Live[] = [];
  private nextId = 1;
  private film: number | undefined;
  private camMove = 0;

  reset() {
    this.events = []; this.tests = []; this.live = [];
    this.stats = { frames: 0, bodies: 0, maxBodies: 0, groundKnown: 0, playerFrames: 0, collideFrames: 0 };
    this.tracks = new WeakMap(); this.camSet = false; this.hist = [];
  }

  /** A test glitch of this kind, put in at the next frame's read (on the nearest other body, or on the player). */
  inject(kind: GlitchKind, on: 'npc' | 'player' = kind === 'jitter' || kind === 'wall' ? 'player' : 'npc') {
    const [fn, fp] = HOLD[kind];
    const t: Live = { id: this.nextId++, kind, on, who: '', t: +this.clock.toFixed(2), state: 'waiting', frames: on === 'player' ? fp : fn, left: 0, grace: 0, wait: 300, flip: 0 };
    this.live.push(t); this.tests.push(t);
    return t.id;
  }

  private add(who: string, kind: GlitchKind, detail: string, p: THREE.Vector3, tr?: Track, o?: THREE.Object3D) {
    // a test glitch's events are the test's: marked (and the test caught), never counted as the game's
    let test: number | undefined;
    for (const l of this.live) if (test === undefined && l.kind === kind && l.target && l.target === o && (l.state === 'on' || l.state === 'caught')) { test = l.id; l.state = 'caught'; }
    // what else a test glitch sets off on its body while it is in and just after (a lifted body dropping back is a pop)
    for (const l of this.live) if (test === undefined && l.target && l.target === o && l.state !== 'waiting') test = l.id;
    // one event per body and kind in any half second: a body stuck in the floor is one glitch, not sixty
    if (tr && test === undefined) { const last = tr.lastKind[kind] ?? -9; if (this.clock - last < 0.5) return; tr.lastKind[kind] = this.clock; }
    if (this.events.length < 2000) this.events.push({ t: +this.clock.toFixed(2), who, kind, detail, at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], ...(test !== undefined ? { test } : {}), ...(this.film !== undefined ? { film: +this.film.toFixed(2) } : {}) });
  }

  /** Moves a body by a world offset (in its parent's frame), returning how to put it back. */
  private shift(o: THREE.Object3D, dx: number, dy: number, dz: number) {
    const was = o.position.clone();
    o.getWorldPosition(W).add(Q.set(dx, dy, dz));
    if (o.parent) { o.parent.updateWorldMatrix(true, false); o.parent.worldToLocal(W); }
    o.position.copy(W); o.updateMatrixWorld(true);
    return () => { o.position.copy(was); o.updateMatrixWorld(true); };
  }

  /** The test glitches due this frame, put in just before the read. */
  private applyTests(scene: THREE.Scene, cam: THREE.Vector3, opts: FrameOpts, cut: boolean) {
    const pl = opts.player;
    // one test at a time: two on one body in a frame would undo each other wrongly
    let busy = this.live.find((l) => l.state === 'on' || (l.state === 'caught' && (l.left > 0 || l.grace < 12)));
    for (const l of this.live) {
      if (busy && l !== busy) continue;
      // a cut excuses pops by design: a test held over one is put in again after it
      if (cut && l.state === 'on') { l.state = 'waiting'; l.target = undefined; }
      // its body no longer followed (out of range of the camera, hidden): put in again when there is one
      if (l.state === 'on' && l.target && l.kind !== 'jitter' && l.kind !== 'wall' && this.tracks.get(l.target)?.frame !== this.nFrame - 1) { l.state = 'waiting'; l.target = undefined; }
      if (l.state === 'waiting' && cut) continue;
      if (l.state === 'waiting') {
        if (l.wait-- <= 0) { l.state = 'n/a'; l.why ??= 'no body to put it on'; continue; }
        let target: THREE.Object3D | null = null;
        if (l.on === 'player') {
          if (!pl) { l.why = 'no player here'; continue; }
          target = pl.root;
          if (l.kind === 'jitter' && !(pl.onGround && pl.speed > 0.5 && !pl.swimming)) { l.why = 'the player was not walking'; continue; }
          if (l.kind === 'wall' && !opts.collide) { l.state = 'n/a'; l.why = 'no walls known here'; continue; }
          if ((l.kind === 'floor' || l.kind === 'float') && (!opts.ground || opts.zeroG || opts.ground(pl.pos.x, pl.pos.z) === null || !pl.onGround || pl.swimming)) { l.why = 'the player was not on known ground'; continue; }
          const pt = this.tracks.get(pl.root);
          if (l.kind !== 'jitter' && l.kind !== 'wall' && (!pt || pt.frame !== this.nFrame - 1 || this.clock - pt.seen < 0.3)) { l.why = 'the player was not followed (out of range of the camera)'; continue; }
        } else {
          let bd = 16;
          scene.traverse((o) => {
            if (!o.userData.isCharacter || o === pl?.root || o === opts.self) return;
            for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
            const tr = this.tracks.get(o); if (!tr || tr.frame !== this.nFrame - 1 || this.clock - tr.seen < 0.3) return; // followed already
            o.getWorldPosition(P); const d = P.distanceTo(cam); if (d >= bd) return;
            if (l.kind === 'snap' && !tr.bones.length) return;
            if (l.kind === 'floor' || l.kind === 'float') {
              const g = opts.ground && !opts.zeroG ? opts.ground(P.x, P.z) : null;
              if (g === null || g === undefined || !tr.feet.length || Math.abs(P.y - g) > 0.12) return;
            }
            bd = d; target = o;
          });
          if (!target) { l.why = l.kind === 'floor' || l.kind === 'float' ? 'no body standing on known ground within 16 m' : 'no body within 16 m'; continue; }
        }
        const tg = target as THREE.Object3D;
        l.target = tg; l.who = l.on === 'player' ? 'player' : tg.userData.id === 'player' ? `townsperson ${tg.name || tg.id}` : ((tg.userData.id as string | undefined) ?? tg.name ?? 'body');
        l.state = 'on'; l.left = l.frames; l.why = undefined; l.t = +this.clock.toFixed(2);
        busy = l;
      }
      if ((l.state !== 'on' && l.state !== 'caught') || l.left <= 0) continue;
      l.left--;
      const o = l.target!;
      if (l.kind === 'pop') l.undo = this.shift(o, 1, 0, 0);
      else if (l.kind === 'floor') l.undo = this.shift(o, 0, -0.5, 0);
      else if (l.kind === 'float') l.undo = this.shift(o, 0, 0.6, 0);
      else if (l.kind === 'snap') {
        const b = this.tracks.get(o)?.bones[0]; if (!b) { l.state = 'n/a'; l.why = 'no limbs'; continue; }
        const was = b.quaternion.clone(); b.quaternion.multiply(WQ.setFromAxisAngle(Q.set(1, 0, 0), 2.8));
        l.undo = () => { b.quaternion.copy(was); };
      } else if (l.kind === 'jitter' && pl) {
        const was = pl.pos.y; pl.pos.y += (l.flip++ % 2 ? -0.05 : 0.05); l.undo = () => { pl.pos.y = was; };
      } else if (l.kind === 'wall' && pl && opts.collide) {
        // the nearest point round the player that a wall pushes out of
        const at = pl.pos.clone(); let found: THREE.Vector3 | null = null;
        for (let r = 0.4; r <= 8 && !found; r += 0.2) for (let a = 0; a < 32 && !found; a++) {
          const c = new THREE.Vector3(at.x + Math.cos(a * Math.PI / 16) * r, at.y, at.z + Math.sin(a * Math.PI / 16) * r), q = c.clone();
          opts.collide(q, 0.3); if (Math.hypot(q.x - c.x, q.z - c.z) > 0.15) found = c;
        }
        if (!found) { l.state = 'n/a'; l.why = 'no wall within 8 m'; continue; }
        pl.pos.copy(found); l.undo = () => { pl.pos.copy(at); };
      }
    }
  }

  private endTests() {
    for (const l of this.live) { l.undo?.(); l.undo = undefined; }
    for (const l of this.live) if ((l.state === 'on' || l.state === 'caught') && l.left <= 0) l.grace++;
    // a few frames after it is taken out for it to show (the pop back, a float past its threshold)
    for (const l of this.live) if (l.state === 'on' && l.left <= 0 && l.grace > 8) l.state = 'missed';
    this.live = this.live.filter((l) => l.state === 'waiting' || l.state === 'on' || (l.state === 'caught' && (l.left > 0 || l.grace < 12)));
  }

  /**
   * One frame, after everything has moved. `ground` gives the walkable height under a point (null where it is not
   * known: a deck, a vehicle); `player` adds the player's own checks; `collide` is the stage's wall push.
   */
  frame(scene: THREE.Scene, camera: THREE.Camera, dt: number, opts: FrameOpts = {}) {
    if (!this.on || dt <= 0) return;
    this.clock += dt; this.film = opts.film;
    this.stats.frames++; this.nFrame++;
    const cam = camera.getWorldPosition(new THREE.Vector3());
    this.camMove = this.camSet ? cam.distanceTo(this.cam) : 0;
    const cut = this.camSet && this.camMove > 1.5;
    this.cam.copy(cam); this.camSet = true;
    if (this.live.length) this.applyTests(scene, cam, opts, cut);
    const k = Math.max(1, dt * 60);
    let n = 0;
    scene.traverse((o) => {
      if (!o.userData.isCharacter) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
      o.getWorldPosition(P);
      if (P.distanceTo(cam) > NEAR) { this.tracks.delete(o); return; }
      n++;
      const id0 = o.userData.id as string | undefined, who = o === opts.self || o === opts.player?.root ? 'player' : id0 === 'player' ? `townsperson ${o.name || o.id}` : id0 ?? o.name ?? 'body';
      let tr = this.tracks.get(o);
      E.setFromQuaternion(o.getWorldQuaternion(WQ), 'YXZ');
      // not drawn last frame (hidden, out of range, a pooled body given to someone else): a new track
      if (tr && tr.frame !== this.nFrame - 1) tr = undefined;
      if (!tr) {
        const bones: THREE.Bone[] = [], feet: THREE.Bone[] = [];
        o.traverse((b) => { if ((b as THREE.Bone).isBone) { if (LIMBS.includes(b.name)) bones.push(b as THREE.Bone); else if (FEET.includes(b.name)) feet.push(b as THREE.Bone); } });
        tr = { pos: P.clone(), yaw: E.y, bones, feet, quats: bones.map((b) => b.quaternion.clone()), floatT: 0, seen: this.clock, frame: this.nFrame, lastKind: {} };
        this.tracks.set(o, tr);
        return;
      }
      tr.frame = this.nFrame;
      const d = Math.hypot(P.x - tr.pos.x, P.z - tr.pos.z), dy = Math.abs(P.y - tr.pos.y);
      const turn = Math.abs(Math.atan2(Math.sin(E.y - tr.yaw), Math.cos(E.y - tr.yaw)));
      // the body in the player's hands, in play: the follow camera jumps with a teleport, so a cut excuses nothing there
      const played = !!opts.player && opts.player.root === o;
      if (played && cut && this.clock - tr.seen > 0.2 && (d > Math.max(0.45, 12 * dt) || dy > Math.max(0.5, 15 * dt))) this.add(who, 'pop', `${d.toFixed(2)} m across, ${dy.toFixed(2)} m up in one frame, the camera with him`, P, tr, o);
      if (!cut && this.clock - tr.seen > 0.2) {
        if (d > Math.max(0.45, 12 * dt) || dy > Math.max(0.5, 15 * dt)) this.add(who, 'pop', `${d.toFixed(2)} m across, ${dy.toFixed(2)} m up in one frame`, P, tr, o);
        else if (turn > 1.2 * k && !opts.zeroG) this.add(who, 'pop', `turned ${(turn * 57.3).toFixed(0)} degrees in one frame`, P, tr, o);
        tr.bones.forEach((b, i) => {
          const a = 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.dot(tr!.quats[i]))));
          if (a > 1.0 * k) this.add(who, 'snap', `${b.name} turned ${(a * 57.3).toFixed(0)} degrees in one frame (the camera moved ${this.camMove.toFixed(2)} m${opts.player?.root === o && opts.player.doing ? `; doing ${opts.player.doing()}` : ''})`, P, tr, o);
        });
      }
      tr.bones.forEach((b, i) => tr!.quats[i].copy(b.quaternion));
      tr.pos.copy(P); tr.yaw = E.y;
      // the ground under the body, where it is known
      const isPlayer = opts.player?.root === o;
      const g = opts.ground && !opts.zeroG ? opts.ground(P.x, P.z) : null;
      if (g !== null && g !== undefined && tr.feet.length) {
        this.stats.groundKnown++;
        let low = Infinity;
        for (const f of tr.feet) low = Math.min(low, f.getWorldPosition(W).y);
        if (low < g - 0.14 && P.y < g - 0.06) this.add(who, 'floor', `feet ${(g - low).toFixed(2)} m under the ground`, P, tr, o);
        // a swimmer is off the ground by design
        const swim = isPlayer && opts.player?.swimming;
        if (!swim && low > g + 0.28 && P.y > g + 0.25) tr.floatT += dt; else tr.floatT = 0;
        if (tr.floatT > (isPlayer ? 1.4 : 0.45)) { this.add(who, 'float', `feet ${(low - g).toFixed(2)} m off the ground for ${tr.floatT.toFixed(1)} s`, P, tr, o); tr.floatT = 0; }
      }
    });
    this.stats.bodies += n; this.stats.maxBodies = Math.max(this.stats.maxBodies, n);
    const pl = opts.player;
    if (pl) {
      this.stats.playerFrames++;
      // the player's height flickering while walking: up, down, up, down within half a second
      if (pl.onGround && pl.speed > 0.5 && !pl.swimming) this.hist.push({ t: this.clock, y: pl.pos.y }); else this.hist = [];
      while (this.hist.length && this.clock - this.hist[0].t > 0.6) this.hist.shift();
      let flips = 0, sign = 0;
      for (let i = 1; i < this.hist.length; i++) {
        const v = this.hist[i].y - this.hist[i - 1].y;
        if (Math.abs(v) < 0.012) continue;
        const s = Math.sign(v); if (sign && s !== sign) flips++; sign = s;
      }
      if (flips >= 4) { this.add('player', 'jitter', `height flipped ${flips} times in 0.6 s while walking`, pl.pos, undefined, pl.root); this.hist = []; }
      if (opts.collide) {
        this.stats.collideFrames++;
        const q = pl.pos.clone(); opts.collide(q, 0.3);
        const push = Math.hypot(q.x - pl.pos.x, q.z - pl.pos.z);
        if (push > 0.06) this.add('player', 'wall', `${push.toFixed(2)} m inside a wall after the frame`, pl.pos, undefined, pl.root);
      }
    }
    if (this.live.length) this.endTests();
  }

  /** Counts by kind (the tests' own events left out), the tests, and how much of the frame the watch could see. */
  summary() {
    const by: Record<string, number> = {};
    for (const e of this.events) if (e.test === undefined) by[e.kind] = (by[e.kind] ?? 0) + 1;
    return {
      by, tests: this.tests.map((x) => ({ id: x.id, kind: x.kind, on: x.on, who: x.who, t: x.t, state: x.state, why: x.why })),
      frames: this.stats.frames, meanBodies: this.stats.frames ? +(this.stats.bodies / this.stats.frames).toFixed(1) : 0, maxBodies: this.stats.maxBodies,
      groundShare: this.stats.bodies ? +(this.stats.groundKnown / this.stats.bodies).toFixed(2) : 0, playerFrames: this.stats.playerFrames, collideFrames: this.stats.collideFrames,
    };
  }
}

export const glitch = new GlitchWatch();
