import * as THREE from 'three';
import type { Character } from '../characters/character';

/**
 * Continuity log for the opening films (tools/continuity_check.py, ?contlog=1 on a GPU capture). Every frame while it is
 * on, the set, its furniture and the six are measured; at each cut the last frame of the old shot ("out") and the first
 * frame of the new one ("in") are kept. `check()` lists the breaks an audience would see:
 *  - the set's furniture appearing or vanishing between two shots of the same room;
 *  - someone sitting at one cut and standing at the next (or the other way) without being seen to get up;
 *  - someone in another place than they could have walked to while off screen (1.4 m a second);
 *  - pops inside a shot: a body jumping more than 0.3 m, turning more than 60 degrees or changing posture in one frame;
 *  - a change of place with no travel shown: someone in the lounge at one cut and in the passage (or the pod bay) at the
 *    next who was never seen to go through the hatch between the two;
 *  - the ship's state going backwards: gravity back on, the lights back, the hull mended, loose things back at rest, the
 *    hatch shut again, the air back; and someone standing on the floor while gravity is off;
 *  - the camera crossing the line: most pairs of people swapping sides of the frame over a cut, or most of those moving
 *    changing their direction across the screen over a cut;
 *  - the sound bed: an alarm, the room's drone, the airless muffle or the score switching on or off on a cut (a hard
 *    cut in the sound), dead air with no bed at all, and the alarm lamps flashing with no alarm heard while there is air.
 */
export type Posture = 'stand' | 'sit' | 'low' | 'air';
export interface CrewMark { id: string; x: number; y: number; z: number; yaw: number; hip: number; posture: Posture; visible: boolean;
  /** Where the head is across the frame (-1 left edge .. 1 right edge), and how fast the body moves across it (m/s, + to the right). */
  sx: number; vs: number }
/**
 * The ship's state and the sound bed on a frame. Inside the event (the pull to the white) each of these only goes one
 * way: gravity 1 -> 0, power (how much of the room's light is left) down, damage up (0 whole, 1 strained, 2 a seam
 * open, 3 torn open, 4 broken apart), loose (things let go of the floor) up, door (the hatch aft) up, air 1 -> 0.
 */
export interface StageState { gravity: number; power: number; damage: number; loose: number; door: number; air: number; alarm: number; drone: number; score: number; muffle: number; lamp: number }
/** The parts of the route aft, by where a body is along the deck (cinematic/passage.ts gives the hatch and the bay's mouth). */
export let PLACES: { name: string; from: number }[] = [{ name: 'lounge', from: -Infinity }];
export function setPlaces(p: { name: string; from: number }[]) { PLACES = p; }
export function placeOf(x: number) { let n = PLACES[0].name; for (const p of PLACES) if (x >= p.from) n = p.name; return n; }
export interface CutMark { at: 'in' | 'out'; shot: string; scene: string; set: string; clock: number; furniture: boolean; crew: CrewMark[]; state?: StageState }
export interface Break { kind: 'furniture' | 'posture' | 'jump' | 'pop' | 'clip' | 'place' | 'reset' | 'gravity' | 'axis' | 'direction' | 'audio'; shot: string; from: string; id?: string; clock: number; detail: string }

const P = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler();

export function posture(c: Character, floor: number): { hip: number; posture: Posture; y: number } {
  c.root.getWorldPosition(P); const y = P.y - floor;
  c.body.getWorldPosition(P);
  const hip = (P.y - floor) / c.height;
  return { hip, y, posture: y > 0.15 ? 'air' : hip > 0.4 ? 'stand' : hip > 0.18 ? 'sit' : 'low' };
}

