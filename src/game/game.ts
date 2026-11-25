import * as THREE from 'three';
import type { TaskKind } from '../characters/character';
import type { Away } from './away/away';
import { ROSTER } from './away/roster';
import type { CrewId } from '../characters/character';
import { t, onLangChange } from '../i18n';
import { clamp, smoothstep, lerp, easeInOut } from '../core/noise';
import { audio } from '../core/audio';
import { SaveData, writeSave } from '../core/save';
import { Fights } from './fights';
import type { World } from '../world/world';
import { LAKE } from '../world/terrain';
import { landWay } from './landway';
import { PICKABLE, Item } from '../world/props';
import { Story, Action, LAST_LEVEL } from './story';
import { Craft } from './tech/craft';
import { Dialogue, DlgTree } from './dialogue';
import type { TechNode } from './tech/data';
import { CH2_LAST, TECH_BY_ID } from './tech/data';
import { Episode2 } from './episode2';
import { Episode3 } from './episode3';
import { recordDiscovery } from './tech/tech';
import { showDiscovery } from '../ui/science';
import type { Player } from './player';
import type { Input } from './input';
import { UI, PLAYABLE_LEVELS } from '../ui/ui';
import { Tutorial } from './tutorial';
import { Waking } from './waking';
import { Stones } from './knap';
import { FireDrill } from './drill';
import { LeanTo } from './lean';
import { FirstNight } from './night';
import { Arrival } from './arrival';
import { Injuries } from './injury';
import { Cutscene, Beat, SceneBranch } from '../cinematic/cutscene';
import { voice } from '../core/voice';
import type { Combat } from '../combat/combat';
import { apply, collectPayoffs, DECISIONS, LINE_RULES, QTES, record, resolveLine, test } from './branch';

/** Line of sight for cutscene cameras. */
const SIGHT = new THREE.Raycaster();
const WAKE_UP = new THREE.Vector3(0, 0.22, 0);

type Mode = 'wake' | 'play' | 'dead' | 'scene' | 'craft' | 'talk' | 'away';

