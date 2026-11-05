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

type State = 'loading' | 'title' | 'cinematic' | 'game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const settings: Settings = loadSettings();
setLang(settings.lang);
const quality = detectQuality();
const ui = new UI();
ui.subtitlesOn = settings.subtitles;
audio.setVolume(settings.volume);

let renderer: Renderer;
try {
  renderer = new Renderer(canvas, quality);
} catch (e) {
  document.getElementById('loading')!.innerHTML = '<div class="loader-text">WebGL2 is required to play BEYOND SAGITTARIUS.</div>';
  throw e;
}

const input = new Input(canvas);
const cine = new Cinematic(ui);
const world = new World(quality);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2400);
let player: Player;
let game: Game;
let state: State = 'loading';
let paused = false;
let worldReady = false;
let pendingStart: (() => void) | null = null;

document.getElementById('quality-badge')!.textContent = quality.name.toUpperCase();
renderer.setScene(cine.scene, cine.camera, false);

function persistSettings() {
  writeSettings(settings);
  ui.subtitlesOn = settings.subtitles;
  audio.setVolume(settings.volume);
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
  paused = false;
  input.enabled = false;
  input.releasePointer();
  ui.show('title', true);
  ui.show('hud', false);
  ui.show('cine', false);
  ui.subtitle(null);
  ui.closeModal();
  renderer.setScene(cine.scene, cine.camera, false);
  ui.fade('black', 0, 1.2);
  audio.stopWind();
  refreshTitle();
}

function whenWorldReady(fn: () => void) {
  if (worldReady) fn();
  else { pendingStart = fn; ui.show('loading', true); }
}

function startNewGame() {
  audio.start();
  clearSave();
  ui.show('title', false);
  ui.fade('black', 1, 0.8);
  setTimeout(() => {
    state = 'cinematic';
    ui.show('cine', true);
    document.getElementById('btn-skip')!.classList.remove('hidden');
    renderer.setScene(cine.scene, cine.camera, false);
    cine.start(() => {
      ui.fade('black', 1, 0.3);
      setTimeout(() => whenWorldReady(() => enterWorld(true)), 350);
    });
  }, 850);
}

function continueGame() {
  audio.start();
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
  game.start(save, fresh);
  if (!fresh) ui.fade('black', 0, 1.2);
  renderer.resize();
}

document.getElementById('btn-new')!.addEventListener('click', () => {
  audio.start(); audio.uiClick();
  if (loadSave()) ui.openConfirm(t('menu.newGameConfirm'), startNewGame, () => {});
  else startNewGame();
});
document.getElementById('btn-continue')!.addEventListener('click', () => { audio.uiClick(); continueGame(); });
document.getElementById('btn-settings')!.addEventListener('click', () => {
  audio.start(); audio.uiClick();
  ui.openSettings(settings, quality.name, persistSettings, changeQuality, refreshTitle);
});
document.querySelectorAll<HTMLButtonElement>('.btn.lang').forEach((b) => b.addEventListener('click', () => {
  audio.uiClick();
  settings.lang = b.dataset.lang as Lang;
  setLang(settings.lang);
  persistSettings();
  refreshTitle();
}));
document.getElementById('btn-skip')!.addEventListener('click', () => cine.skip());
document.getElementById('prompt')!.addEventListener('click', () => game?.interact());

// ---------------- pause / menus ----------------
let suppressPauseOnUnlock = false;
function openPause() {
  if (state !== 'game' || game.mode !== 'play' || ui.modalOpen()) return;
  paused = true;
  input.enabled = false;
  suppressPauseOnUnlock = true;
  input.releasePointer();
  ui.openPause({
    resume: resume,
    settings: () => ui.openSettings(settings, quality.name, persistSettings, changeQuality, () => openPauseAgain()),
    objectives: () => ui.openObjectives(game.save.level, game.save.completed, () => openPauseAgain()),
    crew: () => ui.openCrew(() => openPauseAgain()),
    quit: () => { game.persist(); showTitle(); },
  });
}
function openPauseAgain() { paused = false; openPause(); }
function resume() { ui.closeModal(); paused = false; input.enabled = true; }
function openPanel(kind: 'objectives' | 'crew') {
  if (state !== 'game' || game.mode !== 'play' || ui.modalOpen()) return;
  paused = true; input.enabled = false; suppressPauseOnUnlock = true; input.releasePointer();
  if (kind === 'objectives') ui.openObjectives(game.save.level, game.save.completed, resume);
  else ui.openCrew(resume);
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'game' && !paused && !suppressPauseOnUnlock) openPause();
  suppressPauseOnUnlock = false;
});

window.addEventListener('keydown', (e) => {
  if (state === 'cinematic' && (e.code === 'Enter' || e.code === 'Escape')) { cine.skip(); return; }
  if (state === 'game' && game.mode === 'wake' && (e.code === 'Enter' || e.code === 'Escape')) { game.skipWake(); return; }
  if (state !== 'game') return;
  if (e.code === 'Escape') {
    if (ui.modalOpen() && paused) resume();
    else openPause();
  } else if (e.code === 'KeyJ' || e.code === 'KeyO') {
    if (ui.modalOpen()) resume(); else openPanel('objectives');
  } else if (e.code === 'KeyC') {
    if (ui.modalOpen()) resume(); else openPanel('crew');
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
  } else if (state === 'cinematic') {
    cine.update(dt);
  } else if (state === 'game') {
    if (!paused && game.mode !== 'dead') game.update(dt, elapsed);
    const focus = player.pos;
    world.update(paused ? 0 : dt, elapsed, game.save.timeOfDay, focus, camera, renderer.renderer);
  }
  renderer.render(dt, elapsed);
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
  player = new Player(world.terrain, world.forest, camera);
  player.sensitivity = settings.sensitivity;
  player.invertY = settings.invertY;
  world.scene.add(player.model.root);
  game = new Game(world, player, input, ui);
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
});

// Small hook used by the automated smoke test and for debugging.
(window as unknown as Record<string, unknown>).__bs = {
  get state() { return state; },
  get mode() { return game?.mode; },
  get ready() { return worldReady; },
  get level() { return game?.save?.level; },
  setTime(h: number) { if (game?.save) game.save.timeOfDay = h; },
  cineSeek(t: number) { cine.seek(t); },
  wakeSeek(t: number) { game?.debugWakeSeek(t); },
  look(yaw: number, pitch: number) { if (player) { player.yaw = yaw; player.pitch = pitch; player.snapCamera(); } },
  teleport(x: number, z: number, yaw = 0) { player?.spawn(x, z, yaw); },
  quality: quality.name,
  get debug() {
    return { frames: frameCount, t: elapsed, mode: game?.mode, player: player?.pos.toArray(), cam: camera.position.toArray(), yaw: player?.yaw, creature: world.creature?.position.toArray() };
  },
};

boot();
