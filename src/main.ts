import { Combat, defaultCombatSettings } from './combat/combat';
import './style.css';
import * as THREE from 'three';
import { BATCH, batchSupported } from './core/ibatch';
import { clipProbe, clipStats, type ClipHit } from './core/clipprobe';
import { glitch, type GlitchKind } from './core/glitch';
import { NEAR_FADE } from './core/nearfade';
import { setLang, setPlayer, t, Lang } from './i18n';
import { detectQuality, isPhone, saveQualityChoice, QualityName, qualityFromUrl } from './core/quality';
import { desktop } from './core/desktop';
import { Away } from './game/away/away';
import type { CrewId } from './characters/character';
import { Renderer } from './core/renderer';
import { audio } from './core/audio';
import { loadSave, newSave, clearSave, loadSettings, writeSettings, useSlot, writeSave, SaveData, Settings } from './core/save';
import { UI } from './ui/ui';
import { Cinematic } from './cinematic/cinematic';
import { World } from './world/world';
import { Player } from './game/player';
import { Input } from './game/input';
import { Game } from './game/game';
import { applyCrewNames, CREW_IDS, CrewNames } from './core/crew';
import { CHAPTERS, COMMENTS, emptyBranch, pathView, pickComments, resolveLine, takenBranches, endingFor, ENDINGS } from './game/branch';
import type { Chapter } from './game/branch';
import { openingReady } from './game/branch/opening';
import { momentsReady } from './game/branch/moments';
import { DECISIONS, QTES } from './game/branch/registry';
import { MomentBranch } from './game/moments';
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
import { releaseGpu, setDisposeKeep } from './core/disposeTree';
import { GpsTrail } from './world/gps';
import type { AwayStage } from './game/away/stage';
import type { MenuTab } from './ui/ui';
import { setPortraitCast, setPortraitRenderer, portraitFrame } from './ui/portraits';
import { preloadCrew } from './characters/character';
import { setKtx2Renderer, setTextureWarmer, warmPending } from './core/assets';
import { defaultLook, PlayerLook, CrewSkins } from './characters/custom';
import { voice } from './core/voice';
import { frameReport } from './cinematic/cutscene';
import { Vault, vaultScript } from './narrator/vault';
import { Montage } from './cinematic/montage';
import { designOf } from './game/away/boarding';
import { onLangChange } from './i18n';
import { fitFov, lockViewport, tryFullscreen } from './core/viewport';
import { startFit, auditFit, fitState, refitAll } from './ui/fit';
import { canvasFitStats } from './core/canvastext';
import { auditTextFaces, probeTextFaces } from './core/textfaces';
import { FIRE_BASE } from './world/flame';
import { soundscape, soundscapeState } from './core/soundscape';
import { CLOTH_HOLES, UNDER_CLOTH, HANDS } from './characters/character';
import { TECH, AGES } from './game/tech/data';
import { techState } from './game/tech/tech';
import { openCodex, showSafetyCard, consentGiven, stopSpeech } from './ui/science';

type State = 'loading' | 'title' | 'cinematic' | 'game' | 'narrator' | 'film' | 'flashback';
// the playable prologue opens every new game; ?prologue=0 (tests) or the settings switch (replays) skip it
const PROLOGUE_PARAM = new URLSearchParams(location.search).get('prologue');
const NEAR_FADE_OFF = new URLSearchParams(location.search).get('nearfade') === '0';

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
const cine = new Cinematic(ui, quality.name === 'mobile');
const film = new Montage(cine, () => (worldReady ? world : null), (sc, cam, ao) => renderer.setScene(sc, cam, ao), () => pendingLook.glow, () => (player ? [player.model.root, ...(game?.story.npcs.roots() ?? [])] : []), ui);
const vault = new Vault((k, sp) => ui.subtitle(k, sp), quality.name === 'mobile' ? 0.6 : 1);
film.small = quality.name === 'mobile';
const world = new World(quality);
// a stage left behind is freed on the GPU, except whatever the planet and the films still draw (core/disposeTree.ts)
setDisposeKeep(() => [world.scene, cine.scene]);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2400);
let player: Player;
let game: Game;
let state: State = 'loading';
let paused = false;
let worldReady = false;
/** True while warmAll compiles a scene in the background: the frame loop leaves the canvas as it is. */
let warmHold = false;
/** What the last trip away let go of on the GPU (phones), in MB: memory reports. */
const AWAY_RELEASED: { last: { texMB: number; geoMB: number } | null } = { last: null };
let pendingStart: (() => void) | null = null;
let suppressPauseOnUnlock = false;
let pendingNames: CrewNames = {};
/** The new story's save from New Game on: the opening's choices are written to it as they are made (it is on disk at
 *  once, marked `openingLive`), and the planet starts from it. Null outside a new game's opening. */
let openingSave: SaveData | null = null;
let autoWalk = false;
/** A walking plan for the glitch runner: points walked in order (along the map's route where there is one); a point
 *  not got nearer for 4 s is passed over and counted as stuck. */
let walkPlan: { pts: [number, number][]; i: number; best: number; since: number; stuck: number[]; route: [number, number][] | null; rt: number; walked: number; last: [number, number] | null; ref?: [number, number] } | null = null;
if (new URLSearchParams(location.search).get('glitch') === '1') glitch.on = true;
function beginOpeningSave(from?: SaveData) {
  const s = from ?? newSave();
  if (!from) { s.names = { ...pendingNames }; s.player = { ...pendingLook }; s.skins = settings.skins ?? {}; }
  s.flags.openingLive = true;
  openingSave = s;
  writeSave(s);
  // automated browsers (the smoke tests drive the opening by Skip and fixed waits) play it as one film unless the URL
  // asks for the choices (?choices=1, tools/choices_check.py); ?choices=0 turns them off anywhere
  const want = new URLSearchParams(location.search).get('choices');
  if (want === '0' || (navigator.webdriver && want !== '1')) { cine.branch = null; return; }
  cine.branch = new MomentBranch(() => openingSave!, ui.moment, () => { if (openingSave) writeSave(openingSave); }, () => !!settings.noTimers);
  cine.momentScale = () => ui.moment.timeScale;
}
/** Chapter being replayed by the next world start. */
let replaying: number | null = null;
/** Debug camera override used for documentation screenshots. */
let photo: { from: THREE.Vector3; to: THREE.Vector3; fov?: number } | null = null;
/** Cinema mode (?cinema=1 or __bs.cinema(true)) for trailers and screenshots: everything on the page but the 3D view is
 * hidden (HUD, hints, minimap, prompts, subtitles, menus, letterbox bars, fades) and so is the cursor. */
