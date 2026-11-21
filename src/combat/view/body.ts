// What the player's body does in a fight, and what is in the hands. Every attack, throw, draw, block, hit and roll
// is a pair or a run of authored poses (where each bone points), blended by where the simulation is in the action:
// no stock clips, no loops. The walk underneath is the game's own.
import * as THREE from 'three';
import type { Character, Limbs, Dir } from '../../characters/character';
import type { SimPlayer } from '../sim/sim';
import { WEAPONS } from '../sim/weapons';
import type { WeaponId } from '../sim/weapons';

type Pose = Limbs;
// local frame of a body: +z ahead, +y up, +x to its left
const P: Record<string, Pose> = {
  guard: { armR: [-0.35, -0.78, 0.4], foreR: [0.1, 0.3, 1], armL: [0.35, -0.78, 0.4], foreL: [-0.15, 0.4, 1], bend: 0.1 },
  carry: { armR: [-0.28, -0.9, 0.12], foreR: [0, -0.35, 1] },
  spearReady: { armR: [-0.3, -0.82, -0.05], foreR: [0, -0.08, 1], armL: [0.3, -0.62, 0.6], foreL: [-0.3, 0.02, 1], twist: -0.35, bend: 0.14 },
  spearBack: { armR: [-0.32, -0.45, -0.85], foreR: [0.05, 0.05, 1], armL: [0.25, -0.4, 0.85], foreL: [-0.2, 0.1, 1], twist: -0.62, bend: 0.08 },
  spearThrust: { armR: [-0.1, -0.16, 1], foreR: [0, -0.05, 1], armL: [0.35, -0.7, 0.2], foreL: [0, -0.3, 1], twist: 0.45, bend: 0.32 },
  clubBack: { armR: [-0.3, 0.85, -0.45], foreR: [-0.1, 0.5, -0.9], armL: [0.3, -0.5, 0.6], foreL: [-0.2, 0.2, 1], twist: -0.4, bend: -0.12 },
  clubHit: { armR: [-0.05, -0.35, 1], foreR: [0.1, -0.65, 0.75], armL: [0.4, -0.8, 0], foreL: [0.2, -0.6, 0.6], twist: 0.4, bend: 0.46 },
  sweepBack: { armR: [-0.92, 0.05, -0.3], foreR: [-0.6, 0.25, -0.55], armL: [0.3, -0.6, 0.5], foreL: [-0.2, 0.2, 1], twist: -0.75 },
  sweepHit: { armR: [0.45, -0.12, 0.88], foreR: [0.8, -0.05, 0.5], armL: [0.5, -0.75, -0.1], foreL: [0.3, -0.5, 0.6], twist: 0.75, bend: 0.2 },
  jabBack: { armL: [0.32, -0.6, -0.25], foreL: [0, 0.5, 0.9], armR: [-0.35, -0.7, 0.4], foreR: [0.1, 0.5, 0.9], twist: 0.3 },
  jabHit: { armL: [0.1, -0.02, 1], foreL: [0, 0, 1], armR: [-0.35, -0.75, 0.3], foreR: [0.1, 0.6, 0.8], twist: -0.45, bend: 0.15 },
  crossBack: { armR: [-0.36, -0.5, -0.5], foreR: [0, 0.5, 0.9], armL: [0.35, -0.7, 0.4], foreL: [-0.1, 0.5, 0.9], twist: -0.45 },
  crossHit: { armR: [-0.06, 0.02, 1], foreR: [0, 0, 1], armL: [0.35, -0.75, 0.3], foreL: [-0.1, 0.6, 0.8], twist: 0.6, bend: 0.2 },
  throwBack: { armR: [-0.55, 0.45, -0.7], foreR: [-0.1, 0.95, -0.25], armL: [0.2, -0.02, 1], foreL: [0, 0.1, 1], twist: -0.7, bend: -0.15 },
  throwHit: { armR: [-0.1, 0.22, 1], foreR: [0, -0.3, 1], armL: [0.4, -0.8, -0.2], foreL: [0.2, -0.7, 0.4], twist: 0.62, bend: 0.36 },
  bowHold: { armL: [0.14, -0.06, 1], foreL: [0.1, -0.02, 1], armR: [-0.45, -0.25, 0.6], foreR: [0.4, 0.1, 0.9], twist: -0.85 },
  bowDrawn: { armL: [0.14, -0.04, 1], foreL: [0.1, 0, 1], armR: [-0.78, 0, -0.5], foreR: [0.62, 0.06, 0.78], twist: -1.0 },
  gunAim: { armR: [-0.26, -0.36, 0.9], foreR: [0.16, 0.1, 1], armL: [0.3, -0.42, 0.85], foreL: [-0.36, 0.16, 0.95], bend: 0.1 },
  gunKick: { armR: [-0.28, -0.3, 0.86], foreR: [0.16, 0.3, 0.95], armL: [0.3, -0.36, 0.82], foreL: [-0.36, 0.34, 0.9], bend: 0.02 },
  reload: { armR: [-0.25, -0.75, 0.5], foreR: [0.3, -0.2, 0.9], armL: [0.3, -0.7, 0.55], foreL: [-0.4, 0.1, 0.9], bend: 0.5 },
  block: { armL: [0.35, -0.25, 0.85], foreL: [-0.55, 0.75, 0.3], armR: [-0.35, -0.25, 0.85], foreR: [0.55, 0.75, 0.3], bend: 0.2 },
  brace: { armR: [-0.3, -0.72, 0.3], foreR: [0.1, 0, 1], armL: [0.3, -0.32, 0.9], foreL: [-0.2, 0.2, 1], bend: 0.38, twist: -0.3 },
  stagger: { armL: [0.85, -0.3, 0.2], foreL: [0.6, -0.6, 0.4], armR: [-0.85, -0.3, 0.2], foreR: [-0.6, -0.6, 0.4], bend: -0.32, openHands: true },
  tuck: { armL: [0.3, -0.3, 0.9], foreL: [-0.3, 0.8, 0.3], armR: [-0.3, -0.3, 0.9], foreR: [0.3, 0.8, 0.3], legL: [0.15, 0.25, 1], shinL: [0, -1, 0.1], legR: [-0.15, 0.25, 1], shinR: [0, -1, 0.1], bend: 1.1 },
  snared: { armL: [0.5, -0.6, 0.5], foreL: [0.2, -0.9, 0.3], armR: [-0.5, -0.6, 0.5], foreR: [-0.2, -0.9, 0.3], bend: 0.55, openHands: true },
  sneak: { bend: 0.5, armL: [0.3, -0.8, 0.45], foreL: [-0.1, -0.2, 1], armR: [-0.3, -0.8, 0.45], foreR: [0.1, -0.2, 1] },
};
const DIRS: (keyof Limbs)[] = ['armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];
const smooth = (k: number) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
const out = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;

/** Blend two poses. A bone only one of them sets comes in or goes out with the blend. */
function mix(a: Pose | null, b: Pose | null, k: number, into: Pose): Pose | null {
  if (!a && !b) return null;
  const A = a ?? {}, B = b ?? {};
  for (const d of DIRS) {
    const x = A[d] as Dir | undefined, y = B[d] as Dir | undefined;
    if (x && y) (into[d] as Dir) = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
    else if (y && k > 0.5) (into[d] as Dir) = y; else if (x && k <= 0.5) (into[d] as Dir) = x; else delete into[d];
  }
  into.bend = (A.bend ?? 0) + ((B.bend ?? 0) - (A.bend ?? 0)) * k;
  into.twist = (A.twist ?? 0) + ((B.twist ?? 0) - (A.twist ?? 0)) * k;
  into.openHands = k > 0.5 ? B.openHands : A.openHands;
  return into;
}

function gearMesh(id: WeaponId): THREE.Object3D {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.85 }), stone = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9, flatShading: true });
  const vine = new THREE.MeshStandardMaterial({ color: 0x4f7a4c, roughness: 0.9 }), metal = new THREE.MeshStandardMaterial({ color: 0x70757d, roughness: 0.4, metalness: 0.8 });
  // built along +z: the end that does the work points out of the thumb side of the fist
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, z = 0, y = 0, x = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const rod = (r: number, len: number) => { const c = new THREE.CylinderGeometry(r, r, len, 6); c.rotateX(Math.PI / 2); return c; };
  if (id === 'rock') add(new THREE.DodecahedronGeometry(0.065, 0), stone);
  else if (id === 'club') { add(rod(0.022, 0.75), wood, 0.25); add(new THREE.SphereGeometry(0.06, 7, 5), wood, 0.6).scale.set(1, 1, 1.5); }
  else if (id === 'spear') { add(rod(0.016, 2), wood, 0.35); const tip = new THREE.ConeGeometry(0.035, 0.2, 4); tip.rotateX(Math.PI / 2); add(tip, stone, 1.43); add(rod(0.022, 0.08), vine, 1.3); }
  else if (id === 'torch') {
    add(rod(0.02, 0.7), wood, 0.2);
    const f = new THREE.ConeGeometry(0.07, 0.26, 5); f.rotateX(Math.PI / 2);
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.5, 0.35), transparent: true, opacity: 0.9, depthWrite: false });
    const flame = add(f, fm, 0.66); flame.name = 'flame'; flame.castShadow = false;
  }
  else if (id === 'sling') { add(rod(0.006, 0.5), vine, 0.25); add(new THREE.SphereGeometry(0.04, 6, 4), vine, 0.5).scale.set(1.2, 0.5, 1.4); }
  else if (id === 'bow') {
    const arc = new THREE.TorusGeometry(0.62, 0.014, 5, 16, 1.9); arc.rotateY(Math.PI / 2); arc.rotateX(Math.PI / 2 + 0.95);
    add(arc, wood, 0, 0.62 - 0.02);
    const s = add(rod(0.003, 1.02), vine, 0, 0.26); s.name = 'string';
  }
  else if (id === 'crossbow') { add(new THREE.BoxGeometry(0.05, 0.06, 0.7), wood, 0.25); const lath = add(new THREE.BoxGeometry(0.7, 0.025, 0.04), metal, 0.55); lath.name = 'lath'; }
  else if (id === 'coil') {
    add(new THREE.BoxGeometry(0.07, 0.11, 0.42), metal, 0.18);
    for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.05, 0.012, 5, 10), new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.4, metalness: 0.9 }), 0.42 + i * 0.07);
    const c = add(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3) }), 0.05, 0.07); c.name = 'cell';
  }
  return g;
}

