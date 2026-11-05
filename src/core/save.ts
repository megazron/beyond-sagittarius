// localStorage persistence for game progress and player settings.

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
  savedAt: number;
}

export interface Settings {
  lang: 'en' | 'hi' | 'ur';
  sensitivity: number;
  invertY: boolean;
  volume: number;
  subtitles: boolean;
  showFps: boolean;
}

const SAVE_KEY = 'bs-save-v1';
const SETTINGS_KEY = 'bs-settings-v1';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.version === 1 ? d : null;
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

export function newSave(): SaveData {
  return {
    version: 1,
    level: 1,
    completed: [],
    stats: { health: 82, thirst: 38, hunger: 55, stamina: 100 },
    inventory: { stone: 0, branch: 0, fruit: 0 },
    pos: [0, 0, 0],
    yaw: 0,
    timeOfDay: 8.2,
    day: 1,
    flags: {},
    collected: [],
    savedAt: 0,
  };
}

export function loadSettings(): Settings {
  const def: Settings = { lang: 'en', sensitivity: 1, invertY: false, volume: 0.7, subtitles: true, showFps: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  const nav = navigator.language || '';
  if (nav.startsWith('hi')) def.lang = 'hi';
  else if (nav.startsWith('ur')) def.lang = 'ur';
  return def;
}

export function writeSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
