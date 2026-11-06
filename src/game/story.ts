import * as THREE from 'three';
import { t } from '../i18n';
import { clamp, smoothstep } from '../core/noise';
import { audio } from '../core/audio';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { Player } from './player';
import type { CrewPose } from '../characters/character';
import type { UI } from '../ui/ui';
import { cover, Beat } from '../cinematic/cutscene';
import { voice } from '../core/voice';
import { Npcs } from './npcs';
import { Chapter2 } from './chapter2';
import { CH2_FIRST } from './tech/data';
import type { TechNode } from './tech/data';
import type { DlgTree } from './dialogue';

/** A contextual "press E" station in the world (build, craft, talk...). */
export interface Action {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  label: string;
  /** Missing materials; if non-empty the action explains instead of running. */
  missing?: string[];
  run(): void;
}

type Req = Record<string, number>;
type HoundState = 'hidden' | 'approach' | 'circle' | 'windup' | 'lunge' | 'recoil' | 'flee';

export const LAST_LEVEL = 10;
const DAWN = 6.0;
const DUSK = 19.4;
const isNight = (h: number) => h >= DUSK || h < 5.5;

/**
 * Levels 4-10 of "The First 24 Hours": fire, shelter, spear, the first night,
 * the crew signal, the rescue of the Explorer and the beacon. All progress
 * lives in SaveData (flags + inventory) so it survives reloads.
 */
export class Story {
  npcs: Npcs;
  ch2: Chapter2;
  /** Set by the game: open the crafting and dialogue panels. */
  hooks: { craft: (n: TechNode) => void; talk: (t: DlgTree) => void; free: () => boolean } = { craft: () => {}, talk: () => {}, free: () => true };
  private strikes = 0;
  private thrustT = 0;
  private spear: THREE.Group;
  private hound = { state: 'hidden' as HoundState, pos: new THREE.Vector3(), yaw: 0, timer: 0, angle: 0, braced: false, target: new THREE.Vector3(), speed: 0, lastMiss: 0 };
  private crew = { pos: new THREE.Vector3(), yaw: 0, phase: 0, speed: 0, mode: 'hidden' as 'hidden' | 'injured' | 'idle' | 'follow' | 'camp', wave: 0 };
  private signalClock = 0;
  private sequence = false;
  private tmp = new THREE.Vector3();

  constructor(
    private world: World,
    private player: Player,
    private ui: UI,
    private getSave: () => SaveData,
    private after: (sec: number, fn: () => void) => void,
    private hurt: (amount: number) => void,
    private playScene: (beats: Beat[], then?: () => void) => void,
  ) {
    this.npcs = new Npcs(world, player, ui, getSave, after, (tree) => this.hooks.talk(tree));
    this.ch2 = new Chapter2(this, world, player, ui, getSave, after);
    this.spear = buildSpear();
    this.spear.visible = false;
    player.model.handR.add(this.spear);
  }

  private get s() { return this.getSave(); }
  private get L() { return this.world.layout; }
  private inv(k: string) { return this.s.inventory[k] ?? 0; }
  private flag(k: string) { return !!this.s.flags[k]; }

  missing(req: Req): string[] {
    const out: string[] = [];
    for (const k in req) {
      const have = this.inv(k);
      if (have < req[k]) out.push(t('req.item', { item: t(`item.${k}`), n: have, need: req[k] }));
    }
    return out;
  }
  private consume(req: Req) { for (const k in req) this.s.inventory[k] = Math.max(0, this.inv(k) - req[k]); this.ui.setInventory(this.s.inventory, this.tools()); }
  progressOf(req: Req) { return Object.keys(req).map((k) => t('req.item', { item: t(`item.${k}`), n: Math.min(req[k], this.inv(k)), need: req[k] })).join(' · '); }

  /** Tools shown in the inventory bar. */
  tools(): string[] {
    const out: string[] = [];
    if (this.flag('spear')) out.push('spear');
    if (this.flag('transmitter') && !this.flag('beaconBuilt')) out.push('transmitter');
    return out;
  }

  // ---------------- requirements per level ----------------
  static readonly REQ: Record<string, Req> = {
    pit: { stone: 4, branch: 2 },
    strike: { tinder: 2 },
    shelter: { branch: 3, frond: 4 },
    spear: { branch: 1, flint: 1, vine: 1 },
    splint: { branch: 1, vine: 1 },
    beacon: { scrap: 3 },
  };

  done(n: number): boolean {
    if (n >= CH2_FIRST) return this.ch2.done(n);
    const f = (k: string) => this.flag(k);
    switch (n) {
      case 4: return f('fire');
      case 5: return f('shelter');
      case 6: return f('spear');
      case 7: return f('slept');
      case 8: return f('signal');
      case 9: return f('crewCamp');
      case 10: return f('arcEnd');
    }
    return false;
  }

