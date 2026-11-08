import './style.css';
import * as THREE from 'three';
import { setLang, setPlayer, t, Lang } from './i18n';
import { detectQuality, isPhone, saveQualityChoice, QualityName } from './core/quality';
import { desktop } from './core/desktop';
import { Away } from './game/away/away';
import type { CrewId } from './characters/character';
import { Renderer } from './core/renderer';
import { audio } from './core/audio';
import { loadSave, newSave, clearSave, loadSettings, writeSettings, useSlot, SaveData, Settings } from './core/save';
import { UI } from './ui/ui';
import { Cinematic } from './cinematic/cinematic';
import { World } from './world/world';
import { Player } from './game/player';
import { Input } from './game/input';
import { Game } from './game/game';
import { applyCrewNames, CREW_IDS, CrewNames } from './core/crew';
import { CHAPTERS, COMMENTS, emptyBranch, pathView, pickComments, resolveLine, takenBranches, endingFor, ENDINGS } from './game/branch';
import type { Chapter } from './game/branch';
import { TouchControls, TouchAction } from './ui/touch';
import { openCreator, CreatorStage } from './ui/creator';
import { applyIcons } from './ui/icons';
import { initGlyphs, refreshGlyphs } from './ui/glyphs';
import { MenuNav } from './ui/nav';
import { Wheel } from './ui/wheel';
import { drawMap, MapPin } from './ui/map';
import type { MenuTab } from './ui/ui';
import { setPortraitCast, setPortraitRenderer } from './ui/portraits';
import { preloadCrew } from './characters/character';
import { setTextureWarmer } from './core/assets';
import { defaultLook, PlayerLook, CrewSkins } from './characters/custom';
import { voice } from './core/voice';
import { frameReport } from './cinematic/cutscene';
import { Vault, vaultScript } from './narrator/vault';
import { Montage } from './cinematic/montage';
import { onLangChange } from './i18n';
import { fitFov, lockViewport, tryFullscreen } from './core/viewport';
import { TECH, AGES } from './game/tech/data';
import { techState } from './game/tech/tech';
import { openCodex, showSafetyCard, consentGiven, stopSpeech } from './ui/science';

type State = 'loading' | 'title' | 'cinematic' | 'game' | 'narrator' | 'film' | 'flashback';

const canvas = document.getElementById('c') as HTMLCanvasElement;
lockViewport();
const settings: Settings = loadSettings();
setLang(settings.lang);
const quality = detectQuality();
const ui = new UI();
function applyLanguages() {
  ui.subtitlesOn = settings.subLang !== 'off';
  ui.subLang = settings.subLang === 'same' || settings.subLang === 'off' ? null : settings.subLang;
  voice.override = settings.voiceLang === 'same' ? null : settings.voiceLang;
  void voice.load();
  document.querySelectorAll<HTMLButtonElement>('.btn.sublang').forEach((b) => b.classList.toggle('active', b.dataset.sub === settings.subLang));
}

function applyAudio() {
  audio.setVolume(settings.volume);
  audio.setMix({ music: settings.musicVolume, sfx: settings.sfxVolume, voice: settings.voiceVolume, muted: settings.muted });
}
applyAudio();
applyLanguages();
onLangChange(() => void voice.load());

let renderer: Renderer;
try {
  renderer = new Renderer(canvas, quality);
} catch (e) {
  document.getElementById('loading')!.innerHTML = '<div class="loader-text">WebGL2 is required to play BEYOND SAGITTARIUS.</div>';
  throw e;
}

const input = new Input(canvas);
input.setBinds(settings.binds);
input.vibration = settings.vibration !== false;
ui.input = input;
ui.onDamage = () => input.rumble(180, 0.7);
initGlyphs(input);
applyIcons(document);
refreshGlyphs();
const nav = new MenuNav(input, (dir) => ui.cycleTab(dir));
const wheel = new Wheel(input, (k) => game?.useItem(k));
const touch = new TouchControls(input, (a: TouchAction) => {
  if (a === 'pause') openPause();
  else if (a === 'codex') openPanel('codex');
  else if (wheel.open) wheel.close(false);
  else if (canPlay()) wheel.show(game.save.inventory, game.story.tools());
});
const syncDevice = () => {
  document.body.classList.toggle('touch', input.device === 'touch');
  document.body.classList.toggle('dev-pad', input.device === 'pad');
};
input.onDevice(syncDevice);
syncDevice();
const cine = new Cinematic(ui);
const film = new Montage(cine, () => (worldReady ? world : null), (sc, cam, ao) => renderer.setScene(sc, cam, ao), () => pendingLook.glow, () => (player ? [player.model.root, ...(game?.story.npcs.roots() ?? [])] : []), ui);
const vault = new Vault((k, sp) => ui.subtitle(k, sp), quality.name === 'mobile' ? 0.6 : 1);
film.small = quality.name === 'mobile';
const world = new World(quality);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2400);
let player: Player;
let game: Game;
let state: State = 'loading';
let paused = false;
let worldReady = false;
let pendingStart: (() => void) | null = null;
let suppressPauseOnUnlock = false;
let pendingNames: CrewNames = {};
/** Chapter being replayed by the next world start. */
let replaying: number | null = null;
/** Debug camera override used for documentation screenshots. */
let photo: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;

