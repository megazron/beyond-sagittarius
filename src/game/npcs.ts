import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import { voice } from '../core/voice';
import { smoothstep } from '../core/noise';
import { createCharacter, Character, CrewPose } from '../characters/character';
import { defaultLook, LINEAGES, PlayerLook } from '../characters/custom';
import type { SaveData } from '../core/save';
import type { World } from '../world/world';
import type { Player } from './player';
import type { UI } from '../ui/ui';
import type { Action } from './story';

type NpcId = 'trader' | 'local' | 'hermit' | 'trav' | 'cameo';

interface Npc {
  id: NpcId;
  fig: Character;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  phase: number;
  speed: number;
  wait: number;
  roam: number;
  pose: CrewPose;
  greeted: boolean;
}

const LOOK = new THREE.Vector3();
const look = (lineage: PlayerLook['lineage'], o: Partial<PlayerLook>): PlayerLook => ({ ...defaultLook(), lineage, ...LINEAGES[lineage], ...o });

/**
 * People you can bump into: a trader on his rounds, a local who finds you
 * noisy, a hermit who knows too much, a tourist who has been queuing for nine
 * years, and a man in a suit who shouldn't be here at all.
 */
export class Npcs {
  private list: Npc[] = [];
  private built = false;
  private tmp = new THREE.Vector3();

  constructor(private world: World, private player: Player, private ui: UI, private getSave: () => SaveData, private after: (s: number, fn: () => void) => void) {}

  private get s() { return this.getSave(); }

  private build() {
    this.built = true;
    const L = this.world.layout, d = this.world.q.name === 'mobile' ? 0.6 : 1;
    const T = this.world.terrain;
    const at = (x: number, z: number) => new THREE.Vector3(x, T.height(x, z), z);
    const add = (id: NpcId, fig: Character, home: THREE.Vector3, roam: number) => {
      fig.root.position.copy(home);
      fig.setGround((x, z) => T.height(x, z));
      this.world.scene.add(fig.root);
      this.list.push({ id, fig, home, pos: home.clone(), target: home.clone(), yaw: 0, phase: 0, speed: 0, wait: 1 + Math.random() * 3, roam, pose: 'idle', greeted: false });
    };
    add('trader', createCharacter('scientist', d, look('ortek', { outfit: 'builder', hair: 'builder', hairRoot: 0x6a2bd0, hairTip: 0xffb0e6, height: 0.94, build: 0.8, gender: 'm', eye: 'squint', accent: 0xffb13a })), at(L.camp.x + 26, L.camp.z - 18), 26);
    add('local', createCharacter('scientist', d, look('vael', { skin: 0x2f8f8f, ears: 'fin', tail: true, marks: 'stars', glow: 0x7fff8a, outfit: 'explorer', hair: 'medic', hairRoot: 0x12a48c, hairTip: 0xb6ff5a, height: 0.92, build: 0.1, gender: 'f', eye: 'doll', iris: 0x7fff8a })), at(L.pod.x - 34, L.pod.z + 30), 18);
    add('hermit', createCharacter('scientist', d, look('korrath', { skin: 0x8f5b3f, horns: false, outfit: 'medic', hair: 'medic', hairRoot: 0xb6b8dc, hairTip: 0xe9e6f8, height: 0.96, build: 0.05, gender: 'm', eye: 'tired', iris: 0xffc23a })), at(L.ridge.x + 7, L.ridge.z + 5), 3);
    add('trav', createCharacter('scientist', d, look('sirelle', { skin: 0xe6c3a0, marks: 'dots', glow: 0xffa030, outfit: 'social', hair: 'scientist', hairRoot: 0x2a1a14, hairTip: 0x6a4a34, gender: 'm', build: 0.55, eye: 'tired', iris: 0x8a5a34, eyeGlow: false })), at(L.pod2.x + 18, L.pod2.z - 12), 7);
    // somewhere unexpected: a different spot each playthrough, picked from the save
    const spots = [[L.ridge.x - 40, L.ridge.z + 26], [L.pod2.x - 52, L.pod2.z + 30], [L.camp.x - 70, L.camp.z - 60]];
    this.cameoSpots = spots.map(([x, z]) => at(x, z));
    add('cameo', createCharacter('strong', d, undefined, 'suit'), this.cameoSpots[0].clone(), 0);
  }

  private talk(lines: string[], who: NpcId) {
    let at = 0;
    for (const k of lines) {
      this.after(at, () => this.ui.say(k, `npc.${who}.name`, 3));
      at += Math.max(3, (voice.duration(k) ?? 0) + 0.4);
    }
  }

