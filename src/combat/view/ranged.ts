// The bow and the sling as people use them (MECHANICS_NOTES.md section 9). Both are drawn in the world at the real
// hands every frame, not hung off a hand bone: the bow's grip is where the left hand is, its string is pulled to
// where the right hand is, the sling's cords run from the right hand to a pouch that whirls, flies round and swings.
// The arms reach their marks with a two-bone solve (shoulder, elbow, wrist) and are handed to the rig as limb
// directions, so the walk keeps the legs and the clip keeps the rest.
import * as THREE from 'three';
import type { Character, Limbs, Dir } from '../../characters/character';
import type { SimPlayer } from '../sim/sim';

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
  private cords: THREE.Mesh[] = []; private pouch: THREE.Mesh; private stone: THREE.Mesh;
  private pP = V(); private pPrev = V(); private tail = V(); private tailPrev = V(); private pouchInit = false;
  // where the hands are asked to be this frame (world), and what the gear does
  mode: 'none' | 'bow' | 'sling' | 'atlatl' = 'none';
  private st = { draw: 0, up: 0, rel: 9, relDraw: 0, nock: -1, arrowIn: 'string' as 'string' | 'hand' | 'none', tremor: 0, roll: 0, vib: 0, phase: 0, throwT: -1, reload: -1, hold: 'left' as 'left' | 'free' | 'whirl' | 'throw' };
  /** Which way to turn the body from the aim (radians): side-on for the bow. */
  faceOffset = 0;
  private aimL = V(); private D = V(); private Uw = V();
  private lastAct = 'idle';

  constructor() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 });
    const gut = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.6 });
    const fibre = new THREE.MeshStandardMaterial({ color: 0x8d7a55, roughness: 0.95 });
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
    for (let i = 0; i < 2; i++) this.cords.push(cyl(0.009, fibre));
    this.pouch = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 0.55, 1.3), new THREE.MeshStandardMaterial({ color: 0x6e5a44, roughness: 1, side: THREE.DoubleSide }));
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
    this.mode = w === 'bow' ? 'bow' : w === 'sling' ? 'sling' : w === 'atlatl' ? 'atlatl' : 'none';
    if (this.mode === 'none') { this.group.visible = false; this.faceOffset = 0; return null; }
    const R = this.bones(model);
    this.group.visible = true;
    if (!this.group.parent && model.root.parent) model.root.parent.add(this.group);
    if (!R) return null;
    const S = this.st;
    const aim = this.aimL.copy(this.dirLocal(model, aimW));
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
      const low = V().set(aim.x * 0.6, -0.75, aim.z * 0.6).normalize();
      const armDir = V().copy(low).lerp(aim, smooth(S.up)).normalize();
      if (S.tremor > 0) armDir.x += Math.sin(t * 23) * 0.006 * S.tremor, armDir.y += Math.sin(t * 17 + 1) * 0.008 * S.tremor;
      reach(sL, V().copy(sL).addScaledVector(armDir, (R.a + R.b) * 0.97), R.a, R.b, V().set(0, -1, 0).addScaledVector(aim, -0.3), eL, wL);
      // the string hand: on the string at brace height, back to the anchor under the jaw as it draws, past the ear on
      // the loose, then down to the quiver for the next arrow and back
      const grip = V().copy(wL).addScaledVector(armDir, 0.07);
      const anchor = V().copy(head).addScaledVector(aim, 0.13).add(V().set(0, -0.13, 0));
      const nock0 = V().copy(grip).addScaledVector(aim, -0.15).add(V().set(0, 0.012, 0));
      const quiver = V().set(-0.2, 0.92, -0.1);
      let target: THREE.Vector3; S.arrowIn = ammo > 0 ? 'string' : 'none'; S.nock = -1;
      if (p.act === 'charge') target = V().copy(nock0).lerp(anchor, drawing);
      else if (recovering) {
        const k = p.actT / 1.05; S.nock = k;
        const past = V().copy(anchor).addScaledVector(aim, -0.17).add(V().set(0, 0.03, 0));
        if (k < 0.25) { target = V().copy(anchor).lerp(past, out3(k / 0.12)); S.arrowIn = 'none'; }
        else if (k < 0.55) { target = V().copy(past).lerp(quiver, smooth((k - 0.25) / 0.3)); S.arrowIn = k > 0.5 && ammo > 0 ? 'hand' : 'none'; }
        else if (k < 0.85) { target = V().copy(quiver).lerp(nock0, smooth((k - 0.55) / 0.3)); S.arrowIn = ammo > 0 ? 'hand' : 'none'; }
        else target = nock0;
      } else target = S.up > 0.5 ? nock0 : V().set(-0.22, 1.0, 0.12);
      const pole = V().copy(aim).multiplyScalar(-1).add(V().set(0, 0.55, 0));
      reach(sR, V().copy(target).addScaledVector(aim, -0.06), R.a, R.b, pole, eR, wR);
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
      limbs = { armR: dirOf(eR, sR), foreR: dirOf(wR, eR), armL: dirOf(eL, sL), foreL: dirOf(wL, eL), twist: wind };
      if (S.rel < 0.4 || p.act === 'charge') { limbs.legL = [0.06, -0.93, 0.36]; limbs.shinL = [0, -1, 0.05]; limbs.legR = [-0.06, -0.96, -0.24]; limbs.shinR = [0, -0.98, -0.2]; }
    } else {
      // the sling: the pouch rests in the left hand, whirls overhead while drawn, comes over on the throw
      this.faceOffset = 0;
      const whirl = p.act === 'charge';
      if (whirl && fresh) S.phase = 0;
      if (recovering && fresh) S.throwT = 0;
      if (S.throwT >= 0) S.throwT += dt;
      if (!recovering) S.throwT = -1;
      const rest = V().set(0.02, 1.02, 0.32);
      let tR: THREE.Vector3, tL = V().copy(rest).add(V().set(0.05, 0, 0));
      if (whirl) {
        const k = p.charge, speed = 2 * Math.PI * (1.1 + 1.6 * k);
        S.phase += dt * speed * smooth(Math.min(1, p.actT / 0.25));
        const c = V().copy(sR).add(V().set(0.08, 0.3, 0.12));
        tR = V().copy(c).add(V().set(Math.cos(S.phase) * 0.09, 0, Math.sin(S.phase) * 0.09));
        tL = V().copy(sL).add(V().set(0.05, -0.25, 0.25)).addScaledVector(aim, 0.25);
        S.hold = 'whirl';
      } else if (S.throwT >= 0 && S.throwT < 0.5) {
        // over the shoulder and down across the body: the stone left at the top of the arc
        const k = S.throwT;
        const top = V().copy(sR).add(V().set(0, 0.5, -0.05)), front = V().copy(sR).addScaledVector(aim, 0.55).add(V().set(0, 0.15, 0)), across = V().set(0.2, 0.95, 0.3);
        tR = k < 0.14 ? V().copy(top).lerp(front, out3(k / 0.14)) : V().copy(front).lerp(across, smooth((k - 0.14) / 0.36));
        tL = V().copy(sL).addScaledVector(aim, 0.3).add(V().set(0.05, -0.15, 0));
        S.hold = k < 0.14 ? 'throw' : 'free';
      } else if (recovering) {
        // a stone from the bag at the left hip, into the pouch
        const k = clamp01((p.actT - 0.5) / 0.5);
        const bag = V().set(0.22, 0.95, -0.02);
        tL = k < 0.45 ? V().copy(rest).lerp(bag, smooth(k / 0.45)) : V().copy(bag).lerp(rest, smooth((k - 0.45) / 0.55));
        tR = V().copy(rest).add(V().set(-0.12, 0.08, 0));
        S.hold = k > 0.9 ? 'left' : 'free';
      } else {
        tR = up ? V().copy(rest).add(V().set(-0.12, 0.08, 0)) : V().set(-0.22, 0.95, 0.12);
        S.hold = up ? 'left' : 'free';
      }
      reach(sR, tR, R.a, R.b, V().set(-0.6, -0.4, -0.3), eR, wR);
      reach(sL, tL, R.a, R.b, V().set(0.6, -0.5, -0.2), eL, wL);
      const wind = whirl ? -0.45 * smooth(p.actT / 0.4) : S.throwT >= 0 && S.throwT < 0.5 ? -0.45 + 1.0 * out3(S.throwT / 0.2) : 0;
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
    return limbs;
  }

  /** After the body is posed: put the bow, string, arrow, cords and pouch where the hands really are. */
  late(model: Character, dt: number, t: number) {
    if (this.mode === 'none' || !this.rig) return;
    const R = this.rig, S = this.st;
    model.root.updateWorldMatrix(true, true);
    const hL = model.handL.localToWorld(V().set(0, -0.05, 0)), hR = model.handR.localToWorld(V().set(0, -0.06, 0));
    const rq = model.root.getWorldQuaternion(new THREE.Quaternion());
    const aim = V().copy(this.aimL).applyQuaternion(rq).normalize();
    const vis = (o: THREE.Object3D, v: boolean) => { o.visible = v; };
    this.bowSeg.forEach((o) => vis(o, this.mode === 'bow')); this.str.forEach((o) => vis(o, this.mode === 'bow'));
    if (this.trailMesh && this.mode !== 'atlatl') this.trailMesh.visible = false;
    vis(this.arrow, false); this.cords.forEach((o) => vis(o, this.mode === 'sling')); vis(this.pouch, this.mode === 'sling'); vis(this.stone, false);
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
      const draw = S.draw, brace = 0.15;
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
    if (on) this.trail.unshift({ a: hand.clone().lerp(hook, 0.35), b: hook.clone(), age: 0 });
    this.trail = this.trail.filter((q) => q.age < 0.18).slice(0, N);
    const m = this.trailMesh, n = this.trail.length;
    m.visible = n > 2;
    if (!m.visible) return;
    const P = m.geometry.attributes.position as THREE.BufferAttribute, C = m.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      const q = this.trail[Math.min(i, n - 1)], k = i < n ? (1 - q.age / 0.18) * (1 - i / N) : 0;
      P.setXYZ(i * 2, q.a.x, q.a.y, q.a.z); P.setXYZ(i * 2 + 1, q.b.x, q.b.y, q.b.z);
      C.setXYZW(i * 2, 0.85, 0.8, 0.7, k * 0.12); C.setXYZW(i * 2 + 1, 0.9, 0.85, 0.75, k * 0.4);
    }
    P.needsUpdate = true; C.needsUpdate = true;
  }
  /** Taken off: nothing left in the world. */
  hide(model?: Character) { if (model) { grip(model, 'L', null); grip(model, 'R', null); } this.group.visible = false; this.quiver.visible = false; this.mode = 'none'; this.faceOffset = 0; this.pouchInit = false; }
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