document.getElementById('quality-badge')!.textContent = quality.name.toUpperCase();
document.getElementById('btn-download')!.classList.toggle('hidden', !!desktop || isPhone());
if (desktop) {
  document.getElementById('version-badge')!.textContent = `v${desktop.version}`;
  const quit = document.getElementById('btn-quit-desktop')!;
  quit.classList.remove('hidden'); // fullscreen has no window close button
  quit.addEventListener('click', () => desktop?.quit());
}
renderer.setScene(cine.scene, cine.camera, false);

function persistSettings() {
  writeSettings(settings);
  applyLanguages();
  applyAudio();
  if (player) { player.sensitivity = settings.sensitivity; player.invertY = settings.invertY; }
  input.vibration = settings.vibration !== false;
  refreshGlyphs();
  if (!settings.showFps) ui.setFps(null);
  if (game) game.timersOff = !!settings.noTimers;
}

function changeQuality(q: QualityName) {
  saveQualityChoice(q);
  if (state === 'game' && game) game.persist();
  const url = new URL(location.href);
  url.searchParams.delete('quality');
  location.href = url.toString();
}

// ---------------- title ----------------
function refreshTitle() {
  const main = loadSave();
  document.getElementById('btn-continue')!.classList.toggle('hidden', !main);
  document.getElementById('btn-chapters')!.classList.toggle('hidden', !main);
  document.querySelectorAll<HTMLButtonElement>('.btn.lang').forEach((b) => b.classList.toggle('active', b.dataset.lang === settings.lang));
}

function showTitle() {
  state = 'title';
  touch.show(false);
  paused = false;
  input.enabled = false;
  input.releasePointer();
  ui.show('title', true);
  ui.show('hud', false);
  ui.show('cine', false);
  ui.subtitle(null);
  ui.closeModal();
  cine.resetIdle();
  renderer.setScene(cine.scene, cine.camera, false);
  ui.fade('black', 0, 1.2);
  audio.stopWind();
  applyCrewNames(undefined);
  useSlot('main');
  refreshTitle();
}

function whenWorldReady(fn: () => void) {
  if (worldReady) fn();
  else { pendingStart = fn; ui.show('loading', true); }
}

const detail = () => (quality.name === 'mobile' ? 0.6 : quality.name === 'cinematic' ? 1.4 : 1);
let pendingLook: PlayerLook = defaultLook();

/** Applies the player's look and name to everything that shows them. */
const stage = new CreatorStage(canvas, quality.name === 'mobile' ? 0.6 : 1);
function showStage(on: boolean) {
  stage.active = on;
  if (state === 'title') ui.show('title', !on);
  if (on) renderer.setScene(stage.scene, stage.camera, false);
  else if (state === 'game') renderer.setScene(world.scene, camera, true);
  else renderer.setScene(cine.scene, cine.camera, false);
}

let castKey = '';
function applyPlayer(look: PlayerLook, skins: CrewSkins) {
  setPlayer(look);
  applyCrewNames(look.name ? { scientist: look.name } : {});
  setPortraitCast(look, skins, detail());
  // rebuilding figures is expensive: only when the look really changed
  const key = JSON.stringify([{ ...look, name: '' }, skins]);
  if (key === castKey) return;
  castKey = key;
  cine.setCast(look, skins);
  if (player) player.setLook(look, detail(), () => game?.story.reattachSpear());
}

/** New game: make your character, then the prologue. */
function chooseNames() {
  openCreator(ui, loadSave()?.player ?? defaultLook(), 'new', stage, showStage, (look) => startNewGame(look), () => {});
}

// Locked cosmetic: only a hash of the code lives in the source.
const SKIN_HASH = '02d087933efc5d76e06f75adf1db3c14dbe271b1769d6b267eaeae29ec57330d';
async function tryCode(code: string): Promise<boolean> {
  if (!crypto.subtle) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim().toLowerCase()));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== SKIN_HASH) return false;
  settings.unlocked = Array.from(new Set([...(settings.unlocked ?? []), 'strong.suit']));
  writeSettings(settings);
  return true;
}

function openSkins(onClose: () => void) {
  const save = state === 'game' ? game.save : null;
  let skins: CrewSkins = save?.skins ?? settings.skins ?? {};
  ui.openSkins(skins, settings.unlocked ?? [], (s) => {
    skins = s;
    settings.skins = s; writeSettings(settings);
    if (save) { save.skins = s; game.persist(); }
    applyPlayer(save?.player ?? pendingLook, s);
  }, tryCode, onClose);
}

