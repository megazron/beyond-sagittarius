// localStorage persistence for game progress and player settings.
import { migrateNames } from './crew';

export interface SaveData {
  version: 1;
  level: number; // current level index (1-based)
  completed: number[];
  stats: { health: number; thirst: number; hunger: number; stamina: number };
  inventory: Record<string, number>;
  pos: [number, number, number];
  yaw: number;
  timeOfDay: number; // hours 0-24
  day: number;
  flags: Record<string, boolean>;
  collected: string[]; // ids of picked-up world items
  /** Custom crew names chosen on the pre-game screen (missing = default). */
  names?: Partial<Record<string, string>>;
  /** Number of times the night predator was driven off (level 7). */
  houndHits?: number;
  /** Bites taken from the predator; deaths so far (the narrator keeps score). */
  bites?: number;
  deaths?: number;
  savedAt: number;
}

export interface Settings {
  lang: 'en' | 'hi' | 'ur';
  sensitivity: number;
  invertY: boolean;
  volume: number;
  voiceVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  subtitles: boolean;
  /** Subtitle language, independent of the game: 'same', en, hi, ur or off. */
  subLang: 'same' | 'en' | 'hi' | 'ur' | 'off';
  /** Spoken language: 'same' follows the game language. */
  voiceLang: 'same' | 'en' | 'hi' | 'ur';
  showFps: boolean;
  /** Set from the title-screen settings: run the tutorial on the next session. */
  replayTutorial?: boolean;
}

const SAVE_KEY = 'bs-save-v1';
const SETTINGS_KEY = 'bs-settings-v1';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1) return null;
    // saves from the 0.1 slice predate these fields
    d.inventory = { ...emptyInventory(), ...d.inventory };
    d.flags ??= {};
    d.collected ??= [];
    d.names = migrateNames(d.names);
    return d;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  d.savedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(d));
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function emptyInventory(): Record<string, number> {
  return { stone: 0, branch: 0, fruit: 0, tinder: 0, frond: 0, flint: 0, vine: 0, scrap: 0 };
}

export function newSave(): SaveData {
  return {
    version: 1,
    level: 1,
    completed: [],
    stats: { health: 82, thirst: 38, hunger: 55, stamina: 100 },
    inventory: emptyInventory(),
    pos: [0, 0, 0],
    yaw: 0,
    timeOfDay: 8.2,
    day: 1,
    flags: {},
    collected: [],
    names: {},
    houndHits: 0,
    savedAt: 0,
  };
}

export function loadSettings(): Settings {
  const def: Settings = { lang: 'en', sensitivity: 1, invertY: false, volume: 0.8, voiceVolume: 1, musicVolume: 0.6, sfxVolume: 0.8, muted: false, subtitles: true, subLang: 'same', voiceLang: 'same', showFps: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = { ...def, ...JSON.parse(raw) } as Settings;
      if (s.subtitles === false && !JSON.parse(raw).subLang) s.subLang = 'off'; // older settings
      return s;
    }
  } catch { /* ignore */ }
  const nav = navigator.language || '';
  if (nav.startsWith('hi')) def.lang = 'hi';
  else if (nav.startsWith('ur')) def.lang = 'ur';
  return def;
}

export function writeSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
