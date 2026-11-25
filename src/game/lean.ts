import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import { cover, type Beat, type Shot } from '../cinematic/cutscene';
import type { TensionResult, TensionSpec } from '../combat/sim/tension';

/**
 * Episode One 1.3, the last of the afternoon: THE LEAN-TO (INVENTION_TREE.md Age 1 row 8; Bolzar remembered). The
 * uprights and the ridge pole, then which way it faces (an `aim` moment: the back to the wind; miss it and the wind
 * walks straight in, `e1.sh.wind`, and he turns it), the leaning poles, then the thatch from the bottom row up (a
 * `steady` moment; uneven and the light comes through, `e1.sh.thin`, and he lays it again). Then he sits in it and
 * does not move for five seconds: the first quiet of the episode. THE THROWING STICK (docs/COMBAT_API.md
 * `throwStick`, Schoeningen): a bent offcut of the ridge pole, thrown flat at a dead stump (a `quick` moment); it
 * spins end over end; hit or miss, he has learned it. Sets `inv.throwStick`. Played for a player's own press; the
 * level tests keep the plain build.
 */
export class LeanTo {
  private stump: THREE.Group | null = null;
  private fx: THREE.Object3D[] = [];
  /** Fails so far: the lesson is taught by the first; after two the next try holds (nobody is kept here). */
  private thin = 0;
  private windFail = false;

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
    private tension: (spec: TensionSpec) => Promise<TensionResult> | null,
  ) {}

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }
  private get camp() { return this.world.camp as unknown as { shelterStage(k: number, thin?: boolean, turn?: number): void; shelterAt(): { at: THREE.Vector3; open: THREE.Vector3 } }; }

  /** The site: where it stands, its open side (to the fire), his right as he faces it, where he works. */
  private site() {
    const { at, open } = this.camp.shelterAt(), r = new THREE.Vector3(-open.z, 0, open.x);
    const work = at.clone().addScaledVector(open, 1.25); work.y = this.world.terrain.height(work.x, work.z);
    return { at, open, r, work };
  }

  /** Stand him in front of the frame, facing it. */
  private stand(work: THREE.Vector3, at: THREE.Vector3) {
    const p = this.player, d = work.clone().sub(at).setY(0).normalize(), facing = Math.atan2(d.x, d.z);
    p.pos.copy(work); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(work); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
  }

  /** Wide, from the fire's side and off to one flank: the whole frame and him in front of it. */
  private wide(dist = 4.2, side = 0.7): Shot {
    const S = this.site(), aim = S.at.clone().addScaledVector(S.open, 0.4).add(new THREE.Vector3(0, 0.85, 0));
    const from = aim.clone().addScaledVector(S.open, dist).addScaledVector(S.r, side * dist).add(new THREE.Vector3(0, 0.75, 0));
    return { from, to: aim, push: 0.03 };
  }
  /** Closer on the roof he is thatching, his hands on it. */
  private roofShot(): Shot {
    const S = this.site(), aim = S.at.clone().addScaledVector(S.open, -0.2).add(new THREE.Vector3(0, 0.75, 0));
    return { from: aim.clone().addScaledVector(S.open, 2.4).addScaledVector(S.r, -1.5).add(new THREE.Vector3(0, 0.9, 0)), to: aim, push: 0.02 };
  }
  private holdShot(sh: Shot | null) { this.player.workShot = sh ? { from: sh.from.clone(), to: sh.to.clone() } : null; }

  /** Hands up on the frame, working at `at` (laying a pole, tucking a frond). */
  private reach(at: THREE.Vector3, sec: number) {
    const z = this.z, S = this.site(), t0 = performance.now();
    const step = () => {
      const k = (performance.now() - t0) / 1000; if (k > sec) { z.setHold(null); return; }
      const w = Math.sin(k * 5) * 0.05;
      z.setHold({
        L: { at: at.clone().addScaledVector(S.r, -0.22 + w), fingers: S.open.clone().negate(), palm: S.open.clone().negate(), radius: 0.03, grasp: true },
        R: { at: at.clone().addScaledVector(S.r, 0.22 - w).add(new THREE.Vector3(0, 0.04, 0)), fingers: S.open.clone().negate(), palm: S.open.clone().negate(), radius: 0.03, grasp: true },
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    z.setLookTarget(at);
  }

  /** Grass and leaf bits blowing in through the open side (it faces the wind). */
  private gust(sec: number, turn: number) {
    const S = this.site(), into = S.open.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).negate();
    const N = 70, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x8c9a5a, size: 0.035, transparent: true, opacity: 0.8, depthWrite: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    const t0 = performance.now(), from = S.at.clone().addScaledVector(into, -4).add(new THREE.Vector3(0, 0.6, 0));
    pts.onBeforeRender = () => {
      const k = (performance.now() - t0) / 1000;
      for (let i = 0; i < N; i++) {
        const a = (k * 0.9 + i / N) % 1;
        const p = from.clone().addScaledVector(into, a * 4.6).addScaledVector(S.r, Math.sin(i * 4.1) * 1.2).add(new THREE.Vector3(0, Math.sin(i * 2.7 + k * 3) * 0.35 + 0.2 * Math.sin(a * 9), 0));
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      }
      g.attributes.position.needsUpdate = true;
      m.opacity = 0.8 * Math.min(1, k / 0.4) * Math.max(0, Math.min(1, (sec - k) / 0.5));
    };
    this.world.scene.add(pts); this.fx.push(pts);
    audio.sample('amb_wind', 0.5);
    this.after(sec, () => { pts.removeFromParent(); g.dispose(); m.dispose(); });
  }

  /** The whole build. `built` runs the game's own shelter (flags, the obstacle, the toast). */
  start(built: () => void) {
    const z = this.z, S = this.site();
    const ridge = S.at.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(S.open, 0.2);
    this.camp.shelterStage(0);
    this.playScene([
      { hold: 2.0, shot: () => this.wide(4.6, 0.8), run: () => { this.stand(S.work, S.at); z.setLookTarget(ridge); this.ui.memory('e1.sh.bol', 10); } },
      { hold: 2.4, shot: () => this.wide(3.6, -0.6), run: () => { this.camp.shelterStage(1); this.reach(ridge, 2.2); audio.sample('wood', 0.45); this.after(1.1, () => audio.sample('wood', 0.35, { rate: 0.8 })); } },
    ], () => this.face(built));
  }

  /** Which way it faces: the back to the wind. */
  private async face(built: () => void) {
    const z = this.z, q = (window as unknown as { __e1lean?: string[] }).__e1lean;
    this.ui.toast(t('e1.sh.hintWind'));
    this.holdShot(this.wide(4.0, 0.5));
    let ok: boolean;
    if (q && q.length) { ok = q.shift() !== 'wind'; await new Promise((r) => setTimeout(r, 1800)); }
    else { const r = await this.tension({ kind: 'aim', seconds: 3.2 }); ok = !r || r.passed; }
    if (this.windFail) ok = true;
    this.windFail = !ok;
    this.holdShot(null);
    if (!ok) {
      // the frame goes up facing the wrong way; the wind comes straight in; he turns it
      this.playScene([
        // the frame turned the wrong way leans its poles out over where he worked: he stands off to the side of it
        // (he stood inside the poles with his arms through them: owner, L5 clip)
        { hold: 2.4, shot: () => this.wide(4.2, 0.9), run: () => { this.camp.shelterStage(2, false, Math.PI); this.stand(this.aside(), this.site().at); this.gust(2.6, Math.PI); z.setFace({ squint: 0.6 }); } },
        { key: 'e1.sh.wind', who: 'scientist', shot: () => cover.close(this.z, 0.45, 1.0), run: () => z.setFace({ frown: 0.4, squint: 0.4 }), after: 0.2 },
        { hold: 1.8, shot: () => this.wide(4.4, -0.7), run: () => { z.setFace(null); this.camp.shelterStage(2); this.stand(this.site().work, this.site().at); this.reach(this.site().at.clone().add(new THREE.Vector3(0, 1.2, 0)), 1.6); audio.sample('wood', 0.5, { rate: 0.7 }); } },
      ], () => this.thatch(built, 3));
      return;
    }
    this.playScene([
      { hold: 2.0, shot: () => this.wide(3.8, 0.75), run: () => { this.camp.shelterStage(2); this.reach(this.site().at.clone().add(new THREE.Vector3(0, 1.1, 0)), 1.8); audio.sample('wood', 0.45, { rate: 0.9 }); this.after(0.9, () => audio.sample('wood', 0.4, { rate: 1.1 })); } },
    ], () => this.thatch(built, 3));
  }

  /** Thatch, a row at a time from the bottom. */
  private async thatch(built: () => void, row: number) {
    const z = this.z, S = this.site(), q = (window as unknown as { __e1lean?: string[] }).__e1lean;
    const h = [0, 0, 0, 0.35, 0.85, 1.3][row], at = S.at.clone().addScaledVector(S.open, -1.3 + (row - 3) * 0.5).add(new THREE.Vector3(0, h + 0.2, 0));
    if (row === 3) this.ui.toast(t('e1.sh.hintThatch'));
    this.holdShot(this.roofShot()); this.reach(at, 3.0); audio.sample('leather', 0.3, { rate: 0.8 });
    let ok: boolean;
    if (row > 3) ok = true;
    else if (q && q.length) { ok = q.shift() !== 'thin'; await new Promise((r) => setTimeout(r, 2200)); }
    else { const r = await this.tension({ kind: 'steady', seconds: 3.5 }); ok = !r || r.passed; }
    if (this.thin >= 2) ok = true;
    if (!ok) this.thin++;
    this.holdShot(null);
    if (!ok) {
      this.camp.shelterStage(row, true);
      this.playScene([
        { hold: 2.0, shot: () => this.inside(), run: () => {
          const under = S.at.clone().addScaledVector(S.open, -0.35); under.y = this.world.terrain.height(under.x, under.z);
          this.stand(under, under.clone().addScaledVector(S.open, 1));
          z.setKneel(true, true); z.setLookTarget(S.at.clone().addScaledVector(S.open, -0.7).add(new THREE.Vector3(0, 1.3, 0))); audio.sample('leather', 0.2);
        } },
        { key: 'e1.sh.thin', who: 'scientist', shot: () => cover.close(z, -0.4, 1.0), run: () => z.setFace({ squint: 0.3, smile: 0.15 }), after: 0.3 },
      ], () => { z.setFace(null); z.setKneel(false); this.stand(S.work, S.at); this.thatch(built, row); });
      return;
    }
    this.camp.shelterStage(row);
    if (row < 5) {
      this.playScene([{ hold: 1.4, shot: () => this.roofShot(), run: () => { this.reach(at.clone().add(new THREE.Vector3(0, 0.45, 0)), 1.3); audio.sample('leather', 0.25, { rate: 0.9 }); } }], () => this.thatch(built, row + 1));
      return;
    }
    this.sit(built);
  }

  /** Above the roof and off to one side, looking down through the thin row: the gaps show the ground and him under it,
   * kneeling, looking up at them. (From under the roof looking up, the lens saw only blown-out sky: owner, L5.) */
  private inside(): Shot {
    const S = this.site(), aim = S.at.clone().addScaledVector(S.open, -0.55).add(new THREE.Vector3(0, 0.7, 0));
    return { from: aim.clone().addScaledVector(S.open, 1.9).addScaledVector(S.r, 1.5).add(new THREE.Vector3(0, 1.9, 0)), to: aim, push: 0.01 };
  }
  /** Beside the frame, clear of its poles whichever way it is turned. */
  private aside() {
    const S = this.site(), p = S.at.clone().addScaledVector(S.r, 2.2).addScaledVector(S.open, 0.9); p.y = this.world.terrain.height(p.x, p.z);
    return p;
  }

  /** He sits in it and does not move: five seconds of nothing but the place. */
  private sit(built: () => void) {
    const z = this.z, S = this.site();
    const seat = S.at.clone().addScaledVector(S.open, -0.25); seat.y = this.world.terrain.height(seat.x, seat.z);
    this.playScene([
      { hold: 1.2, shot: () => this.wide(4.0, 0.6), run: () => { this.camp.shelterStage(5); z.setHold(null); audio.sample('leather', 0.3, { rate: 0.7 }); } },
      { hold: 5.6, shot: () => ({ from: seat.clone().addScaledVector(S.open, 3.4).addScaledVector(S.r, 0.6).add(new THREE.Vector3(0, 0.9, 0)), to: seat.clone().add(new THREE.Vector3(0, 0.75, 0)), push: 0.04 }), run: () => {
        // in, sitting, the fire side ahead of him; nothing moves but his breath
        const p = this.player, facing = Math.atan2(S.open.x, S.open.z);
        p.pos.copy(seat); p.model.root.position.copy(seat); p.facing = facing; p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
        z.setKneel(true, true); z.setLookTarget(seat.clone().addScaledVector(S.open, 6).add(new THREE.Vector3(0, 0.9, 0)));
        z.setFace({ smile: 0.1 });
        this.after(2.5, () => audio.human('breath', 0.35));
      } },
    ], () => {
      z.setKneel(false); z.setFace(null); z.setLookTarget(null);
      this.camp.shelterStage(5);
      // the level completes after the throw (its card came up mid-throw)
      this.stick(built);
    });
  }

  // ---------------- the throwing stick ----------------
  private stumpAt() {
    const S = this.site();
    for (const k of [7, 6, 8, 5, 9]) for (const sgn of [1, -1]) {
      const p = S.at.clone().addScaledVector(S.r, sgn * k).addScaledVector(S.open, 2.5);
      if (!this.world.forest.blocks(p.x, p.z, 0.6)) { p.y = this.world.terrain.height(p.x, p.z); return p; }
    }
    const p = S.at.clone().addScaledVector(S.r, 7).addScaledVector(S.open, 2.5); p.y = this.world.terrain.height(p.x, p.z); return p;
  }
  private makeStump(at: THREE.Vector3) {
    if (this.stump) return this.stump;
    const g = new THREE.Group(), bark = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.95 }), top = new THREE.MeshStandardMaterial({ color: 0x9a7d58, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.62, 9), bark); body.position.y = 0.31;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 9), top); cap.position.y = 0.62;
    g.add(body, cap); g.position.copy(at); g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.world.scene.add(g); this.stump = g; return g;
  }
  /** A bent offcut, about the length of his forearm and hand, the bend in the middle. */
  private makeStick() {
    // v4: peeled pale wood, a little thicker, so it reads against grass and dusk in flight (the dark 3 cm stick was lost)
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0xd2b088, roughness: 0.7, emissive: 0x2a1e10 });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.3, 6), wood);
      m.rotation.z = Math.PI / 2 + s * 0.28; m.position.set(s * 0.14, 0.02, 0); g.add(m);
    }
    g.traverse((o) => { o.castShadow = true; });
    return g;
  }

  private stick(built: () => void) {
    const z = this.z, S = this.site(), stumpP = this.stumpAt();
    this.makeStump(stumpP);
    // out in front of the lean-to (inside it the roof hid him from every camera)
    const p = this.player, stand = S.work.clone().addScaledVector(S.open, 0.6);
    stand.y = this.world.terrain.height(stand.x, stand.z);
    const d = stumpP.clone().sub(stand).setY(0).normalize();
    const side = (dist: number): Shot => {
      // over his shoulder from behind, high: him, the line of the throw and the stump in one frame
      const r = new THREE.Vector3(-d.z, 0, d.x);
      return { from: stand.clone().addScaledVector(d, -0.75 * dist).addScaledVector(r, 0.25 * dist).add(new THREE.Vector3(0, 1.75, 0)), to: stand.clone().lerp(stumpP, 0.55).add(new THREE.Vector3(0, 0.45, 0)), push: 0.02 };
    };
    this.playScene([
      { key: 'e1.ts.sci', who: 'scientist', shot: () => {
        // from the stump's side, so he looks out towards the lens with the stick in his hand
        const r = new THREE.Vector3(-d.z, 0, d.x), head = new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld);
        return { from: head.clone().addScaledVector(d, 2.0).addScaledVector(r, 0.7).add(new THREE.Vector3(0, -0.15, 0)), to: head.clone().add(new THREE.Vector3(0, -0.3, 0)), push: 0.04 };
      }, run: () => {
        p.pos.copy(stand); p.vel.set(0, 0, 0); p.model.root.position.copy(stand);
        const facing = Math.atan2(-d.x, -d.z); p.facing = facing; p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
        z.setLookTarget(stumpP.clone().add(new THREE.Vector3(0, 0.5, 0)));
        // the stick in his fist (it was not in his hand at all until it flew: GPU take e13v4), the palm turned out to his
        // right and the fingers forward and a little down, so the stick hangs down from the fist past the thumb, the way a
        // stick is carried (stood up out of a fist turned in, it ran up his chest to the chin: e13v5; lying out level on a
        // palm turned up it read as resting on an open hand at game distance: e13v6)
        z.setProp('throwstick');
        const rt = new THREE.Vector3(-d.z, 0, d.x);
        z.setHold({ R: { at: new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(d, 0.35).add(new THREE.Vector3(0, -0.45, 0)), fingers: d.clone().add(new THREE.Vector3(0, -0.3, 0)).normalize(), palm: rt, radius: 0.02 } });
      }, after: 0.2 },
    ], () => this.throwIt(d, stumpP, side, built));
  }

  private async throwIt(d: THREE.Vector3, stumpP: THREE.Vector3, side: (dist: number) => Shot, built: () => void) {
    const z = this.z, q = (window as unknown as { __e1throw?: boolean[] }).__e1throw;
    this.ui.toast(t('e1.ts.hint'));
    this.holdShot(side(4.2));
    let hit: boolean;
    if (q && q.length) { hit = q.shift()!; await new Promise((r) => setTimeout(r, 1200)); }
    else { const r = await this.tension({ kind: 'quick', seconds: 1.4 }); hit = !r || r.passed; }
    this.holdShot(null);
    const r = new THREE.Vector3(-d.z, 0, d.x), head = new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld);
    const from = head.clone().addScaledVector(r, 0.35).add(new THREE.Vector3(0, -0.5, 0));
    const to = hit ? stumpP.clone().add(new THREE.Vector3(0, 0.45, 0)) : stumpP.clone().addScaledVector(r, -1.1).addScaledVector(d, 1.4).add(new THREE.Vector3(0, 0.15, 0));
    const stick = this.makeStick();
    const fly = () => {
      // side-arm: the arm sweeps across, the stick leaves flat and spins about its middle all the way there
      // v4: a touch slower than life (1.3 s) and fewer turns, so the flight is seen; the second shot is from the stump
      const T = hit ? 1.3 : 1.5, t0 = performance.now();
      // from his hand as it is at the release (a fixed point by his head left the stick 20 to 40 cm off the hand)
      let hand: THREE.Object3D | undefined; z.root.traverse((o) => { if (o.name === 'handR' && (o as THREE.Bone).isBone) hand = o; });
      if (hand) from.setFromMatrixPosition(hand.matrixWorld);
      stick.position.copy(from); this.world.scene.add(stick); this.fx.push(stick);
      audio.sample('cb_whirr', 0.45);
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 1000 / T);
        stick.position.copy(from).lerp(to, k); stick.position.y += Math.sin(k * Math.PI) * 0.35;
        stick.rotation.set(0.15, k * 9, 0);
        if (k < 1) { requestAnimationFrame(step); return; }
        if (hit) { audio.sample('cb_thud', 0.6); audio.sample('wood', 0.5, { rate: 0.7 }); }
        else audio.sample('leather', 0.25, { rate: 0.6 });
        const drop = to.clone(); drop.y = this.world.terrain.height(drop.x, drop.z) + 0.02; if (hit) drop.addScaledVector(d, -0.35);
        stick.position.copy(drop); stick.rotation.set(0, Math.random() * 3, 0);
      };
      requestAnimationFrame(step);
    };
    this.playScene([
      { hold: 0.85, shot: () => side(3.8), run: () => {
        z.setHold({ R: { at: from.clone().addScaledVector(d, 0.45).addScaledVector(r, -0.2).add(new THREE.Vector3(0, 0.1, 0)), fingers: d.clone(), palm: new THREE.Vector3(0, -1, 0), radius: 0.02 } });
        this.after(0.12, () => { z.setProp(null); fly(); }); this.after(0.5, () => z.setHold(null)); audio.human('breath', 0.4);
      } },
      // from beside the stump, low, looking back up the line: the stick comes spinning in and lands (or flies past)
      { hold: 1.6, shot: () => ({ from: stumpP.clone().addScaledVector(r, 1.3).addScaledVector(d, 0.5).add(new THREE.Vector3(0, 0.55, 0)), to: stumpP.clone().addScaledVector(d, -1.6).add(new THREE.Vector3(0, 0.55, 0)), push: 0.01 }) },
      { key: hit ? 'e1.ts.hit' : 'e1.ts.miss', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0), run: () => z.setFace(hit ? { smile: 0.6 } : { squint: 0.3, smile: 0.2 }), after: 0.3 },
    ], () => {
      z.setFace(null); z.setLookTarget(null);
      this.s.flags['inv.throwStick'] = true;
      this.ui.toast(t('e1.learn.throwStick'));
      built();
      // the stick stays where it fell for a while, then is his (in the bag)
      this.after(20, () => { for (const o of this.fx) o.removeFromParent(); this.fx = []; });
    });
  }
}