/** Fade into the Vault for a MegaZroN scene, then hand back to `after`. */
function playVault(id: 'intro' | 'l3' | 'l7' | 'ch1' | 'ch2', after: () => void) {
  const s = game?.save;
  const names = (s?.names ?? pendingNames) as CrewNames;
  const lines = vaultScript(id, { ateRed: !!s?.flags.ateRed, deaths: s?.deaths ?? 0, bites: s?.bites ?? 0, renamed: Object.keys(names).length > 0, failed: s?.crafts?.failed ?? 0, comments: s ? pickComments(s, COMMENTS, id) : [] });
  state = 'narrator';
  input.enabled = false; input.resetTouch(); touch.show(false); suppressPauseOnUnlock = true; input.releasePointer();
  ui.fade('black', 1, 0.5);
  ui.show('hud', false);
  setTimeout(() => {
    renderer.setScene(vault.scene, vault.camera, false);
    renderer.renderer.toneMappingExposure = 1;
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    vault.play(lines, () => {
      ui.fade('black', 1, 0.45);
      setTimeout(() => { ui.show('cine', false); after(); }, 480);
    });
    // lift the black only once the Vault is really on screen
    requestAnimationFrame(() => requestAnimationFrame(() => ui.fade('black', 0, 1.0)));
  }, 520);
}

/** Return from a scene to the running game. */
function backToWorld() {
  state = 'game';
  renderer.setScene(world.scene, camera, true);
  ui.show('hud', true);
  input.enabled = true;
  ui.fade('black', 0, 1.0);
}

function playFlashback(after: () => void) {
  state = 'flashback';
  renderer.renderer.toneMappingExposure = 1; // the world leaves its own exposure behind
  input.enabled = false; input.resetTouch(); touch.show(false); suppressPauseOnUnlock = true; input.releasePointer();
  ui.fade('white', 1, 0.5);
  ui.show('hud', false);
  setTimeout(() => {
    document.body.classList.add('flashback');
    renderer.setScene(cine.scene, cine.camera, false);
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    ui.fade('white', 0, 0.9);
    cine.playFlashback(() => {
      ui.fade('white', 1, 0.4);
      setTimeout(() => { document.body.classList.remove('flashback'); ui.show('cine', false); ui.fade('black', 1, 0); after(); }, 430);
    });
  }, 520);
}

/** Opens the path tree for a save, and remembers on this device what it has seen. */
function openPathTree(s: SaveData, ch: Chapter, onClose: () => void, opts: { replay?: () => void; back?: string; standalone?: boolean } = {}) {
  settings.paths = Array.from(new Set([...(settings.paths ?? []), ...takenBranches(s, ch)]));
  writeSettings(settings);
  ui.openPath(t(ch.title), pathView(s, ch, settings.paths, CREW_IDS), onClose, { ...opts, note: s.replay ? t('br.replay.note') : undefined, leaning: [endingFor(s, 'stay', ENDINGS).id, endingFor(s, 'home', ENDINGS).id] });
}

/** Chapter select: each chapter you have played shows its tree; ones with branches can be replayed. */
function openChapters() {
  const main = loadSave();
  if (!main) return;
  const list = CHAPTERS.map((c) => ({ id: c.id, title: c.title, played: main.level >= c.levels[0], note: c.status === 'ready' ? 'br.ch.unplayed' : 'br.ch.planned' }));
  ui.openChapters(list, (id) => {
    const ch = CHAPTERS.find((c) => c.id === id)!;
    openPathTree(main, ch, openChapters, { standalone: true, replay: ch.replayable ? () => startReplay(ch) : undefined });
  }, refreshTitle);
}

/** Plays a chapter again in the replay slot; the main story stays as it was. */
function startReplay(ch: Chapter) {
  const base = loadSave();
  audio.start();
  if (input.device === 'touch') tryFullscreen();
  useSlot('replay');
  clearSave();
  pendingLook = base?.player ?? defaultLook();
  pendingNames = { ...(base?.names ?? {}) } as CrewNames;
  replaying = ch.id;
  ui.show('title', false);
  ui.fade('black', 1, 0.6);
  setTimeout(() => whenWorldReady(() => enterWorld(true)), 650);
}

/** Level endings that cut away to the Vault or a memory (once per save). */
function onLevelDone(n: number) {
  const beat: Record<number, 'l3' | 'fight' | 'l7' | 'ch1' | 'ch2'> = { 3: 'l3', 5: 'fight', 7: 'l7', 10: 'ch1', 21: 'ch2' };
  const id = beat[n];
  if (!id || game.save.flags[`seen-${id}`]) return;
  const go = () => {
    if (state !== 'game' || game.mode !== 'play' || paused || ui.modalOpen()) { game.after(1, go); return; }
    game.save.flags[`seen-${id}`] = true;
    game.persist();
    if (id === 'fight') playFlashback(() => { backToWorld(); game.after(1.2, () => ui.say('fb.10', 'crew.scientist.name', 4)); });
    else playVault(id, () => { backToWorld(); if (id === 'ch1') chapterClosed(1); else if (id === 'ch2') chapterClosed(2); });
  };
  game.after(5.2, go);
}

