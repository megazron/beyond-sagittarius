import * as THREE from 'three';
import { audio } from '../core/audio';
import { t } from '../i18n';
import type { Action } from './story';
import type { TechNode } from './tech/data';
import { LAKE } from '../world/terrain';
import { cover, type Beat, type Shot } from '../cinematic/cutscene';
import { test, type Cond } from './branch';
import { ep3Loaded } from './branch/episode3';
import { isDiscovered } from './tech/tech';
import { Episode2 } from './episode2';

const CHOSE = (d: string, o: string): Cond => ({ chose: [d, o] });
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
type Site = 'rise' | 'reeds' | 'camp';
const SITES: Site[] = ['camp', 'reeds', 'rise'];

/**
 * Episode Three, "A Place to Stay" (levels 15 to 21; script and choices: the private story folder). Age 2 after the
 * pot, in the tree's order: a place above the flood line and the polished stone axe (15), a post-and-beam house with a
 * lever and a brace (16), the wheat and the first field (17), the infected cut and the one dose (18), Draxum's wall on
 * Methryx (19), the ditch and the tame animal (20), the harvest, the store, the storm and the stranger (21).
 *
 * It shares Episode Two's helpers (where he kneels, the shots, the scene and time cards). Built so far: level 15. The
 * levels after it are not built yet (ui.ts PLAYABLE_LEVELS stops there and the episode says so). All progress is flags
 * on the save (`e3.*`), so a reload goes on from the last beat.
 */
export class Episode3 extends Episode2 {
  private flood: THREE.Group | null = null;
  private restored3 = false;

  /** Levels 15 to 21 are this episode's. */
  override owns(n: number) { return n >= 15 && n <= 21; }
  override hidesExplorer() { return this.s.level >= 15; }

  override done(n: number): boolean {
    if (n === 15) return isDiscovered(this.s, 'polish') && this.f('e3.felled');
    return false;
  }
  override craftOpen(n: number) {
    if (n === 15) return this.f('e3.axeTried');
    return false;
  }
  override progress(n: number): string | null {
    if (n !== 15) return null;
    if (!this.f('e3.l15.intro')) return null;
    if (!this.f('e3.siteDone')) return t('e3.obj.site', { n: SITES.filter((k) => this.f(`e3.seen.${k}`)).length });
    if (!this.f('e3.axeTried')) return t('e3.obj.axe');
    return null;
  }
  override marker(n: number): THREE.Vector3 | null {
    if (n !== 15 || !this.f('e3.l15.intro')) return null;
    if (!this.f('e3.siteDone')) { const k = this.nextSite(); return k ? this.siteAt(k) : null; }
    if (!this.f('e3.axeTried')) return this.saplingAt();
    return null;
  }
  override actions(): Action[] { return []; }
  override debug() { const p = this.player.pos; return { wait: +this.wait.toFixed(2), busy: this.busy, loaded: ep3Loaded(), free: this.free(), level: this.s.level, at: [+p.x.toFixed(1), +p.z.toFixed(1)], shelter: null }; }

  // ------------------------------------------------------------------ the world, each frame
  override update(dt: number) {
    const s = this.s;
    if (s.level < 15) return;
    if (this.world.explorer.root.visible) this.world.explorer.root.visible = false;
    if (!this.quieted) { this.quieted = true; this.world.ridge.quiet?.(); }
    // what Episode Two left in the world (after a reload the Episode Two controller no longer builds it)
    if (!this.restored3) { this.restored3 = true; this.buildShelter(); if (this.f('e2.cairnDone')) this.buildCairn(true); }
    this.wait -= dt;
    if (this.wait > 0 || this.busy || !ep3Loaded() || !this.free()) return;
    // the levels after 15 are not built yet: say so once, plainly
    if (s.level > 15) { if (!this.f('e3.wipShown')) { this.set('e3.wipShown'); this.ui.banner(t('e3.title'), t('e3.wip')); } return; }
    if (!this.f('e3.l15.intro')) { this.intro15(); return; }
    if (!this.f('e3.siteDone')) {
      const p = this.player.pos;
      for (const k of SITES) {
        if (this.f(`e3.seen.${k}`)) continue;
        const a = this.siteAt(k);
        if (Math.hypot(p.x - a.x, p.z - a.z) < 4.5) { this.seeSite(k); return; }
      }
      return;
    }
    if (!this.f('e3.axeTried')) {
      const a = this.saplingAt(), p = this.player.pos;
      if (Math.hypot(p.x - a.x, p.z - a.z) < 3.5) { this.axeScene(); return; }
    }
  }

