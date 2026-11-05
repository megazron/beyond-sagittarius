import en from './en.json';
import hi from './hi.json';
import ur from './ur.json';

export type Lang = 'en' | 'hi' | 'ur';
type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { en, hi, ur };
export const LANGS: Lang[] = ['en', 'hi', 'ur'];
export const RTL: Record<Lang, boolean> = { en: false, hi: false, ur: true };

let current: Lang = 'en';
const listeners = new Set<() => void>();
/** Player-chosen strings that win over every dictionary (custom crew names). */
let overrides: Record<string, string> = {};

/**
 * Translate a key. Besides `{param}` placeholders, strings may reference crew
 * names: `{n:medic}` is the full name and `{f:medic}` the first name, so
 * player-customised names flow into every line of dialogue.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = overrides[key] ?? DICTS[current][key] ?? DICTS.en[key] ?? key;
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  if (s.includes('{n:') || s.includes('{f:')) {
    s = s.replace(/\{([nf]):([a-z]+)\}/g, (_, kind: string, id: string) => {
      const full = t(`crew.${id}.name`);
      return kind === 'n' ? full : full.trim().split(/\s+/)[0];
    });
  }
  return s;
}

/** Replace the active override table (e.g. custom names) and refresh the UI. */
export function setOverrides(o: Record<string, string>) {
  overrides = { ...o };
  applyI18n(document.body);
  listeners.forEach((f) => f());
}

/** Has the player given this crewmate a custom name? */
export function isRenamed(id: string): boolean { return `crew.${id}.name` in overrides; }

/** Dictionary value, ignoring overrides (used to show defaults). */
export function tDefault(key: string): string {
  return DICTS[current][key] ?? DICTS.en[key] ?? key;
}

export function langName(l: Lang) {
  return DICTS[l]['lang.name'];
}

export function getLang() {
  return current;
}

export function setLang(l: Lang) {
  current = l;
  const html = document.documentElement;
  html.lang = l;
  html.dir = RTL[l] ? 'rtl' : 'ltr';
  document.body.classList.remove('lang-en', 'lang-hi', 'lang-ur');
  document.body.classList.add(`lang-${l}`);
  applyI18n(document.body);
  listeners.forEach((f) => f());
}

export function onLangChange(f: () => void) {
  listeners.add(f);
}

/** Fill every [data-i18n] element under root with its translated text. */
export function applyI18n(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
}
