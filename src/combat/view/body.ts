// What the player's body does in a fight, and what is in the hands. Every attack, throw, draw, block, hit and roll
// is a pair or a run of authored poses (where each bone points), blended by where the simulation is in the action:
// no stock clips, no loops. The walk underneath is the game's own.
import * as THREE from 'three';
import type { Character, Limbs, Dir } from '../../characters/character';
import type { SimPlayer } from '../sim/sim';
import { WEAPONS } from '../sim/weapons';
import { RangedRig } from './ranged';
import { loft } from '../../characters/shapes';
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
  // a throwing stick: arm-long hard wood, thicker and a little bent towards the far end
  else if (id === 'throwstick') { add(rod(0.016, 0.42), wood, 0.2); add(rod(0.024, 0.3), wood, 0.52, 0.015).rotation.x = Math.PI / 2 + 0.12; }
  else if (id === 'flake') { const f = new THREE.TetrahedronGeometry(0.05, 0); f.scale(0.5, 1, 1.6); add(f, stone, 0.04); }
  // the hand axe: a flint teardrop, butt in the palm, the point out past the thumb
  else if (id === 'handaxe') { const f = new THREE.OctahedronGeometry(0.06, 0); f.scale(0.42, 1, 1.9); add(f, new THREE.MeshStandardMaterial({ color: 0x7d7468, roughness: 0.75, flatShading: true }), 0.07); }
  // fire-hardened: one piece of wood, the point blackened by the coals
  else if (id === 'spear') { add(rod(0.016, 2), wood, 0.35); const tip = new THREE.ConeGeometry(0.016, 0.22, 6); tip.rotateX(Math.PI / 2); add(tip, new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.9 }), 1.46); }
  else if (id === 'hafted') { add(rod(0.016, 2), wood, 0.35); const tip = new THREE.ConeGeometry(0.035, 0.2, 4); tip.rotateX(Math.PI / 2); add(tip, stone, 1.43); add(rod(0.022, 0.08), vine, 1.3); }
  // the spear-thrower: a forearm-long stick, the hook at the far end, a dart lying along it with its butt in the hook
  else if (id === 'atlatl') { add(rod(0.012, 0.6), wood, 0.25); const hook = add(new THREE.BoxGeometry(0.02, 0.05, 0.03), wood, 0.55, 0.025); hook.name = 'hook'; const dart = add(rod(0.007, 1.7), wood, -0.25, 0.04); dart.name = 'dart'; const tip = new THREE.ConeGeometry(0.014, 0.06, 4); tip.rotateX(-Math.PI / 2); add(tip, stone, -1.12, 0.04); }
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

/**
 * The hide wrap (tree row 15), worn: smoked hide round each forearm from below the elbow to above the wrist and a cap
 * over each shoulder, lashed on with cord. Hung on the arm bones themselves, so it goes wherever the arm goes (a
 * story scene, a roll, the walk) with no work a frame. Sizes are in metres, turned into each bone's own units.
 *
 * Over clothes: the crew's coats are cut loose, and a wrap sized to a bare arm sank into the sleeve (only the cords
 * showed). So the wrap measures the sleeve it goes over (the skinned vertices that follow the forearm, in the bone's
 * own frame) and is laid just over it; the cloth beyond each end is drawn puffed out, the way a sleeve bunches where
 * a wrap squeezes it, and the cord runs crossed over the hide between bands at the ends.
 */
