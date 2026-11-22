import { Combat, defaultCombatSettings } from './combat/combat';
import './style.css';
import * as THREE from 'three';
import { BATCH, batchSupported } from './core/ibatch';
import { clipProbe, clipStats, type ClipHit } from './core/clipprobe';
import { NEAR_FADE } from './core/nearfade';
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
import { initAndroid, isNativeApp } from './core/android';
import { Wheel } from './ui/wheel';
import { MapPin, interactiveMap, planetLayer } from './ui/map';
import { Minimap, MapLayer, MapPoint, routeOf } from './ui/minimap';
import { PERF, perfFrame } from './core/perfhud';
import { GpsTrail } from './world/gps';
import type { AwayStage } from './game/away/stage';
import type { MenuTab } from './ui/ui';
import { setPortraitCast, setPortraitRenderer, portraitFrame } from './ui/portraits';
import { preloadCrew } from './characters/character';
import { setKtx2Renderer, setTextureWarmer } from './core/assets';
import { defaultLook, PlayerLook, CrewSkins } from './characters/custom';
import { voice } from './core/voice';
import { frameReport } from './cinematic/cutscene';
import { Vault, vaultScript } from './narrator/vault';
import { Montage } from './cinematic/montage';
import { onLangChange } from './i18n';
import { fitFov, lockViewport, tryFullscreen } from './core/viewport';
import { startFit, auditFit, fitState, refitAll } from './ui/fit';
import { canvasFitStats } from './core/canvastext';
import { soundscape, soundscapeState } from './core/soundscape';
import { CLOTH_HOLES, UNDER_CLOTH, HANDS } from './characters/character';
import { TECH, AGES } from './game/tech/data';
import { techState } from './game/tech/tech';
import { openCodex, showSafetyCard, consentGiven, stopSpeech } from './ui/science';

type State = 'loading' | 'title' | 'cinematic' | 'game' | 'narrator' | 'film' | 'flashback';
// the playable prologue opens every new game; ?prologue=0 (tests) or the settings switch (replays) skip it
const PROLOGUE_PARAM = new URLSearchParams(location.search).get('prologue');

const canvas = document.getElementById('c') as HTMLCanvasElement;
lockViewport();
const settings: Settings = loadSettings();
setLang(settings.lang);
startFit();
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
  renderer.renderer.info.autoReset = false; // counted per frame, over every pass (perfhud.ts)
  // the forest draws one call per material where the browser has instanced multi-draw (core/ibatch.ts); ?batch=0 is the old way
  BATCH.on = new URLSearchParams(location.search).get('batch') !== '0' && batchSupported(renderer.renderer);
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
document.getElementById('version-badge')!.textContent = `v${__APP_VERSION__}`;
document.getElementById('btn-download')!.classList.toggle('hidden', !!desktop || isPhone() || isNativeApp());
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
/** Your own body is the one always in front of the camera: phones draw it with the full build (the light one's coat
 * showed specks of what is under it from the follow camera). */
const PLAYER_DETAIL = () => Math.max(detail(), 0.8);
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
let lastSkins: CrewSkins = {};
function applyPlayer(look: PlayerLook, skins: CrewSkins) {
  setPlayer(look);
  lastSkins = skins; if (game?.away) game.away.skins = skins;
  applyCrewNames(look.name ? { scientist: look.name } : {});
  setPortraitCast(look, skins, detail());
  // rebuilding figures is expensive: only when the look really changed
  const key = JSON.stringify([{ ...look, name: '' }, skins]);
  if (key === castKey) return;
  castKey = key;
  cine.setCast(look, skins);
  if (player) player.setLook(look, PLAYER_DETAIL(), () => game?.story.reattachSpear());
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
  }, refreshTitle, replayOpening);
}

/** The whole opening again (chapter select), in the replay slot with your own look and names; the story stays as it was. */
function replayOpening() {
  const base = loadSave();
  audio.start();
  if (input.device === 'touch') tryFullscreen();
  useSlot('replay');
  clearSave();
  pendingLook = base?.player ?? defaultLook();
  pendingNames = { ...(base?.names ?? {}) } as CrewNames;
  applyPlayer(pendingLook, settings.skins ?? {});
  ui.show('title', false);
  void voice.load();
  playOpening(true, true);
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
  // MegaZroN's cold open, the playable Zenvora prologue and the take-off, then the films and the wake-up
  const prologue = PROLOGUE_PARAM !== null ? PROLOGUE_PARAM !== '0' : !settings.skipPrologue;
  playOpening(prologue, false);
}

/**
 * The opening, in order: MegaZroN in the Vault (the cold open), the title card and Zenvora on the last normal
 * afternoon, the six boarding and the liner lifting off over the city, a card for orbit, then the deck, the title
 * sequence and the wake-up. Every scene has its Skip. `replay` (chapter select) plays it in the replay slot and
 * ends on the title screen; ?prologue=0 and the settings switch leave the city out.
 */