const C = new THREE.Vector3(), R = new THREE.Vector3();
/** In the picture: shown, and the head or the chest inside the frame in front of the lens. */
function inFrame(c: Character, cam?: THREE.Camera) {
  if (!isShown(c.root)) return false;
  if (!cam) return true;
  for (const part of [c.head, c.chest]) { part.getWorldPosition(C).project(cam); if (C.z < 1 && Math.abs(C.x) < 1.05 && Math.abs(C.y) < 1.05) return true; }
  return false;
}
function mark(c: Character, floor: number, cam?: THREE.Camera): CrewMark {
  const p = posture(c, floor);
  c.root.getWorldPosition(P); c.root.getWorldQuaternion(Q); E.setFromQuaternion(Q, 'YXZ');
  let sx = 0; if (cam) { c.head.getWorldPosition(C).project(cam); sx = +C.x.toFixed(3); }
  return { id: c.id, x: +P.x.toFixed(3), y: +p.y.toFixed(3), z: +P.z.toFixed(3), yaw: +E.y.toFixed(3), hip: +p.hip.toFixed(3), posture: p.posture, visible: inFrame(c, cam), sx, vs: 0 };
}
/** Visible all the way up the tree (a hidden group hides everyone in it). */
function isShown(o: THREE.Object3D | null) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export class ContinuityLog {
  on = false;
  cuts: CutMark[] = [];
  /** Posture changes seen on screen inside a shot (they are acted, so the next cut may differ). */
  seen: { shot: string; id: string; from: Posture; to: Posture; clock: number }[] = [];
  pops: Break[] = [];
  /** Someone seen to pass from one place to the next inside a shot (through the hatch, into the bay). */
  travel: { shot: string; id: string; from: string; to: string; clock: number }[] = [];
  private prev: CutMark | null = null;
  /** The furthest each one-way state has got in this scene, and what was already reported. */
  private far: Partial<StageState> = {}; private farScene = ''; private told = new Set<string>();
  private bedAt: Partial<Record<keyof StageState, number>> = {}; private lastCut = -9; private quiet = 0; private lampOnly = 0;
  private inPending: CutMark | null = null;
  /** Scenes whose state only goes one way (one continuous time). */
  oneWay = new Set(['pull']);
  /** Footprints on the deck floor (furniture, the console): a standing body whose feet are inside one is clipping. */
  footprints: { name: string; x: number; z: number; yaw: number; w: number; d: number; furniture: boolean }[] = [];
  private clipped = new Set<string>();

  reset() { this.cuts = []; this.seen = []; this.pops = []; this.travel = []; this.prev = null; this.clipped.clear(); this.far = {}; this.farScene = ''; this.told.clear(); this.bedAt = {}; this.lastCut = -9; this.quiet = 0; this.lampOnly = 0; this.inPending = null; }

  /** Which footprint (if any) a body standing at x, z is inside, with its radius r. */
  inside(x: number, z: number, r = 0.12, furniture = true) {
    for (const f of this.footprints) {
      if (f.furniture && !furniture) continue;
      const dx = x - f.x, dz = z - f.z, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
      const u = dx * c - dz * s, v = dx * s + dz * c; // into the footprint's own frame (three's turn about y)
      if (Math.abs(u) < f.w / 2 + r && Math.abs(v) < f.d / 2 + r) return f.name;
    }
    return null;
  }

  /** Call once a frame after the bodies are posed. */
  frame(shot: string, scene: string, set: string, clock: number, furniture: boolean, crew: Character[], floor: number, cam?: THREE.Camera, state?: StageState) {
    if (!this.on) return;
    const now: CutMark = { at: 'in', shot, scene, set, clock: +clock.toFixed(3), furniture, crew: crew.map((c) => mark(c, floor, cam)), state: state ? { ...state } : undefined };
    const p = this.prev;
    const sameShot = !!p && p.shot === shot && p.scene === scene;
    // how fast each one crosses the frame: from the frame before in the same shot (a shot's first frame gets its second's)
    if (sameShot && cam && set === 'deck') {
      const dt = Math.max(1e-3, now.clock - p!.clock); cam.updateMatrixWorld(); R.setFromMatrixColumn(cam.matrixWorld, 0);
      for (const c of now.crew) { const o = p!.crew.find((x) => x.id === c.id); if (o) c.vs = +(((c.x - o.x) * R.x + (c.y - o.y) * R.y + (c.z - o.z) * R.z) / dt).toFixed(3); }
      if (this.inPending && this.inPending.shot === shot) { for (const c of now.crew) { const m = this.inPending.crew.find((x) => x.id === c.id); if (m) m.vs = c.vs; } this.inPending = null; }
    }
    if (state) this.states(now, state, sameShot);
    if (set === 'deck') for (const c of now.crew) {
      if (!c.visible || c.posture === 'air' || c.posture === 'sit') continue;
      const k = `${shot}|${c.id}`, f = this.inside(c.x, c.z, 0.12, furniture);
      if (f && !this.clipped.has(k)) { this.clipped.add(k); this.pops.push({ kind: 'clip', shot, from: shot, id: c.id, clock: now.clock, detail: `standing inside the ${f}` }); }
    }
    if (!p || p.shot !== shot || p.scene !== scene) {
      if (p) this.cuts.push({ ...p, at: 'out' });
      this.cuts.push(now); this.inPending = now; this.lastCut = now.clock;
    } else if (set === 'deck') {
      for (const c of now.crew) {
        const o = p.crew.find((x) => x.id === c.id);
        if (!o || !c.visible || !o.visible) continue;
        const pa = placeOf(o.x), pb = placeOf(c.x);
        if (pa !== pb) this.travel.push({ shot, id: c.id, from: pa, to: pb, clock: now.clock });
        const d = Math.hypot(c.x - o.x, c.z - o.z), turn = Math.abs(Math.atan2(Math.sin(c.yaw - o.yaw), Math.cos(c.yaw - o.yaw)));
        if (d > 0.3) this.pops.push({ kind: 'pop', shot, from: shot, id: c.id, clock: now.clock, detail: `moved ${d.toFixed(2)} m in one frame` });
        if (turn > 1.05) this.pops.push({ kind: 'pop', shot, from: shot, id: c.id, clock: now.clock, detail: `turned ${(turn * 57.3).toFixed(0)} degrees in one frame` });
        if (c.posture !== o.posture) {
          // a sit to stand acted over frames is fine; one that happens between two frames is a pop
          if (Math.abs(c.hip - o.hip) > 0.12 && !(c.posture === 'air' || o.posture === 'air')) this.pops.push({ kind: 'pop', shot, from: shot, id: c.id, clock: now.clock, detail: `${o.posture} to ${c.posture} in one frame` });
          this.seen.push({ shot, id: c.id, from: o.posture, to: c.posture, clock: now.clock });
        }
      }
    }
    this.prev = now;
  }

  /** The one-way state and the sound bed, frame by frame. */
  private states(now: CutMark, s: StageState, sameShot: boolean) {
    const shot = now.shot, clock = now.clock, say = (kind: Break['kind'], key: string, detail: string, id?: string) => { const k = `${kind}|${key}|${shot}`; if (this.told.has(k)) return; this.told.add(k); this.pops.push({ kind, shot, from: this.prev?.shot ?? shot, id, clock, detail }); };
    if (now.scene !== this.farScene) { this.farScene = now.scene; this.far = {}; this.bedAt = {}; this.quiet = 0; this.lampOnly = 0; }
    const dt = this.prev && sameShot ? Math.max(0, clock - this.prev.clock) : 0;
    if (this.oneWay.has(now.scene)) {
      const DOWN: (keyof StageState)[] = ['gravity', 'power', 'air'], UP: (keyof StageState)[] = ['damage', 'loose', 'door'];
      const WORD: Record<string, string> = { gravity: 'gravity is back on', power: 'the lights are back', air: 'the air is back', damage: 'the hull is mended', loose: 'the loose things are back at rest', door: 'the hatch is shut again' };
      for (const k of DOWN) { const f = this.far[k] ?? s[k]; if (s[k] > f + 0.15) say('reset', k, `${WORD[k]} (${f.toFixed(2)} before, ${s[k].toFixed(2)} now)`); this.far[k] = Math.min(f, s[k]); }
      for (const k of UP) { const f = this.far[k] ?? s[k]; if (s[k] < f - 0.15) say('reset', k, `${WORD[k]} (${f.toFixed(2)} before, ${s[k].toFixed(2)} now)`); this.far[k] = Math.max(f, s[k]); }
      if (s.gravity < 0.5 && now.set === 'deck') for (const c of now.crew) if (c.visible && c.posture !== 'air' && c.y < 0.05) say('gravity', c.id, `${c.posture === 'stand' ? 'standing' : 'resting'} on the floor with gravity off`, c.id);
      // the sound bed: a bed switched on a cut, dead air, lamps with no alarm
      for (const k of ['alarm', 'drone', 'score', 'muffle'] as const) {
        const was = this.prev?.state?.[k];
        const takeover = s.score > 0 && !(this.prev?.state?.score); // the score comes in on this cut and takes the bed over
        if (was !== undefined && was !== s[k] && Math.abs(clock - this.lastCut) < 0.12 && !takeover) say('audio', k, `the ${k === 'muffle' ? 'airless muffle' : k} goes ${s[k] ? 'on' : 'off'} on the cut`);
      }
      const bed = s.alarm || s.drone || s.score || s.muffle;
      this.quiet = bed ? 0 : this.quiet + dt; if (this.quiet > 0.5) say('audio', 'quiet', 'no bed at all for half a second: dead air');
      this.lampOnly = s.lamp > 0.5 && !s.alarm && s.air > 0.5 ? this.lampOnly + dt : 0; if (this.lampOnly > 2.5) say('audio', 'lamp', 'the alarm lamps flash for 2.5 s with no alarm heard');
    }
  }

  /** The breaks, in order. */
  check(): Break[] {
    const out: Break[] = [];
    // the last time each one was seen in the room: their state as the shot that showed them ended
    const last = new Map<string, { m: CrewMark; shot: string; scene: string; clock: number }>();
    let lastDeck: CutMark | null = null;
    let inShot: CutMark | null = null;
    const ends = this.cuts;
    for (let i = 0; i < ends.length; i++) {
      const c = ends[i];
      if (c.at === 'in') {
        inShot = c;
        if (c.set !== 'deck') continue;
        // the line: over a cut inside one room at one time, do most pairs swap sides, do most movers turn round?
        const o = i > 0 && ends[i - 1].at === 'out' && ends[i - 1].set === 'deck' && ends[i - 1].scene === c.scene ? ends[i - 1] : null;
        if (o) {
          const both = c.crew.filter((m) => m.visible && Math.abs(m.sx) < 1).map((m) => [o.crew.find((x) => x.id === m.id && x.visible && Math.abs(x.sx) < 1), m] as const).filter((x): x is readonly [CrewMark, CrewMark] => !!x[0]);
          let kept = 0, flipped = 0;
          for (let a = 0; a < both.length; a++) for (let b = a + 1; b < both.length; b++) { const d0 = both[a][0].sx - both[b][0].sx, d1 = both[a][1].sx - both[b][1].sx; if (Math.abs(d0) < 0.12 || Math.abs(d1) < 0.12) continue; if (d0 * d1 < 0) flipped++; else kept++; }
          if (flipped > kept && flipped >= 2) out.push({ kind: 'axis', shot: c.shot, from: o.shot, clock: c.clock, detail: `${flipped} of ${flipped + kept} pairs swap sides of the frame over the cut: the camera crossed the line` });
          let same = 0, turned = 0;
          for (const [a, b] of both) { if (Math.abs(a.vs) < 0.3 || Math.abs(b.vs) < 0.3) continue; if (a.vs * b.vs < 0) turned++; else same++; }
          if (turned > same) out.push({ kind: 'direction', shot: c.shot, from: o.shot, clock: c.clock, detail: `${turned} of ${turned + same} moving people change direction across the screen over the cut` });
        }
        if (lastDeck && lastDeck.furniture !== c.furniture) out.push({ kind: 'furniture', shot: c.shot, from: lastDeck.shot, clock: c.clock, detail: c.furniture ? 'the furniture appears' : 'the furniture vanishes' });
        for (const m of c.crew) {
          if (!m.visible) continue;
          const l = last.get(m.id);
          if (!l || l.scene !== c.scene) continue; // first sight in this scene (a new scene is a new time)
          // posture changes seen inside the shots between count as acted
          const acted = this.seen.some((s) => s.id === m.id && s.clock >= l.clock - 1e-3 && s.clock <= c.clock + 1e-3 && s.to === m.posture);
          if (l.m.posture !== m.posture && !acted && m.posture !== 'air' && l.m.posture !== 'air') out.push({ kind: 'posture', shot: c.shot, from: l.shot, id: m.id, clock: c.clock, detail: `${l.m.posture} at the end of ${l.shot}, ${m.posture} at the start of ${c.shot}` });
          const d = Math.hypot(m.x - l.m.x, m.z - l.m.z), dt = Math.max(0.05, c.clock - l.clock);
          const pa = placeOf(l.m.x), pb = placeOf(m.x);
          if (pa !== pb && !this.travel.some((s) => s.id === m.id && s.clock >= l.clock - 1e-3 && s.clock <= c.clock + 1e-3)) out.push({ kind: 'place', shot: c.shot, from: l.shot, id: m.id, clock: c.clock, detail: `in the ${pa} at the end of ${l.shot}, in the ${pb} at the start of ${c.shot}: not seen to go there` });
          if (d > 0.5 && d / dt > (m.posture === 'air' ? 2.6 : 1.4)) out.push({ kind: 'jump', shot: c.shot, from: l.shot, id: m.id, clock: c.clock, detail: `${d.toFixed(2)} m in ${dt.toFixed(1)} s off screen` });
        }
      } else if (inShot && c.set === 'deck') {
        lastDeck = c;
        for (const m of c.crew) if (m.visible) last.set(m.id, { m, shot: c.shot, scene: c.scene, clock: c.clock });
      }
    }
    // in-shot positions also count as "last seen": a shot that shows someone walk to a new mark is fine
    return [...out, ...this.pops].sort((a, b) => a.clock - b.clock);
  }
}

/** Loose props whose middle is inside a piece of furniture (tested in the furniture's own frame, so a turned sofa's
 *  box does not swallow what rests beside it): names of the pairs. */
export function overlaps(a: THREE.Object3D[], b: THREE.Object3D[], margin = 0.01): string[] {
  const out: string[] = [], p = new THREE.Vector3(), box = new THREE.Box3();
  for (const y of b) {
    const g = (y as THREE.Mesh).geometry; if (!g) continue;
    g.computeBoundingBox(); box.copy(g.boundingBox!).expandByScalar(-margin);
    const inv = y.matrixWorld.clone().invert();
    for (const x of a) { x.getWorldPosition(p).applyMatrix4(inv); if (box.containsPoint(p)) out.push(`${x.name || x.uuid.slice(0, 6)}~${y.name || y.uuid.slice(0, 6)}`); }
  }
  return out;
}