/** After each chapter: the player reads what they did. A replay ends here. */
function chapterClosed(id: number) {
  const ch = CHAPTERS.find((c) => c.id === id)!;
  freeze();
  const replay = game.save.replay;
  openPathTree(game.save, ch, () => { if (replay) { game.persist(); showTitle(); } else resume(); }, { back: replay ? 'menu.quitTitle' : 'menu.resume' });
}

function startNewGame(look: PlayerLook = defaultLook()) {
  audio.start();
  if (input.device === 'touch') tryFullscreen();
  clearSave();
  pendingLook = look;
  pendingNames = look.name ? { scientist: look.name } : {};
  applyPlayer(look, settings.skins ?? {});
  ui.show('title', false);
  void voice.load();
  playVault('intro', () => {
    state = 'cinematic';
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    renderer.setScene(cine.scene, cine.camera, false);
    cine.start(() => playFilm());
  });
}

/** The title sequence, then the wake-up. */
function playFilm() {
  state = 'film';
  ui.fade('black', 0, 0);
  ui.subtitle(null);
  void film.play(() => {
    ui.fade('black', 1, 0.2);
    setTimeout(() => whenWorldReady(() => enterWorld(true)), 240);
  });
}

function continueGame() {
  useSlot('main');
  audio.start();
  if (input.device === 'touch') tryFullscreen();
  ui.show('title', false);
  ui.fade('black', 1, 0.6);
  setTimeout(() => whenWorldReady(() => enterWorld(false)), 650);
}

function enterWorld(fresh: boolean) {
  ui.show('loading', false);
  state = 'game';
  renderer.setScene(world.scene, camera, true);
  renderer.aoHidden = world.aoHidden();
  const save = fresh ? newSave() : (loadSave() ?? newSave());
  if (fresh) { save.names = { ...pendingNames }; save.player = { ...pendingLook }; save.skins = settings.skins ?? {}; }
  if (fresh && replaying) { save.replay = replaying; save.flags.tutorialDone = true; replaying = null; }
  applyPlayer(save.player ?? defaultLook(), save.skins ?? {});
  const replay = !!settings.replayTutorial;
  if (replay) { save.flags.tutorialDone = false; settings.replayTutorial = false; persistSettings(); }
  game.start(save, fresh);
  if (!fresh && replay) game.startTutorial();
  if (!fresh) ui.fade('black', 0, 1.2);
}

document.getElementById('btn-new')!.addEventListener('click', () => {
  audio.start(); audio.uiClick();
  if (loadSave()) ui.openConfirm(t('menu.newGameConfirm'), chooseNames, () => {});
  else chooseNames();
});
document.getElementById('btn-chapters')!.addEventListener('click', () => { audio.start(); audio.uiClick(); openChapters(); });
document.getElementById('btn-legal')!.addEventListener('click', () => { audio.uiClick(); ui.openLegal(() => {}); });
document.getElementById('btn-continue')!.addEventListener('click', () => { audio.uiClick(); continueGame(); });
document.getElementById('btn-settings')!.addEventListener('click', () => {
  audio.start(); audio.uiClick();
  ui.openSettings(settings, quality.name, persistSettings, changeQuality, refreshTitle, () => { settings.replayTutorial = true; persistSettings(); }, () => openSkins(refreshTitle), () => ui.openLegal(refreshTitle));
});
document.querySelectorAll<HTMLButtonElement>('.btn.lang').forEach((b) => b.addEventListener('click', () => {
  audio.uiClick();
  settings.lang = b.dataset.lang as Lang;
  setLang(settings.lang);
  persistSettings();
  refreshTitle();
}));
document.querySelectorAll<HTMLButtonElement>('.btn.sublang').forEach((b) => b.addEventListener('click', () => {
  audio.uiClick();
  settings.subLang = b.dataset.sub as Settings['subLang'];
  persistSettings();
}));
document.getElementById('btn-skip')!.addEventListener('click', () => {
  skipCurrent();
});
function skipCurrent() {
  if (state === 'cinematic' || state === 'flashback') cine.skip();
  else if (state === 'film') film.skip();
  else if (state === 'narrator') vault.skip();
  else if (state === 'game' && game?.mode === 'wake') game.skipWake();
  else if (state === 'game' && game?.mode === 'scene') game.skipScene();
}

// ---------------- pause / menus ----------------
const canPlay = () => state === 'game' && (game.mode === 'play' || game.mode === 'away') && !paused && !ui.modalOpen();

function freeze() {
  paused = true;
  input.enabled = false;
  input.resetTouch();
  touch.reset();
  wheel.close(false);
  invT0 = 0;
  suppressPauseOnUnlock = true;
  input.releasePointer();
  audio.duck(true);
}
function resume() { ui.closeModal(); paused = false; input.enabled = true; audio.duck(false); }