function playOpening(withCity: boolean, replay: boolean) {
  const films = () => {
    state = 'cinematic';
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    renderer.setScene(cine.scene, cine.camera, false);
    cine.start(() => playFilm(replay));
  };
  playVault('intro', () => (withCity ? playPrologue(() => titleCard(films, 'takeoff.card')) : films()));
}

/** Black, then one line: the planet and the year (or, after the take-off, where the liner is). Nothing else. */
function titleCard(then: () => void, key = 'city.title') {
  const el = document.createElement('div');
  el.id = 'title-card'; el.textContent = t(key);
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000;color:#f2ead8;font:600 clamp(28px,5vw,64px) Rajdhani,sans-serif;letter-spacing:.35em;opacity:0;transition:opacity 1.2s;z-index:60';
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = '1'));
  setTimeout(() => { el.style.opacity = '0'; }, 3400);
  setTimeout(() => { el.remove(); then(); }, 4700);
}

/** Zenvora: the player's list on the last normal afternoon, then the opening films. */
function playPrologue(then: () => void) {
  ui.fade('black', 1, 0.4);
  // the city is built and its shaders compiled while the title card is up, not in the first frame after it
  let ready: Promise<unknown> = Promise.resolve();
  setTimeout(() => { if (!game?.away) return; const st = game.away.prepare('city'); ready = renderer.precompile(st.scene, camera); }, 300);
  // after the card, black until the city's shaders are compiled (at most a few seconds more), not a frozen first frame
  titleCard(() => { ui.show('loading', true); void Promise.race([ready, new Promise((r) => setTimeout(r, 25000))]).then(() => whenWorldReady(() => {
    ui.show('loading', false);
    state = 'game';
    const save = newSave(); save.names = { ...pendingNames }; save.player = { ...pendingLook }; save.skins = settings.skins ?? {};
    applyPlayer(save.player, save.skins);
    game.prologue(save, () => { input.enabled = false; ui.show('hud', false); ui.fade('black', 1, 0.8); setTimeout(then, 900); });
    ui.show('hud', true);
    input.enabled = true;
    ui.fade('black', 0, 1.2);
  })); });
}