class HideWrap {
  private parts: THREE.Object3D[] = [];
  private model: Character | null = null;
  private hide = new THREE.MeshStandardMaterial({ color: 0x6e4c2e, roughness: 0.96, flatShading: true });
  private cord = new THREE.MeshStandardMaterial({ color: 0x2a1d12, roughness: 0.9 });
  private cloth: THREE.MeshStandardMaterial | null = null;
  set(model: Character, on: boolean) {
    if (on && this.model !== model) { this.clear(); this.build(model); }
    else if (!on && this.model) this.clear();
  }
  private clear() { for (const o of this.parts) o.removeFromParent(); this.parts = []; this.model = null; }
  /**
   * The cloth round `bone` (towards `child`), in the bone's own units: the largest distance from the bone's line of
   * any skinned vertex that follows `bone` (or the twist bones `follow` names), in eight sections along it. Returns
   * the radii (0 where nothing was found) and the material of the widest vertex (the sleeve's cloth).
   */
  private measure(model: Character, bone: THREE.Object3D, axis: THREE.Vector3, len: number, follow: (n: string) => boolean) {
    const R = new Array(8).fill(0); let cloth: THREE.Material | null = null, best = 0;
    const v = new THREE.Vector3(), ax = axis.clone().normalize();
    model.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || o.name === 'hideWrap' || !m.visible) return;
      const sk = m.skeleton, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, pos = m.geometry.attributes.position;
      if (!sk || !si || !sw) return;
      const mine = sk.bones.map((b) => follow(b.name));
      if (!mine.some(Boolean)) return;
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        let top = 0, ti = -1;
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > top) { top = w; ti = si.getComponent(i, c); } }
        if (ti < 0 || !mine[ti] || top < 0.5) continue;
        m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); bone.worldToLocal(v);
        const t = v.dot(ax) / len; if (t < 0 || t >= 1) continue;
        const r = v.addScaledVector(ax, -v.dot(ax)).length(), k = Math.floor(t * 8);
        if (r > R[k]) R[k] = r;
        if (r > best) { best = r; cloth = Array.isArray(m.material) ? m.material[0] : m.material; }
      }
    });
    return { R, cloth };
  }
  /** A sleeve on `bone` along the way to `child`, from `a` to `b` of the bone's length, radius r0 -> r1 (metres). */
  private sleeve(model: Character, bone: THREE.Object3D, child: THREE.Object3D, a: number, b: number, r0: number, r1: number, laces: number[], flare = 0, follow?: (n: string) => boolean) {
    // the child's place in this bone's own frame (the hand is not a direct child of the forearm: twist bones sit between)
    bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
    const cw = child.getWorldPosition(new THREE.Vector3()), axis = bone.worldToLocal(cw.clone()), len = axis.length();
    if (len < 1e-4) return;
    const wl = bone.getWorldPosition(new THREE.Vector3()).distanceTo(cw);
    const k = wl > 1e-4 ? len / wl : 1; // metres to the bone's units
    // over the sleeve: never smaller than the cloth under it at that section (plus the hide's thickness)
    const M = follow ? this.measure(model, bone, axis, len, follow) : null;
    const under = (t: number) => {
      if (!M) return 0;
      const i = Math.max(0, Math.min(7, Math.floor(t * 8)));
      return Math.max(M.R[i], M.R[Math.max(0, i - 1)] * 0.9, M.R[Math.min(7, i + 1)] * 0.9);
    };
    const rad = (t: number, base: number) => Math.max(base * k, under(t) * 1.05 + 0.004 * k);
    const g = new THREE.Group(); g.name = 'hideWrap';
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    const ra = rad(a, r0), rb = rad(b, r1), rm = rad((a + b) / 2, (r0 + r1) / 2);
    // a hide sleeve: seven sides, not quite round, the edges rolled a little proud, pulled in a little under the cords
    const rings = [
      { y: a * len, rx: ra * (1.06 + flare), rz: ra * (0.98 + flare) },
      { y: (a + 0.04) * len, rx: ra * 1.02, rz: ra * 0.95 },
      { y: (a + b) * 0.5 * len, rx: rm, rz: rm * 0.92 },
      { y: (b - 0.04) * len, rx: rb * 1.02, rz: rb * 0.95 },
      { y: b * len, rx: rb * 1.08, rz: rb * 1.0 },
    ];
    const m = new THREE.Mesh(loft(rings, 7), this.hide); m.castShadow = true; g.add(m);
    const at = (t: number) => { const u = (t - a) / (b - a); return (u < 0.5 ? ra + (rm - ra) * u * 2 : rm + (rb - rm) * (u - 0.5) * 2) * 1.05; };
    for (const t of laces) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(at(t), 0.0055 * k, 4, 12).rotateX(Math.PI / 2), this.cord);
      c.position.y = t * len; c.rotation.y = t * 7; c.rotation.z = 0.12; g.add(c);
    }
    // crossed lashing between the first and last band: two cords wound opposite ways
    if (laces.length > 1) {
      const t0 = laces[0], t1 = laces[laces.length - 1];
      for (const dir of [1, -1]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = t0 + (t1 - t0) * (i / 24), ang = dir * (i / 24) * Math.PI * 2 * (laces.length - 1) * 0.5 + (dir > 0 ? 0 : Math.PI), r = at(t) * 1.01;
          pts.push(new THREE.Vector3(Math.sin(ang) * r, t * len, Math.cos(ang) * r * 0.94));
        }
        const c = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0045 * k, 4), this.cord); g.add(c);
      }
    }
    // the sleeve bunched out beyond each end of the wrap, where there is cloth to bunch
    if (M && M.cloth && this.cloth) {
      // only above the wrap (towards the elbow): past the wrist the measured "sleeve" is the cuff and the hand, and a
      // puff there drew a wide white bell round the hand (v4)
      for (const [t, dir] of [[a, -1]] as const) {
        const ru = under(t + dir * 0.06);
        if (ru < 0.055 * k) continue; // a bare arm there: nothing to bunch
        const r = ra, y = t * len, d = 0.07 * len * dir, rp = Math.min(Math.max(r, ru) * 1.06, r * 1.1);
        const puff = loft([
          { y: y - d * 0.1, rx: r * 0.97, rz: r * 0.92 },
          { y: y + d * 0.4, rx: rp, rz: rp * 0.95 },
          { y: y + d, rx: Math.min(ru, r) * 1.0, rz: Math.min(ru, r) * 0.95 },
        ].sort((p, q) => p.y - q.y), 12);
        const pm = new THREE.Mesh(puff, this.cloth); pm.castShadow = true; g.add(pm);
      }
    }
    bone.add(g); this.parts.push(g);
  }
  private build(model: Character) {
    const g = (n: string) => model.root.getObjectByName(n);
    for (const s of ['L', 'R']) {
      const up = g(`upperarm${s}`), lo = g(`lowerarm${s}`), hd = g(`hand${s}`);
      if (!up || !lo || !hd) continue;
      if (!this.cloth) {
        // the coat's own cloth colour for the bunched sleeve (measured below; white coat if none is found)
        const probe = this.measure(model, lo, lo.worldToLocal(hd.getWorldPosition(new THREE.Vector3())), Math.max(1e-4, lo.worldToLocal(hd.getWorldPosition(new THREE.Vector3())).length()), (n) => n === `lowerarm${s}` || (n.startsWith('forearmtw') && n.endsWith(s)));
        const src = probe.cloth as THREE.MeshStandardMaterial | null;
        this.cloth = new THREE.MeshStandardMaterial({ color: src?.color ? src.color.clone() : new THREE.Color(0xe8e8e4), roughness: 0.92 });
      }
      this.sleeve(model, lo, hd, 0.12, 0.84, 0.05, 0.045, [0.18, 0.5, 0.8], 0, (n) => n === `lowerarm${s}` || (n.startsWith('forearmtw') && n.endsWith(s)));
      this.sleeve(model, up, lo, -0.06, 0.36, 0.092, 0.08, [0.3], 0.12);
    }
    this.model = model;
  }
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
  /** The bow and the sling have their own rig (view/ranged.ts): both hands on them, drawn where the hands are. */
  ranged = new RangedRig();
  private wrap = new HideWrap();
  update(model: Character, p: SimPlayer, dt: number, t: number, armed: boolean, aiming: boolean, visible: WeaponId | null, aimW?: THREE.Vector3, ammo = 0) {
    this.wrap.set(model, p.wrap);
    const rw = p.weapon === 'bow' || p.weapon === 'sling' || p.weapon === 'atlatl';
    this.hold(model, rw ? null : visible);
    if (rw && !p.down && p.act !== 'roll' && p.staggerT <= 0 && aimW) {
      this.since += dt; this.rollAngle = 0; this.crouch = 0;
      const pose = this.ranged.pose(model, p, dt, t, aiming || armed, aimW, ammo, this.since);
      if (p.act === 'charge') this.wasCharging = 'shot'; else if (this.since > 0.45) this.wasCharging = 'none';
      if (pose) { if (p.sneaking) { pose.bend = (pose.bend ?? 0) + 0.3; this.crouch = 0.2; } model.setLimbs(pose); return; }
    } else if (!rw) { if (this.ranged.mode !== 'none') this.ranged.hide(model); }
    else this.ranged.faceOffset = 0;
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
    if (w === 'bow') base = P.bowHold; else if (w === 'crossbow' || w === 'coil') base = P.gunAim; else if (w === 'spear' || w === 'hafted') base = P.spearReady; else base = P.guard;
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
      pose = mix(base, w === 'spear' || w === 'hafted' ? P.brace : P.block, out(p.blockT / 0.12), this.scratch);
      if (w === 'spear' || w === 'hafted') this.crouch = 0.16 * out(p.blockT / 0.2);
    } else if (p.act === 'charge') {
      const c = p.charge;
      if (p.charging === 'throw' || w === 'rock' || w === 'atlatl') pose = mix(base, P.throwBack, out(c), this.scratch);
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
      const fists = w === 'fists' || w === 'rock' || w === 'flake';
      const back = w === 'spear' || w === 'hafted' ? P.spearBack : fists ? (p.combo % 2 ? P.crossBack : P.jabBack) : p.combo === 1 || w === 'torch' ? P.sweepBack : P.clubBack;
      const hit = w === 'spear' || w === 'hafted' ? P.spearThrust : fists ? (p.combo % 2 ? P.crossHit : P.jabHit) : p.combo === 1 || w === 'torch' ? P.sweepHit : P.clubHit;
      if (p.act === 'windup') pose = mix(base, back, out(p.actT / (m!.windup * 0.8)), this.scratch);
      else if (p.act === 'active') pose = mix(back, hit, out(p.actT / (m!.active * 0.6)), this.scratch);
      else pose = mix(hit, base, smooth(p.actT / m!.recover), this.scratch);
    } else if (this.since < 0.4 && this.wasCharging !== 'none') {
      // the follow-through of what was just thrown or loosed
      const k = this.since / 0.4;
      const from = this.wasCharging === 'throw' || this.last.weapon === 'rock' || this.last.weapon === 'sling' || this.last.weapon === 'atlatl' ? P.throwHit : P.bowHold;
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
  /** After the body is posed this frame. */
  late(model: Character, dt: number, t: number) { this.ranged.late(model, dt, t); }
  release(model: Character) { this.ranged.hide(model); model.setLimbs(null); this.hold(model, null); this.rollAngle = 0; this.crouch = 0; this.ready = 0; }
}