  actions(): Action[] {
    const s = this.s, out: Action[] = [];
    for (const n of this.list) {
      if (!n.fig.root.visible) continue;
      const name = t(`npc.${n.id}.name`);
      const base = { id: `npc-${n.id}`, pos: n.pos, radius: 2.8 };
      const flag = (k: string) => !!s.flags[`npc-${n.id}-${k}`];
      const set = (k: string) => { s.flags[`npc-${n.id}-${k}`] = true; };
      const face = () => { n.wait = Math.max(n.wait, 6); n.speed = 0; n.target.copy(n.pos); n.pose = 'wave'; this.after(2, () => (n.pose = 'idle')); };
      if (n.id === 'trader') {
        out.push({ ...base, label: t('action.trade', { name }), run: () => {
          face();
          if (!flag('met')) { set('met'); this.talk(['npc.trader.hi'], 'trader'); return; }
          if ((s.inventory.branch ?? 0) < 2) { this.talk(['npc.trader.no'], 'trader'); return; }
          s.inventory.branch -= 2;
          s.inventory.flint = (s.inventory.flint ?? 0) + 1;
          audio.blip();
          this.ui.setInventory(s.inventory);
          this.talk(['npc.trader.done'], 'trader');
        } });
      } else if (n.id === 'local') {
        const done = flag('done');
        out.push({ ...base, label: flag('met') && !done ? t('action.give', { name }) : t('action.talk', { name }), run: () => {
          face();
          if (!flag('met')) { set('met'); this.talk(['npc.local.hi', 'npc.local.ask'], 'local'); return; }
          if (done) { this.talk(['npc.local.hi'], 'local'); return; }
          if ((s.inventory.stone ?? 0) < 1) { this.talk(['npc.local.ask'], 'local'); return; }
          s.inventory.stone -= 1;
          s.inventory.vine = (s.inventory.vine ?? 0) + 1;
          set('done');
          audio.chime();
          this.ui.setInventory(s.inventory);
          this.talk(['npc.local.done'], 'local');
        } });
      } else {
        const lines = n.id === 'hermit' ? ['npc.hermit.1', 'npc.hermit.2'] : n.id === 'trav' ? ['npc.trav.1', 'npc.trav.2'] : ['npc.cameo.1', 'npc.cameo.2'];
        out.push({ ...base, label: t('action.talk', { name }), run: () => { face(); this.talk(lines, n.id); } });
      }
    }
    return out;
  }

  private cameoSpots: THREE.Vector3[] = [];
  private cameoPlaced = false;

  /** Build everyone during loading, so nobody pops in with a frame hitch on first play. */
  prepare() { if (!this.built) this.build(); }

  update(dt: number, time: number) {
    if (!this.built) this.build();
    if (!this.cameoPlaced) {
      this.cameoPlaced = true;
      const n = this.list.find((x) => x.id === 'cameo')!;
      const at = this.cameoSpots[(this.s.day + (this.s.savedAt % 3)) % this.cameoSpots.length];
      n.home.copy(at); n.pos.copy(at); n.target.copy(at);
    }
    const p = this.player.pos;
    for (const n of this.list) {
      const dist = n.pos.distanceTo(p);
      const near = dist < 140;
      n.fig.root.visible = near;
      if (!near) continue;
      if (n.roam > 0) {
        n.wait -= dt;
        const d = Math.hypot(n.target.x - n.pos.x, n.target.z - n.pos.z);
        if (d < 0.6) {
          n.speed *= 0.8;
          if (n.wait <= 0) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * n.roam;
            n.target.set(n.home.x + Math.cos(a) * r, 0, n.home.z + Math.sin(a) * r);
            n.wait = 3 + Math.random() * 6;
          }
        } else if (n.wait > 5.5) n.speed = 0;
        else {
          n.speed += (1.5 - n.speed) * (1 - Math.exp(-dt * 4));
          const yaw = Math.atan2(n.target.x - n.pos.x, n.target.z - n.pos.z);
          n.yaw += Math.atan2(Math.sin(yaw - n.yaw), Math.cos(yaw - n.yaw)) * (1 - Math.exp(-dt * 6));
          n.pos.x += Math.sin(n.yaw) * n.speed * dt;
          n.pos.z += Math.cos(n.yaw) * n.speed * dt;
          this.world.forest.collide(n.pos, 0.35);
        }
      }
      n.pos.y = this.world.terrain.height(n.pos.x, n.pos.z);
      // notices you, and turns to look
      if (dist < 7) {
        const yaw = Math.atan2(p.x - n.pos.x, p.z - n.pos.z);
        if (n.speed < 0.3) n.yaw += Math.atan2(Math.sin(yaw - n.yaw), Math.cos(yaw - n.yaw)) * (1 - Math.exp(-dt * 4));
        if (!n.greeted && n.id !== 'cameo') { n.greeted = true; n.pose = 'wave'; this.after(2, () => (n.pose = 'idle')); }
      } else if (dist > 20) n.greeted = false;
      n.phase += dt * n.speed * 2.2;
      n.fig.root.position.copy(n.pos);
      n.fig.root.rotation.y = n.yaw;
      n.fig.root.updateMatrixWorld();
      n.fig.setLookTarget(n.pos.distanceTo(this.player.pos) < 7 ? LOOK.copy(this.player.pos).setY(this.player.pos.y + 1.55) : null);
      n.fig.animate(n.speed > 0.3 ? 'walk' : n.pose, n.phase, Math.min(1.1, n.speed / 3), time, dt);
      n.fig.setName(t(`npc.${n.id}.name`), t(`npc.${n.id}.role`));
      n.fig.setTagVisible(smoothstep(14, 5, dist));
    }
  }

  debug() { return this.list.map((n) => ({ id: n.id, pos: n.pos.toArray(), visible: n.fig.root.visible })); }
}