/** Where each thing sits in a closed hand (hand space: -y along the fingers, +z out of the thumb side). */
export const GRIP = { x: 0.035, y: -0.085, z: 0.0, rx: 0, ry: 0, rz: 0 };

export class FightBody {
  private gear = new Map<WeaponId, THREE.Object3D>();
  private held: THREE.Object3D | null = null;
  private heldId: WeaponId | null = null;
  private scratch: Pose = {};
  private scratch2: Pose = {};
  private ready = 0;
  private kick = 0;
  private last: { act: string; weapon: WeaponId } = { act: 'idle', weapon: 'fists' };
  /** Seconds since the last shot left (the follow-through of a throw or a loose). */
  private since = 9;
  private wasCharging: 'none' | 'shot' | 'throw' = 'none';
  /** The roll's turn (radians) and the body's drop, for the controller to lay on the root after the walk is posed. */
  rollAngle = 0;
  crouch = 0;

  /** The thing in the hand: the right for everything but the bow. */
  private hold(model: Character, id: WeaponId | null) {
    const hand = id === 'bow' ? model.handL : model.handR;
    if (this.heldId === id && this.held?.parent === hand) return;
    this.held?.removeFromParent(); this.held = null; this.heldId = id;
    if (!id || id === 'fists') return;
    let m = this.gear.get(id);
    if (!m) { m = gearMesh(id); this.gear.set(id, m); }
    hand.add(m); this.held = m;
  }
  shot() { this.since = 0; this.kick = 1; }

