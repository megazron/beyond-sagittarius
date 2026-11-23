// What the player's body does in a fight, and what is in the hands. Every attack, throw, draw, block, hit and roll
// is a pair or a run of authored poses (where each bone points), blended by where the simulation is in the action:
// no stock clips, no loops. The walk underneath is the game's own.
import * as THREE from 'three';
import type { Character, Limbs, Dir } from '../../characters/character';
import type { SimPlayer } from '../sim/sim';
import { WEAPONS } from '../sim/weapons';
import { RangedRig } from './ranged';
import { loft } from '../../characters/shapes';
import { MELEE_GEAR, SHAFT, targetFrame, clearShaft, solveArms, follow, newFrame, copyFrame, depth, setBodyScale, setBodyCentres, setBodyFit, fitBody, reach2, aimBone, capChestWidth, smooth as smoothK } from './melee';
import type { ActState, WFrame, ArmMem, Solved, BodyFit } from './melee';
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
    // (snug: v8 read as blocks on the forearms; the hide is laid 2.5 mm over the cloth, not 4 mm plus 5%)
    const rad = (t: number, base: number) => Math.max(base * k, under(t) * 1.02 + 0.0025 * k);
    const g = new THREE.Group(); g.name = 'hideWrap';
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    // a wrap is bound tight: never wider than a hand's breadth round (a flared cuff is squeezed in, the cloth spills out
    // past the wrist instead of the hide flaring into a wide open tube round the hand)
    const cap = (t: number, m: number) => Math.min(rad(t, m), (M ? 0.072 : 1) * k);
    const ra = cap(a, r0), rb = Math.min(cap(b, r1), ra * 0.92), rm = cap((a + b) / 2, (r0 + r1) / 2);
    // a hide sleeve: seven sides, not quite round, the edges rolled a little proud, pulled in a little under the cords
    const rings = [
      { y: a * len, rx: ra * (1.03 + flare), rz: ra * (0.96 + flare) },
      { y: (a + 0.04) * len, rx: ra * 1.02, rz: ra * 0.95 },
      { y: (a + b) * 0.5 * len, rx: rm * 0.97, rz: rm * 0.88 },
      { y: (b - 0.04) * len, rx: rb * 1.02, rz: rb * 0.95 },
      { y: b * len, rx: rb * 1.04, rz: rb * 0.97 },
      // the end eases in over the wrist: a closed end without a hard turned-in ring (the rolled edge of v7 faced the
      // camera from the front and read as a dark band at the wrist)
      { y: (b + 0.02) * len, rx: rb * 0.93, rz: rb * 0.88 },
    ];
    const m = new THREE.Mesh(loft(rings, 7), this.hide); m.castShadow = true; g.add(m);
    const at = (t: number) => { const u = (t - a) / (b - a); return (u < 0.5 ? ra + (rm - ra) * u * 2 : rm + (rb - rm) * (u - 0.5) * 2) * 1.05; };
    for (const t of laces) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(at(t) * 0.96, 0.0055 * k, 4, 12).rotateX(Math.PI / 2).scale(1, 1, 0.94), this.cord);
      // bedded into the hide (a band tilted 0.12 rad stood a centimetre off one side: wire hoops in v6)
      c.position.y = t * len; c.rotation.y = t * 7; c.rotation.z = 0.04; g.add(c);
    }
    // crossed lashing between the first and last band: two cords wound opposite ways
    if (laces.length > 1) {
      const t0 = laces[0], t1 = laces[laces.length - 1];
      for (const dir of [1, -1]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = t0 + (t1 - t0) * (i / 24), ang = dir * (i / 24) * Math.PI * 2 * (laces.length - 1) * 0.5 + (dir > 0 ? 0 : Math.PI), r = at(t) * 0.97;
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
  /** The coat's cuff where it runs on over the hand (cloth skinned to the hand bone): a short band of hide over it,
   * so no pale tab of cuff shows past the wrap. Nothing when the cuff stops at the wrist. */
  private cuffCover(model: Character, hand: THREE.Object3D, s: string) {
    const fing = model.root.getObjectByName(`finger3_1${s}`) ?? model.root.getObjectByName(`finger2_1${s}`);
    if (!fing) return;
    hand.updateWorldMatrix(true, false); fing.updateWorldMatrix(true, false);
    const axis = hand.worldToLocal(fing.getWorldPosition(new THREE.Vector3())), len = axis.length();
    if (len < 1e-4) return;
    const ax = axis.clone().normalize(), v = new THREE.Vector3();
    let far = 0, r = 0;
    model.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || m.name !== 'cloth' || !m.visible) return;
      const sk = m.skeleton, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, pos = m.geometry.attributes.position;
      if (!sk || !si || !sw) return;
      const hi = sk.bones.indexOf(hand as THREE.Bone); if (hi < 0) return;
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        let w = 0; for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === hi) w += sw.getComponent(i, c);
        if (w < 0.3) continue;
        m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); hand.worldToLocal(v);
        const t = v.dot(ax) / len; if (t < 0 || t > 0.6) continue;
        far = Math.max(far, t); r = Math.max(r, v.addScaledVector(ax, -v.dot(ax)).length());
      }
    });
    if (far < 0.03) return;
    const wl = hand.getWorldPosition(new THREE.Vector3()).distanceTo(fing.getWorldPosition(new THREE.Vector3())), k = wl > 1e-4 ? len / wl : 1;
    const rr = Math.min(r * 1.06 + 0.003 * k, 0.07 * k), y1 = Math.min(0.6, far + 0.04) * len;
    const g = new THREE.Group(); g.name = 'hideWrap';
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
    const band = new THREE.Mesh(loft([{ y: -0.02 * len, rx: rr, rz: rr * 0.8 }, { y: y1 * 0.6, rx: rr * 1.02, rz: rr * 0.82 }, { y: y1, rx: rr * 0.94, rz: rr * 0.76 }], 7), this.hide);
    band.castShadow = true; g.add(band); hand.add(g); this.parts.push(g);
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
      // to the wrist: the coat's cuff ends there, and a wrap that stopped short left the cuff's pale tab showing
      this.sleeve(model, lo, hd, 0.12, 0.95, 0.044, 0.038, [0.18, 0.52, 0.86], 0, (n) => n === `lowerarm${s}` || (n.startsWith('forearmtw') && n.endsWith(s)));
      this.cuffCover(model, hd, s);
      this.sleeve(model, up, lo, -0.06, 0.36, 0.082, 0.072, [0.3], 0.05);
    }
    this.model = model;
  }
}

