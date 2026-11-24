// The bow and the sling as people use them (MECHANICS_NOTES.md section 9). Both are drawn in the world at the real
// hands every frame, not hung off a hand bone: the bow's grip is where the left hand is, its string is pulled to
// where the right hand is, the sling's cords run from the right hand to a pouch that whirls, flies round and swings.
// The arms reach their marks with a two-bone solve (shoulder, elbow, wrist) and are handed to the rig as limb
// directions, so the walk keeps the legs and the clip keeps the rest.
import * as THREE from 'three';
import type { Character, Limbs, Dir } from '../../characters/character';
import type { SimPlayer } from '../sim/sim';
import { swingOut, reach2, aimBone, depth, bodyYaw } from './melee';
import type { ArmMem } from './melee';

const V = () => new THREE.Vector3();
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const smooth = (k: number) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const out3 = (k: number) => 1 - (1 - clamp01(k)) ** 3;
const UP = new THREE.Vector3(0, 1, 0);

/** Two-bone reach: the elbow that puts the wrist at `t` from shoulder `s`, bending towards `pole`. Root-local. */
export function reach(s: THREE.Vector3, t: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, elbow: THREE.Vector3, wrist: THREE.Vector3) {
  const d = V().subVectors(t, s); let len = d.length();
  const maxL = (a + b) * 0.995, minL = Math.abs(a - b) + 0.01;
  len = Math.min(maxL, Math.max(minL, len || minL));
  d.normalize();
  wrist.copy(s).addScaledVector(d, len);
  const x = (a * a - b * b + len * len) / (2 * len), h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = pole.clone().addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-6) p.set(0, -1, 0).addScaledVector(d, d.y);
  p.normalize();
  elbow.copy(s).addScaledVector(d, x).addScaledVector(p, h);
}

interface Rig { upL: THREE.Object3D; upR: THREE.Object3D; loL: THREE.Object3D; loR: THREE.Object3D; hL: THREE.Object3D; hR: THREE.Object3D; a: number; b: number }

export class RangedRig {
  group = new THREE.Group();
  private rig: Rig | null = null;
  // bow: riser and two limbs of four pieces, the string in two, the arrow (shaft, head, fletching)
  private bowSeg: THREE.Mesh[] = []; private str: THREE.Mesh[] = []; private arrow = new THREE.Group(); private quiver = new THREE.Group();
  // sling: two cords, the pouch, the stone in it, and the free end of the let-go cord
  private cords: THREE.Mesh[] = []; private pouch: THREE.Mesh; private stone: THREE.Mesh; private disc: THREE.Mesh;
  private pP = V(); private pPrev = V(); private tail = V(); private tailPrev = V(); private pouchInit = false;
  // where the hands are asked to be this frame (world), and what the gear does
  mode: 'none' | 'bow' | 'sling' | 'atlatl' = 'none';
  private st = { draw: 0, up: 0, lift: 0, rel: 9, relDraw: 0, nock: -1, arrowIn: 'string' as 'string' | 'hand' | 'none', tremor: 0, roll: 0, vib: 0, phase: 0, throwT: -1, reload: -1, hold: 'left' as 'left' | 'free' | 'whirl' | 'throw' };
  /** Which way to turn the body from the aim (radians): side-on for the bow. */
  faceOffset = 0;
  private aimL = V(); private D = V(); private Uw = V();
  private lastAct = 'idle'; private whirlK = 0; private whirlPole = V();