/** The title sequence, then the wake-up (or, replaying the opening, back to the title screen). */
function playFilm(replay = false) {
  state = 'film';
  ui.fade('black', 0, 0);
  ui.subtitle(null);
  void film.play(() => {
    ui.fade('black', 1, 0.2);
    setTimeout(() => (replay ? (useSlot('main'), ui.show('cine', false), showTitle(), ui.fade('black', 0, 0.8)) : whenWorldReady(() => enterWorld(true))), 240);
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
  // ?combat=<encounter>: straight into a set piece once play begins (recordings, tests)
  { const want = new URLSearchParams(location.search).get('combat'); if (want) { const go = () => { if (game.mode === 'play' && combat && !combat.encounter) combat.trial(want as Parameters<Combat['trial']>[0]); else setTimeout(go, 500); }; setTimeout(go, 800); } }
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
  else if (state === 'game' && game?.away?.outroOn) game.away.skipOutro();
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

// ---- the minimap, the full map and the GPS route ----
const minimap = new Minimap(document.getElementById('hud')!, () => { if (canPlay() && !paused) menuKey('map'); });
if (quality.name === 'mobile') minimap.interval = 0.16;
const gps = new GpsTrail();
let planetL: MapLayer | null = null;
const mapPlanet = () => (planetL ??= planetLayer((x, z) => world.terrain.height(x, z), quality.name === 'mobile' ? 360 : 720));
const heading = () => { const d = camera.getWorldDirection(new THREE.Vector3()); return Math.atan2(d.x, -d.z); };
/** What the map is of right now, where you are, where the objective is, and who is worth finding. */
function navState() {
  const away = game?.away?.active ? game.away : null, st = away?.stage as AwayStage | null | undefined;
  const layer: MapLayer | null = away ? st?.mapLayer ?? null : game?.mode === 'play' ? mapPlanet() : null;
  const pos = away ? away.position : player?.pos;
  const goalV = away ? away.next?.pos ?? null : game?.objectivePoint() ?? null;
  const pts: MapPoint[] = [];
  if (away && st) for (const k of st.tasks) if (k.optional && k.id.startsWith('talk.')) pts.push({ x: k.pos.x, z: k.pos.z, kind: 'person' });
  if (!away && world?.layout) pts.push({ x: world.layout.camp.x, z: world.layout.camp.z, kind: 'place' });
  return { layer, pos, goal: goalV ? { x: goalV.x, z: goalV.z } : null, pts, ground: away && st ? (x: number, z: number) => st.height(x, z) : (x: number, z: number) => world.terrain.height(x, z), scene: away && st ? st.scene : world.scene };
}
let navT = 0, navCache: ReturnType<typeof navState> | null = null;
let navRoute: [number, number][] | null = null, navTgt: { x: number; z: number } | null = null;
function navFrame(dt: number) {
  const on = state === 'game' && !!game && (game.mode === 'play' || game.mode === 'away') && !paused && !photo && !game.away?.outroOn;
  minimap.el.classList.toggle('off', !on);
  if (!on) { gps.update(null, () => 0, elapsed); return; }
  navT -= dt;
  const fresh = navT <= 0 || !navCache;
  if (fresh) { navT = 0.25; navCache = navState(); }
  const n = navCache!;
  minimap.setLayer(n.layer);
  if (!n.pos || !n.layer) { gps.update(null, () => 0, elapsed); return; }
  const tgt = minimap.target(n.pos.x, n.pos.z, n.goal);
  // the route is worked out four times a second, not every frame (the chevrons still move every frame)
  if (fresh || !tgt || tgt !== navTgt) { navTgt = tgt; navRoute = tgt ? routeOf(n.layer, n.pos.x, n.pos.z, tgt.x, tgt.z) : null; }
  const route = navRoute;
  const pts = [...n.pts];
  if (n.goal) pts.push({ ...n.goal, kind: 'goal' });
  if (minimap.waypoint) pts.push({ ...minimap.waypoint, kind: 'way' });
  minimap.draw(dt, n.pos.x, n.pos.z, heading(), pts, route);
  gps.attach(n.scene);
  gps.update(route && Math.hypot(tgt!.x - n.pos.x, tgt!.z - n.pos.z) > 6 ? route : null, n.ground, elapsed);
}

// ?demo=city: a self-playing tour that films itself (src/core/demo.ts), for recording on a real GPU in a plain browser
if (new URLSearchParams(location.search).get('demo') === 'city') void import('./core/demo').then(({ runDemo }) => runDemo({
  canvas: renderer.renderer.domElement, minimap: minimap.el,
  state: () => ({ state, mode: game?.mode ?? '', away: !!(game?.mode === 'away' && game.away?.active && game.away.who) }),
  skip: () => skipCurrent(),
  player: () => { const p = (game?.away as unknown as { player?: Player } | undefined)?.player; return p ? { pos: p.pos, yaw: p.yaw, setYaw: (y: number) => { p.yaw = y; } } : null; },
  teleport: (x, z, yaw) => game?.away?.teleport(x, z, yaw),
  setWaypoint: (w) => { minimap.waypoint = w; navT = 0; },
  route: () => { const n = navCache, pos = n?.pos, tg = pos ? minimap.target(pos.x, pos.z, n!.goal) : null; return pos && tg && n?.layer ? routeOf(n.layer, pos.x, pos.z, tg.x, tg.z) : null; },
  hold: (code, on) => { if (on) input.keys.add(code); else input.keys.delete(code); },
  task: () => game?.away?.next?.label ?? '',
}));

function openMapTab() {
  ui.openMap(resume);
  const n = navState();
  const layer = n.layer ?? mapPlanet(), pos = n.pos ?? player.pos;
  const pins: MapPin[] = [];
  if (!game.away?.active) {
    const L = world.layout;
    pins.push({ x: L.camp.x, z: L.camp.z, icon: 'camp', label: t('map.camp') });
    for (const [x, z] of game.save.favours?.pins ?? []) pins.push({ x, z, icon: 'marker', cls: 'scout', label: t('crew.explorer.name') });
  }
  if (n.goal) pins.push({ x: n.goal.x, z: n.goal.z, icon: 'marker', cls: 'goal', label: (game.away?.active ? game.away.next?.label : document.getElementById('obj-title')!.textContent) ?? '' });
  interactiveMap(layer, { x: pos.x, z: pos.z, heading: heading() }, pins, { get: () => minimap.waypoint, set: (p) => { minimap.waypoint = p; navT = 0; } },
    `${game.away?.active ? '' : t('map.note') + ' '}${t('map.hint')}`);
}

function showTab(tab: MenuTab) {
  stopSpeech();
  if (tab !== 'pause') game.notePanel(tab);
  if (tab === 'pause') {
    ui.openPause({
      resume,
      // fights on their own (or, in the middle of one, the way out of it)
      action: game.mode === 'play' && combat ? () => { if (combat!.encounter) { ui.closeModal(); combat!.leaveEncounter(); resume(); } else combat!.openMenu(() => showTab('pause'), () => resume()); } : undefined,
      actionLabel: combat?.encounter ? 'cb.p.leave' : 'cb.menu',
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
function invStart(at = performance.now()) { if (canPlay() && !wheel.open) invT0 = at; }
/**
 * Tap or hold is decided by how long the input was really down (the events' own times), not by when the next frame
 * ran: after a slow frame a quick tap had already opened the wheel, and letting go then closed it, so the list never opened.
 */
function invEnd(at = performance.now()) {
  if (!invT0) return;
  const held = at - invT0;
  invT0 = 0;
  if (wheel.open && held >= HOLD_MS) wheel.close(true);
  else { if (wheel.open) wheel.close(false); openPanel('inventory'); }
}
const HOLD_MS = 220;

/** Menu shortcuts: the same input closes what it opened. */
function menuKey(tab: MenuTab) {
  if (ui.modalOpen()) { if (paused) resume(); } else openPanel(tab);
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'game' && !paused && !suppressPauseOnUnlock) openPause();
  suppressPauseOnUnlock = false;
});
input.onPadLost(() => { if (input.device === 'pad') openPause(); });

const inScene = () => state === 'cinematic' || state === 'film' || state === 'narrator' || state === 'flashback' || (state === 'game' && (game.mode === 'wake' || game.mode === 'scene' || !!game.away?.outroOn));

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
    if (ui.modalOpen()) menuKey('inventory'); else if (!e.repeat) invStart(e.timeStamp);
  }
});
window.addEventListener('keyup', (e) => { if (input.actionFor(e.code) === 'inventory') invEnd(e.timeStamp); });

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
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'game' && game?.mode === 'play') game.persist();
  audio.sleep(document.hidden); // phones keep a page's sound playing behind other apps otherwise
});

