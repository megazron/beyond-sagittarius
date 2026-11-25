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
import { TECH_BY_ID } from './tech/data';
import { apply, type StoryState } from './branch';
import { createCharacter, type Character } from '../characters/character';
import { defaultLook, LINEAGES, type PlayerLook } from '../characters/custom';
import type { Who } from '../cinematic/cutscene';
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
 * lever and a brace (16), grain and the first field (17), basic medicine (18), an interlude on another world (19),
 * irrigation and a tame animal (20), the harvest and the store (21).
 *
 * It shares Episode Two's helpers (where he kneels, the shots, the scene and time cards). Built so far: level 15. The
 * levels after it are not built yet (ui.ts PLAYABLE_LEVELS stops there and the episode says so). All progress is flags
 * on the save (`e3.*`), so a reload goes on from the last beat.
 */
export class Episode3 extends Episode2 {
  private flood: THREE.Group | null = null;
  private restored3 = false;
  private blockedT = 0;

  /** Levels 15 to 21 are this episode's. */
  override owns(n: number) { return n >= 15 && n <= 21; }
  override hidesExplorer() { return this.s.level >= 15; }

  override done(n: number): boolean {
    if (n === 15) return isDiscovered(this.s, 'polish') && this.f('e3.felled');
    if (n === 16) return isDiscovered(this.s, 'frame') && this.f('e3.houseDone');
    if (n === 17) return isDiscovered(this.s, 'farming') && this.f('inv.farming');
    return false;
  }
  override craftOpen(n: number) {
    if (n === 15) return this.f('e3.axeTried');
    if (n === 16) return this.f('e3.l16.intro') && (!this.campSite() || this.f('e3.ditch'));
    if (n === 17) return this.f('e3.wheat') && (isDiscovered(this.s, 'grain') ? this.f('e3.fieldIntro') : true);
    return false;
  }
  /** Where the level's work is done (the frame goes up at the house, not by the fire). */
  override craftAt(n: number) { return n === 16 ? this.houseAt() : n === 17 ? (isDiscovered(this.s, 'grain') ? this.fieldAt() : this.quernAt()) : null; }
  /** Level 17 grinds grain at Hoh-Ma's quern before the field (the level's own discovery). */
  override craftNode(n: number) { return n === 17 && !isDiscovered(this.s, 'grain') ? TECH_BY_ID.grain : null; }
  override progress(n: number): string | null {
    if (n === 17) {
      if (!this.f('e3.l17.intro')) return null;
      if (!this.f('e3.wheat')) return t('e3.obj.camp');
      if (!isDiscovered(this.s, 'grain')) return this.has('grain') ? t('e3.obj.grind') : null;
      if (!this.f('e3.fieldIntro')) return t('e3.obj.field');
      return this.has('farming') ? t('e3.obj.sow') : null;
    }
    if (n === 16) {
      if (!this.f('e3.l16.intro')) return null;
      if (this.campSite() && !this.f('e3.ditch')) return t('e3.obj.ditch');
      return this.has('frame') ? t('e3.obj.frame') : null;
    }
    if (n !== 15) return null;
    if (!this.f('e3.l15.intro')) return null;
    if (!this.f('e3.siteDone')) return t('e3.obj.site', { n: SITES.filter((k) => this.f(`e3.seen.${k}`)).length });
    if (!this.f('e3.axeTried')) return t('e3.obj.axe');
    return null;
  }
  override marker(n: number): THREE.Vector3 | null {
    if (n === 17) {
      if (!this.f('e3.l17.intro')) return null;
      if (!this.f('e3.wheat')) return this.fennAt();
      if (!isDiscovered(this.s, 'grain')) return this.has('grain') ? this.quernAt() : null;
      if (!this.f('e3.fieldIntro')) return this.fieldAt();
      return this.has('farming') ? this.fieldAt() : null;
    }
    if (n === 16) {
      if (!this.f('e3.l16.intro')) return null;
      if (this.campSite() && !this.f('e3.ditch')) return this.houseAt();
      return this.has('frame') ? this.houseAt() : null;
    }
    if (n !== 15 || !this.f('e3.l15.intro')) return null;
    if (!this.f('e3.siteDone')) { const k = this.nextSite(); return k ? this.siteAt(k) : null; }
    if (!this.f('e3.axeTried')) return this.saplingAt();
    return null;
  }
  override actions(): Action[] { return []; }
  override debug() { const p = this.player.pos; return { wait: +this.wait.toFixed(2), busy: this.busy, loaded: ep3Loaded(), free: this.free(), level: this.s.level, at: [+p.x.toFixed(1), +p.z.toFixed(1)], shelter: null, house: this.houseG ? { parts: this.meshCount(this.houseG), key: this.houseKey, at: [+this.house().at.x.toFixed(1), +this.house().at.z.toFixed(1)] } : null, kneel: +this.z.root.position.y.toFixed(2), field: this.fieldG ? { rows: this.fieldRows.length, at: [+this.fieldAt().x.toFixed(1), +this.fieldAt().z.toFixed(1)] } : null, fenn: this.fennG ? [+this.fennAt().x.toFixed(1), +this.fennAt().z.toFixed(1)] : null }; }

