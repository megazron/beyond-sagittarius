import { audio } from './audio';
import { getLang, isRenamed, tDefault, Lang } from '../i18n';

const BASE = import.meta.env.BASE_URL;

/**
 * Pre-rendered dubbing. public/audio/vo/<lang>/index.json lists every line with
 * its duration; each line is a small MP3 fetched on first use (and preloaded
 * for scenes), decoded and played through the voice bus.
 */
class Voice {
  private index: Partial<Record<Lang, Record<string, number>>> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private src: AudioBufferSourceNode | null = null;
  private token = 0;
  /** Last line started (read by the tests). */
  lastKey: string | null = null;
  played = 0;

  async load(lang: Lang = this.lang) {
    if (this.index[lang]) return;
    try {
      const r = await fetch(`${BASE}audio/vo/${lang}/index.json`);
      this.index[lang] = r.ok ? await r.json() : {};
    } catch { this.index[lang] = {}; }
  }

  /** Spoken language; null follows the game language. */
  override: Lang | null = null;
  private get lang(): Lang { return this.override ?? getLang(); }

  /** File key for a line: name-free take if a crewmate named in it was renamed. */
  private file(key: string): string | null {
    const idx = this.index[this.lang];
    if (!idx) return null;
    const ids = Array.from(tDefault(key).matchAll(/\{[nf]:([a-z]+)\}/g)).map((m) => m[1]);
    if (ids.some(isRenamed)) { const anon = `${key}~anon`; return idx[anon] !== undefined ? anon : null; }
    return idx[key] !== undefined ? key : null;
  }

  /** Spoken length in seconds, or null if the line has no audio. */
  duration(key: string): number | null {
    const f = this.file(key);
    return f ? this.index[this.lang]![f] : null;
  }

  private fetchBuffer(file: string): Promise<AudioBuffer | null> {
    const url = `${BASE}audio/vo/${this.lang}/${encodeURIComponent(file)}.mp3`;
    let p = this.buffers.get(url);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(url);
          if (!r.ok || !audio.ctx) return null;
          return await audio.ctx.decodeAudioData(await r.arrayBuffer());
        } catch { return null; }
      })();
      this.buffers.set(url, p);
      if (this.buffers.size > 80) this.buffers.delete(this.buffers.keys().next().value!);
    }
    return p;
  }

  preload(keys: string[]) { for (const k of keys) { const f = this.file(k); if (f && audio.ctx) void this.fetchBuffer(f); } }

  /** Play a line (replacing the current one). Returns its length, or null. */
  play(key: string): number | null {
    const f = this.file(key);
    if (!f) return null;
    const dur = this.index[this.lang]![f];
    this.lastKey = key; this.played++;
    this.stop();
    const tk = ++this.token;
    if (!audio.ctx) return dur;
    void this.fetchBuffer(f).then((b) => {
      if (!b || tk !== this.token || !audio.ctx) return;
      const s = audio.ctx.createBufferSource();
      s.buffer = b;
      s.connect(audio.voiceIn());
      s.onended = () => { if (this.src === s) { this.src = null; audio.duck(false); } };
      s.start();
      this.src = s;
      audio.duck(true);
    });
    return dur;
  }

  stop() {
    this.token++;
    if (this.src) { try { this.src.stop(); } catch { /* already over */ } this.src = null; audio.duck(false); }
  }

  /** Current speech loudness 0..1 (drives mouths and the narrator's halo). */
  level() { return this.src ? audio.voiceLevel() : 0; }
}

export const voice = new Voice();