/** Where each thing sits in a closed hand (hand space: -y along the fingers, +z out of the thumb side). */
/** `?meleerig=0`: the old way (gear on the hand bone, poses switched, no clearance), for before/after recordings. */
const RIG_ON = typeof location === 'undefined' || !/[?&]meleerig=0/.test(location.search);

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
    // the weapons of the melee rig (view/melee.ts) live in the world and are placed at the real hand after the pose
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
      const up = model.root.getObjectByName('upperarmR'), lo = model.root.getObjectByName('lowerarmR');
      if (up && lo) { const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()); this.shapes(model, { a: wp(up).distanceTo(wp(lo)), b: wp(lo).distanceTo(wp(model.handR)) }); }
      const pose = this.ranged.pose(model, p, dt, t, aiming || armed, aimW, ammo, this.since);
      if (p.act === 'charge') this.wasCharging = 'shot'; else if (this.since > 0.45) this.wasCharging = 'none';
      if (pose) { if (p.sneaking) { pose.bend = (pose.bend ?? 0) + 0.3; this.crouch = 0.2; } model.setLimbs(pose); return; }
    } else if (!rw) { if (this.ranged.mode !== 'none') this.ranged.hide(model); }
    // (a roll, a stagger or a frame without an aim: the body stops turning side-on, so the bow, sling or thrower goes
    // down with it and comes up again with the turn. Left up, the next frame posed a raised bow on a body still facing
    // the aim: the arms across the chest, CI 9.8 and 13.5 cm)
    else { this.ranged.faceOffset = 0; this.ranged.lower(); }
    const out0 = this.meleePose(model, p, dt, armed, visible, t);
    if (out0) { this.emit(model, out0, dt, true); return; }
    this.mframe = false;
    if (this.held && !(RIG_ON && MELEE_GEAR.includes(this.heldId!))) {
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
    if (p.down) { this.emit(model, null, dt, false); return; }
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
    this.emit(model, pose, dt, false);
  }

  // ---------------------------------------------------------------- the melee rig (view/melee.ts)
  private cur: WFrame = newFrame(); private prevF: WFrame = newFrame(); private tgt: WFrame = newFrame(); private tmp: WFrame = newFrame();
  private mframe = false; private lPrev: number | null = null; private leftW = 0;
  private bonesM: { upL: THREE.Object3D; upR: THREE.Object3D; loR: THREE.Object3D; loL: THREE.Object3D; a: number; b: number } | null = null;
  /** Per-frame numbers of what was drawn (for the play test): worst shaft depth in the body, worst left-hand gap
   * from the shaft while it holds it, frames counted. */
  stats: { frames: number; shaftIn: number; handOff: number; leftOff: number; skel?: string; worst?: string; worstL?: string } = { frames: 0, shaftIn: 0, handOff: 0, leftOff: 0 };
  private solvedL: number | null = null; private prevL: number | null = null;
  private mem: ArmMem = { L: 0, R: 0 }; private sol: (Solved & { sL: THREE.Vector3; sR: THREE.Vector3 }) | null = null;
  private fitFor: Character | null = null; private fit: BodyFit[] | null = null;
  yawNow = 0; private calm = 0; private dropK = 0;
  /** This frame's hand directions (world, wrist to knuckles) after the wrist's flex (fixArms); null: along the forearm. */
  private hdR: THREE.Vector3 | null = null; private hdL: THREE.Vector3 | null = null;
  private meleePose(model: Character, p: SimPlayer, dt: number, armed: boolean, visible: WeaponId | null, t = 0): Limbs | null {
    const w = p.weapon;
    if (!RIG_ON || !visible || !MELEE_GEAR.includes(w) || p.down || p.act === 'roll' || p.staggerT > 0 || p.snareT > 0.15) return null;
    if (!this.bonesM) {
      const g = (n: string) => model.root.getObjectByName(n);
      const upL = g('upperarmL'), upR = g('upperarmR'), loL = g('lowerarmL'), loR = g('lowerarmR');
      if (!upL || !upR || !loL || !loR) return null;
      const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
      this.bonesM = { upL, upR, loL, loR, a: wp(upR).distanceTo(wp(loR)), b: wp(loR).distanceTo(wp(model.handR)) };
    }
    const B = this.bonesM, def = WEAPONS[w], m = def.melee;
    this.since += dt; this.kick = Math.max(0, this.kick - dt * 5);
    this.ready += ((armed || p.act !== 'idle' || p.blocking ? 1 : 0) - this.ready) * (1 - Math.exp(-dt * 9));
    if (p.act === 'charge') this.wasCharging = 'throw'; else if (this.since > 0.6) this.wasCharging = 'none';
    // the throwing shoulder drops as the arm is drawn back (no collar bones in this rig: the chest rolls a little to
    // the right instead, the neck takes it back so the head stays level; late() applies it)
    const dropT = p.act === 'charge' ? out(Math.min(1, p.charge * 1.4)) : 0;
    this.dropK += (dropT - this.dropK) * (1 - Math.exp(-dt * (dropT > this.dropK ? 8 : 12)));
    const s: ActState = {
      weapon: w, act: p.act, actT: p.actT, combo: p.combo, charge: p.charge, charging: p.charging, blocking: p.blocking, blockT: p.blockT,
      up: this.ready, since: this.since, thrown: this.wasCharging === 'throw' && p.act !== 'charge', windup: m?.windup ?? 0.3, active: m?.active ?? 0.1, recover: m?.recover ?? 0.4,
    };
    const { K, ch } = this.shapes(model, B);
    const loc = (o: THREE.Object3D) => model.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    targetFrame(s, this.tgt, this.tmp);
    // standing with a weapon, a body is never still: the weight shifts from foot to foot (the chest turns and leans a
    // little with it), the breath lifts the hands; eased out in a blow, a block or a throw
    const calm = p.act === 'idle' && !p.blocking && !s.thrown ? 1 : 0;
    this.calm += (calm - this.calm) * (1 - Math.exp(-dt * (calm ? 2 : 8)));
    if (this.calm > 1e-3) {
      const c = this.calm, T = this.tgt;
      T.twist += c * (0.06 * Math.sin(t * 0.53) + 0.025 * Math.sin(t * 1.37 + 0.6));
      T.bend += c * 0.02 * Math.sin(t * 0.91 + 1.1);
      const breath = 0.008 * Math.sin(t * 1.6);
      T.g.y += c * breath; T.g.x += c * 0.012 * Math.sin(t * 0.53);
      if (T.l === null) { T.lh.y += c * (breath + 0.01 * Math.sin(t * 0.7 + 2)); T.lh.z += c * 0.02 * Math.sin(t * 0.61 + 0.4); }
    }
    // the free hand in a throw's draw (owner: stiff, pointing out like a post): it leads, and it is alive. As the throw is
    // drawn back it comes up and across in front of the chest with the chest's turn (the lead arm follows the coil),
    // soft at the elbow (in from straight), and while the throw is held it keeps a balancing sway and the breath
    if (p.act === 'charge' && this.tgt.l === null && (w === 'spear' || w === 'hafted' || w === 'rock' || w === 'flake' || w === 'throwstick' || w === 'club')) {
      const T = this.tgt, c = out(p.charge), a = -0.35 * c;
      const x = T.lh.x, z = T.lh.z, ca = Math.cos(a), sa = Math.sin(a);
      T.lh.x = x * ca + z * sa; T.lh.z = -x * sa + z * ca;
      T.lh.z -= 0.07 * c; T.lh.y += 0.06 * Math.sin(Math.PI * Math.min(1, c * 1.2));
      const hold = smooth((p.charge - 0.6) / 0.4);
      T.lh.y += hold * (0.014 * Math.sin(t * 1.9) + 0.008 * Math.sin(t * 3.3 + 1));
      T.lh.x += hold * 0.016 * Math.sin(t * 1.3 + 0.5); T.lh.z += hold * 0.012 * Math.sin(t * 0.9 + 2);
      T.twist += hold * 0.03 * Math.sin(t * 1.3 + 0.5);
    }
    this.tgt.g.multiplyScalar(K); this.tgt.lh.multiplyScalar(K);
    this.tgt.g.x += ch.x; this.tgt.g.z += ch.z; this.tgt.lh.x += ch.x; this.tgt.lh.z += ch.z;
    clearShaft(this.tgt, w);
    const fast = p.act === 'active' || (s.thrown && this.since < 0.2);
    // (the rig applies these limbs after this frame's late(): late() sees last frame's pose, so it keeps last frame's)
    if (!this.mframe) { copyFrame(this.tgt, this.cur); copyFrame(this.tgt, this.prevF); this.mframe = true; this.lPrev = null; this.mem = { L: 0, R: 0 }; } else { copyFrame(this.cur, this.prevF); follow(this.cur, this.tgt, dt, 0.04, fast ? 60 : 24); }
    const f = copyFrame(this.cur, this.tmp);
    const wantL = this.ready > 0.05 || f.l !== null || p.act !== 'idle' || p.blocking ? 1 : 0;
    this.leftW += (wantL - this.leftW) * (1 - Math.exp(-dt * 10));
    const sL = loc(B.upL), sR = loc(B.upR);
    const r = solveArms(f, w, { sL, sR, a: B.a, b: B.b, palm: 0.07 * K }, this.leftW > 0.02 || f.l !== null ? 1 : 0, 1, this.lPrev, dt, this.mem);
    this.sol = Object.assign(r, { sL, sR });
    this.lPrev = r.f.l; this.solvedL = r.f.l;
    copyFrame(r.f, this.cur); this.cur.l = r.f.l;
    if (p.sneaking) { r.limbs.bend = (r.limbs.bend ?? 0) + 0.3; this.crouch = 0.2; } else this.crouch = p.blocking && (w === 'spear' || w === 'hafted') ? 0.16 * out(p.blockT / 0.2) : 0;
    this.rollAngle = 0;
    gripHand(model, 'R', { shape: 'grip', radius: SHAFT[w]!.r });
    gripHand(model, 'L', r.f.l !== null ? { shape: 'grip', radius: SHAFT[w]!.r } : null);
    this.last.act = p.act; this.last.weapon = w;
    // these arms are the rig's: the character's own push of the arms out of its torso must not pull a hand off the
    // weapon (Limbs.ownArms, the character agent's opt-out; ignored by a build without it). late() re-solves them on
    // the bones as posed, against this frame's shoulders.
    (r.limbs as Limbs & { ownArms?: 'L' | 'R' | 'both' }).ownArms = 'both';
    return r.limbs;
  }

  /** The body's shapes for this frame (view/melee.ts): scaled by the arm length (the frames are for a 1.75 m man),
   * fitted to this model's skin, sitting on its bones as last posed (hips, chest, head). */
  private shapes(model: Character, B: { a: number; b: number }) {
    if (this.fitFor !== model) { this.fitFor = model; this.fit = measureBody(model); }
    setBodyFit(this.fit);
    const K = (B.a + B.b) / 0.53; setBodyScale(K);
    const loc = (o: THREE.Object3D) => model.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const hips = model.root.getObjectByName('hips'), chest = model.root.getObjectByName('chest');
    const ch = chest ? loc(chest) : new THREE.Vector3(), hp = hips ? loc(hips) : new THREE.Vector3(), hd = loc(model.head);
    // each part turned as the body really is this frame: the chest and head by the line between the shoulders (the
    // twist, a side-on stance), the hips by the line between the hips (left minus right is +x when facing ahead)
    const yawOf = (l: string, r: string) => {
      const a = model.root.getObjectByName(l), b = model.root.getObjectByName(r);
      if (!a || !b) return 0;
      const d = loc(a).sub(loc(b));
      return Math.atan2(-d.z, d.x);
    };
    const yc = yawOf('upperarmL', 'upperarmR'), yh = yawOf('upperlegL', 'upperlegR');
    { const a = model.root.getObjectByName('upperarmL'), c = model.root.getObjectByName('upperarmR'); if (a && c) capChestWidth(loc(a).distanceTo(loc(c)) / 2); }
    setBodyCentres([{ x: hp.x, z: hp.z, yaw: yh }, { x: ch.x, z: ch.z, yaw: yc }, { x: hd.x, z: hd.z, yaw: yc }]);
    this.yawNow = yc;
    return { K, ch };
  }

  // ---------------------------------------------------------------- what goes to the rig, eased
  private outL: Limbs = {}; private lastRig = false; private xfade = 1;
  /** Hands the pose to the rig. Switching between the melee rig and the authored poses (a roll, a stagger, the
   * fists) cross-fades over ~0.15 s; the authored poses are also low-passed (their own changes of state popped). */
  private emit(model: Character, pose: Limbs | null, dt: number, rig: boolean) {
    if (rig !== this.lastRig) { this.xfade = 0; this.lastRig = rig; }
    this.xfade = Math.min(1, this.xfade + dt / 0.15);
    if (!pose) { this.outL = {}; model.setLimbs(null); return; }
    if (!RIG_ON) { model.setLimbs(pose); return; }
    const k = rig && this.xfade >= 1 ? 1 : 1 - Math.exp(-dt / (this.xfade < 1 ? 0.06 : 0.035));
    const o: Limbs & { ownArms?: 'L' | 'R' | 'both' } = { bend: pose.bend, twist: pose.twist, openHands: pose.openHands, ownArms: (pose as { ownArms?: 'L' | 'R' | 'both' }).ownArms };
    for (const key of ['armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'] as const) {
      const t = pose[key], c = this.outL[key];
      if (!t) continue;
      if (!c || k >= 1) { o[key] = [t[0], t[1], t[2]]; continue; }
      const x = c[0] + (t[0] - c[0]) * k, y = c[1] + (t[1] - c[1]) * k, z = c[2] + (t[2] - c[2]) * k, l = Math.hypot(x, y, z) || 1;
      o[key] = [x / l, y / l, z / l];
    }
    const pb = this.outL.bend ?? 0, pt = this.outL.twist ?? 0;
    o.bend = pb + ((pose.bend ?? 0) - pb) * k; o.twist = pt + ((pose.twist ?? 0) - pt) * k;
    this.outL = o; model.setLimbs(o);
  }

  /** Give the body back to the walk and empty the hands. */
  /** After the body is posed this frame. */
  late(model: Character, dt: number, t: number) {
    this.ranged.late(model, dt, t);
    const id = this.heldId;
    if (!RIG_ON || !this.held || !id || !MELEE_GEAR.includes(id) || !this.bonesM) return;
    this.hdR = this.hdL = null;
    if (this.mframe && this.sol) { this.dropShoulder(model); this.fixArms(model); }
    const hw = model.handR.getWorldPosition(new THREE.Vector3()), lw = this.bonesM.loR.getWorldPosition(new THREE.Vector3());
    const hdR = this.hdR as THREE.Vector3 | null, fd = hdR ? hdR.clone() : hw.clone().sub(lw).normalize(), K = (this.bonesM.a + this.bonesM.b) / 0.53;
    const grip = hw.clone().addScaledVector(fd, 0.07 * K);
    // the weapon rides on the hand bone (so it can never slip off the hand, whatever the rig does after this), turned
    // so that it points along this frame's solved shaft (a roll or a stagger: along the forearm)
    const rq = model.root.getWorldQuaternion(new THREE.Quaternion()), hq = model.handR.getWorldQuaternion(new THREE.Quaternion());
    const dW = this.mframe ? this.cur.d.clone().applyQuaternion(rq).normalize() : fd;
    const want = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dW);
    this.held.quaternion.copy(hq.clone().invert().multiply(want));
    this.held.position.copy(model.handR.worldToLocal(grip.clone()));
    const ws = model.handR.getWorldScale(new THREE.Vector3()); this.held.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
    if (!this.mframe) return;
    // the numbers, on what is drawn this frame: the shaft from the real grip along this frame's solve, the right hand
    // against the grip the solve asked for, the left palm against the drawn shaft
    const F0 = this.cur, d0 = F0.d.clone().applyQuaternion(rq).normalize();
    const S = SHAFT[id]!, gl = model.root.worldToLocal(grip.clone()), q = new THREE.Vector3();
    let worst = 0;
    for (let k = -S.back; k <= S.front; k += 0.04) worst = Math.max(worst, depth(q.copy(gl).addScaledVector(F0.d, k), F0.bend, S.r));
    const st = this.stats; st.frames++; st.shaftIn = Math.max(st.shaftIn, worst);
    const off = this.xfade >= 1 && this.sol ? gl.distanceTo(this.sol.rt) : 0;
    if (off > st.handOff) { st.handOff = off; st.worst = `${this.last.act} g ${this.sol!.rt.toArray().map((x) => x.toFixed(2))} grip ${gl.toArray().map((x) => x.toFixed(2))}`; }
    if (!st.skel) { const s0 = model.root.worldToLocal(this.bonesM.upR.getWorldPosition(new THREE.Vector3())); st.skel = `sR ${s0.toArray().map((x) => x.toFixed(2))} a ${this.bonesM.a.toFixed(3)} b ${this.bonesM.b.toFixed(3)} fit ${JSON.stringify(this.fit?.map((f) => [+f.off.toFixed(3), +f.az.toFixed(3), f.ax ? +f.ax.toFixed(3) : null]))}`; }
    if (F0.l !== null && F0.hold >= 0.98 && this.xfade >= 1) {
      const hl = model.handL.getWorldPosition(new THREE.Vector3()), ll = this.bonesM.loL.getWorldPosition(new THREE.Vector3());
      const palm = hl.clone().addScaledVector((this.hdL as THREE.Vector3 | null)?.clone() ?? hl.clone().sub(ll).normalize(), 0.07 * K);
      const rel = palm.sub(grip), along = rel.dot(d0);
      const gap = rel.addScaledVector(d0, -along).length() + Math.max(0, -along, along - S.front);
      if (gap > st.leftOff) { st.leftOff = gap; st.worstL = `${this.last.act} l ${F0.l.toFixed(2)} along ${along.toFixed(2)}`; }
    }
    this.prevL = this.solvedL;
    void dt; void t;
  }
  /** The arms, solved again on the bones as the character posed them this frame (its clip, bend and turn moved the
   * shoulders since the solve), and set on the bones directly: the right hand lands on the grip, the left on the shaft
   * that is drawn this frame. The elbows keep the solve's way out of the body. Eased in over the rig's cross-fade. */
  private fixArms(model: Character) {
    const B = this.bonesM!, r = this.sol!, R = model.root, K = (B.a + B.b) / 0.53, palm = 0.07 * K;
    const wgt = this.xfade >= 1 ? 1 : smoothK(this.xfade);
    const W = (v: THREE.Vector3) => R.localToWorld(v.clone());
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    // the shaft as drawn this frame (world)
    const shaft = this.cur.d.clone().applyQuaternion(R.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const arm = (up: THREE.Object3D, lo: THREE.Object3D, hand: THREE.Object3D, tW: THREE.Vector3, eL: THREE.Vector3, sL: THREE.Vector3, onShaft: boolean) => {
      const s = wp(up), a = s.distanceTo(wp(lo)), b = wp(lo).distanceTo(wp(hand));
      const pole = W(eL).sub(W(sL)), e = new THREE.Vector3(), wr = new THREE.Vector3();
      reach2(s, tW, a, b + palm, pole, e, wr);
      // the wrist: a hand round a shaft lies across it, so the hand bends at the wrist from the forearm's line towards
      // square to the shaft (cocked back under a spear drawn to throw, turned up under a club carried low), at most
      // 26 degrees; the wrist is then solved to where that hand reaches the grip (the hand followed the forearm in a
      // straight line before: "stiff wrists")
      const fdir = wr.clone().sub(e).normalize();
      let hd = fdir.clone();
      if (onShaft) {
        hd.addScaledVector(shaft, -0.6 * fdir.dot(shaft)).normalize();
        const ang = fdir.angleTo(hd), MAX = 0.45;
        if (ang > MAX) hd = fdir.clone().lerp(hd, MAX / ang).normalize();
        hd = fdir.clone().lerp(hd, wgt).normalize();
      }
      const wristT = tW.clone().addScaledVector(hd, -palm);
      reach2(s, wristT, a, b, pole, e, wr);
      aimBone(up, lo, e, wgt);
      aimBone(lo, hand, wr, wgt);
      if (onShaft) {
        // turn the hand itself (in the rig it lies along the forearm): from the forearm's line to the flexed one
        const fd2 = wp(hand).sub(wp(lo)).normalize(), q = new THREE.Quaternion().setFromUnitVectors(fd2, hd);
        const hw0 = hand.getWorldQuaternion(new THREE.Quaternion()), pw = hand.parent!.getWorldQuaternion(new THREE.Quaternion());
        hand.quaternion.copy(pw.invert().multiply(q.multiply(hw0))); hand.updateWorldMatrix(false, true);
      }
      return onShaft ? hd : null;
    };
    const gT = W(r.rt);
    this.hdR = arm(B.upR, B.loR, model.handR, gT, r.eR, r.sR, true);
    if (!r.limbs.armL) return;
    // the left hand's mark moves with the grip as it really is (the drawn shaft starts there)
    const hw = wp(model.handR), grip = hw.clone().addScaledVector(this.hdR ?? hw.clone().sub(wp(B.loR)).normalize(), palm);
    const lT = W(r.lt).sub(W(r.f.g)).add(grip);
    this.hdL = arm(B.upL, B.loL, model.handL, lT, r.eL, r.sL, r.f.l !== null && r.f.hold > 0.5);
  }
  /** The throwing shoulder drops as the arm draws back (see meleePose): the chest rolls about the body's forward line,
   * the right side down, and the neck rolls back by as much so the head stays level. */
  private dropShoulder(model: Character) {
    if (this.dropK < 0.01) return;
    const ch = model.root.getObjectByName('chest'), nk = model.root.getObjectByName('neck') ?? model.head;
    if (!ch || !ch.parent) return;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(model.root.getWorldQuaternion(new THREE.Quaternion()));
    const roll = (o: THREE.Object3D, ang: number) => {
      const q = new THREE.Quaternion().setFromAxisAngle(fwd, ang), ow = o.getWorldQuaternion(new THREE.Quaternion()), pw = o.parent!.getWorldQuaternion(new THREE.Quaternion());
      o.quaternion.copy(pw.invert().multiply(q.multiply(ow))); o.updateWorldMatrix(false, true);
    };
    const A = 0.085 * this.dropK;
    roll(ch, A);
    if (nk && nk.parent && nk !== ch) roll(nk, -A);
  }
  release(model: Character) { this.ranged.hide(model); model.setLimbs(null); this.hold(model, null); this.mframe = false; this.outL = {}; gripHand(model, 'R', null); gripHand(model, 'L', null); this.rollAngle = 0; this.crouch = 0; this.ready = 0; }
}

