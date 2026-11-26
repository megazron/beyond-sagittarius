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
/** Speech level of a take: RMS over its 50 ms windows louder than -45 dBFS (the pauses left out). Every take is brought
 *  to -20 dBFS of speech (about -18 LUFS), within -6 to +9 dB, so no line sits back in the mix because its file is quiet. */
const LEVEL = new WeakMap<AudioBuffer, number>();
export function levelOf(b: AudioBuffer) {
  let g = LEVEL.get(b);
  if (g !== undefined) return g;
  const d = b.getChannelData(0), w = Math.max(1, Math.round(b.sampleRate * 0.05)), gate = 10 ** (-45 / 10);
  let sum = 0, n = 0;
  for (let i = 0; i + w <= d.length; i += w) {
    let e = 0; for (let j = i; j < i + w; j++) e += d[j] * d[j];
    e /= w; if (e > gate) { sum += e; n++; }
  }
  const db = n ? 10 * Math.log10(sum / n) : -20;
  g = Math.min(2.8, Math.max(0.5, 10 ** ((-20 - db) / 20)));
  LEVEL.set(b, g);
  return g;
}

class Voice {
  private index: Partial<Record<Lang, Record<string, number>>> = {};
  private takes: Partial<Record<Lang, Record<string, Take>>> = {};
  private takesLoaded: Promise<void> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private src: AudioBufferSourceNode | null = null;
  private token = 0;
  /** Test hook (recordings): every line started on a held clock, to lay the soundtrack under recorded frames. */
  log: { path: string; at: number; vol: number; fx?: string }[] = [];
  /** Last line started (read by the tests). */
  lastKey: string | null = null;
  played = 0;