// The Android app: back closes the top menu, pauses play or skips a scene; on the title it asks before leaving.
void initAndroid({
  back() {
    if (inScene()) { skipCurrent(); return true; }
    if (nav.back()) return true;
    if (ui.modalOpen() && paused) { resume(); return true; }
    if (state === 'game') { openPause(); return true; }
    return false;
  },
  hidden() { if (state === 'game' && game?.mode === 'play') game.persist(); openPause(); },
  exitQuestion: () => t('app.exit'),
});

// ---------------- boot ----------------
let combat: Combat | null = null;
const clock = new THREE.Timer(); // THREE.Clock is deprecated (a console warning every load)
clock.connect(document);
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fpsLast = performance.now();

let frameCount = 0;
/** Test hook: frames only move when asked, by a fixed step, so a slow GPU sees the same film. */
const hold = { on: false, pending: 0, done: 0 };
function frame() {
  requestAnimationFrame(frame);
  frameCount++;
  clock.update();
  const real = Math.min(clock.getDelta(), 0.05);
  if (!hold.on) { const t0 = performance.now(); tick(real); const t1 = performance.now(); draw(real); perfFrame(renderer.renderer, real, t1 - t0, performance.now() - t1); return; }
  if (hold.pending <= 0) return;
  for (let left = hold.pending; left > 1e-6; left -= 1 / 30) tick(Math.min(left, 1 / 30));
  hold.pending = 0;
  draw(1 / 30);
  perfFrame(renderer.renderer, 1 / 30, 0, 0);
  hold.done++;
}

function tick(step: number) {
  let dt = step;
  // a blow that lands holds the frame for a moment; slow-motion assist stretches the dangerous ones
  if (state === 'game' && combat && !paused) dt = combat.scaleTime(dt);
  elapsed += dt;
  input.poll(dt);
  nav.update();
  padFrame();
  if (invT0 && !wheel.open && performance.now() - invT0 > HOLD_MS && canPlay()) wheel.show(game.save.inventory, game.story.tools());
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
    touch.show(input.device === 'touch' && (game.mode === 'play' || game.mode === 'away') && !paused && !ui.modalOpen());
    touch.update();
    if (!paused && game.mode !== 'dead') game.update(dt, elapsed);
    // after the update: a prompt set this frame is placed this frame, never drawn once in the corner
    if (state === 'game') ui.track(camera);
    const focus = player.pos;
    if (photo) { camera.position.copy(photo.from); camera.lookAt(photo.to); }
    world.update(paused ? 0 : dt, elapsed, game.save.timeOfDay, focus, camera, renderer.renderer, renderer.stageInfo().scene === world.scene);
  }
  navFrame(dt);
  if (stage.active) stage.update(dt);
  soundscape({
    state, mode: game?.mode, away: game?.away?.where ?? null, indoors: game?.away?.indoors, hours: state === 'game' ? game?.save?.timeOfDay : undefined,
    pos: state === 'game' && game?.mode !== 'away' ? player?.pos : undefined, danger: state === 'game' && (!!game?.story?.houndEngaged() || !!combat?.threat),
    fire: state === 'game' && game?.save?.flags.fire ? world.layout?.camp ?? null : null,
    // weather, when the world has it (an optional `weather.rain` 0..1 on the world or the away stage)
    rain: (game?.away?.active ? (game.away as unknown as { stage?: { weather?: { rain?: number } } }).stage?.weather?.rain : (world as unknown as { weather?: { rain?: number } }).weather?.rain) ?? 0,
    dt: paused ? 0 : dt,
  });
}
const earFwd = new THREE.Vector3();