function openMapTab() {
  ui.openMap(resume);
  const L = world.layout, m = game.objectivePoint();
  const pins: MapPin[] = [{ x: L.camp.x, z: L.camp.z, icon: 'camp', label: t('map.camp') }];
  if (m) pins.push({ x: m.x, z: m.z, icon: 'marker', cls: 'goal', label: document.getElementById('obj-title')!.textContent ?? '' });
  for (const [x, z] of game.save.favours?.pins ?? []) pins.push({ x, z, icon: 'marker', cls: 'scout', label: t('crew.explorer.name') });
  drawMap((x, z) => world.terrain.height(x, z), { x: player.pos.x, z: player.pos.z, yaw: player.yaw }, pins, quality.name === 'mobile' ? 360 : 720);
}

function showTab(tab: MenuTab) {
  stopSpeech();
  if (tab !== 'pause') game.notePanel(tab);
  if (tab === 'pause') {
    ui.openPause({
      resume,
      settings: () => ui.openSettings(settings, quality.name, persistSettings, changeQuality, () => showTab('pause'), () => { resume(); game.startTutorial(); }, undefined, () => ui.openLegal(() => showTab('pause'))),
      look: () => openCreator(ui, game.save.player ?? defaultLook(), 'edit', stage, showStage, (look) => {
        game.save.player = look;
        game.save.names = look.name ? { scientist: look.name } : {};
        applyPlayer(look, game.save.skins ?? {});
        game.persist();
        showTab('pause');
      }, () => showTab('pause')),
      skins: () => openSkins(() => showTab('pause')),
      quit: () => { game.persist(); audio.duck(false); showTitle(); },
    });
  } else if (tab === 'map') openMapTab();
  else if (tab === 'objectives') ui.openObjectives(game.save.level, game.save.completed, resume);
  else if (tab === 'codex') openCodex(ui, game.save, resume);
  else if (tab === 'ledger') openPathTree(game.save, CHAPTERS.find((c) => game.save.level <= c.levels[1]) ?? CHAPTERS[0], resume);
  else if (tab === 'inventory') ui.openInventory(game.save.inventory, game.story.tools(), resume);
  else ui.openCrew((id) => game.story.crewStatus(id), resume, undefined, (id, loc) => game.goAway(id as CrewId, loc));
}
ui.onMenuTab = showTab;

function openPause() { if (canPlay()) { freeze(); showTab('pause'); } }
function openPanel(kind: MenuTab) { if (canPlay()) { freeze(); showTab(kind); } }

/** Tap the inventory input for the full list, hold it for the wheel. */
let invT0 = 0;
function invStart() { if (canPlay() && !wheel.open) invT0 = performance.now(); }
function invEnd() {
  if (!invT0) return;
  invT0 = 0;
  if (wheel.open) wheel.close(true); else openPanel('inventory');
}

/** Menu shortcuts: the same input closes what it opened. */
function menuKey(tab: MenuTab) {
  if (ui.modalOpen()) { if (paused) resume(); } else openPanel(tab);
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'game' && !paused && !suppressPauseOnUnlock) openPause();
  suppressPauseOnUnlock = false;
});
input.onPadLost(() => { if (input.device === 'pad') openPause(); });

const inScene = () => state === 'cinematic' || state === 'film' || state === 'narrator' || state === 'flashback' || (state === 'game' && (game.mode === 'wake' || game.mode === 'scene'));

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return; // typing a name
  if ((e.code === 'Enter' || e.code === 'Escape') && inScene()) { skipCurrent(); return; }
  if (e.code === 'Escape') {
    if (ui.modalOpen()) { if (!nav.back() && paused) resume(); } else if (state === 'game') openPause();
    return;
  }
  if (state !== 'game') return;
  const a = input.actionFor(e.code);
  if (a === 'objectives') menuKey('objectives');
  else if (a === 'crew') menuKey('crew');
  else if (a === 'map') menuKey('map');
  else if (a === 'codex') menuKey('codex');
  else if (a === 'inventory') {
    e.preventDefault();
    if (ui.modalOpen()) menuKey('inventory'); else if (!e.repeat) invStart();
  }
});
window.addEventListener('keyup', (e) => { if (input.actionFor(e.code) === 'inventory') invEnd(); });

/** Pad buttons that do what the keys above do. */
let padInv = false;
function padFrame() {
  if (inScene()) { if (input.padSkip()) skipCurrent(); return; }
  if (state !== 'game') return;
  if (input.padAct('pause')) { if (ui.modalOpen()) { if (paused) resume(); } else openPause(); }
  if (!ui.modalOpen()) { // in menus the bumpers switch tabs and B goes back
    if (input.padAct('objectives')) openPanel('objectives');
    if (input.padAct('crew')) openPanel('crew');
    if (input.padAct('map')) openPanel('map');
    if (input.padAct('codex')) openPanel('codex');
  }
  if (game.mode === 'craft') game.craft.pad(input);
  const inv = input.padConnected && input.padHeld('inventory');
  if (inv && !padInv && !ui.modalOpen()) invStart();
  if (!inv && padInv) invEnd();
  padInv = inv;
}

window.addEventListener('beforeunload', () => { if (state === 'game' && game?.mode === 'play') game.persist(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'game' && game?.mode === 'play') game.persist(); });