/** The body's depth from its own skin and clothes at rest (the skinned meshes' bind pose), for the melee rig's
 * shapes: null when it cannot be read (the defaults then stand). */
function measureBody(model: Character): BodyFit[] | null {
  try {
    const meshes: THREE.SkinnedMesh[] = [];
    model.root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && /skin|cloth|body/i.test(m.name) && !/eye|lash|cornea|mouth/i.test(m.name)) meshes.push(m); });
    if (!meshes.length) return null;
    const sk = meshes[0].skeleton, inv = (n: string) => { const b = sk.bones.find((x) => x.name === n); if (!b) return null; return new THREE.Matrix4().copy(sk.boneInverses[sk.bones.indexOf(b)]).invert(); };
    const hip = inv('hips'), ch = inv('chest'), hd = inv('head'), up = inv('upperarmR'), lo = inv('lowerarmR'), ha = inv('handR');
    if (!hip || !ch || !hd || !up || !lo || !ha) return null;
    const P = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
    const k = (P(up).distanceTo(P(lo)) + P(lo).distanceTo(P(ha))) / 0.53;
    const pts: number[] = [], v = new THREE.Vector3();
    for (const m of meshes) {
      const pos = m.geometry.attributes.position, n = pos.count, step = n > 6000 ? 2 : 1;
      for (let i = 0; i < n; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix); pts.push(v.x, v.y, v.z); }
    }
    return fitBody(pts, [P(hip).z, P(ch).z, P(hd).z], k);
  } catch { return null; }
}

type GripShape = 'open' | 'relaxed' | 'grip' | 'pinch' | 'point';
/** Close a hand round what it holds (character.setGrip from the story's rig; absent on older builds). */
function gripHand(model: Character, side: 'L' | 'R', g: { shape: GripShape; radius?: number } | null) {
  (model as unknown as { setGrip?: (s: 'L' | 'R', g: { shape: GripShape; radius?: number } | null) => void }).setGrip?.(side, g);
}