/** Survival rules, the First-24-Hours objective chain and the wake-up sequence. */
export class Game {
  private sinceLevel = 0;
  private swimWarned = false;
  /** What a crew member's work on their own ground does for you down here: their role, across space. */
  private favour(id: CrewId) {
    const s = this.save, f = (s.favours ??= {});
    if (id === 'explorer') {
      // from orbit she can see what you can't: the nearest things worth picking up
      const p = this.player.pos;
      f.pins = this.world.items.items.filter((it) => it.active && (it.gate ?? 0) <= s.level).sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p)).slice(0, 5).map((it) => [it.pos.x, it.pos.z]);
    } else if (id === 'builder') f.sure = true;
    else if (id === 'medic') { s.stats.health = 100; s.stats.stamina = 100; this.combat?.treat(); }
    else if (id === 'strong') f.tirelessDay = s.day;
    this.ui.toast(t(`away.fav.${id}`));
  }

  /** Someone whose moment has come and whose story hasn't been told. Skyvra's is in Level 9 itself. */
  get revealDue() { const s = this.save; return s.replay ? undefined : ROSTER.find((r) => r.location && r.id !== 'explorer' && s.level >= r.unlock && !s.flags[`played.${r.id}`]); }

  /** Hand control to a crew member on their own stage; Verdaxis waits. */
  goAway(id: CrewId, location: string, done?: () => void) {
    if (!this.away) return;
    this.mode = 'away';
    this.away.level = this.save.level;
    const first = !this.save.flags[`played.${id}`];
    const jobKey = `job.${id}.${this.save.level}`, job = !first && !this.save.flags[jobKey] ? this.save.level : 0;
    this.away.wounds = (this.save.wounds ??= {});
    this.injuries?.quiet();
    this.away.enter(id, location, () => {
      this.mode = 'play';
      this.save.flags[`played.${id}`] = true;
      if (first) this.ui.toast(t('away.switchHint'));
      else if (job) { this.save.flags[jobKey] = true; this.favour(id); }
      this.persist();
      done?.();
    }, job, first && !job);
  }

  private mirTurn = 1;
  /** The playable prologue: Zenvora before the trip. Each list item and each person speaks when you get there. */
  prologue(save: SaveData, done: () => void) {
    if (!this.away) return;
    this.save = save;
    this.mode = 'away';
    this.away.onTask = (id, go) => {
      const who = id.startsWith('talk.') ? id.slice(5) : null;
      const crew = who && ['strong', 'medic', 'explorer', 'builder', 'social'].includes(who);
      // Mir has two things to say, in turn
      const line = who === 'mir' ? `city.npc.mir${(this.mirTurn = (this.mirTurn + 1) % 2) ? '' : '2'}` : `city.npc.${who}`;
      if (who) {
        const key = crew ? `city.friend.${who}` : line;
        this.ui.say(key, crew ? `crew.${who}.name` : `city.who.${who}`, 5);
        this.away!.talk(who, voice.duration(key) ?? 3.5);
      }
      else this.ui.say(`city.done.${id}`, 'crew.scientist.name', 4.5);
      go();
    };
    this.away.keepBlack = true;
    this.away.enter('scientist', 'city', () => { this.away!.onTask = null; this.away!.keepBlack = false; save.flags.prologueDone = true; done(); });
  }

  mode: Mode = 'wake';
  save!: SaveData;
  /** Fights, the animals of Verdaxis and the set pieces (main.ts makes it; src/combat). */
  combat: Combat | null = null;
  private wakeT = 0;
  private wakeCues: { t: number; fn: () => void; done?: boolean }[] = [];
  private saveClock = 0;
  private payoffClock = 0;
  private hudClock = 0;
  private interactTarget: { kind: 'water'; src?: 'stream' | 'pool' } | { kind: 'item'; item: Item } | { kind: 'action'; action: Action } | { kind: 'strike' } | null = null;
  story: Story;
  /** The fights the levels call: the first night, the morning's food. */
  fights: Fights;
  /** main.ts: the game is in plain play (no flashback, Vault, film, pause or panel over it). */
  canFight: () => boolean = () => true;
  private cues: { at: number; fn: () => void }[] = [];
  private clock = 0;
  private lastThirstWarn = 0;
  private lastHungerWarn = 0;
  private stepWarned = false;
  private camShake = 0;
  private tmpV = new THREE.Vector3();

  tutorial: Tutorial;
  /** Playing another crew member on their own stage (main.ts makes it). */
  away: Away | null = null;
  craft = new Craft();
  dialogue = new Dialogue();
  private fails = 0;
  /** Hook for between-level narrator scenes (main.ts). Return true to take over. */
  onLevelComplete: ((n: number) => void) | null = null;

  constructor(private world: World, private player: Player, private input: Input, private ui: UI, highlightTouch: (id: string | null) => void = () => {}, hint: (text: string | null) => void = () => {}) {
    world.onCreatureStep = (p) => this.onCreatureStep(p);
    this.tutorial = new Tutorial(input, player, world, () => this.save, highlightTouch, hint);
    this.tutorial.onFinish = () => {
      this.ui.toast(t('tut.complete'));
      this.persist();
      if (this.pendingIntro) { this.pendingIntro = false; this.announceLevel1(); }
    };
    onLangChange(() => this.tutorial.refresh());
    this.story = new Story(world, player, ui, () => this.save, (sec, fn) => this.after(sec, fn), (amount) => this.hurt(amount), (beats, then) => this.playScene(beats, then));
    this.waking = new Waking(world, player, ui, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn));
    this.stones = new Stones(world, player, ui, this.waking.stream, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn), (spec) => this.combat?.tension(spec) ?? null);
    this.drill = new FireDrill(world, player, ui, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn), (spec) => this.combat?.tension(spec) ?? null);
    this.lean = new LeanTo(world, player, ui, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn), (spec) => this.combat?.tension(spec) ?? null);
    this.night = new FirstNight(world, player, ui, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn), (spec) => this.combat?.tension(spec) ?? null, () => this.combat);
    this.dialogue.onLine = (who, sec) => this.story.npcs.speak(who, sec);
    this.fights = new Fights(() => this.save, ui, () => this.combat ?? null, () => this.mode === 'play' && !this.story.busy && this.canFight());
    this.story.fights = this.fights;
    // the first night is FirstNight's (night.ts), the night at the fire; main's fights.ts night stands in only where
    // life's work is not on the branch
    this.story.hooks = {
      drill: (lit) => { if (this.debugActing) return false; this.drill.start(lit); return true; },
      spear: (made) => { if (this.debugActing) return false; this.night.spear(made); return true; },
      lean: (built) => { if (this.debugActing) return false; this.lean.start(built); return true; },
      night: (done) => { if (this.mode !== 'play') return false; this.night.night(done); return true; },
      away: (id, loc, task, done) => { if (this.away) this.away.onTask = task; this.goAway(id, loc, done); }, quick: (id, done) => this.quick(id, done), craft: (n) => this.startCraft(n), talk: (tree) => this.startTalk(tree), free: () => this.mode === 'play' };
    this.craft.onFail = () => {
      const c = (this.save.crafts ??= { failed: 0 });
      c.failed++;
      const d = this.craft.debug();
      // Episode Two: his own line says what went wrong (the real failure of that step); elsewhere MegaZroN mocks
      if (d && (this.ep2.craftFailed(d.id, d.step) || this.ep3.craftFailed(d.id, d.step, { v: d.v, band: d.band as [number, number] }))) return;
      this.ui.say(`fail.${(this.fails++ % 4) + 1}`, 'mz.name', 3.5);
    };
    this.ep2 = new Episode2(world, player, ui, this.story.npcs, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn),
      (spec) => this.combat?.tension(spec) ?? null, () => this.combat, () => this.mode === 'play' && this.canFight() && !this.combat?.encounter && !this.combat?.threatened,
      (id, then) => this.discoverNow(id, then));
    this.story.ch2.ep2 = this.ep2;
    this.ep3 = new Episode3(world, player, ui, this.story.npcs, () => this.save, (beats, then) => this.playScene(beats, then), (sec, fn) => this.after(sec, fn),
      (spec) => this.combat?.tension(spec) ?? null, () => this.combat, () => this.mode === 'play' && this.canFight() && !this.combat?.encounter && !this.combat?.threatened,
      (id, then) => this.discoverNow(id, then));
    this.story.ch2.ep3 = this.ep3;
    // level 19 is Draxum's, on his own stage: the story's away hook, the stage, and the decision panel
    this.ep3.hooks = this.story.hooks; this.ep3.awayStage = () => this.away?.stage ?? null; this.ep3.askFn = (id, done) => this.ask(id, done);
    this.ep3.waking = () => this.waking;
    // the dead stop talking, wherever the line comes from
    ui.sayFilter = (key, who) => {
      const id = /^crew\.(\w+)\.name$/.exec(who ?? '')?.[1];
      if (!id || !this.save) return { key, who };
      const line = resolveLine(this.save, { ...LINE_RULES[key], key, who: id });
      return line?.key ? { key: line.key, who: line.who ? `crew.${line.who}.name` : undefined } : null;
    };
    onLangChange(() => { if (this.save) { this.lastObjKey = ''; this.refreshObjective(); this.ui.setInventory(this.save.inventory, this.story.tools()); } });
  }

  scene: Cutscene | null = null;
  /** Run a staged conversation in the world; the camera returns afterwards. */
  playScene(beats: Beat[], then?: () => void) {
    if (this.mode !== 'play') { then?.(); return; }
    this.mode = 'scene';
    this.input.enabled = false;
    this.input.releasePointer();
    this.ui.setPrompt(null);
    this.ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    document.getElementById('hud')!.classList.add('in-scene');
    this.story.scenePose = () => this.scene?.poses.explorer ?? 'stand';
    this.scene = new Cutscene(beats, {
      branch: this.sceneBranch,
      camera: this.player.camera,
      scene: this.world.scene,
      actors: { scientist: this.player.model, explorer: this.world.explorer, ...this.ep2?.actors, ...this.ep3?.actors },
      subtitle: (k, sp) => this.ui.subtitle(k, sp),
      cameraOk: (p) => !this.world.forest.blocks(p.x, p.z, 0.5) && p.y > this.world.terrain.height(p.x, p.z) + 0.35,
      lineBlocked: (from, to) => {
        const d = to.clone().sub(from), len = d.length();
        SIGHT.set(from, d.divideScalar(len)); SIGHT.far = len - 0.3; SIGHT.camera = this.player.camera; SIGHT.params.Points.threshold = 0;
        const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
        return SIGHT.intersectObject(this.world.camp.root, true).some((x) => shown(x.object) && !((x.object as THREE.Mesh).material as THREE.Material).transparent);
      },
      onDone: () => {
        this.scene = null;
        this.mode = 'play';
        this.input.enabled = true;
        this.ui.show('cine', false);
        document.getElementById('hud')!.classList.remove('in-scene');
        this.story.scenePose = null;
        this.player.pose = 'idle';
        this.player.snapCamera();
        then?.();
      },
    });
  }

  /** Freeze the player for a panel that takes the input (minigame, conversation). */
  private enterPanel(mode: 'craft' | 'talk') {
    this.mode = mode;
    document.body.classList.add('in-panel');
    this.input.enabled = false;
    this.input.resetTouch();
    this.input.releasePointer();
    this.ui.setPrompt(null);
    this.player.pose = 'idle';
    // at the workbench the hands keep working for as long as the craft panel is open
    if (mode === 'craft') { const p = this.player, f = this.tmpV.set(-Math.sin(p.facing), 0, -Math.cos(p.facing)); p.act('fix', new THREE.Vector3(p.pos.x + f.x * 0.5, p.pos.y + 0.75, p.pos.z + f.z * 0.5), 600); }
  }

  private leavePanel() {
    if (this.mode === 'craft') this.player.endAct();
    this.mode = 'play';
    document.body.classList.remove('in-panel');
    this.input.enabled = true;
    this.input.pressed.clear(); // the key that closed the panel must not press E in the world
    this.lastObjKey = '';
    this.refreshObjective();
  }

  startTalk(tree: DlgTree) {
    if (this.mode !== 'play') return;
    this.enterPanel('talk');
    this.dialogue.start(tree, () => this.leavePanel());
  }

  startCraft(n: TechNode) {
    if (this.mode !== 'play') return;
    // Episode Two: the work in his hands first, then the panel
    if (this.ep2.beforeCraft(n, () => this.openCraft(n)) || this.ep3.beforeCraft(n, () => this.openCraft(n))) return;
    this.openCraft(n);
  }
  private openCraft(n: TechNode) {
    if (this.mode !== 'play') return;
    this.enterPanel('craft');
    // Bolzar's favour covers one build, start to finish
    this.craft.sure = !!this.save.favours?.sure;
    this.craft.start(n, !!this.save.flags[`tip-${n.id}`], (ok) => { if (ok && this.craft.sure && this.save.favours) { this.save.favours.sure = false; this.craft.sure = false; } this.endCraft(n, ok); });
  }

  /** Materials are only spent on success: a ruined run costs dignity, not progress. */
  private endCraft(n: TechNode, ok: boolean) {
    if (!ok) { this.leavePanel(); return; }
    const s = this.save;
    for (const k in n.ingredients) s.inventory[k] = Math.max(0, (s.inventory[k] ?? 0) - n.ingredients[k]);
    for (const k in n.yields) s.inventory[k] = (s.inventory[k] ?? 0) + n.yields[k];
    this.ui.setInventory(s.inventory, this.story.tools());
    // Episode Two's pottery: the pots are made, and found good only when they come out of the fire (episode2.ts dawn)
    if (this.ep2.owns(s.level) && n.id === 'pottery') { this.persist(); this.leavePanel(); this.ep2.crafted(n, () => {}); return; }
    const first = recordDiscovery(s, n.id);
    this.persist();
    const ep = this.ep2.owns(s.level) ? this.ep2 : this.ep3.owns(s.level) ? this.ep3 : null;
    if (first && ep) { this.leavePanel(); if (ep.crafted(n, () => this.discoverCard(n))) return; this.discoverCard(n); return; }
    if (!first) { this.ui.toast(t('msg.madeMore', { name: t(`tech.${n.id}`) })); this.leavePanel(); return; }
    showDiscovery(n, () => { this.leavePanel(); this.story.ch2.afterDiscovery(n); });
  }

  /** A save from the old design's levels 15 to 21 (charcoal to acids) starts Episode Three at level 15: Episode Two is
   *  counted done (its last beats' flags), what was made stays in the bag and the codex (DECISIONS E3-14). */
  static migrateEp3(s: SaveData) {
    if (s.level < 15 || s.flags['e3.l15.intro'] || s.flags['e3.migrated']) return;
    s.flags['e3.migrated'] = true;
    if (s.level > 15 || !(s.flags['e2.done'])) { s.flags['e2.done'] = true; s.flags['e2.nightDone'] = true; s.flags['seen-ep2'] = true; }
    s.level = 15;
    s.completed = (s.completed ?? []).filter((n) => n < 15);
    for (let n = 1; n < 15; n++) if (!s.completed.includes(n)) s.completed.push(n);
  }
  /** Episode Two (levels 11 to 14). */
  ep2!: Episode2;
  /** Episode Three (levels 15 to 21). */
  ep3!: Episode3;
  /** The discovery card outside the craft panel (Episode Two shows it after the scene that makes the thing). */
  private discoverCard(n: TechNode, then?: () => void) {
    if (this.mode !== 'play') { this.after(0.5, () => this.discoverCard(n, then)); return; }
    this.enterPanel('talk');
    showDiscovery(n, () => { this.leavePanel(); then?.(); this.story.ch2.afterDiscovery(n); });
  }
  private discoverNow(id: string, then: () => void) {
    const n = TECH_BY_ID[id];
    if (!n) { then(); return; }
    recordDiscovery(this.save, id);
    this.persist();
    this.discoverCard(n, then);
  }

  /** Accessibility setting: choices wait for the player. */
  timersOff = false;

  private sceneBranch: SceneBranch = {
    test: (c) => test(this.save, c),
    line: (b) => resolveLine(this.save, b),
    apply: (e) => apply(this.save, e),
    answered: (id) => this.save.branch.log.some((e) => e.id === id),
    ask: (id, done) => this.ask(id, done),
    quick: (id, done) => this.quick(id, done),
  };

  /**
   * Opens a decision. The panel is saved as open and the answer is saved the
   * moment it lands, so neither a reload nor a crash takes a choice back.
   */
  private ask(id: string, done: () => void) {
    const s = this.save, d = DECISIONS[id];
    if (!d) { s.branch.open = null; done(); return; }
    const options = d.options.filter((o) => test(s, o.requires));
    s.branch.open = { kind: 'decision', id };
    this.persist();
    this.ui.subtitle(null);
    let expired = false;
    const tree: DlgTree = {
      start: 'q',
      nodes: {
        q: {
          who: d.who ? `crew.${d.who}.name` : '', say: d.prompt ?? '', quiet: true,
          choices: options.map((o) => ({
            label: o.label,
            run: () => { record(s, id, 'decision', o.id, expired); apply(s, o.effects); this.settle(); },
          })),
        },
      },
    };
    this.dialogue.start(tree, done, {
      seconds: d.seconds && !this.timersOff ? d.seconds : null,
      fallback: Math.max(0, options.findIndex((o) => o.id === d.fallback)),
      expired: () => { expired = true; },
    });
  }

  private quick(id: string, done: () => void) {
    const s = this.save, q = QTES[id];
    if (!q) { s.branch.open = null; done(); return; }
    s.branch.open = { kind: 'qte', id };
    this.persist();
    this.ui.subtitle(null);
    this.ui.choice.quick({
      label: t(q.label),
      seconds: this.timersOff ? null : q.seconds,
      onDone: (passed) => {
        record(s, id, 'qte', passed ? 'pass' : 'fail');
        apply(s, passed ? q.pass : q.fail);
        this.settle();
        done();
      },
    });
  }

  /** The answer is in: close the record and write it to disk now. */
  private settle() {
    this.save.branch.open = null;
    this.ui.choice.note();
    this.persist();
    this.ui.setInventory(this.save.inventory, this.story.tools());
  }

  /** Delivers consequences whose level has arrived. */
  private deliverPayoffs() {
    const due = collectPayoffs(this.save);
    if (!due.length) return;
    this.persist();
    this.ui.setInventory(this.save.inventory, this.story.tools());
    for (const p of due) {
      this.after(p.delay ?? 0, () => {
        if (p.say) this.ui.say(p.say.key, p.say.who, 5);
        if (p.toast) this.ui.toast(t(p.toast));
      });
    }
  }

  /** Schedule fn after `sec` seconds of game time (pauses with the game). */
  after(sec: number, fn: () => void) {
    this.cues.push({ at: this.clock + sec, fn });
  }

  private runCues(dt: number) {
    this.clock += dt;
    if (!this.cues.length) return;
    const due = this.cues.filter((c) => c.at <= this.clock);
    if (!due.length) return;
    this.cues = this.cues.filter((c) => c.at > this.clock);
    due.sort((a, b) => a.at - b.at).forEach((c) => c.fn());
  }

  private hurt(amount: number) {
    const st = this.save.stats;
    st.health = clamp(st.health - amount, 0, 100);
    this.ui.damage();
    audio.hurt();
    audio.human(amount >= 10 ? 'yelp' : 'grunt');
    this.camShake = Math.max(this.camShake, 0.14);
  }

  /** Zenvik's own wounds from the fall (game/injury.ts), healing as the day goes. */
  injuries: Injuries | null = null;
  private wakeBody: Arrival | null = null;
  private sprintSore = 0;
  private heldLimbs: import('../characters/character').Limbs | null = null;

  start(save: SaveData, fresh: boolean) {
    this.save = save;
    Game.migrateEp3(save);
    this.injuries?.quiet();
    this.injuries = new Injuries('scientist', fresh ? undefined : save.wounds);
    this.cues = [];
    this.lastObjKey = '';
    this.syncItems();
    this.story.sync();
    this.combat?.attach(save);
    if (fresh) {
      this.player.spawn(0, 2, 0.35);
      this.mode = 'wake';
      this.wakeT = 0;
      this.buildWake();
      this.ui.show('hud', false);
    } else {
      this.player.spawn(save.pos[0], save.pos[2], save.yaw);
      this.mode = 'play';
      this.enterPlay(false);
      // the panel that was open when the game closed is still waiting
      const open = save.branch.open;
      // the first night's question belongs to the night (night.ts): the story starts the night again and it asks there
      if (open?.id === 'e1.night' && !save.flags.houndGone) save.flags['e1.night'] = false;
      else if (open) this.after(0.6, () => this.playScene([open.kind === 'decision' ? { choice: open.id } : { qte: open.id }]));
    }
    this.player.model.root.visible = true;
  }

  /** Show what exists at this point of the story and hasn't been picked up. */
  private syncItems() {
    const save = this.save;
    for (const it of this.world.items.items) {
      it.active = !save.collected.includes(it.id) && (it.gate ?? 0) <= save.level;
      it.obj.visible = it.active;
      it.examined = !!save.flags[`ex-${it.id}`];
    }
  }

  private enterPlay(announce: boolean, acted = false) {
    this.mode = 'play';
    this.finishWakeVisuals();
    this.input.enabled = true;
    this.ui.show('hud', true);
    this.ui.device(null);
    this.ui.setInventory(this.save.inventory, this.story.tools());
    this.refreshObjective();
    this.waking.startSound();
    if (announce) {
      // 1.1: he checks his body, then thirst, before anything is asked of the player
      this.waking.thirst(acted, () => {
        if (!this.save.flags.tutorialDone) {
          this.pendingIntro = true;
          this.tutorial.start();
        } else this.announceLevel1();
      });
    }
  }

  private pendingIntro = false;
  private announceLevel1() {
    this.ui.banner(t('hud.level', { n: 1 }), t('level.1.title'));
    this.after(2.5, () => this.ui.toast(t('level.1.hint')));
  }

  /** Replay the controls tutorial (settings). */
  startTutorial() {
    if (this.mode !== 'play') return;
    this.pendingIntro = false;
    this.tutorial.start();
  }

  /** main.ts tells us when a panel was opened (the tutorial waits for it). */
  notePanel(kind: string) { this.tutorial.notePanel(kind); }

  /** Episode One 1.1: the stream, the pool, thirst and the red fruit. */
  waking: Waking;
  /** Episode One 1.3: the cobbles on the stream bank, the good stone and the first flake. */
  stones: Stones;
  /** Episode One 1.6: fire by hand drill at the pit (level 4). */
  drill: FireDrill;
  /** Episode One 1.9: the fire-hardened spear and the first night through the combat set pieces. */
  night: FirstNight;
  /** Episode One 1.3: the lean-to and the throwing stick (level 5). */
  lean: LeanTo;
  /** True while a test presses the interact key through debugAct: the hand drill keeps the old strikes for it. */
  private debugActing = false;
  private streamHeard = true;
  private wakeRate = 1;
  private buildWake() {
    const ui = this.ui;
    // stretch the sequence so no line is cut off in any language
    const slots: [string, number][] = [['wake.line1', 4.4], ['wake.line2', 3.6], ['wake.line3', 3.4], ['wake.line4', 4.2], ['wake.line5', 3.8]];
    this.wakeRate = 1 / Math.max(1, ...slots.map(([k, s]) => ((voice.duration(k) ?? 0) + 0.3) / s));
    this.wakeCues = [
      // he came down at dusk and it is midday now: say so, on black, before his eyes open
      { t: 0.05, fn: () => ui.chapter(['wake.nextday'], true) },
      { t: 1.9, fn: () => ui.chapter(null) },
      { t: 2.0, fn: () => ui.fade('black', 0, 4) },
      { t: 2.4, fn: () => ui.say('wake.line1', 'crew.scientist.name', 3.4) },
      { t: 4.0, fn: () => { ui.device(['wake.device1', 'wake.device2', 'wake.device3']); audio.beep(); } },
      { t: 6.2, fn: () => ui.say('wake.line2', 'crew.scientist.name', 3.6) },
      // the device dies here, in his hand: the last thing on it is its own battery
      { t: 8.9, fn: () => { ui.device(['wake.device4']); audio.beep(); } },
      { t: 10.0, fn: () => { ui.device(null); ui.say('wake.line3', 'crew.scientist.name', 3.4); } },
      { t: 13.6, fn: () => { ui.say('wake.line4', 'crew.scientist.name', 3.6); audio.thud(); } },
      { t: 18.0, fn: () => ui.say('wake.line5', 'crew.scientist.name', 3.6) },
      { t: 18.4, fn: () => ui.chapter(['wake.chapter']) },
      { t: 22.0, fn: () => ui.chapter(null) },
      // through black, like the skip: entering play is never seen
      { t: 22.2, fn: () => this.skipWake(true) },
    ];
    // the body: out cold on its back, then finding its hurts and getting up (arrivals.ts, scientist); the camera stays
    // the wake's own
    this.wakeBody?.skip();
    this.wakeBody = new Arrival('scientist', { scene: this.world.scene, camera: new THREE.PerspectiveCamera(), body: this.player.model, ground: (x, z) => this.world.terrain.height(x, z), say: () => undefined }, () => undefined, undefined, { at: [this.player.pos.x, this.player.pos.z], yaw: this.player.yaw, camera: false });
    this.ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden'); // tap to skip on phones
    document.getElementById('cine-bars')!.classList.remove('hidden');
  }

  debugWakeSeek(t: number) {
    if (this.mode !== 'wake') return;
    for (const c of this.wakeCues) if (c.t < t && !c.done) { c.done = true; c.fn(); }
    this.wakeT = t;
  }

  skipScene() { if (this.ui.choice.open) this.ui.choice.press(); else this.scene?.skip(); }

  private wakeSkipped = false;
  /** natural: the wake played to its end (then 1.1's acted thirst scene follows; a skip goes straight to play). */
  skipWake(natural = false) {
    if (this.mode !== 'wake' || this.wakeSkipped) return;
    this.wakeSkipped = true;
    for (const c of this.wakeCues) if (!c.done) { c.done = true; }
    this.ui.device(null); this.ui.subtitle(null); this.ui.chapter(null);
    this.wakeBody?.skip(); this.wakeBody = null;
    // through black: whatever entering play costs happens where nobody can see it
    this.ui.fade('black', 1, 0.2);
    setTimeout(() => {
      this.finishWakeVisuals();
      this.enterPlay(true, natural);
      this.wakeSkipped = false;
      requestAnimationFrame(() => requestAnimationFrame(() => this.ui.fade('black', 0, 0.6)));
    }, 240);
  }

  private finishWakeVisuals() {
    this.ui.show('cine', false);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    this.player.model.root.rotation.x = 0;
    this.player.model.root.visible = true;
    this.player.snapCamera();
  }

  private updateWake(dt: number) {
    this.wakeT += dt;
    const w = this.wakeT;
    for (const c of this.wakeCues) if (!c.done && w >= c.t) { c.done = true; c.fn(); }
    if (this.mode !== 'wake') { this.finishWakeVisuals(); return; }
    // let the player rig compute its normal third-person pose, then blend
    this.player.skipAnimate = true;
    this.player.update(dt, this.input, false, 100, 1);
    this.player.skipAnimate = false;
    const cam = this.player.camera;
    const tpPos = cam.position.clone();
    const tpQuat = cam.quaternion.clone();
    // the body is posed by its arrival: on its back, the ribs, the brow, over onto its side, a try, a fall back, then up
    this.wakeBody?.update(dt);
    const sky = this.world.sky;
    // the eyes are where the head really is
    const head = this.player.model.head.getWorldPosition(new THREE.Vector3());
    if (head.y < this.player.pos.y - 0.5 || head.y > this.player.pos.y + 2.2) head.set(this.player.pos.x, this.player.pos.y + 0.25, this.player.pos.z);
    // "two worlds in the sky": the giant sits in the lower middle of the frame (the old aim, a third of the way to
    // the moon, far across the sky, left both at the edges or behind the pines)
    const lookSky = head.clone().addScaledVector(sky.giantDir.clone().add(WAKE_UP).normalize(), 50);
    const lookCreature = this.world.creature.position.clone();
    const lookA = lookSky.clone().lerp(lookCreature, smoothstep(11.5, 14.5, w));
    const scripted = new THREE.PerspectiveCamera();
    // a dazed head: it drifts and rolls a little, more at first
    const daze = 1 - smoothstep(4, 14, w);
    scripted.position.copy(head).add(new THREE.Vector3(Math.sin(w * 0.3) * 0.05, 0.08 + smoothstep(12, 16, w) * 0.6, 0));
    scripted.lookAt(lookA.clone().add(new THREE.Vector3(Math.sin(w * 0.53) * 2.5, Math.sin(w * 0.41 + 1) * 1.5, 0).multiplyScalar(daze)));
    scripted.rotateZ(Math.sin(w * 0.37) * 0.1 * daze);
    // from the moment he tries to get up we see him, not the sky: a low medium shot from his right, on his struggle,
    // then into the play camera as he stands
    const out = w >= 12.4;
    if (out) {
      const Y = this.player.yaw, pp = this.player.pos, r = new THREE.Vector3(Math.cos(Y), 0, -Math.sin(Y)), f = new THREE.Vector3(-Math.sin(Y), 0, -Math.cos(Y));
      scripted.position.copy(pp).addScaledVector(r, 2.3).addScaledVector(f, 0.4).add(new THREE.Vector3(Math.sin(w * 0.9) * 0.02, 0.75 + smoothstep(16, 19, w) * 0.5, 0));
      scripted.up.set(0, 1, 0);
      scripted.lookAt(pp.clone().addScaledVector(f, -0.25).add(new THREE.Vector3(0, 0.35 + smoothstep(16, 19, w) * 0.6, 0)));
    }
    const blend = easeInOut(smoothstep(17.5, 21, w));
    cam.position.lerpVectors(scripted.position, tpPos, blend);
    cam.quaternion.slerpQuaternions(scripted.quaternion, tpQuat, blend);
    this.player.model.root.visible = out || blend > 0.05;
  }

  update(dt: number, time: number) {
    const s = this.save;
    const st = s.stats;
    s.timeOfDay += dt / 50; // one in-game hour = 50 s
    // the first day does not run out on him: he wakes at midday and the light waits in the late afternoon until the
    // night level begins (an unscripted night before "Survive the First Night" made that one the second)
    if (s.day === 1 && s.level < 7 && s.timeOfDay > 18.6 && s.timeOfDay < 19.5) s.timeOfDay = 18.6;
    if (s.timeOfDay >= 24) { s.timeOfDay -= 24; s.day++; }
    if (Math.abs(s.timeOfDay - 19.2) < dt / 50 && !s.flags.nightMsg) { s.flags.nightMsg = true; this.ui.toast(t('msg.night')); }

    if (this.mode === 'wake') { this.updateWake(dt * this.wakeRate); return; }
    if (this.mode === 'dead') return;
    this.runCues(dt);
    // the stream is on Verdaxis: quiet while the game is on someone else's world
    if ((this.mode !== 'away') !== this.streamHeard) { this.streamHeard = this.mode !== 'away'; this.waking.setAudible(this.streamHeard); }
    if (this.mode === 'away') { this.away?.update(dt, time, !this.ui.modalOpen()); return; }
    this.ui.choice.update(dt);
    if (this.mode === 'scene') this.dialogue.update(dt);
    if (this.mode === 'craft' || this.mode === 'talk') {
      this.player.update(dt, this.input, false, 100, 1);
      this.story.update(dt, time);
      if (this.mode === 'craft') this.craft.update(dt);
      return;
    }
    if (this.mode === 'scene') {
      const sc = this.scene!;
      this.player.pose = sc.poses.scientist ?? 'stand';
      this.player.update(dt, this.input, false, 100, 1);
      this.story.update(dt, time);
      sc.update(dt);
      return;
    }

    const p = this.player;
    // a set piece has the whole frame: the survival clock and the story wait for it
    if (this.combat?.encounter) { this.combat.frame(dt, time); return; }
    if (this.away && this.away.quiet > 0) { this.away.quiet -= dt; this.input.endFrame(); }
    // whoever this level reveals: their own story, on their own ground, as soon as the moment is free
    // a level's own ending lands first: the Vault, the Ledger, then the next person's story
    this.sinceLevel += dt;
    const who = this.revealDue;
    if (who && this.sinceLevel > 15 && !this.story.busy && !this.ui.modalOpen()) { this.goAway(who.id, who.location!); return; }
    // the crash isn't forgotten by the next cutscene: the fall's wounds (game/injury.ts) heal by the hour; never slower
    // than the old day-one pace (0.45 on day one, 0.72 on day two)
    const inj = this.injuries, eff = inj?.effects();
    const hurt = Math.max(s.level <= 1 ? 0.45 : s.level === 2 ? 0.72 : 1, eff?.speed ?? 1);
    // he can run on cracked ribs: it costs him (the picture tightens, he grunts) and his breath
    // the fever (Episode Three, level 18): a slow walk, no run, and the breath goes quickly and comes back slowly
    const fev = this.ep3?.feverAmount ?? 0;
    p.hurt = eff || fev > 0 ? { speed: 1, jump: eff?.jump ?? 1, sprint: fev < 0.5 } : null;
    p.model.setLimp(s.level <= 1 || !!eff?.limp || fev > 0.5);
    if (inj && p.sprinting && inj.sev('ribsL') > 0.3 && (this.sprintSore -= dt) <= 0) { this.sprintSore = 2.6; audio.human('grunt', 0.35); st.stamina = Math.max(0, st.stamina - 6); }
    this.combat?.before(dt, time);
    // the hand on the ribs, unless a weapon or a fight has the arms (combat sets them first, every frame)
    { const cur = p.model.limbsNow; if (!cur || cur === this.heldLimbs) { const want = p.busy || p.combat ? null : eff?.limbs ?? null; p.model.setLimbs(want); this.heldLimbs = want; } }
    p.update(dt, this.input, true, st.stamina, (st.health < 25 ? 0.75 : 1) * hurt * (1 - 0.4 * fev));
    this.combat?.after(dt, time);
    if (this.camShake > 0) {
      p.camera.position.x += (Math.random() - 0.5) * this.camShake;
      p.camera.position.y += (Math.random() - 0.5) * this.camShake;
      this.camShake = Math.max(0, this.camShake - dt * 0.5);
    }

    // stats
    // the pool's water: a slow day, thirst comes back faster
    st.thirst = clamp(st.thirst - dt * 0.16 * (s.flags['sick.water'] && s.day === 1 ? 1.35 : 1), 0, 100);
    st.hunger = clamp(st.hunger - dt * 0.07, 0, 100);
    if (!p.swimming) this.swimWarned = false;
    if (p.swimming) {
      // swimming is work; Ulari lungs were made for cold water and make it half the work
      const lungs = (s.player?.lineage ?? 'ulari') === 'ulari' ? 0.5 : 1;
      st.stamina = clamp(st.stamina - dt * (p.sprinting ? 9 : 3.2) * lungs, 0, 100);
      if (st.stamina <= 0) { st.health -= dt * 3; if (!this.swimWarned) { this.swimWarned = true; this.ui.toast(t('msg.swimTired')); } }
      if (!s.flags.swamOnce) { s.flags.swamOnce = true; this.ui.toast(t('msg.swim')); }
    } else if (p.sprinting && s.favours?.tirelessDay !== s.day) st.stamina = clamp(st.stamina - dt * 16, 0, 100);
    else st.stamina = clamp(st.stamina + dt * (p.speedNow > 0.5 ? 8 : 14) * (this.combat?.regenMul() ?? 1) * (1 - 0.7 * fev), 0, 100 - 45 * fev - (s.flags['e3.feverScar'] ? 15 : 0));
    if (fev > 0 && p.speedNow > 0.5 && !p.swimming) st.stamina = clamp(st.stamina - dt * 6 * fev, 0, 100);
    if (st.thirst <= 0 || st.hunger <= 0) st.health -= dt * 0.6;
    else if (st.thirst > 40 && st.hunger > 40) st.health = Math.min(100, st.health + dt * 0.12);
    if (st.thirst < 15 && time - this.lastThirstWarn > 40) { this.lastThirstWarn = time; this.ui.toast(t('msg.thirsty')); }
    if (st.hunger < 15 && time - this.lastHungerWarn > 50) { this.lastHungerWarn = time; this.ui.toast(t('msg.hungry')); }
    if (p.blockedDeep && !s.flags.deepWarn) { s.flags.deepWarn = true; this.ui.toast(t('msg.deep')); setTimeout(() => (s.flags.deepWarn = false), 8000); }
    if (st.health <= 0) { this.die(); return; }
    inj?.update(dt, dt / 50, { resting: p.speedNow < 0.2, health: st.health });
    if (inj) inj.write((s.wounds ??= {}));

    this.story.update(dt, time);
    if (this.mode !== 'play') return; // the story can kill the player (predator)
    this.tutorial.update(dt);
    // (not while the controls tutorial is running: the listen beat would take the controls mid-lesson)
    // (nor during a fight or the arena)
    if (this.mode === 'play' && !this.tutorial.active && !this.pendingIntro && !this.combat?.engaged && !this.combat?.encounter && !this.combat?.threat) this.waking.update();
    if (this.mode !== 'play') return;
    this.findInteraction();
    if (this.interactTarget && this.input.act('interact')) this.interact();

    // 1.1 step 6: the first red fruit he walks up to is a decision
    if (s.level === 2 && !s.flags['e1.fruitSeen']) {
      for (const it of this.world.items.items) {
        if (it.type !== 'redFruit' || !it.active || it.pos.distanceTo(p.pos) > 3.2) continue;
        s.flags.medicHint = true;
        if (this.waking.fruit(it.pos, () => this.collect(it, 0.35))) return;
      }
    }
    // 1.3: at the cobbles on the stream bank (level 3) he finds a good stone and knaps a flake
    if (this.stones.near(p.pos)) { this.stones.start(); return; }
    // Medic memory when first approaching fruit
    // (in level 2 the red fruit's own scene teaches this, so the general hint waits for it)
    if (!s.flags.medicHint && (s.level !== 2 || s.flags['e1.fruitSeen'])) {
      for (const it of this.world.items.items) {
        if ((it.type === 'fruit' || it.type === 'redFruit') && it.active && it.pos.distanceTo(p.pos) < 9) {
          s.flags.medicHint = true;
          this.ui.memory('medic.hint', 11);
          audio.chime();
          break;
        }
      }
    }

    this.checkLevel();

    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 0.1;
      this.ui.setStats(st);
      this.ui.setClock(s.day, s.timeOfDay);
      const m = this.marker();
      this.ui.setMarker(m ? this.objectivePoint() : null, m ? m.dist : null);
    }
    this.payoffClock -= dt;
    if (this.payoffClock <= 0) { this.payoffClock = 1; this.deliverPayoffs(); }
    this.saveClock += dt;
    if (this.saveClock > 15) { this.saveClock = 0; this.persist(); }
  }

  /** Closest active item within pickup reach. */
  private nearestItem(): Item | null {
    const p = this.player.pos;
    let best: Item | null = null, bd = 2.3;
    for (const it of this.world.items.items) {
      if (!it.active) continue;
      const d = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
      if (d < bd && Math.abs(it.pos.y - p.y) < 2.2) { bd = d; best = it; }
    }
    return best;
  }

  private anchorV = new THREE.Vector3();
  private anchor(pos: THREE.Vector3, up: number) { return this.anchorV.copy(pos).setY(pos.y + up); }

  /** Eat from the wheel. Other items just show their description there. */
  useItem(key: string) {
    const s = this.save;
    if (key !== 'fruit' || (s.inventory.fruit ?? 0) <= 0) return;
    s.inventory.fruit--;
    s.stats.hunger = Math.min(100, s.stats.hunger + 30);
    this.ui.setInventory(s.inventory, this.story.tools());
    this.ui.toast(t('fruit.ateBlue'));
  }

  findInteraction() {
    const p = this.player;
    // a held work shot (the drill, the knapping, the spear, the lean-to): nothing to press but the moment itself
    if (p.workShot || (this.ep3?.isBusy && !this.combat?.encounter)) { this.interactTarget = null; this.ui.setPrompt(null); return; }
    // (Episode Three's scene, hold or timed beat: no talk menu or pickup over it; CI levels_smoke opened Oom-Sa's talk
    // during level 18's hold. Not Episode Two's busy: it stays set through some play, and mobile_smoke lost the trader's Use)
    if (this.story.houndEngaged() && !this.combat?.encounter) {
      this.interactTarget = { kind: 'strike' };
      this.ui.setPrompt(this.story.strikePrompt());
      return;
    }
    let act: Action | null = null, ad = Infinity;
    for (const a of this.story.actions()) {
      const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      if (d < a.radius && d < ad && Math.abs(a.pos.y - p.pos.y) < 3) { ad = d; act = a; }
    }
    // a station that is still missing materials yields to a pickable item in reach
    const reach = act ? this.nearestItem() : null;
    // ...and someone walking past doesn't stand between you and what's at your feet: an item within a step wins over a
    // person even when they stand closer (a roaming local who stops beside you on a frond used to take every press)
    const rd = reach ? Math.hypot(reach.pos.x - p.pos.x, reach.pos.z - p.pos.z) : Infinity;
    const nearItem = reach && (act!.missing?.length || ((act!.id.startsWith('npc-') || act!.id === 'skyvra') && (rd < ad || rd < 1.2))) ? reach : null;
    if (act && !nearItem) {
      this.interactTarget = { kind: 'action', action: act };
      this.ui.setPrompt(act.missing?.length ? t('prompt.need', { action: act.label, list: act.missing.join(', ') }) : act.label, this.anchor(act.pos, 1));
      return;
    }
    const best = this.nearestItem();
    if (best) {
      this.interactTarget = { kind: 'item', item: best };
      const name = t(`item.${best.type}`);
      const fruit = best.type === 'fruit' || best.type === 'redFruit';
      this.ui.setPrompt(fruit ? (best.examined ? t('prompt.eat', { item: name }) : t('prompt.examine', { item: name })) : t('prompt.pick', { item: name }), this.anchor(best.pos, 0.35));
      return;
    }
    const src = this.waking.source(p.pos);
    if (src) {
      this.interactTarget = { kind: 'water', src };
      this.ui.setPrompt(t('prompt.drink'), this.anchor(p.pos, 0.2));
      return;
    }
    const f = p.forward(this.tmpV);
    const T = this.world.terrain;
    const ahead = T.height(p.pos.x + f.x * 1.6, p.pos.z + f.z * 1.6);
    if (Math.min(ahead, T.height(p.pos.x, p.pos.z)) < -0.12) {
      this.interactTarget = { kind: 'water' };
      this.ui.setPrompt(t('prompt.drink'), this.anchor(this.tmpV.set(p.pos.x + f.x * 2, 0, p.pos.z + f.z * 2), 0.2));
      return;
    }
    this.interactTarget = null;
    this.ui.setPrompt(null);
  }

  /** Public so the touch prompt can trigger it. */
  interact() {
    const target = this.interactTarget;
    if (!target || this.mode !== 'play') return;
    const s = this.save, st = s.stats;
    if (target.kind === 'strike') { this.player.act('fix', this.world.layout?.camp ?? null, 1.2); this.story.strike(); return; }
    if (target.kind === 'action') {
      const a = target.action;
      if (a.missing?.length) { this.ui.toast(t('msg.need', { list: a.missing.join(', ') })); audio.uiClick(); return; }
      this.actAnim(a.id, a.pos);
      a.run();
      this.refreshObjective();
      return;
    }
    if (target.kind === 'water') {
      if (st.thirst > 97) { this.ui.toast(t('msg.drinkFull')); return; }
      if (target.src) {
        { const p = this.player, f = this.tmpV.set(-Math.sin(p.facing), 0, -Math.cos(p.facing)); this.player.act('drink', new THREE.Vector3(p.pos.x + f.x * 0.7, p.pos.y - 0.2, p.pos.z + f.z * 0.7), undefined, null); }
        if (!audio.sample('drink', 0.6, { delay: 0.5 })) audio.tone(300, 0.25, 'sine', 0.15, 0, 200);
        audio.sample('splash', 0.25, { rate: 1.4, delay: 0.2 });
        this.waking.drink(target.src);
        return;
      }
      st.thirst = clamp(st.thirst + 35, 0, 100);
      { const p = this.player, f = this.tmpV.set(-Math.sin(p.facing), 0, -Math.cos(p.facing)); this.player.act('drink', new THREE.Vector3(p.pos.x + f.x * 0.7, p.pos.y - 0.2, p.pos.z + f.z * 0.7), undefined, null); }
      if (!audio.sample('drink', 0.6, { delay: 0.5 })) audio.tone(300, 0.25, 'sine', 0.15, 0, 200);
      audio.sample('splash', 0.25, { rate: 1.4, delay: 0.2 });
      if (!s.flags.drank) { s.flags.drank = true; this.ui.toast(t('msg.drink')); this.ui.say('j.4', 'crew.scientist.name', 4); }
      return;
    }
    const it = target.item;
    if (PICKABLE.has(it.type)) {
      s.inventory[it.type] = (s.inventory[it.type] ?? 0) + 1;
      // the hand gets there first: the thing leaves the ground when the fingers close on it
      this.player.act('pickup', it.obj.getWorldPosition(new THREE.Vector3()));
      this.collect(it, 0.5);
      audio.sample(it.type === 'stone' || it.type === 'flint' ? 'stone' : it.type === 'branch' ? 'wood' : 'leather', 0.35, { delay: 0.35 });
      audio.pickup();
      this.ui.toast(t('msg.picked', { item: t(`item.${it.type}`) }));
      this.ui.setInventory(s.inventory, this.story.tools());
      this.refreshObjective();
      return;
    }
    if (!it.examined) {
      it.examined = true;
      this.player.act('use', it.obj.getWorldPosition(new THREE.Vector3()), 1.4);
      s.flags[`ex-${it.id}`] = true;
      this.ui.toast(t(it.type === 'fruit' ? 'fruit.examineBlue' : 'fruit.examineRed'));
      audio.uiClick();
      return;
    }
    this.player.act('eat');
    this.collect(it, 0.35);
    if (it.type === 'fruit') {
      st.hunger = clamp(st.hunger + 38, 0, 100);
      st.health = clamp(st.health + 5, 0, 100);
      s.flags.ateSafe = true;
      this.ui.toast(t('fruit.ateBlue'));
      if (!audio.sample('eat', 0.6, { delay: 0.6 })) audio.blip();
    } else {
      st.hunger = clamp(st.hunger + 6, 0, 100);
      st.health = clamp(st.health - 28, 0, 100);
      s.flags.ateRed = true;
      audio.sample('eat', 0.6, { delay: 0.6 });
      this.ui.toast(t('fruit.ateRed'));
      this.ui.say('j.5', 'crew.scientist.name', 3);
      this.ui.damage();
      audio.hurt();
      this.camShake = 0.12;
    }
  }

  /** What the hands do for an action (Story's actions by id). */
  private actAnim(id: string, at: THREE.Vector3) {
    // Story's action ids (story.ts, npcs.ts, chapter2.ts): building is two-handed work at the spot, the radio and the
    // tuner go to the ear or the screen, a person is talked to with the hands, a workbench is worked
    const kind: TaskKind | null = /^(pit|shelter|beacon|spear|salvage|splint)$/.test(id) ? 'fix'
      : /^(tune)$/.test(id) ? 'type' : /^(answer|radio)$/.test(id) ? 'phone'
      : /^npc-/.test(id) ? null : /^craft-/.test(id) ? null : /^(give|c1\.)/.test(id) ? 'give'
      : /^(rest|sleep)$/.test(id) ? null : 'use';
    if (!kind) return;
    const near = kind === 'type' || kind === 'phone' || kind === 'give';
    this.player.act(kind, near ? null : at, kind === 'fix' ? 2.4 : kind === 'phone' ? 3 : undefined);
    // and the work is heard
    const fx: Partial<Record<TaskKind, [string, number]>> = { fix: [id === 'beacon' || id === 'salvage' ? 'metal' : id === 'shelter' ? 'wood' : 'stone', 0.55], type: ['console', 0.35], use: ['soft', 0.4] };
    const f = fx[kind];
    if (f) { audio.sample(f[0], f[1], { delay: 0.35 }); if (kind === 'fix') { audio.sample(f[0], f[1] * 0.8, { delay: 0.95 }); audio.sample(f[0], f[1] * 0.7, { delay: 1.6 }); } }
  }

  private collect(it: Item, after = 0) {
    it.active = false;
    if (after > 0) { const o = it.obj; window.setTimeout(() => { if (!it.active) o.visible = false; }, after * 1000); } else
    it.obj.visible = false;
    if (!this.save.collected.includes(it.id)) this.save.collected.push(it.id);
  }

  private levelDone(n: number): boolean {
    const s = this.save;
    if (n === 1) return !!s.flags.drank;
    if (n === 2) return !!s.flags.ateSafe;
    if (n === 3) {
      const done = (s.inventory.stone ?? 0) >= 5 && (s.inventory.branch ?? 0) >= 5;
      // 1.3: a straight branch, its end scraped to a point and hardened: the digging stick (combat: woodBone)
      if (done && !s.flags['inv.woodBone']) { s.flags['inv.woodBone'] = true; this.after(5.5, () => this.ui.toast(t('e1.learn.stick'))); }
      return done;
    }
    return this.story.done(n);
  }

  private checkLevel() {
    const s = this.save;
    if (s.level <= PLAYABLE_LEVELS && this.levelDone(s.level)) {
      const n = s.level;
      s.completed.push(n);
      s.level++;
      this.sinceLevel = 0;
      audio.chime();
      this.ui.banner(t('level.complete', { n }), t(`level.${n}.title`));
      this.onLevelComplete?.(n);
      if (n === LAST_LEVEL) { this.syncItems(); this.after(4.7, () => this.ui.toast(t('level.arc.toast'))); }
      if (s.level <= PLAYABLE_LEVELS) {
        const next = s.level;
        this.after(4.7, () => { this.ui.toast(`${t('hud.level', { n: next })}: ${t(`level.${next}.title`)}`); const h = `level.${next}.hint`; if (t(h) !== h) this.ui.toast(t(h)); });
        this.story.onLevelStart(next);
      } else if (n === CH2_LAST) {
        this.after(4.7, () => this.ui.toast(t('level.arc2.toast')));
      }
      this.persist();
      this.ui.toast(t('msg.saved'));
    }
    this.refreshObjective();
  }

  private lastObjKey = '';
  refreshObjective() {
    const s = this.save;
    const progress = s.level === 3 ? t('level.3.progress', { s: Math.min(5, s.inventory.stone ?? 0), b: Math.min(5, s.inventory.branch ?? 0) })
      : s.level >= 4 && s.level <= PLAYABLE_LEVELS ? this.story.progress(s.level) : null;
    const key = `${s.level}|${progress}`;
    if (key === this.lastObjKey && this.mode === 'play') return;
    this.lastObjKey = key;
    this.ui.setObjective(s.level, progress);
  }

  /** World point the current objective points at (nearest needed item, station, lake). */
  objectivePoint(): THREE.Vector3 | null {
    if (this.combat?.encounter) return this.combat.goalPoint();
    const p = this.player.pos;
    const s = this.save;
    if (this.tutorial.target) return this.tutorial.target.clone();
    if (s.level === 1) {
      // 1.1: the marker leads to the stream (moving water), not the lake
      const at = new THREE.Vector3();
      this.waking.stream.nearest(p, at);
      if (at.lengthSq() > 0) return at;
      const dx = p.x - LAKE.x, dz = p.z - LAKE.z;
      const d = Math.hypot(dx, dz) || 1;
      const r = LAKE.r - 8; // shallow water at the near shore
      const x = LAKE.x + (dx / d) * r, z = LAKE.z + (dz / d) * r;
      return new THREE.Vector3(x, this.world.terrain.height(x, z), z);
    }
    if (s.level === 2 || s.level === 3) {
      let best: THREE.Vector3 | null = null, bd = Infinity;
      for (const it of this.world.items.items) {
        if (!it.active) continue;
        if (s.level === 2 && it.type !== 'fruit') continue;
        if (s.level === 3) {
          if (it.type !== 'stone' && it.type !== 'branch') continue;
          if ((s.inventory[it.type] ?? 0) >= 5) continue;
        }
        const d = it.pos.distanceTo(p);
        if (d < bd) { bd = d; best = it.pos; }
      }
      return best ? best.clone() : null;
    }
    if (s.level >= 4 && s.level <= PLAYABLE_LEVELS) {
      const m = this.story.markerTarget(s.level);
      // the way on foot: round the lake, never across it (landway.ts)
      return m ? landWay(this.world.terrain).route(p, m).via.clone() : null;
    }
    return null;
  }

  /** Objective marker for the compass: bearing (0 = north / -Z, clockwise) and distance. */
  private marker(): { bearing: number; dist: number } | null {
    const p = this.player.pos;
    const m = this.objectivePoint();
    if (!m) return null;
    const dist = Math.hypot(m.x - p.x, m.z - p.z);
    const bearing = Math.atan2(m.x - p.x, -(m.z - p.z));
    return { bearing, dist };
  }

  private onCreatureStep(fp: THREE.Vector3) {
    if (this.mode === 'dead') return;
    const d = fp.distanceTo(this.player.pos);
    if (d > 320) return;
    const k = smoothstep(320, 120, d);
    audio.tone(42, 1.6, 'sine', 0.45 * k + 0.05, 0, -14);
    this.camShake = Math.max(this.camShake, 0.05 * k);
    if (this.mode === 'play' && !this.stepWarned && d < 250) { this.stepWarned = true; this.ui.toast(t('msg.footsteps')); }
  }

  private die() {
    this.mode = 'dead';
    this.save.deaths = (this.save.deaths ?? 0) + 1;
    this.input.enabled = false;
    this.input.releasePointer();
    this.ui.setPrompt(null);
    this.ui.fade('black', 0.6, 1.5);
    audio.hurt();
    audio.human('scream');
    this.story.onDeath();
    this.ui.openDeath(() => {
      const s = this.save;
      s.stats = { health: 60, thirst: 50, hunger: 50, stamina: 100 };
      const camp = this.world.layout.camp;
      // wake up at camp once there is one
      if (s.flags.fire) this.player.spawn(camp.x + 2.5, camp.z + 1.5, 0.35); else this.player.spawn(0, 2, 0.35);
      this.ui.fade('black', 0, 1.5);
      this.mode = 'play';
      this.input.enabled = true;
      this.persist();
      this.after(1.6, () => this.ui.say('j.6', 'mz.name', 4));
    });
  }

  // ---------- test / debug helpers (window.__bs) ----------
  /** Plays a decision or quick-time beat on its own, forgetting test answers first. */
  debugBranch(beat: Beat) {
    const b = this.save.branch;
    b.log = b.log.filter((e) => !e.id.startsWith('debug.'));
    this.playScene([beat]);
  }

  /** Run the interaction the player would get by pressing E right now. */
  debugAct(): string | null {
    if (this.mode !== 'play') return null;
    this.findInteraction();
    const tg = this.interactTarget;
    if (!tg) return null;
    const label = tg.kind === 'action' ? tg.action.id : tg.kind === 'item' ? tg.item.type : tg.kind;
    this.debugActing = true;
    try { this.interact(); } finally { this.debugActing = false; }
    return label;
  }

  debugScene(id: 'rescue' | 'camp' | 'beacon') { this.story.debugScene(id); }

  /** Advance the simulation by `sec` seconds without rendering. */
  debugStep(sec: number, time: number) {
    const dt = 0.05;
    for (let k = 0; k < Math.round(sec / dt); k++) {
      if (this.mode === 'dead') break;
      this.update(dt, time + k * dt);
      // a mouse move turns the view once, as it does on a real frame: when the browser stops drawing (headless pointer
      // lock does), nothing else clears it, and every step would turn again and walk the player in circles
      this.input.lookDX = this.input.lookDY = 0;
    }
  }

  persist() {
    const s = this.save;
    if (this.mode === 'play') {
      s.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z];
      s.yaw = this.player.yaw;
    }
    // in the middle of a fight the save keeps the moment before it began (combat.ts checkpoint); the night's start is
    // the story's own (it marks the night as begun when it starts it), so that mark is not kept either
    const out = this.combat?.checkpoint(s) ?? s;
    const nightFight = this.combat?.encounter?.id === 'night.defence' || (this.combat?.encounter?.id === 'chase.escape' && s.level === 7);
    if (out !== s && nightFight && !s.flags.houndGone) out.flags = { ...s.flags, 'e1.night': false };
    writeSave(out);
  }
}
