import './style.css';
import * as THREE from 'three';
import { setLang, t, Lang } from './i18n';
import { detectQuality, saveQualityChoice, QualityName } from './core/quality';
import { Renderer } from './core/renderer';
import { audio } from './core/audio';
import { loadSave, newSave, clearSave, loadSettings, writeSettings, Settings } from './core/save';
import { UI } from './ui/ui';
import { Cinematic } from './cinematic/cinematic';
import { World } from './world/world';
import { Player } from './game/player';
import { Input } from './game/input';
import { Game } from './game/game';
import { applyCrewNames, CrewNames } from './core/crew';
import { TouchControls, TouchAction } from './ui/touch';
import { voice } from './core/voice';
import { Vault, vaultScript } from './narrator/vault';
import { onLangChange } from './i18n';
import { fitFov, lockViewport, tryFullscreen } from './core/viewport';

type State = 'loading' | 'title' | 'cinematic' | 'game' | 'narrator' | 'flashback';

const canvas = document.getElementById('c') as HTMLCanvasElement;
lockViewport();
const settings: Settings = loadSettings();
setLang(settings.lang);
const quality = detectQuality();
const ui = new UI();
ui.subtitlesOn = settings.subtitles;
function applyAudio() {
  audio.setVolume(settings.volume);
  audio.setMix({ music: settings.musicVolume, sfx: settings.sfxVolume, voice: settings.voiceVolume, muted: settings.muted });
}
applyAudio();
void voice.load();
onLangChange(() => void voice.load());

let renderer: Renderer;
try {
  renderer = new Renderer(canvas, quality);
} catch (e) {
  document.getElementById('loading')!.innerHTML = '<div class="loader-text">WebGL2 is required to play BEYOND SAGITTARIUS.</div>';
  throw e;
}

const input = new Input(canvas);
const touch = new TouchControls(input, (a: TouchAction) => {
  if (a === 'pause') openPause();
  else if (a === 'inventory') openPanel('inventory');
  else openPanel(a);
});
const syncDevice = () => document.body.classList.toggle('touch', input.device === 'touch');
input.onDevice(syncDevice);
syncDevice();
const cine = new Cinematic(ui);
const vault = new Vault((k, sp) => ui.subtitle(k, sp), quality.name === 'mobile' ? 0.6 : 1);
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
/** Debug camera override used for documentation screenshots. */
let photo: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;

document.getElementById('quality-badge')!.textContent = quality.name.toUpperCase();
renderer.setScene(cine.scene, cine.camera, false);

function persistSettings() {
  writeSettings(settings);
  ui.subtitlesOn = settings.subtitles;
  applyAudio();
  if (player) { player.sensitivity = settings.sensitivity; player.invertY = settings.invertY; }
  if (!settings.showFps) ui.setFps(null);
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
  document.getElementById('btn-continue')!.classList.toggle('hidden', !loadSave());
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
  refreshTitle();
}

function whenWorldReady(fn: () => void) {
  if (worldReady) fn();
  else { pendingStart = fn; ui.show('loading', true); }
}

/** Pre-game screen: name yourself and the five friends, then the prologue. */
function chooseNames() {
  const prev = (loadSave()?.names ?? {}) as CrewNames;
  ui.openNames(prev, 'new', (names) => startNewGame(names), () => {});
}