// ---------------- boot ----------------
const clock = new THREE.Clock();
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fpsLast = performance.now();

let frameCount = 0;
/** Test hook: frames only move when asked, by a fixed step, so a slow GPU sees the same film. */
const hold = { on: false, pending: 0, done: 0 };
function frame() {
  requestAnimationFrame(frame);
  frameCount++;
  const real = Math.min(clock.getDelta(), 0.05);
  if (!hold.on) { tick(real); draw(real); return; }
  if (hold.pending <= 0) return;
  for (let left = hold.pending; left > 1e-6; left -= 1 / 30) tick(Math.min(left, 1 / 30));
  hold.pending = 0;
  draw(1 / 30);
  hold.done++;
}

function tick(step: number) {
  let dt = step;
  elapsed += dt;
  input.poll(dt);
  nav.update();
  padFrame();
  if (invT0 && !wheel.open && performance.now() - invT0 > 220 && canPlay()) wheel.show(game.save.inventory, game.story.tools());
  if (wheel.open) {
    wheel.update(input.lookDX, input.lookDY, input.padAim.x, input.padAim.y);
    input.lookDX = input.lookDY = 0;
    dt *= 0.3; // the world slows while you choose
  }
  if (state === 'title' || state === 'loading') {
    cine.idle(dt);
  } else if (state === 'cinematic' || state === 'flashback') {
    cine.update(dt);
  } else if (state === 'film') {
    film.update(dt);
    if (film.inWorld) { world.update(dt, elapsed, film.hours, film.focus, film.wcam, renderer.renderer); renderer.renderer.toneMappingExposure *= film.boost; world.fog.density *= film.fog; }
  } else if (state === 'narrator') {
    vault.update(dt);
  } else if (state === 'game') {
    touch.show(input.device === 'touch' && game.mode === 'play' && !paused && !ui.modalOpen());
    touch.update();
    if (state === 'game') ui.track(camera);
    if (!paused && game.mode !== 'dead') game.update(dt, elapsed);
    const focus = player.pos;
    if (photo) { camera.position.copy(photo.from); camera.lookAt(photo.to); }
    world.update(paused ? 0 : dt, elapsed, game.save.timeOfDay, focus, camera, renderer.renderer);
  }
  if (stage.active) stage.update(dt);
}

function draw(dt: number) {
  // portrait screens: widen the vertical FOV so the horizontal view stays usable
  const activeCam = stage.active ? stage.camera : state === 'game' ? camera : state === 'narrator' ? vault.camera : state === 'film' && film.inWorld ? film.wcam : cine.camera;
  const designFov = activeCam.fov;
  fitFov(activeCam);
  if (!(state === 'film' && film.videoOn)) renderer.render(dt, elapsed);
  if (activeCam.fov !== designFov) { activeCam.fov = designFov; activeCam.updateProjectionMatrix(); }
  input.endFrame();
  fpsFrames++;
  const nowMs = performance.now();
  fpsAcc = (nowMs - fpsLast) / 1000;
  if (fpsAcc > 0.5) {
    fpsLast = nowMs;
    if (settings.showFps) ui.setFps(`${Math.round(fpsFrames / fpsAcc)} fps · ${quality.name} · pr ${renderer.pixelRatio.toFixed(2)}`);
    fpsAcc = 0; fpsFrames = 0;
  }
}

/** Every scene once through the real pipeline during loading, yielding between them. */
async function warmAll() {
  const breathe = () => new Promise((r) => requestAnimationFrame(r));
  renderer.warmBegin();
  // the world from the spawn point, in every direction: the wake-up turns the camera around
  const wide = new THREE.PerspectiveCamera(100, 16 / 9, 0.1, 2400);
  wide.position.copy(player.pos).add(new THREE.Vector3(0, 1.7, 0));
  for (let i = 0; i < 4; i++) {
    wide.rotation.set(0, (i / 4) * Math.PI * 2, 0);
    wide.updateMatrixWorld();
    renderer.warm(world.scene, wide, true);
    await breathe();
  }
  await cine.warm((sc, cam) => renderer.warm(sc, cam, false));
  await breathe();
  vault.prepare();
  renderer.warm(vault.scene, vault.camera, false);
  await breathe();
  stage.update(0.016);
  renderer.warm(stage.scene, stage.camera, false);
  renderer.warmEnd();
  renderer.setScene(cine.scene, cine.camera, false);
}

// Stalls over 50 ms, with what was on screen (tools/transition_test.py reads this).
const longTasks: { t: number; ms: number; state: string; mode?: string; covered: boolean }[] = [];
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), state, mode: game?.mode, covered: +(document.getElementById('fade')!.style.opacity || 0) >= 0.99 }); }).observe({ type: 'longtask', buffered: true });
} catch { /* not supported */ }