  // ------------------------------------------------------------------ places
  /** The three places he can build: the rise by the rock shelter, the reed beds where the Fennish camp, the old camp. */
  siteAt(k: Site): THREE.Vector3 {
    if (k === 'camp') return this.L.camp.clone();
    if (k === 'rise') { const S = this.shelter(); const back = v3(Math.sin(S.facing), 0, Math.cos(S.facing)); const at = S.at.clone().addScaledVector(back, -6); at.y = this.h(at.x, at.z); return at; }
    // the reeds: on the shore on Oom-Sa's side of the camp, the first dry ground coming in from the water
    const home = this.L.camp.clone().add(v3(9, 0, 7)), d = v3(home.x - LAKE.x, 0, home.z - LAKE.z).normalize();
    for (let r = LAKE.r - 4; r < LAKE.r + 40; r += 1) {
      const x = LAKE.x + d.x * r, z = LAKE.z + d.z * r;
      if (this.world.terrain.height(x, z) > 0.6) return v3(x, this.h(x, z), z);
    }
    return home;
  }
  private nextSite(): Site | null {
    const p = this.player.pos, left = SITES.filter((k) => !this.f(`e3.seen.${k}`));
    left.sort((a, b) => this.siteAt(a).distanceTo(p) - this.siteAt(b).distanceTo(p));
    return left[0] ?? null;
  }
  /** A young straight tree at the forest edge near the camp: the one the chipped axe bounces off, then the felled one. */
  private saplingAt() {
    const c = this.L.camp, d = v3(LAKE.x - c.x, 0, LAKE.z - c.z).normalize(), side = this.side(d);
    for (const k of [7, 9, 11, 13]) for (const sgn of [-1, 1]) {
      const at = c.clone().addScaledVector(side, k * sgn).addScaledVector(d, -4);
      at.y = this.h(at.x, at.z);
      if (at.y > 0.6 && !this.world.forest.blocks(at.x, at.z, 0.6)) return at;
    }
    const at = c.clone().addScaledVector(side, 8); at.y = this.h(at.x, at.z); return at;
  }
  private sapling: THREE.Group | null = null;
  private buildSapling() {
    if (this.sapling) return this.sapling;
    const g = new THREE.Group(), at = this.saplingAt();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3.2, 8).translate(0, 1.6, 0), std(0x6a5440));
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1).translate(0, 3.1, 0), std(0x4f6b2e, { roughness: 0.9 }));
    crown.scale.set(1, 1.3, 1);
    for (const m of [trunk, crown]) { m.castShadow = true; g.add(m); }
    g.position.copy(at); this.group.add(g); this.sapling = g;
    return g;
  }

  // ------------------------------------------------------------------ 3.1 the flood line (level 15)
  private intro15() {
    this.set('e3.l15.intro');
    this.set('ch2Intro');
    this.busy = true;
    this.passTime(8.4, true, 'e3.day', () => {
      this.ui.banner(t('e3.title'), t('e3.sub'));
      const z = this.z, c = this.L.camp, toLake = v3(LAKE.x - c.x, 0, LAKE.z - c.z).normalize();
      // the lake has come up over the camp's low side: brown water to the ankle, a pot that floated off and cracked
      // two nights of rain put the fire out (it is relit at the work by the slab: craft scene)
      this.set('e1.fireOut'); this.world.camp.setFire(1);
      this.buildFlood();
      const at = this.settle(c.clone().addScaledVector(toLake, 2.2), c.clone().addScaledVector(toLake, 9), false);
      const pot = this.crackedPot(c.clone().addScaledVector(toLake, 3.0).addScaledVector(this.side(toLake), 0.6));
      this.scene([
        { hold: 3.4, shot: () => this.wide(at, 7.5, 0.55, 0.7), run: () => { z.setLookTarget(c.clone().addScaledVector(toLake, 9)); audio.sample('amb_rain', 0.25, { dur: 4 }); } },
        { hold: 2.0, shot: () => ({ from: pot.position.clone().add(v3(0.45, 0.3, 0.35)), to: pot.position.clone().add(v3(0, 0.08, 0)), push: 0.01, aperture: 0.005, fov: 30, lightAt: pot.position.clone() }) },
        { key: 'e3.fl.1', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { z.setFace({ frown: 0.3 }); z.setLookTarget(this.ahead()); } },
        { key: 'e3.fl.2', who: 'scientist', shot: () => cover.mid(z, -0.55, 2.2), run: () => z.setFace(null) },
        { hold: 6.0, shot: () => cover.mid(z, 0.7, 2.6), run: () => { z.setLookTarget(c.clone().addScaledVector(toLake, 6).add(v3(0, -0.2, 0))); this.ui.memory('e3.fl.bolzar', 7); } },
      ], () => { this.clearHands(); this.ui.toast(t('level.15.hint')); });
    });
  }
  private buildFlood() {
    if (this.flood) return;
    const c = this.L.camp, toLake = v3(LAKE.x - c.x, 0, LAKE.z - c.z).normalize(), g = new THREE.Group();
    // the low side towards the lake, the fire on its edge, not in it
    const at = c.clone().addScaledVector(toLake, 5.2);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.6, 28), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.86 }));
    water.rotation.x = -Math.PI / 2; water.scale.set(1.6, 1, 1); water.rotation.z = -Math.atan2(toLake.z, toLake.x);
    water.position.set(at.x, Math.max(this.h(at.x, at.z), this.h(c.x, c.z) - 0.05) + 0.04, at.z);
    g.add(water);
    // the strandline: drift, reed stems and foam in a ridge along the bank a little higher up
    const drift = std(0x8a7a5a, { roughness: 1 });
    for (let i = 0; i < 22; i++) {
      const a = (i / 21 - 0.5) * 2.4, p = c.clone().addScaledVector(toLake, 0.4).addScaledVector(this.side(toLake), a * 3.2);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35 + (i % 3) * 0.12, 4), drift);
      m.position.set(p.x, this.h(p.x, p.z) + 0.02, p.z); m.rotation.set(Math.PI / 2, 0, i * 0.7); g.add(m);
    }
    this.group.add(g); this.flood = g;
  }
  private crackedPot(at: THREE.Vector3) {
    const pts = [v3(0.0, 0), v3(0.075, 0), v3(0.09, 0.04), v3(0.095, 0.1), v3(0.085, 0.16), v3(0.07, 0.2), v3(0.075, 0.22)].map((p) => new THREE.Vector2(p.x, p.y));
    const m = this.mesh(new THREE.LatheGeometry(pts, 16, 0, Math.PI * 1.55), std(0xa0623c, { side: THREE.DoubleSide, roughness: 0.7 }), at.clone().setY(this.h(at.x, at.z) + 0.02));
    m.rotation.set(0.9, 0.4, 0.2);
    return m;
  }

  /** Each place in turn: a line where he stands, looking at it; after the third, the choice. */
  private seeSite(k: Site) {
    this.set(`e3.seen.${k}`);
    const z = this.z, a = this.siteAt(k), p = this.player.pos.clone();
    const look = a.clone().add(v3(0, 1.0, 0));
    const lowTrust = k === 'reeds' && (this.trust() < 1 || this.f('e2.oomsa.away'));
    const key = k === 'rise' ? 'e3.fl.rise' : k === 'camp' ? 'e3.fl.camp' : lowTrust ? 'e3.fl.reeds.low' : 'e3.fl.reeds';
    const all = SITES.every((q) => this.f(`e3.seen.${q}`));
    const me = this.settle(p, a.distanceTo(p) < 1 ? p.clone().add(v3(0, 0, 3)) : a, false);
    const beats: Beat[] = [
      { hold: 2.4, shot: () => { const f = this.fwd(); return { from: me.clone().addScaledVector(f, -3.2).addScaledVector(this.side(f), 1.1).add(v3(0, 1.75, 0)), to: look.clone().addScaledVector(f, 2), push: 0.04, fov: 45 }; }, run: () => z.setLookTarget(look) },
      { key, who: 'scientist', shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
    ];
    if (all) {
      beats.push(
        { choice: 'e3.site', shot: () => cover.mid(z, 0.55, 2.3) },
        { key: 'e3.st.rise', who: 'scientist', if: CHOSE('e3.site', 'rise'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
        { key: 'e3.st.reeds', who: 'scientist', if: CHOSE('e3.site', 'reeds'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
        { key: 'e3.st.camp', who: 'scientist', if: CHOSE('e3.site', 'camp'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      );
    }
    this.scene(beats, () => {
      this.clearHands();
      if (all) { this.set('e3.siteDone'); this.ui.toast(t('e3.obj.axe')); this.buildSapling(); }
    });
  }

  // ------------------------------------------------------------------ 3.2 grind, don't hit
  /** The chipped hand axe bounces off green wood: he needs a ground edge. */
  private axeScene() {
    this.set('e3.axeTried');
    const z = this.z, tree = this.buildSapling(), at = tree.position.clone();
    const me = this.settle(at.clone().add(this.player.pos.clone().sub(at).setY(0).normalize().multiplyScalar(0.85)), at, false);
    const f = this.fwd(), r = this.right(f);
    const hit = at.clone().add(v3(0, 0.95, 0)).addScaledVector(f, -0.05);
    const rock = this.mesh(new THREE.OctahedronGeometry(0.06, 0), std(0xa8a090, { roughness: 0.55, flatShading: true }), hit.clone());
    rock.scale.set(0.7, 0.3, 1.3);
    const swing = (k: number) => {
      // up over his right shoulder, then down and across into the trunk at waist height
      const u = Math.min(1, k), back = me.clone().add(v3(0, 1.55, 0)).addScaledVector(r, 0.35).addScaledVector(f, -0.05);
      const hand = back.clone().lerp(hit.clone().addScaledVector(f, -0.08), u < 0.6 ? 0 : (u - 0.6) / 0.4);
      rock.position.copy(hand.clone().addScaledVector(f, 0.06));
      z.setHold({ R: { at: hand, fingers: f.clone(), palm: r.clone().negate(), radius: 0.03, grasp: true } });
    };
    swing(0);
    this.scene([
      { hold: 2.6, shot: () => this.wide(me, 3.6, 0.8, 0.4), run: () => {
        z.setLookTarget(hit);
        for (const t0 of [0.2, 1.3]) this.after(t0, () => { this.anim(0.7, (k) => swing(k / 0.7)); this.after(0.62, () => { audio.sample('wood', 0.55, { rate: 1.2 }); tree.rotation.z = 0.03; this.after(0.15, () => { tree.rotation.z = 0; }); }); });
      } },
      { key: 'e3.ax.1', who: 'scientist', shot: () => cover.close(z, -0.4, 0.95, 0.24), run: () => { swing(0); z.setFace({ frown: 0.35 }); z.setLookTarget(this.ahead()); } },
      { hold: 6.5, shot: () => cover.mid(z, 0.6, 2.2), run: () => { z.setFace(null); z.setLookTarget(rock.position); this.ui.memory('e3.ax.drax', 7); } },
    ], () => { rock.removeFromParent(); this.clearHands(); this.ui.toast(t('level.15.hint2')); });
  }

  // ------------------------------------------------------------------ the craft panel's scenes
  override beforeCraft(n: TechNode, open: () => void): boolean {
    if (!this.owns(this.s.level)) return false;
    if (n.id !== 'polish') return false;
    // both hands on the roughed-out head, pushing it in long strokes on a wet flat stone with sand on it
    this.set('e1.fireOut', false); this.world.camp.setFire(2);
    const z = this.z, at = this.settleWork(2.6), f = this.fwd(), r = this.right(f);
    const slab = this.mesh(new THREE.BoxGeometry(0.42, 0.07, 0.26), std(0x9a8670, { roughness: 0.6 }), at.clone().addScaledVector(f, 0.5).add(v3(0, 0.035, 0)));
    slab.rotation.y = z.root.rotation.y + Math.PI / 2;
    const wet = this.mesh(new THREE.PlaneGeometry(0.34, 0.2), std(0x6f6050, { roughness: 0.12, transparent: true, opacity: 0.7 }), slab.position.clone().add(v3(0, 0.037, 0)));
    wet.rotation.set(-Math.PI / 2, 0, z.root.rotation.y + Math.PI / 2);
    const head = this.mesh(new THREE.OctahedronGeometry(0.06, 1), std(0x4a5a4a, { roughness: 0.4 }), slab.position.clone().add(v3(0, 0.07, 0)));
    head.scale.set(0.8, 0.35, 1.5);
    const top = slab.position.clone().add(v3(0, 0.07, 0));
    const grip = (k: number) => {
      const w = Math.sin(k * 4.2) * 0.12, c = top.clone().addScaledVector(f, w);
      head.position.copy(c); head.rotation.y = z.root.rotation.y;
      z.setHold({ L: { at: c.clone().addScaledVector(r, -0.06).add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true }, R: { at: c.clone().addScaledVector(r, 0.06).add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true } });
    };
    grip(0);
    const lat = this.side(f); if (lat.dot(top.clone().sub(this.L.camp)) < 0) lat.negate();
    const insert = (): Shot => { const from = top.clone().addScaledVector(f, 0.95).addScaledVector(lat, 0.45).add(v3(0, 0.3, 0)); from.y = Math.max(from.y, this.h(from.x, from.z) + 0.35); return { from, to: top.clone().add(v3(0, 0.04, 0)), fov: 36, push: 0.015, aperture: 0.004, lightAt: top.clone() }; };
    this.scene([
      { hold: 4.0, shot: insert, run: () => { z.setLookTarget(top); this.anim(4, (k) => { grip(k); if (Math.random() < 0.06) audio.sample('stone', 0.12, { rate: 0.7 }); }); } },
    ], () => { slab.removeFromParent(); wet.removeFromParent(); head.removeFromParent(); this.clearHands(); open(); });
    return true;
  }
  override craftFailed(id: string, step: number): boolean {
    if (!this.owns(this.s.level) || id !== 'polish') return false;
    this.set('e3.failed.polish');
    this.say(step === 0 ? 'e3.ax.rhythm' : this.f('e3.ax.saidDry') ? 'e3.ax.wet' : 'e3.ax.dry', 'scientist', 4.5);
    if (step !== 0) this.set('e3.ax.saidDry');
    return true;
  }
  override crafted(n: TechNode, card: () => void): boolean {
    if (!this.owns(this.s.level) || n.id !== 'polish') return false;
    this.busy = true;
    this.passTime(10.5, true, 'e3.later', () => this.fell(card));
    return true;
  }
  /** Three days on: the ground head hafted, four clean strokes, the sapling down. */
  private fell(card: () => void) {
    this.busy = true;
    const z = this.z, tree = this.buildSapling(), at = tree.position.clone();
    const me = this.settle(at.clone().add(this.L.camp.clone().sub(at).setY(0).normalize().multiplyScalar(0.95)), at, false);
    const f = this.fwd(), r = this.right(f);
    // the axe: a ground green-stone head set through a split haft, bound with cord and glued
    const axe = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 7).translate(0, 0.31, 0), std(0x6a4e3a)); axe.add(haft);
    const hd = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 1), std(0x4a5a4a, { roughness: 0.3 })); hd.scale.set(0.35, 0.8, 1.5); hd.position.set(0, 0.56, 0.06); axe.add(hd);
    const bind = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 7), std(0xa88a5c, { roughness: 0.95 })); bind.position.y = 0.53; axe.add(bind);
    axe.traverse((o) => { (o as THREE.Mesh).castShadow = true; }); this.group.add(axe);
    const hit = at.clone().add(v3(0, 0.7, 0));
    const pose = (k: number) => {
      // both hands on the haft, raised over the right shoulder, down and across into the trunk
      const u = Math.min(1, k), lift = me.clone().add(v3(0, 1.6, 0)).addScaledVector(r, 0.3);
      const strike = hit.clone().addScaledVector(f, -0.55);
      const hand = lift.clone().lerp(strike, u < 0.55 ? 0 : Math.min(1, (u - 0.55) / 0.3));
      const dir = hit.clone().sub(hand).normalize();
      axe.position.copy(hand); axe.quaternion.setFromUnitVectors(UP, dir);
      z.setHold({ R: { at: hand.clone().addScaledVector(dir, 0.08), fingers: r.clone().negate(), palm: dir.clone().cross(r).normalize(), radius: 0.02, grasp: true }, L: { at: hand.clone().addScaledVector(dir, -0.02), fingers: r.clone().negate(), palm: dir.clone().cross(r).normalize(), radius: 0.02, grasp: true } });
    };
    pose(0);
    let down = 0;
    this.scene([
      { hold: 5.6, shot: () => this.wide(me, 4.2, 0.85, 0.5), run: () => {
        z.setLookTarget(hit);
        for (let i = 0; i < 4; i++) this.after(0.25 + i * 1.2, () => { this.anim(0.9, (k) => pose(k / 0.9)); this.after(0.78, () => { audio.sample('wood', 0.8, { rate: 0.9 + i * 0.05 }); }); });
        this.after(5.0, () => { audio.sample('wood', 0.7, { rate: 0.6 }); this.anim(1.4, (k) => { down = Math.min(1, (k / 1.4) ** 2); tree.rotation.set(0, 0, 0); tree.rotateOnWorldAxis(r, down * 1.45); }); });
      } },
      { key: 'e3.ax.ok', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { pose(0); z.setFace({ smile: 0.25 }); z.setLookTarget(this.ahead()); } },
    ], () => {
      axe.removeFromParent(); this.clearHands();
      this.set('inv.polishedAxe'); this.ui.toast(t('e3.learn.polish'));
      this.set('e3.felled');
      this.busy = false;
      card();
    });
    void down;
  }
}

/** Episode Three's choices that test a flag; kept so the sealed data and the code agree on names (story_check reads it). */
export const E3_FLAGS = ['e3.site.rise', 'e3.site.reeds', 'e3.site.camp'];
void test;
