import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import { smoothstep } from '../core/noise';
import { createCharacter, Character, CrewPose } from '../characters/character';
import { defaultLook, LINEAGES, PlayerLook } from '../characters/custom';
import { writeSave } from '../core/save';
import type { SaveData } from '../core/save';
import { doHidden, test } from './branch';
import type { World } from '../world/world';
import type { Player } from './player';
import type { UI } from '../ui/ui';
import type { Action } from './story';
import type { DlgChoice, DlgTree } from './dialogue';
import { isDiscovered } from './tech/tech';

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
 * years, and a man in a suit who shouldn't be here at all. Everyone talks
 * through the dialogue panel: choices, trades, small quests, taught tricks
 * (`tip-<tech>` flags make a minigame easier) and reactions to the save.
 */
/** Ground drier than this is walkable for people who aren't swimming. */
const DRY = -0.3;

export class Npcs {
  private list: Npc[] = [];
  private built = false;
  private tmp = new THREE.Vector3();

  constructor(private world: World, private player: Player, private ui: UI, private getSave: () => SaveData, private after: (s: number, fn: () => void) => void, private open: (tree: DlgTree) => void) {}

  private get s() { return this.getSave(); }

  /** Everyone standing about: scenes that aren't theirs clear them off the set. */
  roots() { return this.list.map((n) => n.fig.root); }

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

  private get inv() { return this.s.inventory; }
  private flag(n: NpcId, k: string) { return !!this.s.flags[`npc-${n}-${k}`]; }
  private set(n: NpcId, k: string) { this.s.flags[`npc-${n}-${k}`] = true; }
  private once(n: NpcId, k: string) { if (this.flag(n, k)) return false; this.set(n, k); return true; }
  private knows(id: string) { return isDiscovered(this.s, id); }
  private give(items: Record<string, number>) {
    for (const k in items) { this.inv[k] = (this.inv[k] ?? 0) + items[k]; this.ui.toast(t('msg.got', { n: items[k], item: t(`item.${k}`) })); }
    audio.chime();
    this.ui.setInventory(this.inv);
  }
  private take(items: Record<string, number>) {
    for (const k in items) this.inv[k] = Math.max(0, (this.inv[k] ?? 0) - items[k]);
    this.ui.setInventory(this.inv);
  }
  /** Why a deal can't happen yet, or null. */
  private lacking(items: Record<string, number>): string | null {
    const out = Object.keys(items).filter((k) => (this.inv[k] ?? 0) < items[k]).map((k) => t('req.item', { item: t(`item.${k}`), n: this.inv[k] ?? 0, need: items[k] }));
    return out.length ? t('dlg.need', { list: out.join(', ') }) : null;
  }
  private teach(techId: string) {
    this.s.flags[`tip-${techId}`] = true;
    audio.chime();
    this.ui.toast(t('msg.taught', { name: t(`tech.${techId}`) }));
  }
  /** Spend `cost`, receive `get`. */
  private deal(label: string, cost: Record<string, number>, get: Record<string, number>, go?: string): DlgChoice {
    return { label, blocked: () => this.lacking(cost), run: () => { this.take(cost); this.give(get); }, go };
  }

  /** Tovik's miscount, still in your pocket, while handing it back can matter. */
  private owesFlint() {
    return this.s.level < 9 && (this.inv.flint ?? 0) > 0 && test(this.s, { all: [{ did: 'c1.tovik.over' }, { not: { did: 'c1.tovik.return' } }] });
  }

  private bye: DlgChoice = { label: 'ch.bye' };
  private back: DlgChoice = { label: 'ch.back', go: 'top' };

