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
import { createCreature, type CreatureView } from '../combat/view/creatures';
import { createCopier, honeycomb, leaf as leafMesh, iceBlock, strawTexture, wattleTexture, thatchCourse } from '../world/ep3props';
import type { Enemy } from '../combat/sim/species';
import { defaultLook, LINEAGES, type PlayerLook } from '../characters/custom';
import type { Who } from '../cinematic/cutscene';
import { Episode2 } from './episode2';
import { createRain, type Rain } from '../world/rain';
import { isAlive } from './branch';
import type { CrewId } from '../characters/looks';
import type { AwayStage } from './away/stage';

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
    if (n === 18) return isDiscovered(this.s, 'remedy') && this.f('inv.medicine');
    if (n === 19) return isDiscovered(this.s, 'icewall') && this.f('e3.wallDone');
    if (n === 20) return isDiscovered(this.s, 'irrigation') && this.f('e3.kitDone');
    if (n === 21) return isDiscovered(this.s, 'salt') && this.f('e3.ledger');
    return false;
  }
  override craftOpen(n: number) {
    if (n === 15) return this.f('e3.axeTried');
    if (n === 16) return this.f('e3.l16.intro') && (!this.campSite() || this.f('e3.ditch'));
    if (n === 17) return this.f('e3.wheat') && (isDiscovered(this.s, 'grain') ? this.f('e3.fieldIntro') : true);
    if (n === 18) return this.f('e3.l18.intro');
    if (n === 20) return this.f('e3.l20.intro');
    if (n === 21) return this.f('e3.harvest');
    return false;
  }
  /** Where the level's work is done (the frame goes up at the house, not by the fire). */
  override craftAt(n: number) { return n === 20 ? this.fieldAt() : n === 16 || n === 18 || n === 21 ? this.houseAt() : n === 17 ? (isDiscovered(this.s, 'grain') ? this.fieldAt() : this.quernAt()) : null; }
  /** Level 17 grinds grain at Hoh-Ma's quern before the field (the level's own discovery). */
  override craftNode(n: number) { return n === 17 && !isDiscovered(this.s, 'grain') ? TECH_BY_ID.grain : null; }
  override progress(n: number): string | null {
    if (n === 21) {
      if (!this.f('e3.harvest')) return null;
      if (!isDiscovered(this.s, 'salt')) return this.has('salt') ? t('e3.obj.salt') : t('e3.obj.brine');
      return null;
    }
    if (n === 20) {
      if (!this.f('e3.l20.intro')) return null;
      if (!isDiscovered(this.s, 'irrigation')) return this.has('irrigation') ? t('e3.obj.level') : null;
      return this.f('e3.kitDone') ? null : t('e3.obj.snare');
    }
    if (n === 18) {
      if (!this.f('e3.l18.intro')) return null;
      if (!isDiscovered(this.s, 'remedy')) return this.inv('lichen') < 1 ? t('e3.obj.lichen') : t('e3.obj.boil');
      return this.f('e3.doseDone') ? null : t('e3.obj.band');
    }
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
    if (n === 21) {
      if (!this.f('e3.harvest') || isDiscovered(this.s, 'salt')) return null;
      return this.has('salt') ? this.houseAt() : null; // the brine first (chapter2.ts points at the nearest)
    }
    if (n === 20) {
      if (!this.f('e3.l20.intro')) return null;
      if (!isDiscovered(this.s, 'irrigation')) return this.has('irrigation') ? this.fieldAt() : null;
      return this.f('e3.kitDone') ? null : this.snareAt();
    }
    if (n === 18) {
      if (!this.f('e3.l18.intro')) return null;
      // the lichen first (null: chapter2.ts points at the nearest), then the hearth in his house
      if (!isDiscovered(this.s, 'remedy')) return this.inv('lichen') < 1 ? null : this.houseAt();
      return this.f('e3.doseDone') ? null : this.fennAt();
    }
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
  override debug() { const p = this.player.pos; return { wait: +this.wait.toFixed(2), busy: this.busy, loaded: ep3Loaded(), free: this.free(), level: this.s.level, at: [+p.x.toFixed(1), +p.z.toFixed(1)], shelter: null, house: this.houseG ? { parts: this.meshCount(this.houseG), key: this.houseKey, at: [+this.house().at.x.toFixed(1), +this.house().at.z.toFixed(1)] } : null, kneel: +this.z.root.position.y.toFixed(2), rain: +this.raining.toFixed(2), walls: this.wallCount(), field: this.fieldG ? { rows: this.fieldRows.length, at: [+this.fieldAt().x.toFixed(1), +this.fieldAt().z.toFixed(1)] } : null, fenn: this.fennG ? [+this.fennAt().x.toFixed(1), +this.fennAt().z.toFixed(1)] : null }; }

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
    this.updateBand(dt);
    this.trample();
    this.updateRain(dt);
    this.restoreSprouts(); this.restoreDitch(); this.restoreKit(); this.tickKits(dt);
    this.fever(s.level === 18 && this.f('e3.l18.intro') && !this.f('e3.doseDone'), dt);
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
    if (s.level === 18) { this.update18(); return; }
    if (s.level === 19) { this.update19(); return; }
    if (s.level === 20) { this.update20(); return; }
    if (s.level === 21) { this.update21(); return; }
    // past Episode Three's last level: nothing more here
    if (s.level > 21) return;
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
  /** Every body standing (or lying) in the world now: the episode's own people, the band, Oom-Sa, the player. */
  private bodies(): Character[] {
    const out = new Set<Character>([...Object.values(this.actors), ...this.band, this.z]);
    const o = this.oom(); if (o) out.add(o);
    return [...out].filter((c) => !!c && c.root.visible && !!c.root.parent);
  }
  /** A shot that never starts inside a body or looks through one (GPU take EP3B A: the honeycomb and the cleaning inserts
   * were shot from inside Hoh-Ma and Wen-Ka; the house's "Dry. Inside." through Oom-Sa's back). The camera swings round
   * what it looks at, a little at a time, then rises, until it is clear. */
  protected safeShot(sh: Shot): Shot {
    const bodies = this.bodies(); if (!bodies.length) return sh;
    const axis = bodies.map((c) => { const a = c.root.getWorldPosition(new THREE.Vector3()), h = c.head.getWorldPosition(new THREE.Vector3()); return [a.add(h.clone().sub(a).multiplyScalar(0.08)), h] as const; });
    const P = new THREE.Vector3(), Q = new THREE.Vector3();
    const near = (a: THREE.Vector3, b: THREE.Vector3, p0: THREE.Vector3, p1: THREE.Vector3, skipEnd: number) => {
      let m = 9;
      for (let i = 0; i <= 14; i++) { const u = i / 14; P.copy(a).lerp(b, u); if (a.distanceTo(P) > a.distanceTo(b) - skipEnd) continue; for (let j = 0; j <= 6; j++) { Q.copy(p0).lerp(p1, j / 6); m = Math.min(m, P.distanceTo(Q)); } }
      return m;
    };
    const bad = (from: THREE.Vector3) => axis.some(([r, h]) => {
      // the subject (its head near where the camera looks) may fill the frame; it must not be cut by the lens or in front
      const subject = h.distanceTo(sh.to) < 0.45 || r.distanceTo(sh.to) < 0.45;
      if (near(from, from, r, h, 0) < 0.36) return true;
      return !subject && near(from, sh.to, r, h, 0.5) < 0.2;
    });
    if (!bad(sh.from)) return sh;
    const off = sh.from.clone().sub(sh.to);
    for (const lift of [0, 0.35, 0.7]) for (const a of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
      const f = sh.to.clone().add(off.clone().applyAxisAngle(UP, a)).add(v3(0, lift, 0));
      f.y = Math.max(f.y, this.h(f.x, f.z) + 0.3);
      if (!bad(f)) return { ...sh, from: f };
    }
    return sh;
  }
  protected override scene(beats: Beat[], then?: () => void) {
    super.scene(beats.map((b) => (b.shot ? { ...b, shot: () => this.safeShot((b.shot as () => Shot)()) } : b)), then);
  }
  /** The camera for a craft panel in this episode: in front of him and to one side, a little above, on his hands (null
   * outside Episode Three's levels or on Draxum's stage). */
  craftShot(): { from: THREE.Vector3; to: THREE.Vector3 } | null {
    if (!this.owns(this.s.level) || this.s.level === 19) return null;
    const me = this.z.root.position.clone(), f = this.fwd(), r = this.right(f), kneel = this.z.kneeling > 0.5;
    const hands = me.clone().addScaledVector(f, 0.4).add(v3(0, kneel ? 0.45 : 0.85, 0));
    const from = me.clone().addScaledVector(f, 1.25).addScaledVector(r, 0.55).add(v3(0, kneel ? 1.05 : 1.55, 0));
    from.y = Math.max(from.y, this.h(from.x, from.z) + 0.5);
    return { from, to: hands.lerp(this.head(), 0.35) };
  }
  override beforeCraft(n: TechNode, open: () => void): boolean {
    if (!this.owns(this.s.level)) return false;
    if (n.id === 'frame') return this.beforeFrame(open);
    if (n.id === 'grain') return this.beforeGrain(open);
    if (n.id === 'farming') return this.beforeSow(open);
    if (n.id === 'remedy') return this.beforeRemedy(open);
    if (n.id === 'irrigation') return this.beforeIrrigation(open);
    if (n.id === 'salt') return this.beforeSalt(open);
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
    if (this.owns(this.s.level) && id === 'salt') {
      const high = !!info && info.v > info.band[1];
      this.set('e3.failed.salt'); this.say(step === 0 ? (high ? 'e3.sa.spit' : 'e3.sa.slow') : 'e3.sa.scrape', 'scientist', 4.5); return true;
    }
    if (this.owns(this.s.level) && id === 'irrigation') {
      const high = !!info && info.v > info.band[1];
      if (step === 0 && high) { if (this.f('e3.ir.steep1')) this.set('e3.ir.steep2'); this.set('e3.ir.steep1'); }
      this.set('e3.failed.irrigation'); this.say(step === 0 ? (high ? 'e3.ir.steep' : 'e3.ir.flat') : 'e3.ir.dig', 'scientist', 4.5); return true;
    }
    if (this.owns(this.s.level) && id === 'remedy') {
      const high = !!info && info.v > info.band[1];
      this.set('e3.failed.remedy'); this.say(step === 0 ? (high ? 'e3.ct.over' : 'e3.ct.cool') : 'e3.ct.rush', 'scientist', 4.5); return true;
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
    if (this.owns(this.s.level) && n.id === 'remedy') { this.boiledScene(card); return true; }
    if (this.owns(this.s.level) && n.id === 'irrigation') { this.waterScene(card); return true; }
    if (this.owns(this.s.level) && n.id === 'salt') { this.busy = false; card(); return true; }
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

  private wallCount() { let n = 0; for (const a of this.world.forest.obstacles.values()) for (const o of a) if (o.tag === 'e3.house') n++; return n; }
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
    this.world.forest.removeTagged('e3.house');
    if (st <= 0) return;
    const H = this.house(), g = new THREE.Group(), y0 = H.at.y;
    // what he cannot walk through: each post, and (once the walls are up) a line of small circles along every wall with
    // the doorway left open (the owner could walk straight through the walls)
    const block = (u: number, w: number, r: number, h: number) => { const p = H.at.clone().addScaledVector(H.a, u).addScaledVector(H.b, w); this.world.forest.addObstacle(p.x, p.z, r, h, 'e3.house'); };
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
      block(u, w, 0.1, top);
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
    // (GPU take EP3B A: flat yellow boards and plain beige panels; now straw courses and woven, daubed walls)
    const thatch = std(0xffffff, { roughness: 1, map: strawTexture('straw') }), wattle = std(0xffffff, { roughness: 1, side: THREE.DoubleSide, map: wattleTexture() });
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const u = -1.6 + i * 0.8; log(fg, Lc(u, s * 1.55, EAVE - 0.12), Lc(u, 0, RIDGE + 0.08), 0.035, bark); }
    // the thatch: five rows a side laid from the eaves up, each over the one below
    const rows = o.rows ?? 10;
    for (let i = 0; i < 5; i++) for (const s of [1, -1]) {
      const E = Lc(0, s * 1.75, EAVE - 0.2), R = Lc(0, 0, RIDGE + 0.12), up = R.clone().sub(E), len = up.length(); up.normalize();
      const c = E.clone().addScaledVector(up, len * (i + 0.6) / 5.2);
      const box = new THREE.Mesh(thatchCourse(3.9, (len / 5) * 1.45, i * 2 + (s > 0 ? 1 : 0)), thatch);
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
      const bg = new THREE.BoxGeometry(len, h1 - h0, 0.07), uv = bg.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.9, uv.getY(i) * (h1 - h0) / 0.9);
      const m = new THREE.Mesh(bg, wattle);
      m.position.copy(p0).lerp(p1, 0.5); m.position.y = (h0 + h1) / 2;
      m.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x); m.castShadow = true; m.receiveShadow = true; fg.add(m);
    };
    const sides: Record<string, [number, number, number, number]> = { 'a+': [1.6, -1.3, 1.6, 1.3], 'a-': [-1.6, 1.3, -1.6, -1.3], 'b+': [1.6, 1.3, -1.6, 1.3], 'b-': [-1.6, -1.3, 1.6, -1.3] };
    const solid = (u0: number, w0: number, u1: number, w1: number) => {
      const n = Math.max(1, Math.ceil(Math.hypot(u1 - u0, w1 - w0) / 0.22));
      for (let i = 0; i <= n; i++) block(u0 + (u1 - u0) * (i / n), w0 + (w1 - w0) * (i / n), 0.12, EAVE);
    };
    for (const [k, [u0, w0, u1, w1]] of Object.entries(sides)) {
      if (k !== door) { wall(u0, w0, u1, w1, -0.3, EAVE - 0.08); solid(u0, w0, u1, w1); continue; }
      // (the doorway's colliders 1.3 m apart: at 1.0 m, 0.76 m clear for a 0.7 m body, GPU take EP3B B shut him in)
      { const du = u1 - u0, dw = w1 - w0, L2 = Math.hypot(du, dw), a0 = 0.5 - 0.66 / L2, a1 = 0.5 + 0.66 / L2; solid(u0, w0, u0 + du * a0, w0 + dw * a0); solid(u0 + du * a1, w0 + dw * a1, u1, w1); }
      const mu = (u0 + u1) / 2, mw = (w0 + w1) / 2, du = (u1 - u0), dw = (w1 - w0), L2 = Math.hypot(du, dw), k0 = 0.5 - 0.52 / L2, k1 = 0.5 + 0.52 / L2;
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
        // (from his side at head height, his face and the arm he holds: the close from in front looked down on his hair in the GPU take)
        { key: 'e3.fr.slip', who: 'scientist', shot: () => { const hd = this.head(), ff = this.fwd(), rr = this.right(ff); return { from: hd.clone().addScaledVector(rr, 0.85).addScaledVector(ff, 0.45).add(v3(0, 0.02, 0)), to: hd.clone().lerp(arm, 0.45), fov: 40, push: 0.01 }; }, run: () => { z.setLookTarget(arm); } },
        { key: 'e3.fr.bind', who: 'scientist', shot: () => cover.mid(z, 0.5, 2.0), run: () => {
          z.setFace({ frown: 0.4 });
          const ff = this.fwd(), rr = this.right(ff);
          S.anim(4, (k) => { const an = k * 6; z.setHold({ L: { at: arm.clone().addScaledVector(rr, -0.05), fingers: ff.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: arm.clone().addScaledVector(rr, 0.02 + 0.05 * Math.cos(an)).add(v3(0, 0.05 * Math.sin(an) + 0.02, 0)), fingers: rr.clone().negate(), palm: UP.clone().negate(), radius: 0.02 } }); });
        } },
      );
    }
    if (watch) {
      // Oom-Sa and the boy at the edge of the reeds, watching the frame: he copies "It's a parallelogram" in Zenvik's own
      // voice and laughs (it was a voice from off screen; the owner wanted to see the child)
      const toR = reeds.clone().sub(H.at).setY(0).normalize(), sideR = v3(toR.z, 0, -toR.x);
      const her = H.at.clone().addScaledVector(toR, 7); her.y = this.h(her.x, her.z);
      const boy = her.clone().addScaledVector(sideR, 1.1).addScaledVector(toR, -0.6); boy.y = this.h(boy.x, boy.z);
      const F = this.buildFolk();
      const look = H.at.clone().add(v3(0, 1.5, 0));
      beats.push(
        { hold: 2.4, shot: () => ({ from: H.at.clone().addScaledVector(toR, 1.6).addScaledVector(sideR, -1.2).add(v3(0, 1.35, 0)), to: her.clone().lerp(boy, 0.5).add(v3(0, 0.8, 0)), fov: 32, push: 0.02 }), run: () => {
          this.clearHands(); this.thatchRows.forEach((m) => { m.visible = true; });
          if (oom) { this.actors['local'] = oom; this.npcs.pin('local', her, Math.atan2(H.at.x - her.x, H.at.z - her.z)); oom.setLookTarget(look); }
          this.wk16 = true; this.placeFolk('wenka', boy, H.at); F.wenka.setLookTarget(look);
          z.setLookTarget(boy.clone().add(v3(0, 0.8, 0)));
        } },
        { key: 'e3.wk.copy', who: 'wenka' as Who, shot: () => cover.close(F.wenka, 0.35, 0.95, -0.12), run: () => { F.wenka.setLookTarget(this.head()); this.set('e3.wk.copy'); } },
        { hold: 1.6, shot: () => cover.mid(F.wenka, -0.4, 1.8), run: () => { audio.human('laugh', 0.35); F.wenka.setFace?.({ smile: 0.8 }); } },
      );
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
        // the first rain on the new roof: streaks outside the doorway, none under the thatch; it eases off after a while
        this.rain(1, 40);
        audio.sample('amb_rain', 0.4, { dur: 12 });
        // inside, sitting by the hearth ring, looking up at the underside of the roof
        const seat = H.at.clone().addScaledVector(H.a, -0.7).setY(0);
        this.settle(seat, H.at.clone().addScaledVector(H.a, 0.8), true, true);
        z.setFace(null);
      } },
      { key: 'e3.fr.ok', who: 'scientist', shot: () => { const hd = this.head(); return { from: hd.clone().addScaledVector(this.fwd(), 1.35).addScaledVector(this.right(this.fwd()), 0.55).add(v3(0, 0.05, 0)), to: hd.clone().add(v3(0, 0.02, 0)), fov: 42, push: 0.01 }; }, run: () => { z.setLookTarget(H.at.clone().add(v3(0, 2.6, 0))); z.setFace({ smile: 0.2 }); } },
      { hold: 2.8, shot: () => { const hd = this.head(); return { from: hd.clone().add(v3(0, -0.1, 0)).addScaledVector(this.fwd(), -0.2), to: H.at.clone().add(v3(0, 2.5, 0)).addScaledVector(H.b, 0.6), fov: 50, push: 0.01, lightAt: H.at.clone().add(v3(0, 2.3, 0)), lightScale: 0.6 }; } },
    );
    this.scene(beats, () => {
      S.end();
      this.clearHands();
      this.wk16 = false; if (this.folk) { this.folk.wenka.setFace?.(null); this.folk.wenka.setLookTarget(null); this.folkSpots = null; }
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

  // ------------------------------------------------------------------ rain (the house's first, the storm in 21)
  private rainFx: Rain | null = null;
  private rainUntil = 0;
  /** Rain for `sec` seconds of play (0: until told otherwise), at `amount`. */
  protected rain(amount: number, sec = 0) {
    if (!this.rainFx) this.rainFx = createRain(this.world.scene, this.world.q.name !== 'mobile');
    this.rainFx.set(amount); this.rainUntil = sec > 0 ? performance.now() / 1000 + sec : 0;
  }
  private updateRain(dt: number) {
    const R = this.rainFx;
    if (!R) return;
    if (this.rainUntil && performance.now() / 1000 > this.rainUntil) { this.rainUntil = 0; R.set(0); }
    const H = this.houseG && this.f('e3.thatched') ? this.house() : null;
    const covered = H ? (x: number, z: number, y: number) => { const dx = x - H.at.x, dz = z - H.at.z, u = dx * H.a.x + dz * H.a.z, w = dx * H.b.x + dz * H.b.z; return Math.abs(u) < 2.0 && Math.abs(w) < 1.85 && y < H.at.y + 2.9; } : undefined;
    R.update(dt, this.player.pos, covered);
    // the soundscape reads world.weather.rain (main.ts)
    (this.world as unknown as { weather?: { rain: number } }).weather = { rain: R.amount };
  }
  get raining() { return this.rainFx?.amount ?? 0; }

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
    const pole = std(0x6a5440, { roughness: 0.95 }), reed = std(0xffffff, { roughness: 1, map: strawTexture('reed') }), mat = std(0x8a7448, { roughness: 1 });
    // three shelters on stilts (the shore floods), domed reed roofs, a ladder of lashed poles
    const spots: [number, number, number][] = [[2.6, -1.2, 1.0], [-1.8, 2.8, 0.9], [-2.4, -3.0, 0.8]];
    for (const [a, b, sc] of spots) {
      const at = c.clone().addScaledVector(d, a).addScaledVector(tn, b), y = this.h(at.x, at.z), deck = y + 0.75;
      for (const [px, pz] of [[-0.8, -0.7], [0.8, -0.7], [-0.8, 0.7], [0.8, 0.7]]) {
        const p = at.clone().addScaledVector(d, px * sc).addScaledVector(tn, pz * sc), gy = this.h(p.x, p.z);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, deck - gy + 0.05, 6), pole); m.position.set(p.x, (deck + gy) / 2, p.z); g.add(m);
      }
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.9 * sc, 0.07, 1.7 * sc), mat); plat.position.set(at.x, deck, at.z); plat.rotation.y = Math.atan2(d.x, d.z); g.add(plat);
      // a dome of reed bundles: lumpy, its eaves ragged, the reeds running from the top down (sphere uvs: v from the top)
      const rg = new THREE.SphereGeometry(1.0 * sc, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), rp = rg.getAttribute('position'), ruv = rg.getAttribute('uv');
      for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), y = rp.getY(i), zz = rp.getZ(i), an = Math.atan2(zz, x), k = 1 + Math.sin(an * 9 + a) * 0.035 + Math.sin(y * 11 + an * 3) * 0.02; rp.setXYZ(i, x * k, y < 0.05 ? y - 0.06 - Math.abs(Math.sin(an * 23 + b)) * 0.08 : y * k, zz * k); ruv.setXY(i, ruv.getX(i) * 8, ruv.getY(i) * 2.2); }
      rg.computeVertexNormals();
      const roof = new THREE.Mesh(rg, reed); roof.scale.set(1.05, 0.95, 0.95); roof.position.set(at.x, deck + 0.04, at.z); roof.castShadow = true; g.add(roof);
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
  private folkSpots: Record<'hohma' | 'wenka', { at: THREE.Vector3; yaw: number; kneel: boolean; lie?: THREE.Vector3 }> | null = null;
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
  private placeFolk(id: 'hohma' | 'wenka', at: THREE.Vector3, face: THREE.Vector3, kneel = false, lie?: THREE.Vector3) {
    if (!this.folkSpots) this.homeFolk();
    const y = Math.atan2(face.x - at.x, face.z - at.z);
    this.folkSpots![id] = { at: at.clone().setY(this.h(at.x, at.z)), yaw: y, kneel, lie: lie?.clone().setY(0).normalize() };
  }
  /** A body laid on its back on the ground: the feet at `at`, the head along `dir`, the face up (the rest body; its arms
   * down along its sides, the knees a little up). */
  private layDown(fig: Character, at: THREE.Vector3, dir: THREE.Vector3) {
    const up = dir.clone(), fw = UP.clone(), side = new THREE.Vector3().crossVectors(up, fw).normalize();
    const m = new THREE.Matrix4().makeBasis(side, up, fw);
    fig.root.quaternion.setFromRotationMatrix(m);
    fig.root.position.copy(at).add(v3(0, 0.1 * fig.root.scale.y, 0));
    fig.setKneel(false, false, true);
    fig.setLimbs({ armL: [0.2, -0.98, 0.04], foreL: [0.08, -0.95, 0.3], armR: [-0.2, -0.98, 0.04], foreR: [-0.08, -0.95, 0.3], legL: [0.06, -0.93, 0.36], shinL: [0.02, -0.96, -0.28], legR: [-0.08, -0.97, 0.22], shinR: [-0.02, -0.99, -0.1] });
  }
  private folkT = 0;
  /** The rest of the band (EPISODE_THREE_SCRIPT 3.5: "eleven of them"): eight more Fennish (four on phones), full game
   * bodies at the camp's own work: two at the fire, one weaving, one at the tray, watchers by the shelters and the shore,
   * a second child. They turn their heads to him when he is near. At the harvest some reap beside him (with trust). */
  private band: Character[] = [];
  private bandSpots: { at: THREE.Vector3; yaw: number; kneel: boolean; heels: boolean }[] = [];
  private bandMode = '';
  private buildBand() {
    if (this.band.length) return this.band;
    const mob = this.world.q.name === 'mobile', d = mob ? 0.6 : 1;
    const base = (o: Partial<PlayerLook>): PlayerLook => ({ ...defaultLook(), lineage: 'vael', ...LINEAGES.vael, skin: 0x2f8f8f, ears: 'fin', tail: true, marks: 'stars', outfit: 'explorer', eye: 'doll', iris: 0x8aff9a, glow: 0x5ac87a, ...o });
    const looks: [Partial<PlayerLook>, number][] = [
      [{ gender: 'm', hair: 'strong', hairRoot: 0x0e4a40, hairTip: 0x6ad8a0, height: 1.0, build: 0.4, skin: 0x2a7f7c, eye: 'narrow' }, 0.92],
      [{ gender: 'f', hair: 'social', hairRoot: 0x12a48c, hairTip: 0xb6ff5a, height: 0.96, build: 0.15, skin: 0x358f88 }, 0.9],
      [{ gender: 'f', hair: 'medic', hairRoot: 0x1a5a50, hairTip: 0x9adfc0, height: 0.98, build: 0.3, skin: 0x2f7a80, eye: 'calm' }, 0.9],
      [{ gender: 'm', hair: 'builder', hairRoot: 0x0e3a3a, hairTip: 0x4ab88a, height: 1.04, build: 0.55, skin: 0x27706e, eye: 'squint' }, 0.94],
      [{ gender: 'f', hair: 'explorer', hairRoot: 0x12a48c, hairTip: 0xffd24a, height: 0.92, build: 0.0, skin: 0x3a9a90 }, 0.62],
      [{ gender: 'm', hair: 'scientist', hairRoot: 0x0e2a30, hairTip: 0x6fb6ff, height: 1.02, build: 0.2, skin: 0x2c8486, eye: 'tired' }, 0.92],
      [{ gender: 'f', hair: 'strong', hairRoot: 0x9ab0a8, hairTip: 0xdfe8e0, height: 0.94, build: 0.2, skin: 0x3f7f7a, eye: 'tired' }, 0.88],
      [{ gender: 'm', hair: 'medic', hairRoot: 0x12a48c, hairTip: 0x9aff6a, height: 1.0, build: 0.1, skin: 0x33888a }, 0.9],
    ];
    for (const [lk, sc] of looks.slice(0, mob ? 4 : 8)) {
      const fig = createCharacter('scientist', d, base(lk));
      fig.root.scale.setScalar(sc); fig.setGround((x, z) => this.h(x, z)); fig.root.visible = false; this.world.scene.add(fig.root);
      this.band.push(fig);
    }
    return this.band;
  }
  /** Where the band is: at their camp, or (level 21, the harvest with trust) reaping in the rows and carrying the sheaves. */
  private bandPlace(mode: string) {
    if (mode === this.bandMode) return;
    this.bandMode = mode; this.bandSpots = [];
    if (mode === 'camp') {
      const { c, d, t: tn } = this.fennAxes(), fire = c.clone().addScaledVector(d, -0.6).addScaledVector(tn, -0.6);
      // [along d, along t, kneel, heels, face: 0 the fire, 1 the lake, 2 the camp's middle]
      const spots: [number, number, boolean, boolean, number][] = [[-1.5, -0.1, true, true, 0], [-0.1, -1.6, true, true, 0], [-0.9, 3.6, true, false, 2], [1.5, -2.2, false, false, 2], [-1.4, -2.6, true, true, 2], [4.4, 0.9, false, false, 1], [0.8, 1.6, true, false, 2], [-3.6, 0.4, false, false, 2]];
      for (const [a, b, kn, he, face] of spots) {
        const at = c.clone().addScaledVector(d, a).addScaledVector(tn, b); at.y = this.h(at.x, at.z);
        const to = face === 0 ? fire : face === 1 ? at.clone().addScaledVector(d, 3) : c;
        this.bandSpots.push({ at, yaw: Math.atan2(to.x - at.x, to.z - at.z), kneel: kn, heels: he });
      }
    } else if (mode === 'field') {
      const at = this.fieldAt(), H = this.house(), n = Math.max(1, this.fieldRows.length);
      for (let i = 0; i < 8; i++) {
        const row = (i % n) - (n - 1) / 2, reap = i < 5;
        const p = at.clone().addScaledVector(H.b, reap ? row * 0.55 + 0.27 : -((n - 1) / 2) * 0.55 - 1.2 - (i - 5) * 0.9).addScaledVector(H.a, reap ? -1.2 + i * 0.6 : 0.8 + (i - 5) * 0.7);
        p.y = this.h(p.x, p.z);
        const to = reap ? p.clone().addScaledVector(H.a, 1) : at;
        this.bandSpots.push({ at: p, yaw: Math.atan2(to.x - p.x, to.z - p.z), kneel: reap, heels: false });
      }
    }
  }
  private updateBand(dt: number) {
    const lvl = this.s.level;
    const mode = lvl < 17 || lvl === 19 ? '' : this.bandHarvest ? 'field' : 'camp';
    if (!mode && !this.band.length) return;
    if (mode) this.buildBand();
    this.bandPlace(mode);
    const me = this.player.pos, t = performance.now() / 1000;
    this.band.forEach((fig, i) => {
      const sp = this.bandSpots[i];
      // nobody of the band stands where a scene is played round him or Hoh-Ma and Wen-Ka (the still of the dose scene had one
      // standing in the middle of it): they step back out of the way, i.e. are not drawn there
      const fs = this.folkSpots, clash = !!sp && (sp.at.distanceTo(me) < 2.4 || (!!fs && (sp.at.distanceTo(fs.hohma.at) < 1.6 || sp.at.distanceTo(fs.wenka.at) < 1.6)));
      fig.root.visible = !!sp && !clash && sp.at.distanceTo(me) < 90;
      if (!fig.root.visible || !sp) return;
      fig.root.position.copy(sp.at); fig.root.rotation.y = sp.yaw; fig.root.updateMatrixWorld();
      fig.setKneel(sp.kneel, sp.heels);
      // they watch him when he is near (the adults from where they are, saying nothing)
      const dd = sp.at.distanceTo(me);
      fig.setLookTarget(dd < 14 && (i + Math.floor(t / 7)) % 3 !== 0 ? this.head() : null);
      fig.animate('idle', this.folkT * 0.3 + i * 1.7, 0, t + i, dt);
    });
  }
  /** Where people live and work the grass is trodden short (the GPU take's inserts at the house and the reed camp were shot
   * through blades a metre tall): from level 16 the house's floor and, from 17, the reed camp take the two clearings
   * the first days used (the crew spot and the second wreck). */
  private trampleKey = '';
  private trample() {
    const lvl = this.s.level, w = this.world as unknown as { clearings: [number, number, number][]; grass?: { setClearings(l: [number, number, number][]): void } };
    if (lvl < 16 || !w.grass || !w.clearings?.length || !this.f('e3.siteDone')) return;
    const H = this.house(), key = `${this.siteNow()}/${lvl >= 17}`;
    if (key === this.trampleKey) return;
    this.trampleKey = key;
    const list: [number, number, number][] = [w.clearings[0], w.clearings[1], [H.at.x, H.at.z, 4.2]];
    if (lvl >= 17) { const c = this.fennAt(); list.push([c.x, c.z, 6.5]); }
    w.grass.setClearings(list);
  }
  /** Level 21: the band reaps beside him while the harvest scene plays (trust >= 1). */
  private bandHarvest = false;
  private laid: 'hohma' | 'wenka' | null = null;
  /** Level 16: Wen-Ka stands at the reeds' edge for the frame going up (only while that beat plays). */
  private wk16 = false;
  private updateFolk(dt: number) {
    if (this.s.level < 17 && !this.wk16) { if (this.folk) { this.folk.wenka.root.visible = false; this.folk.hohma.root.visible = false; } return; }
    if (this.s.level >= 17) this.buildFenn();
    const F = this.buildFolk();
    if (!this.folkSpots) this.homeFolk();
    this.folkT += dt;
    // Wen-Ka comes even when the band keeps away; Hoh-Ma is only seen at her camp
    for (const id of ['hohma', 'wenka'] as const) {
      const fig = F[id], sp = this.folkSpots![id], dist = sp.at.distanceTo(this.player.pos);
      fig.root.visible = dist < 120 && (this.s.level >= 17 || id === 'wenka');
      if (!fig.root.visible) continue;
      if (sp.lie && this.s.level === 18) { this.layDown(fig, sp.at, sp.lie); fig.root.updateMatrixWorld(); fig.animate('lie', 0, 0, performance.now() / 1000, dt); this.laid = id; continue; }
      if (this.laid === id) { this.laid = null; fig.setLimbs(null); fig.root.quaternion.identity(); }
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

  // ------------------------------------------------------------------ level 18: the cut (3.7 red lines, 3.8 the one dose)
  private feverEl: HTMLDivElement | null = null;
  /** The fever: the edges of the picture breathe, red, while it lasts (style.css .e3-fever). */
  /** How hard the fever has him (0 to 1): it comes on over a few seconds and goes the same way; game.ts slows his walk,
   * takes his run and his breath by it (EPISODE_THREE_SCRIPT 3.7: "speed down, stamina down"). */
  feverAmount = 0;
  private fever(on: boolean, dt = 0) {
    this.feverAmount = Math.max(0, Math.min(1, this.feverAmount + (on ? dt / 4 : -dt / 3)));
    if (!on && !this.feverEl) return;
    if (!this.feverEl) { const d = document.createElement('div'); d.className = 'e3-fever'; document.body.appendChild(d); this.feverEl = d; }
    if (this.feverEl.classList.contains('on') !== on) this.feverEl.classList.toggle('on', on);
  }
  /** His left forearm held out (sitting or kneeling): where the wound is, the red lines running up to the elbow. */
  private woundG: THREE.Group | null = null;
  private showWound(arm: THREE.Vector3, f: THREE.Vector3, lines = true) {
    this.woundG?.removeFromParent();
    const g = new THREE.Group(), elbow = arm.clone().addScaledVector(f, -0.26).add(v3(0, 0.04, 0)), w = arm.clone().lerp(elbow, 0.35).add(v3(0, 0.03, 0));
    const sore = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 6), std(0x7a1a14, { roughness: 0.5 })); sore.scale.set(1.4, 0.35, 0.9); sore.position.copy(w); g.add(sore);
    const swell = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6), std(0xc0503a, { roughness: 0.7, transparent: true, opacity: 0.55 })); swell.scale.set(1.5, 0.3, 1.1); swell.position.copy(w); g.add(swell);
    if (lines) for (const off of [-0.008, 0.004, 0.014]) {
      const a = w.clone().add(v3(0, 0.004, 0)), b = elbow.clone().add(v3(0, 0.03, 0)).addScaledVector(this.right(f), off * 2);
      const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, d.length(), 4), std(0xb02a22, { roughness: 0.6 }));
      m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); g.add(m);
    }
    this.group.add(g); this.woundG = g;
    return w;
  }
  private hideWound() { this.woundG?.removeFromParent(); this.woundG = null; }

  private update18() {
    if (!this.f('e3.l18.intro')) { this.intro18(); return; }
    if (isDiscovered(this.s, 'remedy') && !this.f('e3.boiled')) { this.set('e3.boiled'); return; }
    if (this.f('e3.boiled') && !this.f('e3.doseDone')) { const c = this.fennAt(), p = this.player.pos; if (Math.hypot(p.x - c.x, p.z - c.z) < 8) this.doseScene(); }
  }

  /** Day 26: the wound has gone bad. Red lines up the inside of his arm, a fever; Oom-Sa sees it and runs to her people. */
  private intro18() {
    const S = this.live();
    this.set('e3.l18.intro');
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 25, 25);
    this.passTime(7.4, true, 'e3.day', () => {
      const z = this.z, H = this.house();
      const seat = H.at.clone().addScaledVector(H.a, -3.3); seat.y = this.h(seat.x, seat.z);
      const me = this.settle(seat, seat.clone().addScaledVector(H.a, -2), true, true);
      const f = this.fwd(), r = this.right(f);
      const arm = me.clone().addScaledVector(f, 0.34).addScaledVector(r, -0.08).add(v3(0, 0.6, 0));
      const pose = () => z.setHold({ L: { at: arm.clone(), fingers: f.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: arm.clone().addScaledVector(f, -0.2).addScaledVector(r, 0.05).add(v3(0, 0.05, 0)), fingers: r.clone().negate(), palm: UP.clone().negate(), radius: 0.03, grasp: true } });
      pose();
      const w = this.showWound(arm, f);
      const oom = this.leadOom() ? this.oom() : null;
      const her = me.clone().addScaledVector(f, 2.4).addScaledVector(r, 0.9); her.y = this.h(her.x, her.z);
      const beats: Beat[] = [
        { hold: 3.0, shot: () => this.wide(me, 5.0, 0.6, 0.9), run: () => { z.setLookTarget(w); z.setFace({ frown: 0.4, squint: 0.3 }); } },
        // insert: the wound and the lines walking up the arm from it
        { hold: 3.2, shot: () => ({ from: w.clone().addScaledVector(r, -0.32).addScaledVector(f, 0.12).add(v3(0, 0.22, 0)), to: w.clone().addScaledVector(f, -0.07), fov: 26, push: 0.006, aperture: 0.004, lightAt: w.clone(), lightScale: 0.6 }), run: () => { pose(); audio.human('breath', 0.4); } },
        { key: 'e3.ct.1', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95, 0.24), run: () => z.setLookTarget(w) },
        { key: 'e3.ct.2', who: 'scientist', shot: () => cover.close(z, -0.4, 1.0, 0.24), run: () => { z.setLookTarget(this.ahead()); z.setFace({ frown: 0.2 }); } },
        { hold: 6.5, shot: () => cover.mid(z, 0.55, 2.2), run: () => { z.setLookTarget(w); this.ui.memory('e3.ct.lyrra', 8); } },
      ];
      if (oom) {
        beats.push(
          { hold: 2.6, shot: () => this.oomClose(oom, 0.4, 1.1), run: () => { this.actors['local'] = oom; this.npcs.pin('local', her, Math.atan2(me.x - her.x, me.z - her.z)); oom.setLookTarget(w); z.setLookTarget(oom.root.position.clone().add(v3(0, 1.0, 0))); } },
          { hold: 2.2, shot: () => this.wide(me, 6.0, -0.5, 1.0), run: () => { const { c, d, t: tn } = this.fennAxes(); const at = c.clone().addScaledVector(d, 2.2).addScaledVector(tn, 2.6); this.npcs.pin('local', null, 0, at.setY(this.h(at.x, at.z))); oom.setLookTarget(null); this.set('e3.oomSaw'); } }, // beside the shelters, not on the camp's middle (the marker: walking there opened her talk instead of the scene)
        );
      }
      // the lichen: a magenta crust on the north side of a wall post, scraped off with his thumbnail into his palm (the
      // world's few tufts were all out of reach by now: the marker fell back to the camp)
      if (this.inv('lichen') < 1) {
        const post = H.at.clone().addScaledVector(H.a, -1.6).addScaledVector(H.b, -1.3).add(v3(0, 1.1, 0)).addScaledVector(H.b, -0.07);
        let crust: THREE.Mesh | null = null;
        beats.push(
          { hold: 3.0, shot: () => ({ from: post.clone().addScaledVector(H.b, -0.5).addScaledVector(H.a, -0.3).add(v3(0, 0.05, 0)), to: post.clone(), fov: 26, push: 0.006, aperture: 0.004, lightAt: post.clone() }), run: () => {
            this.clearHands(); this.hideWound();
            const stand = post.clone().addScaledVector(H.b, -0.45).addScaledVector(H.a, -0.15); stand.y = this.h(stand.x, stand.z);
            this.settle(stand, post.clone().setY(stand.y), false);
            crust = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), std(0x9a4a70, { roughness: 1 }), post.clone()); crust.scale.set(1, 1.6, 0.35);
            const ff = this.fwd();
            S.anim(3, (k) => { z.setHold({ R: { at: post.clone().addScaledVector(ff, -0.04).add(v3(0, 0.06 - (k % 0.8) * 0.12, 0)), fingers: ff.clone(), palm: ff.clone().negate(), radius: 0.015 }, L: { at: post.clone().addScaledVector(ff, -0.07).add(v3(0, -0.12, 0)), fingers: ff.clone(), palm: UP.clone(), radius: 0.03 } }); if (crust) crust.scale.y = 1.6 * Math.max(0.2, 1 - k / 3); });
            audio.sample('leather', 0.15, { rate: 2 });
          } },
        );
        beats.push({ hold: 0.1, run: () => { crust?.removeFromParent(); this.s.inventory.lichen = (this.s.inventory.lichen ?? 0) + 1; } });
      }
      this.scene(beats, () => {
        S.end(); this.clearHands(); this.hideWound();
        if (this.inv('lichen') < 1) this.s.inventory.lichen = 1;
        this.ui.toast(t('e3.obj.boil'));
        if (this.f('dose.used') || this.f('dose.saved')) this.after(7, () => this.say('e3.ct.usnea', 'scientist', 5));
      });
    });
  }

  /** The craft panel opens on him kneeling at the fire, his pot on the stones coming to the boil, the lichen beside it. */
  private beforeRemedy(open: () => void) {
    const S = this.live();
    // at the hearth ring in his own house (at the camp fire Oom-Sa's talk took the action from the craft)
    const z = this.z, H = this.house(), c = H.at.clone();
    this.settle(c.clone().addScaledVector(H.b, 0.85), c, true, true);
    const f = this.fwd(), r = this.right(f);
    const potAt = c.clone().lerp(this.z.root.position, 0.4); potAt.y = this.h(potAt.x, potAt.z) + 0.1;
    const embers = this.mesh(new THREE.CircleGeometry(0.24, 12), new THREE.MeshBasicMaterial({ color: 0xff7a2a }), c.clone().setY(this.h(c.x, c.z) + 0.04)); embers.rotation.x = -Math.PI / 2; embers.castShadow = false;
    const pot = this.mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.16, 14, 1, true), std(0x8a5a3a, { roughness: 0.85, side: THREE.DoubleSide }), potAt.clone());
    const water = this.mesh(new THREE.CircleGeometry(0.095, 14), std(0x8a9aa0, { roughness: 0.1, metalness: 0.2 }), potAt.clone().add(v3(0, 0.06, 0))); water.rotation.x = -Math.PI / 2;
    const lichen = this.mesh(new THREE.IcosahedronGeometry(0.04, 1), std(0x9a4a70, { roughness: 1 }), this.z.root.position.clone().addScaledVector(f, 0.3).addScaledVector(r, -0.25).add(v3(0, 0.03, 0))); lichen.scale.set(1.4, 0.5, 1.2);
    const steam: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) { const m = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.18, depthWrite: false }), potAt.clone().add(v3(0, 0.1, 0))); m.castShadow = false; steam.push(m); }
    this.scene([
      { hold: 3.6, shot: () => ({ from: potAt.clone().addScaledVector(r, 0.55).addScaledVector(f, -0.3).add(v3(0, 0.3, 0)), to: potAt.clone().add(v3(0, 0.05, 0)), fov: 30, push: 0.01, aperture: 0.004, lightAt: potAt.clone() }), run: () => {
        z.setLookTarget(potAt); audio.sample('fire', 0.3, { dur: 3.6 });
        S.anim(3.6, (k) => steam.forEach((m, i) => { const u = ((k * 0.5 + i / 5) % 1); m.position.copy(potAt).add(v3(Math.sin(i * 2 + k) * 0.03, 0.1 + u * 0.4, Math.cos(i * 3 + k) * 0.03)); m.scale.setScalar(0.6 + u * 1.4); (m.material as THREE.MeshBasicMaterial).opacity = 0.2 * (1 - u); }));
      } },
    ], () => { S.end(); for (const m of [pot, water, lichen, embers, ...steam]) m.removeFromParent(); this.clearHands(); open(); });
    return true;
  }

  /** The wound cleaned with boiled water and the lichen; it is not enough. To the band. */
  private boiledScene(card: () => void) {
    this.busy = true;
    const z = this.z;
    this.set('e3.boiled');
    this.scene([
      { key: 'e3.ct.ok', who: 'scientist', shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => { z.setFace({ frown: 0.3 }); z.setLookTarget(this.ahead()); } },
    ], () => {
      this.clearHands(); this.busy = false;
      this.ui.toast(t('e3.learn.remedy'));
      card();
      this.after(4, () => this.ui.toast(t('e3.obj.band')));
    });
  }

  /** The Fennish camp: Wen-Ka hot with a cut foot gone bad, the band's one honeycomb in a leaf, and who gets it. */
  private doseScene() {
    const S = this.live();
    this.busy = true;
    const z = this.z, F = this.buildFolk(), { c, d, t: tn } = this.fennAxes(); this.buildFenn();
    // the boy sits on a mat at the edge of the nearest shelter, his foot out in front of him, Hoh-Ma kneeling at it
    const mat = c.clone().addScaledVector(d, 1.0).addScaledVector(tn, -1.4); mat.y = this.h(mat.x, mat.z);
    const out = tn.clone().negate();
    // (he lies on his back, his head in the shelter's shade and the bad foot out towards them: owner, "Wen-Ka lies down")
    this.placeFolk('wenka', mat.clone().addScaledVector(out, 0.42), mat.clone().addScaledVector(out, 2), false, out.clone().negate());
    const hm = mat.clone().addScaledVector(out, 0.75).addScaledVector(d, 0.45); this.placeFolk('hohma', hm, mat, true);
    const me = this.settle(mat.clone().addScaledVector(out, 0.9).addScaledVector(d, -0.55), mat, true, true);
    const foot = mat.clone().addScaledVector(out, 0.42).add(v3(0, 0.06, 0));
    const mud = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), std(0x4a3a2a, { roughness: 1 }), foot.clone()); mud.scale.set(1.3, 0.6, 1.8);
    const f = this.fwd(), r = this.right(f);
    // the comb in a leaf, in Hoh-Ma's two hands
    const held = hm.clone().addScaledVector(mat.clone().sub(hm).setY(0).normalize(), 0.28).add(v3(0, 0.45, 0));
    // (real models: world/ep3props.ts, a torn piece of wild comb with its cells, honey and caps, on a broad leaf)
    const leaf = leafMesh(); leaf.position.copy(held); leaf.rotation.y = Math.atan2(r.x, r.z) + Math.PI / 2; this.group.add(leaf);
    const comb = honeycomb(); comb.position.copy(held).add(v3(0, 0.016, 0)); comb.rotation.y = leaf.rotation.y + 0.2; this.group.add(comb);
    const holdComb = () => F.hohma.setHold({ L: { at: held.clone().addScaledVector(r, -0.07).add(v3(0, -0.01, 0)), fingers: r.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: held.clone().addScaledVector(r, 0.07).add(v3(0, -0.01, 0)), fingers: r.clone().negate(), palm: UP.clone(), radius: 0.03 } });
    const boy = (): THREE.Vector3 => F.wenka.head.getWorldPosition(new THREE.Vector3());
    const clean = (k: number, at: THREE.Vector3) => { const u = Math.sin(k * 3) * 0.04; z.setHold({ R: { at: at.clone().addScaledVector(r, u).add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.02 }, L: { at: at.clone().addScaledVector(r, -0.09).add(v3(0, 0.02, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 } }); };
    const beats: Beat[] = [
      // (GPU take EP3B A: from the camp side a reed roof filled half the frame; now from the open side, over the three of them)
      { hold: 3.2, shot: () => ({ from: mat.clone().addScaledVector(out, 3.3).addScaledVector(d, 0.9).add(v3(0, 1.45, 0)), to: mat.clone().addScaledVector(out, 0.35).add(v3(0, 0.3, 0)), fov: 42, push: 0.02 }), run: () => {
        holdComb(); F.wenka.setLookTarget(this.head()); F.hohma.setLookTarget(foot); z.setLookTarget(boy()); F.wenka.setFace({ frown: 0.5, squint: 0.4 });
      } },
      // her close from in front of her (from the mat's side), not from the way the body's yaw says she faces
      { key: 'e3.ds.1', who: 'hohma' as Who, shot: () => { const hh = F.hohma.head.getWorldPosition(new THREE.Vector3()), dm = me.clone().sub(hm).setY(0).normalize(), sd = v3(dm.z, 0, -dm.x); return { from: hh.clone().addScaledVector(dm, 0.95).addScaledVector(sd, 0.3).add(v3(0, 0.12, 0)), to: hh.clone().add(v3(0, -0.06, 0)), fov: 40, push: 0.01 }; }, run: () => { F.hohma.setLookTarget(this.head()); } },
      // the comb in her hands from above and in front of her (the camera stood inside her body in the GPU take)
      { hold: 2.6, shot: () => { const away = held.clone().sub(hm).setY(0).normalize(), sd = v3(away.z, 0, -away.x); return { from: held.clone().addScaledVector(away, 0.3).addScaledVector(sd, 0.25).add(v3(0, 0.2, 0)), to: held.clone().add(v3(0, 0.01, 0)), fov: 30, push: 0.006, aperture: 0.004, lightAt: held.clone().add(v3(0, 0.15, 0)), lightScale: 0.6 }; }, run: () => z.setLookTarget(held) },
      { key: 'e3.ds.2', who: 'scientist', shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => { z.setLookTarget(boy()); z.setFace({ frown: 0.3 }); } },
      { hold: 1.2, shot: () => cover.close(z, 0.45, 1.1, 0.24), run: () => z.setLookTarget(held) },
      { choice: 'e3.dose', shot: () => cover.close(z, 0.45, 1.1, 0.24) },
      { key: 'e3.ds.boy', who: 'scientist', if: CHOSE('e3.dose', 'boy'), shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => z.setLookTarget(F.hohma.head ? F.hohma.root.position.clone().add(v3(0, 0.7, 0)) : held) },
      { key: 'e3.ds.truth', who: 'scientist', if: CHOSE('e3.dose', 'self'), shot: () => cover.close(z, -0.4, 1.0, 0.24), run: () => { z.setLookTarget(boy()); z.setFace({ frown: 0.5 }); } },
      { key: 'e3.ds.half', who: 'scientist', if: CHOSE('e3.dose', 'half'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
      // he cleans the boy's foot first (or shows her how, when he keeps the honey), Hoh-Ma holding him
      // the foot from above the boy's shins, looking out past it to the hands (the camera stood in a body in the GPU take)
      { hold: 3.6, shot: () => ({ from: foot.clone().addScaledVector(out, -0.45).add(v3(0, 0.78, 0)), to: foot.clone().addScaledVector(out, 0.12), fov: 34, push: 0.01, aperture: 0.004, lightAt: foot.clone().add(v3(0, 0.2, 0)) }), run: () => {
        comb.removeFromParent(); leaf.removeFromParent(); F.hohma.setHold(null); F.hohma.setLookTarget(foot); F.wenka.setLookTarget(foot);
        S.anim(3.6, (k) => clean(k, foot)); audio.human('breath', 0.3);
        S.after(2.0, () => { (mud.material as THREE.MeshStandardMaterial).color.setHex(0xc89a40); });
      } },
    ];
    this.scene(beats, () => {
      S.end(); mud.removeFromParent(); comb.removeFromParent(); leaf.removeFromParent(); this.clearHands(); F.hohma.setHold(null);
      this.holdArm();
    });
  }

  /** His own arm: boiled water and the lichen (and the honey if he kept any), a long hold with the fever on. */
  private async holdArm() {
    this.busy = true;
    const z = this.z, self = this.f('e3.dose.self'), half = this.f('e3.dose.half');
    const me = this.z.root.position.clone(), f = this.fwd(), r = this.right(f);
    const arm = me.clone().addScaledVector(f, 0.34).addScaledVector(r, -0.08).add(v3(0, 0.6, 0));
    this.settle(me, me.clone().addScaledVector(f, 1), true, true);
    const w = this.showWound(arm, f, false);
    z.setHold({ L: { at: arm.clone(), fingers: f.clone(), palm: UP.clone(), radius: 0.03 }, R: { at: w.clone().add(v3(0, 0.04, 0)), fingers: r.clone().negate(), palm: UP.clone().negate(), radius: 0.02 } });
    z.setLookTarget(w); z.setFace({ frown: 0.8, squint: 0.7 });
    const spec = self ? { kind: 'steady' as const, seconds: 4, strain: 1 } : half ? { kind: 'steady' as const, seconds: 6, strain: 1.7 } : { kind: 'steady' as const, seconds: 9, strain: 1.5 };
    const res = await this.tension(spec);
    const passed = !res || res.passed;
    this.hideWound(); this.clearHands();
    this.set(passed ? 'e3.held' : 'e3.fainted');
    if (passed) { this.afterDose(); return; }
    // he faints with the knife in his hand: three days, carried (trust) or alone on his own floor
    const carried = this.trust() >= 1 && !this.f('e2.oomsa.away');
    if (carried) { this.set('e3.carried'); apply(this.s as unknown as StoryState, [{ trust: 'oomsa', by: 1 }]); } else this.set('e3.feverScar');
    this.s.day = (this.s.day ?? 28) + 2;
    this.passTime(9, true, 'e3.later3', () => {
      const F = this.buildFolk(), H = this.house();
      if (carried) {
        const { c, d, t: tn } = this.fennAxes(), fire = c.clone().addScaledVector(d, -0.6).addScaledVector(tn, -0.6);
        const me2 = this.settle(fire.clone().addScaledVector(tn, -1.0), fire, true, true);
        this.placeFolk('hohma', fire.clone().addScaledVector(tn, 1.0), fire, true);
        this.scene([
          { hold: 3.0, shot: () => this.wide(me2, 4.5, 0.6, 0.8), run: () => { this.z.setLookTarget(fire); this.z.setFace({ squint: 0.4 }); } },
          { key: 'e3.ds.carried', who: 'hohma' as Who, shot: () => this.oomClose(F.hohma, 0.4, 1.0), run: () => F.hohma.setLookTarget(this.head()) },
        ], () => { this.clearHands(); this.homeFolk(); this.afterDose(); });
      } else {
        const seat = H.at.clone().addScaledVector(H.a, -0.7); seat.y = this.h(seat.x, seat.z);
        this.settle(seat, H.at.clone().addScaledVector(H.a, 0.8), true, true);
        this.scene([
          { key: 'e3.ds.alone', who: 'scientist', shot: () => { const hd = this.head(); return { from: hd.clone().addScaledVector(this.fwd(), 1.0).add(v3(0, -0.1, 0)), to: hd, fov: 35, push: 0.01 }; }, run: () => this.z.setFace({ squint: 0.4 }) },
        ], () => { this.clearHands(); this.afterDose(); });
      }
    });
  }
  private afterDose() {
    const z = this.z;
    this.scene([
      { key: 'e3.ds.end', who: 'scientist', shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => { z.setFace(null); z.setLookTarget(this.ahead()); } },
    ], () => {
      this.clearHands();
      this.set('e3.doseDone'); this.set('inv.medicine');
      this.ui.toast(t('e3.learn.medicine'));
      this.busy = false;
    });
  }

  // ------------------------------------------------------------------ level 19: The Wall (3.9, Draxum on Methryx, an interlude)
  /** Set by game.ts: the story's hooks (to play Draxum on his stage), the away stage, and the game's own decision panel. */
  hooks: { away: (id: CrewId, loc: string, task: (id: string, go: () => void) => void, done: () => void) => void } | null = null;
  awayStage: (() => AwayStage | null) | null = null;
  askFn: ((id: string, done: () => void) => void) | null = null;
  awayCut: ((from: THREE.Vector3, to: THREE.Vector3, secs: number, fov?: number) => void) | null = null;
  private wallOn = false;
  private wallN = 0;
  private wallG: THREE.Group | null = null;
  private update19() {
    if (this.f('e3.wallDone')) {
      if (!isDiscovered(this.s, 'icewall')) { this.busy = true; this.discover('icewall', () => { this.busy = false; this.ui.toast(t('e3.learn.icewall')); }); }
      return;
    }
    if (this.wallOn || !this.hooks) return;
    this.wallOn = true; this.wallN = 0; this.wallG = null; this.set('e3.l19.intro');
    this.busy = true;
    this.ui.fade('black', 1, 0.8);
    this.ui.banner(t('e3.wall.card'), t('e3.wall.sub'));
    this.after(3.4, () => {
      this.busy = false; this.ui.fade('black', 0, 0.8);
      this.hooks!.away('strong', 'moon', (id, go) => this.wallTask(id, go), () => { this.wallOn = false; this.wallG = null; this.set('e3.wallDone'); });
    });
  }
  /** The ring of ice blocks round his ember, a third more of it for each block hauled (15 in all, half a circle). */
  private wallBlocks(n: number) {
    const st = this.awayStage?.();
    if (!st) return;
    if (!this.wallG || !this.wallG.parent) { this.wallG = new THREE.Group(); this.wallG.name = 'e3.wall'; st.scene.add(this.wallG); }
    const g = this.wallG, want = Math.min(15, n * 5), ice = std(0xdcd6cc, { roughness: 0.35, metalness: 0.05 });
    for (let i = g.children.length; i < want; i++) {
      const row = i < 10 ? 0 : 1, k = row ? (i - 10) / 4 : i / 9, a = Math.PI * (0.1 + 0.8 * k) + Math.PI, R = 2.5;
      const x = Math.cos(a) * R, z = -6 + Math.sin(a) * R, y = st.height(x, z);
      const b = iceBlock(i + 1); void ice;
      b.position.set(x, y + 0.21 + row * 0.42, z); b.rotation.y = -a + Math.PI / 2 + (Math.sin(i * 7) * 0.08); b.castShadow = true; b.receiveShadow = true; g.add(b);
    }
  }
  /** Draxum's stage, once: a frozen lake at each place he cuts ice (a sheet of pale ice with cracks, a block half cut out of
   * it, the score lines), and the black lake the thing comes out of. */
  private moonDressed: THREE.Scene | null = null;
  private dressMoon() {
    const st = this.awayStage?.();
    if (!st || this.moonDressed === st.scene) return;
    this.moonDressed = st.scene;
    const g = new THREE.Group(); g.name = 'e3.moonLakes';
    const sheetM = new THREE.MeshStandardMaterial({ color: 0x8fa2ac, roughness: 0.18, metalness: 0.05, envMapIntensity: 1.4 });
    const crackM = new THREE.MeshBasicMaterial({ color: 0x3a4248 });
    const lake = (x: number, z: number, r: number, black: boolean, seed: number) => {
      const y = st.height(x, z);
      const shape = new THREE.Shape(); const n = 22;
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, rr = r * (1 + Math.sin(a * 3 + seed) * 0.12 + Math.sin(a * 5 - seed) * 0.06); if (i) shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 4), black ? new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.05, metalness: 0.3 }) : sheetM);
      m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.03, z); m.receiveShadow = true; g.add(m);
      if (black) return;
      for (let i = 0; i < 9; i++) { const a = seed + i * 0.7, l = r * (0.4 + (i % 3) * 0.2); const c = new THREE.Mesh(new THREE.PlaneGeometry(l, 0.012), crackM); c.rotation.set(-Math.PI / 2, 0, a); c.position.set(x + Math.cos(a * 1.7) * r * 0.3, y + 0.035, z + Math.sin(a * 1.3) * r * 0.3); g.add(c); }
      // a block half cut out of the sheet, standing proud of it
      const b = iceBlock(40 + seed); b.position.set(x + r * 0.35, y + 0.08, z - r * 0.2); b.rotation.set(0.12, seed, 0.06); g.add(b);
    };
    st.tasks.forEach((tk, i) => { if (/^ice\d$/.test(tk.id)) lake(tk.pos.x, tk.pos.z, 2.6, false, i * 2.3 + 1); });
    lake(15, -17, 5.5, true, 7);
    st.scene.add(g);
  }
  private wallTask(id: string, go: () => void) {
    if (!this.wallOn) { go(); return; }
    this.dressMoon();
    // the voice in the haze is never Bolzar himself: it gets its own label (and so is not stopped when he is dead)
    const say = (k: string, who: Who, sec: number, then: () => void) => { if (who === 'builder') this.ui.say(k, 'e3.who.voice', sec); else this.say(k, who, sec); this.after(sec, then); };
    if (/^ice\d$/.test(id)) {
      const n = ++this.wallN;
      this.wallBlocks(n);
      // the first block, carried bare-handed: his own heat slumps it where his palms are; then the sleeves round his hands
      if (n === 1) { this.set('e3.dx.melted'); say('e3.dx.1', 'strong', 5, () => { audio.sample('stone', 0.4, { rate: 0.6 }); say('e3.dx.melt', 'strong', 5, go); }); return; }
      if (n === 2) {
        const bolzarDead = !isAlive(this.s.branch, 'builder');
        if (bolzarDead) { say('e3.dx.hum', 'builder', 3, () => say('e3.dx.knows', 'strong', 5.5, go)); return; }
        if (this.f('draxum.bolzar.together')) { say('e3.dx.bol', 'builder', 4, () => say('e3.dx.why', 'strong', 4.5, go)); return; }
        say('e3.dx.wrap', 'strong', 4.5, go); return;
      }
      say('e3.dx.ring', 'strong', 4.5, go); return;
    }
    if (id === 'ember') { this.copier(go); return; }
    go();
  }
  /** The copier comes out of the lake for the warm one inside the ring; the choice of how to meet it (timed). */
  private copierState = { speed: 0, call: 0, rear: 0 };
  private copier(go: () => void) {
    const st = this.awayStage?.();
    let body: THREE.Group | null = null;
    if (st) {
      // (a real creature now: world/ep3props.ts createCopier, its own spine, six legs, a throat sac that swells as it calls)
      const cv = createCopier(this.world.q.name === 'mobile' ? 0.6 : 1); body = cv.root;
      const cs = this.copierState = { speed: 1, call: 0, rear: 0 };
      let last = performance.now();
      const tick = () => { if (!cv.root.parent && performance.now() - last > 500) return; const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; cv.update(now / 1000, dt, cs); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      st.scene.add(body);
      const from = new THREE.Vector3(14, 0, -16), to = new THREE.Vector3(2.6, 0, -8.4);
      this.anim(6, (k) => { const u = Math.min(1, k / 6), p = from.clone().lerp(to, u); p.y = st.height(p.x, p.z) - (1 - Math.min(1, k / 1.5)) * 1.2; body!.position.copy(p); this.copierState.speed = u < 1 ? 1 : 0.1; body!.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x); });
    }
    audio.sample('stone', 0.5, { rate: 0.45 });
    // a long lens over his shoulder onto it coming out of the black lake and up the shore (shot list 3.9/3: fov 20)
    if (st) { const y = st.height(-2.6, -3.6); this.awayCut?.(v3(-2.6, y + 1.9, -3.6), v3(8.3, st.height(8.3, -12.2) + 0.5, -12.2), 5.2, 22); }
    this.say('e3.dx.come', 'strong', 4.5);
    this.after(2.2, () => { this.copierState.call = 1; this.ui.say(isAlive(this.s.branch, 'builder') ? 'e3.dx.voice' : 'e3.dx.hum', 'e3.who.voice', 3); });
    this.after(5.2, () => { this.copierState.call = 0; });
    this.after(5.4, () => {
      const ask = this.askFn ?? ((_: string, d: () => void) => d());
      ask('e3.wall', async () => {
        const hurt = this.f('hurt.draxum');
        const leave = () => { this.copierState.rear = 0; this.copierState.speed = 1; if (body) { const b = body; this.anim(3, (k) => { b.position.x += 0.08; b.position.z -= 0.05; b.position.y -= k * 0.01; }); this.after(3.2, () => b.removeFromParent()); } };
        if (this.f('e3.wall.mock')) {
          this.say('e3.dx.joke', 'strong', 3.5);
          this.after(3.6, () => { this.say('e3.dx.mocked', 'strong', 4.5); leave(); this.after(4.6, () => this.wallEnd(go)); });
          return;
        }
        if (this.f('e3.wall.climb')) {
          const r = await this.tension({ kind: 'quick', count: 5 });
          this.set(r && !r.passed ? 'e3.wall.slipped' : 'e3.wall.climbed'); this.set('draxum.wallLost');
          // it takes the ring apart, block by block, and goes
          if (this.wallG) { const g = this.wallG; this.anim(2.5, (k) => g.children.forEach((b, i) => { b.rotation.z = Math.min(1.4, k * (0.4 + (i % 3) * 0.3)); b.position.y -= 0.004 * (i % 4); })); }
          this.say('e3.dx.lost', 'strong', 5); leave(); this.after(5.2, () => this.wallEnd(go));
          return;
        }
        // hold the wall (and a silent timeout): a steady hold against it while it pushes; shorter with his old hurt
        const hold = () => { this.copierState.rear = 1; this.copierState.speed = 0.3; return this.tension({ kind: 'steady', seconds: 6, strain: hurt ? 1.6 : 1.1 }); };
        let r = await hold();
        let held = !r || r.passed;
        if (!held && hurt && this.f('draxum.waited')) { this.say('e3.dx.again', 'strong', 3); r = await hold(); held = !r || r.passed; if (!held) this.set('e3.wall.twice'); }
        this.set(held ? 'e3.wall.held' : 'draxum.hurt2');
        this.say(held ? 'e3.dx.held' : 'e3.dx.thrown', 'strong', 5); leave(); this.after(5.2, () => this.wallEnd(go));
      });
    });
  }
  private wallEnd(go: () => void) {
    this.say('e3.dx.end', 'strong', 5);
    this.after(5.2, () => go());
  }

  // ------------------------------------------------------------------ level 20: water runs downhill (3.10 dry weeks, 3.11 the kit)
  /** The sprouts in the rows: yellowing in the dry weeks (`dry` 1), green once the ditch runs, gold at the harvest (`gold` 1). */
  private sproutG: THREE.Group | null = null;
  private sproutKey = '';
  private sprouts(dry: number, gold = 0) {
    const key = `${dry.toFixed(2)}/${gold.toFixed(2)}/${this.fieldRows.length}`;
    if (key === this.sproutKey && this.sproutG?.parent) return;
    this.sproutKey = key;
    this.sproutG?.removeFromParent(); this.sproutG = null;
    if (!this.fieldRows.length) return;
    const H = this.house(), g = new THREE.Group();
    const col = new THREE.Color(0x4f8a2a).lerp(new THREE.Color(0xb0a040), dry).lerp(new THREE.Color(0xd8b050), gold);
    const m = std(col.getHex(), { roughness: 0.9 }), tall = 0.12 + gold * 0.75;
    for (const row of this.fieldRows) {
      for (let i = 0; i < 14; i++) {
        const p = row.position.clone().addScaledVector(H.a, -1.65 + i * 0.25).addScaledVector(H.b, Math.sin(i * 3.1) * 0.03);
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.03 + gold * 0.02, tall, 4), m);
        s.position.set(p.x, this.h(p.x, p.z) + tall / 2, p.z); s.rotation.z = dry * 0.35 * Math.sin(i); g.add(s);
      }
    }
    this.group.add(g); this.sproutG = g;
  }
  private restoreSprouts() {
    if (this.s.level < 20 || !this.fieldRows.length) { this.sproutG?.removeFromParent(); this.sproutG = null; this.sproutKey = ''; return; }
    if (this.s.level >= 21) return; // level 21 sets its own (the harvest)
    this.sprouts(isDiscovered(this.s, 'irrigation') ? 0 : 0.8);
  }
  /** The ditch from the stream to the field (shown once dug), and the water in it. */
  private ditchG: THREE.Group | null = null;
  private ditchPath() {
    const at = this.fieldAt(), sp = this.world.streamPlan as unknown as { nearest?: (p: THREE.Vector3, out: THREE.Vector3) => number } | undefined;
    const st = v3(); this.waking().stream.nearest(at, st);
    if (st.lengthSq() === 0 || st.distanceTo(at) > 80) st.copy(at).add(v3(18, 0, 10));
    void sp;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) { const p = st.clone().lerp(at, i / 16); p.y = this.h(p.x, p.z); pts.push(p); }
    return pts;
  }
  private buildDitch(water: number) {
    this.ditchG?.removeFromParent(); this.ditchG = null;
    const pts = this.ditchPath(), g = new THREE.Group(), soil = std(0x3b2e22, { roughness: 1 }), wet = std(0x5a7a8a, { roughness: 0.1, metalness: 0.3 });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], d = b.clone().sub(a), len = d.length();
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, len + 0.05), soil);
      cut.position.copy(a).addScaledVector(d, 0.5).add(v3(0, 0.015, 0)); cut.rotation.y = Math.atan2(d.x, d.z); cut.receiveShadow = true; g.add(cut);
      if (i / (pts.length - 1) < water) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.01, len + 0.05), wet); w.position.copy(cut.position).add(v3(0, 0.03, 0)); w.rotation.y = cut.rotation.y; g.add(w); }
    }
    this.group.add(g); this.ditchG = g;
  }
  private ditchKey = '';
  private restoreDitch() {
    const st = this.s.level >= 20 && isDiscovered(this.s, 'irrigation') ? 1 : 0;
    const key = `${st}/${this.siteNow()}`;
    if (key === this.ditchKey || this.busy) return;
    this.ditchKey = key; if (st) this.buildDitch(1); else { this.ditchG?.removeFromParent(); this.ditchG = null; }
  }
  /** Set by game.ts: the waking controller (its stream knows where the moving water is). */
  waking: () => { stream: { nearest(p: THREE.Vector3, out: THREE.Vector3): number } } = () => ({ stream: { nearest: (_p, out) => { out.set(0, 0, 0); return 0; } } });

  private update20() {
    if (!this.f('e3.l20.intro')) { this.intro20(); return; }
    if (isDiscovered(this.s, 'irrigation') && !this.f('e3.kitDone')) { const a = this.snareAt(), p = this.player.pos; if (Math.hypot(p.x - a.x, p.z - a.z) < 5) this.kitScene(); }
  }
  /** Day 34: no rain for nine days, the sprouts yellowing. Water runs downhill. */
  private intro20() {
    const S = this.live();
    this.set('e3.l20.intro');
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 33, 33);
    this.passTime(11.5, true, 'e3.dry', () => {
      const z = this.z, at = this.fieldAt(), H = this.house();
      this.sprouts(0.8);
      const me = this.settle(at.clone().addScaledVector(H.a, -2.4).addScaledVector(H.b, 0.5), at, false);
      const beats: Beat[] = [
        { hold: 3.2, shot: () => ({ from: at.clone().addScaledVector(H.a, -6.5).addScaledVector(H.b, 3.0).add(v3(0, 2.4, 0)), to: at.clone().add(v3(0, 0.2, 0)), fov: 50, push: 0.03 }), run: () => z.setLookTarget(at) },
        { hold: 2.4, shot: () => { const p = this.fieldRows[0]?.position.clone() ?? at.clone(); return { from: p.clone().addScaledVector(H.b, 0.5).add(v3(0, 0.25, 0)), to: p.clone().add(v3(0, 0.06, 0)), fov: 28, push: 0.006, aperture: 0.004, lightAt: p.clone() }; } },
        { key: 'e3.ir.1', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
        { key: 'e3.ir.rise', who: 'scientist', if: { flag: 'e3.site.rise' }, shot: () => cover.close(z, -0.4, 1.0, 0.24) },
      ];
      this.scene(beats, () => { S.end(); this.clearHands(); void me; this.ui.toast(t('e3.obj.level')); });
    });
  }
  /** The A-frame: two poles and a crossbar, a stone on a cord from the apex; where the cord crosses the bar's mark the feet stand level. */
  private aFrame(at: THREE.Vector3, along: THREE.Vector3) {
    const g = new THREE.Group(), wood = std(0x7a5e44), cordM = std(0xc8b48a);
    const L = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) => { const d = b.clone().sub(a), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), m); c.position.copy(a).addScaledVector(d, 0.5); c.quaternion.setFromUnitVectors(UP, d.normalize()); c.castShadow = true; g.add(c); return c; };
    const f0 = at.clone().addScaledVector(along, -0.6), f1 = at.clone().addScaledVector(along, 0.6), top = at.clone().add(v3(0, 1.1, 0));
    f0.y = this.h(f0.x, f0.z); f1.y = this.h(f1.x, f1.z);
    L(f0, top, 0.02, wood); L(f1, top, 0.02, wood);
    const b0 = f0.clone().lerp(top, 0.45), b1 = f1.clone().lerp(top, 0.45); L(b0, b1, 0.015, wood);
    const mid = b0.clone().lerp(b1, 0.5);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.03), std(0x1a1410)); mark.position.copy(mid); g.add(mark);
    const cord = L(top, mid.clone().add(v3(0, -0.12, 0)), 0.002, cordM);
    const bob = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03, 0), std(0x6a645c)); bob.position.copy(mid).add(v3(0, -0.14, 0)); g.add(bob);
    this.group.add(g);
    return { g, top, mid, cord, bob };
  }
  /** The craft panel opens on him at the field's high corner with the A-frame, watching the cord against the mark. */
  private beforeIrrigation(open: () => void) {
    const S = this.live();
    const z = this.z, pts = this.ditchPath(), at = pts[Math.floor(pts.length * 0.6)].clone(), along = pts[pts.length - 1].clone().sub(pts[0]).setY(0).normalize();
    const side = this.side(along);
    this.settle(at.clone().addScaledVector(side, 0.7), at, false);
    const A = this.aFrame(at, along);
    const f = this.fwd(), r = this.right(f);
    z.setHold({ R: { at: A.top.clone().addScaledVector(side, 0.05).add(v3(0, -0.05, 0)), fingers: side.clone().negate(), palm: UP.clone().negate(), radius: 0.02, grasp: true } });
    this.scene([
      { hold: 2.6, shot: () => ({ from: at.clone().addScaledVector(side, 3.2).addScaledVector(along, -1.5).add(v3(0, 1.3, 0)), to: at.clone().add(v3(0, 0.7, 0)), fov: 40, push: 0.02 }), run: () => z.setLookTarget(A.mid) },
      // insert: the plumb cord swinging in to the mark on the bar
      { hold: 3.4, shot: () => ({ from: A.mid.clone().addScaledVector(side, 0.45).add(v3(0, 0.05, 0)), to: A.mid.clone().add(v3(0, -0.05, 0)), fov: 26, push: 0.006, aperture: 0.004, lightAt: A.mid.clone() }), run: () => {
        S.anim(3.4, (k) => { const sw = Math.sin(k * 4) * 0.05 * Math.max(0, 1 - k / 3); A.bob.position.copy(A.mid).add(v3(0, -0.14, 0)).addScaledVector(along, sw); A.cord.quaternion.setFromUnitVectors(UP, A.top.clone().sub(A.bob.position).normalize()); A.cord.position.copy(A.top).lerp(A.bob.position, 0.5); });
      } },
    ], () => { S.end(); A.g.removeFromParent(); this.clearHands(); void f; void r; open(); });
    return true;
  }
  /** The ditch dug; the water walks along it into the rows. */
  private waterScene(card: () => void) {
    const S = this.live();
    this.busy = true;
    const z = this.z, pts = this.ditchPath(), at = this.fieldAt(), H = this.house();
    const me = this.settle(pts[pts.length - 3].clone().addScaledVector(this.side(pts[pts.length - 1].clone().sub(pts[0]).setY(0).normalize()), 0.8), at, false);
    this.buildDitch(0);
    const low = pts[Math.floor(pts.length * 0.35)];
    this.scene([
      { hold: 5.0, shot: () => ({ from: low.clone().addScaledVector(pts[0].clone().sub(low).setY(0).normalize(), 0.5).add(v3(0, 0.35, 0)), to: pts[pts.length - 1].clone().add(v3(0, 0.1, 0)), fov: 35, push: 0.02 }), run: () => {
        audio.sample('splash', 0.25, { rate: 0.6 });
        S.anim(4.8, (k) => { const w = Math.min(1, k / 4.5); if (Math.floor(w * 16) !== Math.floor(Math.max(0, w - 0.02) * 16) || k < 0.05) this.buildDitch(w); });
      } },
      { key: 'e3.ir.ok', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { this.buildDitch(1); this.sprouts(0); z.setLookTarget(at); z.setFace({ smile: 0.3 }); } },
      { hold: 2.8, shot: () => ({ from: at.clone().addScaledVector(H.a, -5).addScaledVector(H.b, 3.5).add(v3(0, 2.6, 0)), to: at.clone(), fov: 48, push: 0.02 }) },
    ], () => {
      S.end(); this.clearHands(); void me;
      this.set('inv.irrigation'); this.ditchKey = '';
      if ((this.s.flags['e3.ir.steepN'] as unknown as number) >= 2 || this.f('e3.ir.steep2')) this.set('e3.field.scoured');
      this.ui.toast(t('e3.learn.irrigation'));
      this.busy = false;
      card();
      this.after(4, () => this.ui.toast(t('e3.obj.snare')));
    });
  }
  /** Day 40: the snare from the first days holds a young nibbet, alive, the mother gone. */
  private kitG: THREE.Group | null = null;
  /** The kit is a young nibbet: the combat's own nibbet body (combat/view/creatures.ts) at half size, posed by a still
   * stand-in of its simulation state; `caught` makes it pull at the snare. Its head is along +x of the returned group. */
  private kitBodies: { v: CreatureView; e: Record<string, unknown>; g: THREE.Group }[] = [];
  private kit(at: THREE.Vector3, caught = false) {
    const g = new THREE.Group(), v = createCreature('nibbet');
    v.root.scale.setScalar(0.5); g.add(v.root);
    const e: Record<string, unknown> = { id: -7, x: 0, y: 0, z: 0, yaw: Math.PI / 2, dead: false, deadT: 0, state: 'idle', speed: 0, stunT: 0, aware: true, heldT: caught ? 9 : 0, def: { height: 0.54, radius: 0.34 } };
    v.update(e as unknown as Enemy, 0, 1 / 60, 0);
    g.position.copy(at);
    this.group.add(g);
    this.kitBodies.push({ v, e, g });
    return g;
  }
  /** The kit stops pulling (it is out of the snare). */
  private kitFree(g: THREE.Group, run = 0) { const k = this.kitBodies.find((x) => x.g === g); if (k) { k.e.heldT = 0; k.e.speed = run; k.e.state = run ? 'flee' : 'idle'; } }
  private tickKits(dt: number) {
    this.kitBodies = this.kitBodies.filter((k) => !!k.g.parent);
    const t = performance.now() / 1000;
    for (const k of this.kitBodies) k.v.update(k.e as unknown as Enemy, t, dt, 0);
  }
  private kitScene() {
    const S = this.live();
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 39, 39);
    const z = this.z, at = this.snareAt();
    const kit = this.kit(at.clone().add(v3(0.5, 0, 0)), true);
    const me = this.settle(at.clone().add(v3(-0.4, 0, 0.6)), kit.position, true);
    const k0 = kit.position.clone();
    this.scene([
      { hold: 2.6, shot: () => ({ from: k0.clone().add(v3(0.55, 0.18, 0.35)), to: k0.clone().add(v3(0, 0.1, 0)), fov: 28, push: 0.008, aperture: 0.004, lightAt: k0.clone() }), run: () => {
        z.setLookTarget(k0); audio.sample('leather', 0.15, { rate: 2.2 });
        S.anim(2.6, (k) => { kit.rotation.y = Math.sin(k * 9) * 0.25; kit.position.copy(k0).add(v3(0, Math.abs(Math.sin(k * 7)) * 0.02, 0)); });
      } },
      { key: 'e3.kt.1', who: 'scientist', shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => z.setLookTarget(k0) },
      { key: 'e3.kt.fed', who: 'scientist', if: { flag: 'cub.fed' }, shot: () => cover.close(z, -0.4, 1.0, 0.24) },
      { key: 'e3.kt.killed', who: 'scientist', if: { flag: 'cub.killed' }, shot: () => cover.close(z, -0.4, 1.0, 0.24) },
      { hold: 1.2, shot: () => cover.close(z, 0.45, 1.1, 0.24) },
      { choice: 'e3.kit', shot: () => cover.close(z, 0.45, 1.1, 0.24) },
      { key: 'e3.kt.keep', who: 'scientist', if: CHOSE('e3.kit', 'kept'), shot: () => cover.mid(z, 0.5, 1.8), run: () => { this.kitFree(kit); z.setHold({ R: { at: k0.clone().add(v3(0, 0.12, 0)), fingers: UP.clone().negate(), palm: UP.clone().negate(), radius: 0.03 } }); z.setFace({ smile: 0.3 }); } },
      { key: 'e3.kt.free', who: 'scientist', if: CHOSE('e3.kit', 'free'), shot: () => cover.mid(z, 0.5, 1.8), run: () => { this.kitFree(kit, 2.4); kit.rotation.y = Math.atan2(0.6, 1.6); S.anim(2.5, (k) => { kit.position.copy(k0).add(v3(k * 1.6, 0, -k * 0.6)); kit.position.y = this.h(kit.position.x, kit.position.z); }); } },
      { key: 'e3.kt.eat', who: 'scientist', if: CHOSE('e3.kit', 'eaten'), shot: () => cover.close(z, -0.4, 1.0, 0.24), run: () => { z.setFace({ frown: 0.5 }); } },
    ], () => {
      S.end(); this.clearHands(); void me;
      kit.removeFromParent();
      this.set('e3.kitDone');
      if (this.f('e3.kit.eaten')) this.s.stats.hunger = Math.min(100, this.s.stats.hunger + 40);
      this.kitKey = '';
    });
  }
  /** The kept kit lives at the house: it sits by the door and turns its head to him. */
  private kitKey = '';
  private restoreKit() {
    const want = this.s.level >= 20 && this.f('e3.kit.kept') && this.f('e3.kitDone');
    const key = want ? this.siteNow() : '';
    if (key !== this.kitKey && !this.busy) {
      this.kitKey = key; this.kitG?.removeFromParent(); this.kitG = null;
      if (want) { const H = this.house(), p = H.at.clone().addScaledVector(H.a, -2.2).addScaledVector(H.b, 0.6); p.y = this.h(p.x, p.z); this.kitG = this.kit(p); }
    }
    if (this.kitG) { const p = this.player.pos; this.kitG.rotation.y = -Math.atan2(p.z - this.kitG.position.z, p.x - this.kitG.position.x); }
  }

  // ------------------------------------------------------------------ level 21: first frost (3.12 to 3.17)
  /** How much the field gives: all of it sown and watered is the most; the scoured ditch takes a third. */
  private harvestShare() { let k = this.f('e3.field.all') ? 1 : 0.6; if (this.f('e3.field.scoured')) k *= 0.66; return k; }
  private update21() {
    if (!this.f('e3.l21.intro')) { this.harvestScene(); return; }
    if (this.f('e3.harvest') && isDiscovered(this.s, 'salt') && !this.f('e3.stored')) { this.storeScene(); return; }
    if (this.f('e3.stored') && !this.f('e3.stormDone')) { this.storm(); return; }
    if (this.f('e3.stormDone') && !this.f('e3.pelloDone')) { this.pelloScene(); return; }
    if (this.f('e3.pelloDone') && !this.f('e3.named')) { this.nameScene(); return; }
    if (this.f('e3.named') && !this.f('e3.ledger')) { this.ledgerScene(); return; }
  }
  /** Day 72: the field gold; a flint sickle; threshing on a flat stone; winnowing in the wind, the chaff blowing off like smoke. */
  private harvestScene() {
    const S = this.live();
    this.set('e3.l21.intro');
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 71, 71);
    this.passTime(10.5, true, 'e3.day', () => {
      const z = this.z, at = this.fieldAt(), H = this.house(), share = this.harvestShare();
      this.sprouts(0, 1);
      const me = this.settle(at.clone().addScaledVector(H.a, 1.6).addScaledVector(H.b, ((this.fieldRows.length - 1) / 2) * 0.55 + 0.4), at, true); // (on his knees in the row: standing, the sickle insert was his coat and legs)
      const f = this.fwd(), r = this.right(f);
      // the sickle: a curved wooden haft with flint blades set in resin along its inside edge
      const sickle = new THREE.Group();
      const haft = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 5, 14, Math.PI * 0.9), std(0x7a5e44)); sickle.add(haft);
      for (let i = 0; i < 5; i++) { const a = 0.25 + i * 0.5, b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.004, 0.018), std(0x8a8a90, { roughness: 0.3 })); b.position.set(Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0); b.rotation.z = a + Math.PI / 2; sickle.add(b); }
      this.group.add(sickle);
      const cutAt = me.clone().addScaledVector(f, 0.45).addScaledVector(r, 0.1).add(v3(0, 0.34, 0));
      const swing = (k: number) => { const u = Math.sin(k * 3.4); const p = cutAt.clone().addScaledVector(r, u * 0.18); sickle.position.copy(p); sickle.lookAt(p.clone().add(f)); sickle.rotateZ(u * 0.6);
        z.setHold({ R: { at: p.clone().add(v3(0, 0.05, 0)), fingers: f.clone(), palm: r.clone().negate(), radius: 0.02, grasp: true }, L: { at: cutAt.clone().addScaledVector(r, -0.12).add(v3(0, 0.12, 0)), fingers: f.clone(), palm: r.clone(), radius: 0.03, grasp: true } }); };
      swing(0);
      // the threshing stone and the winnowing tray, beside the field
      const thresh = me.clone().addScaledVector(r, -1.6); thresh.y = this.h(thresh.x, thresh.z);
      const chaff: THREE.Mesh[] = [];
      const band = this.f('e3.field.band') && this.trust() >= 1 && !this.f('e2.oomsa.away');
      // (the band comes to the harvest whenever they trust him; with e3.field.band it is their grain too)
      this.bandHarvest = this.trust() >= 1 && !this.f('e2.oomsa.away');
      const F = band ? this.buildFolk() : null;
      if (F) this.placeFolk('hohma', at.clone().addScaledVector(H.b, -((this.fieldRows.length - 1) / 2) * 0.55 - 1.6), at, false);
      const beats: Beat[] = [
        { hold: 3.4, shot: () => ({ from: at.clone().addScaledVector(H.a, -6.0).addScaledVector(H.b, 4.0).add(v3(0, 2.0, 0)), to: at.clone().add(v3(0, 0.5, 0)), fov: 50, push: 0.03 }), run: () => { z.setLookTarget(at); S.anim(3.4, (k) => swing(k)); } },
        { hold: 2.8, shot: () => ({ from: cutAt.clone().addScaledVector(r, 0.55).addScaledVector(f, 0.25).add(v3(0, 0.05, 0)), to: cutAt.clone(), fov: 30, push: 0.008, aperture: 0.004, lightAt: cutAt.clone() }), run: () => { S.anim(2.8, (k) => swing(k + 1)); audio.sample('leather', 0.25, { rate: 1.4 }); } },
        { hold: 3.6, shot: () => ({ from: thresh.clone().addScaledVector(f, -1.9).addScaledVector(r, -0.7).add(v3(0, 1.5, 0)), to: thresh.clone().add(v3(0, 1.05, 0)), fov: 40, push: 0.02, lightAt: thresh.clone().add(v3(0, 1, 0)) }), run: () => {
          sickle.visible = false;
          this.settle(thresh, thresh.clone().addScaledVector(f, 1), false);
          const ff = this.fwd(), rr = this.right(ff), tray = thresh.clone().addScaledVector(ff, 0.3).add(v3(0, 1.0, 0));
          const tr = this.mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.04, 14, 1, true), std(0x7a5a3a, { side: THREE.DoubleSide }), tray.clone()); chaff.push(tr);
          for (let i = 0; i < 40; i++) { const m = this.mesh(new THREE.PlaneGeometry(0.012, 0.006), new THREE.MeshBasicMaterial({ color: 0xe0d0a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), tray.clone()); m.castShadow = false; chaff.push(m); }
          S.anim(3.6, (k) => {
            const lift = Math.abs(Math.sin(k * 3)) * 0.12; tr.position.copy(tray).add(v3(0, lift, 0));
            z.setHold({ L: { at: tr.position.clone().addScaledVector(rr, -0.19), fingers: ff.clone(), palm: UP.clone(), radius: 0.03, grasp: true }, R: { at: tr.position.clone().addScaledVector(rr, 0.19), fingers: ff.clone(), palm: UP.clone(), radius: 0.03, grasp: true } });
            chaff.slice(1).forEach((m, i) => { const u = ((k * 0.6 + i / 40) % 1); m.position.copy(tray).add(v3(u * 1.4 + Math.sin(i) * 0.05, 0.1 + u * 0.6 + Math.sin(k * 5 + i) * 0.03, Math.cos(i * 1.7) * 0.1 + u * 0.3)); m.rotation.set(k * 3 + i, i, k); (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u); });
          });
        } },
        { key: 'e3.hv.1', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
      ];
      if (F) beats.push({ key: 'e3.hm.reap', who: 'hohma' as Who, shot: () => this.oomClose(F.hohma, 0.4, 1.0), run: () => F.hohma.setLookTarget(this.head()) });
      this.scene(beats, () => {
        S.end(); sickle.removeFromParent(); chaff.forEach((m) => m.removeFromParent()); this.clearHands(); this.homeFolk(); this.bandHarvest = false;
        this.s.inventory.grain = (this.s.inventory.grain ?? 0) + Math.round(12 * share);
        this.set('e3.harvest');
        this.ui.toast(t('e3.obj.salt'));
      });
    });
  }
  /** The craft panel opens on the brine in his pot over the hearth, going down to a crust. */
  private beforeSalt(open: () => void) {
    const S = this.live();
    const z = this.z, H = this.house(), c = H.at.clone();
    this.settle(c.clone().addScaledVector(H.b, 0.85), c, true, true);
    const potAt = c.clone().lerp(this.z.root.position, 0.4); potAt.y = this.h(potAt.x, potAt.z) + 0.1;
    const embers = this.mesh(new THREE.CircleGeometry(0.24, 12), new THREE.MeshBasicMaterial({ color: 0xff7a2a }), c.clone().setY(this.h(c.x, c.z) + 0.04)); embers.rotation.x = -Math.PI / 2; embers.castShadow = false;
    const pot = this.mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.16, 14, 1, true), std(0x8a5a3a, { roughness: 0.85, side: THREE.DoubleSide }), potAt.clone());
    const brine = this.mesh(new THREE.CircleGeometry(0.095, 14), std(0x9aa49a, { roughness: 0.15, metalness: 0.2 }), potAt.clone().add(v3(0, 0.05, 0))); brine.rotation.x = -Math.PI / 2;
    this.scene([
      { hold: 3.4, shot: () => ({ from: potAt.clone().add(v3(0.25, 0.42, 0.25)), to: potAt.clone().add(v3(0, 0.04, 0)), fov: 26, push: 0.006, aperture: 0.004, lightAt: potAt.clone() }), run: () => {
        z.setLookTarget(potAt); audio.sample('fire', 0.3, { dur: 3.4 });
        S.anim(3.4, (k) => { const u = Math.min(1, k / 3.2); brine.position.y = potAt.y + 0.05 - u * 0.05; (brine.material as THREE.MeshStandardMaterial).color.setHex(u > 0.7 ? 0xe8e4dc : 0x9aa49a); });
      } },
    ], () => { S.end(); for (const m of [pot, brine, embers]) m.removeFromParent(); this.clearHands(); open(); });
    return true;
  }
  /** Day 74 to 76: meat drying and smoking on a rack, a store pit in the floor sealed with clay, a notch for each pot; tracks at dawn. */
  private storeScene() {
    const S = this.live();
    this.busy = true;
    const z = this.z, H = this.house(), c = H.at.clone();
    const rackAt = H.at.clone().addScaledVector(H.a, -3.4).addScaledVector(H.b, 1.6); rackAt.y = this.h(rackAt.x, rackAt.z);
    const g = new THREE.Group(), wood = std(0x6a5440), meat = std(0x7a2a22, { roughness: 0.7 });
    for (const [u, w] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.1, 5), wood); p.position.copy(rackAt).addScaledVector(H.a, u).addScaledVector(H.b, w).add(v3(0, 0.55, 0)); g.add(p); }
    for (const w of [-0.3, 0.3]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 5), wood); b.position.copy(rackAt).addScaledVector(H.b, w).add(v3(0, 1.05, 0)); b.quaternion.setFromUnitVectors(UP, H.a); g.add(b); }
    for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.01), meat); s.position.copy(rackAt).addScaledVector(H.a, -0.4 + i * 0.13).add(v3(0, 0.88, 0)); s.rotation.y = Math.atan2(H.b.x, H.b.z); g.add(s); }
    const smoke: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xb8b8b0, transparent: true, opacity: 0.2, depthWrite: false })); g.add(m); smoke.push(m); }
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), new THREE.MeshBasicMaterial({ color: 0xc84a1a })); coals.rotation.x = -Math.PI / 2; coals.position.copy(rackAt).add(v3(0, 0.03, 0)); g.add(coals);
    this.group.add(g);
    // the store: a pit in the house floor lined with bark, the pots in it, a clay lid; the tally stick by the door
    const pit = c.clone().addScaledVector(H.a, 0.9).addScaledVector(H.b, -0.7); pit.y = this.h(pit.x, pit.z);
    const lid = this.mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.05, 16), std(0x8a6a4a, { roughness: 1 }), pit.clone().add(v3(0, 0.03, 0)));
    const me = this.settle(pit.clone().addScaledVector(H.b, 0.75), pit, true, true);
    const f = this.fwd(), r = this.right(f);
    const stick = this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), std(0xb89a6a), me.clone().addScaledVector(f, 0.3).add(v3(0, 0.45, 0)));
    stick.quaternion.setFromUnitVectors(UP, r.clone());
    const notches: THREE.Mesh[] = [];
    const pots = Math.max(1, Math.min(6, this.inv('pot') || 2));
    const beats: Beat[] = [
      { hold: 3.4, shot: () => ({ from: rackAt.clone().addScaledVector(H.b, 3.0).addScaledVector(H.a, -1.2).add(v3(0, 1.1, 0)), to: rackAt.clone().add(v3(0, 0.85, 0)), fov: 40, push: 0.02, lightAt: rackAt.clone().add(v3(0, 0.9, 0)) }), run: () => {
        S.anim(3.4, (k) => smoke.forEach((m, i) => { const u = ((k * 0.35 + i / 8) % 1); m.position.copy(rackAt).add(v3(Math.sin(i * 2 + k) * 0.15, 0.2 + u * 1.6, Math.cos(i * 3) * 0.15)); m.scale.setScalar(0.6 + u * 2); (m.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - u); }));
      } },
      { hold: 2.6, shot: () => ({ from: pit.clone().addScaledVector(f, -0.2).add(v3(0, 0.9, 0)).addScaledVector(r, 0.5), to: pit.clone(), fov: 34, push: 0.01 }), run: () => { z.setLookTarget(pit); z.setHold({ L: { at: pit.clone().addScaledVector(r, -0.2).add(v3(0, 0.06, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 }, R: { at: pit.clone().addScaledVector(r, 0.2).add(v3(0, 0.06, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.03 } }); } },
      { hold: 6.0, shot: () => cover.mid(z, 0.5, 1.9), run: () => { this.clearHands(); this.settle(me, pit, true, true); this.ui.memory('e3.ct.nuvexa', 7); } },
      // insert: a notch for each pot filled
      { hold: 3.4, shot: () => ({ from: stick.position.clone().addScaledVector(f, -0.25).add(v3(0, 0.12, 0)), to: stick.position.clone(), fov: 24, push: 0.004, aperture: 0.004, lightAt: stick.position.clone() }), run: () => {
        z.setLookTarget(stick.position);
        z.setHold({ L: { at: stick.position.clone().addScaledVector(r, -0.12), fingers: r.clone(), palm: UP.clone(), radius: 0.015, grasp: true }, R: { at: stick.position.clone().add(v3(0, 0.03, 0)), fingers: f.clone(), palm: UP.clone().negate(), radius: 0.015, grasp: true } });
        for (let i = 0; i < pots; i++) S.after(0.4 + i * (2.6 / pots), () => { const n = this.mesh(new THREE.BoxGeometry(0.004, 0.026, 0.026), std(0x3a2a1a), stick.position.clone().addScaledVector(r, -0.1 + i * 0.035)); n.quaternion.copy(stick.quaternion); notches.push(n); audio.sample('wood', 0.25, { rate: 2 }); });
      } },
      { key: 'e3.tl.1', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => { z.setHold(null); z.setLookTarget(this.ahead()); } },
    ];
    if (this.f('scarred') || this.f('e2.cb.kiln.scattered') || this.f('cb.night.held')) {
      beats.push(
        { hold: 3.0, shot: () => ({ from: lid.position.clone().add(v3(0.3, 0.5, 0.2)), to: lid.position.clone(), fov: 26, push: 0.006, aperture: 0.004, lightAt: lid.position.clone() }), run: () => {
          this.s.timeOfDay = 6.8;
          for (let i = 0; i < 4; i++) { const m = this.mesh(new THREE.BoxGeometry(0.16, 0.006, 0.008), std(0x2a1a10), lid.position.clone().add(v3(-0.06 + i * 0.03, 0.03, 0))); m.rotation.y = 0.5; notches.push(m); }
        } },
        { key: 'e3.tr.1', who: 'scientist', shot: () => cover.close(z, -0.4, 1.0, 0.24), run: () => z.setFace({ squint: 0.3 }) },
      );
    }
    this.scene(beats, () => {
      S.end(); g.removeFromParent(); stick.removeFromParent(); lid.removeFromParent(); notches.forEach((m) => m.removeFromParent()); this.clearHands();
      this.set('e3.stored'); this.set('inv.storage'); this.set('inv.tally'); this.set('inv.salt');
      this.ui.toast(t('e3.learn.store'));
    });
  }
  /** Day 78: the first winter storm comes off the lake. The house holds or does not; then the fight for the store. */
  private storm() {
    const S = this.live();
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 77, 77);
    this.passTime(21.2, true, 'e3.day', () => {
      const z = this.z, H = this.house(), c = H.at.clone();
      this.rain(1);
      const band = this.trust() >= 1 && !this.f('e2.oomsa.away');
      const F = this.buildFolk();
      const me = this.settle(c.clone().addScaledVector(H.a, -0.7), c, true, true);
      if (band) { this.placeFolk('hohma', c.clone().addScaledVector(H.b, -0.8), c, true); this.placeFolk('wenka', c.clone().addScaledVector(H.b, 0.8).addScaledVector(H.a, 0.3), c, true); }
      const door = this.doorSide(), flooded = this.campSite() && !this.f('e3.ditch');
      const beats: Beat[] = [
        { hold: 3.4, shot: () => ({ from: c.clone().addScaledVector(H.a, -8).addScaledVector(H.b, 5).add(v3(0, 2.4, 0)), to: c.clone().add(v3(0, 1.4, 0)), fov: 50, push: 0.02 }), run: () => { audio.sample('amb_rain', 0.6, { dur: 14 }); audio.sample('wind', 0.4, { dur: 10 }); } },
        { hold: 3.0, shot: () => ({ from: c.clone().addScaledVector(H.a, 1.2).addScaledVector(H.b, 0.9).add(v3(0, 1.4, 0)), to: c.clone().add(v3(0, 0.6, 0)).addScaledVector(H.a, -0.4), fov: 55, push: 0.01, lightAt: c.clone().add(v3(0, 0.6, 0)), lightScale: 0.8 }), run: () => z.setLookTarget(c) },
        { key: door === 'a-' ? 'e3.sm.lee' : door === 'a+' ? 'e3.sm.view' : 'e3.sm.band', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24) },
        { key: 'e3.sm.flood', who: 'scientist', if: flooded ? undefined : { flag: '__never' }, shot: () => cover.close(z, -0.4, 1.0, 0.24) },
        { key: 'e3.sm.kit', who: 'scientist', if: { flag: 'e3.kit.kept' }, shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => audio.tone(1800, 0.3, 'square', 0.05) },
      ];
      if (band) beats.push({ key: 'e3.st.1', who: 'scientist', shot: () => ({ from: c.clone().addScaledVector(H.a, 1.6).add(v3(0, 1.5, 0)), to: c.clone().add(v3(0, 0.5, 0)), fov: 58, push: 0.01, lightAt: c.clone().add(v3(0, 0.6, 0)), lightScale: 0.8 }), run: () => { F.hohma.setLookTarget(this.head()); F.wenka.setLookTarget(this.head()); } });
      this.scene(beats, async () => {
        S.end(); this.clearHands(); void me;
        // the door in the wind: held (band), braced with a quick press (view), nothing to do (lee)
        if (door === 'b+' || door === 'b-') { const r = await this.tension({ kind: 'steady', seconds: 5, strain: 1.2 }); this.set(r && !r.passed ? 'e3.door.blew' : 'e3.door.held'); }
        else if (door === 'a+') { const r = await this.tension({ kind: 'quick', count: 3 }); this.set(r && !r.passed ? 'e3.door.blew' : 'e3.door.braced'); }
        if (flooded) this.set('e3.floorFlooded');
        const cb = this.combat();
        if (cb) {
          await new Promise<void>((go) => cb.ensureAsked(go));
          const o = await cb.startEncounter('night.defence', { story: { store: true, oomsa: band, fireHigh: true }, hour: 22.5 });
          for (const [k, v] of Object.entries(o.flags)) if (v) this.s.flags[`e3.cb.${k}`] = true;
        }
        this.rain(0.3, 30);
        this.set('e3.stormDone');
        this.busy = false; this.wait = 1.5;
      });
    });
  }
  /** Day 79, grey dawn: a man at the edge of the clearing with a ticket. */
  private pello: Character | null = null;
  private pelloScene() {
    const S = this.live();
    this.busy = true;
    this.passTime(6.4, true, null, () => {
      const z = this.z, H = this.house(), c = H.at.clone();
      const me = this.settle(c.clone().addScaledVector(H.a, -2.4), c.clone().addScaledVector(H.a, -8), false);
      const f = this.fwd();
      const at = me.clone().addScaledVector(f, 9).addScaledVector(this.right(f), 1.5); at.y = this.h(at.x, at.z);
      if (!this.pello) {
        const look: PlayerLook = { ...defaultLook(), lineage: 'korrath', ...LINEAGES.korrath, skin: 0xb88a6a, ears: 'round', horns: false, marks: 'dots', glow: 0x000000, iris: 0x5a4030, hair: 'strong', hairRoot: 0x3a2a1a, hairTip: 0x6a5a4a, beard: 'long', outfit: 'explorer', accent: 0x5a5a4a, gender: 'm', eye: 'tired', eyeGlow: false, height: 1.02, build: 0.1 };
        // (human, EPISODE_THREE_SCRIPT 3.15: no horns, no glow; a beard to his chest, from the character builder's beard)
        this.pello = createCharacter('explorer', this.world.q.name === 'mobile' ? 0.6 : 1, look);
        this.pello.setGround((x, zz) => this.h(x, zz)); this.world.scene.add(this.pello.root);
        this.actors['pello'] = this.pello;
      }
      const P = this.pello; P.root.visible = true; P.root.position.copy(at); P.root.rotation.y = Math.atan2(me.x - at.x, me.z - at.z); P.root.updateMatrixWorld();
      const card = this.mesh(new THREE.BoxGeometry(0.085, 0.002, 0.054), std(0xe8e2d0, { roughness: 0.3 }), at.clone().add(v3(0, 1.05, 0)).addScaledVector(me.clone().sub(at).setY(0).normalize(), 0.28));
      P.setHold({ R: { at: card.position.clone(), fingers: me.clone().sub(at).setY(0).normalize(), palm: UP.clone(), radius: 0.02 } });
      P.setLookTarget(card.position);
      const band = this.trust() >= 1 && !this.f('e2.oomsa.away');
      const oom = band ? this.oom() : null;
      if (oom) { const o = me.clone().addScaledVector(this.right(f), 1.4).addScaledVector(f, -0.3); o.y = this.h(o.x, o.z); this.actors['local'] = oom; this.npcs.pin('local', o, Math.atan2(at.x - o.x, at.z - o.z)); oom.setLookTarget(at.clone().add(v3(0, 1.5, 0))); }
      this.s.timeOfDay = 6.5;
      this.scene([
        { hold: 3.6, shot: () => ({ from: me.clone().add(v3(0, 1.5, 0)).addScaledVector(f, -1.0).addScaledVector(this.right(f), 0.5), to: at.clone().add(v3(0, 1.2, 0)), fov: 22, push: 0.01 }), run: () => z.setLookTarget(at.clone().add(v3(0, 1.6, 0))) },
        { key: 'e3.pl.1', who: 'pello' as Who, shot: () => cover.close(P, 0.35, 1.05, 0), run: () => P.setLookTarget(this.head()) },
        { key: 'e3.pl.2', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24) },
        { key: 'e3.pl.3', who: 'pello' as Who, shot: () => cover.close(P, -0.35, 1.05, 0), run: () => P.setLookTarget(card.position) },
        { hold: 2.4, shot: () => ({ from: card.position.clone().add(v3(0.1, 0.18, 0.12)), to: card.position.clone(), fov: 24, push: 0.004, aperture: 0.003, lightAt: card.position.clone() }) },
        { key: 'e3.pl.oom', who: 'local' as Who, if: band ? undefined : { flag: '__never' }, shot: () => oom ? this.oomClose(oom, 0.4, 1.0) : cover.close(z, 0.4, 1.0, 0.24) },
        { hold: 1.0, shot: () => cover.close(z, 0.45, 1.1, 0.24) },
        { choice: 'e3.pello', shot: () => cover.close(z, 0.45, 1.1, 0.24) },
        { key: 'e3.pl.ask', who: 'pello' as Who, if: CHOSE('e3.pello', 'ask'), shot: () => cover.close(P, 0.35, 1.05, 0), run: () => P.setLookTarget(this.head()) },
        { key: 'e3.pl.in', who: 'scientist', if: CHOSE('e3.pello', 'in'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
        { key: 'e3.pl.out', who: 'scientist', if: CHOSE('e3.pello', 'out'), shot: () => cover.close(z, 0.4, 1.0, 0.24) },
        { hold: 2.6, shot: () => ({ from: me.clone().add(v3(0, 1.6, 0)).addScaledVector(f, -2.5), to: at.clone().add(v3(0, 1.0, 0)), fov: 35, push: 0.01 }), run: () => {
          P.setHold(null); card.removeFromParent();
          const away = this.f('e3.pello.in') ? c.clone() : at.clone().addScaledVector(this.right(f), 12);
          const a0 = at.clone(); S.anim(2.6, (k) => { const p = a0.clone().lerp(away, Math.min(1, k / 6)); p.y = this.h(p.x, p.z); P.root.position.copy(p); P.root.rotation.y = Math.atan2(away.x - a0.x, away.z - a0.z); P.animate('walk', k * 1.6, 1, performance.now() / 1000, 1 / 60); });
        } },
        { key: 'e3.pl.end', who: 'scientist', shot: () => cover.close(z, 0.45, 1.0, 0.24), run: () => z.setLookTarget(this.ahead()) },
      ], () => {
        S.end(); this.clearHands(); card.removeFromParent();
        if (this.pello) this.pello.root.visible = this.f('e3.pello.in');
        if (this.pello && this.f('e3.pello.in')) { const p = c.clone().addScaledVector(H.b, 0.7); p.y = this.h(p.x, p.z); this.pello.root.position.copy(p); this.pello.setKneel(true, true); }
        if (oom) this.npcs.pin('local', null, 0, this.L.camp.clone().add(v3(9, 0, 7)).setY(this.h(this.L.camp.x + 9, this.L.camp.z + 7)));
        this.set('e3.pelloDone');
      });
    });
  }
  /** Day 80: frost, smoke from the roof, the band's shelters round his house (with trust): the place gets a name. */
  private nameScene() {
    const S = this.live();
    this.busy = true;
    this.s.day = Math.max(this.s.day ?? 79, 79);
    this.passTime(8.6, true, 'e3.day', () => {
      const z = this.z, H = this.house(), c = H.at.clone();
      const me = this.settle(c.clone().addScaledVector(H.a, -3.0), c, false);
      this.scene([
        { hold: 4.0, shot: () => ({ from: c.clone().addScaledVector(H.a, -14).addScaledVector(H.b, 6).add(v3(0, 6, 0)), to: c.clone().add(v3(0, 1.4, 0)), fov: 50, push: 0.03 }), run: () => z.setLookTarget(c.clone().add(v3(0, 2.6, 0))) },
        { hold: 1.2, shot: () => cover.close(z, 0.45, 1.1, 0.24) },
        { choice: 'e3.name', shot: () => cover.close(z, 0.45, 1.1, 0.24) },
        { key: 'e3.nm.1', who: 'scientist', shot: () => cover.close(z, 0.4, 1.0, 0.24), run: () => { z.setFace({ smile: 0.25 }); z.setLookTarget(this.ahead()); } },
      ], () => {
        S.end(); this.clearHands(); void me;
        const go = () => {
          const name = ['six', 'clay', 'dayone', 'hatum'].find((k) => this.f(`e3.name.${k}`)) ?? 'camp';
          this.s.flags['e3.village'] = name as unknown as boolean;
          this.set('e3.named');
        };
        // the scene can be skipped past its choice (CI's second episode3_smoke run ended it with nothing chosen): the
        // village's name is asked for again before the episode moves on
        if (!this.s.branch.log.some((e) => e.id === 'e3.name') && this.askFn) this.askFn('e3.name', go); else go();
      });
    });
  }
  /** 3.17: MegaZroN reads Episode Three's page. */
  private ledgerScene() {
    // MegaZroN's page over the village itself, not over black (GPU take EP3B A: two minutes of a black screen): a slow crane
    // up from the house over the field and the reed camp, his lines as subtitles
    const dose = this.f('e3.dose.self') ? 'e3.mz.self' : this.f('e3.dose.half') ? 'e3.mz.half' : 'e3.mz.boy';
    const H = this.house(), c = H.at.clone(), fld = this.fieldAt(), fenn = this.fennAt();
    const mid = c.clone().lerp(fld, 0.5);
    const crane = (k: number) => ({ from: mid.clone().addScaledVector(H.a, -9 - k * 3).addScaledVector(H.b, 6 + k * 2).add(v3(0, 4 + k * 3, 0)), to: mid.clone().lerp(fenn, 0.15 + k * 0.1).add(v3(0, 0.6, 0)), fov: 48, push: 0.02 });
    this.ui.banner(t('e3.end'), t('e3.next'));
    this.scene([
      { key: 'e3.mz.1', who: 'megazron' as Who, shot: () => crane(0) },
      { key: dose, who: 'megazron' as Who, shot: () => crane(0.4) },
      { key: 'e3.mz.wall', who: 'megazron' as Who, shot: () => crane(0.8) },
      { key: 'e3.mz.pello', who: 'megazron' as Who, shot: () => crane(1.2) },
      { key: 'e3.mz.4', who: 'megazron' as Who, shot: () => crane(1.6) },
    ], () => { this.set('e3.ledger'); this.set('ch2.e3.done'); });
  }
}

/** Episode Three's choices that test a flag; kept so the sealed data and the code agree on names (story_check reads it). */
export const E3_FLAGS = ['e3.site.rise', 'e3.site.reeds', 'e3.site.camp', 'e3.door.lee', 'e3.door.band', 'e3.door.view', 'e3.field.all', 'e3.field.half', 'e3.field.band', 'e3.dose.boy', 'e3.dose.self', 'e3.dose.half', 'e3.wall.hold', 'e3.wall.climb', 'e3.wall.mock', 'e3.kit.kept', 'e3.kit.free', 'e3.kit.eaten', 'e3.pello.in', 'e3.pello.ask', 'e3.pello.out', 'e3.pello.wait', 'e3.name.six', 'e3.name.clay', 'e3.name.dayone', 'e3.name.hatum', 'e3.name.camp'];
void test;
