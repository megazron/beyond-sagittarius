import { audio } from './audio';
import { getLang, isRenamed, playerFemale, tDefault, Lang } from '../i18n';

const BASE = import.meta.env.BASE_URL;

/** A recorded take: seconds, and the formats on disk (see tools/tts/voice_overrides.py). */
type Take = { d: number; f: string[] };

/**
 * Pre-rendered dubbing. public/audio/vo/<lang>/index.json lists every line with
 * its duration; each line is a small MP3 fetched on first use (and preloaded
 * for scenes), decoded and played through the voice bus.
 *
 * Recorded takes: public/audio/voice/override/<lang>/<key>.ogg (or .mp3/.m4a)
 * replaces the generated line. override/index.json is written at build time, so
 * the game knows what exists without probing for 404s.
 */
class Voice {
  private index: Partial<Record<Lang, Record<string, number>>> = {};
  private takes: Partial<Record<Lang, Record<string, Take>>> = {};
  private takesLoaded: Promise<void> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private src: AudioBufferSourceNode | null = null;
  private token = 0;
  /** Last line started (read by the tests). */
  lastKey: string | null = null;
  played = 0;

  async load(lang: Lang = this.lang) {
    void this.loadLips(lang);
    this.takesLoaded ??= fetch(`${BASE}audio/voice/override/index.json`)
      .then(async (r) => { if (r.ok) this.takes = await r.json(); })
      .catch(() => { /* no recorded takes */ });
    await this.takesLoaded;
    if (this.index[lang]) return;
    try {
      const r = await fetch(`${BASE}audio/vo/${lang}/index.json`);
      this.index[lang] = r.ok ? await r.json() : {};
    } catch { this.index[lang] = {}; }
  }

  /** Spoken language; null follows the game language. */
  override: Lang | null = null;
  private get lang(): Lang { return this.override ?? getLang(); }

  private has(file: string): boolean {
    return this.takes[this.lang]?.[file] !== undefined || this.index[this.lang]?.[file] !== undefined;
  }

  private seconds(file: string): number {
    return this.takes[this.lang]?.[file]?.d ?? this.index[this.lang]![file];
  }

  /** URLs to try for a line, best first. Safari may refuse .ogg, so mp3/m4a win when both exist. */
  private urls(file: string): string[] {
    const lang = this.lang, name = encodeURIComponent(file);
    const formats = this.takes[lang]?.[file]?.f ?? [];
    const recorded = ['mp3', 'm4a', 'ogg'].filter((e) => formats.includes(e))
      .map((e) => `${BASE}audio/voice/override/${lang}/${name}.${e}`);
    return this.index[lang]?.[file] !== undefined ? [...recorded, `${BASE}audio/vo/${lang}/${name}.mp3`] : recorded;
  }

  /** File key for a line: name-free take if a crewmate named in it was renamed. */
  private file(key: string): string | null {
    if (!this.index[this.lang]) return null;
    const ids = Array.from(tDefault(key).matchAll(/\{[nf]:([a-z]+)\}/g)).map((m) => m[1]);
    // a female player has her own take of the line, grammar included
    if (playerFemale() && this.has(`${key}~f`)) return `${key}~f`;
    // only the recorded default name may ever be spoken
    if (ids.some(isRenamed) || (playerFemale() && ids.includes('scientist'))) { const anon = `${key}~anon`; return this.has(anon) ? anon : null; }
    return this.has(key) ? key : null;
  }

  /** Spoken length in seconds, or null if the line has no audio. */
  duration(key: string): number | null {
    const f = this.file(key);
    return f ? this.seconds(f) : null;
  }

  private fetchBuffer(file: string): Promise<AudioBuffer | null> {
    const urls = this.urls(file), id = urls[0];
    let p = this.buffers.get(id);
    if (!p) {
      p = (async () => {
        for (const url of urls) {
          try {
            const r = await fetch(url);
            if (r.ok && audio.ctx) return await audio.ctx.decodeAudioData(await r.arrayBuffer());
          } catch { /* undecodable here: try the next format */ }
        }
        return null;
      })();
      this.buffers.set(id, p);
      if (this.buffers.size > 80) this.buffers.delete(this.buffers.keys().next().value!);
    }
    return p;
  }

  preload(keys: string[]) { for (const k of keys) { const f = this.file(k); if (f && audio.ctx) void this.fetchBuffer(f); } }

  /** Play a line (replacing the current one). Returns its length, or null. */
  play(key: string): number | null {
    const f = this.file(key);
    if (!f) return null;
    const dur = this.seconds(f);
    this.lastKey = key; this.played++;
    this.stop();
    const tk = ++this.token;
    // on a held clock (recordings) the mouth runs on the game's time, from the moment the line starts
    if (this.manual && dur !== null) { this.lipFile = f; this.startedAt = this.manual(); this.manualEnd = this.startedAt + dur; }
    if (!audio.ctx) return dur;
    void this.fetchBuffer(f).then((b) => {
      if (!b || tk !== this.token || !audio.ctx) return;
      const s = audio.ctx.createBufferSource();
      s.buffer = b;
      s.connect(audio.voiceIn());
      s.onended = () => { if (this.src === s) { this.src = null; audio.duck(false); } };
      s.start();
      if (!this.manual) { this.startedAt = audio.ctx.currentTime; this.lipFile = f; }
      this.src = s;
      audio.duck(true);
    });
    return dur;
  }

  stop() {
    this.token++; this.manualEnd = 0;
    if (this.src) { try { this.src.stop(); } catch { /* already over */ } this.src = null; audio.duck(false); }
  }

  private lips: Partial<Record<Lang, Record<string, string>>> = {};
  private lipFile: string | null = null;
  private startedAt = 0;
  /** Test hook: the clock the mouth reads (the game's held clock while frames are recorded), or null for the audio clock. */
  manual: (() => number) | null = null;
  private manualEnd = 0;
  private async loadLips(lang: Lang) {
    if (this.lips[lang]) return;
    this.lips[lang] = {};
    try { const r = await fetch(`${BASE}audio/vo/${lang}/lipsync.json`); if (r.ok) this.lips[lang] = await r.json(); } catch { /* mouths stay shut */ }
  }

  /**
   * Mouth shape right now, read from the clip's own track (open, round, wide,
   * 0..1). All zero when nothing is playing, so silence is a closed mouth.
   */
  mouth(out: { open: number; round: number; wide: number }) {
    out.open = out.round = out.wide = 0;
    const now = this.manual ? this.manual() : audio.ctx?.currentTime ?? 0;
    const file = this.lipFile;
    if (!file || (this.manual ? now > this.manualEnd : !this.src || !audio.ctx)) return out;
    const tr = this.lips[this.lang]?.[file];
    if (!tr) return out;
    const [a, b, c] = tr.split('|');
    const f = (now - this.startedAt) * 25, i = Math.floor(f), k = f - i;
    const at = (s: string) => { if (i < 0 || i + 1 >= s.length) return 0; return ((s.charCodeAt(i) - 48) * (1 - k) + (s.charCodeAt(i + 1) - 48) * k) / 9; };
    out.open = at(a); out.round = at(b); out.wide = at(c);
    return out;
  }

  /** Current speech loudness 0..1 (drives mouths and the narrator's halo). */
  level() { return this.src ? audio.voiceLevel() : 0; }
}

export const voice = new Voice();
