import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import { cobble, type CobbleKind as Kind } from '../world/cobble';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import type { StreamWater } from '../world/stream';
import { cover, type Beat, type Shot } from '../cinematic/cutscene';
import type { TensionResult, TensionSpec } from '../combat/sim/tension';
import type { Cond } from './branch';

const KINDS: Kind[] = ['granite', 'flint', 'sand'];
const CHOSE = (k: Kind): Cond => ({ chose: ['e1.stone', k] });
const WRONG: Cond = { any: [CHOSE('granite'), CHOSE('sand')] };
/** Knapping results the capture tools can queue (window.__e1knap = ['mid', 'ok']): no timing by hand in a recording. */
type Strike = 'mid' | 'steep' | 'snap' | 'ok';

/**
 * Episode One 1.3, the first tools (INVENTION_TREE.md Age 1 rows 2 and 3): on the stream bank three cobbles, grey
 * granite, dark flint and brown sandstone. He taps each with a hammerstone (Draxum remembered: flint sings, rubbish
 * rock goes thunk), picks one (decision e1.stone), and a wrong one falls apart on the first strike. Then he knaps the
 * flint: where to strike (near the edge, not the middle) and the strike itself (a low angle, followed through); each
 * real way to fail has its own line, and the flake he gets cuts his thumb. Sets `inv.goodStone` and `inv.flake`.
 * The digging stick (`inv.woodBone`) comes with the branches at the end of level 3 (game.ts).
 */