async function boot() {
  setTextureWarmer((t) => renderer.renderer.initTexture(t));
  setPortraitRenderer(renderer.renderer);
  ui.show('loading', false);
  showTitle();
  const redrawSafety = showSafetyCard(ui);
  if (redrawSafety) onLangChange(() => { if (!consentGiven()) redrawSafety(); });
  requestAnimationFrame(frame);
  const btns = ['btn-new', 'btn-continue'].map((id) => document.getElementById(id) as HTMLButtonElement);
  // the crew load alongside the world: only the people on screen first are awaited
  const crewReady = preloadCrew(['scientist', 'explorer', 'custom_m_scientist', 'custom_f_scientist'], detail());
  const crewAll = preloadCrew(['strong', 'medic', 'builder', 'social', 'megazron'], detail());
  await world.build((p) => ui.setLoading(p));
  await crewReady.catch((e) => console.warn('[crew]', e));
  player = new Player(world.terrain, world.forest, camera, quality.name === 'mobile' ? 0.6 : 1);
  player.sensitivity = settings.sensitivity;
  player.invertY = settings.invertY;
  world.scene.add(player.model.root);
  game = new Game(world, player, input, ui, (id) => touch.highlight(id), (text) => ui.hint(text));
  game.away = new Away(camera, input, ui, detail(), (sc) => (sc ? renderer.setScene(sc, camera, false) : renderer.setScene(world.scene, camera, true)));
  game.onLevelComplete = onLevelDone;
  game.timersOff = !!settings.noTimers;
  // warm up shaders so the first in-game frame doesn't hitch
  player.spawn(0, 2, 0.35);
  world.update(0.016, 0, 8.2, player.pos, camera, renderer.renderer);
  game.story.npcs.prepare();
  // the default look is set up now, so an unchanged Begin rebuilds nothing
  await crewAll.catch(() => {});
  applyPlayer(defaultLook(), {});
  stage.rebuild(defaultLook());
  await player.model.whenReady;
  await warmAll();
  worldReady = true;
  btns.forEach((b) => (b.disabled = false));
  if (pendingStart) { const f = pendingStart; pendingStart = null; f(); }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  cine.camera.aspect = camera.aspect;
  cine.camera.updateProjectionMatrix();
  vault.camera.aspect = camera.aspect;
  vault.camera.updateProjectionMatrix();
});