  // ------------------------------------------------------------------ the world, each frame
  override update(dt: number) {
    const s = this.s;
    if (s.level < 15) return;
    if (this.world.explorer.root.visible) this.world.explorer.root.visible = false;
    if (!this.quieted) { this.quieted = true; this.world.ridge.quiet?.(); }
    // what Episode Two left in the world (after a reload the Episode Two controller no longer builds it)
    if (!this.restored3) { this.restored3 = true; this.buildShelter(); if (this.f('e2.cairnDone')) this.buildCairn(true); }
    this.restoreHouse();
    this.restoreField();
    this.updateFolk(dt);
    this.wait -= dt;
    // a story beat waiting only because an animal hangs about near him (CI levels_smoke stood at level 15 for 150 rounds,
    // free() false, 'engaged'): after 10 s it loses interest and goes
    if (this.wait <= 0 && !this.busy && ep3Loaded() && !this.free() && this.combat() && !(this.combat() as { encounter?: unknown }).encounter) {
      this.blockedT += dt;
      if (this.blockedT > 10) { this.blockedT = 0; this.combat()?.scatter?.(); }
    } else this.blockedT = 0;
    if (this.wait > 0 || this.busy || !ep3Loaded() || !this.free()) return;
    if (s.level === 16) { this.update16(); return; }
    if (s.level === 17) { this.update17(); return; }
    // the levels after 17 are not built yet: say so once, plainly
    if (s.level > 17) { if (!this.f('e3.wipShown')) { this.set('e3.wipShown'); this.ui.banner(t('e3.title'), t('e3.wip')); } return; }
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
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.6, 28), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.38, metalness: 0, transparent: true, opacity: 0.86 }) /* (at 0.08 the scene lamps shone in it as two suns, GPU take) */);
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
      // by the time he has walked all three the water has gone back down (the flood is gone after a reload too)
      if (all) { this.set('e3.siteDone'); this.ui.toast(t('e3.obj.axe')); this.buildSapling(); this.flood?.removeFromParent(); this.flood = null; }
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
    if (n.id === 'frame') return this.beforeFrame(open);
    if (n.id === 'grain') return this.beforeGrain(open);
    if (n.id === 'farming') return this.beforeSow(open);
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
  override craftFailed(id: string, step: number, info?: { v: number; band: [number, number] }): boolean {
    if (this.owns(this.s.level) && id === 'grain') {
      const high = !!info && info.v > info.band[1];
      const key = step === 0 ? (this.f('e3.gr.grit') ? 'e3.gr.rhythm' : 'e3.gr.grit') : high ? 'e3.gr.burnt' : 'e3.gr.dough';
      if (step === 0) this.set('e3.gr.grit');
      this.set('e3.failed.grain'); this.say(key, 'scientist', 4.5); return true;
    }
    if (this.owns(this.s.level) && id === 'farming') {
      const high = !!info && info.v > info.band[1];
      this.set('e3.failed.farming'); this.say(step === 0 ? (high ? 'e3.fd.deep' : 'e3.fd.shallow') : 'e3.fd.rows', 'scientist', 4.5); return true;
    }
    if (this.owns(this.s.level) && id === 'frame') { this.set('e3.failed.frame'); this.say(step === 0 ? 'e3.fr.tap' : 'e3.fr.lever', 'scientist', 4.5); return true; }
    if (!this.owns(this.s.level) || id !== 'polish') return false;
    this.set('e3.failed.polish');
    this.say(step === 0 ? 'e3.ax.rhythm' : this.f('e3.ax.saidDry') ? 'e3.ax.wet' : 'e3.ax.dry', 'scientist', 4.5);
    if (step !== 0) this.set('e3.ax.saidDry');
    return true;
  }
  override crafted(n: TechNode, card: () => void): boolean {
    if (this.owns(this.s.level) && n.id === 'frame') { this.raiseFrame(card); return true; }
    if (this.owns(this.s.level) && n.id === 'grain') { this.breadScene(card); return true; }
    if (this.owns(this.s.level) && n.id === 'farming') { this.sowScene(card); return true; }
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
  // ------------------------------------------------------------------ level 16: posts and a beam (3.3, 3.4)
  /** Each level-16 scene's timers and per-frame poses stop when it ends (a skipped scene left the hands posed and the frame
   *  swaying): `live()` hands out anim/after bound to the scene now running. */
  private tok = 0;
  private live() {
    const k = ++this.tok;
    return {
      anim: (sec: number, fn: (x: number) => void) => this.anim(sec, (x) => { if (k === this.tok) fn(x); }),
      after: (sec: number, fn: () => void) => this.after(sec, () => { if (k === this.tok) fn(); }),
      end: () => { if (k === this.tok) this.tok++; },
    };
  }
  private campSite() { return !this.f('e3.site.rise') && !this.f('e3.site.reeds'); }
  private siteNow(): Site { return this.f('e3.site.rise') ? 'rise' : this.f('e3.site.reeds') ? 'reeds' : 'camp'; }
  /** Everything a node needs is in his hands. */
  private has(id: string) { const n = TECH_BY_ID[id]; return !!n && Object.entries(n.ingredients).every(([k, c]) => this.inv(k) >= c); }
  private houseSpot: { at: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; site: Site } | null = null;
  /** The house's floor centre and its axes: `a` along the ridge (towards the lake), `b` across it. Flat ground near the
   *  chosen place, clear of the fire, the lean-to and the trees. */
  private house() {
    const site = this.siteNow();
    if (this.houseSpot?.site === site) return this.houseSpot;
    const base = this.siteAt(site), c = this.L.camp;
    const lean = (this.world.camp as unknown as { shelterAt?(): { at: THREE.Vector3 } }).shelterAt?.().at;
    let best = base.clone(), score = -1e9;
    for (let r = site === 'camp' ? 4.5 : 0; r <= 9; r += 1.5) for (let i = 0; i < (r ? 12 : 1); i++) {
      const ang = (i / 12) * Math.PI * 2, x = base.x + Math.cos(ang) * r, zz = base.z + Math.sin(ang) * r, y = this.h(x, zz);
      if (y < 0.8 || this.world.forest.blocks(x, zz, 2.6)) continue;
      if (Math.hypot(x - c.x, zz - c.z) < 4.2 || (lean && Math.hypot(x - lean.x, zz - lean.z) < 3.8)) continue;
      let flat = 0;
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) flat += Math.abs(this.h(x + dx, zz + dz) - y);
      const sc = -flat * 4 - r * 0.4;
      if (sc > score) { score = sc; best = v3(x, y, zz); }
    }
    const a = v3(LAKE.x - best.x, 0, LAKE.z - best.z).normalize(), b = v3(a.z, 0, -a.x);
    this.houseSpot = { at: best, a, b, site };
    return this.houseSpot;
  }
  houseAt() { return this.house().at.clone(); }
  /** The wall the door is in: away from the lake wind, towards the band, or towards the lake. */
  private doorSide(): 'a+' | 'a-' | 'b+' | 'b-' | '' {
    if (this.f('e3.door.lee')) return 'a-';
    if (this.f('e3.door.view')) return 'a+';
    if (!this.f('e3.door.band')) return '';
    const H = this.house(), home = this.L.camp.clone().add(v3(9, 0, 7)), d = home.sub(H.at).setY(0);
    if (d.lengthSq() < 4) return 'b+';
    const da = d.dot(H.a), db = d.dot(H.b);
    return Math.abs(da) > Math.abs(db) ? (da > 0 ? 'a+' : 'a-') : db > 0 ? 'b+' : 'b-';
  }

  private meshCount(o: THREE.Object3D) { let n = 0; o.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.visible) n++; }); return n; }
  private houseG: THREE.Group | null = null;
  private frameG: THREE.Group | null = null;
  private thatchRows: THREE.Object3D[] = [];
  private houseKey = '';
  private restoreHouse() {
    if (this.s.level < 16 || this.busy) return;
    const st = this.f('e3.thatched') ? 4 : this.f('e3.frameUp') ? 3 : this.f('e3.l16.intro') ? 1 : 0;
    const key = `${st}/${this.doorSide()}/${this.f('e3.ditch') ? 1 : 0}/${this.siteNow()}`;
    if (key === this.houseKey) return;
    this.houseKey = key;
    this.buildHouse(st);
  }
  /**
   * The house as far as it has got: 1 the six poles on the ground; 2 posts, plates and ties (the ridge beam up with
   * `beamUp`, the braces with `brace`); 3 braced; 4 rafters and thatch (`rows` of them shown, from the eaves up), and
   * with a door chosen the wattle walls with the doorway in the chosen wall and a hearth ring inside.
   */
  private buildHouse(st: number, o: { beamUp?: boolean; brace?: boolean; rows?: number } = {}) {
    this.houseG?.removeFromParent(); this.houseG = null; this.frameG = null; this.thatchRows = [];
    if (st <= 0) return;
    const H = this.house(), g = new THREE.Group(), y0 = H.at.y;
    g.name = 'e3.house'; this.group.add(g); this.houseG = g;
    const wood = std(0x7a5e44), bark = std(0x5a4636, { roughness: 0.95 }), soil = std(0x3b2e22, { roughness: 1 });
    const W = (u: number, w: number) => H.at.clone().addScaledVector(H.a, u).addScaledVector(H.b, w);
    const log = (p: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, r: number, m: THREE.Material) => {
      const d = to.clone().sub(from), len = d.length();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, len, 7), m);
      c.position.copy(from).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(UP, d.normalize()); c.castShadow = true; c.receiveShadow = true;
      p.add(c); return c;
    };
    // the ditch round the floor at the old camp, the spoil thrown up on the outside
    if (this.campSite() && this.f('e3.ditch')) {
      const ring: [number, number][] = [];
      for (let i = 0; i <= 10; i++) ring.push([-2.4 + i * 0.48, 2.1]);
      for (let i = 0; i <= 8; i++) ring.push([2.4, 2.1 - i * 0.525]);
      for (let i = 0; i <= 10; i++) ring.push([2.4 - i * 0.48, -2.1]);
      for (let i = 0; i <= 8; i++) ring.push([-2.4, -2.1 + i * 0.525]);
      for (const [u, w] of ring) {
        const p = W(u, w), q = W(u * 1.12, w * 1.14);
        const cut = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.56), soil); cut.position.set(p.x, this.h(p.x, p.z) + 0.012, p.z); cut.rotation.y = Math.atan2(H.a.x, H.a.z); cut.receiveShadow = true; g.add(cut);
        const spoil = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 4), soil); spoil.scale.set(1.2, 0.28, 1.2); spoil.position.set(q.x, this.h(q.x, q.z) + 0.02, q.z); g.add(spoil);
      }
    }
    if (st === 1) {
      // six straight poles laid side by side beside the floor, bark on
      for (let i = 0; i < 6; i++) {
        const w = 2.5 + i * 0.2, a0 = W(-1.7, w), a1 = W(1.7, w);
        a0.y = this.h(a0.x, a0.z) + 0.06; a1.y = this.h(a1.x, a1.z) + 0.06;
        log(g, a0, a1, 0.06, i === 5 ? std(0x8a6a4a) : bark);
      }
      return;
    }
    // the frame in its own group, so a push can shear it (pivot at the floor centre)
    const fg = new THREE.Group(); fg.position.copy(H.at); g.add(fg); this.frameG = fg;
    const Lc = (u: number, w: number, y: number) => v3(0, y, 0).addScaledVector(H.a, u).addScaledVector(H.b, w);
    const foot = (u: number, w: number) => { const p = W(u, w); return this.h(p.x, p.z) - y0 - 0.3; };
    const EAVE = 1.75, RIDGE = 2.8;
    for (const [u, w, top] of [[-1.6, -1.3, EAVE], [1.6, -1.3, EAVE], [-1.6, 1.3, EAVE], [1.6, 1.3, EAVE], [-1.6, 0, RIDGE], [1.6, 0, RIDGE]] as [number, number, number][]) {
      log(fg, Lc(u, w, foot(u, w)), Lc(u, w, top + 0.04), 0.065, bark);
      // rammed earth and stones round the foot
      const p = W(u, w), ring = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.08, 9), soil); ring.position.set(0, this.h(p.x, p.z) - y0 + 0.02, 0).addScaledVector(H.a, u).addScaledVector(H.b, w); fg.add(ring);
    }
    for (const w of [-1.3, 1.3]) log(fg, Lc(-1.75, w, EAVE), Lc(1.75, w, EAVE), 0.05, wood);
    for (const u of [-1.6, 1.6]) log(fg, Lc(u, -1.45, EAVE - 0.06), Lc(u, 1.45, EAVE - 0.06), 0.045, wood);
    if (o.beamUp ?? st >= 3) log(fg, Lc(-1.9, 0, RIDGE), Lc(1.9, 0, RIDGE), 0.07, wood);
    if (o.brace ?? st >= 3) {
      // corner to corner of a bay on each long wall, bound at both ends
      for (const [u0, w, u1] of [[-1.6, 1.3, -0.1], [1.6, -1.3, 0.1]] as [number, number, number][]) {
        const p0 = Lc(u0, w, 0.18), p1 = Lc(u1, w, EAVE - 0.05);
        log(fg, p0, p1, 0.04, wood);
        for (const p of [p0.clone().lerp(p1, 0.06), p0.clone().lerp(p1, 0.94)]) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10), std(0xa88a5c, { roughness: 1 })); c.position.copy(p); c.lookAt(p.clone().add(H.b)); fg.add(c); }
      }
    }
    if (st < 4) return;
    const thatch = std(0xb09454, { roughness: 1 }), wattle = std(0x7d6444, { roughness: 1, side: THREE.DoubleSide });
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const u = -1.6 + i * 0.8; log(fg, Lc(u, s * 1.55, EAVE - 0.12), Lc(u, 0, RIDGE + 0.08), 0.035, bark); }
    // the thatch: five rows a side laid from the eaves up, each over the one below
    const rows = o.rows ?? 10;
    for (let i = 0; i < 5; i++) for (const s of [1, -1]) {
      const E = Lc(0, s * 1.75, EAVE - 0.2), R = Lc(0, 0, RIDGE + 0.12), up = R.clone().sub(E), len = up.length(); up.normalize();
      const c = E.clone().addScaledVector(up, len * (i + 0.6) / 5.2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.1, (len / 5) * 1.45), thatch);
      const Y = up.clone().cross(H.a).normalize(); if (Y.y < 0) Y.negate();
      // an orthonormal basis: Z up the slope, Y off the roof, X along the ridge
      const Z = up.clone(), X = Y.clone().cross(Z).normalize();
      box.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
      box.position.copy(c).addScaledVector(Y, 0.06 + i * 0.012); box.castShadow = true; box.receiveShadow = true;
      box.visible = this.thatchRows.length < rows; this.thatchRows.push(box); fg.add(box);
    }
    const cap = log(fg, Lc(-2.0, 0, RIDGE + 0.16), Lc(2.0, 0, RIDGE + 0.16), 0.14, thatch); cap.visible = rows >= 10; this.thatchRows.push(cap);
    const door = this.doorSide();
    if (!door) return;
    // wattle walls to the eaves, sunk a little into the ground; the doorway (0.9 m) in the chosen wall
    const wall = (u0: number, w0: number, u1: number, w1: number, h0: number, h1: number) => {
      const p0 = Lc(u0, w0, h0), p1 = Lc(u1, w1, h0), len = p0.distanceTo(p1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, h1 - h0, 0.07), wattle);
      m.position.copy(p0).lerp(p1, 0.5); m.position.y = (h0 + h1) / 2;
      m.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x); m.castShadow = true; m.receiveShadow = true; fg.add(m);
    };
    const sides: Record<string, [number, number, number, number]> = { 'a+': [1.6, -1.3, 1.6, 1.3], 'a-': [-1.6, 1.3, -1.6, -1.3], 'b+': [1.6, 1.3, -1.6, 1.3], 'b-': [-1.6, -1.3, 1.6, -1.3] };
    for (const [k, [u0, w0, u1, w1]] of Object.entries(sides)) {
      if (k !== door) { wall(u0, w0, u1, w1, -0.3, EAVE - 0.08); continue; }
      const mu = (u0 + u1) / 2, mw = (w0 + w1) / 2, du = (u1 - u0), dw = (w1 - w0), L2 = Math.hypot(du, dw), k0 = 0.5 - 0.45 / L2, k1 = 0.5 + 0.45 / L2;
      wall(u0, w0, u0 + du * k0, w0 + dw * k0, -0.3, EAVE - 0.08);
      wall(u0 + du * k1, w0 + dw * k1, u1, w1, -0.3, EAVE - 0.08);
      wall(u0 + du * k0, w0 + dw * k0, u0 + du * k1, w0 + dw * k1, 1.5, EAVE - 0.08);
      void mu; void mw;
    }
    // the gable triangles over the end walls
    for (const u of [-1.6, 1.6]) {
      const sh = new THREE.Shape([new THREE.Vector2(-1.3, EAVE - 0.08), new THREE.Vector2(1.3, EAVE - 0.08), new THREE.Vector2(0, RIDGE)]);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), wattle);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(H.b.clone(), UP.clone(), H.b.clone().cross(UP).normalize()));
      m.position.copy(Lc(u, 0, 0)); fg.add(m);
    }
    // a hearth ring in the middle of the floor
    for (let i = 0; i < 7; i++) { const an = (i / 7) * Math.PI * 2, p = Lc(Math.cos(an) * 0.32, Math.sin(an) * 0.32, 0); const st2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), std(0x6c665e)); st2.position.copy(p); st2.position.y = this.h(H.at.x + p.x, H.at.z + p.z) - y0 + 0.03; fg.add(st2); }
  }
  /** The frame pushed sideways: a box of four sticks shears into a parallelogram (k: sideways per metre up). */
  private sway(k: number) {
    const fg = this.frameG; if (!fg) return;
    const H = this.house(), m = new THREE.Matrix4().set(1, k * H.b.x, 0, 0, 0, 1, 0, 0, 0, k * H.b.z, 1, 0, 0, 0, 0, 1);
    fg.matrixAutoUpdate = false;
    fg.matrix.makeTranslation(H.at.x, H.at.y, H.at.z).multiply(m);
    fg.matrixWorldNeedsUpdate = true;
  }

  /** The polished axe in both hands, and a pose(k) for one stroke (k 0..1: up over the right shoulder, down into `hit`). */
  private axeRig(me: THREE.Vector3, hit: THREE.Vector3) {
    const z = this.z, f = this.fwd(), r = this.right(f), axe = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 7).translate(0, 0.31, 0), std(0x6a4e3a)); axe.add(haft);
    const hd = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 1), std(0x4a5a4a, { roughness: 0.3 })); hd.scale.set(0.35, 0.8, 1.5); hd.position.set(0, 0.56, 0.06); axe.add(hd);
    const bind = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 7), std(0xa88a5c, { roughness: 0.95 })); bind.position.y = 0.53; axe.add(bind);
    axe.traverse((o) => { (o as THREE.Mesh).castShadow = true; }); this.group.add(axe);
    const pose = (k: number) => {
      const u = Math.min(1, k), lift = me.clone().add(v3(0, 1.6, 0)).addScaledVector(r, 0.3), strike = hit.clone().addScaledVector(f, -0.55);
      const hand = lift.clone().lerp(strike, u < 0.55 ? 0 : Math.min(1, (u - 0.55) / 0.3)), dir = hit.clone().sub(hand).normalize();
      axe.position.copy(hand); axe.quaternion.setFromUnitVectors(UP, dir);
      const palm = dir.clone().cross(r).normalize();
      z.setHold({ R: { at: hand.clone().addScaledVector(dir, 0.08), fingers: r.clone().negate(), palm, radius: 0.02, grasp: true }, L: { at: hand.clone().addScaledVector(dir, -0.02), fingers: r.clone().negate(), palm, radius: 0.02, grasp: true } });
    };
    pose(0);
    return { axe, pose };
  }

  private update16() {
    if (!this.f('e3.l16.intro')) { this.intro16(); return; }
    // after a reload in the middle of the work: go on from the last beat
    if (isDiscovered(this.s, 'frame') && !this.f('e3.frameUp')) { this.raiseFrame(() => {}); return; }
    if (this.f('e3.frameUp') && !this.f('e3.houseDone')) { this.thatchScene(() => {}); return; }
    const p = this.player.pos, H = this.house().at;
    if (this.campSite() && !this.f('e3.ditch') && Math.hypot(p.x - H.x, p.z - H.z) < 4) void this.ditchScene();
  }

  /** Day 15: the last of six poles felled with the ground axe, the poles laid out on the floor's side. */
  private intro16() {
    const S = this.live();
    this.set('e3.l16.intro');
    this.busy = true;
    this.passTime(8.2, true, 'e3.day', () => {
      const z = this.z, H = this.house(), at = H.at;
      this.buildHouse(1);
      // a straight young trunk at the clearing's edge: the sixth pole
      const stand = at.clone().addScaledVector(H.b, 3.9).addScaledVector(H.a, -2.6); stand.y = this.h(stand.x, stand.z);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.4, 8).translate(0, 1.7, 0), std(0x6a5440));
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1).translate(0, 3.25, 0), std(0x4f6b2e, { roughness: 0.9 })); crown.scale.set(1, 1.3, 1);
      for (const m of [trunk, crown]) { m.castShadow = true; tree.add(m); }
      tree.position.copy(stand); this.group.add(tree);
      const me = this.settle(stand.clone().addScaledVector(H.a, 0.85), stand, false);
      const f = this.fwd(), r = this.right(f), hit = stand.clone().add(v3(0, 0.65, 0));
      const { axe, pose } = this.axeRig(me, hit);
      const poles = at.clone().addScaledVector(H.b, 3.0);
      this.scene([
        // side-on to the stroke, far enough out that the whole tree and its fall are in frame
        { hold: 5.2, shot: () => ({ from: me.clone().lerp(stand, 0.5).addScaledVector(r, 5.6).add(v3(0, 1.3, 0)), to: stand.clone().add(v3(0, 1.4, 0)), fov: 45, push: 0.02 }), run: () => {
          z.setLookTarget(hit);
          for (let i = 0; i < 3; i++) S.after(0.2 + i * 1.15, () => { S.anim(0.9, (k) => pose(k / 0.9)); S.after(0.78, () => audio.sample('wood', 0.8, { rate: 0.92 + i * 0.05 })); });
          S.after(3.6, () => { audio.sample('wood', 0.7, { rate: 0.6 }); S.anim(1.3, (k) => { const d = Math.min(1, (k / 1.3) ** 2); tree.rotation.set(0, 0, 0); tree.rotateOnWorldAxis(r, -d * 1.45); }); });
        } },
        { hold: 3.4, shot: () => ({ from: poles.clone().addScaledVector(H.a, -4.6).addScaledVector(H.b, 1.4).add(v3(0, 4.4, 0)), to: poles.clone().add(v3(0, 0.1, 0)), fov: 50, push: 0.02 }), run: () => {
          tree.removeFromParent(); axe.visible = false; this.clearHands();
          this.settle(poles.clone().addScaledVector(H.a, 2.3), poles, false); z.setLookTarget(poles);
        } },
        { key: 'e3.fr.1', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
        { hold: 6.5, shot: () => cover.mid(z, 0.6, 2.4), run: () => { z.setLookTarget(at.clone().add(v3(0, 1.4, 0))); this.ui.memory('e3.fr.bolzar', 7); } },
      ], () => { S.end(); axe.removeFromParent(); tree.removeFromParent(); this.clearHands(); this.ui.toast(t(this.campSite() ? 'e3.obj.ditch' : 'level.16.hint')); });
    });
  }

  /** At the old camp: a ditch round the floor and out to the low side first (the flood came over it). */
  private async ditchScene() {
    const S = this.live();
    this.busy = true;
    const z = this.z, H = this.house(), dig = H.at.clone().addScaledVector(H.a, -2.4).addScaledVector(H.b, 0.6); dig.y = this.h(dig.x, dig.z);
    const me = this.settle(dig.clone().addScaledVector(H.a, -0.6), dig, true);
    const f = this.fwd(), r = this.right(f);
    const stick = this.mesh(new THREE.CylinderGeometry(0.018, 0.012, 1.1, 6), std(0x6a5440), dig.clone());
    const stroke = (k: number) => {
      const u = Math.abs(Math.sin(k * 3.4)), tip = dig.clone().add(v3(0, 0.02 + u * 0.12, 0)), top = tip.clone().addScaledVector(f, -0.55).add(v3(0, 0.75, 0));
      const d = tip.clone().sub(top).normalize();
      stick.position.copy(tip).lerp(top, 0.5); stick.quaternion.setFromUnitVectors(UP, d.clone().negate());
      z.setHold({ R: { at: top.clone().addScaledVector(d, 0.08), fingers: r.clone().negate(), palm: f.clone(), radius: 0.02, grasp: true }, L: { at: top.clone().addScaledVector(d, 0.3), fingers: r.clone().negate(), palm: f.clone(), radius: 0.02, grasp: true } });
    };
    stroke(0);
    await new Promise<void>((go) => this.scene([
      { hold: 3.0, shot: () => this.wide(me, 4.0, 0.7, 0.6), run: () => { z.setLookTarget(dig); S.anim(3, (k) => { stroke(k); if (Math.random() < 0.04) audio.sample('stone', 0.15, { rate: 0.6 }); }); } },
      { key: 'e3.fr.ditch', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
    ], go));
    this.busy = true;
    stroke(0);
    const res = await this.tension({ kind: 'quick', count: 4 });
    if (res && !res.passed) this.set('e3.ditch.slow');
    S.end(); stick.removeFromParent(); this.clearHands();
    this.set('e3.ditch');
    this.houseKey = ''; this.busy = false; this.wait = 0.8;
    this.ui.toast(t('level.16.hint'));
  }

  /** The craft panel opens on him kneeling at the first post's foot, ramming earth and stones round it in layers. */
  private beforeFrame(open: () => void) {
    const S = this.live();
    const z = this.z, H = this.house();
    this.buildHouse(1);
    const post = H.at.clone().addScaledVector(H.a, -1.6).addScaledVector(H.b, 1.3); post.y = this.h(post.x, post.z);
    const out = H.b.clone().addScaledVector(H.a, -0.4).normalize();
    this.settle(post.clone().addScaledVector(out, 0.6), post, true, true);
    const f = this.fwd(), r = this.right(f);
    const pm = this.mesh(new THREE.CylinderGeometry(0.06, 0.065, 1.75, 7).translate(0, 0.875, 0), std(0x5a4636, { roughness: 0.95 }), post.clone());
    const stones: THREE.Mesh[] = [];
    for (let i = 0; i < 7; i++) { const an = (i / 7) * Math.PI * 2, p = post.clone().add(v3(Math.cos(an) * 0.17, 0.03, Math.sin(an) * 0.17)); stones.push(this.mesh(new THREE.DodecahedronGeometry(0.045, 0), std(0x777066), p)); }
    const foot = post.clone().addScaledVector(f, -0.15);
    const ram = (k: number) => {
      const yb = 0.06 + Math.abs(Math.sin(k * 5.2)) * 0.13;
      z.setHold({ L: { at: foot.clone().addScaledVector(r, -0.1).add(v3(0, yb, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 }, R: { at: foot.clone().addScaledVector(r, 0.1).add(v3(0, yb, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 } });
    };
    ram(0);
    // from his side, low, 0.8 m off: both hands, the post's foot and the stones in frame
    const insert = (): Shot => { const from = foot.clone().addScaledVector(r, 0.78).addScaledVector(f, 0.3).add(v3(0, 0.4, 0)); from.y = Math.max(from.y, this.h(from.x, from.z) + 0.3); return { from, to: foot.clone().add(v3(0, 0.16, 0)), fov: 30, push: 0.012, aperture: 0.004, lightAt: foot.clone().add(v3(0, 0.1, 0)) }; };
    this.scene([
      { hold: 4.2, shot: insert, run: () => { z.setLookTarget(foot); S.anim(4.2, (k) => { ram(k); if (Math.random() < 0.05) audio.sample('stone', 0.14, { rate: 0.75 }); }); } },
    ], () => { S.end(); pm.removeFromParent(); for (const s of stones) s.removeFromParent(); this.clearHands(); open(); });
    return true;
  }

  /** The lever lifts the ridge beam a hand at a time; the frame stands and folds when pushed; a brace; it holds. */
  private raiseFrame(card: () => void) {
    const S = this.live();
    this.busy = true;
    const z = this.z, H = this.house(), y0 = H.at.y;
    this.buildHouse(2, { beamUp: false, brace: false });
    // the beam lies along the ridge line, its far end on the ground; the near end comes up on chocks
    const far = H.at.clone().addScaledVector(H.a, -1.9).addScaledVector(H.b, 0.5); far.y = this.h(far.x, far.z) + 0.07;
    const E = H.at.clone().addScaledVector(H.a, 1.9).addScaledVector(H.b, 0.5); E.y = this.h(E.x, E.z);
    const beam = this.mesh(new THREE.CylinderGeometry(0.065, 0.07, 3.8, 7), std(0x7a5e44), far.clone());
    const lever = this.mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.6, 7), std(0x6a5440), E.clone());
    const fulcrum = this.mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 7), std(0x5a4636), E.clone());
    fulcrum.quaternion.setFromUnitVectors(UP, H.a);
    const chocks: THREE.Mesh[] = [];
    let beamY = 0.07, fulY = 0.2;
    const F = () => E.clone().addScaledVector(H.b, 0.45).setY(E.y + fulY);
    const place = (endY: number) => {
      const end = E.clone().setY(E.y + endY), d = end.clone().sub(far).normalize();
      beam.position.copy(far).addScaledVector(d, 1.9); beam.quaternion.setFromUnitVectors(UP, d);
      const f0 = F(), S = E.clone().setY(E.y + endY - 0.08), ld = f0.clone().sub(S).normalize(), long = f0.clone().addScaledVector(ld, 2.0);
      lever.position.copy(S).lerp(long, 0.5); lever.quaternion.setFromUnitVectors(UP, ld);
      fulcrum.position.copy(f0).add(v3(0, -0.1, 0));
      return { long, ld };
    };
    let rig = place(beamY);
    const me = this.settle(rig.long.clone().addScaledVector(H.b, 0.45).setY(0), F(), false);
    const push = () => {
      const p = rig.long;
      z.setHold({ L: { at: p.clone().addScaledVector(rig.ld, -0.06), fingers: rig.ld.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true }, R: { at: p.clone().addScaledVector(rig.ld, -0.3), fingers: rig.ld.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true } });
    };
    push();
    const steps = () => {
      for (let i = 0; i < 5; i++) S.after(0.2 + i * 1.05, () => {
        fulY = beamY + 0.15;
        const a0 = beamY;
        S.anim(0.75, (k) => { beamY = a0 + 0.15 * Math.min(1, k / 0.75); rig = place(beamY); push(); });
        S.after(0.8, () => {
          audio.sample('wood', 0.4, { rate: 1.3 });
          const c = this.mesh(new THREE.BoxGeometry(0.16, 0.15, 0.3), std(0x5a4636), E.clone().setY(E.y + beamY - 0.08 - 0.075)); c.rotation.y = Math.atan2(H.a.x, H.a.z); chocks.push(c);
        });
      });
    };
    const corner = H.at.clone().addScaledVector(H.a, 1.6).addScaledVector(H.b, -1.3);
    const pushPost = (k: number) => { const at = corner.clone().setY(y0 + 1.25 + 0).addScaledVector(H.b, -0.04); z.setHold({ L: { at: at.clone().addScaledVector(H.a, -0.12), fingers: UP.clone(), palm: H.b.clone(), radius: 0.03 }, R: { at: at.clone().addScaledVector(H.a, 0.12), fingers: UP.clone(), palm: H.b.clone(), radius: 0.03 } }); this.sway(k); };
    const lash = H.at.clone().addScaledVector(H.a, -0.1).addScaledVector(H.b, 1.3).setY(y0 + 1.62);
    const lashing = (k: number) => {
      const an = k * 7, along = H.a.clone(), c = lash.clone().addScaledVector(H.b, 0.08 * Math.cos(an)).add(v3(0, 0.08 * Math.sin(an), 0));
      z.setHold({ L: { at: lash.clone().addScaledVector(along, -0.16).addScaledVector(H.b, 0.06).add(v3(0, -0.1, 0)), fingers: H.b.clone().negate(), palm: along.clone(), radius: 0.03, grasp: true }, R: { at: c.addScaledVector(H.b, 0.05), fingers: H.b.clone().negate(), palm: along.clone().negate(), radius: 0.02 } });
    };
    const side = (): Shot => ({ from: E.clone().addScaledVector(H.a, 3.4).addScaledVector(H.b, 1.6).add(v3(0, 1.2, 0)), to: E.clone().addScaledVector(H.b, 1.2).add(v3(0, 0.6, 0)), fov: 40, push: 0.02 });
    const wideFrame = (): Shot => ({ from: H.at.clone().addScaledVector(H.b, -6.2).addScaledVector(H.a, 2.6).add(v3(0, 1.6, 0)), to: H.at.clone().add(v3(0, 1.3, 0)), fov: 45, push: 0.02 });
    this.scene([
      { hold: 2.0, shot: wideFrame, run: () => z.setLookTarget(F()) },
      { hold: 5.6, shot: side, run: () => { z.setLookTarget(E.clone().add(v3(0, 0.4, 0))); steps(); } },
      { hold: 3.4, shot: wideFrame, run: () => {
        beam.removeFromParent(); lever.removeFromParent(); fulcrum.removeFromParent(); for (const c of chocks) c.removeFromParent();
        this.buildHouse(2, { beamUp: true, brace: false });
        this.settle(corner.clone().addScaledVector(H.b, -0.55).addScaledVector(H.a, 0.1), corner, false);
        pushPost(0);
        z.setLookTarget(corner.clone().setY(y0 + 1.5));
        S.anim(3.2, (k) => { pushPost(Math.sin(k * 3.0) * 0.12 * Math.min(1, k)); if (Math.random() < 0.03) audio.sample('wood', 0.3, { rate: 0.5 }); });
      } },
      { key: 'e3.fr.fail', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { this.sway(0); z.setHold(null); z.setFace({ frown: 0.3 }); z.setLookTarget(this.ahead()); } },
      { hold: 3.2, shot: () => ({ from: lash.clone().addScaledVector(H.b, 0.55).addScaledVector(H.a, 0.35).add(v3(0, -0.05, 0)), to: lash.clone().add(v3(0, -0.03, 0)), fov: 28, push: 0.01, aperture: 0.004, lightAt: lash.clone() }), run: () => {
        z.setFace(null);
        this.buildHouse(3);
        this.settle(lash.clone().addScaledVector(H.b, 0.55).setY(0), lash, false);
        z.setLookTarget(lash);
        S.anim(3.2, (k) => { lashing(k); if (Math.random() < 0.04) audio.sample('leather', 0.2); });
      } },
      { key: 'e3.fr.fix', who: 'scientist', shot: () => cover.mid(z, 0.5, 2.2), run: () => { z.setHold(null); z.setLookTarget(this.ahead()); } },
      { hold: 2.4, shot: wideFrame, run: () => {
        this.settle(corner.clone().addScaledVector(H.b, -0.55).addScaledVector(H.a, 0.1), corner, false); pushPost(0);
        S.anim(2.2, (k) => pushPost(Math.sin(k * 3.0) * 0.006));
      } },
    ], () => {
      S.end();
      beam.removeFromParent(); lever.removeFromParent(); fulcrum.removeFromParent(); for (const c of chocks) c.removeFromParent();
      this.clearHands(); this.sway(0);
      this.set('e3.frameUp'); this.houseKey = '';
      this.busy = true;
      this.passTime(9.5, true, 'e3.later2', () => this.thatchScene(card));
    });
    void me;
  }

  /** Two days on: thatch from the eaves up, the axe on a knot (unless the bite is the wound), the door, inside in the rain. */
  private thatchScene(card: () => void) {
    const S = this.live();
    this.busy = true;
    const z = this.z, H = this.house(), y0 = H.at.y;
    this.buildHouse(4, { rows: 0 });
    const eave = H.at.clone().addScaledVector(H.b, 1.75).setY(y0 + 1.55);
    this.settle(eave.clone().addScaledVector(H.b, 0.5).setY(0), eave, false);
    const f = this.fwd(), r = this.right(f);
    const reach = (k: number) => { const u = Math.sin(k * 2.2) * 0.4; z.setHold({ L: { at: eave.clone().addScaledVector(H.a, u - 0.2).addScaledVector(f, -0.05), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 }, R: { at: eave.clone().addScaledVector(H.a, u + 0.2).addScaledVector(f, -0.05), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 } }); };
    const rows = (k: number, n0: number, n1: number, sec: number) => { const n = Math.floor(n0 + (n1 - n0) * Math.min(1, k / sec)); this.thatchRows.forEach((m, i) => { m.visible = i < n; }); };
    const low = (): Shot => ({ from: H.at.clone().addScaledVector(H.b, 5.0).addScaledVector(H.a, 2.2).add(v3(0, 0.5, 0)), to: H.at.clone().addScaledVector(H.b, 1.0).add(v3(0, 2.0, 0)), fov: 40, push: 0.02 });
    const cut = !this.f('e2.bitten');
    const watch = this.trust() >= 1 && !this.f('e2.oomsa.away');
    const oom = watch ? this.oom() : null;
    const reeds = this.siteAt('reeds');
    const beats: Beat[] = [
      { hold: 3.6, shot: low, run: () => { z.setLookTarget(eave); S.anim(3.6, (k) => { reach(k); rows(k, 0, 4, 3.6); if (Math.random() < 0.03) audio.sample('leather', 0.25); }); } },
      { key: 'e3.fr.thatch', who: 'scientist', shot: () => cover.mid(z, 0.55, 2.3), run: () => { S.anim(4, (k) => { reach(k + 2); rows(k, 4, 8, 4); }); } },
      { hold: 2.6, shot: low, run: () => S.anim(2.6, (k) => { reach(k + 4); rows(k, 8, 11, 2.4); }) },
    ];
    if (cut) {
      // splitting a pole for the last rafter, the axe glances off a knot into his forearm
      const block = H.at.clone().addScaledVector(H.b, 3.0).addScaledVector(H.a, -2.0); block.y = this.h(block.x, block.z);
      let arm = v3();
      beats.push(
        { hold: 1.4, shot: () => ({ from: arm.clone().addScaledVector(this.right(this.fwd()), 0.5).add(v3(0, 0.12, 0)).addScaledVector(this.fwd(), 0.25), to: arm.clone(), fov: 28, push: 0.01, aperture: 0.004, lightAt: arm.clone() }), run: () => {
          this.thatchRows.forEach((m) => { m.visible = true; });
          this.settle(block.clone().addScaledVector(H.a, -0.7), block, true);
          const ff = this.fwd(), rr = this.right(ff);
          arm = this.z.root.position.clone().addScaledVector(ff, 0.38).add(v3(0, 0.75, 0));
          z.setHold({ L: { at: arm.clone().addScaledVector(rr, -0.05), fingers: ff.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: arm.clone().addScaledVector(rr, 0.03).addScaledVector(ff, -0.06).add(v3(0, 0.03, 0)), fingers: rr.clone().negate(), palm: UP.clone().negate(), radius: 0.02, grasp: true } });
          audio.sample('wood', 0.6, { rate: 1.4 }); audio.human('grunt', 0.6); z.setFace({ frown: 0.8, squint: 0.6 });
        } },
        { key: 'e3.fr.slip', who: 'scientist', shot: () => cover.close(z, -0.4, 0.95, 0.24), run: () => { z.setLookTarget(arm); } },
        { key: 'e3.fr.bind', who: 'scientist', shot: () => cover.mid(z, 0.5, 2.0), run: () => {
          z.setFace({ frown: 0.4 });
          const ff = this.fwd(), rr = this.right(ff);
          S.anim(4, (k) => { const an = k * 6; z.setHold({ L: { at: arm.clone().addScaledVector(rr, -0.05), fingers: ff.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: arm.clone().addScaledVector(rr, 0.02 + 0.05 * Math.cos(an)).add(v3(0, 0.05 * Math.sin(an) + 0.02, 0)), fingers: rr.clone().negate(), palm: UP.clone().negate(), radius: 0.02 } }); });
        } },
      );
    }
    if (watch) {
      beats.push({ hold: 3.2, shot: () => ({ from: H.at.clone().addScaledVector(H.b, 2.4).add(v3(0, 1.5, 0)), to: reeds.clone().add(v3(0, 1.0, 0)), fov: 34, push: 0.02 }), run: () => {
        this.clearHands(); this.thatchRows.forEach((m) => { m.visible = true; });
        const her = H.at.clone().addScaledVector(reeds.clone().sub(H.at).setY(0).normalize(), 7); her.y = this.h(her.x, her.z);
        if (oom) { this.actors['local'] = oom; this.npcs.pin('local', her, Math.atan2(H.at.x - her.x, H.at.z - her.z)); oom.setLookTarget(H.at.clone().add(v3(0, 1.5, 0))); }
        // from the reeds, in his own voice: the boy who copies voices
        S.after(0.6, () => this.ui.say('e3.wk.copy', 'e3.who.wenka', 2.6));
        S.after(2.4, () => audio.human('laugh', 0.35));
        this.set('e3.wk.copy');
      } });
    }
    beats.push(
      { hold: 2.0, shot: () => cover.mid(z, 0.6, 2.6), run: () => {
        this.thatchRows.forEach((m) => { m.visible = true; });
        if (!watch) this.clearHands(); else z.setHold(null);
        z.setFace(null); z.setLookTarget(H.at.clone().add(v3(0, 1.3, 0)));
        this.ui.memory('e3.dr.bolzar', 5);
      } },
      { choice: 'e3.door', shot: () => cover.close(z, 0.5, 1.1, 0.24) },
      { key: 'e3.dr.lee', who: 'scientist', if: CHOSE('e3.door', 'lee'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      { key: 'e3.dr.band', who: 'scientist', if: CHOSE('e3.door', 'band'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      { key: 'e3.dr.joke', who: 'scientist', if: CHOSE('e3.door', 'view'), shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => z.setFace({ smile: 0.3 }) },
      { hold: 2.6, shot: () => ({ from: H.at.clone().addScaledVector(H.a, -7).addScaledVector(H.b, 3.5).add(v3(0, 2.0, 0)), to: H.at.clone().add(v3(0, 1.4, 0)), fov: 48, push: 0.02 }), run: () => {
        this.set('e3.thatched'); this.buildHouse(4);
        this.s.timeOfDay = 18.2;
        audio.sample('amb_rain', 0.4, { dur: 12 });
        // inside, sitting by the hearth ring, looking up at the underside of the roof
        const seat = H.at.clone().addScaledVector(H.a, -0.7).setY(0);
        this.settle(seat, H.at.clone().addScaledVector(H.a, 0.8), true, true);
        z.setFace(null);
      } },
      { key: 'e3.fr.ok', who: 'scientist', shot: () => { const hd = this.head(); return { from: hd.clone().addScaledVector(this.fwd(), 1.0).addScaledVector(this.right(this.fwd()), 0.35).add(v3(0, -0.15, 0)), to: hd.clone().add(v3(0, 0.12, 0)), fov: 35, push: 0.01 }; }, run: () => { z.setLookTarget(H.at.clone().add(v3(0, 2.6, 0))); z.setFace({ smile: 0.2 }); } },
      { hold: 2.8, shot: () => { const hd = this.head(); return { from: hd.clone().add(v3(0, -0.1, 0)).addScaledVector(this.fwd(), -0.2), to: H.at.clone().add(v3(0, 2.5, 0)).addScaledVector(H.b, 0.6), fov: 50, push: 0.01, lightAt: H.at.clone().add(v3(0, 2.3, 0)), lightScale: 0.6 }; } },
    );
    this.scene(beats, () => {
      S.end();
      this.clearHands();
      if (oom) { this.npcs.pin('local', null, 0, this.L.camp.clone().add(v3(9, 0, 7)).setY(this.h(this.L.camp.x + 9, this.L.camp.z + 7))); oom.setLookTarget(null); }
      if (cut) this.set('e3.cut');
      this.set('e3.thatched'); this.set('inv.frame'); this.set('inv.lever');
      this.ui.toast(t('e3.learn.frame'));
      this.set('e3.houseDone'); this.houseKey = '';
      this.busy = false;
      card();
    });
    void r; void y0;
  }

  // ------------------------------------------------------------------ level 17: wheat (3.5 Hoh-Ma's stone, 3.6 the first field)
  /** The Fennish camp: reed shelters on stilts along the shore from the reed beds (moved along it when he built at the reeds). */
  private fennSpot: THREE.Vector3 | null = null;
  fennAt() {
    if (this.fennSpot) return this.fennSpot.clone();
    const r = this.siteAt('reeds'), d = v3(r.x - LAKE.x, 0, r.z - LAKE.z).normalize(), tan = v3(d.z, 0, -d.x);
    const H = this.s.level >= 16 && this.f('e3.l16.intro') ? this.houseAt() : null;
    let best = r.clone(), score = -1e9;
    for (const k of [13, 16, 19, 22]) for (const sg of [1, -1]) for (const inl of [0, 2, 4]) {
      const x = r.x + tan.x * k * sg + d.x * inl, z = r.z + tan.z * k * sg + d.z * inl, y = this.h(x, z);
      if (y < 0.55 || this.world.forest.blocks(x, z, 3)) continue;
      if (H && Math.hypot(x - H.x, z - H.z) < 11) continue;
      let flat = 0; for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) flat += Math.abs(this.h(x + dx, z + dz) - y);
      const sc = -flat * 3 - k * 0.15 - inl * 0.2;
      if (sc > score) { score = sc; best = v3(x, y, z); }
    }
    this.fennSpot = best;
    return best.clone();
  }
  /** Lake-ward and along-shore axes at the Fennish camp. */
  private fennAxes() { const c = this.fennAt(), d = v3(LAKE.x - c.x, 0, LAKE.z - c.z).normalize(); return { c, d, t: v3(d.z, 0, -d.x) }; }
  quernAt() { const { c, d, t: tn } = this.fennAxes(); const q = c.clone().addScaledVector(d, -1.6).addScaledVector(tn, 1.2); q.y = this.h(q.x, q.z); return q; }
  private fennG: THREE.Group | null = null;
  private buildFenn() {
    if (this.fennG) return;
    const g = new THREE.Group(), { c, d, t: tn } = this.fennAxes();
    const pole = std(0x6a5440, { roughness: 0.95 }), reed = std(0xb09a62, { roughness: 1 }), mat = std(0x8a7448, { roughness: 1 });
    // three shelters on stilts (the shore floods), domed reed roofs, a ladder of lashed poles
    const spots: [number, number, number][] = [[2.6, -1.2, 1.0], [-1.8, 2.8, 0.9], [-2.4, -3.0, 0.8]];
    for (const [a, b, sc] of spots) {
      const at = c.clone().addScaledVector(d, a).addScaledVector(tn, b), y = this.h(at.x, at.z), deck = y + 0.75;
      for (const [px, pz] of [[-0.8, -0.7], [0.8, -0.7], [-0.8, 0.7], [0.8, 0.7]]) {
        const p = at.clone().addScaledVector(d, px * sc).addScaledVector(tn, pz * sc), gy = this.h(p.x, p.z);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, deck - gy + 0.05, 6), pole); m.position.set(p.x, (deck + gy) / 2, p.z); g.add(m);
      }
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.9 * sc, 0.07, 1.7 * sc), mat); plat.position.set(at.x, deck, at.z); plat.rotation.y = Math.atan2(d.x, d.z); g.add(plat);
      const roof = new THREE.Mesh(new THREE.SphereGeometry(1.0 * sc, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), reed); roof.scale.set(1.05, 0.95, 0.95); roof.position.set(at.x, deck + 0.04, at.z); g.add(roof);
      // the doorway: a dark arch on the side away from the water
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.32 * sc, 10, 0, Math.PI), std(0x1e1812, { roughness: 1 }));
      const dp = at.clone().addScaledVector(d, -0.93 * sc); door.position.set(dp.x, deck + 0.05, dp.z); door.rotation.y = Math.atan2(-d.x, -d.z); g.add(door);
      for (let i = 0; i < 3; i++) { const lad = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), pole); const lp = dp.clone().addScaledVector(d, -0.25); lad.position.set(lp.x, y + 0.15 + i * 0.22, lp.z); lad.rotation.z = Math.PI / 2; lad.rotation.y = Math.atan2(d.x, d.z) + Math.PI / 2; g.add(lad); }
    }
    // their fire, a flat baking stone at its edge, the quern (a hollowed stone with a hand stone in it), a bark tray of heads
    const fire = c.clone().addScaledVector(d, -0.6).addScaledVector(tn, -0.6); fire.y = this.h(fire.x, fire.z);
    for (let i = 0; i < 8; i++) { const an = (i / 8) * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), std(0x6a645c)); s.position.set(fire.x + Math.cos(an) * 0.42, fire.y + 0.04, fire.z + Math.sin(an) * 0.42); g.add(s); }
    const embers = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), new THREE.MeshBasicMaterial({ color: 0xff7a2a })); embers.rotation.x = -Math.PI / 2; embers.position.set(fire.x, fire.y + 0.03, fire.z); g.add(embers);
    const bake = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 10), std(0x5a544c, { roughness: 0.7 })); bake.position.set(fire.x + 0.42, fire.y + 0.08, fire.z); bake.name = 'bake'; g.add(bake);
    const q = this.quernAt();
    const quern = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), std(0x7c7266, { roughness: 0.8, side: THREE.DoubleSide }));
    quern.scale.set(1.25, 0.5, 0.8); quern.position.set(q.x, q.y + 0.17, q.z); quern.rotation.y = Math.atan2(d.x, d.z); g.add(quern);
    const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), std(0x8e8678, { roughness: 0.6 })); hand.rotation.z = Math.PI / 2; hand.rotation.y = Math.atan2(d.x, d.z) + Math.PI / 2; hand.position.set(q.x, q.y + 0.2, q.z); hand.name = 'handstone'; g.add(hand);
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.05, 12, 1, true), std(0x7a5a3a, { side: THREE.DoubleSide })); const tp = q.clone().addScaledVector(tn, -0.6); tray.position.set(tp.x, tp.y + 0.04, tp.z); g.add(tray);
    for (let i = 0; i < 9; i++) { const hd = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.06, 2, 5), std(0xc8a860)); hd.position.set(tp.x + Math.cos(i * 2.1) * 0.12, tp.y + 0.06, tp.z + Math.sin(i * 2.1) * 0.12); hd.rotation.z = Math.PI / 2; hd.rotation.y = i; g.add(hd); }
    // the tall grass they gather, between the camp and the water
    const stem = std(0xa89450, { roughness: 1 }), ear = std(0xc8a860, { roughness: 0.9 });
    for (let i = 0; i < 26; i++) {
      const p = c.clone().addScaledVector(d, 3.6 + (i % 5) * 0.35).addScaledVector(tn, -2.4 + (i * 0.37) % 4.8), y = this.h(p.x, p.z);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 1.0, 4), stem); s.position.set(p.x, y + 0.5, p.z); s.rotation.set(0.12 * Math.sin(i), 0, 0.12 * Math.cos(i)); g.add(s);
      const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.07, 2, 5), ear); e.position.set(p.x + 0.06 * Math.cos(i), y + 1.02, p.z + 0.06 * Math.sin(i)); g.add(e);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    this.group.add(g); this.fennG = g;
  }
  /** Hoh-Ma (very old, faded star marks) and Wen-Ka (a child): Fennish bodies like Oom-Sa's, built once from level 17. */
  private folk: { hohma: Character; wenka: Character } | null = null;
  private folkSpots: Record<'hohma' | 'wenka', { at: THREE.Vector3; yaw: number; kneel: boolean }> | null = null;
  private buildFolk() {
    if (this.folk) return this.folk;
    const d = this.world.q.name === 'mobile' ? 0.6 : 1;
    const look = (o: Partial<PlayerLook>): PlayerLook => ({ ...defaultLook(), lineage: 'vael', ...LINEAGES.vael, skin: 0x2f8f8f, ears: 'fin', tail: true, marks: 'stars', outfit: 'explorer', eye: 'doll', ...o });
    const hohma = createCharacter('scientist', d, look({ glow: 0x4a8a5a, hair: 'medic', hairRoot: 0x9ab0a8, hairTip: 0xdfe8e0, height: 0.92, build: 0.05, gender: 'f', eye: 'tired', iris: 0x8aaa8a, skin: 0x3f7f7a }));
    const wenka = createCharacter('scientist', d, look({ glow: 0x7fff8a, hair: 'explorer', hairRoot: 0x12a48c, hairTip: 0x9aff6a, height: 0.92, build: 0.0, gender: 'm', iris: 0x9fff8a }));
    wenka.root.scale.setScalar(0.66); hohma.root.scale.setScalar(0.9);
    for (const fig of [hohma, wenka]) { fig.setGround((x, z) => this.h(x, z)); fig.root.visible = false; this.world.scene.add(fig.root); }
    this.folk = { hohma, wenka };
    this.actors['hohma'] = hohma; this.actors['wenka'] = wenka;
    return this.folk;
  }
  /** Where the two are while nothing else moves them: Hoh-Ma kneeling at her quern, Wen-Ka by the shelters. */
  private homeFolk() {
    const { c, d, t: tn } = this.fennAxes(), q = this.quernAt();
    const hm = q.clone().addScaledVector(d, -0.55); hm.y = this.h(hm.x, hm.z);
    const wk = c.clone().addScaledVector(tn, 1.8).addScaledVector(d, 0.6); wk.y = this.h(wk.x, wk.z);
    this.folkSpots = { hohma: { at: hm, yaw: Math.atan2(d.x, d.z), kneel: true }, wenka: { at: wk, yaw: Math.atan2(-tn.x, -tn.z), kneel: false } };
  }
  private placeFolk(id: 'hohma' | 'wenka', at: THREE.Vector3, face: THREE.Vector3, kneel = false) {
    if (!this.folkSpots) this.homeFolk();
    const y = Math.atan2(face.x - at.x, face.z - at.z);
    this.folkSpots![id] = { at: at.clone().setY(this.h(at.x, at.z)), yaw: y, kneel };
  }
  private folkT = 0;
  private updateFolk(dt: number) {
    if (this.s.level < 17) return;
    this.buildFenn();
    const F = this.buildFolk();
    if (!this.folkSpots) this.homeFolk();
    this.folkT += dt;
    // Wen-Ka comes even when the band keeps away; Hoh-Ma is only seen at her camp
    for (const id of ['hohma', 'wenka'] as const) {
      const fig = F[id], sp = this.folkSpots![id], dist = sp.at.distanceTo(this.player.pos);
      fig.root.visible = dist < 120;
      if (!fig.root.visible) continue;
      fig.root.position.copy(sp.at); fig.root.rotation.y = sp.yaw; fig.root.updateMatrixWorld();
      fig.setKneel(sp.kneel, sp.kneel);
      fig.animate('idle', this.folkT * 0.3, 0, performance.now() / 1000, dt);
    }
  }
  private leadOom() { return this.trust() >= 1 && !this.f('e2.oomsa.away'); }

  /** The field: rows beside the house, on the side away from the poles; how many by the choice (all of it: twice the rows). */
  fieldAt() {
    const H = this.house();
    for (const [ka, kb] of [[0, -5.2], [-5.5, -1.5], [5.5, -1.5], [0, -7]]) {
      const p = H.at.clone().addScaledVector(H.a, ka).addScaledVector(H.b, kb); p.y = this.h(p.x, p.z);
      if (p.y > 0.7 && !this.world.forest.blocks(p.x, p.z, 2.4)) return p;
    }
    const p = H.at.clone().addScaledVector(H.b, -5.2); p.y = this.h(p.x, p.z); return p;
  }
  private fieldG: THREE.Group | null = null;
  private fieldKey = '';
  /** The rows (0 none, 1 opened, 2 sown); `tint` (0 green to 1 gold) is for the later levels' sprouts and harvest. */
  fieldRows: THREE.Mesh[] = [];
  private buildField(st: number) {
    this.fieldG?.removeFromParent(); this.fieldG = null; this.fieldRows = [];
    if (st <= 0) return;
    const H = this.house(), at = this.fieldAt(), g = new THREE.Group();
    const n = this.f('e3.field.all') ? 9 : 5, len = 3.6;
    const soil = std(0x4a3626, { roughness: 1 }), ridge = std(0x5e4630, { roughness: 1 });
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.55, p = at.clone().addScaledVector(H.b, off);
      const fur = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, len), soil);
      fur.position.set(p.x, this.h(p.x, p.z) + 0.01, p.z); fur.rotation.y = Math.atan2(H.a.x, H.a.z); g.add(fur);
      const rd = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, len, 6, 1), ridge);
      const rp = p.clone().addScaledVector(H.b, 0.27); rd.position.set(rp.x, this.h(rp.x, rp.z) + 0.03, rp.z); rd.rotation.set(Math.PI / 2, 0, 0); rd.rotation.y = 0;
      rd.quaternion.setFromUnitVectors(UP, H.a); g.add(rd);
      if (st >= 2) this.fieldRows.push(fur);
    }
    // a peg and a cord along the first row (he sowed to a line)
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.4, 5), std(0x6a5440)); const pp = at.clone().addScaledVector(H.a, len / 2 + 0.2).addScaledVector(H.b, -((n - 1) / 2) * 0.55); peg.position.set(pp.x, this.h(pp.x, pp.z) + 0.2, pp.z); g.add(peg);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true; });
    this.group.add(g); this.fieldG = g;
  }
  private restoreField() {
    if (this.s.level < 17 || this.busy) return;
    const st = this.f('e3.fieldDone') ? 2 : 0;
    const key = `${st}/${this.f('e3.field.all') ? 1 : 0}/${this.siteNow()}`;
    if (key === this.fieldKey) return;
    this.fieldKey = key; this.buildField(st);
  }

  private update17() {
    if (!this.f('e3.l17.intro')) { this.intro17(); return; }
    const p = this.player.pos;
    if (!this.f('e3.wheat')) { const c = this.fennAt(); if (Math.hypot(p.x - c.x, p.z - c.z) < 6) this.campScene(); return; }
    if (isDiscovered(this.s, 'grain') && !this.f('e3.bread')) { this.breadScene(() => {}); return; }
    if (this.f('e3.bread') && !this.f('e3.fieldIntro')) { const a = this.fieldAt(); if (Math.hypot(p.x - a.x, p.z - a.z) < 4.5) this.fieldIntro(); return; }
    if (isDiscovered(this.s, 'farming') && !this.f('inv.farming')) { if (this.f('e3.fieldDone')) this.fieldChoice(() => {}); else this.sowScene(() => {}); return; }
  }

  /** Day 19: someone comes for him from the reeds: Oom-Sa (she trusts him), or the small one on his own. */
  private intro17() {
    const S = this.live();
    this.set('e3.l17.intro');
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 18, 18);
    this.passTime(9.0, true, 'e3.day', () => {
      const z = this.z, H = this.house(), F = this.buildFolk(); this.buildFenn();
      const door = H.at.clone().addScaledVector(H.b, 2.6); door.y = this.h(door.x, door.z);
      const camp = this.fennAt(), toward = camp.clone().sub(door).setY(0).normalize();
      const me = this.settle(door, door.clone().addScaledVector(toward, 4), false);
      const who = this.leadOom() ? 'oom' : 'wenka';
      const them = me.clone().addScaledVector(toward, 3.4); them.y = this.h(them.x, them.z);
      const oom = who === 'oom' ? this.oom() : null;
      if (oom) { this.actors['local'] = oom; this.npcs.pin('local', them, Math.atan2(me.x - them.x, me.z - them.z)); oom.setLookTarget(this.head()); }
      else this.placeFolk('wenka', them, me);
      const fig = oom ?? F.wenka;
      this.scene([
        { hold: 3.2, shot: () => this.wide(me, 5.5, 0.7, 0.8), run: () => { z.setLookTarget(them.clone().add(v3(0, oom ? 1.3 : 0.9, 0))); } },
        { hold: 2.2, shot: () => cover.mid(fig, 0.4, 2.0), run: () => { fig.setLookTarget(this.head()); fig.setHold({ R: { at: them.clone().add(v3(0, oom ? 1.25 : 0.85, 0)).addScaledVector(toward, 0.25).addScaledVector(this.side(toward), 0.15), fingers: toward.clone(), palm: UP.clone(), radius: 0.03 } }); S.after(1.8, () => fig.setHold(null)); } },
        { key: oom ? 'e3.l17.oom' : 'e3.l17.wk', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(them.clone().add(v3(0, 1, 0))) },
      ], () => {
        S.end(); this.clearHands(); fig.setHold(null);
        // they go on ahead to the camp
        if (oom) { const at = this.fennAt().addScaledVector(toward, -2.2); this.npcs.pin('local', at.setY(this.h(at.x, at.z)), Math.atan2(-toward.x, -toward.z)); }
        this.homeFolk();
        this.ui.toast(t('e3.obj.camp'));
      });
    });
  }

  /** The reed camp: Wen-Ka's first words, Hoh-Ma at her quern, and the grain in her tray. */
  private campScene() {
    const S = this.live();
    this.busy = true;
    const z = this.z, F = this.buildFolk(), { c, d, t: tn } = this.fennAxes(), q = this.quernAt();
    this.homeFolk();
    const me = this.settle(q.clone().addScaledVector(d, -1.5).addScaledVector(tn, -0.4), q, false);
    const wk = me.clone().addScaledVector(tn, 1.2).addScaledVector(d, 0.9); this.placeFolk('wenka', wk, me);
    const hm = this.folkSpots!.hohma.at, oom = this.leadOom() ? this.oom() : null;
    if (oom) { const at = c.clone().addScaledVector(d, -0.4).addScaledVector(tn, -2.0); this.actors['local'] = oom; this.npcs.pin('local', at.setY(this.h(at.x, at.z)), Math.atan2(me.x - at.x, me.z - at.z)); oom.setLookTarget(this.head()); }
    const wkLine = this.f('e2.called') ? 'e3.wk.1a' : this.f('e2.whistle') ? 'e3.wk.1b' : 'e3.wk.1c';
    const f = this.fwd(), r = this.right(f);
    const palm = me.clone().addScaledVector(f, 0.32).add(v3(0, 1.08, 0));
    const grains: THREE.Mesh[] = [];
    const beats: Beat[] = [
      { hold: 3.6, shot: () => ({ from: c.clone().addScaledVector(d, -7.5).addScaledVector(tn, 3.5).add(v3(0, 2.2, 0)), to: c.clone().add(v3(0, 1.0, 0)), fov: 50, push: 0.03 }), run: () => { z.setLookTarget(c.clone().add(v3(0, 1.2, 0))); F.wenka.setLookTarget(this.head()); F.hohma.setLookTarget(q.clone().add(v3(0, 0.2, 0))); } },
      { key: wkLine, who: 'wenka' as Who, shot: () => cover.close(F.wenka, 0.35, 0.9, -0.1), run: () => { F.wenka.setLookTarget(this.head()); if (wkLine === 'e3.wk.1b') F.wenka.setHold({ R: { at: wk.clone().add(v3(0, 0.62, 0)).addScaledVector(me.clone().sub(wk).setY(0).normalize(), 0.25), fingers: me.clone().sub(wk).setY(0).normalize(), palm: UP.clone(), radius: 0.025 } }); } },
    ];
    if (wkLine === 'e3.wk.1b') {
      // he gives the whistle back: a reed whistle from his pocket into the small hand
      let whistle: THREE.Mesh | null = null;
      beats.push({ hold: 2.6, shot: () => { const mid = wk.clone().lerp(me, 0.5).add(v3(0, 0.75, 0)); return { from: mid.clone().addScaledVector(r, 1.1).add(v3(0, 0.15, 0)), to: mid, fov: 30, push: 0.01, aperture: 0.004, lightAt: mid }; }, run: () => {
        const to = wk.clone().add(v3(0, 0.66, 0)).addScaledVector(me.clone().sub(wk).setY(0).normalize(), 0.27);
        whistle = this.mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.12, 6), std(0xd8c98a), to.clone());
        whistle.rotation.z = Math.PI / 2;
        z.setHold({ R: { at: to.clone().addScaledVector(f, -0.03).add(v3(0, 0.02, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.02, grasp: true } });
        S.after(1.4, () => { z.setHold(null); audio.tone(1760, 0.25, 'sine', 0.05); });
        S.after(2.0, () => { audio.tone(2200, 0.35, 'triangle', 0.06); audio.tone(2640, 0.25, 'triangle', 0.04, 0.12); });
      } }, { hold: 0.1, run: () => { whistle?.removeFromParent(); F.wenka.setHold(null); if (!this.f('e3.whistleBack')) { this.set('e3.whistleBack'); apply(this.s as unknown as StoryState, [{ trust: 'oomsa', by: 1 }]); } } });
    }
    beats.push(
      { hold: 2.4, shot: () => ({ from: hm.clone().addScaledVector(d, 1.3).addScaledVector(tn, 0.7).add(v3(0, 1.25, 0)), to: q.clone().add(v3(0, 0.25, 0)).lerp(hm.clone().add(v3(0, 0.7, 0)), 0.5), fov: 35, push: 0.02, lightAt: q.clone().add(v3(0, 0.3, 0)) }), run: () => {
        F.wenka.setHold(null); F.wenka.setLookTarget(q);
        const hand = F.hohma; this.anim(2.4, (k) => { const w = Math.sin(k * 5) * 0.08; const at = q.clone().add(v3(0, 0.22, 0)).addScaledVector(d, -0.05 + w); hand.setHold({ L: { at: at.clone().addScaledVector(tn, -0.07), fingers: d.clone(), palm: UP.clone().negate(), radius: 0.03 }, R: { at: at.clone().addScaledVector(tn, 0.07), fingers: d.clone(), palm: UP.clone().negate(), radius: 0.03 } }); });
        audio.sample('stone', 0.15, { rate: 0.5 });
      } },
      { key: this.f('fire.high') ? 'e3.hm.1h' : 'e3.hm.1', who: 'hohma' as Who, shot: () => cover.close(F.hohma, 0.4, 1.0, -0.22), run: () => { F.hohma.setHold(null); F.hohma.setLookTarget(this.head()); } },
      { key: 'e3.hm.cairn', who: 'hohma' as Who, if: { flag: 'e2.cairn.six' }, shot: () => cover.close(F.hohma, -0.35, 1.0, -0.22) },
      // the grain: a head rubbed between his palms, the husk blown off, fat grains creased down one side
      { hold: 3.2, shot: () => ({ from: palm.clone().addScaledVector(f, 0.36).addScaledVector(r, 0.12).add(v3(0, 0.08, 0)), to: palm.clone(), fov: 24, push: 0.006, aperture: 0.003, lightAt: palm.clone(), lightScale: 0.7 }), run: () => {
        z.setLookTarget(palm);
        z.setHold({ L: { at: palm.clone().addScaledVector(r, -0.03), fingers: f.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: palm.clone().addScaledVector(r, 0.03).add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 } });
        S.anim(1.4, (k) => z.setHold({ L: { at: palm.clone().addScaledVector(r, -0.03), fingers: f.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: palm.clone().addScaledVector(r, 0.03 + 0.025 * Math.sin(k * 14)).add(v3(0, 0.035, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 } }));
        S.after(1.5, () => {
          z.setHold({ L: { at: palm.clone(), fingers: f.clone(), palm: UP.clone(), radius: 0.03 } });
          for (let i = 0; i < 6; i++) { const gm = this.mesh(new THREE.CapsuleGeometry(0.0035, 0.004, 2, 5), std(0xc89a50, { roughness: 0.6 }), palm.clone().add(v3(Math.cos(i * 1.7) * 0.012, 0.012, Math.sin(i * 1.7) * 0.012))); gm.scale.set(1, 1, 0.7); gm.rotation.set(0.3 * i, i, Math.PI / 2); grains.push(gm); }
          audio.sample('leather', 0.12, { rate: 1.6 });
        });
      } },
      { key: 'e3.wh.1', who: 'scientist', shot: () => { const hd = this.head(); return { from: hd.clone().addScaledVector(this.fwd(), 1.05).add(v3(0, -0.05, 0)), to: hd.clone(), fov: 32, push: 0.01 }; }, run: () => { z.setFace({ squint: 0.2 }); z.setLookTarget(palm); } },
      { key: 'e3.wh.2', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { z.setLookTarget(this.ahead()); } },
      { key: 'e3.wh.3', who: 'scientist', shot: () => cover.close(z, -0.4, 1.05, 0.24), run: () => { z.setFace({ frown: 0.3 }); } },
    );
    this.scene(beats, () => {
      S.end(); for (const gm of grains) gm.removeFromParent(); this.clearHands();
      if (this.folk) { this.folk.hohma.setHold(null); this.folk.wenka.setHold(null); this.folk.hohma.setLookTarget(null); }
      this.homeFolk();
      this.set('e3.wheat'); this.set('inv.wheat');
      this.ui.toast(t('e3.obj.grind'));
    });
  }

  /** The craft panel opens on him kneeling at Hoh-Ma's quern, both hands on the hand stone, pushing it down the hollow. */
  private beforeGrain(open: () => void) {
    const S = this.live();
    const z = this.z, { d, t: tn } = this.fennAxes(), q = this.quernAt();
    this.buildFenn();
    // Hoh-Ma moves aside for him; he kneels where she knelt, the hollow running away from him
    const F = this.buildFolk(); this.placeFolk('hohma', q.clone().addScaledVector(tn, 1.1).addScaledVector(d, -0.4), q, true);
    this.settle(q.clone().addScaledVector(d, -0.62), q.clone().addScaledVector(d, 1), true, true);
    const f = this.fwd(), r = this.right(f);
    const hs = this.fennG?.getObjectByName('handstone') as THREE.Mesh | undefined; const hs0 = hs?.position.clone();
    const top = q.clone().add(v3(0, 0.21, 0));
    const grip = (k: number) => {
      const w = Math.sin(k * 3.6) * 0.1, at = top.clone().addScaledVector(f, w);
      if (hs) hs.position.copy(at);
      z.setHold({ L: { at: at.clone().addScaledVector(r, -0.08).add(v3(0, 0.04, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true }, R: { at: at.clone().addScaledVector(r, 0.08).add(v3(0, 0.04, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03, grasp: true } });
    };
    grip(0);
    // low, from beside the quern: both hands, the hand stone and the flour at the hollow's lip
    const insert = (): Shot => { const from = top.clone().addScaledVector(r, 0.75).addScaledVector(f, 0.45).add(v3(0, 0.28, 0)); from.y = Math.max(from.y, this.h(from.x, from.z) + 0.3); return { from, to: top.clone().add(v3(0, 0.03, 0)), fov: 30, push: 0.012, aperture: 0.004, lightAt: top.clone() }; };
    this.scene([
      { hold: 4.0, shot: insert, run: () => { z.setLookTarget(top); F.hohma.setLookTarget(top); S.anim(4, (k) => { grip(k); if (Math.random() < 0.05) audio.sample('stone', 0.13, { rate: 0.55 }); }); } },
    ], () => { S.end(); if (hs && hs0) hs.position.copy(hs0); this.clearHands(); open(); });
    return true;
  }

  /** The flatbread on Hoh-Ma's hot stone: it browns, he eats it, burnt edge and all. */
  private breadScene(card: () => void) {
    const S = this.live();
    this.busy = true;
    const z = this.z, F = this.buildFolk(), { c, d, t: tn } = this.fennAxes(); this.buildFenn();
    const bake = this.fennG?.getObjectByName('bake'); const stone = bake ? bake.getWorldPosition(v3()) : c.clone();
    const me = this.settle(stone.clone().addScaledVector(tn, 0.8).addScaledVector(d, -0.5), stone, true, true);
    this.placeFolk('hohma', stone.clone().addScaledVector(tn, -0.9).addScaledVector(d, -0.3), stone, true);
    const bread = this.mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.012, 14), std(0xd8c49a, { roughness: 0.9 }), stone.clone().add(v3(0, 0.035, 0)));
    const m = bread.material as THREE.MeshStandardMaterial, raw = new THREE.Color(0xd8c49a), done = new THREE.Color(0x9a6a36);
    const f = this.fwd(), r = this.right(f);
    this.scene([
      { hold: 3.4, shot: () => ({ from: stone.clone().addScaledVector(d, 0.7).addScaledVector(tn, 0.3).add(v3(0, 0.35, 0)), to: stone.clone().add(v3(0, 0.04, 0)), fov: 30, push: 0.01, aperture: 0.004, lightAt: stone.clone().add(v3(0, 0.1, 0)) }), run: () => {
        z.setLookTarget(stone); audio.sample('fire', 0.25, { dur: 3 });
        S.anim(3.2, (k) => { m.color.copy(raw).lerp(done, Math.min(1, k / 3)); });
      } },
      { hold: 1.8, shot: () => cover.mid(z, 0.55, 1.9), run: () => {
        const at = me.clone().addScaledVector(f, 0.25).add(v3(0, 0.95, 0));
        bread.position.copy(at); m.color.copy(done);
        z.setHold({ R: { at: at.clone().addScaledVector(r, 0.06), fingers: f.clone(), palm: r.clone().negate(), radius: 0.03, grasp: true }, L: { at: at.clone().addScaledVector(r, -0.06), fingers: f.clone(), palm: r.clone(), radius: 0.03, grasp: true } });
      } },
      { key: 'e3.gr.ok', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { const at = this.head().addScaledVector(this.fwd(), 0.12).add(v3(0, -0.08, 0)); bread.position.copy(at); z.setHold({ R: { at: at.clone().addScaledVector(r, 0.05), fingers: f.clone(), palm: r.clone().negate(), radius: 0.03, grasp: true } }); z.setFace({ smile: 0.3 }); audio.sample('leather', 0.15, { rate: 1.8 }); } },
      { key: 'e3.hm.2', who: 'hohma' as Who, shot: () => cover.close(F.hohma, 0.4, 1.0, -0.22), run: () => { bread.removeFromParent(); z.setHold(null); F.hohma.setLookTarget(this.head()); z.setLookTarget(F.hohma.root.position.clone().add(v3(0, 0.8, 0))); } },
    ], () => {
      S.end(); bread.removeFromParent(); this.clearHands(); this.homeFolk();
      this.set('e3.bread'); this.set('inv.grain');
      this.ui.toast(t('e3.learn.grain'));
      this.busy = false;
      card();
      this.after(4, () => this.ui.toast(t('e3.obj.field')));
    });
  }

  /** At the field: the biggest heads saved; Lyrra's two knuckles. */
  private fieldIntro() {
    this.set('e3.fieldIntro');
    const z = this.z, at = this.fieldAt(), H = this.house();
    const me = this.settle(at.clone().addScaledVector(H.a, -2.4), at, false);
    this.scene([
      { hold: 3.0, shot: () => ({ from: at.clone().addScaledVector(H.a, -6.5).addScaledVector(H.b, 3.0).add(v3(0, 2.2, 0)), to: at.clone().add(v3(0, 0.4, 0)), fov: 45, push: 0.03 }), run: () => z.setLookTarget(at) },
      { key: 'e3.fd.1', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
      { hold: 6.0, shot: () => cover.mid(z, 0.6, 2.4), run: () => { z.setLookTarget(at); this.ui.memory('e3.fd.lyrra', 7); } },
    ], () => { this.clearHands(); this.ui.toast(t('level.17.hint')); void me; });
  }

  /** The craft panel opens on him kneeling at the first row, pressing seed in two knuckles deep with his fingers. */
  private beforeSow(open: () => void) {
    const S = this.live();
    const z = this.z, at = this.fieldAt(), H = this.house();
    this.buildField(1);
    const row = at.clone().addScaledVector(H.a, -1.4); row.y = this.h(row.x, row.z);
    this.settle(row.clone().addScaledVector(H.b, 0.55), row, true, true);
    const f = this.fwd(), r = this.right(f);
    const press = (k: number) => {
      const u = Math.abs(Math.sin(k * 3.2)), p = row.clone().addScaledVector(H.a, (k * 0.05) % 0.3).add(v3(0, 0.02 + u * 0.09, 0));
      z.setHold({ R: { at: p, fingers: UP.clone().negate().addScaledVector(f, 0.4).normalize(), palm: f.clone(), radius: 0.02 }, L: { at: p.clone().addScaledVector(r, -0.18).add(v3(0, 0.12, 0)), fingers: f.clone(), palm: UP.clone(), radius: 0.03, grasp: true } });
    };
    press(0);
    const insert = (): Shot => { const from = row.clone().addScaledVector(r, 0.7).addScaledVector(f, 0.35).add(v3(0, 0.32, 0)); from.y = Math.max(from.y, this.h(from.x, from.z) + 0.3); return { from, to: row.clone().add(v3(0, 0.06, 0)), fov: 30, push: 0.012, aperture: 0.004, lightAt: row.clone().add(v3(0, 0.08, 0)) }; };
    this.scene([
      { hold: 4.0, shot: insert, run: () => { z.setLookTarget(row); S.anim(4, (k) => press(k)); } },
    ], () => { S.end(); this.clearHands(); open(); });
    return true;
  }

  /** Rows opened with the digging stick, the seed in, a card (Day 24), and what to do with the rest of the seed. */
  private sowScene(card: () => void) {
    const S = this.live();
    this.busy = true;
    const z = this.z, at = this.fieldAt(), H = this.house();
    this.buildField(1);
    const start = at.clone().addScaledVector(H.a, 1.6).addScaledVector(H.b, 0.8);
    const me = this.settle(start, start.clone().addScaledVector(H.a, -3), false);
    const f = this.fwd(), r = this.right(f);
    const stick = this.mesh(new THREE.CylinderGeometry(0.018, 0.012, 1.1, 6), std(0x6a5440), me.clone());
    const stroke = (k: number) => {
      const u = Math.abs(Math.sin(k * 3.0)), tip = me.clone().addScaledVector(f, 0.55).add(v3(0, 0.02 + u * 0.14, 0)), top = tip.clone().addScaledVector(f, -0.5).add(v3(0, 0.8, 0));
      const d = tip.clone().sub(top).normalize();
      stick.position.copy(tip).lerp(top, 0.5); stick.quaternion.setFromUnitVectors(UP, d.clone().negate());
      z.setHold({ R: { at: top.clone().addScaledVector(d, 0.08), fingers: r.clone().negate(), palm: f.clone(), radius: 0.02, grasp: true }, L: { at: top.clone().addScaledVector(d, 0.32), fingers: r.clone().negate(), palm: f.clone(), radius: 0.02, grasp: true } });
    };
    stroke(0);
    this.scene([
      { hold: 3.6, shot: () => ({ from: me.clone().addScaledVector(r, 3.4).addScaledVector(f, 1.2).add(v3(0, 1.2, 0)), to: me.clone().addScaledVector(f, 0.6).add(v3(0, 0.7, 0)), fov: 40, push: 0.02 }), run: () => { z.setLookTarget(me.clone().addScaledVector(f, 0.6)); S.anim(3.6, (k) => { stroke(k); if (Math.random() < 0.04) audio.sample('stone', 0.12, { rate: 0.6 }); }); } },
    ], () => {
      S.end(); stick.removeFromParent(); this.clearHands();
      this.s.day = Math.max(this.s.day ?? 23, 23);
      this.passTime(17.5, true, 'e3.day', () => this.fieldChoice(card));
    });
  }
  private fieldChoice(card: () => void) {
    const S = this.live();
    this.busy = true;
    const z = this.z, at = this.fieldAt(), H = this.house();
    this.set('e3.fieldDone'); this.buildField(2); this.fieldKey = '';
    const me = this.settle(at.clone().addScaledVector(H.a, -2.6).addScaledVector(H.b, 0.4), at, false);
    const tray = this.mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.04, 12, 1, true), std(0x7a5a3a, { side: THREE.DoubleSide }), me.clone());
    const f = this.fwd(), r = this.right(f), tp = me.clone().addScaledVector(f, 0.3).add(v3(0, 0.95, 0));
    tray.position.copy(tp);
    z.setHold({ L: { at: tp.clone().addScaledVector(r, -0.13), fingers: f.clone(), palm: UP.clone(), radius: 0.03, grasp: true }, R: { at: tp.clone().addScaledVector(r, 0.13), fingers: f.clone(), palm: UP.clone(), radius: 0.03, grasp: true } });
    this.scene([
      { hold: 3.2, shot: () => ({ from: at.clone().addScaledVector(H.a, 5.5).addScaledVector(H.b, -3).add(v3(0, 1.6, 0)), to: me.clone().add(v3(0, 0.9, 0)), fov: 45, push: 0.02 }), run: () => { z.setLookTarget(tp); } },
      { hold: 1.2, shot: () => cover.close(z, 0.5, 1.15, 0.24) },
      { choice: 'e3.field', shot: () => cover.close(z, 0.5, 1.15, 0.24) },
      { key: 'e3.fd.all', who: 'scientist', if: CHOSE('e3.field', 'all'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      { key: 'e3.fd.half', who: 'scientist', if: CHOSE('e3.field', 'half'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      { key: 'e3.fd.band', who: 'scientist', if: CHOSE('e3.field', 'band'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      { hold: 2.8, shot: () => ({ from: at.clone().addScaledVector(H.a, -5).addScaledVector(H.b, 4).add(v3(0, 3.2, 0)), to: at.clone(), fov: 48, push: 0.02 }), run: () => { tray.removeFromParent(); z.setHold(null); this.buildField(2); } },
    ], () => {
      S.end(); tray.removeFromParent(); this.clearHands();
      this.set('inv.farming'); this.fieldKey = '';
      this.ui.toast(t('e3.learn.farming'));
      this.busy = false;
      card();
    });
  }

}

/** Episode Three's choices that test a flag; kept so the sealed data and the code agree on names (story_check reads it). */
export const E3_FLAGS = ['e3.site.rise', 'e3.site.reeds', 'e3.site.camp', 'e3.door.lee', 'e3.door.band', 'e3.door.view', 'e3.field.all', 'e3.field.half', 'e3.field.band'];
void test;
