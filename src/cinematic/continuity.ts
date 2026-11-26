import * as THREE from 'three';
import type { Character } from '../characters/character';

/**
 * Continuity log for the opening films (tools/continuity_check.py, ?contlog=1 on a GPU capture). Every frame while it is
 * on, the set, its furniture and the six are measured; at each cut the last frame of the old shot ("out") and the first
 * frame of the new one ("in") are kept. `check()` lists the breaks an audience would see:
 *  - the set's furniture appearing or vanishing between two shots of the same room;
 *  - someone sitting at one cut and standing at the next (or the other way) without being seen to get up;
 *  - someone in another place than they could have walked to while off screen (1.4 m a second);
 *  - pops inside a shot: a body jumping more than 0.3 m, turning more than 60 degrees or changing posture in one frame.
 */
export type Posture = 'stand' | 'sit' | 'low' | 'air';
export interface CrewMark { id: string; x: number; y: number; z: number; yaw: number; hip: number; posture: Posture; visible: boolean }
export interface CutMark { at: 'in' | 'out'; shot: string; scene: string; set: string; clock: number; furniture: boolean; crew: CrewMark[] }
export interface Break { kind: 'furniture' | 'posture' | 'jump' | 'pop' | 'clip'; shot: string; from: string; id?: string; clock: number; detail: string }

const P = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler();

export function posture(c: Character, floor: number): { hip: number; posture: Posture; y: number } {
  c.root.getWorldPosition(P); const y = P.y - floor;
  c.body.getWorldPosition(P);
  const hip = (P.y - floor) / c.height;
  return { hip, y, posture: y > 0.15 ? 'air' : hip > 0.4 ? 'stand' : hip > 0.18 ? 'sit' : 'low' };
}

function mark(c: Character, floor: number): CrewMark {
  const p = posture(c, floor);
  c.root.getWorldPosition(P); c.root.getWorldQuaternion(Q); E.setFromQuaternion(Q, 'YXZ');
  return { id: c.id, x: +P.x.toFixed(3), y: +p.y.toFixed(3), z: +P.z.toFixed(3), yaw: +E.y.toFixed(3), hip: +p.hip.toFixed(3), posture: p.posture, visible: isShown(c.root) };
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
  private prev: CutMark | null = null;
  /** Footprints on the deck floor (furniture, the console): a standing body whose feet are inside one is clipping. */
  footprints: { name: string; x: number; z: number; yaw: number; w: number; d: number; furniture: boolean }[] = [];
  private clipped = new Set<string>();

  reset() { this.cuts = []; this.seen = []; this.pops = []; this.prev = null; this.clipped.clear(); }

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
  frame(shot: string, scene: string, set: string, clock: number, furniture: boolean, crew: Character[], floor: number) {
    if (!this.on) return;
    const now: CutMark = { at: 'in', shot, scene, set, clock: +clock.toFixed(3), furniture, crew: crew.map((c) => mark(c, floor)) };
    const p = this.prev;
    if (set === 'deck') for (const c of now.crew) {
      if (!c.visible || c.posture === 'air' || c.posture === 'sit') continue;
      const k = `${shot}|${c.id}`, f = this.inside(c.x, c.z, 0.12, furniture);
      if (f && !this.clipped.has(k)) { this.clipped.add(k); this.pops.push({ kind: 'clip', shot, from: shot, id: c.id, clock: now.clock, detail: `standing inside the ${f}` }); }
    }
    if (!p || p.shot !== shot || p.scene !== scene) {
      if (p) this.cuts.push({ ...p, at: 'out' });
      this.cuts.push(now);
    } else if (set === 'deck') {
      for (const c of now.crew) {
        const o = p.crew.find((x) => x.id === c.id);
        if (!o || !c.visible || !o.visible) continue;
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
        if (lastDeck && lastDeck.furniture !== c.furniture) out.push({ kind: 'furniture', shot: c.shot, from: lastDeck.shot, clock: c.clock, detail: c.furniture ? 'the furniture appears' : 'the furniture vanishes' });
        for (const m of c.crew) {
          if (!m.visible) continue;
          const l = last.get(m.id);
          if (!l || l.scene !== c.scene) continue; // first sight in this scene (a new scene is a new time)
          // posture changes seen inside the shots between count as acted
          const acted = this.seen.some((s) => s.id === m.id && s.clock >= l.clock - 1e-3 && s.clock <= c.clock + 1e-3 && s.to === m.posture);
          if (l.m.posture !== m.posture && !acted && m.posture !== 'air' && l.m.posture !== 'air') out.push({ kind: 'posture', shot: c.shot, from: l.shot, id: m.id, clock: c.clock, detail: `${l.m.posture} at the end of ${l.shot}, ${m.posture} at the start of ${c.shot}` });
          const d = Math.hypot(m.x - l.m.x, m.z - l.m.z), dt = Math.max(0.05, c.clock - l.clock);
          if (d > 0.5 && d / dt > 1.4) out.push({ kind: 'jump', shot: c.shot, from: l.shot, id: m.id, clock: c.clock, detail: `${d.toFixed(2)} m in ${dt.toFixed(1)} s off screen` });
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

/** Is any of these meshes inside another's box (a floor prop sunk into a sofa)? Names of the pairs. */
export function overlaps(a: THREE.Object3D[], b: THREE.Object3D[], margin = 0.01): string[] {
  const out: string[] = [], A = new THREE.Box3(), B = new THREE.Box3();
  for (const x of a) {
    A.setFromObject(x).expandByScalar(-margin);
    for (const y of b) { B.setFromObject(y); if (A.intersectsBox(B)) out.push(`${x.name || x.uuid.slice(0, 6)}~${y.name || y.uuid.slice(0, 6)}`); }
  }
  return out;
}