  progress(n: number): string | null {
    if (n >= CH2_FIRST) return this.ch2.progress(n);
    const R = Story.REQ;
    switch (n) {
      case 4:
        if (!this.flag('pitBuilt')) return `${this.progressOf({ ...R.strike, ...R.pit })}`;
        return t('progress.strikes', { k: this.strikes, n: 3 });
      case 5: return this.progressOf(R.shelter);
      case 6: return this.progressOf(R.spear);
      case 7:
        if (this.flag('houndGone')) return t('progress.sleep');
        if (this.hound.state !== 'hidden') return t('progress.hound', { k: this.s.houndHits ?? 0, n: 3 });
        return isNight(this.s.timeOfDay) ? t('progress.waitNight') : t('progress.restDusk');
      case 8: return this.flag('signal') ? null : t('progress.highGround');
      case 9:
        if (!this.flag('metCrew')) return t('progress.findCrew');
        if (!this.flag('splint')) return this.progressOf(R.splint);
        return t('progress.leadCrew');
      case 10:
        if (!this.flag('transmitter')) return t('progress.salvage');
        if (!this.flag('beaconBuilt')) return this.progressOf(R.beacon);
        return t('progress.beaconOn');
    }
    return null;
  }

  /** Closest active pickup of these types. */
  nearest(types: string[]): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = Infinity;
    for (const it of this.world.items.items) {
      if (!it.active || !types.includes(it.type)) continue;
      const d = it.pos.distanceTo(this.player.pos);
      if (d < bd) { bd = d; best = it.pos; }
    }
    return best;
  }

  get crewPos() { return this.crew.pos; }

  /** Where the compass marker points (nearest missing resource or the station). */
  markerTarget(n: number): THREE.Vector3 | null {
    if (n >= CH2_FIRST) return this.ch2.marker(n);
    const L = this.L;
    const nearest = (types: string[]) => this.nearest(types);
    const needFor = (req: Req) => Object.keys(req).filter((k) => this.inv(k) < req[k]);
    const R = Story.REQ;
    switch (n) {
      case 4: {
        if (!this.flag('pitBuilt')) { const m = needFor({ ...R.pit, ...R.strike }); if (m.length) return nearest(m); }
        else if (this.inv('tinder') < 2) return nearest(['tinder']);
        return L.camp;
      }
      case 5: { const m = needFor(R.shelter); return m.length ? nearest(m) : L.shelter; }
      case 6: { const m = needFor(R.spear); return m.length ? nearest(m) : L.camp; }
      case 7: return this.hound.state !== 'hidden' && this.hound.state !== 'flee' ? null : L.shelter;
      case 8: return L.ridge;
      case 9: {
        if (!this.flag('splint')) {
          if (this.flag('metCrew')) { const m = needFor(R.splint); if (m.length) return nearest(m); }
          return L.crewSpot;
        }
        return L.camp;
      }
      case 10: {
        if (!this.flag('transmitter')) return L.pod;
        if (!this.flag('beaconBuilt')) { const m = needFor(R.beacon); if (m.length) return nearest(m); }
        return L.beacon;
      }
    }
    return null;
  }

  // ---------------- stations ----------------
  actions(): Action[] {
    const s = this.s, L = this.L, R = Story.REQ;
    const n = s.level;
    const out: Action[] = [];
    if (this.sequence) return out;
    out.push(...this.npcs.actions(), ...this.ch2.actions());
    if (n === 4 && !this.flag('pitBuilt')) {
      out.push({ id: 'pit', pos: L.camp, radius: 2.6, label: t('action.buildPit'), missing: this.missing(R.pit), run: () => {
        this.consume(R.pit);
        s.flags.pitBuilt = true;
        this.world.camp.setFire(1);
        audio.thud();
        this.ui.toast(t('msg.pitBuilt'));
      } });
    } else if (n === 4 && !this.flag('fire')) {
      out.push({ id: 'strike', pos: L.camp, radius: 2.6, label: t('action.strike'), missing: this.missing(R.strike), run: () => {
        this.strikes++;
        this.world.camp.strikeSparks();
        this.thrustT = 0.35;
        audio.tone(2400, 0.06, 'square', 0.12, 0, -1800);
        if (this.strikes === 1) this.ui.say('dlg.4.2', 'crew.scientist.name', 2);
        if (this.strikes === 2) this.ui.say('dlg.4.3', 'crew.scientist.name', 3);
        if (this.strikes < 3) { this.ui.toast(t(`msg.strike${this.strikes}`)); return; }
        this.consume(R.strike);
        s.flags.fire = true;
        this.world.camp.setFire(2);
        audio.tone(90, 1.4, 'sawtooth', 0.12, 0, 40);
        this.ui.toast(t('msg.fireLit'));
        this.ui.say('dlg.4.4', 'crew.scientist.name', 4);
      } });
    }
    if (n === 5 && !this.flag('shelter')) {
      out.push({ id: 'shelter', pos: L.shelter, radius: 3, label: t('action.buildShelter'), missing: this.missing(R.shelter), run: () => {
        this.consume(R.shelter);
        s.flags.shelter = true;
        this.world.camp.setShelter(true);
        audio.thud();
        this.ui.toast(t('msg.shelterBuilt'));
      } });
    }
    if (n === 6 && !this.flag('spear')) {
      out.push({ id: 'spear', pos: L.camp, radius: 3, label: t('action.craftSpear'), missing: this.missing(R.spear), run: () => {
        this.consume(R.spear);
        s.flags.spear = true;
        this.syncSpear();
        audio.chime();
        this.ui.toast(t('msg.spearCrafted'));
      } });
    }
    if (n === 7 && this.hound.state === 'hidden' && !this.flag('houndGone') && !isNight(s.timeOfDay)) {
      out.push({ id: 'rest', pos: L.shelter, radius: 3.2, label: t('action.restDusk'), run: () => this.skipTime(DUSK + 0.5, 'msg.restDusk') });
    }
    if (n === 7 && this.flag('houndGone') && !this.flag('slept')) {
      out.push({ id: 'sleep', pos: L.shelter, radius: 3.2, label: t('action.sleep'), run: () => this.sleep() });
    }
    if (n === 8 && !this.flag('signal')) {
      out.push({ id: 'tune', pos: L.ridge, radius: 5, label: t('action.tune'), run: () => this.tune() });
    }
    if (n === 9 && this.crew.mode === 'injured') {
      if (!this.flag('metCrew')) out.push({ id: 'talk', pos: this.crew.pos, radius: 2.8, label: t('action.talk', { name: t('{f:explorer}') }), run: () => this.meetCrew() });
      else out.push({ id: 'splint', pos: this.crew.pos, radius: 2.8, label: t('action.splint', { name: t('{f:explorer}') }), missing: this.missing(R.splint), run: () => this.splint() });
    }
    if (n === 10 && !this.flag('transmitter')) {
      out.push({ id: 'salvage', pos: L.pod, radius: 3.4, label: t('action.salvage'), run: () => {
        s.flags.transmitter = true;
        audio.blip();
        this.ui.toast(t('msg.transmitter'));
        this.ui.setInventory(s.inventory, this.tools());
      } });
    }
    if (n === 10 && this.flag('transmitter') && !this.flag('beaconBuilt')) {
      out.push({ id: 'beacon', pos: L.beacon, radius: 2.8, label: t('action.buildBeacon'), missing: this.missing(R.beacon), run: () => {
        this.consume(R.beacon);
        s.flags.beaconBuilt = true;
        this.world.camp.setBeacon(true, false);
        audio.thud();
        this.ui.toast(t('msg.beaconBuilt'));
        this.ui.setInventory(s.inventory, this.tools());
      } });
    }
    if (n === 10 && this.flag('beaconBuilt') && !this.flag('beacon')) {
      out.push({ id: 'beaconOn', pos: L.beacon, radius: 2.8, label: t('action.beaconOn'), run: () => this.lightBeacon() });
    }
    return out;
  }

  // ---------------- level 7: the night and the Duskhound ----------------
  /** True while the hound is close enough that E means "use the spear". */
  houndEngaged(): boolean {
    const h = this.hound;
    return h.state !== 'hidden' && h.state !== 'flee' && h.pos.distanceTo(this.player.pos) < 16;
  }
  /** The strike window: it is winding up or charging. */
  houndWindow(): boolean { return this.hound.state === 'windup' || this.hound.state === 'lunge'; }
  strikePrompt(): string { return this.houndWindow() ? t('action.brace') : t('action.ready'); }

  strike() {
    const h = this.hound;
    this.thrustT = 0.4;
    audio.tone(300, 0.12, 'triangle', 0.1, 0, -150);
    if (this.houndWindow()) { h.braced = true; return; }
    const now = performance.now();
    if (now - h.lastMiss > 2500) { h.lastMiss = now; this.ui.toast(t('msg.houndMiss')); }
  }

  private startHound() {
    const h = this.hound, p = this.player.pos;
    h.angle = Math.random() * Math.PI * 2;
    h.pos.set(p.x + Math.cos(h.angle) * 34, 0, p.z + Math.sin(h.angle) * 34);
    h.pos.y = this.world.terrain.height(h.pos.x, h.pos.z);
    h.state = 'approach';
    h.timer = 0;
    this.world.hound.root.visible = true;
    this.ui.toast(t('msg.houndNear'));
    this.ui.say('dlg.7.2', 'crew.scientist.name', 3);
    audio.tone(70, 1.8, 'sawtooth', 0.18, 0, -20);
  }

  private updateHound(dt: number, time: number) {
    const s = this.s, h = this.hound, p = this.player.pos;
    if (s.level !== 7 || this.flag('houndGone')) {
      if (h.state !== 'hidden' && h.state !== 'flee') h.state = 'hidden';
      if (h.state === 'hidden') { this.world.hound.root.visible = false; return; }
    }
    if (h.state === 'hidden') {
      if (s.level === 7 && !this.flag('houndGone') && this.flag('spear') && isNight(s.timeOfDay) && !this.sequence) this.startHound();
      else return;
    }
    h.timer += dt;
    const toP = this.tmp.set(p.x - h.pos.x, 0, p.z - h.pos.z);
    const dist = toP.length();
    let vx = 0, vz = 0, snarl = 0;
    const R = 8.5;
    switch (h.state) {
      case 'approach': {
        const sp = 6.5;
        if (dist > R + 0.5) { vx = (toP.x / dist) * sp; vz = (toP.z / dist) * sp; }
        else { h.state = 'circle'; h.timer = 0; h.angle = Math.atan2(h.pos.z - p.z, h.pos.x - p.x); }
        if (h.timer > 12) { h.state = 'circle'; h.timer = 0; } // never stall
        break;
      }
      case 'circle': {
        h.angle += dt * 0.42;
        const tx = p.x + Math.cos(h.angle) * R, tz = p.z + Math.sin(h.angle) * R;
        vx = (tx - h.pos.x) * 2.2; vz = (tz - h.pos.z) * 2.2;
        const v = Math.hypot(vx, vz); if (v > 7) { vx *= 7 / v; vz *= 7 / v; }
        snarl = 0.15;
        if (h.timer > 3.2) { h.state = 'windup'; h.timer = 0; h.braced = false; audio.tone(55, 1.0, 'sawtooth', 0.22, 0, 30); }
        break;
      }
      case 'windup':
        snarl = 1;
        if (h.timer > 1.3) { h.state = 'lunge'; h.timer = 0; h.target.copy(p); }
        break;
      case 'lunge': {
        snarl = 1;
        const sp = 11;
        if (dist > 1.25) { vx = (toP.x / dist) * sp; vz = (toP.z / dist) * sp; }
        if (dist <= 1.25 || h.timer > 1.4) this.resolveLunge(dist);
        break;
      }
      case 'recoil': {
        const sp = h.timer < 0.5 ? -7 : -2;
        if (dist > 0.01) { vx = (toP.x / dist) * sp; vz = (toP.z / dist) * sp; }
        if (h.timer > 1.6) { h.state = 'circle'; h.timer = 0; h.angle = Math.atan2(h.pos.z - p.z, h.pos.x - p.x); }
        break;
      }
      case 'flee': {
        const sp = -9;
        if (dist > 0.01) { vx = (toP.x / dist) * sp; vz = (toP.z / dist) * sp; }
        if (h.timer > 5 || dist > 60) { h.state = 'hidden'; this.world.hound.root.visible = false; return; }
        break;
      }
    }
    h.pos.x += vx * dt; h.pos.z += vz * dt;
    this.world.forest.collide(h.pos, 0.5);
    h.pos.y = this.world.terrain.height(h.pos.x, h.pos.z);
    h.speed = Math.hypot(vx, vz);
    const faceAway = h.state === 'flee' || (h.state === 'recoil' && h.timer < 0.5);
    const want = faceAway ? Math.atan2(-toP.x, -toP.z) : Math.atan2(toP.x, toP.z);
    let d = want - h.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    h.yaw += d * (1 - Math.exp(-dt * 8));
    const r = this.world.hound.root;
    r.position.copy(h.pos);
    r.rotation.y = h.yaw;
    this.world.hound.animate(h.speed, snarl, time, dt);
  }

  private resolveLunge(dist: number) {
    const s = this.s, h = this.hound;
    if (h.braced) {
      s.houndHits = (s.houndHits ?? 0) + 1;
      audio.tone(900, 0.25, 'sawtooth', 0.14, 0, -600);
      this.ui.toast(t('msg.houndHit'));
      if (s.houndHits >= 3) {
        h.state = 'flee'; h.timer = 0;
        s.flags.houndGone = true;
        this.after(2.2, () => { this.ui.toast(t('msg.houndFled')); this.ui.say('dlg.7.3', 'crew.scientist.name', 4); });
        return;
      }
    } else if (dist < 2.2) {
      this.hurt(14);
      s.bites = (s.bites ?? 0) + 1;
      this.ui.toast(t('msg.houndBit'));
    }
    h.state = 'recoil'; h.timer = 0; h.braced = false;
  }

  private skipTime(to: number, msgKey: string, nextDay = false, then?: () => void) {
    this.sequence = true;
    this.ui.fade('black', 1, 1.0);
    this.ui.toast(t(msgKey));
    this.after(1.2, () => {
      const s = this.s;
      if (nextDay) s.day++;
      s.timeOfDay = to;
      then?.();
      this.ui.fade('black', 0, 1.6);
      this.sequence = false;
    });
  }

  private sleep() {
    this.skipTime(DAWN, 'msg.sleeping', true, () => {
      const st = this.s.stats;
      st.stamina = 100;
      st.health = clamp(st.health + 25, 0, 100);
      st.thirst = Math.max(25, st.thirst - 15);
      st.hunger = Math.max(25, st.hunger - 15);
      this.s.flags.slept = true;
      this.after(1.0, () => this.ui.toast(t('msg.slept')));
    });
  }

  // ---------------- level 8: the signal ----------------
  private signalStrength(): number {
    const p = this.player.pos, L = this.L;
    const d = Math.hypot(p.x - L.ridge.x, p.z - L.ridge.z);
    const height = clamp((p.y - L.camp.y) / Math.max(1, L.ridge.y - L.camp.y), 0, 1);
    return clamp(0.06 + 0.5 * height + 0.44 * smoothstep(260, 6, d), 0, 1);
  }

  private tune() {
    const s = this.s;
    this.sequence = true;
    audio.beep();
    const dist = Math.round(this.L.pod2.distanceTo(this.player.pos) / 10) * 10;
    this.ui.deviceLines([t('signal.tune1')], true);
    this.after(1.4, () => { this.ui.deviceLines([t('signal.tune1'), t('signal.tune2')], true); audio.beep(); });
    this.after(2.8, () => { this.ui.deviceLines([t('signal.tune1'), t('signal.tune2'), t('signal.tune3', { m: dist })], true); audio.chime(); });
    this.after(3.2, () => this.ui.say('dlg.8.found', 'crew.scientist.name', 4.5));
    this.after(3.2 + Math.max(4.3, (voice.duration('dlg.8.found') ?? 0) + 0.5), () => { this.ui.deviceLines(null); s.flags.signal = true; this.sequence = false; });
  }

  // ---------------- level 9: the Explorer ----------------
  dialogue(lines: [string, string][], gap: number, then?: () => void) {
    this.sequence = true;
    let at = 0;
    for (const [key, who] of lines) {
      this.after(at, () => this.ui.say(key, `crew.${who}.name`, gap - 0.2));
      at += Math.max(gap, (voice.duration(key) ?? 0) + 0.4);
    }
    this.after(at, () => { this.sequence = false; then?.(); });
  }

  /** Set by the game while a scene directs the Explorer. */
  scenePose: (() => CrewPose | undefined) | null = null;

  /** Back into the (new) hand after the player model is rebuilt. */
  reattachSpear() { this.player.model.handR.add(this.spear); }

  private get pair() { return { z: this.player.model, y: this.world.explorer }; }

  /** Test hook: stage one of the world scenes straight away. */
  debugScene(id: 'rescue' | 'camp' | 'beacon') {
    this.crew.mode = 'idle';
    const L = this.L;
    if (id === 'rescue') { this.player.spawn(L.crewSpot.x + 2.2, L.crewSpot.z + 1.6, 0); this.crew.pos.copy(L.crewSpot); this.meetCrew(); }
    else if (id === 'camp') this.campTalk();
    else this.lightBeacon();
  }

  private meetCrew() {
    audio.chime();
    const { z, y } = this.pair;
    this.turnToCrew();
    this.playScene([
      { key: 'dlg.9.1', who: 'explorer', shot: () => cover.ots(y, z), poses: { explorer: 'injured', scientist: 'stand' }, after: 0.5 },
      { key: 'dlg.9.2', who: 'scientist', shot: () => cover.close(z, 0.4) },
      { key: 'dlg.9.3', who: 'explorer', shot: () => cover.close(y, 0.45, 1.25, 0) },
      { key: 'dlg.9.3b', who: 'scientist', shot: () => cover.close(z, -0.35), poses: { scientist: 'stand' }, after: 0.4 },
      { key: 'dlg.9.3c', who: 'explorer', shot: () => cover.close(y, -0.4, 1.1, 0), after: 0.4 },
      { key: 'dlg.9.4', who: 'scientist', shot: () => cover.two(z, y, 3.2), poses: { scientist: 'stand' } },
    ], () => { this.s.flags.metCrew = true; });
  }

  /** Square the player up to the Explorer before a two-hander. */
  private turnToCrew() {
    const p = this.player, c = this.crew.pos;
    const yaw = Math.atan2(c.x - p.pos.x, c.z - p.pos.z);
    p.model.root.rotation.y = yaw;
    p.facing = yaw + Math.PI;
    p.model.root.updateMatrixWorld(true);
  }

  private splint() {
    const s = this.s;
    this.consume(Story.REQ.splint);
    s.flags.splint = true;
    this.world.explorer.setSplint(true);
    audio.thud();
    this.turnToCrew();
    this.playScene([
      { key: 'dlg.9.5', who: 'explorer', shot: () => cover.close(this.pair.y, 0.4, 1.1, 0), poses: { explorer: 'injured', scientist: 'stand' } },
    ], () => {
      s.flags.crewFollow = true;
      this.crew.mode = 'follow';
      this.ui.toast(t('msg.crewFollow'));
    });
  }

  /** The quiet moment by the fire once she is safe. */
  private campTalk() {
    const { z, y } = this.pair;
    const L = this.L;
    this.crew.pos.copy(L.campSeat);
    this.player.spawn(L.campSeat.x + 1.5, L.campSeat.z + 1.4, 0);
    this.turnToCrew();
    this.playScene([
      { key: 'dlg.9.6', who: 'explorer', shot: () => cover.close(y, 0.5, 1.2, 0), poses: { explorer: 'sit', scientist: 'stand' }, after: 0.6 },
      { key: 'dlg.9.7', who: 'scientist', shot: () => cover.close(z, 0.3, 0.95), poses: { scientist: 'stand' }, after: 0.8 },
      { key: 'dlg.9.8', who: 'explorer', shot: () => cover.close(y, 0.25, 0.95, 0), after: 0.6 },
      { key: 'dlg.9.9', who: 'scientist', shot: () => cover.two(z, y, 3.5), after: 1.2 },
    ]);
  }

  private updateCrew(dt: number, time: number) {
    const s = this.s, L = this.L, c = this.crew, fig = this.world.explorer, p = this.player;
    // which mode does the save imply?
    let mode = c.mode;
    if (s.level < 9 && !this.flag('crewFollow')) mode = 'hidden';
    else if (this.flag('crewCamp')) mode = 'camp';
    else if (this.flag('crewFollow')) mode = 'follow';
    else mode = 'injured';
    if (mode !== c.mode) {
      if (mode === 'injured') { c.pos.copy(L.crewSpot); c.yaw = Math.atan2(L.pod2.x - L.crewSpot.x, L.pod2.z - L.crewSpot.z) + Math.PI; }
      if (mode === 'follow' && c.mode !== 'injured') this.placeBehindPlayer();
      if (mode === 'camp' && c.mode === 'hidden') c.pos.copy(L.campSeat);
      c.mode = mode;
    }
    fig.root.visible = mode !== 'hidden';
    if (mode === 'hidden') return;
    let pose: CrewPose = 'idle';
    let target: THREE.Vector3 | null = null, maxSpeed = 0;
    if (mode === 'injured') {
      pose = 'injured';
    } else if (mode === 'follow') {
      const f = p.forward(this.tmp);
      target = new THREE.Vector3(p.pos.x - f.x * 2.4 + f.z * 1.1, 0, p.pos.z - f.z * 2.4 - f.x * 1.1);
      const d = Math.hypot(target.x - c.pos.x, target.z - c.pos.z);
      maxSpeed = d > 18 ? 8 : d > 6 ? 5.5 : 4.2;
      if (c.pos.distanceTo(p.pos) > 70) this.placeBehindPlayer();
      // arrived at camp with her?
      if (s.level === 9 && c.pos.distanceTo(L.camp) < 10 && p.pos.distanceTo(L.camp) < 12 && !this.sequence) {
        s.flags.crewCamp = true;
        this.ui.toast(t('msg.crewAtCamp'));
        this.after(2.2, () => this.campTalk());
      }
    } else if (mode === 'camp') {
      if (this.scenePose) pose = 'idle';
      else if (c.pos.distanceTo(L.campSeat) > 0.6) { target = L.campSeat; maxSpeed = 3.2; }
      else pose = 'sit';
    }
    if (target) {
      const dx = target.x - c.pos.x, dz = target.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      const want = d > 0.7 ? Math.min(maxSpeed, d * 1.6) : 0;
      c.speed += (want - c.speed) * (1 - Math.exp(-dt * 6));
      if (d > 0.05) { c.pos.x += (dx / d) * c.speed * dt; c.pos.z += (dz / d) * c.speed * dt; }
      this.world.forest.collide(c.pos, 0.35);
      if (c.speed > 0.3) {
        const yw = Math.atan2(dx, dz);
        let dd = yw - c.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        c.yaw += dd * (1 - Math.exp(-dt * 8));
        pose = 'walk';
      } else if (mode === 'follow') {
        // stand and face the player
        const yw = Math.atan2(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
        let dd = yw - c.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        c.yaw += dd * (1 - Math.exp(-dt * 3));
      }
    } else {
      c.speed = 0;
      if (mode === 'camp') {
        const yw = Math.atan2(L.camp.x - c.pos.x, L.camp.z - c.pos.z);
        c.yaw += Math.atan2(Math.sin(yw - c.yaw), Math.cos(yw - c.yaw)) * (1 - Math.exp(-dt * 3));
      }
    }
    if (this.scenePose) c.yaw = Math.atan2(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
    // greet the player with a wave the first time they come close after the rescue
    if (c.wave > 0) { c.wave -= dt; if (pose === 'idle') pose = 'wave'; }
    c.pos.y = this.world.terrain.height(c.pos.x, c.pos.z);
    c.phase += dt * c.speed * 2.2 * (this.flag('splint') && !this.flag('crewCamp') ? 0.9 : 1);
    fig.root.position.copy(c.pos);
    fig.root.rotation.y = c.yaw;
    fig.root.updateMatrixWorld();
    fig.setLookTarget(c.pos.distanceTo(p.pos) < 9 ? V_LOOK.copy(p.pos).setY(p.pos.y + 1.55) : null);
    fig.animate(this.scenePose?.() ?? pose, c.phase, clamp(c.speed / 4, 0, 1.3), time, dt);
    fig.setName(t('crew.explorer.name'), t('crew.explorer.role'));
    fig.setTagVisible(this.scenePose ? 0 : smoothstep(16, 6, c.pos.distanceTo(p.pos)));
    fig.setSplint(this.flag('splint'));
  }

  private placeBehindPlayer() {
    const p = this.player, f = p.forward(this.tmp);
    this.crew.pos.set(p.pos.x - f.x * 3, 0, p.pos.z - f.z * 3);
    this.crew.pos.y = this.world.terrain.height(this.crew.pos.x, this.crew.pos.z);
  }

  // ---------------- level 10: the beacon and the cliffhanger ----------------
  private lightBeacon() {
    const s = this.s;
    s.flags.beacon = true;
    this.world.camp.setBeacon(true, true);
    this.sequence = true;
    audio.tone(180, 2.5, 'sine', 0.2, 0, 400);
    const log: string[] = [];
    const push = (key: string) => () => { log.push(t(key)); this.ui.deviceLines(log.slice(-6), true); audio.beep(); };
    const alert = (n: number) => () => { this.ui.deviceLines(['beacon.unknown1', 'beacon.unknown2', 'beacon.unknown3'].slice(0, n).map((k) => t(k)), true, true); };
    const { z, y } = this.pair;
    const b = this.L.beacon;
    const beaconShot = () => ({ from: b.clone().add(new THREE.Vector3(5.5, 1.5, 6)), to: b.clone().add(new THREE.Vector3(0, 2.4, 0)), push: 0.1 });
    const skyShot = () => ({ from: z.root.position.clone().add(new THREE.Vector3(-1.5, 0.5, 2.6)), to: b.clone().add(new THREE.Vector3(0, 7, 0)), push: 0.08 });
    this.crew.pos.set(b.x - 1.6, this.world.terrain.height(b.x - 1.6, b.z + 1.8), b.z + 1.8);
    this.player.spawn(b.x + 1.2, b.z + 2.0, 0);
    this.turnToCrew();
    this.playScene([
      { run: push('beacon.1'), hold: 1.8, shot: beaconShot, poses: { scientist: 'stand', explorer: 'stand' } },
      { run: push('beacon.2'), hold: 1.7 },
      { run: push('beacon.strong'), key: 'rad.strong', who: 'strong', shot: () => cover.mid(z, 0.5, 2.2), poses: { scientist: 'stand' } },
      { run: push('beacon.medic'), key: 'rad.medic', who: 'medic', shot: () => cover.mid(y, -0.5, 2.2), poses: { scientist: 'stand' } },
      { run: push('beacon.builder'), key: 'rad.builder', who: 'builder', shot: () => cover.two(z, y, 3.3), poses: { scientist: 'stand' } },
      { run: push('beacon.social'), key: 'rad.social', who: 'social', shot: () => cover.close(y, 0.4, 1.3), poses: { scientist: 'stand', explorer: 'stand' } },
      { key: 'dlg.10.3', who: 'explorer', shot: () => cover.close(y, -0.4, 1.1), poses: { explorer: 'stand', scientist: 'stand' }, after: 0.7 },
      { run: () => { alert(1)(); audio.tone(40, 2.5, 'sawtooth', 0.25, 0, 10); }, hold: 2.2, shot: skyShot, poses: { explorer: 'stand', scientist: 'stand' } },
      { run: alert(2), key: 'beacon.unknown2', hold: 2.4, shot: beaconShot },
      { run: alert(3), key: 'beacon.unknown3', hold: 2.4, shot: () => cover.close(z, 0.2, 0.9), after: 0.8 },
      { key: 'dlg.10.4', who: 'explorer', shot: () => cover.ots(y, z) },
      { key: 'dlg.10.5', who: 'scientist', shot: () => cover.close(z, -0.3), after: 0.9 },
      { run: () => this.ui.deviceLines(null), key: 'dlg.10.6', who: 'explorer', shot: () => cover.close(y, 0.35, 1), poses: { explorer: 'point' } },
      { key: 'dlg.10.7', who: 'scientist', shot: () => cover.close(z, 0.3, 0.95), after: 0.5 },
      { key: 'dlg.10.8', who: 'explorer', shot: () => cover.ots(y, z, -0.6), poses: { explorer: 'stand' }, after: 0.8 },
      { key: 'dlg.10.9', who: 'scientist', shot: () => cover.close(z, -0.2, 0.85), poses: { scientist: 'stand' }, after: 1.1 },
      { key: 'dlg.10.10', who: 'explorer', shot: () => cover.close(y, -0.2, 0.9), after: 1 },
      { run: () => { this.ui.chapter(['chapter.end1', 'chapter.end2']); document.getElementById('cine-bars')!.classList.add('hidden'); }, hold: 5.5, shot: skyShot },
    ], () => {
      this.ui.chapter(null);
      this.ui.deviceLines(null);
      document.getElementById('cine-bars')!.classList.remove('hidden');
      s.flags.arcEnd = true;
      this.sequence = false;
    });
  }

  // ---------------- end of Chapter Two ----------------
  /** The beacon lists what you made, in order, and knows what comes next. */
  ch2Finale() {
    if (!this.hooks.free() || this.sequence) { this.after(1, () => this.ch2Finale()); return; }
    const s = this.s, L = this.L;
    const { z, y } = this.pair;
    this.crew.pos.copy(L.campSeat);
    this.player.spawn(L.campSeat.x + 1.5, L.campSeat.z + 1.4, 0);
    this.turnToCrew();
    const b = L.beacon;
    const beaconShot = () => ({ from: b.clone().add(new THREE.Vector3(5.5, 1.5, 6)), to: b.clone().add(new THREE.Vector3(0, 2.4, 0)), push: 0.1 });
    const alert = (k: string) => () => { this.ui.deviceLines([t('beacon.voice'), t(k)], true, true); audio.tone(40, 2, 'sawtooth', 0.25, 0, 10); };
    this.playScene([
      { run: alert('ch2.end.1'), key: 'ch2.end.1', hold: 3, shot: beaconShot, poses: { explorer: 'sit', scientist: 'stand' }, after: 0.6 },
      { key: 'ch2.end.2', who: 'explorer', shot: () => cover.close(y, 0.4, 1.1, 0), after: 0.5 },
      { run: alert('ch2.end.3'), key: 'ch2.end.3', hold: 2.6, shot: beaconShot, after: 0.6 },
      { run: () => this.ui.deviceLines(null), key: 'ch2.end.4', who: 'explorer', shot: () => cover.close(y, -0.3, 1, 0), after: 0.6 },
      { run: () => { this.ui.chapter(['chapter2.end1', 'chapter2.end2']); document.getElementById('cine-bars')!.classList.add('hidden'); }, hold: 5, shot: () => cover.close(z, 0.2, 0.9) },
    ], () => {
      this.ui.chapter(null);
      this.ui.deviceLines(null);
      document.getElementById('cine-bars')!.classList.remove('hidden');
      s.flags.ch2End = true;
    });
  }

  // ---------------- lifecycle ----------------
  /** Rebuild world state (camp stages, spear, crewmate) from the save. */
  sync() {
    const s = this.s, camp = this.world.camp;
    camp.setFire(this.flag('fire') ? 2 : this.flag('pitBuilt') ? 1 : 0);
    camp.setShelter(this.flag('shelter'));
    camp.setBeacon(this.flag('beaconBuilt'), this.flag('beacon'));
    this.world.setCampWork(s.discoveries ?? []);
    if (this.flag('beacon') && !this.flag('arcEnd')) s.flags.arcEnd = true; // quit mid-sequence
    this.syncSpear();
    this.strikes = 0;
    this.sequence = false;
    this.hound.state = 'hidden';
    this.world.hound.root.visible = false;
    this.crew.mode = 'hidden';
    this.ui.deviceLines(null);
  }

  private syncSpear() {
    this.spear.visible = this.flag('spear');
  }

  /** Called when a level starts (after the previous one completes). */
  onLevelStart(n: number) {
    if (n === 7) this.after(5.5, () => this.ui.say('dlg.7.1', 'crew.scientist.name', 5));
    if (n === 8) {
      this.signalClock = 12.5; // the meter takes over after the first readout
      this.after(5.0, () => { this.ui.deviceLines([t('signal.detect1'), t('signal.detect2')], true); audio.beep(); });
      this.after(6.5, () => this.ui.say('dlg.8.1', 'crew.scientist.name', 5));
      this.after(12, () => this.ui.deviceLines(null));
    }
    if (n === 9) this.after(5.0, () => this.ui.memory('memory.explorer', 10));
    if (n === 10) {
      this.dialogue([['dlg.10.1', 'explorer'], ['dlg.10.2', 'scientist'], ['j.7', 'explorer']], 5);
      this.crew.wave = 2.5;
    }
  }

  onDeath() {
    this.hound.state = 'hidden';
    this.world.hound.root.visible = false;
    this.sequence = false;
    if (this.flag('crewFollow') && !this.flag('crewCamp')) this.after(0.5, () => this.placeBehindPlayer());
  }

  get busy() { return this.sequence; }

  update(dt: number, time: number) {
    const s = this.s;
    this.npcs.update(dt, time);
    this.updateHound(dt, time);
    this.updateCrew(dt, time);
    this.ch2.update(dt);
    // spear thrust animation overrides the walk cycle's right arm
    if (this.thrustT > 0) {
      this.thrustT = Math.max(0, this.thrustT - dt);
      const k = Math.sin((1 - this.thrustT / 0.4) * Math.PI);
      this.player.model.armR.rotation.x = -0.3 - k * 1.3;
    }
    // signal meter while looking for high ground
    if (s.level === 8 && !this.flag('signal') && !this.sequence) {
      this.signalClock -= dt;
      if (this.signalClock <= 0) {
        this.signalClock = 0.4;
        const k = this.signalStrength();
        const bars = Math.round(k * 10);
        this.ui.deviceLines([t('signal.meter', { p: Math.round(k * 100) }), '▮'.repeat(bars) + '▯'.repeat(10 - bars), k > 0.8 ? t('signal.strong') : t('signal.climb')], true);
      }
    }
    this.world.camp.setSites({
      fire: s.level === 4 || (s.level === 6 && !this.flag('spear')) || (s.level >= CH2_FIRST && !!this.ch2.node(s.level) && this.ch2.progress(s.level) === t('progress.ch2Ready')),
      shelter: s.level === 5 && !this.flag('shelter'),
      beacon: s.level === 10 && !this.flag('beaconBuilt'),
    });
  }

  /** Crew panel status for each crewmate. */
  crewStatus(id: string): { status: string; unlocked: boolean } {
    if (id === 'explorer') {
      if (this.flag('crewCamp')) return { status: t('crew.st.camp'), unlocked: true };
      if (this.flag('crewFollow')) return { status: t('crew.st.withYou'), unlocked: true };
      if (this.flag('signal')) return { status: t('crew.st.injured'), unlocked: false };
    }
    if (this.flag('beacon') && id !== 'scientist') return { status: t(`crew.st.signal.${id}`), unlocked: false };
    return { status: t('crew.status'), unlocked: false };
  }

  debugHound() { return { state: this.hound.state, hits: this.s.houndHits ?? 0, window: this.houndWindow(), pos: this.hound.pos.toArray() }; }
  debugCrew() { return { mode: this.crew.mode, pos: this.crew.pos.toArray(), dist: this.crew.pos.distanceTo(this.player.pos) }; }
}

/** Flint-tipped spear held in the right hand. */
const V_LOOK = new THREE.Vector3();

function buildSpear() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4e3a, roughness: 0.85, flatShading: true });
  const flint = new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.2, metalness: 0.35, flatShading: true });
  const vine = new THREE.MeshStandardMaterial({ color: 0x2c4a2a, roughness: 0.9, flatShading: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1.9, 5), wood);
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), flint);
  tip.scale.set(0.6, 2.0, 0.35); tip.position.y = 1.02;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 5), vine);
  wrap.position.y = 0.9;
  g.add(shaft, tip, wrap);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  // in the hand, angled forward and up
  g.position.set(0, -0.06, 0.01);
  g.rotation.x = 1.15;
  return g;
}