function draw(dt: number) {
  // portrait screens: widen the vertical FOV so the horizontal view stays usable
  const activeCam = stage.active ? stage.camera : state === 'game' ? camera : state === 'narrator' ? vault.camera : state === 'film' && film.inWorld ? film.wcam : cine.camera;
  const designFov = activeCam.fov;
  activeCam.getWorldDirection(earFwd);
  audio.listen(activeCam.position, earFwd);
  fitFov(activeCam);
  // props that pass right by the follow camera dissolve; cutscenes and films are framed by hand
  NEAR_FADE.value = state === 'game' && game && (game.mode === 'play' || game.mode === 'away' || game.mode === 'dead') && !photo ? 1 : 0;
  portraitFrame();
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
  // each scene's programs are first compiled in the background (renderer.prewarm: the page and the title's buttons keep
  // working, the loading bar shows how far it is), then drawn once through the real pipeline for what only a draw
  // builds (the shadow and AO passes' variants, the uploads)
  const STEPS = 5; let step = 0;
  const pre = async (sc: THREE.Scene, cam: THREE.Camera) => { await renderer.prewarm(sc, cam, (k) => ui.setLoading(0.9 + 0.1 * Math.min(1, (step + k) / STEPS))); step++; };
  renderer.warmBegin();
  // the world from the spawn point, in every direction: the wake-up turns the camera around
  const wide = new THREE.PerspectiveCamera(100, 16 / 9, 0.1, 2400);
  wide.position.copy(player.pos).add(new THREE.Vector3(0, 1.7, 0));
  wide.updateMatrixWorld();
  renderer.setScene(world.scene, wide, true);
  await pre(world.scene, wide);
  for (let i = 0; i < 4; i++) {
    wide.rotation.set(0, (i / 4) * Math.PI * 2, 0);
    wide.updateMatrixWorld();
    renderer.warm(world.scene, wide, true);
    await breathe();
  }
  await cine.warm(async (sc, cam) => { await pre(sc, cam); renderer.warm(sc, cam, false); });
  await breathe();
  film.warmStages((sc, cam) => renderer.warm(sc, cam, false));
  await breathe();
  vault.prepare();
  await pre(vault.scene, vault.camera);
  renderer.warm(vault.scene, vault.camera, false);
  await breathe();
  stage.update(0.016);
  await pre(stage.scene, stage.camera);
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
  setKtx2Renderer(renderer.renderer);
  setPortraitRenderer(renderer.renderer);
  ui.show('loading', false);
  showTitle();
  const redrawSafety = showSafetyCard(ui);
  if (redrawSafety) onLangChange(() => { if (!consentGiven()) redrawSafety(); });
  // the title's first frame waits until its programs (its scene's and the post chain's) are linked in the background:
  // drawn at once it linked twenty-six of them on the main thread, a freeze of up to 20 s on a cold shader cache. The
  // page (its buttons, the loading bar) keeps working meanwhile, and the world loads alongside
  void Promise.all([renderer.prewarm(cine.scene, cine.camera, undefined, 30000), renderer.prewarmPost(30000)]).catch(() => {}).then(() => requestAnimationFrame(frame));
  const btns = ['btn-new', 'btn-continue'].map((id) => document.getElementById(id) as HTMLButtonElement);
  // the crew load alongside the world: only the people on screen first are awaited
  const crewReady = preloadCrew(['scientist', 'explorer', 'custom_m_scientist', 'custom_f_scientist'], detail());
  const crewAll = preloadCrew(['strong', 'medic', 'builder', 'social', 'megazron'], detail());
  await world.build((p) => ui.setLoading(p));
  await crewReady.catch((e) => console.warn('[crew]', e));
  player = new Player(world.terrain, world.forest, camera, PLAYER_DETAIL());
  player.sensitivity = settings.sensitivity;
  player.invertY = settings.invertY;
  world.scene.add(player.model.root);
  game = new Game(world, player, input, ui, (id) => touch.highlight(id), (text) => ui.hint(text));
  game.away = new Away(camera, input, ui, detail(), (sc) => (sc ? renderer.setScene(sc, camera, false) : renderer.setScene(world.scene, camera, true)));
  game.away.skins = lastSkins;
  // the take-off from Zenvora is a scene like any other: letterboxed, with its Skip
  game.away.onOutro = (on) => {
    // the liner lifts off: engines, then the long roar of the climb
    if (on) { audio.sample('launch', 0.85, { delay: 1.2 }); audio.sample('thruster', 0.5, { delay: 0.6 }); }
    ui.show('cine', on); ui.show('hud', !on);
    document.getElementById('btn-skip')!.classList.toggle('hidden', !on);
  };
  combat = new Combat({ world, player, input, ui, save: () => game.save, settings: () => (settings.combat ??= defaultCombatSettings()), saveSettings: persistSettings,
    free: () => state === 'game' && game.mode === 'play' && !paused && !ui.modalOpen(), persist: () => game.persist(), home: () => game.mode !== 'away' });
  game.combat = combat;
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
  /** Frame budget: fps, update and draw ms, draw calls, triangles, bodies drawn (tools/perf_gate.py, ?perf=1). */
  get perf() { return { ...PERF }; },
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
  get voice() { return { last: voice.lastKey, played: voice.played, cuts: voice.cuts, remaining: voice.remaining() }; },
  voiceDuration(k: string) { return voice.duration(k); },
  get vault() { return { playing: vault.playing, line: vault.lineIndex }; },
  skip() { skipCurrent(); },
  get tutorial() { const tu = game?.tutorial; return tu?.active ? { step: tu.step, index: tu.index } : null; },
  get device() { return input.device; },
  tutorialNext() { game?.tutorial.finish(true); game?.tutorial.start(); },
  get level() { return game?.save?.level; },
  setTime(h: number) { if (game?.save) game.save.timeOfDay = h; },
  cineSeek(t: number) { cine.seek(t); },
  /** Where the cinematic camera is and what it looks at, and the cockpit's yoke and pilot (debugging shots). */
  cineCam() { const c = cine as unknown as { camera: THREE.Camera; ins: { stick: THREE.Object3D; cockpit: THREE.Object3D }; pilot: { root: THREE.Object3D; handR: THREE.Object3D } }; const w = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)); return { cam: w(c.camera), dir: c.camera.getWorldDirection(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), stick: w(c.ins.stick), cockpit: w(c.ins.cockpit), pilot: w(c.pilot.root), handR: w(c.pilot.handR), t: (cine as unknown as { time: number }).time }; },
  /** Freeze the clock (true) and step it by hand; `frames` counts finished steps. */
  hold(on: boolean) { hold.on = on; film.manual = on; voice.manual = on ? () => elapsed : null; audio.manual = on ? () => elapsed : null; },
  /** What was played on the held clock: lines, sounds, music, beds (laid under recorded frames). */
  get soundLog() { return [...voice.log, ...audio.log]; },
  get clock() { return elapsed; },
  advance(sec: number) { hold.pending = sec; },
  get frames() { return hold.done; },
  film: { get fx() { return film.lensFx; }, get video() { return film.videoOn; }, seek(b: number) { film.seek(b); }, get playing() { return film.playing; }, get beat() { return film.beat; }, get seconds() { return film.lengthSeconds; }, start() { state = 'film'; renderer.setScene(cine.scene, cine.camera, false); ui.show('title', false); ui.show('cine', true); ui.fade('black', 0, 0); void film.play(() => {}); } },
  stageInfo() { return renderer.stageInfo(); },
  /** Test hook: the WebGLRenderer, for tools that count what each draw call is (tools/frame_time.py --census). */
  get gl() { return renderer.renderer; },
  /** The renderer wrapper (post chain, resolution), for GPU experiments in tools/gpu_tour.py plans. */
  get rnd() { return renderer; },
  goAway(id: CrewId, loc: string) { game?.goAway(id, loc); },
  get away() { const a = game?.away; return a?.active ? { who: a.who, next: a.next?.id ?? null, done: [...a.done], pos: a.position?.toArray() } : null; },
  get revealDue() { return !!game?.revealDue; },
  /** Ground truth for tests: the drawn surface under the feet and under the camera, by ray, against what is drawn. */
  groundProbe() {
    const a = game?.away, on = a?.active && a.stage;
    const ray = new THREE.Raycaster(), D = new THREE.Vector3(0, -1, 0);
    const targets: THREE.Object3D[] = [];
    if (on) a.stage!.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !(m as THREE.InstancedMesh).isInstancedMesh && (m.userData.ground ?? m.geometry.type === 'PlaneGeometry')) targets.push(m); });
    else world.terrain.group.children.forEach((c) => { const l = c as THREE.LOD; if (l.isLOD) targets.push(l.levels[0].object); });
    const down = (x: number, z: number) => { ray.set(new THREE.Vector3(x, 600, z), D); ray.far = 1200; const h = ray.intersectObjects(targets, false)[0]; return h ? h.point.y : null; };
    const body = on ? a.position! : player.pos;
    const cam = camera.position;
    const grounded = on ? a.grounded : player.onGround;
    return { x: body.x, z: body.z, feet: body.y, drawn: down(body.x, body.z), cam: cam.y, camDrawn: down(cam.x, cam.z), mode: game?.mode, grounded };
  },
  swimProbe() { return { x: player.pos.x, y: player.pos.y, depth: -world.terrain.height(player.pos.x, player.pos.z), swimming: player.swimming }; },
  /** Test hook: where a person on the away stage is (their head, in the world) and which way they face. */
  awayPerson(id: string) {
    const q = (game?.away?.stage as { people?: { id: string; yaw: number; pos: THREE.Vector3; fig: { head: THREE.Object3D } }[] } | null)?.people?.find((p) => p.id === id);
    return q ? { head: q.fig.head.getWorldPosition(new THREE.Vector3()).toArray(), yaw: q.yaw, pos: q.pos.toArray() } : null;
  },
  /** Test hook for recordings: passers-by within r of a point are hidden (they walk through whoever stands on their line). */
  awayClear(x: number, z: number, r: number) {
    const ps = (game?.away?.stage as { people?: { pos: THREE.Vector3; walk?: unknown; fig: { root: THREE.Object3D } }[] } | null)?.people ?? [];
    for (const p of ps) if (p.walk) p.fig.root.visible = Math.hypot(p.pos.x - x, p.pos.z - z) > r;
  },
  /** Test hook: the people on the away stage, with their root objects (tools/crowd_smoke.py counts their draws). */
  awayPeople() {
    const ps = (game?.away?.stage as { people?: { id: string; pos: THREE.Vector3; walk?: unknown; fig: { root: THREE.Object3D } }[] } | null)?.people ?? [];
    return ps.map((p) => ({ id: p.id, walk: !!p.walk, pos: p.pos, root: p.fig.root }));
  },
  /** Test hook: the painted crowd near the camera (14 m), the real bodies walking it, and cards hidden with no body. */
  awayCrowd() { const st = game?.away?.stage as { crowdState?: () => { near: number; bodies: number; lost: number } } | null; return st?.crowdState?.() ?? { near: 0, bodies: 0, lost: 0 }; },
  /** Test hook: cars and people on the away stage this frame (tools/traffic_smoke.py). */
  awayTraffic() { return (game?.away?.stage as { trafficState?: () => unknown } | null)?.trafficState?.() ?? null; },
  /** Test hook: 'body', 'card' or 'none' for a person on the away stage (tools/crowd_smoke.py). */
  awayDrawnAs(id: string) { return (game?.away?.stage as { drawnAs?: (id: string) => string } | null)?.drawnAs?.(id) ?? 'none'; },
  get awayPerf() { return (game?.away?.stage as { perfState?: unknown } | null)?.perfState ?? null; },
  awayLeave() { game?.away?.leave(); },
  /** Test hook: every Zenvora task done at once, so the take-off plays now. */
  awayOutro() { game?.away?.debugOutro(); },
  /** Test hook: the take-off path's least clearance over the city (m; negative = the liner passes through something). */
  takeoffMap() { return JSON.stringify((game?.away?.stage as { takeoffMap?: () => unknown } | null)?.takeoffMap?.() ?? null); },
  takeoffFindPad() { return (game?.away?.stage as { takeoffFindPad?: () => unknown } | null)?.takeoffFindPad?.() ?? null; },
  takeoffFrame() { return (game?.away?.stage as { takeoffFrame?: (f?: number, a?: number) => unknown } | null)?.takeoffFrame?.(camera.fov, camera.aspect) ?? null; },
  takeoffClearance() { return (game?.away?.stage as { takeoffClearance?: () => unknown } | null)?.takeoffClearance?.() ?? null; },
  get awayOutroOn() { return !!game?.away?.outroOn; },
  awayGoNext() { const k = game?.away?.next; if (k) game!.away!.teleport(k.pos.x, k.pos.z); },
  awayTeleport(x: number, z: number, yaw = 0) { game?.away?.teleport(x, z, yaw); },
  get awayCam() { return game?.away?.camState ?? null; },
  holdSubs(on: boolean) { ui.holdSubs = on; },
  awayOrbit(o: { x: number; y: number; z: number; r: number; a: number; h: number } | null) { if (game?.away) game.away.orbit = o; },
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
  /** Fights: state for the tests, and the way to start a set piece (tools/combat/play_test.py). */
  get combat() { return combat; },
  /** The player's body: kneeling (0..1), the game mode, where the hips are (checks of the kneel in Episode One). */
  get body() { const m = (game as unknown as { player?: { model: import('./characters/character').Character } } | null)?.player?.model; if (!m) return null; const h = new THREE.Vector3(); (m.root.getObjectByName('hips') ?? m.root).getWorldPosition(h); return { kneel: m.kneeling, mode: game!.mode, rootY: m.root.position.y, hipsY: h.y }; },
  groundAt(x: number, z: number) { return world.terrain.height(x, z); },
  /** Episode One for captures: the pool, the stream's centre line (every 10th point), the red fruit (1.1) and where he
   * kneels at the cobbles (1.3). */
  get e1() {
    if (!game) return null;
    const st = game.waking.stream;
    const k = game.stones.place().kneel;
    return { pool: st.pool, line: st.line.filter((_, i) => i % 10 === 0).map((p) => [p.x, p.y, p.z]), red: world.items.items.filter((i) => i.active && i.type === 'redFruit').map((i) => [i.pos.x, i.pos.z]), stones: [k.x, k.z] };
  },
  get crew() { return game?.story.debugCrew(); },
  get layout() { const L = world.layout; return L ? Object.fromEntries(Object.entries(L).map(([k, v]) => [k, (v as THREE.Vector3).toArray()])) : null; },
  /** Text fit: every string in every UI slot, in a language (tools/text_fit.py). fit=false measures the old layout. */
  fitAudit(lang: Lang, fit = true, menus = false) { setLang(lang); fitState.on = fit; const r = auditFit({ fit, menus }); fitState.on = true; refitAll(); return r; },
  setLang(l: Lang) { setLang(l); },
  get canvasFit() { return { ...canvasFitStats }; },
  get sound() { return soundscapeState(); },
  /** Repairs made to the characters' meshes since load (holes closed, texture and normal fixes, skin and cloth drawn as their cover). */
  get meshFixes() { return { ...CLOTH_HOLES, ...UNDER_CLOTH }; },
  /** Finger joints since load: largest bend from rest (rad) and fastest turn (rad/s), over every character drawn. */
  get hands() { return { ...HANDS }; },
  audioTap() { audio.start(); return audio.tap(); },
  /** Test: parts of bodies through the set or each other in the scene drawn now (src/core/clipprobe.ts). */
  clipProbe() { return clipProbe(renderer.renderPass.scene as THREE.Scene); },
  get clipStats() { return { ...clipStats }; },
  /** Test: seek the opening ('cine', seconds) or the title sequence ('film', beats) from a to b in steps, probe each
   *  frame after it is drawn; returns the hits with their time, worst first per (who, part, what). */
  async clipScan(which: 'cine' | 'film', a: number, b: number, step = 0.5) {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const all: (ClipHit & { t: number })[] = [];
    for (let t = a; t <= b + 1e-6; t += step) {
      if (which === 'cine') cine.seek(t); else film.seek(t);
      await raf(); await raf(); await raf();
      for (const h of clipProbe(renderer.renderPass.scene as THREE.Scene)) all.push({ ...h, t: Math.round(t * 100) / 100 });
    }
    const best = new Map<string, ClipHit & { t: number; n: number }>();
    for (const h of all) { const k = `${h.who}|${h.part}|${h.what}|${h.kind}`; const o = best.get(k); if (!o || h.depth > o.depth) best.set(k, { ...h, n: (o?.n ?? 0) + 1 }); else o.n++; }
    return [...best.values()].sort((x, y) => y.depth - x.depth);
  },
  /** Sync test for captures: every second, on the audio clock, a 1.5 kHz beep on the last audio node and a white screen in the
   *  same animation frame, held 0.15 s so a recording at a low frame rate still catches it. A recording of this shows
   *  any offset or drift between picture and sound as a number (tools/av_sync.py). */
  syncTest(secs = 30) { return syncFlash(secs, 1, 'position:fixed;inset:0;background:#fff', 1500); },
  /** Sync marks for every capture (tools/gpu_capture.py puts them at the start and end of each recording and aligns
   *  sound to picture by them): n 2 kHz beeps 0.6 s apart, each with a small white square in the top-left corner. */
  syncMark(n = 3) { return syncFlash(n, 0.6, 'position:fixed;left:0;top:0;width:48px;height:48px;background:#fff;outline:6px solid #000', 2000); },
  openMenu(which: 'settings' | 'legal' | 'chapters') { if (which === 'settings') document.getElementById('btn-settings')?.click(); else if (which === 'legal') document.getElementById('btn-legal')?.click(); else document.getElementById('btn-chapters')?.click(); },
  quality: quality.name,
  get world() { return world; },
  get debug() {
    return { frames: frameCount, t: elapsed, mode: game?.mode, player: player?.pos.toArray(), cam: camera.position.toArray(), yaw: player?.yaw, creature: world.creature?.position.toArray() };
  },
};

function syncFlash(n: number, gap: number, css: string, freq: number): number {
  audio.start(); const ctx = audio.ctx; if (!ctx) return 0;
  const el = document.createElement('div'); el.style.cssText = css + ';z-index:99999;pointer-events:none;opacity:0';
  document.body.appendChild(el);
  const t0 = ctx.currentTime + 0.25; let k = 0, on = -1;
  const tick = () => {
    const t = ctx.currentTime;
    if (on >= 0 && t - on >= 0.15) { el.style.opacity = '0'; on = -1; }
    if (on < 0 && k < n && t >= t0 + k * gap) { audio.mark(0.06, freq); el.style.opacity = '1'; on = t; k++; }
    if (k >= n && on < 0) { el.remove(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick); return t0;
}

boot();
