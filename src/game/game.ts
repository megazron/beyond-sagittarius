import * as THREE from 'three';
import type { Away } from './away/away';
import { ROSTER } from './away/roster';
import type { CrewId } from '../characters/character';
import { t, onLangChange } from '../i18n';
import { clamp, smoothstep, lerp, easeInOut } from '../core/noise';
import { audio } from '../core/audio';
import { SaveData, writeSave } from '../core/save';
import type { World } from '../world/world';
import { LAKE } from '../world/terrain';
import { PICKABLE, Item } from '../world/props';
import { Story, Action, LAST_LEVEL } from './story';
import { Craft } from './tech/craft';
import { Dialogue, DlgTree } from './dialogue';
import type { TechNode } from './tech/data';
import { CH2_LAST } from './tech/data';
import { recordDiscovery } from './tech/tech';
import { showDiscovery } from '../ui/science';
import type { Player } from './player';
import type { Input } from './input';
import { UI, PLAYABLE_LEVELS } from '../ui/ui';
import { Tutorial } from './tutorial';
import { Cutscene, Beat, SceneBranch } from '../cinematic/cutscene';
import { voice } from '../core/voice';
import { apply, collectPayoffs, DECISIONS, LINE_RULES, QTES, record, resolveLine, test } from './branch';

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
    else if (id === 'medic') { s.stats.health = 100; s.stats.stamina = 100; }
    else if (id === 'strong') f.tirelessDay = s.day;
    this.ui.toast(t(`away.fav.${id}`));
  }

  /** Someone whose moment has come and whose story hasn't been told. Skyvra's is in Level 9 itself. */
  get revealDue() { const s = this.save; return s.replay ? undefined : ROSTER.find((r) => r.location && r.id !== 'explorer' && s.level >= r.unlock && !s.flags[`played.${r.id}`]); }

  /** Hand control to a crew member on their own stage; the green world waits. */
  goAway(id: CrewId, location: string, done?: () => void) {
    if (!this.away) return;
    this.mode = 'away';
    this.away.level = this.save.level;
    const first = !this.save.flags[`played.${id}`];
    const jobKey = `job.${id}.${this.save.level}`, job = !first && !this.save.flags[jobKey] ? this.save.level : 0;
    this.away.enter(id, location, () => {
      this.mode = 'play';
      this.save.flags[`played.${id}`] = true;
      if (first) this.ui.toast(t('away.switchHint'));
      else if (job) { this.save.flags[jobKey] = true; this.favour(id); }
      this.persist();
      done?.();
    }, job);
  }

  mode: Mode = 'wake';
  save!: SaveData;
  private wakeT = 0;
  private wakeCues: { t: number; fn: () => void; done?: boolean }[] = [];
  private saveClock = 0;
  private payoffClock = 0;
  private hudClock = 0;
  private interactTarget: { kind: 'water' } | { kind: 'item'; item: Item } | { kind: 'action'; action: Action } | { kind: 'strike' } | null = null;
  story: Story;
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
    this.story.hooks = { away: (id, loc, task, done) => { if (this.away) this.away.onTask = task; this.goAway(id, loc, done); }, quick: (id, done) => this.quick(id, done), craft: (n) => this.startCraft(n), talk: (tree) => this.startTalk(tree), free: () => this.mode === 'play' };
    this.craft.onFail = () => {
      const c = (this.save.crafts ??= { failed: 0 });
      c.failed++;
      this.ui.say(`fail.${(this.fails++ % 4) + 1}`, 'mz.name', 3.5);
    };
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
      actors: { scientist: this.player.model, explorer: this.world.explorer },
      subtitle: (k, sp) => this.ui.subtitle(k, sp),
      cameraOk: (p) => !this.world.forest.blocks(p.x, p.z, 0.5) && p.y > this.world.terrain.height(p.x, p.z) + 0.35,
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
  }

  private leavePanel() {
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
    const first = recordDiscovery(s, n.id);
    this.persist();
    if (!first) { this.ui.toast(t('msg.madeMore', { name: t(`tech.${n.id}`) })); this.leavePanel(); return; }
    showDiscovery(n, () => { this.leavePanel(); this.story.ch2.afterDiscovery(n); });
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

  start(save: SaveData, fresh: boolean) {
    this.save = save;
    this.cues = [];
    this.lastObjKey = '';
    this.syncItems();
    this.story.sync();
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
      if (open) this.after(0.6, () => this.playScene([open.kind === 'decision' ? { choice: open.id } : { qte: open.id }]));
    }
    this.player.model.root.visible = true;
    audio.startWind();
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

  private enterPlay(announce: boolean) {
    this.mode = 'play';
    this.finishWakeVisuals();
    this.input.enabled = true;
    this.ui.show('hud', true);
    this.ui.device(null);
    this.ui.setInventory(this.save.inventory, this.story.tools());
    this.refreshObjective();
    if (announce) {
      if (!this.save.flags.tutorialDone) {
        this.pendingIntro = true;
        this.tutorial.start();
      } else this.announceLevel1();
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

  private wakeRate = 1;
  private buildWake() {
    const ui = this.ui;
    // stretch the sequence so no line is cut off in any language
    const slots: [string, number][] = [['wake.line1', 4.4], ['wake.line2', 3.6], ['wake.line3', 3.4], ['wake.line4', 4.2], ['wake.line5', 3.8]];
    this.wakeRate = 1 / Math.max(1, ...slots.map(([k, s]) => ((voice.duration(k) ?? 0) + 0.3) / s));
    this.wakeCues = [
      { t: 0.4, fn: () => ui.fade('black', 0, 4) },
      { t: 1.6, fn: () => ui.say('wake.line1', 'crew.scientist.name', 3.4) },
      { t: 4.0, fn: () => { ui.device(['wake.device1', 'wake.device2', 'wake.device3']); audio.beep(); } },
      { t: 6.2, fn: () => ui.say('wake.line2', 'crew.scientist.name', 3.6) },
      { t: 10.0, fn: () => { ui.device(null); ui.say('wake.line3', 'crew.scientist.name', 3.4); } },
      { t: 13.6, fn: () => { ui.say('wake.line4', 'crew.scientist.name', 3.6); audio.thud(); } },
      { t: 18.0, fn: () => ui.say('wake.line5', 'crew.scientist.name', 3.6) },
      { t: 18.4, fn: () => ui.chapter(['wake.chapter']) },
      { t: 22.0, fn: () => ui.chapter(null) },
      { t: 22.2, fn: () => this.skipWake() }, // through black, like the skip: entering play is never seen
    ];
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
  skipWake() {
    if (this.mode !== 'wake' || this.wakeSkipped) return;
    this.wakeSkipped = true;
    for (const c of this.wakeCues) if (!c.done) { c.done = true; }
    this.ui.device(null); this.ui.subtitle(null); this.ui.chapter(null);
    // through black: whatever entering play costs happens where nobody can see it
    this.ui.fade('black', 1, 0.2);
    setTimeout(() => {
      this.finishWakeVisuals();
      this.enterPlay(true);
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
    this.player.update(dt, this.input, false, 100, 1);
    const cam = this.player.camera;
    const tpPos = cam.position.clone();
    const tpQuat = cam.quaternion.clone();
    const p = this.player.pos;
    const head = new THREE.Vector3(p.x, p.y + 1.0, p.z);
    const sky = this.world.sky;
    const lookSky = head.clone().addScaledVector(sky.giantDir.clone().lerp(sky.moonDir, 0.35).normalize(), 50);
    const lookCreature = this.world.creature.position.clone();
    const lookA = lookSky.clone().lerp(lookCreature, smoothstep(11.5, 14.5, w));
    const scripted = new THREE.PerspectiveCamera();
    scripted.position.copy(head).add(new THREE.Vector3(Math.sin(w * 0.3) * 0.05, smoothstep(12, 16, w) * 1.2, 0));
    scripted.lookAt(lookA);
    const blend = easeInOut(smoothstep(16, 20.5, w));
    cam.position.lerpVectors(scripted.position, tpPos, blend);
    cam.quaternion.slerpQuaternions(scripted.quaternion, tpQuat, blend);
    // the survivor lies still, comes round, pushes up, doesn't make it, and only then gets up
    const lift = smoothstep(13.5, 15.2, w) * .42 - smoothstep(15.2, 15.7, w) * .24 + smoothstep(16.1, 18.6, w) * .82;
    const up = clamp(lift, 0, 1);
    const shake = up > .05 && up < .97 ? Math.sin(w * 31) * .012 : 0;
    this.player.model.root.rotation.x = lerp(-Math.PI / 2 + 0.1, 0, easeInOut(up)) + shake;
    this.player.model.root.rotation.z = (1 - up) * .16 * Math.sin(w * 1.3);
    this.player.model.root.position.y = this.player.pos.y + (1 - up) * 0.25;
    this.player.model.root.visible = blend > 0.05 || up > 0.5;
  }

  update(dt: number, time: number) {
    const s = this.save;
    const st = s.stats;
    s.timeOfDay += dt / 50; // one in-game hour = 50 s
    if (s.timeOfDay >= 24) { s.timeOfDay -= 24; s.day++; }
    if (Math.abs(s.timeOfDay - 19.2) < dt / 50 && !s.flags.nightMsg) { s.flags.nightMsg = true; this.ui.toast(t('msg.night')); }

    if (this.mode === 'wake') { this.updateWake(dt * this.wakeRate); return; }
    if (this.mode === 'dead') return;
    this.runCues(dt);
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
    if (this.away && this.away.quiet > 0) { this.away.quiet -= dt; this.input.endFrame(); }
    // whoever this level reveals: their own story, on their own ground, as soon as the moment is free
    // a level's own ending lands first: the Vault, the Ledger, then the next person's story
    this.sinceLevel += dt;
    const who = this.revealDue;
    if (who && this.sinceLevel > 15 && !this.story.busy && !this.ui.modalOpen()) { this.goAway(who.id, who.location!); return; }
    // the crash isn't forgotten by the next cutscene: hurt on day one, better by the time there's food
    const hurt = s.level <= 1 ? 0.45 : s.level === 2 ? 0.72 : 1;
    p.model.setLimp(s.level <= 1);
    p.update(dt, this.input, true, st.stamina, (st.health < 25 ? 0.75 : 1) * hurt);
    if (this.camShake > 0) {
      p.camera.position.x += (Math.random() - 0.5) * this.camShake;
      p.camera.position.y += (Math.random() - 0.5) * this.camShake;
      this.camShake = Math.max(0, this.camShake - dt * 0.5);
    }

    // stats
    st.thirst = clamp(st.thirst - dt * 0.16, 0, 100);
    st.hunger = clamp(st.hunger - dt * 0.07, 0, 100);
    if (!p.swimming) this.swimWarned = false;
    if (p.swimming) {
      // swimming is work; Ulari lungs were made for cold water and make it half the work
      const lungs = (s.player?.lineage ?? 'ulari') === 'ulari' ? 0.5 : 1;
      st.stamina = clamp(st.stamina - dt * (p.sprinting ? 9 : 3.2) * lungs, 0, 100);
      if (st.stamina <= 0) { st.health -= dt * 3; if (!this.swimWarned) { this.swimWarned = true; this.ui.toast(t('msg.swimTired')); } }
      if (!s.flags.swamOnce) { s.flags.swamOnce = true; this.ui.toast(t('msg.swim')); }
    } else if (p.sprinting && s.favours?.tirelessDay !== s.day) st.stamina = clamp(st.stamina - dt * 16, 0, 100);
    else st.stamina = clamp(st.stamina + dt * (p.speedNow > 0.5 ? 8 : 14), 0, 100);
    if (st.thirst <= 0 || st.hunger <= 0) st.health -= dt * 0.6;
    else if (st.thirst > 40 && st.hunger > 40) st.health = Math.min(100, st.health + dt * 0.12);
    if (st.thirst < 15 && time - this.lastThirstWarn > 40) { this.lastThirstWarn = time; this.ui.toast(t('msg.thirsty')); }
    if (st.hunger < 15 && time - this.lastHungerWarn > 50) { this.lastHungerWarn = time; this.ui.toast(t('msg.hungry')); }
    if (p.blockedDeep && !s.flags.deepWarn) { s.flags.deepWarn = true; this.ui.toast(t('msg.deep')); setTimeout(() => (s.flags.deepWarn = false), 8000); }
    if (st.health <= 0) { this.die(); return; }

    this.story.update(dt, time);
    if (this.mode !== 'play') return; // the story can kill the player (predator)
    this.tutorial.update(dt);
    this.findInteraction();
    if (this.interactTarget && this.input.act('interact')) this.interact();

    // Medic memory when first approaching fruit
    if (!s.flags.medicHint) {
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
    if (this.story.houndEngaged()) {
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
    // ...and someone walking past doesn't stand between you and what's at your feet
    const nearItem = reach && (act!.missing?.length || ((act!.id.startsWith('npc-') || act!.id === 'skyvra') && Math.hypot(reach.pos.x - p.pos.x, reach.pos.z - p.pos.z) < ad)) ? reach : null;
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
    if (target.kind === 'strike') { this.story.strike(); return; }
    if (target.kind === 'action') {
      const a = target.action;
      if (a.missing?.length) { this.ui.toast(t('msg.need', { list: a.missing.join(', ') })); audio.uiClick(); return; }
      a.run();
      this.refreshObjective();
      return;
    }
    if (target.kind === 'water') {
      if (st.thirst > 97) { this.ui.toast(t('msg.drinkFull')); return; }
      st.thirst = clamp(st.thirst + 35, 0, 100);
      audio.tone(300, 0.25, 'sine', 0.15, 0, 200);
      if (!s.flags.drank) { s.flags.drank = true; this.ui.toast(t('msg.drink')); this.ui.say('j.4', 'crew.scientist.name', 4); }
      return;
    }
    const it = target.item;
    if (PICKABLE.has(it.type)) {
      s.inventory[it.type] = (s.inventory[it.type] ?? 0) + 1;
      this.collect(it);
      audio.blip();
      this.ui.toast(t('msg.picked', { item: t(`item.${it.type}`) }));
      this.ui.setInventory(s.inventory, this.story.tools());
      this.refreshObjective();
      return;
    }
    if (!it.examined) {
      it.examined = true;
      s.flags[`ex-${it.id}`] = true;
      this.ui.toast(t(it.type === 'fruit' ? 'fruit.examineBlue' : 'fruit.examineRed'));
      audio.uiClick();
      return;
    }
    this.collect(it);
    if (it.type === 'fruit') {
      st.hunger = clamp(st.hunger + 38, 0, 100);
      st.health = clamp(st.health + 5, 0, 100);
      s.flags.ateSafe = true;
      this.ui.toast(t('fruit.ateBlue'));
      audio.blip();
    } else {
      st.hunger = clamp(st.hunger + 6, 0, 100);
      st.health = clamp(st.health - 28, 0, 100);
      s.flags.ateRed = true;
      this.ui.toast(t('fruit.ateRed'));
      this.ui.say('j.5', 'crew.scientist.name', 3);
      this.ui.damage();
      audio.hurt();
      this.camShake = 0.12;
    }
  }

  private collect(it: Item) {
    it.active = false;
    it.obj.visible = false;
    if (!this.save.collected.includes(it.id)) this.save.collected.push(it.id);
  }

  private levelDone(n: number): boolean {
    const s = this.save;
    if (n === 1) return !!s.flags.drank;
    if (n === 2) return !!s.flags.ateSafe;
    if (n === 3) return (s.inventory.stone ?? 0) >= 5 && (s.inventory.branch ?? 0) >= 5;
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
    const p = this.player.pos;
    const s = this.save;
    if (this.tutorial.target) return this.tutorial.target.clone();
    if (s.level === 1) {
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
      return m ? m.clone() : null;
    }
    return null;
  }

  /** Objective marker for the compass: bearing (0 = north / -Z, clockwise) and distance. */
  private marker(): { bearing: number; dist: number } | null {
    const p = this.player.pos;
    const m = this.objectivePoint();
    if (!m) return null;
    const dist = this.save.level === 1 && !this.tutorial.target
      ? Math.max(0, Math.hypot(LAKE.x - p.x, LAKE.z - p.z) - LAKE.r + 4)
      : Math.hypot(m.x - p.x, m.z - p.z);
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
    this.interact();
    return label;
  }

  debugScene(id: 'rescue' | 'camp' | 'beacon') { this.story.debugScene(id); }

  /** Advance the simulation by `sec` seconds without rendering. */
  debugStep(sec: number, time: number) {
    const dt = 0.05;
    for (let k = 0; k < Math.round(sec / dt); k++) {
      if (this.mode === 'dead') break;
      this.update(dt, time + k * dt);
    }
  }

  persist() {
    const s = this.save;
    if (this.mode === 'play') {
      s.pos = [this.player.pos.x, this.player.pos.y, this.player.pos.z];
      s.yaw = this.player.yaw;
    }
    writeSave(s);
  }
}