/** Fade into the Vault for a MegaZroN scene, then hand back to `after`. */
function playVault(id: 'intro' | 'l3' | 'l7' | 'ch1', after: () => void) {
  const s = game?.save;
  const names = (s?.names ?? pendingNames) as CrewNames;
  const lines = vaultScript(id, { ateRed: !!s?.flags.ateRed, deaths: s?.deaths ?? 0, bites: s?.bites ?? 0, renamed: Object.keys(names).length > 0 });
  state = 'narrator';
  input.enabled = false; input.resetTouch(); touch.show(false); suppressPauseOnUnlock = true; input.releasePointer();
  ui.fade('black', 1, 0.5);
  ui.show('hud', false);
  setTimeout(() => {
    renderer.setScene(vault.scene, vault.camera, false);
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    ui.fade('black', 0, 1.4);
    vault.play(lines, () => {
      ui.fade('black', 1, 0.45);
      setTimeout(() => { ui.show('cine', false); after(); }, 480);
    });
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

/** Level endings that cut away to the Vault or a memory (once per save). */
function onLevelDone(n: number) {
  const beat: Record<number, 'l3' | 'fight' | 'l7' | 'ch1'> = { 3: 'l3', 5: 'fight', 7: 'l7', 10: 'ch1' };
  const id = beat[n];
  if (!id || game.save.flags[`seen-${id}`]) return;
  const go = () => {
    if (state !== 'game' || game.mode !== 'play' || paused || ui.modalOpen()) { game.after(1, go); return; }
    game.save.flags[`seen-${id}`] = true;
    game.persist();
    if (id === 'fight') playFlashback(() => { backToWorld(); game.after(1.2, () => ui.say('fb.10', 'crew.scientist.name', 4)); });
    else playVault(id, backToWorld);
  };
  game.after(5.2, go);
}

function startNewGame(names: CrewNames = {}) {
  audio.start();
  if (input.device === 'touch') tryFullscreen();
  clearSave();
  pendingNames = names;
  applyCrewNames(names);
  ui.show('title', false);
  void voice.load();
  playVault('intro', () => {
    state = 'cinematic';
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    renderer.setScene(cine.scene, cine.camera, false);
    cine.start(() => {
      ui.fade('black', 1, 0.3);
      setTimeout(() => whenWorldReady(() => enterWorld(true)), 350);
    });
  });
}

function continueGame() {
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
  if (fresh) save.names = { ...pendingNames };
  applyCrewNames(save.names as CrewNames);
  const replay = !!settings.replayTutorial;
  if (replay) { save.flags.tutorialDone = false; settings.replayTutorial = false; persistSettings(); }
  game.start(save, fresh);
  if (!fresh && replay) game.startTutorial();
  if (!fresh) ui.fade('black', 0, 1.2);
  renderer.resize();
}

document.getElementById('btn-new')!.addEventListener('click', () => {
  audio.start(); audio.uiClick();
  if (loadSave()) ui.openConfirm(t('menu.newGameConfirm'), chooseNames, () => {});
  else chooseNames();
});
document.getElementById('btn-continue')!.addEventListener('click', () => { audio.uiClick(); continueGame(); });
document.getElementById('btn-settings')!.addEventListener('click', () => {
  audio.start(); audio.uiClick();
  ui.openSettings(settings, quality.name, persistSettings, changeQuality, refreshTitle, () => { settings.replayTutorial = true; persistSettings(); });
});
document.querySelectorAll<HTMLButtonElement>('.btn.lang').forEach((b) => b.addEventListener('click', () => {
  audio.uiClick();
  settings.lang = b.dataset.lang as Lang;
  setLang(settings.lang);
  persistSettings();
  refreshTitle();
}));
document.getElementById('btn-skip')!.addEventListener('click', () => {
  skipCurrent();
});
function skipCurrent() {
  if (state === 'cinematic' || state === 'flashback') cine.skip();
  else if (state === 'narrator') vault.skip();
  else if (state === 'game' && game?.mode === 'wake') game.skipWake();
  else if (state === 'game' && game?.mode === 'scene') game.skipScene();
}
document.getElementById('objective')!.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('open'));
document.getElementById('prompt')!.addEventListener('click', () => game?.interact());

// ---------------- pause / menus ----------------
function openPause() {
  if (state !== 'game' || game.mode !== 'play' || ui.modalOpen()) return;
  paused = true;
  input.enabled = false;
  input.resetTouch();
  touch.reset();
  suppressPauseOnUnlock = true;
  input.releasePointer();
  ui.openPause({
    resume: resume,
    settings: () => ui.openSettings(settings, quality.name, persistSettings, changeQuality, () => openPauseAgain(), () => { resume(); game.startTutorial(); }),
    objectives: () => ui.openObjectives(game.save.level, game.save.completed, () => openPauseAgain()),
    crew: () => openCrewPanel(() => openPauseAgain()),
    quit: () => { game.persist(); showTitle(); },
  });
}
function openPauseAgain() { paused = false; openPause(); }
function resume() { ui.closeModal(); paused = false; input.enabled = true; }
function openPanel(kind: 'objectives' | 'crew' | 'inventory') {
  if (state !== 'game' || game.mode !== 'play' || ui.modalOpen()) return;
  paused = true; input.enabled = false; input.resetTouch(); touch.reset(); suppressPauseOnUnlock = true; input.releasePointer();
  game.notePanel(kind);
  if (kind === 'objectives') ui.openObjectives(game.save.level, game.save.completed, resume);
  else if (kind === 'inventory') ui.openInventory(game.save.inventory, game.story.tools(), resume);
  else openCrewPanel(resume);
}
function openCrewPanel(onClose: () => void) {
  ui.openCrew((id) => game.story.crewStatus(id), onClose, () => {
    ui.openNames((game.save.names ?? {}) as CrewNames, 'edit', (names) => {
      game.save.names = names;
      applyCrewNames(names);
      game.persist();
      openCrewPanel(onClose);
    }, () => openCrewPanel(onClose));
  });
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'game' && !paused && !suppressPauseOnUnlock) openPause();
  suppressPauseOnUnlock = false;
});

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return; // typing a name
  if ((e.code === 'Enter' || e.code === 'Escape') && (state === 'cinematic' || state === 'narrator' || state === 'flashback' || (state === 'game' && (game.mode === 'wake' || game.mode === 'scene')))) { skipCurrent(); return; }
  if (state !== 'game') return;
  if (e.code === 'Escape') {
    if (ui.modalOpen() && paused) resume();
    else openPause();
  } else if (e.code === 'KeyJ' || e.code === 'KeyO') {
    if (ui.modalOpen()) resume(); else openPanel('objectives');
  } else if (e.code === 'KeyC') {
    if (ui.modalOpen()) resume(); else openPanel('crew');
  } else if (e.code === 'KeyI' || e.code === 'Tab') {
    e.preventDefault();
    if (ui.modalOpen()) resume(); else openPanel('inventory');
  }
});