// Small hook used by the automated smoke test and for debugging.
(window as unknown as Record<string, unknown>).__bs = {
  get state() { return state; },
  get mode() { return game?.mode; },
  get ready() { return worldReady; },
  get paused() { return paused; },
  get endings() { return game?.save ? { stay: endingFor(game.save, 'stay', ENDINGS).id, home: endingFor(game.save, 'home', ENDINGS).id } : null; },
  get inputState() { return { keys: Array.from(input.keys), enabled: input.enabled, active: document.activeElement?.tagName, activeId: document.activeElement?.id, mode: game?.mode, pose: player?.pose, vel: player?.vel.toArray(), onGround: player?.onGround, water: player?.inWater, blocked: player?.blockedDeep }; },
  get longTasks() { return longTasks; },
  sceneTest(id: 'l3' | 'l7' | 'ch1' | 'intro' | 'fight') { if (id === 'fight') playFlashback(() => backToWorld()); else playVault(id, backToWorld); },
  nextBeat() { cine.debugNext(); game?.scene?.debugNext(); },
  get frameReport() { return frameReport; },
  /** The branch system, for the smoke tests. */
  branch: {
    get open() { return ui.choice.open || !!game?.dialogue.deciding; },
    get remaining() { return ui.choice.remaining ?? game?.dialogue.remaining ?? null; },
    get state() { return game?.save.branch; },
    comments(scene: string) { return game ? pickComments(game.save, COMMENTS, scene) : []; },
    demo(id: string) { game?.debugBranch({ choice: id }); },
    demoQte(id: string) { game?.debugBranch({ qte: id }); },
    /** How a beat plays for a crewmate who is dead, in a throwaway story. */
    lineIfDead(id: string, l: { key: string; who: string; fallback?: string }) {
      const s = { ...newSave(), branch: { ...emptyBranch(), dead: { [id]: { cause: 'test', level: 1 } } } };
      return resolveLine(s, l);
    },
    get savedLog() { const raw = localStorage.getItem('bs-save-v1'); return raw ? (JSON.parse(raw) as SaveData).branch?.log ?? [] : []; },
  },
  get npcs() { return game?.story.npcs.debug(); },
  get craft() { return game?.craft.debug() ?? null; },
  get talk() { return game?.dialogue.debug() ?? null; },
  get consent() { return consentGiven(); },
  get tech() { return { ages: [...AGES], nodes: TECH.map((n) => ({ id: n.id, age: n.age, status: n.status, requires: n.requires, state: game?.save ? techState(game.save, n) : null })) }; },
  get subtitleText() { return document.querySelector('#subtitle .line')?.textContent; },
  sayTest(k: string) { ui.subtitle(k, 'mz.name', true); },
  get voice() { return { last: voice.lastKey, played: voice.played }; },
  voiceDuration(k: string) { return voice.duration(k); },
  get vault() { return { playing: vault.playing, line: vault.lineIndex }; },
  skip() { skipCurrent(); },
  get tutorial() { const tu = game?.tutorial; return tu?.active ? { step: tu.step, index: tu.index } : null; },
  get device() { return input.device; },
  tutorialNext() { game?.tutorial.finish(true); game?.tutorial.start(); },
  get level() { return game?.save?.level; },
  setTime(h: number) { if (game?.save) game.save.timeOfDay = h; },
  cineSeek(t: number) { cine.seek(t); },
  /** Freeze the clock (true) and step it by hand; `frames` counts finished steps. */
  hold(on: boolean) { hold.on = on; film.manual = on; },
  advance(sec: number) { hold.pending = sec; },
  get frames() { return hold.done; },
  film: { get fx() { return film.lensFx; }, get video() { return film.videoOn; }, seek(b: number) { film.seek(b); }, get playing() { return film.playing; }, get beat() { return film.beat; }, get seconds() { return film.lengthSeconds; }, start() { state = 'film'; renderer.setScene(cine.scene, cine.camera, false); ui.show('title', false); ui.show('cine', true); ui.fade('black', 0, 0); void film.play(() => {}); } },
  stageInfo() { return renderer.stageInfo(); },
  goAway(id: CrewId, loc: string) { game?.goAway(id, loc); },
  get away() { const a = game?.away; return a?.active ? { who: a.who, next: a.next?.id ?? null, done: [...a.done], pos: a.position?.toArray() } : null; },
  get revealDue() { return !!game?.revealDue; },
  /** Ground truth for tests: the drawn surface under the feet and under the camera, by ray, against what is drawn. */
  groundProbe() {
    const a = game?.away, on = a?.active && a.stage;
    const ray = new THREE.Raycaster(), D = new THREE.Vector3(0, -1, 0);
    const targets: THREE.Object3D[] = [];
    if (on) a.stage!.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !(m as THREE.InstancedMesh).isInstancedMesh && m.geometry.type === 'PlaneGeometry') targets.push(m); });
    else world.terrain.group.children.forEach((c) => { const l = c as THREE.LOD; if (l.isLOD) targets.push(l.levels[0].object); });
    const down = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 600, z), D); ray.far = 1200; const h = ray.intersectObjects(targets, false)[0]; return h ? h.point.y : null; };
    const body = on ? a.position! : player.pos;
    const cam = camera.position;
    const grounded = on ? a.grounded : player.onGround;
    return { x: body.x, z: body.z, feet: body.y, drawn: down(body.x, body.z), cam: cam.y, camDrawn: down(cam.x, cam.z), mode: game?.mode, grounded };
  },
  swimProbe() { return { x: player.pos.x, y: player.pos.y, depth: -world.terrain.height(player.pos.x, player.pos.z), swimming: player.swimming }; },
  awayLeave() { game?.away?.leave(); },
  awayGoNext() { const k = game?.away?.next; if (k) game!.away!.teleport(k.pos.x, k.pos.z); },
  cineTime() { return cine.time; },
  get stagePlaying() { return cine.staged; },
  gameScene(id: 'rescue' | 'camp' | 'beacon') { game?.debugScene(id); },
  wakeSeek(t: number) { game?.debugWakeSeek(t); },
  look(yaw: number, pitch: number) { if (player) { player.yaw = yaw; player.pitch = pitch; player.snapCamera(); } },
  teleport(x: number, z: number, yaw = 0) { player?.spawn(x, z, yaw); },
  /** Teleport next to the current objective (marker target). */
  gotoObjective(offset = 0.6) {
    const m = game?.story.busy || (game?.save.level === 7 && game.story.houndEngaged()) ? null : game?.objectivePoint();
    if (!m || !player) return null;
    player.spawn(m.x + offset, m.z + offset * 0.5, player.yaw);
    return [m.x, m.z];
  },
  act() { return game?.debugAct() ?? null; },
  /** Freeze the camera at `from` looking at `to` (null releases it). */
  photo(from: number[] | null, to?: number[]) { photo = from && to ? { from: new THREE.Vector3(...from), to: new THREE.Vector3(...to) } : null; },
  step(sec: number) { game?.debugStep(sec, elapsed); },
  get save() { return game?.save; },
  get wheelOpen() { return wheel.open; },
  get binds() { return input.binds; },
  get prompt() { const el = document.getElementById('prompt')!; return el.classList.contains('hidden') ? null : el.textContent; },
  get hound() { return game?.story.debugHound(); },
  groundAt(x: number, z: number) { return world.terrain.height(x, z); },
  get crew() { return game?.story.debugCrew(); },
  get layout() { const L = world.layout; return L ? Object.fromEntries(Object.entries(L).map(([k, v]) => [k, (v as THREE.Vector3).toArray()])) : null; },
  quality: quality.name,
  get world() { return world; },
  get debug() {
    return { frames: frameCount, t: elapsed, mode: game?.mode, player: player?.pos.toArray(), cam: camera.position.toArray(), yaw: player?.yaw, creature: world.creature?.position.toArray() };
  },
};

boot();
