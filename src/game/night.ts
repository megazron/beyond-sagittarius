import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import type { Player } from './player';
import { cover, type Beat } from '../cinematic/cutscene';
import type { TensionResult, TensionSpec } from '../combat/sim/tension';
import type { Combat } from '../combat/combat';

/**
 * Episode One 1.9, the first night. THE SPEAR (INVENTION_TREE.md row 9): a straight sapling, the point scraped with the
 * flake, then turned in the coals (Draxum remembered); held in the flame it chars and snaps when he tests it
 * (`e1.sp.burn`), and he scrapes a new point. THE NIGHT: noises beyond the light, he goes still, and decision e1.night
 * (6 s): hide (a breath moment), brace the spear (the `night.defence` set piece) or run for the fire
 * (`chase.escape`). He cannot die tonight; a loss leaves him `scarred`. Played for a player's own press and on a
 * player's own night; the level tests (a webdriver) keep the old strike and the old Duskhound.
 */
export class FirstNight {
  private burnt = false;

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private getSave: () => SaveData,
    private playScene: (beats: Beat[], then?: () => void) => void,
    private after: (sec: number, fn: () => void) => void,
    private tension: (spec: TensionSpec) => Promise<TensionResult> | null,
    private combat: () => Combat | null,
  ) {}

  /** Tests drive the game through a webdriver: they get the old mechanics. */
  static get tested() { return typeof navigator !== 'undefined' && !!navigator.webdriver; }

  private get s() { return this.getSave(); }
  private get z() { return this.player.model; }
  private fwd() { const r = this.z.root.rotation.y; return new THREE.Vector3(Math.sin(r), 0, Math.cos(r)); }

  private kneel = new THREE.Vector3();
  private sitAtFire() {
    const camp = this.world.layout!.camp as THREE.Vector3, p = this.player;
    const d = new THREE.Vector3(p.pos.x - camp.x, 0, p.pos.z - camp.z); if (d.lengthSq() < 0.01) d.set(0, 0, 1);
    const at = camp.clone().add(d.setLength(1.4)); at.y = this.world.terrain.height(at.x, at.z);
    const facing = Math.atan2(d.x, d.z);
    p.pos.copy(at); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(at); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(true, true);
    this.kneel.copy(at);
    return camp;
  }

  /** Towards the fire from where he kneels, and his right (from the site, not the model's heading). */
  private axes(camp: THREE.Vector3) {
    const f = camp.clone().sub(this.kneel).setY(0).normalize();
    return { f, r: new THREE.Vector3(-f.z, 0, f.x) };
  }

  /** The sapling: a straight shaft with a point, a world object his hands are put on (the old spear rides his hand). */
  private stick: THREE.Group | null = null;
  private tipMat: THREE.MeshStandardMaterial | null = null;
  private makeStick() {
    if (this.stick) return this.stick;
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.85 });
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.8 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 1.5, 8), wood); shaft.position.y = 0.75;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.16, 8), this.tipMat); tip.position.y = 1.58;
    g.add(shaft, tip); g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.stick = g; return g;
  }
  /** Lay the stick from `butt` along `dir` (its point at the far end). */
  private layStick(butt: THREE.Vector3, dir: THREE.Vector3) {
    const g = this.makeStick();
    g.position.copy(butt); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    if (!g.parent) this.world.scene.add(g);
  }
  private along(butt: THREE.Vector3, dir: THREE.Vector3, m: number) { return butt.clone().addScaledVector(dir.clone().normalize(), m); }
  private dropStick() { this.stick?.removeFromParent(); }

  /** Across his lap, the point out to his right: the flake scrapes towards the point, both hands seen. */
  private lap(camp: THREE.Vector3) {
    const { f, r } = this.axes(camp);
    const butt = this.kneel.clone().addScaledVector(f, 0.32).addScaledVector(r, -0.9).add(new THREE.Vector3(0, 0.42, 0));
    return { butt, dir: r.clone().add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(f, 0.15).normalize() };
  }
  /** From the fire's side, low: his hands, the stick and his face bent over it. */
  private scrapeShot(camp: THREE.Vector3, dist = 1.15) {
    // in front of him and off to his left, away from the flames (from the fire's side the flames filled the lens)
    const { f, r } = this.axes(camp), L = this.lap(camp), mid = this.along(L.butt, L.dir, 0.85);
    return { from: this.kneel.clone().addScaledVector(f, 0.85 * dist).addScaledVector(r, -0.95 * dist).add(new THREE.Vector3(0, 0.75, 0)), to: mid.clone().add(new THREE.Vector3(0, 0.28, 0)), push: 0.02 };
  }
  /** From the side, the stick running from his hands into the coals. */
  private cookShot(camp: THREE.Vector3, dist = 2.0) {
    const { f, r } = this.axes(camp), m = this.kneel.clone().lerp(camp, 0.55);
    return { from: m.clone().addScaledVector(r, dist).addScaledVector(f, -0.25).add(new THREE.Vector3(0, 0.55, 0)), to: m.clone().add(new THREE.Vector3(0, 0.3, 0)), push: 0.02 };
  }

  /** The spear, at the fire (level 6). `made` runs the game's own spear (flags, the prop at the camp). */
  spear(made: () => void) {
    const z = this.z;
    let camp = new THREE.Vector3();
    const scrape = (sec: number) => {
      const t0 = performance.now(), L = this.lap(camp), { f } = this.axes(camp);
      this.layStick(L.butt, L.dir);
      const step = () => {
        const k = (performance.now() - t0) / 1000; if (k > sec) return;
        // the left hand holds the shaft, the right draws the flake along it towards the point, lifts, comes back
        const stroke = (k * 1.6) % 1, at = 0.95 + Math.min(stroke, 0.75) / 0.75 * 0.4;
        const lift = stroke > 0.75 ? 0.035 : 0;
        z.setHold({
          L: { at: this.along(L.butt, L.dir, 0.55), fingers: f.clone(), palm: L.dir.clone().negate(), radius: 0.02 },
          R: { at: this.along(L.butt, L.dir, at).add(new THREE.Vector3(0, 0.03 + lift, 0)), fingers: L.dir.clone(), palm: new THREE.Vector3(0, -1, 0) },
        });
        if (stroke < 0.75 && Math.random() < 0.12) audio.sample('wood', 0.15, { rate: 2.2 });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    this.playScene([
      { hold: 2.4, shot: () => cover.mid(z, 0.8, 2.3), run: () => { camp = this.sitAtFire(); z.setProp('flake'); z.setLimbs({ bend: 0.35 }); this.ui.memory('e1.sp.drax', 9); scrape(2.4); z.setLookTarget(this.along(this.lap(camp).butt, this.lap(camp).dir, 1.2)); } },
      { hold: 2.4, shot: () => this.scrapeShot(camp), run: () => scrape(2.4) },
      { hold: 1.6, shot: () => this.cookShot(camp), run: () => { z.setProp(null); this.cook(camp, 1.6); z.setLookTarget(camp.clone().add(new THREE.Vector3(0, 0.2, 0))); audio.sample('amb_fire', 0.2); } },
    ], () => this.turn(made, camp));
  }

  /** The point in the coals, both hands on the shaft turning it. `deep`: in the flame itself. */
  private cook(camp: THREE.Vector3, sec: number, deep = false) {
    const z = this.z, { f } = this.axes(camp), t0 = performance.now();
    const tip = camp.clone().add(new THREE.Vector3(0, deep ? 0.28 : 0.1, 0)).addScaledVector(f, deep ? 0.05 : -0.18);
    const butt = tip.clone().addScaledVector(tip.clone().sub(this.kneel.clone().add(new THREE.Vector3(0, 0.45, 0))).normalize(), -1.66);
    const dir = tip.clone().sub(butt).normalize();
    this.layStick(butt, dir);
    const step = () => {
      const k = (performance.now() - t0) / 1000; if (k > sec) return;
      this.stick!.rotateY(0.06);
      if (this.tipMat) this.tipMat.color.lerp(new THREE.Color(deep ? 0x1a120c : 0x5a4030), 0.004);
      z.setHold({
        L: { at: this.along(butt, dir, 0.3), fingers: dir.clone(), palm: new THREE.Vector3(0, -1, 0), radius: 0.02 },
        R: { at: this.along(butt, dir, 0.5), fingers: dir.clone(), palm: new THREE.Vector3(0, -1, 0), radius: 0.02 },
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private async turn(made: () => void, camp: THREE.Vector3) {
    const z = this.z, q = (window as unknown as { __e1spear?: boolean[] }).__e1spear;
    this.ui.toast(t('e1.sp.hint'));
    const sh = this.cookShot(camp, 1.3); this.player.workShot = { from: sh.from, to: sh.to };
    this.cook(camp, 4.2);
    let ok: boolean;
    if (q && q.length) { ok = q.shift()!; await new Promise((r) => setTimeout(r, 2000)); }
    else { const r = await this.tension({ kind: 'steady', seconds: 4 }); ok = !r || r.passed || this.burnt; }
    this.player.workShot = null;
    if (!ok) {
      // held in the flame: the point chars; he tests it on the ground and it snaps
      this.burnt = true;
      const { f } = this.axes(camp);
      this.playScene([
        { hold: 1.4, shot: () => this.cookShot(camp, 1.2), run: () => { this.cook(camp, 1.4, true); audio.sample('amb_fire', 0.35); } },
        { hold: 1.5, shot: () => this.scrapeShot(camp, 1.0), run: () => {
          // the point pressed into the ground at his knee: it snaps off
          const tip = this.kneel.clone().addScaledVector(f, 0.55); tip.y = this.world.terrain.height(tip.x, tip.z) + 0.02;
          const butt = tip.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(f, -0.5), dir = tip.clone().sub(butt).normalize();
          this.layStick(butt, dir);
          z.setHold({ R: { at: this.along(butt, dir, 0.9), fingers: f.clone(), palm: new THREE.Vector3(0, -1, 0), radius: 0.02 }, L: { at: this.along(butt, dir, 0.7), fingers: f.clone(), palm: new THREE.Vector3(0, -1, 0), radius: 0.02 } });
          this.after(0.6, () => { audio.sample('wood', 0.5, { rate: 1.4 }); const tp = this.stick!.children[1] as THREE.Mesh; tp.scale.set(1, 0.35, 1); tp.position.y = 1.53; });
        } },
        { key: 'e1.sp.burn', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => { z.setHold(null); this.dropStick(); z.setFace({ frown: 0.4 }); }, after: 0.3 },
      ], () => {
        // a new point scraped (the cut covers it)
        z.setFace(null); const tp = this.stick!.children[1] as THREE.Mesh; tp.scale.set(1, 1, 1); tp.position.y = 1.58; this.tipMat?.color.set(0xc9a77a);
        this.turn(made, camp);
      });
      return;
    }
    this.playScene([
      { hold: 1.8, shot: () => this.scrapeShot(camp, 1.3), run: () => {
        // out of the coals: the point dark and hard, held up to look at
        const L = this.lap(camp); this.layStick(L.butt, L.dir.clone().add(new THREE.Vector3(0, 0.5, 0)).normalize());
        z.setHold({ L: { at: this.along(L.butt, L.dir, 0.4), fingers: this.axes(camp).f, palm: new THREE.Vector3(0, -1, 0), radius: 0.02 } });
        z.setLookTarget(this.along(L.butt, L.dir.clone().add(new THREE.Vector3(0, 0.5, 0)).normalize(), 1.6)); audio.chime();
      } },
    ], () => {
      z.setHold(null); this.dropStick();
      this.s.flags['inv.fireSpear'] = true; // before made(): the spear it shows is the fire-hardened one
      made(); z.setLookTarget(null);
      this.ui.toast(t('e1.learn.spear'));
      this.vines(camp);
    });
  }

  /**
   * The vine he brought in (docs/COMBAT_API.md `vineTraps`): green, it bends and does not snap, so it is its own cord.
   * A running loop on a bent sapling and a line of stones across the path: what the night's set piece lets him set.
   */
  private vines(camp: THREE.Vector3) {
    const z = this.z, { f, r } = this.axes(camp);
    const work = this.kneel.clone().addScaledVector(f, -0.1).addScaledVector(r, 0.25).add(new THREE.Vector3(0, 0.45, 0));
    // the vine: a green line from fist to fist that sags as they come together and pulls straight as they spread, its
    // loose ends hanging out of each fist
    const green = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.8 });
    const segs = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 6), green); m.castShadow = true; return m; });
    const lay = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => { m.position.copy(a).lerp(b, 0.5); m.scale.set(1, a.distanceTo(b), 1); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); };
    const pull = (sec: number) => {
      const t0 = performance.now();
      for (const m of segs) this.world.scene.add(m);
      const step = () => {
        const k = (performance.now() - t0) / 1000;
        if (k > sec) { for (const m of segs) m.removeFromParent(); return; }
        // the vine between his fists, bent and pulled: the hands come together and spread again
        const w = 0.16 + 0.1 * Math.sin(k * 3.2);
        const a = work.clone().addScaledVector(r, -w), b = work.clone().addScaledVector(r, w);
        const sag = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -Math.max(0, 0.3 - w) * 0.9 - 0.01, 0));
        lay(segs[0], a, sag); lay(segs[1], sag, b);
        lay(segs[2], a, a.clone().addScaledVector(r, -0.05).add(new THREE.Vector3(0, -0.3, 0)));
        lay(segs[3], b, b.clone().addScaledVector(r, 0.05).add(new THREE.Vector3(0, -0.3, 0)));
        z.setHold({ L: { at: a, fingers: f.clone(), palm: r.clone(), radius: 0.02 }, R: { at: b, fingers: f.clone(), palm: r.clone().negate(), radius: 0.02 } });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    this.playScene([
      { key: 'e1.vn.1', who: 'scientist', shot: () => this.scrapeShot(camp, 1.25), run: () => { pull(5); z.setLookTarget(work); audio.sample('leather', 0.3, { rate: 0.6 }); } },
      { key: 'e1.vn.2', who: 'scientist', shot: () => cover.mid(z, -0.7, 2.2), run: () => { z.setHold(null); z.setLookTarget(this.kneel.clone().addScaledVector(f, -4).add(new THREE.Vector3(0, 0.3, 0))); this.after(0.8, () => audio.sample('cb_rattle', 0.3)); }, after: 0.4 },
    ], () => {
      this.s.flags['inv.vineTraps'] = true;
      this.ui.toast(t('e1.learn.vines'));
      z.setHold(null); z.setLookTarget(null); z.setLimbs(null); z.setKneel(false);
    });
  }

  /** The night: noises, stillness, the choice, then the fight (or the hiding) through the combat code. */
  night(done: (held: boolean) => void) {
    const z = this.z, s = this.s;
    this.playScene([
      { hold: 2.4, shot: () => cover.close(z, 0.45, 1.0), run: () => {
        this.sitAtFire(); z.setProp('flake');
        // beyond the light: a branch, then breathing; the knife hand stays still, only his eyes move
        this.after(0.4, () => audio.sample('wood', 0.35, { rate: 0.6 }));
        this.after(1.4, () => audio.sample('cb_growl', 0.25));
        z.setGazeRate(6); this.after(0.8, () => z.setLookTarget(this.player.pos.clone().addScaledVector(this.fwd(), -4).add(new THREE.Vector3(3, 1, 0))));
      } },
      { choice: 'e1.night', shot: () => cover.mid(z, 0.8, 2.4) },
    ], async () => {
      z.setGazeRate(null); z.setProp(null); z.setKneel(false); z.setLookTarget(null);
      const pick = s.branch?.log?.find((e) => e.id === 'e1.night')?.pick ?? 'hide';
      const story = { poisoned: !!s.flags.poisoned, cubKilled: !!s.flags['cub.killed'], fireHigh: !!s.flags['fire.high'], hurt: !!s.flags['hurt.zenvik'] };
      const cb = this.combat();
      let scarred = false;
      if (cb && pick === 'brace') { const o = await cb.startEncounter('night.defence', { story }); scarred = !!o.flags.scarred; }
      else if (cb && pick === 'run') { const o = await cb.startEncounter('chase.escape', { story: { poisoned: story.poisoned, hurt: story.hurt } }); scarred = !!o.flags.scarred; }
      else { const r = await this.tension({ kind: 'breath', count: 6, strain: story.poisoned ? 1.4 : 1 }); scarred = !!r && !r.passed; }
      if (scarred) s.flags.scarred = true;
      this.after(1.2, () => this.playScene([
        { key: scarred ? 'e1.ni.scar' : 'e1.ni.held', who: 'scientist', shot: () => cover.close(z, 0.35, 0.95), run: () => z.setFace(scarred ? { frown: 0.5, squint: 0.4 } : { smile: 0.2 }), after: 0.6 },
      ], () => { z.setFace(null); done(!scarred); this.dawn(); }));
    });
  }

  /**
   * 1.9 step 4, dawn: he has not slept. A long shot of the fire, out, a thread of smoke, and him sitting at it with
   * the spear across his knees; closer, his eyes open on the ashes; the blackened point; a breath out, and he looks up
   * at the light. No line: the night has said enough. Sets `slept` (the level's end; he did not) and `e1.dawn`; the
   * fire stays out (`e1.fireOut`) through level 8 (the ridge); by level 9 he has it going again, off screen.
   */
  dawn() {
    const z = this.z, s = this.s, camp = this.world.camp;
    this.ui.fade('black', 1, 1.2);
    this.after(1.4, () => {
      s.timeOfDay = 6.15; s.flags['e1.fireOut'] = true; camp.setFire(1);
      const c = this.sitAtFire(), { f, r } = this.axes(c);
      z.setProp(null); z.setLimbs({ bend: 0.35 });
      // the spear across his knees, the point out to his right, blackened
      const L = this.lap(c); this.layStick(L.butt.clone().add(new THREE.Vector3(0, -0.04, 0)), L.dir.clone().setY(0.03).normalize());
      this.tipMat?.color.setHex(0x2a1d14);
      const smoke = this.smokeAt(c.clone().add(new THREE.Vector3(0, 0.12, 0)));
      const east = this.kneel.clone().add(new THREE.Vector3(8, 2.5, 0));
      this.ui.fade('black', 0, 2.2);
      this.playScene([
        // wide and low across the dead fire: the ring, the smoke, him beyond it
        { hold: 5.2, shot: () => ({ from: c.clone().addScaledVector(f, 5.5).addScaledVector(r, 1.4).add(new THREE.Vector3(0, 1.05, 0)), to: c.clone().addScaledVector(f, -0.6).add(new THREE.Vector3(0, 0.45, 0)), push: 0.03 }),
          run: () => { z.setLookTarget(c.clone().add(new THREE.Vector3(0, 0.1, 0))); z.setFace({ squint: 0.35 }); } },
        // his face from the fire's side, a little to his left (cover.close framed the back of his head here)
        { hold: 3.6, shot: () => { const h = new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld); return { from: h.clone().addScaledVector(f, 0.95).addScaledVector(r, -0.4).add(new THREE.Vector3(0, -0.08, 0)), to: h.clone().add(new THREE.Vector3(0, -0.04, 0)), push: 0.01 }; }, run: () => { z.setFace({ squint: 0.45, frown: 0.15 }); this.after(1.6, () => z.setFace({ blink: 1 })); this.after(1.85, () => z.setFace({ squint: 0.45 })); } },
        { hold: 2.6, shot: () => { const m = this.along(L.butt, L.dir, 1.25); return { from: m.clone().addScaledVector(f, -0.55).addScaledVector(r, 0.35).add(new THREE.Vector3(0, 0.35, 0)), to: m.clone(), push: 0.01 }; } },
        { hold: 3.4, shot: () => cover.mid(z, -0.6, 2.3), run: () => { audio.human('breath', 0.6); this.after(0.9, () => z.setLookTarget(east)); z.setFace({ squint: 0.25 }); } },
      ], () => {
        smoke(); this.dropStick(); z.setFace(null); z.setLookTarget(null); z.setLimbs(null); z.setKneel(false);
        s.flags['e1.dawn'] = true; s.flags.slept = true;
      });
    });
  }

  /** A thin grey thread off the ashes; returns how to put it away. */
  private smokeAt(at: THREE.Vector3) {
    const N = 40, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // soft round puffs, not square points (the plain points read as a dotted white line, e169v4)
    const S = 32, px = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2), k = (y * S + x) * 4; px[k] = px[k + 1] = px[k + 2] = 255; px[k + 3] = Math.round(255 * Math.max(0, 1 - d) ** 2); }
    const tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const m = new THREE.PointsMaterial({ color: 0xa8a49c, map: tex, size: 0.35, transparent: true, opacity: 0.16, depthWrite: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    const t0 = performance.now();
    pts.onBeforeRender = () => {
      const k = (performance.now() - t0) / 1000;
      for (let i = 0; i < N; i++) {
        const a = (k * 0.18 + i / N) % 1, sw = Math.sin(i * 5.3 + k * 0.7) * 0.12 * a + a * a * 0.5;
        pos[i * 3] = at.x + sw; pos[i * 3 + 1] = at.y + a * 2.2; pos[i * 3 + 2] = at.z + Math.cos(i * 2.1 + k * 0.5) * 0.08 * a;
      }
      g.attributes.position.needsUpdate = true;
    };
    this.world.scene.add(pts);
    return () => { pts.removeFromParent(); g.dispose(); m.dispose(); tex.dispose(); };
  }
}