window.addEventListener('beforeunload', () => { if (state === 'game' && game?.mode === 'play') game.persist(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'game' && game?.mode === 'play') game.persist(); });

// ---------------- boot ----------------
const clock = new THREE.Clock();
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fpsLast = performance.now();

let frameCount = 0;
function frame() {
  requestAnimationFrame(frame);
  frameCount++;
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (state === 'title' || state === 'loading') {
    cine.idle(dt);
  } else if (state === 'cinematic' || state === 'flashback') {
    cine.update(dt);
  } else if (state === 'narrator') {
    vault.update(dt);
  } else if (state === 'game') {
    touch.show(input.device === 'touch' && game.mode === 'play' && !paused && !ui.modalOpen());
    touch.update();
    if (!paused && game.mode !== 'dead') game.update(dt, elapsed);
    const focus = player.pos;
    if (photo) { camera.position.copy(photo.from); camera.lookAt(photo.to); }
    world.update(paused ? 0 : dt, elapsed, game.save.timeOfDay, focus, camera, renderer.renderer);
  }
  // portrait screens: widen the vertical FOV so the horizontal view stays usable
  const activeCam = state === 'game' ? camera : state === 'narrator' ? vault.camera : cine.camera;
  const designFov = activeCam.fov;
  fitFov(activeCam);
  renderer.render(dt, elapsed);
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

async function boot() {
  ui.show('loading', false);
  showTitle();
  requestAnimationFrame(frame);
  const btns = ['btn-new', 'btn-continue'].map((id) => document.getElementById(id) as HTMLButtonElement);
  await world.build((p) => ui.setLoading(p));
  player = new Player(world.terrain, world.forest, camera, quality.name === 'mobile' ? 0.6 : 1);
  player.sensitivity = settings.sensitivity;
  player.invertY = settings.invertY;
  world.scene.add(player.model.root);
  game = new Game(world, player, input, ui, (id) => touch.highlight(id));
  game.onLevelComplete = onLevelDone;
  // warm up shaders so the first in-game frame doesn't hitch
  player.spawn(0, 2, 0.35);
  world.update(0.016, 0, 8.2, player.pos, camera, renderer.renderer);
  renderer.renderer.compile(world.scene, camera);
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
  get voice() { return { last: voice.lastKey, played: voice.played }; },
  voiceDuration(k: string) { return voice.duration(k); },
  get vault() { return { playing: vault.playing, line: vault.lineIndex }; },
  skip() { skipCurrent(); },
  get tutorial() { const tu = game?.tutorial; return tu?.active ? { step: tu.step, index: tu.index } : null; },
  get device() { return input.device; },
  get level() { return game?.save?.level; },
  setTime(h: number) { if (game?.save) game.save.timeOfDay = h; },
  cineSeek(t: number) { cine.seek(t); },
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