const setCinema = (on: boolean) => { document.documentElement.classList.toggle('cinema', on); hintSweep = 0; };
/** World hints (the glowing rings on items and build sites, all named 'ring') go with the UI in cinema mode. */
let hintSweep = 0;
function sweepHints() {
  const show = !document.documentElement.classList.contains('cinema');
  world?.scene.traverse((o) => {
    if (o.name !== 'ring' || !(o as THREE.Mesh).isMesh) return;
    const m = (o as THREE.Mesh).material as THREE.Material;
    if (m.visible !== show) m.visible = show;
  });
}
if (new URLSearchParams(location.search).get('cinema') === '1') setCinema(true);

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
function playVault(id: 'intro' | 'l3' | 'l7' | 'ch1' | 'ch2' | 'ep2', after: () => void) {
  const s = game?.save;
  const names = (s?.names ?? pendingNames) as CrewNames;
  const lines = vaultScript(id, { ateRed: !!s?.flags.ateRed, deaths: s?.deaths ?? 0, bites: s?.bites ?? 0, renamed: Object.keys(names).length > 0, failed: s?.crafts?.failed ?? 0, comments: s ? pickComments(s, COMMENTS, id) : [] });
  state = 'narrator';
  input.enabled = false; input.resetTouch(); touch.show(false); suppressPauseOnUnlock = true; input.releasePointer();
  ui.fade('black', 1, 0.5);
  ui.show('hud', false);
  // under the black: the voices' index and the first line's take are in before the scene starts (a fresh profile asked
  // for them only as the first subtitle showed, so the first line came late or not at all)
  const voiced = voice.ready(lines.map((l) => l.key).filter(Boolean));
  vault.skipNext = false;
  setTimeout(() => void voiced.then(() => {
    // Begin in the creator leaves its stage up under the fade; the black is complete now
    if (stage.active) showStage(false);
    renderer.setScene(vault.scene, vault.camera, false);
    renderer.renderer.toneMappingExposure = 1;
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    vault.play(lines, () => {
      ui.fade('black', 1, 0.45);
      setTimeout(() => { ui.show('cine', false); after(); }, 480);
    });
    // lift the black only once the Vault is really on screen (and not if it was skipped while loading)
    if (vault.playing) requestAnimationFrame(() => requestAnimationFrame(() => { if (vault.playing) ui.fade('black', 0, 1.0); }));
  }), 520);
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
  openingSave = null; cine.branch = null; // a replay asks nothing and changes nothing
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
  const beat: Record<number, 'l3' | 'fight' | 'l7' | 'ch1' | 'ep2' | 'ch2'> = { 3: 'l3', 5: 'fight', 7: 'l7', 10: 'ch1', 14: 'ep2', 21: 'ch2' };
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
  beginOpeningSave();
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
    const save = openingSave ?? newSave(); save.names = { ...pendingNames }; save.player = { ...pendingLook }; save.skins = settings.skins ?? {};
    applyPlayer(save.player, save.skins);
    game.momentBranch = openingSave && cine.branch ? cine.branch : null;
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
  const mid = loadSave();
  if (mid?.flags.openingLive) {
    pendingLook = mid.player ?? defaultLook(); pendingNames = { ...(mid.names ?? {}) } as CrewNames;
    applyPlayer(pendingLook, settings.skins ?? {});
    void voice.load();
    beginOpeningSave(mid);
    const prologue = !mid.flags.prologueDone && (PROLOGUE_PARAM !== null ? PROLOGUE_PARAM !== '0' : !settings.skipPrologue);
    playOpening(prologue, false);
    return;
  }
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
  // the opening's answers come with you: the decisions log, trust, the record, what they set and what they cost
  if (fresh && openingSave && !replaying) {
    const o = openingSave;
    save.branch = { ...o.branch, open: null }; save.flags = { ...o.flags, ...save.flags }; save.stats = { ...o.stats };
    delete save.flags.openingLive; delete save.flags.prologueDone;
    if (o.flags.prologueDone) save.flags.prologueDone = true;
  }
  if (fresh) { openingSave = null; cine.branch = null; }
  if (fresh && replaying) { save.replay = replaying; save.flags.tutorialDone = true; replaying = null; }
  applyPlayer(save.player ?? defaultLook(), save.skins ?? {});
  const replay = !!settings.replayTutorial;
  if (replay) { save.flags.tutorialDone = false; settings.replayTutorial = false; persistSettings(); }
  game.start(save, fresh);
  if (fresh) game.persist(); // the opening's save (marked live) is replaced by the story's at once
  // the wake-up keeps you hidden until you get up, so your look's programs (a new look from the creator) were compiled in
  // the first frame after a skip, in one long task: on CI's software GL it outlasted smoke's 30 s wait for play (the
  // "wake did not reach play" flake: the mode read 'play' right after). Compiled now, in the background, while the sky shows
  if (fresh) { const fig = player.model; void fig.whenReady.then(() => { if (player.model !== fig || game.mode !== 'wake') return; const r = fig.root, was = r.visible; r.visible = true; void renderer.compileFor(world.scene, camera); r.visible = was; }); }
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
function setHold(on: boolean) { hold.on = on; film.manual = on; voice.manual = on ? () => elapsed : null; audio.manual = on ? () => elapsed : null; }
// tools/perf_gate.py: from the moment you arrive on a stage the clock is held (stepped by hand with advance), the game's
// clock set to `at` and Math.random seeded, so every run of the gate steps the same simulation whatever the machine's
// speed (on CI's software GL the free-running clock ran 8 to 40 frames per spot and the crowd stood elsewhere each run)
let arrivalHold: { at: number; seed: number } | null = null;
function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// ---- the graphics context: lost and restored without a crash; a memory guard before the browser kills the tab ----
// A phone (or a laptop's driver) can take the WebGL context away: the game used to freeze on a black or garbled frame.
// Now it saves, says so, waits for the context to come back (three.js uploads everything again; the image lights are
// captured again), and if it does not come back offers a reload, with the game saved.
let glLost = false, lostNote: HTMLDivElement | null = null, lostTimer = 0;
function gfxNote(text: string | null, onTap?: () => void) {
  if (!text) { lostNote?.remove(); lostNote = null; return; }
  lostNote ??= document.body.appendChild(document.createElement('div'));
  lostNote.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10000;max-width:80vw;padding:14px 20px;border-radius:10px;background:rgba(10,9,14,.86);color:#f2ebdd;font:600 16px/1.4 Barlow,sans-serif;text-align:center;cursor:' + (onTap ? 'pointer' : 'default');
  lostNote.textContent = text; lostNote.onclick = onTap ?? null;
}
renderer.renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // lets the browser give the context back
  if (glLost) return;
  glLost = true;
  try { if (state === 'game' && game) game.persist(); } catch { /* the save is best effort here */ }
  try { openPause(); } catch { /* the menu is the game's own pause: nothing runs on while the picture is gone */ }
  gfxNote(t('msg.gfxLost'));
  clearTimeout(lostTimer);
  lostTimer = window.setTimeout(() => { if (glLost) gfxNote(t('msg.gfxReload'), () => location.reload()); }, 8000);
});
renderer.renderer.domElement.addEventListener('webglcontextrestored', () => {
  glLost = false; clearTimeout(lostTimer); gfxNote(null);
  (world.env as unknown as { dirty: boolean }).dirty = true; // the planet's image light was in a texture that is gone
});
let memAt = 0, memWarned = false;
function memoryGuard(now: number) {
  if (now - memAt < 5000 || memWarned || navigator.webdriver) return; // not under test automation: it must not change a run
  memAt = now;
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!m || !m.jsHeapSizeLimit || m.usedJSHeapSize < m.jsHeapSizeLimit * 0.92) return;
  // close to the browser's limit (a phone's is far lower than a laptop's): the game is saved and the next start uses a
  // lighter preset. No reload in the middle of play (the first version reloaded: that is a crash of its own)
  memWarned = true;
  const lower: QualityName | null = quality.name === 'cinematic' ? 'ultra' : quality.name === 'ultra' ? 'web' : quality.name === 'web' ? 'mobile' : null;
  console.warn('[memory] heap', Math.round(m.usedJSHeapSize / 1e6), 'of', Math.round(m.jsHeapSizeLimit / 1e6), 'MB', lower ? `-> ${lower} next start` : '');
  try { if (state === 'game' && game) game.persist(); } catch { /* best effort */ }
  if (!lower || qualityFromUrl()) return;
  saveQualityChoice(lower);
  ui.toast(t('msg.memLow'));
}