  constructor() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 });
    const gut = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.6 });
    // (pale plant fibre, thick enough to read at play distance: the darker, thinner cords of v1 vanished against grass)
    const fibre = new THREE.MeshStandardMaterial({ color: 0xcdb98e, roughness: 0.9 });
    const stoneM = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9, flatShading: true });
    const cyl = (r: number, m: THREE.Material) => { const g = new THREE.CylinderGeometry(r, r, 1, 6); g.translate(0, 0.5, 0); const o = new THREE.Mesh(g, m); o.castShadow = true; o.frustumCulled = false; this.group.add(o); return o; };
    for (let i = 0; i < 9; i++) this.bowSeg.push(cyl(i === 4 ? 0.02 : 0.013, wood));
    for (let i = 0; i < 2; i++) this.str.push(cyl(0.006, gut));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.72, 5).rotateX(Math.PI / 2).translate(0, 0, 0.36), wood);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 4).rotateX(Math.PI / 2).translate(0, 0, 0.74), stoneM);
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.1).translate(0, 0, 0.07), new THREE.MeshStandardMaterial({ color: 0x6b6f5a, roughness: 1 }));
    this.arrow.add(shaft, head, fl); this.group.add(this.arrow);
    // a bark quiver at the right hip with a few shafts showing
    const qv = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.5, 7).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }));
    this.quiver.add(qv);
    for (let i = 0; i < 3; i++) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4).translate(0, 0.6, 0), wood); a.position.set((i - 1) * 0.015, 0, (i % 2) * 0.012); this.quiver.add(a); }
    for (let i = 0; i < 2; i++) this.cords.push(cyl(0.013, fibre));
    this.pouch = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 0.55, 1.3), new THREE.MeshStandardMaterial({ color: 0x9a7a55, roughness: 1, side: THREE.DoubleSide }));
    // the whirl as the eye keeps it: a faint disc where the pouch goes round, stronger as it speeds up
    this.disc = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.62, 32, 1), new THREE.MeshBasicMaterial({ color: 0xd8c7a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.disc.rotation.x = -Math.PI / 2; this.disc.frustumCulled = false; this.group.add(this.disc);
    this.pouch.castShadow = true; this.group.add(this.pouch);
    this.stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.032, 0), stoneM); this.stone.castShadow = true; this.group.add(this.stone);
    this.group.visible = false;
  }

  private bones(model: Character): Rig | null {
    if (this.rig) return this.rig;
    const g = (n: string) => model.root.getObjectByName(n);
    const upL = g('upperarmL'), upR = g('upperarmR'), loL = g('lowerarmL'), loR = g('lowerarmR'), hL = g('handL'), hR = g('handR');
    if (!upL || !upR || !loL || !loR || !hL || !hR) return null;
    const w = (o: THREE.Object3D) => o.getWorldPosition(V());
    const a = w(upR).distanceTo(w(loR)), b = w(loR).distanceTo(w(hR));
    if (!(a > 0.1 && b > 0.1)) return null;
    this.rig = { upL, upR, loL, loR, hL, hR, a, b };
    return this.rig;
  }
  private local(model: Character, o: THREE.Object3D) { return model.root.worldToLocal(o.getWorldPosition(V())); }
  private dirLocal(model: Character, w: THREE.Vector3) { const q = model.root.getWorldQuaternion(new THREE.Quaternion()).invert(); return w.clone().applyQuaternion(q).normalize(); }

  /**
   * The arms for this frame (root-local limb directions) from what the simulation says the hands are doing. `aimW` is
   * where the shot goes (world, unit). Returns null when this weapon is not up.
   */
  pose(model: Character, p: SimPlayer, dt: number, t: number, up: boolean, aimW: THREE.Vector3, ammo: number, since: number): Limbs | null {
    const w = p.weapon;
    const was = this.mode;
    this.mode = w === 'bow' ? 'bow' : w === 'sling' ? 'sling' : w === 'atlatl' ? 'atlatl' : 'none';
    // (a new ranged weapon comes up from down: each turns the body its own way, and the bow came up "up" from the sling)
    if (this.mode !== was) this.lower();
    if (this.mode === 'none') { this.group.visible = false; this.faceOffset = 0; return null; }
    const R = this.bones(model);
    this.group.visible = true;
    if (!this.group.parent && model.root.parent) model.root.parent.add(this.group);
    if (!R) return null;
    const S = this.st;
    const aim = this.aimL.copy(this.dirLocal(model, aimW));
    // the arms pose to the aim as far as the body has turned to it: the body turns into a shot at its own rate (side-on
    // for the bow), so for a few frames after a raise or a swing of the view the aim can lie off to the other side, and
    // the bow arm (or the spear-thrower's pointing hand) reached across the chest after it (CI: 5.9 and 4.3 cm). Kept
    // within 0.7 rad of where the turned body points it; the shot itself goes where it is aimed.
    {
      const az0 = -this.faceOffset, h = Math.hypot(aim.x, aim.z) || 1, az = Math.atan2(aim.x, aim.z);
      const dz = Math.atan2(Math.sin(az - az0), Math.cos(az - az0)), lim = 0.7;
      if (Math.abs(dz) > lim) { const a2 = az0 + Math.sign(dz) * lim; aim.x = Math.sin(a2) * h; aim.z = Math.cos(a2) * h; }
    }
    const sL = this.local(model, R.upL), sR = this.local(model, R.upR), head = this.local(model, model.head);
    const eL = V(), wL = V(), eR = V(), wR = V();
    const fresh = p.act !== this.lastAct; this.lastAct = p.act;
    const recovering = p.act === 'recover' && p.combo === 9;
    let limbs: Limbs = {};
    if (this.mode === 'bow') {
      // raised while aiming, drawing, or straight after a shot
      const wantUp = up || p.act === 'charge' || recovering ? 1 : 0;
      S.up += (wantUp - S.up) * (1 - Math.exp(-dt * (wantUp ? 7 : 4)));
      const drawing = p.act === 'charge' ? out3(p.charge) : 0;
      if (p.act === 'charge') S.draw = drawing;
      else if (S.draw > 0 && since < 0.05) { S.relDraw = S.draw; S.rel = 0; S.draw = 0; S.vib = 1; S.roll = 1; }
      else S.draw = Math.max(0, S.draw - dt * 3);
      S.rel += dt; S.vib *= Math.exp(-dt * 14); S.roll = Math.max(0, S.roll - dt * 1.6);
      S.tremor = p.act === 'charge' && p.charge >= 1 ? Math.min(1, Math.max(0, (p.holdT - 1.2) * 0.5)) : 0;
      this.faceOffset = -1.3 * smooth(S.up);
      // the bow arm: out along the aim at full raise, low and forward when lowered
      // (out along the aim and a little forward: this rig's shoulder joints sit near the back, ~15 cm behind the face, so
      // a bow arm straight along the aim held the bow behind the line of the arrow from the jaw; measured in the probe)
      // F: the way the chest faces, square to the arrow (the part of the body's forward that is not along the aim). It was
      // A x up flipped to the front, which is sideways when the aim lies along the body's forward (the first frames of
      // the bow after another weapon, before the body has turned): F pointed to his right and the lowered bow arm
      // reached across the chest (CI on 760e0b1: 9.8 cm). Now it tends to the body's forward as the aim does.
      // (square to the aim only as far as the aim lies to the side: with the aim still along the body's forward, the
      // first frames of a raise and a draw clicked together, the square was his right and the lowered bow arm reached
      // straight across the chest, CI on life-wip 1.8 and 3.8 cm at charge, up 0.65 to 0.75)
      const A = V().set(aim.x, 0, aim.z).normalize(), F = V().set(0, 0, 1).addScaledVector(A, -A.z);
      const sideK = Math.min(1, Math.abs(A.x) * 1.15);
      F.multiplyScalar(sideK).add(V().set(0, 0, 1 - sideK));
      F.z += Math.max(0, 0.35 - F.length()); F.normalize();
      const low = V().set(aim.x * 0.6, -0.75, aim.z * 0.6).normalize();
      // Between shots the bow is held low and canted out in front, the string hand on the string at the nock (an
      // archer's ready position); the click raises and draws together, so the whole draw, from the nock to the chin,
      // is seen. (A set held near the chin between shots stood him in a "T" from behind, both arms out flat, and left a
      // draw of a few centimetres: owner, GPU review.)
      const kr = p.actT / 1.05;
      const liftW = p.act === 'charge' ? smooth(Math.min(1, drawing * 1.25)) : recovering ? 1 - smooth((kr - 0.12) / 0.3) : 0;
      S.lift += (liftW - S.lift) * (1 - Math.exp(-dt * 16));
      const raised = V().copy(aim).addScaledVector(F, 0.3).normalize();
      // (out in front of the belly, not off to the left: with the bow low along the aim the hand reached 33 cm across a
      // nock 11 cm in front of him, probe 14.5 cm into the body)
      const ready = V().copy(A).multiplyScalar(0.45).addScaledVector(F, 0.8).add(V().set(0, -0.6, 0)).normalize();
      const armDir = V().copy(low).lerp(V().copy(ready).lerp(raised, S.lift).normalize(), smooth(S.up)).normalize();
      if (S.tremor > 0) armDir.x += Math.sin(t * 23) * 0.006 * S.tremor, armDir.y += Math.sin(t * 17 + 1) * 0.008 * S.tremor;
      // (the elbow's pole out to the left as well as down: down and back only, the elbow came in by the ribs while the bow came
      // up from low on a body still turning, CI 4.2 cm)
      reach(sL, V().copy(sL).addScaledVector(armDir, (R.a + R.b) * 0.97), R.a, R.b, V().set(0.6, -1, 0).addScaledVector(aim, -0.3), eL, wL);
      // the string hand: on the string at brace height, back to the anchor under the jaw as it draws, past the ear on
      // the loose, then down to the quiver for the next arrow and back
      const grip = V().copy(wL).addScaledVector(armDir, 0.07);
      // The anchor as archers take it: the string hand against the side of the jaw, the arrow under the cheek. With the
      // head turned to the target the right cheek faces the way the chest faces (F), so the hand sits a cheek's depth
      // out along F, not ahead of the face along the aim (that pushed it 20 cm out in front of the face and the folded
      // elbow came up in front of the neck: CI 9-11 cm in the head shape). From there the forearm runs back along the
      // arrow and the elbow ends behind the head along the arrow's line, at the side, a little above the shoulder.
      // (under the chin, the string to the chin and nose: higher, at the jaw's side, the forearm behind the hand ran into the
      // jaw; offline sweep of the probe's frame: under the chin the elbow clears, 22 cm behind the head along the arrow)
      const anchor = V().copy(head).addScaledVector(F, 0.12).addScaledVector(A, 0.01).add(V().set(0, -0.115, 0));
      const nock0 = V().copy(grip).addScaledVector(aim, -0.15).add(V().set(0, 0.012, 0));
      const quiver = V().set(-0.2, 0.92, -0.1);
      // between shots: on the string at the nock of the lowered bow (no set: held at 88% of the draw near the chin it
      // read as a "T" from behind and the draw was a few centimetres; the arm to a string at the RAISED bow crossed the
      // upper chest on this rig, so the bow rises with the draw instead and the hand is near the chin by full raise)
      // (the hand goes from its rest by the hip to the nock as the bow comes up: it jumped there at up 0.5, before the
      // bow and the body's turn had come round, and the arm crossed the chest, CI 11 cm)
      const setP = V().set(-0.22, 1.0, 0.12).lerp(V().copy(nock0).addScaledVector(F, 0.02), smooth((S.up - 0.35) / 0.55));
      let target: THREE.Vector3; S.arrowIn = ammo > 0 ? 'string' : 'none'; S.nock = -1;
      // (the string comes back along the arrow, bowed a little out in front on the way so the forearm passes the chin)
      if (p.act === 'charge') target = V().copy(setP).lerp(anchor, drawing).addScaledVector(F, 0.1 * Math.sin(Math.PI * drawing));
      else if (recovering) {
        const k = p.actT / 1.05; S.nock = k;
        const past = V().copy(anchor).addScaledVector(aim, -0.17).add(V().set(0, 0.03, 0));
        if (k < 0.25) { target = V().copy(anchor).lerp(past, out3(k / 0.12)); S.arrowIn = 'none'; }
        // (to the quiver at the hip and back to the string round the front of the body, not straight across the chest:
        // the probe had the arm through it, 14.7 cm, on the way back up)
        else if (k < 0.55) { const u = smooth((k - 0.25) / 0.3); target = V().copy(past).lerp(quiver, u).addScaledVector(F, 0.12 * Math.sin(Math.PI * u)); S.arrowIn = k > 0.5 && ammo > 0 ? 'hand' : 'none'; }
        else if (k < 0.85) { const u = smooth((k - 0.55) / 0.3); target = V().copy(quiver).lerp(setP, u).addScaledVector(F, 0.3 * Math.sin(Math.PI * u)).addScaledVector(A, -0.14 * Math.sin(Math.PI * u)); S.arrowIn = ammo > 0 ? 'hand' : 'none'; }
        else target = setP;
      } else target = setP;
      // the drawing elbow: out in front at the brace, then back along the arrow's line as the string comes to the jaw
      // (a little up and a little behind the back, as a drawing elbow is in real form); past the head, not up into it
      const dk0 = p.act === 'charge' ? drawing : recovering ? Math.max(0, 1 - p.actT / 0.4) : 0;
      // (at the set the elbow is most of the way back already; down by the quiver it is not)
      // (at the nock between shots the elbow is out in front and down; it goes back along the arrow with the draw)
      const dk = dk0 * (S.up > 0.5 || p.act === 'charge' || recovering ? 1 : 0);
      // (at the brace the hand reaches across the chest to the string: an elbow sent down fell into the chest, CI 14 cm;
      // it goes out in front of the chest, at about shoulder height, as an archer's does when he takes the string)
      const pole = V().copy(A).multiplyScalar(-(0.25 + 0.75 * dk)).addScaledVector(F, 0.7 * (1 - dk) - 0.15 * dk).addScaledVector(UP, -0.35 * (1 - dk) + 0.1 * dk);
      // lowered, the arm hangs: the elbow down and a little back
      pole.lerp(V().set(-0.3, -1, -0.35), 1 - smooth(Math.max(S.up, p.act === 'charge' || recovering ? 1 : 0)));
      // the hand's mark is kept out of the body by a forearm's thickness, except at the jaw, where the hand rests on the
      // head on purpose (only the arm above the hand is checked against the head)
      const tRaw = V().copy(target).addScaledVector(aim, -0.06), tE = this.ease(sR, tRaw.clone(), R);
      const tR = dk > 0 ? tE.lerp(this.reachClamp(sR, tRaw, R), smooth(dk)) : tE;
      reach(sR, tR, R.a, R.b, pole, eR, wR);
      this.clearArms(sL, eL, wL, sR, eR, wR, dt); this.keep(sL, eL, wL, sR, eR, wR);
      limbs = { armL: dirOf(eL, sL), foreL: dirOf(wL, eL), armR: dirOf(eR, sR), foreR: dirOf(wR, eR), twist: 0.15 * smooth(S.up) };
    } else if (this.mode === 'atlatl') {
      // the spear-thrower: held at the shoulder, the dart lying along it pointing at the target; drawn back with the
      // body turned; on the cast the arm drives forward and the thrower flips over the hand, flinging the dart
      // Posture from atlatl throwing guides (MECHANICS_NOTES section 11): side-on, the off foot to the target, the
      // thrower held palm up at head height beside the ear with the elbow bent and down, the dart level over the
      // shoulder; the off hand points the way in front of the chest (bent, not flung out); the turn is in the hips and
      // chest, so from behind the throwing hand is back, not out to the side.
      const wantUp = up || p.act === 'charge' || recovering ? 1 : 0;
      S.up += (wantUp - S.up) * (1 - Math.exp(-dt * 7));
      if (p.act === 'charge') S.draw = out3(p.charge); else if (S.draw > 0 && since < 0.05) { S.rel = 0; S.relDraw = S.draw; S.draw = 0; } else S.draw = Math.max(0, S.draw - dt * 4);
      S.rel += dt;
      const casting = p.act !== 'charge' && S.rel < 0.45, CAST = 0.16;
      // side-on while drawn, square again through the cast (the hips lead it)
      const side = p.act === 'charge' ? 0.35 + 0.4 * S.draw : casting ? 0.75 * (1 - out3(S.rel / 0.14)) : 0.35;
      this.faceOffset = -side * smooth(S.up);
      const flat = V().set(aim.x, 0, aim.z).normalize();
      const out = V().set(-1, 0, 0); // the right side, root-local
      // a hand's width out from the ear, so the dart lies over the shoulder and clears the head
      const ready = V().copy(sR).addScaledVector(flat, -0.04).addScaledVector(out, 0.1).add(V().set(0, 0.15, 0));
      const back = V().copy(sR).addScaledVector(flat, -0.26).addScaledVector(out, 0.13).add(V().set(0, 0.11, 0));
      const front = V().copy(sR).addScaledVector(flat, 0.48).addScaledVector(out, -0.06).add(V().set(0, 0.1, 0));
      let tR: THREE.Vector3;
      if (p.act === 'charge') tR = V().copy(ready).lerp(back, S.draw);
      else if (casting) {
        // the hand does not go straight: it comes up and over the shoulder in an arc and drives down to the front
        // (the overarm path of the guides), so the cast reads as a throw and not as an arm sliding forward
        if (S.rel < CAST) { const k = out3(S.rel / CAST), over = V().copy(sR).addScaledVector(flat, 0.12).addScaledVector(out, 0.04).add(V().set(0, 0.36, 0)); tR = V().copy(back).multiplyScalar((1 - k) * (1 - k)).addScaledVector(over, 2 * k * (1 - k)).addScaledVector(front, k * k); }
        else tR = V().copy(front).lerp(V().copy(sR).add(V().set(0.22, -0.5, 0.25)), smooth((S.rel - CAST) / (0.45 - CAST)));
      } else tR = S.up > 0.5 ? ready : V().set(-0.22, 0.95, 0.12);
      S.phase = p.act === 'charge' ? 0 : S.rel < CAST ? S.rel / CAST : S.rel < 0.45 ? 1 : 0;
      S.arrowIn = ammo > 0 && !(S.rel < 0.6 && S.rel >= 0) ? 'string' : S.rel >= 0.6 && ammo > 0 ? 'string' : 'none';
      // the elbow hangs down and a little out while the hand is by the head; forward on the cast
      reach(sR, tR, R.a, R.b, casting && S.rel < CAST ? V().set(-0.3, -0.8, 0.2) : V().set(-0.35, -0.9, -0.15), eR, wR);
      // the off hand: in front of the chest, forearm along the aim, upper arm down; it pulls in to the chest on the cast
      const pointAt = V().copy(sL).addScaledVector(aim, 0.36).add(V().set(-0.09, -0.13, 0));
      const tucked = V().copy(sL).add(V().set(-0.08, -0.3, 0.16));
      const lowL = V().copy(sL).add(V().set(0.04, -0.5, 0.1));
      const tL = casting ? V().copy(pointAt).lerp(tucked, out3(S.rel / 0.2)) : V().copy(lowL).lerp(pointAt, smooth(S.up));
      reach(sL, tL, R.a, R.b, V().set(0.35, -1, -0.2), eL, wL);
      const wind = p.act === 'charge' ? -0.25 - 0.4 * S.draw : casting && S.rel < 0.3 ? -0.65 + 1.1 * out3(S.rel / 0.15) : -0.25 * smooth(S.up);
      this.clearArms(sL, eL, wL, sR, eR, wR, dt); this.keep(sL, eL, wL, sR, eR, wR);
      limbs = { armR: dirOf(eR, sR), foreR: dirOf(wR, eR), armL: dirOf(eL, sL), foreL: dirOf(wL, eL), twist: wind };
      if (S.rel < 0.4 || p.act === 'charge') { limbs.legL = [0.06, -0.93, 0.36]; limbs.shinL = [0, -1, 0.05]; limbs.legR = [-0.06, -0.96, -0.24]; limbs.shinR = [0, -0.98, -0.2]; }
    } else {
      // the sling: the pouch rests in the left hand, whirls overhead while drawn, comes over on the throw
      this.faceOffset = 0;
      const whirl = p.act === 'charge';
      const Rt = V().subVectors(sR, sL).setY(0).normalize(), Fc = V().crossVectors(UP, Rt);
      if (whirl && fresh) S.phase = 0;
      if (recovering && fresh) S.throwT = 0;
      if (S.throwT >= 0) S.throwT += dt;
      if (!recovering) S.throwT = -1;
      // (the pouch held well out in front: at 0.32 the right hand on it sat inside the coat's front, the elbow in the chest)
      const rest = V().set(0.02, 1.02, 0.42);
      let tR: THREE.Vector3, tL = V().copy(rest).add(V().set(0.05, 0, 0));
      if (whirl) {
        const k = p.charge, speed = 2 * Math.PI * (1.1 + 1.6 * k); this.whirlK = k;
        S.phase += dt * speed * smooth(Math.min(1, p.actT / 0.25));
        // over the right shoulder by the chest's own right and front (the chest winds back for the whirl: in the root's
        // axes the circle sat over his head and the elbow in front of his face, probe 9.6 cm)
        const c = V().copy(sR).addScaledVector(Rt, 0.1).addScaledVector(Fc, 0.08).add(V().set(0, 0.3, 0));
        this.whirlPole.copy(Rt).add(V().set(0, 0.25, 0)).addScaledVector(Fc, -0.1);
        tR = V().copy(c).add(V().set(Math.cos(S.phase) * 0.09, 0, Math.sin(S.phase) * 0.09));
        tL = V().copy(sL).add(V().set(0.05, -0.25, 0.25)).addScaledVector(aim, 0.25);
        S.hold = 'whirl';
      } else if (S.throwT >= 0 && S.throwT < 0.5) {
        // over the shoulder and down across the body: the stone left at the top of the arc
        const k = S.throwT;
        const top = V().copy(sR).add(V().set(0, 0.5, -0.05)), front = V().copy(sR).addScaledVector(aim, 0.55).addScaledVector(Rt, 0.12).add(V().set(0, 0.12, 0)), across = V().set(0.14, 1.0, 0.46);
        tR = k < 0.14 ? V().copy(top).lerp(front, out3(k / 0.14)) : V().copy(front).lerp(across, smooth((k - 0.14) / 0.36));
        tL = V().copy(sL).addScaledVector(aim, 0.3).add(V().set(0.05, -0.15, 0));
        S.hold = k < 0.14 ? 'throw' : 'free';
      } else if (recovering) {
        // a stone from the bag at the left hip, into the pouch
        const k = clamp01((p.actT - 0.5) / 0.5);
        const bag = V().set(0.22, 0.95, -0.02);
        tL = k < 0.45 ? V().copy(rest).lerp(bag, smooth(k / 0.45)) : V().copy(bag).lerp(rest, smooth((k - 0.45) / 0.55));
        tR = V().copy(rest).add(V().set(-0.17, 0.08, 0));
        S.hold = k > 0.9 ? 'left' : 'free';
      } else {
        tR = up ? V().copy(rest).add(V().set(-0.17, 0.08, 0)) : V().set(-0.22, 0.95, 0.12);
        S.hold = up ? 'left' : 'free';
      }
      // (the right elbow out to the side by the ribs, not in front of them: CI 7.7 cm with the pouch at rest)
      reach(sR, this.ease(sR, tR, R), R.a, R.b, whirl ? this.whirlPole : V().set(-0.8, -0.45, -0.1), eR, wR);
      reach(sL, this.ease(sL, tL, R), R.a, R.b, V().set(0.6, -0.5, -0.2), eL, wL);
      const wind = whirl ? -0.45 * smooth(p.actT / 0.4) : S.throwT >= 0 && S.throwT < 0.5 ? -0.45 + 1.0 * out3(S.throwT / 0.2) : 0;
      this.clearArms(sL, eL, wL, sR, eR, wR, dt); this.keep(sL, eL, wL, sR, eR, wR);
      limbs = { armR: dirOf(eR, sR), foreR: dirOf(wR, eR), armL: dirOf(eL, sL), foreL: dirOf(wL, eL), twist: wind };
      // stepping into it: the off foot forward, only while standing
      if ((whirl && p.speed < 0.6) || (S.throwT >= 0 && S.throwT < 0.45)) { limbs.legL = [0.06, -0.93, 0.36]; limbs.shinL = [0, -1, 0.05]; limbs.legR = [-0.06, -0.96, -0.24]; limbs.shinR = [0, -0.98, -0.2]; }
    }
    // the hands close on what they hold: the bow's grip and the string (fingers hooked), the sling's cords (a loop
    // on the finger, the release cord pinched), the spear-thrower's handle
    if (this.mode === 'bow') {
      grip(model, 'L', { shape: 'grip', radius: 0.018, amount: smooth(S.up) });
      grip(model, 'R', S.rel < 0.3 ? { shape: 'open' } : S.arrowIn === 'hand' ? { shape: 'pinch', radius: 0.004 } : { shape: 'grip', radius: 0.002, amount: S.up > 0.5 ? 0.75 : 0.4 });
    } else if (this.mode === 'sling') {
      grip(model, 'R', S.hold === 'free' && S.throwT >= 0 && S.throwT < 0.5 ? { shape: 'relaxed' } : { shape: 'pinch', radius: 0.002 });
      grip(model, 'L', S.hold === 'left' || S.hold === 'whirl' ? { shape: 'grip', radius: 0.03, amount: S.hold === 'left' ? 0.8 : 0.2 } : { shape: 'relaxed' });
    } else if (this.mode === 'atlatl') {
      grip(model, 'R', { shape: 'grip', radius: 0.012 }); grip(model, 'L', { shape: 'point' });
    }
    // these arms are this rig's: the character's own push of the arms out of its torso is skipped (Limbs.ownArms)
    (limbs as Limbs & { ownArms?: 'both' }).ownArms = 'both';
    return limbs;
  }

  /** The arms kept out of the body the way the melee rig keeps them (view/melee.ts swingOut, the body's shapes as the
   * fight body set them this frame): each elbow swings round its shoulder-to-hand line, the hands stay on the gear. */
  private armMem: ArmMem = { L: 0, R: 0 };
  /** Worst depth of an arm in the body since the last read (metres), for the play test. */
  armIn = 0; armWhere = '';
  /** The same, of the solve itself (before the character posed the body): for debugging. */
  solveIn = 0; solveWhere = '';
  private clearArms(sL: THREE.Vector3, eL: THREE.Vector3, wL: THREE.Vector3, sR: THREE.Vector3, eR: THREE.Vector3, wR: THREE.Vector3, dt: number) {
    // (the hands' own end is left out: a bow's string hand anchors at the jaw and a sling's pouch rests against the
    // belly on purpose; the upper arm, the elbow and the forearm to its middle are what must not go in)
    const l = swingOut(sL, eL, wL, 0, this.armMem, 'L', dt, 0.6), r = swingOut(sR, eR, wR, 0, this.armMem, 'R', dt, 0.6);
    if (Math.max(l, r) > this.solveIn) { this.solveIn = Math.max(l, r); const f = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(2)).join(','); this.solveWhere = `${this.mode} ${l > r ? 'L' : 'R'} s ${f(l > r ? sL : sR)} e ${f(l > r ? eL : eR)} w ${f(l > r ? wL : wR)}`; }
  }

  /** A hand's mark as an arm can take it: out of the body's shapes by a forearm's thickness, and within an easy reach
   * of its shoulder (a string hand sent straight across the chest for a string past its reach drew a straight arm
   * through the chest: 9.7 cm in CI; a bent arm leaves the elbow room to swing out of the body). */
  private ease(s: THREE.Vector3, t: THREE.Vector3, R: Rig) {
    // (pushed out and pulled back in turn: a push out of the chest followed by one pull into reach could land the mark
    // back inside the chest, the sling's follow-through across the body: CI 2.3 cm)
    const n = V();
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < 2; i++) { const dp = depth(t, 0, 0.1, n); if (dp > 0) t.addScaledVector(n, dp + 0.01); }
      this.reachClamp(s, t, R);
    }
    return t;
  }
  private reachClamp(s: THREE.Vector3, t: THREE.Vector3, R: Rig) {
    const max = (R.a + R.b) * 0.88, d = V().subVectors(t, s), l = d.length();
    if (l > max) t.copy(s).addScaledVector(d, max / l);
    return t;
  }
  /** What this frame's solve asked for (root-local): shoulders, elbows, wrists. */
  private sol: { sL: THREE.Vector3; eL: THREE.Vector3; wL: THREE.Vector3; sR: THREE.Vector3; eR: THREE.Vector3; wR: THREE.Vector3 } | null = null;
  private keep(sL: THREE.Vector3, eL: THREE.Vector3, wL: THREE.Vector3, sR: THREE.Vector3, eR: THREE.Vector3, wR: THREE.Vector3) {
    this.sol = { sL: sL.clone(), eL: eL.clone(), wL: wL.clone(), sR: sR.clone(), eR: eR.clone(), wR: wR.clone() };
  }
  /**
   * The arms solved again on the bones as the character posed them this frame (its clip, bend and the chest's turn
   * moved the shoulders since pose() solved them; the melee rig does the same, body.ts fixArms): the wrists land
   * where the solve put them, the elbows keep its way out of the body. Then how deep the arms drawn this frame are in
   * the body's shapes (which turn with the chest), for the play test's gate.
   */
  private lateMem: ArmMem = { L: 0, R: 0 };
  /** How far each hand is moved out of the body this frame (fixArms, root space). */
  private lateOff = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private fixArms(model: Character, dt: number) {
    const R = this.rig!, s = this.sol!, root = model.root;
    const W = (v: THREE.Vector3) => root.localToWorld(v.clone()), wp = (o: THREE.Object3D) => o.getWorldPosition(V());
    const one = (up: THREE.Object3D, lo: THREE.Object3D, hand: THREE.Object3D, sh: THREE.Vector3, el: THREE.Vector3, wr: THREE.Vector3, k: 'L' | 'R') => {
      const s0 = wp(up), a = s0.distanceTo(wp(lo)), b = wp(lo).distanceTo(wp(hand)), e = V(), w = V();
      reach2(s0, W(wr), a, b, W(el).sub(W(sh)), e, w);
      // the elbow swung out of the body again round the shoulder-to-wrist line as the body really stands this frame
      // (the solve's shoulders are last frame's: the clip, the idle sway and the chest's turn move them, and the same
      // elbow way out could come back in by a few centimetres, CI 2.1 cm with the solve at 0.9)
      const sl = root.worldToLocal(s0.clone()), elL = root.worldToLocal(e.clone()), wlL = root.worldToLocal(w.clone());
      // (three times the solve's swing rate: a correction of a few centimetres, it lagged a frame or two behind a raise,
      // CI 1.4 cm on the forearm at up 0.65)
      const left = swingOut(sl, elL, wlL, 0, this.lateMem, k, dt * 3, 0.6);
      // Still in: the arm is near straight across the chest (a hand at the edge of its reach, the string hand going from
      // the nock to the hip as the bow comes down on a chest still turned: CI 5.5 and 4.6 cm, solve 6.1 and 5.9), and no
      // swing of the elbow clears it. The hand is moved out of the body the way the body's shapes point, a little in
      // towards the shoulder too, until the bent arm clears; at most 3.5 cm a 30th of a second, back again eased. For a
      // frame or two the hand is off the string, never through the body. (Only pulling it in towards the shoulder: CI 4.6.)
      const want = V();
      if (left > 0.012) {
        const pole = V().subVectors(elL, sl), e2 = V(), w2 = V(), q = V(), n = V(), nb = V(), tgt = V().copy(wlL);
        for (let it = 0; it < 6; it++) {
          reach2(sl, tgt, a, b, pole, e2, w2);
          let worst = 0;
          for (let i = 1; i <= 6; i++) {
            if (i <= 3) q.copy(sl).lerp(e2, 0.35 + i * 0.2); else q.copy(e2).lerp(w2, (i - 3) / 3 * 0.6);
            const d = depth(q, 0, 0.04, n); if (d > worst) { worst = d; nb.copy(n); }
          }
          if (worst <= 0.012) break;
          tgt.addScaledVector(nb, worst + 0.015).lerp(sl, 0.04);
        }
        want.subVectors(tgt, wlL);
      }
      const o = this.lateOff[k], dl = V().subVectors(want, o), step = 0.035 * Math.max(1, dt * 30);
      if (want.lengthSq() > o.lengthSq()) { if (dl.length() > step) dl.setLength(step); o.add(dl); } else o.lerp(want, 1 - Math.exp(-dt * 10));
      if (o.lengthSq() > 1e-8) {
        const tgt = V().copy(wlL).add(o); reach2(sl, tgt, a, b, V().subVectors(elL, sl), elL, wlL);
        w.copy(W(wlL));
      }
      e.copy(W(elL));
      aimBone(up, lo, e, 1); aimBone(lo, hand, w, 1);
    };
    one(R.upL, R.loL, R.hL, s.sL, s.eL, s.wL, 'L'); one(R.upR, R.loR, R.hR, s.sR, s.eR, s.wR, 'R');
    // measured on what is drawn: the upper arm past the shoulder's own ball and the forearm to its middle (the hand's
    // end is left out on purpose: a string hand anchors at the jaw, the sling's pouch rests against the belly)
    const loc = (o: THREE.Object3D) => root.worldToLocal(wp(o));
    let worst = 0, where = '';
    for (const [up, lo, hd, k] of [[R.upL, R.loL, R.hL, 'L'], [R.upR, R.loR, R.hR, 'R']] as const) {
      const a = loc(up), e = loc(lo), w = loc(hd), q = V();
      for (let i = 1; i <= 6; i++) {
        if (i <= 3) q.copy(a).lerp(e, 0.35 + i * 0.2); else q.copy(e).lerp(w, (i - 3) / 3 * 0.6);
        const d = depth(q, 0, 0.04);
        if (d > worst) { worst = d; const f = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(2)).join(','); where = `${this.mode} ${k} s ${f(a)} e ${f(e)} w ${f(w)} h ${f(loc(model.head))} sO ${f(loc(k === 'L' ? R.upR : R.upL))} aim ${f(this.aimL)} st ${this.lastAct} up ${this.st.up.toFixed(2)} draw ${this.st.draw.toFixed(2)} yaw ${bodyYaw().toFixed(2)} at ${i} (drawn)`; }
      }
    }
    if (worst > this.armIn) { this.armIn = worst; this.armWhere = where; }
  }

  /** After the body is posed: put the bow, string, arrow, cords and pouch where the hands really are. */
  late(model: Character, dt: number, t: number) {
    if (this.mode === 'none' || !this.rig) return;
    const R = this.rig, S = this.st;
    model.root.updateWorldMatrix(true, true);
    // (only for a frame that pose() solved: a roll or a stagger in between leaves the arms to the body)
    if (this.sol) { this.fixArms(model, dt); model.root.updateWorldMatrix(true, true); this.sol = null; }
    const hL = model.handL.localToWorld(V().set(0, -0.05, 0)), hR = model.handR.localToWorld(V().set(0, -0.06, 0));
    const rq = model.root.getWorldQuaternion(new THREE.Quaternion());
    const aim = V().copy(this.aimL).applyQuaternion(rq).normalize();
    const vis = (o: THREE.Object3D, v: boolean) => { o.visible = v; };
    this.bowSeg.forEach((o) => vis(o, this.mode === 'bow')); this.str.forEach((o) => vis(o, this.mode === 'bow'));
    if (this.trailMesh && this.mode !== 'atlatl') this.trailMesh.visible = false;
    vis(this.arrow, false); vis(this.disc, false); this.cords.forEach((o) => vis(o, this.mode === 'sling')); vis(this.pouch, this.mode === 'sling'); vis(this.stone, false);
    if (this.mode === 'atlatl') {
      this.quiver.visible = false;
      this.bowSeg.forEach((o, i) => vis(o, i === 0)); this.str.forEach((o) => vis(o, false));
      // the thrower runs back from the hand to the hook; on the cast it turns over the hand, hook forward
      const flat = V().set(aim.x, 0, aim.z).normalize();
      const flip = S.phase * Math.PI, dir = V().copy(flat).multiplyScalar(-Math.cos(flip)).add(V().set(0, Math.sin(flip), 0)).normalize();
      if (S.up < 0.5 && S.draw <= 0 && !(S.rel < 0.45)) dir.set(0, -1, 0).addScaledVector(flat, 0.3).normalize();
      const hook = V().copy(hR).addScaledVector(dir, 0.55);
      seg(this.bowSeg[0], V().copy(hR).addScaledVector(dir, -0.05), hook);
      this.smear(S.rel < 0.3 && S.relDraw > 0, hR, hook, dt);
      if (S.arrowIn === 'string' && S.phase === 0 && (S.up > 0.5 || S.draw > 0)) {
        // the dart's butt in the hook, its shaft over the hand, its point at the target
        this.arrow.visible = true; this.arrow.position.copy(hook).add(V().set(0, 0.03, 0)); this.arrow.scale.set(1.4, 1.4, 2.3);
        this.arrow.lookAt(V().copy(hook).addScaledVector(aim, 5).add(V().set(0, 0.1, 0)));
      }
    } else if (this.mode === 'bow') {
      this.arrow.scale.set(1, 1, 1);
      if (!this.quiver.parent) model.body.add(this.quiver);
      this.quiver.position.set(-0.17, -0.1, -0.06); this.quiver.rotation.set(-0.25, 0, -0.35); this.quiver.visible = true;
      // the bow: upright in the left hand, its face along the shot; tips forward a little after the loose
      const D = this.D.copy(aim); if (S.up < 0.5) D.lerp(V().set(D.x, -0.6, D.z), 1 - S.up * 2).normalize();
      const U = this.Uw.copy(UP).addScaledVector(D, -UP.dot(D)).normalize();
      const side = V().crossVectors(D, U);
      U.applyAxisAngle(D, 0.12).applyAxisAngle(side, -0.5 * Math.sin(Math.min(1, S.roll) * Math.PI) * 0.6);
      // (the set holds the string a little drawn: the limbs bend that much too)
      const draw = Math.max(S.draw, S.nock < 0 || S.nock > 0.85 ? 0.8 * clamp01(S.up * 2 - 1) : 0), brace = 0.15;
      const pt = (u: number) => { const s = Math.sign(u), a = Math.abs(u); return V().copy(hL).addScaledVector(U, s * (0.08 + 0.6 * a) * (1 - 0.05 * draw * a * a)).addScaledVector(D, -(brace * 0.7 + 0.14 * draw) * a * a); };
      const pts = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map(pt);
      pts[4] = V().copy(hL).addScaledVector(U, -0.08);
      for (let i = 0; i < 4; i++) seg(this.bowSeg[i], pts[i], pts[i + 1]);
      seg(this.bowSeg[4], V().copy(hL).addScaledVector(U, -0.09), V().copy(hL).addScaledVector(U, 0.09));
      for (let i = 4; i < 8; i++) seg(this.bowSeg[i + 1], i === 4 ? V().copy(hL).addScaledVector(U, 0.08) : pts[i], pts[i + 1]);
      const top = pts[8], bot = pts[0];
      const rest = V().addVectors(top, bot).multiplyScalar(0.5);
      // the nock point: in the string hand while it holds the string, straight between the tips once it lets go
      const holding = S.nock < 0 || S.nock > 0.85;
      let nock = holding && (draw > 0.02 || S.up > 0.5) ? V().copy(hR).addScaledVector(D, 0.03) : rest.clone();
      if (!holding || S.rel < 0.6) nock = rest.clone().addScaledVector(side, Math.sin(t * 90) * 0.012 * S.vib);
      seg(this.str[0], top, nock); seg(this.str[1], nock, bot);
      if (S.arrowIn === 'string') { this.arrow.visible = true; this.arrow.position.copy(nock); this.arrow.lookAt(V().copy(hL).addScaledVector(U, 0.03).addScaledVector(D, 0.3)); }
      else if (S.arrowIn === 'hand') { this.arrow.visible = true; this.arrow.position.copy(hR); this.arrow.lookAt(V().copy(hR).add(V().copy(D).add(UP).normalize())); }
    } else {
      this.quiver.visible = false;
      // the sling: the retention loop on the right hand; the pouch is placed while it is held or whirled or thrown,
      // and swings on its own once it is let go
      const L = 0.6;
      const prev = this.pP.clone();
      if (!this.pouchInit) { this.pP.copy(hR).add(V().set(0, -L, 0)); this.pPrev.copy(this.pP); this.tail.copy(this.pP); this.tailPrev.copy(this.tail); this.pouchInit = true; }
      if (S.hold === 'left') this.pP.copy(hL);
      else if (S.hold === 'whirl') {
        // a cone overhead: the pouch trails the hand by a little under a quarter turn, the outer side lower
        const a = S.phase - 1.2;
        this.pP.copy(hR).add(V().set(Math.cos(a) * L * 0.95, -0.22, Math.sin(a) * L * 0.95).applyQuaternion(rq));
      } else if (S.hold === 'throw') {
        // over the top and towards the target: the pouch swings through a vertical arc ahead of the hand
        const k = clamp01(S.throwT / 0.14), ang = -Math.PI * 0.85 + k * Math.PI * 0.95;
        const side = V().crossVectors(aim, UP).normalize();
        const back = V().copy(aim).multiplyScalar(-1);
        this.pP.copy(hR).addScaledVector(back, Math.cos(ang) * L).addScaledVector(UP, -Math.sin(ang) * L).addScaledVector(side, 0.05);
      } else {
        // free: a weight on a cord (Verlet), damped
        const vel = V().subVectors(this.pP, this.pPrev).multiplyScalar(0.985);
        this.pP.add(vel).add(V().set(0, -9.81 * dt * dt, 0));
        const d = V().subVectors(this.pP, hR); if (d.length() > L) this.pP.copy(hR).addScaledVector(d.normalize(), L);
      }
      this.pPrev.copy(S.hold === 'free' ? this.pPrev.lerp(prev, 1) : prev);
      // the let-go cord: tied to the pouch, its end in the hand until the throw lets it go
      if (S.hold === 'free') {
        const vel = V().subVectors(this.tail, this.tailPrev).multiplyScalar(0.97); this.tailPrev.copy(this.tail);
        this.tail.add(vel).add(V().set(0, -9.81 * dt * dt, 0));
        const d = V().subVectors(this.tail, this.pP); if (d.length() > L) this.tail.copy(this.pP).addScaledVector(d.normalize(), L);
      } else { this.tail.copy(hR).add(V().set(0.01, 0, 0)); this.tailPrev.copy(this.tail); }
      seg(this.cords[0], hR, this.pP); seg(this.cords[1], this.tail, this.pP);
      // the disc: centred on the hand, tilted as the cone is (the pouch 0.22 below the hand at 0.95 of the cord)
      const dm = this.disc.material as THREE.MeshBasicMaterial;
      // (faint: at 0.26 it read as a solid plate over his head in v2)
      const want = S.hold === 'whirl' ? 0.04 + 0.07 * clamp01(this.whirlK) : 0;
      dm.opacity += (want - dm.opacity) * (1 - Math.exp(-dt * 10));
      this.disc.visible = dm.opacity > 0.01;
      if (this.disc.visible) { this.disc.position.copy(hR).add(V().set(0, -0.11, 0)); this.disc.quaternion.copy(rq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))); }
      this.pouch.position.copy(this.pP); this.pouch.lookAt(hR);
      this.stone.visible = S.hold !== 'free';
      this.stone.position.copy(this.pP);
    }
    void R;
  }
  // the swept arc of the thrower through the cast: what the eye keeps of a fast arm (motion blur), a pale band from
  // the hand to the hook over the last fifth of a second, fading with age
  private trail: { a: THREE.Vector3; b: THREE.Vector3; age: number }[] = [];
  private trailMesh: THREE.Mesh | null = null;
  private smear(on: boolean, hand: THREE.Vector3, hook: THREE.Vector3, dt: number) {
    const N = 14;
    if (!this.trailMesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 4), 4));
      const idx: number[] = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
      this.trailMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      this.trailMesh.frustumCulled = false; this.group.add(this.trailMesh);
    }
    for (const q of this.trail) q.age += dt;
    if (on) this.trail.unshift({ a: hand.clone().lerp(hook, 0.7), b: hook.clone(), age: 0 });
    this.trail = this.trail.filter((q) => q.age < 0.18).slice(0, N);
    const m = this.trailMesh, n = this.trail.length;
    m.visible = n > 2;
    if (!m.visible) return;
    const P = m.geometry.attributes.position as THREE.BufferAttribute, C = m.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      const q = this.trail[Math.min(i, n - 1)], k = i < n ? (1 - q.age / 0.18) * (1 - i / N) : 0;
      P.setXYZ(i * 2, q.a.x, q.a.y, q.a.z); P.setXYZ(i * 2 + 1, q.b.x, q.b.y, q.b.z);
      C.setXYZW(i * 2, 0.45, 0.35, 0.24, k * 0.05); C.setXYZW(i * 2 + 1, 0.5, 0.4, 0.28, k * 0.22);
    }
    P.needsUpdate = true; C.needsUpdate = true;
  }
  /** Taken off: nothing left in the world. */
  /** Down at once (the body has stopped turning into the shot). */
  lower() { this.st.up = 0; this.st.lift = 0; this.st.draw = 0; }
  hide(model?: Character) { this.sol = null; if (model) { grip(model, 'L', null); grip(model, 'R', null); } this.group.visible = false; this.quiver.visible = false; this.mode = 'none'; this.faceOffset = 0; this.pouchInit = false; this.lower(); }
}

type GripShape = 'open' | 'relaxed' | 'grip' | 'pinch' | 'point';
/** Close a hand round what it holds (character.setGrip, from the story's rig; absent on older builds). */
function grip(model: Character, side: 'L' | 'R', g: { shape: GripShape; radius?: number; amount?: number } | null) {
  const m = model as unknown as { setGrip?: (s: 'L' | 'R' | 'both', g: { shape: GripShape; radius?: number; amount?: number } | null) => void };
  m.setGrip?.(side, g);
}

function dirOf(a: THREE.Vector3, b: THREE.Vector3): Dir { const d = V().subVectors(a, b).normalize(); return [d.x, d.y, d.z]; }
const Y = new THREE.Vector3(0, 1, 0);
/** A unit cylinder (base at 0, up +y) stretched from a to b. */
function seg(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = V().subVectors(b, a), l = d.length();
  o.position.copy(a);
  o.quaternion.setFromUnitVectors(Y, l > 1e-6 ? d.divideScalar(l) : Y);
  o.scale.set(1, Math.max(1e-4, l), 1);
}
