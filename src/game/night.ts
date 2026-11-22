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

  private sitAtFire() {
    const camp = this.world.layout!.camp as THREE.Vector3, p = this.player;
    const d = new THREE.Vector3(p.pos.x - camp.x, 0, p.pos.z - camp.z); if (d.lengthSq() < 0.01) d.set(0, 0, 1);
    const at = camp.clone().add(d.setLength(1.4)); at.y = this.world.terrain.height(at.x, at.z);
    const facing = Math.atan2(d.x, d.z);
    p.pos.copy(at); p.vel.set(0, 0, 0); p.facing = facing;
    p.model.root.position.copy(at); p.model.root.rotation.y = facing + Math.PI; p.model.root.updateMatrixWorld(true);
    this.z.setKneel(true);
    return camp;
  }

  /** The spear, at the fire (level 6). `made` runs the game's own spear (flags, the prop at the camp). */
  spear(made: () => void) {
    const z = this.z;
    let camp = new THREE.Vector3();
    const scrape = (sec: number) => {
      const f = this.fwd(), t0 = performance.now();
      const step = () => {
        const k = (performance.now() - t0) / 1000; if (k > sec) return;
        const c = new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(f, 0.35).add(new THREE.Vector3(0, -0.4, 0));
        z.setHold({ L: { at: c.clone(), fingers: f.clone(), palm: new THREE.Vector3(0, 1, 0), radius: 0.015 }, R: { at: c.clone().addScaledVector(f, 0.12 + 0.05 * Math.sin(k * 9)).add(new THREE.Vector3(0, 0.03, 0)), fingers: f.clone().negate(), palm: new THREE.Vector3(0, -1, 0) } });
        if (Math.random() < 0.06) audio.sample('wood', 0.15, { rate: 2.2 });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const cook = () => z.setHold({ R: { at: camp.clone().add(new THREE.Vector3(0, 0.25, 0)), fingers: camp.clone().sub(this.player.pos).setY(0).normalize(), palm: new THREE.Vector3(0, -1, 0), radius: 0.015 } });
    this.playScene([
      { hold: 2.2, shot: () => cover.mid(z, 0.8, 2.3), run: () => { camp = this.sitAtFire(); z.setProp('flake'); z.setLimbs({ bend: 0.35 }); this.ui.memory('e1.sp.drax', 9); scrape(2.2); } },
      { hold: 2.0, shot: () => cover.close(z, 0.5, 1.0, 0.15), run: () => { scrape(2.0); z.setLookTarget(new THREE.Vector3().setFromMatrixPosition(z.head.matrixWorld).addScaledVector(this.fwd(), 0.5).add(new THREE.Vector3(0, -0.45, 0))); } },
      { hold: 1.6, shot: () => cover.mid(z, -0.6, 2.0), run: () => { z.setProp(null); cook(); z.setLookTarget(camp.clone().add(new THREE.Vector3(0, 0.2, 0))); audio.sample('amb_fire', 0.2); } },
    ], () => this.turn(made, camp));
  }

  private async turn(made: () => void, camp: THREE.Vector3) {
    const z = this.z, q = (window as unknown as { __e1spear?: boolean[] }).__e1spear;
    this.ui.toast(t('e1.sp.hint'));
    let ok: boolean;
    if (q && q.length) { ok = q.shift()!; await new Promise((r) => setTimeout(r, 2000)); }
    else { const r = await this.tension({ kind: 'steady', seconds: 4 }); ok = !r || r.passed || this.burnt; }
    if (!ok) {
      // held in the flame: the point chars; he tests it on the ground and it snaps
      this.burnt = true;
      this.playScene([
        { hold: 1.5, shot: () => cover.mid(z, 0.6, 1.8), run: () => { z.setHold({ R: { at: this.player.pos.clone().addScaledVector(this.fwd(), 0.6).add(new THREE.Vector3(0, 0.05, 0)), fingers: new THREE.Vector3(0, -1, 0), palm: this.fwd() } }); this.after(0.6, () => audio.sample('wood', 0.5, { rate: 1.4 })); } },
        { key: 'e1.sp.burn', who: 'scientist', shot: () => cover.close(z, 0.4, 0.95), run: () => { z.setHold(null); z.setFace({ frown: 0.4 }); }, after: 0.3 },
      ], () => { z.setFace(null); this.turn(made, camp); });
      return;
    }
    this.playScene([
      { hold: 1.8, shot: () => cover.mid(z, 0.7, 2.0), run: () => { z.setHold(null); made(); z.setLookTarget(null); audio.chime(); } },
    ], () => {
      this.s.flags['inv.fireSpear'] = true;
      this.ui.toast(t('e1.learn.spear'));
      z.setLimbs(null); z.setKneel(false);
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
      ], () => { z.setFace(null); done(!scarred); }));
    });
  }
}