  /** Who you get depends on what you did: flags, deaths and discoveries. */
  private tree(id: NpcId): DlgTree {
    const who = `npc.${id}.name`, end = [this.back, this.bye];
    const line = (say: string) => ({ who, say, choices: end });
    const died = (this.s.deaths ?? 0);
    const ch2 = this.s.level >= 11;
    const short = !!this.s.flags['c1.tovikShort'], price = short ? 3 : 2;
    switch (id) {
      case 'trader': return {
        start: 'top',
        nodes: {
          top: {
            who,
            say: () => {
              if (this.once(id, 'met')) return 'npc.trader.hi';
              if (died >= 2 && this.once(id, 'dead')) return 'npc.trader.dead';
              if (this.knows('salt') && this.once(id, 'salt')) return 'npc.trader.salt';
              return 'npc.trader.back';
            },
            choices: () => [
              { label: 'ch.trade', go: 'shop' },
              // no reminder anywhere: he doesn't know, so only the player can raise it
              { label: 'ch.returnflint', show: () => this.owesFlint(), run: () => { doHidden(this.s, 'c1.tovik.return'); this.ui.setInventory(this.inv); writeSave(this.s); }, go: 'honest' },
              { label: 'ch.work', go: 'quest', show: () => ch2 && !this.flag(id, 'q') },
              { label: 'ch.tovtip', show: () => ch2 && !this.s.flags['tip-charcoal'], blocked: () => this.lacking({ stone: 2 }), run: () => { this.take({ stone: 2 }); this.teach('charcoal'); }, go: 'tip' },
              this.bye,
            ],
          },
          shop: {
            who, say: () => (short ? 'npc.trader.short' : (this.inv.branch ?? 0) < 2 && !ch2 ? 'npc.trader.no' : 'npc.trader.menu'),
            choices: () => [
              {
                label: short ? 'ch.tradeflint3' : 'ch.tradeflint', blocked: () => this.lacking({ branch: price }), go: 'sold',
                run: () => {
                  this.take({ branch: price });
                  // the first time he loses count, and doesn't notice
                  const over = this.s.level < 9 && doHidden(this.s, 'c1.tovik.over');
                  this.give({ flint: over ? 2 : 1 });
                  if (over) writeSave(this.s);
                },
              },
              { ...this.deal('ch.tradeclay', { charcoal: 1 }, { clay: 2 }, 'sold'), show: () => this.knows('charcoal') },
              { ...this.deal('ch.tradenut', { salt: 1 }, { oilnut: 2 }, 'sold'), show: () => this.knows('salt') },
              this.back,
            ],
          },
          sold: line('npc.trader.done'),
          honest: line('npc.trader.honest'),
          tip: line('npc.trader.tip'),
          quest: {
            who, say: 'npc.trader.q',
            choices: () => [
              { label: 'ch.givesoap', blocked: () => this.lacking({ soap: 1 }), run: () => { this.take({ soap: 1 }); this.give({ sand: 3 }); this.set(id, 'q'); }, go: 'qdone' },
              this.back,
            ],
          },
          qdone: line('npc.trader.qdone'),
        },
      };
      case 'local': return {
        start: 'top',
        nodes: {
          top: {
            who,
            say: () => {
              if (this.once(id, 'met')) return 'npc.local.hi';
              if (died >= 1 && this.once(id, 'dead')) return 'npc.local.dead';
              if (this.knows('soap') && this.once(id, 'soap')) return 'npc.local.soap';
              return this.flag(id, 'done') ? 'npc.local.hi' : 'npc.local.ask';
            },
            choices: () => [
              { label: 'ch.stone', show: () => !this.flag(id, 'done'), blocked: () => this.lacking({ stone: 1 }), run: () => { this.take({ stone: 1 }); this.give({ vine: 1 }); this.set(id, 'done'); }, go: 'gave' },
              { label: 'ch.cord', show: () => ch2 && !this.s.flags['tip-cordage'], run: () => this.teach('cordage'), go: 'cord' },
              { label: 'ch.clay', show: () => ch2 && !this.s.flags['tip-pottery'], run: () => this.teach('pottery'), go: 'clay' },
              { label: 'ch.work', go: 'quest', show: () => this.knows('pottery') && !this.flag(id, 'q') },
              this.bye,
            ],
          },
          gave: line('npc.local.done'),
          cord: line('npc.local.cord'),
          clay: line('npc.local.clay'),
          quest: {
            who, say: 'npc.local.q',
            choices: () => [
              { label: 'ch.givepot', blocked: () => this.lacking({ pot: 1 }), run: () => { this.take({ pot: 1 }); this.give({ lichen: 2 }); this.set(id, 'q'); }, go: 'qdone' },
              this.back,
            ],
          },
          qdone: line('npc.local.qdone'),
        },
      };
      case 'hermit': return {
        start: 'top',
        nodes: {
          top: {
            who,
            say: () => {
              if (this.once(id, 'met')) return 'npc.hermit.1';
              if (died >= 1 && this.once(id, `dead${died}`)) return 'npc.hermit.dead';
              return 'npc.hermit.2';
            },
            choices: () => [
              { label: 'ch.voice', go: 'voice', show: () => !!this.s.flags.beacon },
              { label: 'ch.lime', show: () => ch2 && !this.s.flags['tip-lime'], run: () => { if (this.knows('charcoal')) this.teach('lime'); }, go: 'lime' },
              { label: 'ch.glasstip', show: () => this.knows('salt') && !this.s.flags['tip-glass'], blocked: () => this.lacking({ salt: 1 }), run: () => { this.take({ salt: 1 }); this.teach('glass'); }, go: 'glass' },
              this.bye,
            ],
          },
          voice: line('npc.hermit.voice'),
          lime: { who, say: () => (this.knows('charcoal') ? 'npc.hermit.lime' : 'npc.hermit.soon'), choices: end },
          glass: line('npc.hermit.glass'),
        },
      };
      case 'trav': return {
        start: 'top',
        nodes: {
          top: {
            who,
            say: () => {
              if (this.once(id, 'met')) return 'npc.trav.1';
              if (died >= 1 && this.once(id, 'dead')) return 'npc.trav.dead';
              if ((this.inv.soap ?? 0) > 0 && this.once(id, 'soap')) return 'npc.trav.soap';
              return this.once(id, 'hungry') ? 'npc.trav.hungry' : 'npc.trav.2';
            },
            choices: () => [
              { label: 'ch.refund', go: 'refund' },
              // costs real hunger, and nothing says it matters
              { label: 'ch.share', show: () => this.flag(id, 'hungry') && !test(this.s, { did: 'c1.pello.share' }) && this.s.stats.hunger >= 30, run: () => { doHidden(this.s, 'c1.pello.share'); audio.blip(); writeSave(this.s); }, go: 'fed' },
              { label: 'ch.work', go: 'quest', show: () => this.knows('pottery') && !this.flag(id, 'q') },
              this.bye,
            ],
          },
          refund: line('npc.trav.refund'),
          quest: {
            who, say: 'npc.trav.q',
            choices: () => [
              { label: 'ch.givepot', blocked: () => this.lacking({ pot: 1 }), run: () => { this.take({ pot: 1 }); this.give({ sugarpod: 3 }); this.teach('fermentation'); this.set(id, 'q'); }, go: 'qdone' },
              this.back,
            ],
          },
          fed: line('npc.trav.fed'),
          qdone: line('npc.trav.qdone'),
        },
      };
      case 'cameo': return {
        // no quest, no trade, no reaction: he is just here
        start: 'top',
        nodes: { top: { who, say: () => (this.once(id, 'met') ? 'npc.cameo.1' : 'npc.cameo.2'), choices: [{ label: 'ch.silent' }] } },
      };
    }
  }