export class Stones {
  private site: { kneel: THREE.Vector3; facing: number; at: Record<Kind, THREE.Vector3>; group: THREE.Group } | null = null;
  private meshes = new Map<Kind, THREE.Mesh>();
  private fails = 0;

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private stream: StreamWater,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
    private tension: (spec: TensionSpec) => Promise<TensionResult> | null,
  ) {}

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }

  /** Where the cobbles lie: a gravel bank of the stream, well away from the loose stones and branches of level 3 (the
   * level tests walk to those; they must not walk into this scene). Placed once, the first time it is asked for. */
  place() {
    if (this.site) return this.site;
    const L = this.stream.line, n = L.length, items = this.world.items.items.filter((i) => i.type === 'stone' || i.type === 'branch');
    let best = -1, bestD = -1;
    for (let k = 0; k < 24; k++) {
      // from about a third of the way down, outwards both ways
      const i = Math.floor(n * 0.34) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
      if (i < 4 || i > n - 10) continue;
      const d = items.reduce((m, it) => Math.min(m, Math.hypot(it.pos.x - L[i].x, it.pos.z - L[i].z)), Infinity);
      if (d > 8) { best = i; break; }
      if (d > bestD) { bestD = d; best = i; }
    }
    // the bank on the side the wake is on (he comes from there)
    const toWake = new THREE.Vector3(-L[best].x, 0, -L[best].z).normalize().multiplyScalar(2.5);
    const spot = this.stream.bankSpot(L[best].clone().add(toWake));
    const f = new THREE.Vector3(-Math.sin(spot.facing), 0, -Math.cos(spot.facing)); // towards the water
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const kneel = spot.at.clone().addScaledVector(f, -0.3);
    kneel.y = this.world.terrain.height(kneel.x, kneel.z);
    const group = new THREE.Group(); group.name = 'e1-cobbles';
    const at = {} as Record<Kind, THREE.Vector3>;
    KINDS.forEach((k, i) => {
      const p = kneel.clone().addScaledVector(f, 0.5).addScaledVector(r, (i - 1) * 0.3);
      p.y = this.world.terrain.height(p.x, p.z);
      const m = cobble(k, 31 + i * 7, 1.35);
      m.position.copy(p).add(new THREE.Vector3(0, 0.045, 0));
      m.rotation.y = i * 1.9;
      group.add(m); this.meshes.set(k, m); at[k] = m.position.clone();
    });
    // a few plain river stones round them, so the three are a choice from a bank, not three props on show
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39, d = 0.55 + (i % 3) * 0.35;
      const p = kneel.clone().addScaledVector(f, 0.45 + Math.cos(a) * d * 0.5).addScaledVector(r, Math.sin(a) * d);
      p.y = this.world.terrain.height(p.x, p.z) + 0.02;
      const m = cobble(i % 3 === 0 ? 'granite' : 'sand', 90 + i, 0.6 + (i % 4) * 0.12);
      m.position.copy(p); m.rotation.set(i, i * 0.7, 0); group.add(m);
    }
    this.world.scene.add(group);
    this.stream.clearReeds(kneel, 1.6);
    this.site = { kneel, facing: spot.facing, at, group };
    return this.site;
  }

  /** Is he at the cobbles (level 3, not yet seen)? */
  near(p: THREE.Vector3) {
    const s = this.s;
    if (s.level !== 3 || s.flags['e1.stoneSeen']) return false;
    const site = this.place();
    return Math.hypot(p.x - site.kneel.x, p.z - site.kneel.z) < 2.6;
  }

  /** Kneel him at the spot facing the water, sitting back on his heels and leant over his hands (a cut hides it).
   * Sitting back is what lets his hands work low in front of his knees (measured in the studio: kneeling upright the
   * wrist cannot go below 33 cm, and the stones on the ground were out of reach: his hands stopped at his knees). */
  private settle() {
    const site = this.site!, p = this.player;
    p.pos.copy(site.kneel); p.vel.set(0, 0, 0); p.facing = site.facing;
    p.model.root.position.copy(site.kneel); p.model.root.rotation.y = site.facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(true, true);
    this.z.setLimbs({ bend: 0.5 });
  }

  private fwd() { const r = this.z.root.rotation.y; return new THREE.Vector3(Math.sin(r), 0, Math.cos(r)); }
  /** His forward and his left, on the ground. */
  private axes() { const f = this.fwd(); return { f, l: new THREE.Vector3(f.z, 0, -f.x) }; }
  private headAt() { return new THREE.Vector3().setFromMatrixPosition(this.z.head.matrixWorld); }

  /** Where the stone sits in his left hand while he works it: in front of his knees, low, a little to his left. */
  private work() {
    const { f, l } = this.axes();
    return this.site!.kneel.clone().addScaledVector(f, 0.3).addScaledVector(l, 0.035).add(new THREE.Vector3(0, 0.27, 0));
  }

  /** The hands and the stone: from in front of him, a little to his right and above the hands. `dist` 0.45 is the
   * insert (the stone and both hands fill the frame), 1.1 the medium (his face, looking down at them, at the top). */
  private handShot(dist = 0.8): Shot {
    const W = this.work(), { f, l } = this.axes();
    const up = dist < 0.6 ? 0.05 : 0.08 + (dist - 0.6) * 0.35;
    return { from: W.clone().addScaledVector(f, dist * 0.82).addScaledVector(l, -dist * 0.5).add(new THREE.Vector3(0, dist * 0.32, 0)), to: W.clone().add(new THREE.Vector3(0, up, 0)), push: 0.02 };
  }
  /** His face from below and in front: he is looking down at his hands, so the lens goes under his brow (a lens at
   * head height framed the top of his hair: owner, life_landed L3). The hands come into the bottom of frame. */
  private faceShot(side = -0.3): Shot {
    const h = this.headAt(), { f, l } = this.axes();
    return { from: h.clone().addScaledVector(f, 0.72).addScaledVector(l, side).add(new THREE.Vector3(0, -0.36, 0)), to: h.clone().addScaledVector(f, 0.06).add(new THREE.Vector3(0, -0.1, 0)), push: 0.03 };
  }

  /** The cobble `k` (or none) in his left hand at the work spot; the one there before goes back to its place. */
  private inHand: Kind | null = null;
  private takeUp(k: Kind | null) {
    const site = this.site!, z = this.z;
    if (this.inHand && this.inHand !== k) { const m = this.meshes.get(this.inHand); if (m) m.position.copy(site.at[this.inHand]); }
    this.inHand = k;
    if (!k) { z.setHold(null); return; }
    const m = this.meshes.get(k)!, W = this.work(), { f, l } = this.axes();
    m.position.copy(W); m.rotation.set(0, z.root.rotation.y + 0.4, 0.25);
    this.holdL = { at: W.clone(), fingers: f.clone().addScaledVector(l, -0.45).add(new THREE.Vector3(0, 0.15, 0)).normalize(), palm: new THREE.Vector3(0, 1, 0).addScaledVector(l, -0.35).normalize(), radius: 0.05, grasp: true };
    z.setHold({ L: this.holdL, R: this.holdR ?? undefined });
  }
  private holdL: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; radius: number; grasp: boolean } | null = null;
  private holdR: { at: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; radius: number; grasp: boolean } | null = null;

  /**
   * The hammerstone in his right hand: a lift (anticipation), a fast swing down onto the stone in his left hand
   * (`spot` -1 the edge near him, 0 the middle), the contact with the sound of what it hits, a small rebound and a
   * settle. Twice for a ring test, once for a strike. The hand is driven every frame (eased holds read soft).
   */
  private tap(k: Kind | 'strike', spot = -1, hard = false, n = k === 'strike' ? 1 : 2) {
    const z = this.z, W = this.work(), { f, l } = this.axes();
    z.setProp('stone');
    const hit = W.clone().add(new THREE.Vector3(0, 0.095, 0)).addScaledVector(f, spot * 0.035).addScaledVector(l, -0.03);
    const rest = hit.clone().add(new THREE.Vector3(0, 0.1, 0)).addScaledVector(l, -0.05).addScaledVector(f, 0.02);
    const top = hit.clone().add(new THREE.Vector3(0, 0.2, 0)).addScaledVector(l, -0.07).addScaledVector(f, 0.04);
    this.holdR = { at: rest.clone(), fingers: f.clone().add(new THREE.Vector3(0, -0.5, 0)).normalize(), palm: new THREE.Vector3(0, -1, 0).addScaledVector(l, 0.3).normalize(), radius: 0.035, grasp: true };
    z.setHold({ L: this.holdL ?? undefined, R: this.holdR });
    const sound = () => {
      if (k === 'flint') { audio.sample('flint', 0.5); audio.tone(2350, 0.4, 'sine', 0.07); audio.tone(3520, 0.28, 'sine', 0.035, 0.01); }
      else if (k === 'granite') { audio.sample('stone', 0.6, { rate: 1.05 }); }
      else if (k === 'sand') { audio.sample('stone', 0.45, { rate: 0.62 }); audio.tone(110, 0.14, 'sine', 0.12); }
      else { audio.sample(hard ? 'cb_crack' : 'flint', hard ? 0.5 : 0.6); }
    };
    // one blow: 0-0.22 s up to the top, 0.22-0.3 down fast, contact, 0.3-0.42 a small bounce, then back to rest
    const P = 0.62, t0 = performance.now(), R = this.holdR, run = ++this.tapN;
    let hits = 0;
    const step = () => {
      if (run !== this.tapN) return;
      const s = (performance.now() - t0) / 1000, i = Math.floor(s / P), u = s - i * P;
      if (i >= n) { R.at.copy(rest); return; }
      if (u < 0.22) R.at.copy(rest).lerp(top, Math.sin((u / 0.22) * Math.PI / 2));
      else if (u < 0.3) R.at.copy(top).lerp(hit, ((u - 0.22) / 0.08) ** 2);
      else if (u < 0.42) R.at.copy(hit).lerp(rest, Math.sin(((u - 0.3) / 0.12) * Math.PI / 2) * 0.35);
      else R.at.copy(hit).lerp(rest, 0.35 + 0.65 * Math.min(1, (u - 0.42) / 0.2));
      if (u >= 0.3 && hits <= i) { hits = i + 1; sound(); }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  private tapN = 0;

  /** The scene at the cobbles. */
  start() {
    const s = this.s, z = this.z, site = this.place();
    s.flags['e1.stoneSeen'] = true;
    const mid = () => site.at.granite.clone().lerp(site.at.sand, 0.5);
    this.playScene([
      // he kneels at the bank and looks over the stones; Draxum's voice comes back to him
      { hold: 2.0, shot: () => cover.mid(z, 0.8, 2.2), run: () => {
        this.settle(); z.setLookTarget(mid());
        z.setProp('stone');
        this.ui.memory('e1.st.drax', 8);
      } },
      // he takes up each one in his left hand and taps it with the stone in his right: the grey one clacks, the dark
      // one rings, the brown one thunks (the ring test is done in the hand, not on the ground)
      ...KINDS.map((k, i): Beat => ({ hold: 1.6, shot: () => this.handShot(i === 1 ? 0.5 : 0.9), run: () => { this.takeUp(k); z.setLookTarget(this.work()); this.tap(k, 0); } })),
      { choice: 'e1.stone', shot: () => this.handShot(1.15), run: () => this.takeUp(null) },
      // a wrong stone: the first real strike and it falls apart (granite crumbles at a crack, sandstone into grit)
      { hold: 1.5, if: WRONG, shot: () => this.handShot(0.6), run: () => {
        const k = this.chosen();
        this.takeUp(k); z.setLookTarget(this.work()); this.tap('strike', -1, true);
        this.after(0.32, () => { this.inHand = null; this.crumble(k); });
      } },
      { key: 'e1.st.fail', who: 'scientist', if: WRONG, shot: () => this.faceShot(), run: () => { z.setHold(null); z.setFace({ squint: 0.3, frown: 0.25 }); }, after: 0.3 },
      // the dark one: in his left hand, turned, one ringing tap
      { hold: 1.6, shot: () => this.handShot(0.55), run: () => {
        z.setFace(null); this.takeUp('flint'); z.setLookTarget(this.work());
        this.tap('flint', 0, false, 1);
      } },
    ], () => {
      s.flags['inv.goodStone'] = true;
      this.ui.toast(t('e1.learn.goodStone'));
      this.fails = 0;
      this.after(0.6, () => this.knap());
    });
  }

  private chosen(): Kind {
    const e = this.s.branch?.log?.find((x) => x.id === 'e1.stone');
    return (e?.pick as Kind) ?? 'flint';
  }

  /** A wrong stone breaks in his hand: it goes, the pieces drop to the ground, a puff of grit. */
  private crumble(k: Kind) {
    const m = this.meshes.get(k); if (!m) return;
    m.visible = false;
    if (this.holdL) this.z.setHold({ R: this.holdR ?? undefined });
    const bits: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const b = cobble(k, 200 + i, 0.45);
      b.position.copy(m.position); this.site!.group.add(b); bits.push(b);
    }
    const t0 = performance.now(), from = m.position.clone(), ground = this.world.terrain.height(from.x, from.z) + 0.02;
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      bits.forEach((b, i) => {
        const a = i * 1.7 + 0.4, v = 0.25 + (i % 2) * 0.15, tt = Math.min(s, 0.7);
        b.position.set(from.x + Math.cos(a) * v * tt, Math.max(ground, from.y + 0.4 * tt - 4.9 * tt * tt), from.z + Math.sin(a) * v * tt);
        b.rotation.set(s * 4 + i, s * 3, 0);
      });
      if (s < 0.8) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    audio.sample('stone', 0.35, { rate: 0.5, delay: 0.15 });
  }

  /** One knapping attempt: where on the core (near the edge), then the strike (low angle, followed through). */
  private async knap() {
    const z = this.z, site = this.site!, { f, l } = this.axes();
    // the flint core in his left hand at the work spot, the edge towards him
    this.takeUp('flint');
    const W = this.work(), edge = W.clone().addScaledVector(f, -0.06).add(new THREE.Vector3(0, 0.03, 0));
    if (this.fails === 0) this.ui.toast(t('e1.fl.hint'));
    z.setLookTarget(W);
    const q = (window as unknown as { __e1knap?: Strike[] }).__e1knap;
    // the follow camera would show his back while the moment is open: hold on the hands and the stone instead
    const sh = this.handShot(0.85); this.player.workShot = { from: sh.from.clone(), to: sh.to.clone() };
    let res: Strike;
    if (q && q.length) { res = q.shift()!; await new Promise((r) => setTimeout(r, 1600)); }
    else {
      const where = await this.tension({ kind: 'aim', seconds: 3.2 });
      if (!where) res = 'ok';
      else if (!where.passed) res = 'mid';
      else {
        const hit = await this.tension({ kind: 'quick', seconds: 1.3 });
        res = !hit || hit.passed ? 'ok' : this.fails % 2 === 0 ? 'steep' : 'snap';
      }
    }
    // after three misses the fourth strike lands: the lesson is taught, the player is not held here
    this.player.workShot = null;
    if (res !== 'ok' && this.fails >= 3) res = 'ok';
    const line: Record<Strike, string> = { mid: 'e1.fl.mid', steep: 'e1.fl.steep', snap: 'e1.fl.snap', ok: 'e1.fl.ok' };
    if (res !== 'ok') {
      this.fails++;
      this.playScene([
        { hold: 1.2, shot: () => this.handShot(0.55), run: () => {
          this.takeUp('flint');
          this.tap('strike', res === 'mid' ? 0 : -1, res === 'snap');
          if (res === 'steep') this.after(0.32, () => this.grit(edge));
          if (res === 'snap') this.after(0.32, () => this.dropFlake(edge, true));
          if (res === 'mid') this.after(0.4, () => { audio.human('grunt', 0.4); z.setFace({ squint: 0.6, frown: 0.5 }); this.holdR?.at.addScaledVector(l, -0.06).add(new THREE.Vector3(0, 0.05, 0)); });
        } },
        { key: line[res], who: 'scientist', shot: () => this.faceShot(res === 'mid' ? 0.3 : -0.3), run: () => z.setFace({ squint: 0.3, frown: 0.3 }), after: 0.2 },
      ], () => { z.setFace(null); this.after(0.4, () => this.knap()); });
      return;
    }
    // it works: a long thin flake peels off the edge and drops in front of his knees; an insert on it; he picks it
    // up and turns it to the light, tests the edge on his thumb, it cuts him, he sucks the thumb
    let flake: THREE.Mesh | null = null;
    const lie = site.kneel.clone().addScaledVector(f, 0.42).addScaledVector(l, 0.02);
    lie.y = this.world.terrain.height(lie.x, lie.z) + 0.006;
    const hold = this.work().add(new THREE.Vector3(0, 0.2, 0)).addScaledVector(l, -0.06);
    this.playScene([
      { hold: 1.5, shot: () => this.handShot(0.5), run: () => {
        this.takeUp('flint');
        this.tap('strike', -1);
        this.after(0.31, () => { flake = this.dropFlake(edge, false, lie); });
      } },
      // the insert: the flake on the ground, its edge catching the light
      { hold: 1.7, shot: () => ({ from: lie.clone().addScaledVector(f, 0.26).addScaledVector(l, -0.14).add(new THREE.Vector3(0, 0.13, 0)), to: lie.clone().add(new THREE.Vector3(0, 0.01, 0)), push: 0.015 }), run: () => { z.setLookTarget(lie); } },
      // picked up and turned to the light between finger and thumb
      { hold: 2.2, shot: () => this.faceShot(-0.25), run: () => {
        flake?.removeFromParent(); this.takeUp(null); z.setProp('flake');
        z.setHold({ R: { at: hold, fingers: f.clone().addScaledVector(l, 0.4).add(new THREE.Vector3(0, 0.4, 0)).normalize(), palm: l.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize() }, L: { at: hold.clone().addScaledVector(l, 0.09).add(new THREE.Vector3(0, -0.02, 0)), fingers: f.clone().addScaledVector(l, -0.3).normalize(), palm: new THREE.Vector3(0, 1, 0) } });
        z.setLookTarget(hold); z.setFace({ open: 0.15 });
        // the thumb along the edge: a hiss, a wince
        this.after(1.4, () => { audio.human('breath', 0.5); z.setFace({ squint: 0.6, frown: 0.35, open: 0.25 }); });
      } },
      // the cut thumb up to his mouth (no line)
      { hold: 1.5, shot: () => this.faceShot(0.3), run: () => {
        const mouth = z.lipsAt(new THREE.Vector3()).addScaledVector(f, 0.05).add(new THREE.Vector3(0, -0.03, 0));
        z.setHold({ R: { at: hold.clone().add(new THREE.Vector3(0, -0.08, 0)), fingers: f.clone(), palm: l.clone() }, L: { at: mouth, fingers: new THREE.Vector3(0, 1, 0).addScaledVector(f, -0.5).normalize(), palm: f.clone().negate() } });
        z.setLookTarget(hold); z.setFace({ squint: 0.3, frown: 0.2 });
      } },
      { key: line.ok, who: 'scientist', shot: () => this.faceShot(-0.3), run: () => { z.setHold({ R: { at: hold.clone().add(new THREE.Vector3(0, -0.05, 0)), fingers: f.clone(), palm: l.clone() } }); z.setLookTarget(hold); z.setFace({ smile: 0.35 }); }, after: 0.5 },
    ], () => {
      this.s.flags['inv.flake'] = true;
      this.ui.toast(t('e1.learn.flake'));
      const m = this.meshes.get('flint'); if (m) m.position.copy(site.at.flint);
      this.inHand = null; this.holdL = this.holdR = null; this.tapN++;
      z.setProp(null); z.setHold(null); z.setFace(null); z.setLimbs(null); z.setLookTarget(null); z.setKneel(false);
    });
  }

  /** A flake comes off the edge and drops (to `lie`, or in front of him): a small arc and a turn, a click on landing.
   * A snapped one breaks in two on the ground. */
  private dropFlake(from: THREE.Vector3, snapped: boolean, lie?: THREE.Vector3): THREE.Mesh {
    const { f, l } = this.axes(), fl = flakeMesh();
    const to = lie ?? this.site!.kneel.clone().addScaledVector(f, 0.4).addScaledVector(l, -0.06);
    if (!lie) to.y = this.world.terrain.height(to.x, to.z) + 0.006;
    if (snapped) fl.scale.set(0.55, 1, 1);
    fl.position.copy(from); this.site!.group.add(fl);
    const t0 = performance.now(), yaw = this.z.root.rotation.y + 0.6;
    const tick = () => {
      const s = Math.min(1, (performance.now() - t0) / 1000 / 0.42);
      fl.position.copy(from).lerp(to, s); fl.position.y += Math.sin(s * Math.PI) * 0.05 * (1 - s);
      fl.rotation.set((1 - s) * 2.4, yaw, (1 - s) * 1.1);
      if (s < 1) requestAnimationFrame(tick); else audio.sample('flint', 0.12, { rate: 2.2 });
    };
    requestAnimationFrame(tick);
    if (snapped) this.after(2.5, () => { fl.removeFromParent(); });
    return fl;
  }

  /** Crumbs off a strike that came down too steep. */
  private grit(at: THREE.Vector3) {
    const N = 10, g = new THREE.TetrahedronGeometry(0.008), mat = new THREE.MeshStandardMaterial({ color: 0x3a3b40, roughness: 0.4 });
    const bits = new THREE.InstancedMesh(g, mat, N); bits.frustumCulled = false;
    const t0 = performance.now(), m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    bits.onBeforeRender = () => {
      const s = Math.min(0.5, (performance.now() - t0) / 1000);
      for (let i = 0; i < N; i++) {
        p.set(at.x + Math.cos(i * 2.1) * 0.3 * s, Math.max(at.y - 0.03, at.y + 0.02 + 1.0 * s - 4.9 * s * s), at.z + Math.sin(i * 2.1) * 0.3 * s);
        bits.setMatrixAt(i, m4.compose(p, q.setFromAxisAngle(one, s * 9 + i), one));
      }
      bits.instanceMatrix.needsUpdate = true;
    };
    this.site!.group.add(bits);
    this.after(2.5, () => { bits.removeFromParent(); g.dispose(); mat.dispose(); bits.dispose(); });
  }
}

/** A flint flake: long, thin, sharp-edged, dark and glassy, a little curved. */
export function flakeMesh(): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.0, 0.022, 0.07, 5, 1);
  g.scale(1, 1, 0.22); g.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.15, metalness: 0.1 }));
  mesh.castShadow = true;
  return mesh;
}