function frame() {
  requestAnimationFrame(frame);
  frameCount++;
  memoryGuard(performance.now());
  clock.update();
  const real = Math.min(clock.getDelta(), 0.05);
  // a lost context: the game is paused (openPause above) and only the drawing waits, so menus and input still work
  if (!hold.on) { const t0 = performance.now(); tick(real); const t1 = performance.now(); if (!glLost) draw(real); perfFrame(renderer.renderer, real, t1 - t0, performance.now() - t1); return; }
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
  if (!paused) ui.moment.update(dt);
  if (state === 'title' || state === 'loading') {
    cine.idle(dt);
  } else if (state === 'cinematic' || state === 'flashback') {
    cine.update(dt);
    if (glitch.on) glitch.frame(cine.scene, cine.camera, dt, { zeroG: cine.time > 130, film: cine.time });
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
    if (photo) {
      camera.position.copy(photo.from); camera.lookAt(photo.to);
      if (photo.fov && camera.fov !== photo.fov) { camera.fov = photo.fov; camera.updateProjectionMatrix(); }
    }
    world.update(paused ? 0 : dt, elapsed, game.save.timeOfDay, focus, camera, renderer.renderer, renderer.stageInfo().scene === world.scene);
    if (autoWalk && !paused) {
      // steer the body played towards the next task (away) or the objective (the planet), forward held
      const aw = game.away?.active ? game.away : null, body = aw ? aw.body : player;
      let goal: { x: number; z: number } | null = aw ? aw.next?.pos ?? null : game.objectivePoint();
      let route = navRoute;
      const wpn = walkPlan;
      if (wpn && body) {
        if (wpn.last) wpn.walked += Math.hypot(body.pos.x - wpn.last[0], body.pos.z - wpn.last[1]);
        wpn.last = [body.pos.x, body.pos.z];
        while (wpn.i < wpn.pts.length) {
          const q = wpn.pts[wpn.i], d = Math.hypot(q[0] - body.pos.x, q[1] - body.pos.z);
          if (d < 1.2) { wpn.i++; wpn.best = 1e9; wpn.since = elapsed; wpn.route = null; continue; }
          // stuck: the body has not moved half a metre in 5 s (a detour round the road can take it away from the point)
          if (Math.hypot(body.pos.x - (wpn.ref?.[0] ?? 1e9), body.pos.z - (wpn.ref?.[1] ?? 1e9)) > 0.5) { wpn.ref = [body.pos.x, body.pos.z]; wpn.since = elapsed; }
          if (elapsed - wpn.since > 5) { wpn.stuck.push(wpn.i); wpn.i++; wpn.best = 1e9; wpn.since = elapsed; wpn.route = null; continue; }
          break;
        }
        if (wpn.i < wpn.pts.length) {
          const q = wpn.pts[wpn.i]; goal = { x: q[0], z: q[1] };
          wpn.rt -= dt;
          if (!wpn.route || wpn.rt <= 0) { wpn.rt = 0.5; const L = navCache?.layer; wpn.route = L ? routeOf(L, body.pos.x, body.pos.z, q[0], q[1]) : null; }
          route = wpn.route;
        }
      }
      // along the GPS route (round walls and doors), the first point of it more than a stride away; else straight
      const wp = goal && body && route?.find((q) => Math.hypot(q[0] - body.pos.x, q[1] - body.pos.z) > 1.5);
      const tgt = goal && body ? (wp && Math.hypot(goal.x - body.pos.x, goal.z - body.pos.z) > 3 ? { x: wp[0], z: wp[1] } : goal) : null;
      if (body && tgt && goal && (game.mode === 'play' || game.mode === 'away')) {
        const want = Math.atan2(-(tgt.x - body.pos.x), -(tgt.z - body.pos.z)), d = Math.hypot(tgt.x - body.pos.x, tgt.z - body.pos.z);
        body.yaw += Math.atan2(Math.sin(want - body.yaw), Math.cos(want - body.yaw)) * Math.min(1, dt * 6);
        // a walk plan's point counts as reached inside 1.2 m: stopping at 1.4 left him standing between the two until the
        // stuck rule moved on (the parcel crossing, (4.2, 41.8), g_city3)
        const stop = wpn && wpn.i < wpn.pts.length ? 0.8 : 1.4;
        input.hold('KeyW', Math.hypot(goal.x - body.pos.x, goal.z - body.pos.z) > stop && d > 0.2);
      } else input.hold('KeyW', false);
    }
    if (glitch.on && !paused) {
      const aw = game.away?.active ? game.away : null, st = aw?.stage, body = aw ? aw.body : player;
      glitch.frame(renderer.renderPass.scene as THREE.Scene, camera, dt, {
        ground: st ? (x, z) => st.height(x, z) : (x, z) => world.terrain.height(x, z),
        player: body && (game.mode === 'play' || game.mode === 'away') ? { root: body.model.root, onGround: body.onGround, speed: body.speedNow, pos: body.pos, swimming: body.swimming, doing: () => `${(body.model as unknown as { task?: { kind?: string } | null }).task?.kind ?? 'nothing'}, pose ${body.pose}, mode ${game.mode}` } : null,
        collide: st ? (p, r) => st.collide(p, r) : (p, r) => world.forest.collide(p, r),
        self: body?.model.root ?? null,
      });
    }
    // the eye adapting to a camp fire close by in a fight (combat.ts exposure; 1 elsewhere)
    if (combat) renderer.renderer.toneMappingExposure *= combat.exposureScale;
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
  // the photo camera frames cutscenes, films and the narrator's room too (games set it in tick, before the world update)
  if (photo && state !== 'game') {
    activeCam.position.copy(photo.from); activeCam.lookAt(photo.to);
    if (photo.fov && activeCam.fov !== photo.fov) { activeCam.fov = photo.fov; activeCam.updateProjectionMatrix(); }
  }
  // cinema mode: hide the world's hint rings (again every second, for items placed since), show them after
  if (hintSweep-- <= 0) { hintSweep = document.documentElement.classList.contains('cinema') ? 60 : 1e9; sweepHints(); }
  const designFov = activeCam.fov;
  activeCam.getWorldDirection(earFwd);
  audio.listen(activeCam.position, earFwd);
  fitFov(activeCam);
  // props that pass right by the follow camera dissolve; cutscenes and films are framed by hand
  // (?nearfade=0: never, to tell the fade's dither from other noise in a GPU capture)
  NEAR_FADE.value = !NEAR_FADE_OFF && state === 'game' && game && (game.mode === 'play' || game.mode === 'away' || game.mode === 'dead') && !photo ? 1 : 0;
  portraitFrame();
  if (!(state === 'film' && film.videoOn) && !warmHold) renderer.render(dt, elapsed);
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
  // while a scene compiles in the background the frame loop does not draw (it drew the world being compiled, and its
  // first use of each program waited for that program to link: the cold load's 3.4 s freeze at t 9 after c148ab9)
  const pre = async (sc: THREE.Scene, cam: THREE.Camera) => { warmHold = true; try { await renderer.prewarm(sc, cam, (k) => ui.setLoading(0.9 + 0.1 * Math.min(1, (step + k) / STEPS))); } finally { warmHold = false; } step++; };
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
  game.away = new Away(camera, input, ui, detail(), (sc) => {
    if (!sc) { renderer.setScene(world.scene, camera, true); return; }
    renderer.setScene(sc, camera, false);
    // phones: what the planet, the films, the vault and the title's stage hold on the GPU goes while you are away (it is
    // uploaded again when next drawn); ?awayrelease=0 keeps it
    if (quality.name === 'mobile' && new URLSearchParams(location.search).get('awayrelease') !== '0') AWAY_RELEASED.last = releaseGpu([world.scene, cine.scene, vault.scene, stage.scene], [sc]);
  });
  game.away.skins = lastSkins;
  game.away.entered = () => { if (!arrivalHold) return; setHold(true); elapsed = arrivalHold.at; Math.random = seeded(arrivalHold.seed); arrivalHold = null; };
  // someone's arrival on their own world (game/arrival.ts) is a scene too: letterboxed, HUD off, with its Skip
  game.away.onIntro = (on) => {
    ui.show('cine', on); ui.show('hud', !on);
    document.getElementById('btn-skip')!.classList.toggle('hidden', !on);
  };
  // the take-off from Zenvora is a scene like any other: letterboxed, with its Skip
  game.away.onOutro = (on) => {
    // (its sounds are the scene's own, on its clock: boarding.ts)
    ui.show('cine', on); ui.show('hud', !on);
    document.getElementById('btn-skip')!.classList.toggle('hidden', !on);
  };
  combat = new Combat({ world, player, input, ui, save: () => game.save, settings: () => (settings.combat ??= defaultCombatSettings()), saveSettings: persistSettings,
    free: () => state === 'game' && game.mode === 'play' && !paused && !ui.modalOpen(), persist: () => game.persist(), home: () => game.mode !== 'away' });
  game.combat = combat;
  { const d = new URLSearchParams(location.search).get('diff'); if (d === 'story' || d === 'normal' || d === 'hard') combat.setDifficulty(d); }
  // a story fight starts only in plain play: not under a flashback, the Vault, a film, the pause menu or a panel
  game.canFight = () => state === 'game' && !paused && !ui.modalOpen();
  game.onLevelComplete = onLevelDone;
  game.timersOff = !!settings.noTimers;
  // warm up shaders so the first in-game frame doesn't hitch
  player.spawn(0, 2, 0.35);
  // drawn = false: light and sky only. Drawn, the lake mirrored the whole planet here, before any of its programs were
  // compiled in the background: every one linked on the main thread at once (the cold title load's 3 s freeze at t 8,
  // a CPU profile of the A500 cold run: water.ts reflect 2.3 s, getProgramInfoLog 3.2 s)
  world.update(0.016, 0, 8.2, player.pos, camera, renderer.renderer, false);
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
  /** Watched cutscene time between the player's inputs (game.ts watch; tools/watch_time.py). */
  get watch() { return game ? { cur: +game.watch.cur.toFixed(1), stretches: game.watch.stretches } : null; },
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
  /** Physics glitches over time (core/glitch.ts, tools/glitch_check.py). */
  /** Where the body played is (the planet or a stage), for the glitch runner's distance walked. */
  /** The played body's physics, a frame at a time (glitch probes). */
  get bodyState() { const b = player; if (!b) return null; const r = b.model.root.position; return { x: +b.pos.x.toFixed(3), y: +b.pos.y.toFixed(3), z: +b.pos.z.toFixed(3), ry: +r.y.toFixed(3), g: +world.terrain.height(b.pos.x, b.pos.z).toFixed(3), on: b.onGround, sw: b.swimming, vy: +b.vel.y.toFixed(2), cy: +camera.position.y.toFixed(3), mode: game?.mode }; },
  get bodyPos() { const b = game?.away?.active ? game.away.body : player; return b ? [b.pos.x, b.pos.y, b.pos.z] : null; },
  /** Tests of the glitch watch itself (glitch_check.py): a glitch of each kind put in at the watch's own read. */
  glitchTest(kinds: string[], on?: 'npc' | 'player') { return kinds.map((k) => glitch.inject(k as GlitchKind, on)); },
  /** Test of the clip probe: the nearest other body put on the player (or on the nearest other body) for one probe. */
  clipPoke() {
    const sc = renderer.renderPass.scene as THREE.Scene, me = state === 'game' ? (game?.away?.active ? game.away.body : player)?.model.root : undefined;
    const bodies: THREE.Object3D[] = [];
    sc.traverse((o) => { if (!o.userData.isCharacter) return; for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return; bodies.push(o); });
    const cam = (state === 'cinematic' ? cine.camera : camera).getWorldPosition(new THREE.Vector3());
    const others = bodies.filter((o) => o !== me).sort((a, b) => a.getWorldPosition(new THREE.Vector3()).distanceTo(cam) - b.getWorldPosition(new THREE.Vector3()).distanceTo(cam));
    const onto = me ?? others[1], mover = others[0];
    if (!onto || !mover || mover === onto) return { ran: false, caught: false };
    // hips onto hips, not root onto root: a seated, lying or pulled body's hips are a metre from its root, and a root
    // put on such a root left the two bodies apart (the misses in the pull's middle and Episode Two's start, g_e23b)
    const hip = (r: THREE.Object3D) => { let h: THREE.Object3D | undefined; r.traverse((o) => { if (!h && (o as THREE.Bone).isBone && /^(hips|pelvis)$/i.test(o.name)) h = o; }); return h?.getWorldPosition(new THREE.Vector3()); };
    sc.updateMatrixWorld(true);
    const h0 = hip(mover), h1 = hip(onto), mw = mover.getWorldPosition(new THREE.Vector3());
    const was = mover.position.clone(), w = (h0 && h1 ? mw.add(h1.sub(h0)) : onto.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0.05, 0, 0.05));
    if (mover.parent) { mover.parent.updateWorldMatrix(true, false); mover.parent.worldToLocal(w); }
    mover.position.copy(w); mover.updateMatrixWorld(true);
    const hits = clipProbe(sc);
    // what the probe saw (a miss says why): the two hips apart after the move, the mover's distance, its bone count
    const ha = hip(mover), hb = hip(onto), apart = ha && hb ? +ha.distanceTo(hb).toFixed(2) : null;
    let nb = 0; mover.traverse((o) => { if ((o as THREE.Bone).isBone) nb++; });
    mover.position.copy(was); mover.updateMatrixWorld(true);
    return { ran: true, caught: hits.some((h) => h.kind === 'body' && h.depth > 0.06), who: (mover.userData.id as string | undefined) ?? mover.name, onto: onto === me ? 'player' : (onto.userData.id as string | undefined) ?? onto.name, apart, bones: nb, far: +was.distanceTo(w).toFixed(1) };
  },
  glitch(on = true) { if (on && !glitch.on) glitch.reset(); glitch.on = on; return glitch.summary(); },
  get glitches() { return { events: glitch.events, summary: glitch.summary() }; },
  /** Walks the player towards the next task or objective (glitch_check.py): steers and holds W. */
  autoWalk(on = true, pts?: [number, number][]) { autoWalk = on; walkPlan = on && pts?.length ? { pts, i: 0, best: 1e9, since: elapsed, stuck: [], route: null, rt: 0, walked: 0, last: null } : null; if (!on) input.hold('KeyW', false); },
  /**
   * A walk for the glitch runner that goes where glitches happen (tools/glitch_check.py): on a stage every task in
   * order with the people to talk to on the way; on the planet the steepest slope you can climb, the water's edge
   * (in and out), the thickest trees, the crew at the camp and the objective, nearest first, within `r` metres.
   */
  glitchTour(r = 70) {
    const aw = game?.away?.active ? game.away : null, st = aw?.stage;
    const named: { x: number; z: number; what: string }[] = [];
    if (aw && st) {
      for (const k of st.tasks) if (!k.optional) named.push({ x: k.pos.x, z: k.pos.z, what: k.id });
    } else if (game) {
      const T = world.terrain, P0 = player.pos, h = (x: number, z: number) => T.height(x, z);
      let steep: { x: number; z: number; g: number } | null = null, edge: { x: number; z: number; d: number } | null = null, trees: { x: number; z: number; n: number } | null = null;
      for (let x = -r; x <= r; x += 3) for (let z = -r; z <= r; z += 3) {
        const X = P0.x + x, Z = P0.z + z, d = Math.hypot(x, z); if (d > r) continue;
        const gx = (h(X + 1, Z) - h(X - 1, Z)) / 2, gz = (h(X, Z + 1) - h(X, Z - 1)) / 2, g = Math.hypot(gx, gz), y = h(X, Z);
        if (y > 0.3 && g > 0.45 && g < 1.4 && !world.forest.blocks(X, Z, 0.6) && (!steep || g > steep.g)) steep = { x: X, z: Z, g };
        if (Math.abs(y) < 0.25 && (h(X + 3, Z) < -0.4 || h(X - 3, Z) < -0.4 || h(X, Z + 3) < -0.4 || h(X, Z - 3) < -0.4) && (!edge || d < edge.d)) edge = { x: X, z: Z, d };
        if (y > 0.3 && !world.forest.blocks(X, Z, 0.5)) { let n = 0; for (let a = 0; a < 8; a++) if (world.forest.blocks(X + Math.cos(a * 0.785) * 2.5, Z + Math.sin(a * 0.785) * 2.5, 0.4)) n++; if (n >= 3 && (!trees || n > trees.n)) trees = { x: X, z: Z, n }; }
      }
      if (steep) named.push({ x: steep.x, z: steep.z, what: `slope ${steep.g.toFixed(2)}` });
      if (edge) {
        // into the water a few metres (wading, then swimming) and back out
        let wx = edge.x, wz = edge.z; for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (h(edge.x + dx, edge.z + dz) < -0.4) { wx = edge.x + dx * 1.6; wz = edge.z + dz * 1.6; break; }
        named.push({ x: edge.x, z: edge.z, what: 'water edge' }, { x: wx, z: wz, what: 'in the water' }, { x: edge.x, z: edge.z, what: 'out of the water' });
      }
      if (trees) named.push({ x: trees.x, z: trees.z, what: `trees ${trees.n}/8` });
      const camp = world.layout?.camp; if (camp && Math.hypot(camp.x - P0.x, camp.z - P0.z) < r * 1.5) named.push({ x: camp.x + 1.5, z: camp.z + 1.5, what: 'camp' });
      const o = game.objectivePoint(); if (o) named.push({ x: o.x, z: o.z, what: 'objective' });
      // nearest first, keeping the water's three together
      const out: typeof named = []; let at = { x: P0.x, z: P0.z };
      const left = [...named];
      while (left.length) {
        let bi = 0; for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - at.x, left[i].z - at.z) < Math.hypot(left[bi].x - at.x, left[bi].z - at.z)) bi = i;
        const [q] = left.splice(bi, 1); out.push(q); at = q;
        if (q.what === 'water edge') for (const w of ['in the water', 'out of the water']) { const k = left.findIndex((x) => x.what === w); if (k >= 0) { out.push(left[k]); left.splice(k, 1); } }
      }
      return out;
    }
    return named;
  },
  get walkPlan() { return walkPlan ? { i: walkPlan.i, n: walkPlan.pts.length, stuck: walkPlan.stuck, walked: +walkPlan.walked.toFixed(1), route: walkPlan.route?.slice(0, 7).map((q) => [+q[0].toFixed(1), +q[1].toFixed(1)]) ?? null } : null; },
  /** The cutscene choice layer and the opening's save (tools/choices_check.py). */
  moment: {
    get open() { return ui.moment.open; },
    get log() { return ui.moment.log; },
    get placed() { return ui.moment.placed; },
    get choosing() { return cine.choosing; },
    get said() { return [...ui.subLog]; },
    get opening() { return openingSave ? { log: openingSave.branch.log, trust: openingSave.branch.trust, flags: openingSave.flags, record: openingSave.branch.record } : null; },
    get saved() { const raw = localStorage.getItem('bs-save-v1'); return raw ? JSON.parse(raw) as SaveData : null; },
    get ready() { return openingReady.then(() => true); },
    /** The episodes' scene moments (branch/moments.ts), and one played in a small scene where you stand (choices_check). */
    get episodes() { return momentsReady.then(() => Object.values(QTES).filter((q) => q.layer === 'moment').map((q) => q.id).concat(Object.values(DECISIONS).filter((d) => d.layer === 'moment').map((d) => d.id))); },
    /** A reflex (line said if `flag` is set) or a decision (line said if option `flag` was taken). */
    episodeTest(id: string, line?: string, flag?: string) {
      if (!game || game.mode !== 'play') return false;
      const dec = !!DECISIONS[id];
      game.playScene([dec ? { choice: id } : { qte: id }, ...(line && flag ? [{ key: line, who: 'scientist' as const, if: dec ? { chose: [id, flag] as [string, string] } : { flag } }] : []), { hold: 0.5 }]);
      return true;
    },
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
  get vault() { return { playing: vault.playing, line: vault.lineIndex, said: [...vault.said] }; },
  get vaultScript() { return vault.keys; },
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
  hold(on: boolean) { setHold(on); },
  /** Shader programs that did not link (needs ?shadercheck=1, which keeps three's diagnostics): their names. A body whose
   * merged shader fails is simply not drawn and nothing throws (7cda35d), so tools/perf_gate.py fails on any. */
  shaderErrors() { return ((renderer.renderer.info.programs ?? []) as unknown as { name: string; diagnostics?: { runnable: boolean } }[]).filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name); },
  /** Hold the clock from the next arrival on a stage (tools/perf_gate.py): the game clock becomes `at`, Math.random a seeded sequence. */
  holdAtArrival(at = 600, seed = 1) { arrivalHold = { at, seed }; },
  /** What is still loading or compiling: the stage's bodies, props and card atlas, textures waiting for their upload,
   * shader programs still linking (an empty list when the scene is all in). `advance(1e-9)` draws a frame without a tick. */
  settled() {
    const why: string[] = [...(game?.away?.pending ?? [])];
    const w = warmPending(); if (w) why.push(`textures ${w}`);
    const progs = (renderer.renderer.info.programs ?? []) as unknown as { isReady?: () => boolean }[];
    const linking = progs.filter((p) => p.isReady && !p.isReady()).length; if (linking) why.push(`shaders ${linking}`);
    return why;
  },
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
  /** Test hook: every surface the drawn camera's ray through screen point (ndc x, y) passes, nearest first: what is it,
   * which material, how far (two hits within a few mm of each other on different meshes would fight in depth). */
  pickProbe(nx: number, ny: number, max = 8) {
    const info = renderer.stageInfo(), cam = info.camera; if (!cam) return null;
    cam.updateMatrixWorld();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    const path = (o: THREE.Object3D) => { const n: string[] = []; for (let p: THREE.Object3D | null = o; p && n.length < 5; p = p.parent) n.push(p.name || p.type); return n.join('<'); };
    const vis = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const hits = ray.intersectObject(info.scene, true).filter((h) => vis(h.object)).slice(0, max);
    return { cam: cam.position.toArray().map((v) => +v.toFixed(2)), near: cam.near, far: cam.far, hits: hits.map((h) => {
      const m = h.object as THREE.Mesh, mt = (Array.isArray(m.material) ? m.material[h.face?.materialIndex ?? 0] : m.material) as THREE.Material & { color?: THREE.Color };
      return { d: +h.distance.toFixed(4), path: path(m), type: m.type, geo: m.geometry?.type, tris: m.geometry ? (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 : 0, mat: mt ? `${mt.type}:${mt.name}:${mt.color?.getHexString() ?? ''}:${mt.polygonOffset ? 'po' : ''}${mt.transparent ? 't' : ''}` : null, n: h.face ? h.face.normal.toArray().map((v) => +v.toFixed(2)) : null, p: h.point.toArray().map((v) => +v.toFixed(3)), inst: h.instanceId ?? null, ud: Object.keys(m.userData) };
    }) };
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
  /** CPU-side bytes (typed arrays, each counted once) by who holds them: the scene first, then each cache for what only it
   * holds; textures by their image size (w x h x 4). Phone memory work (perf agent 20). */
  async memOwners() {
    const [{ modelCacheNow, MODEL_RELEASE }, { assetCacheNow, CREW_RELEASE }, { mergeCacheNow }] = await Promise.all([import('./game/away/city'), import('./characters/assets'), import('./characters/bodymerge')]);
    const seen = new Set<ArrayBufferLike>(), seenT = new Set<THREE.Texture>();
    const geo = (g: THREE.BufferGeometry | undefined) => { let n = 0; if (!g) return 0; const f = (a: { array?: ArrayLike<number> & { buffer?: ArrayBufferLike; byteLength?: number }; data?: { array: ArrayLike<number> & { buffer: ArrayBufferLike; byteLength: number } } } | null | undefined) => { const arr = (a?.data?.array ?? a?.array) as (ArrayLike<number> & { buffer: ArrayBufferLike; byteLength: number }) | undefined; if (!arr || !arr.buffer || seen.has(arr.buffer)) return; seen.add(arr.buffer); n += arr.byteLength; }; for (const k in g.attributes) f(g.attributes[k] as never); f(g.index as never); for (const a of Object.values(g.morphAttributes).flat()) f(a as never); return n; };
    const tex = (t: THREE.Texture | null | undefined) => { if (!t || seenT.has(t)) return 0; seenT.add(t); const im = t.image as { width?: number; height?: number; data?: { byteLength: number } } | undefined; return im?.data?.byteLength ?? ((im?.width ?? 0) * (im?.height ?? 0) * 4); };
    const walk = (roots: THREE.Object3D[]) => { let g = 0, t = 0, chars = 0; for (const r of roots) r.traverse((o) => { const m = o as THREE.Mesh; const gb = geo(m.geometry); g += gb; if (o.userData?.isCharacter) chars++; const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; for (const mt of mats) for (const v of Object.values(mt as unknown as Record<string, unknown>)) if ((v as THREE.Texture)?.isTexture) t += tex(v as THREE.Texture); }); return { geoMB: +(g / 1e6).toFixed(1), texMB: +(t / 1e6).toFixed(1), chars }; };
    const out: Record<string, unknown> = {};
    const stage = renderer.stageInfo?.() as { scene?: THREE.Scene } | undefined;
    if (stage?.scene) out.stage = walk([stage.scene]);
    out.modelCache = walk(modelCacheNow());
    out.modelTexReleased = MODEL_RELEASE.textures;
    out.crewReleased = { ...CREW_RELEASE }; const ac = assetCacheNow(); out.bodyAssets = walk(ac.scenes); const bt = ac.textures.map((t) => [String((t.image as { src?: string } | undefined)?.src ?? '').replace(/^.*\/tex\//, ''), tex(t) / 1e6] as [string, number]).filter((r) => r[1] > 0);
    out.bodyTex = +bt.reduce((n, r) => n + r[1], 0).toFixed(1); out.bodyTexTop = bt.sort((x, y) => y[1] - x[1]).slice(0, 40).map(([k, v]) => `${k} ${v.toFixed(1)}`);
    out.mergeCache = +(mergeCacheNow().reduce((n, g) => n + geo(g), 0) / 1e6).toFixed(1);
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; out.heapMB = m ? Math.round(m.usedJSHeapSize / 1e6) : null;
    return out;
  },
  /** Test hook (memory work): the stage's biggest textures and geometry by owner, in MB (a texture counted once). */
  memTop() {
    const stage = renderer.stageInfo?.() as { scene?: THREE.Scene } | undefined; if (!stage?.scene) return null;
    const seen = new Set<ArrayBufferLike>(), seenT = new Set<THREE.Texture>(), T = new Map<string, number>(), G = new Map<string, number>(), N = new Map<string, number>();
    const bytes = (a: unknown) => { const x = a as { array?: { buffer?: ArrayBufferLike; byteLength?: number }; data?: { array: { buffer: ArrayBufferLike; byteLength: number } } } | null; const arr = x?.data?.array ?? x?.array; if (!arr?.buffer || seen.has(arr.buffer)) return 0; seen.add(arr.buffer); return arr.byteLength ?? 0; };
    stage.scene.traverse((o) => {
      const m = o as THREE.Mesh; let ch: THREE.Object3D | null = o; while (ch && !ch.userData?.isCharacter) ch = ch.parent;
      const own = (ch ? 'char:' : '') + (o.name || o.parent?.name || o.type);
      if (m.geometry) { let n = 0; const g = m.geometry; for (const k in g.attributes) n += bytes(g.attributes[k]); n += bytes(g.index); for (const a of Object.values(g.morphAttributes).flat()) n += bytes(a); if (n) { G.set(own, (G.get(own) ?? 0) + n); N.set(own, (N.get(own) ?? 0) + 1); } }
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) for (const v of Object.values(mt as unknown as Record<string, unknown>)) {
        const t = v as THREE.Texture; if (!t?.isTexture || seenT.has(t)) continue; seenT.add(t);
        const im = t.image as { width?: number; height?: number; src?: string; data?: { byteLength: number }; tagName?: string } | undefined;
        const comp = (t as THREE.CompressedTexture).isCompressedTexture;
        const b = comp ? ((t as THREE.CompressedTexture).mipmaps as { data: { byteLength: number } }[] ?? []).reduce((n, q) => n + (q.data?.byteLength ?? 0), 0) : im?.data?.byteLength ?? ((im?.width ?? 0) * (im?.height ?? 0) * 4);
        const k = `${comp ? 'ktx2 ' : im?.tagName === 'CANVAS' ? 'canvas ' : ''}${String(im?.src ?? t.name ?? '').replace(/^.*\//, '') || 'unnamed'} ${im?.width}x${im?.height}`;
        T.set(k, (T.get(k) ?? 0) + b);
      }
    });
    const top = (M: Map<string, number>, n: number) => [...M.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${(v / 1e6).toFixed(1)}${N.has(k) ? ' x' + N.get(k) : ''}`);
    return { texMB: +([...T.values()].reduce((a, b) => a + b, 0) / 1e6).toFixed(1), geoMB: +([...G.values()].reduce((a, b) => a + b, 0) / 1e6).toFixed(1), tex: top(T, 40), geo: top(G, 40) };
  },
  /** Test hook (tools/pedglitch.js): everyone in the street as drawn this frame, and the cars. */
  awayPeds() { return (game?.away?.stage as { pedProbe?: () => unknown } | null)?.pedProbe?.() ?? null; },
  awayCrowd() { const st = game?.away?.stage as { crowdState?: () => { near: number; bodies: number; lost: number; held?: number[][] } } | null; return st?.crowdState?.() ?? { near: 0, bodies: 0, lost: 0 }; },
  /** Test hook: cars and people on the away stage this frame (tools/traffic_smoke.py). */
  awayTraffic() { return (game?.away?.stage as { trafficState?: () => unknown } | null)?.trafficState?.() ?? null; },
  /** Test hook: 'body', 'card' or 'none' for a person on the away stage (tools/crowd_smoke.py). */
  awayDrawnAs(id: string) { return (game?.away?.stage as { drawnAs?: (id: string) => string } | null)?.drawnAs?.(id) ?? 'none'; },
  get awayPerf() { return (game?.away?.stage as { perfState?: unknown } | null)?.perfState ?? null; },
  awayLeave() { game?.away?.leave(); },
  /** Test hook: every Zenvora task done at once, so the take-off plays now. */
  awayOutro() { game?.away?.debugOutro(); },
  /** The boarding and take-off (boarding.ts): played on its own clock and checked, without drawing (needs the city). */
  boardingCheck() { return (game?.away?.stage as { boardingCheck?: () => unknown } | null)?.boardingCheck?.() ?? null; },
  takeoffClearance() { return (game?.away?.stage as { takeoffClearance?: () => unknown } | null)?.takeoffClearance?.() ?? null; },
  takeoffMap(x: number, z: number, span?: number, G?: number) { return JSON.stringify((game?.away?.stage as { takeoffMap?: (...a: unknown[]) => unknown } | null)?.takeoffMap?.(x, z, span, G) ?? null); },
  /** One ship everywhere: the liner on Zenvora's pad against the ship in the films, mesh by mesh. */
  shipDesigns() {
    let film: string[] | null = null;
    cine.scene.traverse((o) => { if (!film && o.userData.design === 'liner') film = designOf(o); });
    const pad = (game?.away?.stage as { linerDesign?: () => string[] | null } | null)?.linerDesign?.() ?? null;
    return { film, pad, same: !!film && !!pad && JSON.stringify(film) === JSON.stringify(pad) };
  },
  get awayOutroOn() { return !!game?.away?.outroOn; },
  /** Test hook (recordings): these tasks count as done (the hero views that wait for one). */
  awayMarkDone(...ids: string[]) { for (const id of ids) game?.away?.done.add(id); },
  /** The arrival on someone's own world (game/arrival.ts): who, how far in, how long, and the body's wounds after. */
  get arrival() { const a = game?.away?.arrival; return a?.active ? { id: a.def.id, t: a.t, dur: a.def.dur } : null; },
  get wounds() { const i = game?.mode === 'away' ? game?.away?.injuries : game?.injuries; return i ? { who: i.who, wounds: i.wounds.map((w) => ({ ...w })), effects: i.effects() } : null; },
  awayGoNext() { const k = game?.away?.next; if (k) game!.away!.teleport(k.pos.x, k.pos.z); },
  awayTeleport(x: number, z: number, yaw = 0) { game?.away?.teleport(x, z, yaw); },
  /** Test: what the stage's collision does to a body of radius r standing at (x, z): where it is pushed to (null off a stage). */
  /** Test: a bone's local rotation on a character in the film (glitch probes), and the film's camera. */
  cineBone(id: string, bone: string) {
    let q: number[] | null = null;
    cine.scene.traverse((o) => { if (q || !o.userData.isCharacter || o.userData.id !== id) return; o.traverse((b) => { if (!q && b.name === bone) q = b.quaternion.toArray(); }); });
    const c = cine.camera.getWorldPosition(new THREE.Vector3());
    return { q, cam: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)], t: +cine.time.toFixed(3) };
  },
  awayBlocksAt(x: number, z: number) { return (game?.away?.stage as { blocksAt?: (x: number, z: number) => unknown } | null)?.blocksAt?.(x, z) ?? null; },
  awayCollide(x: number, z: number, r = 0.35, y = 0.14) { const st = game?.away?.active ? game.away.stage : null; if (!st) return null; const p = new THREE.Vector3(x, y, z); st.collide(p, r); return [+p.x.toFixed(3), +p.z.toFixed(3)]; },
  /** Walk with the keys, not a teleport (soak_smoke's bump test): hold or let go a key, and turn the away body to a heading. */
  key(code: string, on: boolean) { if (on) input.keys.add(code); else input.keys.delete(code); },
  awayYaw(yaw: number) { const p = (game?.away as unknown as { player?: Player } | undefined)?.player; if (p) p.yaw = yaw; },
  /** Test hook (tools/soak_smoke.py): milliseconds of one GPS route search on the away stage, and its corners. */
  awayRoute(ax: number, az: number, bx: number, bz: number) { const L = (game?.away?.stage as AwayStage | null | undefined)?.mapLayer; if (!L?.route) return null; const t0 = performance.now(); const r = L.route(ax, az, bx, bz); return { ms: performance.now() - t0, n: r.length }; },
  /** Test hook: what the renderer holds (soak test). */
  get awayReleased() { return AWAY_RELEASED.last; },
  get gpuMem() { const i = renderer.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 }; },
  get awayCam() { return game?.away?.camState ?? null; },
  holdSubs(on: boolean) { ui.holdSubs = on; },
  awayOrbit(o: { x: number; y: number; z: number; r: number; a: number; h: number } | null) { if (game?.away) game.away.orbit = o; },
  cineTime() { return cine.time; },
  /** The opening's continuity log (?contlog=1 or contLog(true) before it plays): cuts, acted posture changes and the breaks. */
  get continuity() { const c = cine.cont; return { on: c.on, cuts: c.cuts, seen: c.seen, breaks: c.check() }; },
  contLog(on: boolean) { cine.cont.on = on; cine.cont.reset(); },
  deckOverlaps() { return cine.deckOverlaps(); },
  /** Start (true) or read the log of the pilot's wrists in the yoke's frame (tools/yoke_check.py). */
  yokeReport(on?: boolean) { if (on) cine.yokeRows = []; return cine.yokeRows; },
  get stagePlaying() { return cine.staged; },
  gameScene(id: 'rescue' | 'camp' | 'beacon') { game?.debugScene(id); },
  wakeSeek(t: number) { game?.debugWakeSeek(t); },
  look(yaw: number, pitch: number) { if (player) { player.yaw = yaw; player.pitch = pitch; player.snapCamera(); } },
  teleport(x: number, z: number, yaw = 0) { player?.spawn(x, z, yaw); },
  /** Teleport next to the current objective (marker target). */
  gotoObjective(offset = 0.6) {
    const m = game?.story.busy || game?.ep3?.isBusy || (game?.save.level === 7 && game.story.houndEngaged()) ? null : game?.objectivePoint();
    if (!m || !player) return null;
    player.spawn(m.x + offset, m.z + offset * 0.5, player.yaw);
    return [m.x, m.z];
  },
  act() { return game?.debugAct() ?? null; },
  /** Where the objective marker points and where he stands (a recording's stand-in player walks there with the keys). */
  get objective() { const m = game?.objectivePoint(); return m ? [m.x, m.y, m.z] : null; },
  /** Which way his body really points (head and toes against the hips, flattened) against the root's heading: a check
   * for scenes that build shots from his heading. */
  get facingProbe() {
    const m = player?.model; if (!m) return null;
    const v = (n: string) => { const o = m.root.getObjectByName(n); return o ? o.getWorldPosition(new THREE.Vector3()) : null; };
    const hips = v('hips'), toe = v('toesL') ?? v('footL'), head = new THREE.Vector3().setFromMatrixPosition(m.head.matrixWorld);
    const r = m.root.rotation.y;
    return { root: [Math.sin(r), Math.cos(r)], headOff: hips ? [head.x - hips.x, head.z - hips.z] : null, toeOff: hips && toe ? [toe.x - hips.x, toe.z - hips.z] : null, facing: player!.facing };
  },
  get cam() { return [camera.position.x, camera.position.y, camera.position.z]; },
  get me() { return player ? [player.pos.x, player.pos.y, player.pos.z, player.yaw] : null; },
  /** Freeze the camera at `from` looking at `to` (null releases it), with a vertical field of view in degrees if given.
   * A capture that calls it every stepped frame moves the camera along its own path (dolly, crane, orbit). Outside
   * play it takes over the cutscene's, film's or narrator's camera while it is set. */
  photo(from: number[] | null, to?: number[], fov?: number) { photo = from && to ? { from: new THREE.Vector3(...from), to: new THREE.Vector3(...to), fov } : null; },
  /** Cinema mode: hide every bit of UI and the cursor, leaving only the 3D view (also `?cinema=1`). */
  cinema(on: boolean) { setCinema(on); return on; },
  get cinemaOn() { return document.documentElement.classList.contains('cinema'); },
  /** Depth of field for a capture: focus distance in metres and aperture (0 turns it off). Only on presets with DoF. */
  dof(focus: number, aperture: number) { renderer.setDof(focus, aperture); },
  step(sec: number) { game?.debugStep(sec, elapsed); },
  get save() { return game?.save; },
  get wheelOpen() { return wheel.open; },
  get binds() { return input.binds; },
  get prompt() { const el = document.getElementById('prompt')!; return el.classList.contains('hidden') ? null : el.textContent; },
  get hound() { return game?.story.debugHound(); },
  /** Fights: state for the tests, and the way to start a set piece (tools/combat/play_test.py). */
  get combat() { return combat; },
  get ep2() { return (game as unknown as { ep2?: { debug(): unknown } } | null)?.ep2?.debug() ?? null; },
  /** Test: play one of an episode's scenes now, by its method name (GPU takes of a scene's decision). */
  sceneCall(ep: 'ep2' | 'ep3' | 'waking' | 'night', name: string, ...args: unknown[]) {
    const o = (game as unknown as Record<string, Record<string, (...a: unknown[]) => unknown> | undefined> | null)?.[ep];
    const f = o?.[name]; if (typeof f !== 'function') return false; f.apply(o, args); return true;
  },
  get ep3() { return (game as unknown as { ep3?: { debug(): unknown } } | null)?.ep3?.debug() ?? null; },
  /** The player's body: kneeling (0..1), the game mode, where the hips are (checks of the kneel in Episode One). */
  get body() { const m = (game as unknown as { player?: { model: import('./characters/character').Character } } | null)?.player?.model; if (!m) return null; const h = new THREE.Vector3(); (m.root.getObjectByName('hips') ?? m.root).getWorldPosition(h); return { kneel: m.kneeling, mode: game!.mode, rootY: m.root.position.y, hipsY: h.y }; },
  /** Your body's hands, head and facing in world space (tools/ep2_probe.py: which side each hand works on in a scene). */
  get bodyPoints() {
    const m = (game as unknown as { player?: { model: import('./characters/character').Character } } | null)?.player?.model; if (!m) return null;
    const at = (n: string) => { const o = m.root.getObjectByName(n); return o ? o.getWorldPosition(new THREE.Vector3()).toArray() : null; };
    return { root: m.root.position.toArray(), yaw: m.root.rotation.y, handL: at('handL'), handR: at('handR'), head: new THREE.Vector3().setFromMatrixPosition(m.head.matrixWorld).toArray(), camDir: camera.getWorldDirection(new THREE.Vector3()).toArray(), fov: camera.fov, aspect: camera.aspect };
  },
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
  /** Words on 3D surfaces that read mirrored, upside down or from a two-sided material, in the scene shown now (tools/sign_faces.py). */
  textFaces() { const sc = (game?.away?.active ? (game.away.stage as AwayStage | null)?.scene : null) ?? world.scene; return auditTextFaces(sc); },
  textFacesProbe() { return probeTextFaces(); },
  /** The fire's ember bed (src/world/flame.ts FIRE_BASE), for tuning by eye. */
  get fireBase() { return FIRE_BASE.value; },
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
  get syncLog() { return syncLog; },
  /** Test: the faces the choice panel keeps clear of now (rects 0..1), and how many bodies and heads it found. */
  faceRects() { const r = ui.moment.avoid?.() ?? []; return { rects: r.map((q) => [q.x0, q.y0, q.x1, q.y1].map((v) => +v.toFixed(3))), ...faceDbg }; },
  syncMark(n = 3) { return syncFlash(n, 0.6, 'position:fixed;left:0;top:0;width:48px;height:48px;background:#fff;outline:6px solid #000', 2000); },
  openMenu(which: 'settings' | 'legal' | 'chapters') { if (which === 'settings') document.getElementById('btn-settings')?.click(); else if (which === 'legal') document.getElementById('btn-legal')?.click(); else document.getElementById('btn-chapters')?.click(); },
  quality: quality.name,
  get world() { return world; },
  /** The game itself, for probes that pose a scene's people and props (tools, not play). */
  get game() { return game; },
  get debug() {
    return { frames: frameCount, t: elapsed, mode: game?.mode, player: player?.pos.toArray(), cam: camera.position.toArray(), yaw: player?.yaw, creature: world.creature?.position.toArray() };
  },
};

const syncLog: { k: number; perf: number; ctxT: number; audible: number | null; outLat: number | null; baseLat: number | null; origin: number }[] = [];
function syncFlash(n: number, gap: number, css: string, freq: number): number {
  audio.start(); const ctx = audio.ctx; if (!ctx) return 0;
  const el = document.createElement('div'); el.style.cssText = css + ';z-index:99999;pointer-events:none;opacity:0';
  document.body.appendChild(el);
  const t0 = ctx.currentTime + 0.25; let k = 0, on = -1;
  const tick = () => {
    const t = ctx.currentTime;
    if (on >= 0 && t - on >= 0.15) { el.style.opacity = '0'; on = -1; }
    if (on < 0 && k < n && t >= t0 + k * gap) {
      const at = audio.mark(0.06, freq); el.style.opacity = '1'; on = t; k++;
      // both clocks at the mark (A/V sync checks): when this beep reaches the speakers by the context's own output
      // timestamp, and the page clock now (the square is composited on the next frame)
      const o = ctx.getOutputTimestamp?.() as AudioTimestamp | undefined;
      syncLog.push({ k, perf: performance.now(), ctxT: at, audible: o && o.performanceTime ? o.performanceTime + (at - (o.contextTime ?? 0)) * 1000 : null, outLat: (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null, baseLat: ctx.baseLatency ?? null, origin: performance.timeOrigin });
    }
    if (k >= n && on < 0) { el.remove(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick); return t0;
}

const faceDbg = { chars: 0, heads: 0, kept: 0 };
// the choice panel's band (ui/moment.ts place()): every face drawn now, as a rect on screen, and the shot's subject (the
// middle of the frame, where a cutscene aims its camera: an insert's hands and props)
{
  const heads = new WeakMap<THREE.Object3D, THREE.Object3D | null>(), P = new THREE.Vector3(), Q = new THREE.Vector3(), R = new THREE.Vector3();
  const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
  ui.moment.avoid = () => {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [{ x0: 0.38, y0: 0.34, x1: 0.62, y1: 0.6 }];
    const sc = renderer.renderPass.scene as THREE.Scene | undefined; if (!sc) return out;
    camera.updateMatrixWorld(); R.setFromMatrixColumn(camera.matrixWorld, 0);
    faceDbg.chars = faceDbg.heads = faceDbg.kept = 0;
    sc.traverseVisible((o) => {
      if (!o.userData.isCharacter || !shown(o)) return;
      faceDbg.chars++;
      // a found head is kept; not found is asked again (a body's model loads after its root is in the scene)
      let h = heads.get(o) ?? null; if (!h) { o.traverse((b) => { if (!h && (b as THREE.Bone).isBone && /^head$/i.test(b.name)) h = b; }); if (h) heads.set(o, h); }
      if (!h) return;
      faceDbg.heads++;
      h.getWorldPosition(P); P.y += 0.06; Q.copy(P).addScaledVector(R, 0.13);
      P.project(camera); Q.project(camera);
      if (P.z > 1 || P.z < -1) return;
      const x = (P.x + 1) / 2, y = (1 - P.y) / 2, rx = Math.abs(Q.x - P.x) / 2, ry = rx * camera.aspect * 1.25;
      if (rx < 0.012 || x + rx < 0 || x - rx > 1 || y + ry < 0 || y - ry > 1) return;
      faceDbg.kept++; out.push({ x0: x - rx, y0: y - ry, x1: x + rx, y1: y + ry });
    });
    return out;
  };
}

boot();