  actions(): Action[] {
    const out: Action[] = [];
    for (const n of this.list) {
      if (!n.fig.root.visible) continue;
      const name = t(`npc.${n.id}.name`);
      const face = () => { n.wait = Math.max(n.wait, 6); n.speed = 0; n.target.copy(n.pos); n.pose = 'wave'; this.after(2, () => (n.pose = 'idle')); };
      out.push({
        id: `npc-${n.id}`, pos: n.pos, radius: 2.8,
        label: t(n.id === 'trader' ? 'action.trade' : 'action.talk', { name }),
        run: () => { face(); this.open(this.tree(n.id)); },
      });
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
            // somewhere to stand: never out into the lake
            for (let k = 0; k < 8; k++) {
              const a = Math.random() * Math.PI * 2, r = Math.random() * n.roam;
              n.target.set(n.home.x + Math.cos(a) * r, 0, n.home.z + Math.sin(a) * r);
              if (this.world.terrain.height(n.target.x, n.target.z) > DRY) break;
              n.target.set(n.pos.x, 0, n.pos.z);
            }
            n.wait = 3 + Math.random() * 6;
          }
        } else if (n.wait > 5.5) n.speed = 0;
        else {
          n.speed += (1.5 - n.speed) * (1 - Math.exp(-dt * 4));
          const yaw = Math.atan2(n.target.x - n.pos.x, n.target.z - n.pos.z);
          n.yaw += Math.atan2(Math.sin(yaw - n.yaw), Math.cos(yaw - n.yaw)) * (1 - Math.exp(-dt * 6));
          const nx = n.pos.x + Math.sin(n.yaw) * n.speed * dt, nz = n.pos.z + Math.cos(n.yaw) * n.speed * dt;
          if (this.world.terrain.height(nx, nz) > DRY) { n.pos.x = nx; n.pos.z = nz; } else { n.target.set(n.pos.x, 0, n.pos.z); n.speed = 0; }
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