  async load(lang: Lang = this.lang) {
    // lines nobody has dubbed in Hindi or Urdu yet are spoken in English, under their own subtitles
    if (lang !== 'en') await this.load('en');
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

  /** Generated takes are Opus in Ogg (tools/tts/generate_voice.py). */
  private ext = 'ogg';
  /** Spoken language; null follows the game language. */
  override: Lang | null = null;
  private get lang(): Lang { return this.override ?? getLang(); }

  /** The language a take is spoken in: the game's, or English where that language has no take of it. */
  private langOf(file: string): Lang {
    const has = (l: Lang) => this.takes[l]?.[file] !== undefined || this.index[l]?.[file] !== undefined;
    return has(this.lang) || !has('en') ? this.lang : 'en';
  }
  private has(file: string): boolean {
    const l = this.langOf(file);
    return this.takes[l]?.[file] !== undefined || this.index[l]?.[file] !== undefined;
  }

  private seconds(file: string): number {
    const l = this.langOf(file);
    return this.takes[l]?.[file]?.d ?? this.index[l]![file];
  }

  /** URLs to try for a line, best first. Safari may refuse .ogg, so mp3/m4a win when both exist. */
  private urls(file: string): string[] {
    const lang = this.langOf(file), name = encodeURIComponent(file);
    const formats = this.takes[lang]?.[file]?.f ?? [];
    const recorded = ['mp3', 'm4a', 'ogg'].filter((e) => formats.includes(e))
      .map((e) => `${BASE}audio/voice/override/${lang}/${name}.${e}`);
    return this.index[lang]?.[file] !== undefined ? [...recorded, `${BASE}audio/vo/${lang}/${name}.${this.ext}`] : recorded;
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

  /** Resolves once the index is in and the first of `keys` is decoded (or after `ms`): a scene's first line then starts
   * with its subtitle instead of after a fetch. */
  async ready(keys: string[], ms = 4000) {
    const go = (async () => { await this.load(); this.preload(keys); const f = keys.length ? this.file(keys[0]) : null; if (f && audio.ctx) await this.fetchBuffer(f); })();
    await Promise.race([go.catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);
  }

  preload(keys: string[]) { for (const k of keys) { const f = this.file(k); if (f && audio.ctx) void this.fetchBuffer(f); } }

  /** Play a line (replacing the current one). Returns its length, or null. `memory`: a remembered voice in his head
   * (a thin, far band with a short echo; audio.memoryIn). */
  play(key: string, o: { memory?: boolean } = {}): number | null {
    const f = this.file(key);
    if (!f) return null;
    const dur = this.seconds(f);
    // a line that starts while another is still being said cuts it off: written down, so tests can refuse it
    const left = this.remaining();
    if (left > 0.25 && this.lastKey && this.lastKey !== key) { this.cuts.push({ cut: this.lastKey, by: key, left: Math.round(left * 100) / 100 }); if (this.cuts.length > 200) this.cuts.shift(); }
    this.lastKey = key; this.played++;
    this.endsAt = this.clock() + (dur ?? 0);
    if (this.manual) { this.log.push({ path: `audio/vo/${this.langOf(f)}/${f}.${this.ext}`, at: this.manual(), vol: 1, ...(o.memory ? { fx: 'memory' } : {}) }); if (this.log.length > 400) this.log.shift(); }
    this.stop();
    const tk = ++this.token;
    // on a held clock (recordings) the mouth runs on the game's time, from the moment the line starts
    if (this.manual && dur !== null) { this.lipFile = f; this.startedAt = this.manual(); this.manualEnd = this.startedAt + dur; }
    if (!audio.ctx) return dur;
    this.waiting = tk;
    void this.fetchBuffer(f).then((b) => {
      if (this.waiting === tk) this.waiting = 0;
      if (!b || tk !== this.token || !audio.ctx) return;
      const s = audio.ctx.createBufferSource();
      s.buffer = b;
      // each take levelled to the same speech loudness, and placed a little towards where the speaker is on screen
      const g = audio.ctx.createGain(); g.gain.value = levelOf(b);
      const pan = audio.ctx.createStereoPanner(); pan.pan.value = o.memory ? 0 : this.pan; this.pan = 0;
      s.connect(g).connect(pan).connect(o.memory ? audio.memoryIn() : audio.voiceIn());
      s.onended = () => { if (this.src === s) { this.src = null; audio.duck(false); } };
      s.start();
      if (!this.manual) { this.startedAt = audio.ctx.currentTime; this.lipFile = f; }
      this.src = s;
      audio.duck(true);
    });
    return dur;
  }

  /** Stereo place of the next line (-1 left .. 1 right): the scene sets it from where the speaker is in frame. Used once. */
  pan = 0;
  /** The token of a line still being fetched and decoded (0: none). */
  private waiting = 0;
  /** A line is being said, or is still loading to be said (scenes wait for it before the next line). */
  speaking() { if (this.manual) return false; return (this.waiting !== 0 && this.waiting === this.token) || !!this.src; }

  /** Lines cut off by the next line since load (not by Skip): { cut, by, left seconds }. */
  cuts: { cut: string; by: string; left: number }[] = [];
  private endsAt = 0;
  private clock() { return this.manual ? this.manual() : performance.now() / 1000; }
  /** Seconds of the current line still to be said (0 when nobody is speaking). */
  remaining() { return Math.max(0, this.endsAt - this.clock()); }

  stop() {
    this.token++; this.manualEnd = 0; this.endsAt = 0;
    if (this.src) { try { this.src.stop(); } catch { /* already over */ } this.src = null; audio.duck(false); }
  }

  private lips: Partial<Record<Lang, Record<string, string>>> = {};
  private lipFile: string | null = null;
  private startedAt = 0;
  /** Test hook: the clock the mouth reads (the game's held clock while frames are recorded), or null for the audio clock. */
  manual: (() => number) | null = null;
  private manualEnd = 0;
  private async loadLips(lang: Lang) {
    if (lang !== 'en') void this.loadLips('en');
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
    const tr = this.lips[this.langOf(file)]?.[file];
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