  /**
   * Called before the walk is posed each frame. `armed` is true when the weapon should be up (a threat near, or
   * aiming); otherwise it is carried and the body is left to the walk.
   */
  update(model: Character, p: SimPlayer, dt: number, t: number, armed: boolean, aiming: boolean, visible: WeaponId | null) {
    this.hold(model, visible);
    if (this.held) {
      const G = GRIP, gun = this.heldId === 'coil' || this.heldId === 'crossbow';
      // a stock is held like a grip: the barrel runs on along the forearm, not out of the thumb
      this.held.position.set(G.x * (this.heldId === 'bow' ? -1 : 1), G.y + (gun ? 0.03 : 0), G.z);
      this.held.rotation.set(G.rx + (gun ? Math.PI / 2 : 0), G.ry, G.rz);
    }
    this.since += dt; this.kick = Math.max(0, this.kick - dt * 5);
    const w = p.weapon, def = WEAPONS[w], m = def.melee;
    this.ready += ((armed || p.act !== 'idle' || p.blocking ? 1 : 0) - this.ready) * (1 - Math.exp(-dt * 9));
    const flame = this.held?.getObjectByName('flame');
    if (flame) flame.scale.setScalar(0.85 + Math.sin(t * 17) * 0.12 + Math.sin(t * 7) * 0.1);
    const str = this.held?.getObjectByName('string');
    let pose: Pose | null = null, base: Pose | null;
    // the stance the weapon is held in when it is up
    if (w === 'bow') base = P.bowHold; else if (w === 'crossbow' || w === 'coil') base = P.gunAim; else if (w === 'spear') base = P.spearReady; else base = P.guard;
    this.rollAngle = 0; this.crouch = 0;
    if (p.down) { model.setLimbs(null); return; }
    if (p.act === 'roll') {
      // tucked, over the shoulder and up: the turn runs ahead of the clock so the feet are under by the end
      const k = Math.min(1, p.actT / 0.62);
      this.rollAngle = out(k * 1.08) * Math.PI * 2;
      this.crouch = Math.sin(Math.min(1, k * 1.1) * Math.PI) * 0.5;
      pose = mix(base, P.tuck, smooth(Math.min(k / 0.18, (1 - k) / 0.22)), this.scratch);
    } else if (p.staggerT > 0) {
      pose = mix(base, P.stagger, smooth(Math.min(1, p.staggerT / 0.2)), this.scratch);
    } else if (p.snareT > 0.15) {
      pose = mix(base, P.snared, 0.8 + Math.sin(t * 11) * 0.2, this.scratch);
    } else if (p.blocking) {
      pose = mix(base, w === 'spear' ? P.brace : P.block, out(p.blockT / 0.12), this.scratch);
      if (w === 'spear') this.crouch = 0.16 * out(p.blockT / 0.2);
    } else if (p.act === 'charge') {
      const c = p.charge;
      if (p.charging === 'throw' || w === 'rock') pose = mix(base, P.throwBack, out(c), this.scratch);
      else if (w === 'sling') {
        // the sling goes round overhead, faster as it comes up to speed
        const a = t * (9 + c * 12);
        // upper arm out and up at the shoulder, the forearm drawing the circle above the head; the other hand points the way
        this.scratch2 = { ...P.throwBack, armR: [-0.72, 0.62, -0.05], foreR: [Math.cos(a) * 0.8 - 0.2, 0.45, Math.sin(a) * 0.8], armL: [0.3, -0.25, 0.9], foreL: [0.05, -0.1, 1], twist: -0.5 };
        pose = mix(base, this.scratch2, out(c * 3), this.scratch);
      } else pose = mix(P.bowHold, P.bowDrawn, out(c), this.scratch);
      if (str) str.position.x = w === 'bow' ? -c * 0.0 : 0;
    } else if (p.act === 'windup' || p.act === 'active' || (p.act === 'recover' && p.combo !== 9 && m)) {
      // wind-up, the blow, and the way back
      const fists = w === 'fists' || w === 'rock';
      const back = w === 'spear' ? P.spearBack : fists ? (p.combo % 2 ? P.crossBack : P.jabBack) : p.combo === 1 || w === 'torch' ? P.sweepBack : P.clubBack;
      const hit = w === 'spear' ? P.spearThrust : fists ? (p.combo % 2 ? P.crossHit : P.jabHit) : p.combo === 1 || w === 'torch' ? P.sweepHit : P.clubHit;
      if (p.act === 'windup') pose = mix(base, back, out(p.actT / (m!.windup * 0.8)), this.scratch);
      else if (p.act === 'active') pose = mix(back, hit, out(p.actT / (m!.active * 0.6)), this.scratch);
      else pose = mix(hit, base, smooth(p.actT / m!.recover), this.scratch);
    } else if (this.since < 0.4 && this.wasCharging !== 'none') {
      // the follow-through of what was just thrown or loosed
      const k = this.since / 0.4;
      const from = this.wasCharging === 'throw' || this.last.weapon === 'rock' || this.last.weapon === 'sling' ? P.throwHit : P.bowHold;
      pose = k < 0.3 ? mix(this.wasCharging === 'shot' && this.last.weapon === 'bow' ? P.bowDrawn : P.throwBack, from, out(k / 0.3), this.scratch) : mix(from, base, smooth((k - 0.3) / 0.7), this.scratch);
    } else if (p.reloadT > 0) {
      pose = mix(base, P.reload, smooth(Math.min(1, Math.min(p.reloadT, 2.6 - p.reloadT) / 0.3)), this.scratch);
      this.crouch = 0.1;
    } else if ((w === 'crossbow' || w === 'coil') && (aiming || this.kick > 0)) {
      pose = mix(P.gunAim, P.gunKick, this.kick, this.scratch);
    } else if (this.ready > 0.03) {
      pose = mix(w !== 'fists' ? P.carry : null, base, this.ready, this.scratch);
      if (aiming && w === 'bow') pose = P.bowHold;
    } else if (w !== 'fists' && w !== 'sling') pose = P.carry;
    if (p.sneaking && p.act !== 'roll') { this.crouch = Math.max(this.crouch, 0.24); pose = pose ? { ...pose, bend: (pose.bend ?? 0) + 0.42 } : P.sneak; }
    if (p.act === 'charge') this.wasCharging = p.charging === 'none' ? 'shot' : p.charging; else if (this.since > 0.45) this.wasCharging = 'none';
    this.last.act = p.act; this.last.weapon = w;
    model.setLimbs(pose);
  }

  /** Give the body back to the walk and empty the hands. */
  release(model: Character) { model.setLimbs(null); this.hold(model, null); this.rollAngle = 0; this.crouch = 0; this.ready = 0; }
}
