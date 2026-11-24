import * as THREE from 'three';
import { t } from '../i18n';
import { audio } from '../core/audio';
import type { SaveData } from '../core/save';
import type { UI } from '../ui/ui';
import type { Combat } from '../combat/combat';
import type { EncounterId, Outcome } from '../combat/sim/encounters';
import type { Action } from './story';

/**
 * The fights the levels of "The First 24 Hours" call through the normal game (docs/COMBAT_API.md), so a player meets
 * them by playing, not through a menu or the address:
 * - level 7, the first night: the night at the fire (`night.defence`) instead of the older scripted lunge. The story
 *   doc (1.9) has the night as a choice of hide, brace or run; until that choice is in the game the level is the brace.
 * - level 8, the morning after: breakfast first, by spear fishing in the shallows (`fish.spear`) or the first hunt in
 *   the meadow (`hunt.first`); either one opens the way to the ridge, and the other stays open until the beacon.
 * Every fight is played with what the player has made so far (the save's own weapons and bag). A loss is never the end:
 * the fight offers to try again from its start, easier if wanted (combat.ts), and a save made in the middle of one
 * comes back at its start.
 */
export class Fights {
  constructor(
    private getSave: () => SaveData,
    private ui: UI,
    private combat: () => Combat | null,
    private playing: () => boolean,
  ) {}

  private get s() { return this.getSave(); }
  private f(k: string) { return !!this.s.flags[k]; }
  /** The two breakfast fights, and where they are. */
  private sites(): { id: EncounterId; pos: THREE.Vector3; label: string; done: string }[] {
    const cb = this.combat();
    if (!cb) return [];
    return (['fish.spear', 'hunt.first'] as EncounterId[]).map((id) => {
      const q = cb.siteOf(id);
      return { id, pos: new THREE.Vector3(q.x, cb.groundAt(q.x, q.z), q.z), label: t(id === 'fish.spear' ? 'cb.story.fish' : 'cb.story.hunt'), done: `cb.did.${id}` };
    });
  }

  /** The morning's food holds back the ridge (level 8) until the player has eaten. */
  blocks(n: number) { return n === 8 && !this.f('cb.fed') && !!this.combat(); }
  progress(n: number) { return n === 8 ? t('cb.story.breakfast') : null; }
  marker(n: number) {
    if (n !== 8) return null;
    const list = this.sites(), me = this.combat()?.playerPos;
    if (!list.length || !me) return null;
    return list.reduce((a, b) => (a.pos.distanceTo(me) <= b.pos.distanceTo(me) ? a : b)).pos;
  }

  actions(): Action[] {
    const s = this.s;
    if (s.level < 8 || s.level > 10 || !s.flags.spear || this.combat()?.encounter) return [];
    return this.sites().filter((q) => !this.f(q.done)).map((q) => ({ id: q.id, pos: q.pos, radius: 4.5, label: q.label, run: () => { void this.go(q.id); } }));
  }

  private async go(id: EncounterId) {
    const cb = this.combat();
    if (!cb || cb.encounter || !this.playing()) return;
    const o = await cb.startEncounter(id, { story: this.story() });
    this.keep(o);
    const s = this.s, inv = s.inventory;
    // what was caught is cooked at the fire and eaten (it is not carried: the bag has no names for raw meat or fish)
    const food = (inv.fish ?? 0) + (inv.meat ?? 0);
    delete inv.fish; delete inv.meat;
    s.flags[`cb.did.${id}`] = true;
    if (food > 0) {
      s.stats.hunger = Math.min(100, s.stats.hunger + 22 * food);
      s.stats.health = Math.min(100, s.stats.health + 6 * food);
      audio.chime();
      this.ui.toast(t(id === 'fish.spear' ? 'cb.story.ateFish' : 'cb.story.ateMeat'));
    } else this.ui.toast(t('cb.story.roots'));
    // nothing caught still ends the morning's search: roots and grubs (a fight must never lock the story)
    if (!s.flags['cb.fed']) { s.flags['cb.fed'] = true; if (food <= 0) s.stats.hunger = Math.min(100, s.stats.hunger + 15); }
  }

  /** What the story knows that changes a fight (docs/COMBAT_API.md). */
  private story() {
    const s = this.s;
    return { poisoned: !!s.flags.poisoned, cubKilled: !!s.flags['cub.killed'], fireHigh: !!s.flags['c1.bigFire'] || !!s.flags['fire.high'], hurt: (s.stats.health ?? 100) < 35 };
  }
  /** The outcome's facts kept on the save, as the story reads them (`cb.night.held`, `cb.hunt.kill`...). */
  private keep(o: Outcome) {
    for (const [k, v] of Object.entries(o.flags)) if (v) this.s.flags[`cb.${k}`] = true;
    if (o.flags.scarred) this.s.flags.scarred = true;
  }

  /** Level 7: the first night is the night at the fire. `done(held)` is the story's end of the night. */
  night(done: (held: boolean) => void): boolean {
    const cb = this.combat(), s = this.s;
    if (!cb || cb.encounter || !this.playing()) return false;
    // the day's gathering stacked by the fire: enough for the fire, a line of stakes and a snare (the set piece uses
    // the real bag, and a player who carried everything into the spear would otherwise meet the night with nothing)
    const inv = s.inventory;
    for (const [k, n] of Object.entries({ branch: 8, vine: 2, stone: 4, fruit: 1 })) inv[k] = Math.max(inv[k] ?? 0, n);
    this.ui.toast(t('cb.story.night'));
    void cb.startEncounter('night.defence', { story: this.story() }).then((o) => {
      this.keep(o);
      // the night is over: the last dark before dawn, so sleeping takes him to the morning of day two
      s.timeOfDay = 5.2;
      done(o.result !== 'lost');
      this.ui.toast(t(o.result === 'lost' ? 'cb.story.nightLost' : 'cb.story.nightHeld'));
    });
    return true;
  }
}
