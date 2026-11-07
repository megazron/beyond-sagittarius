/**
 * The title sequence as a rendered film. The picture is a <video>; the music, voices, cards and
 * subtitles stay with the game, and the video follows the music clock, so they can't drift apart.
 * No manifest, or a file that won't start in time: the real-time sequence plays as before.
 */
const BASE = `${import.meta.env.BASE_URL}film/`;
const DRIFT = 0.1;

export class FilmVideo {
  private constructor(private el: HTMLVideoElement) {}

  static async open(name: string, parent: HTMLElement, small: boolean): Promise<FilmVideo | null> {
    try {
      const m = await (await fetch(`${BASE}manifest.json`)).json() as Record<string, { full: string; small: string }>;
      const f = m[name];
      if (!f) return null;
      const el = document.createElement('video');
      el.className = 'film-video'; el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.src = BASE + (small ? f.small : f.full);
      parent.prepend(el);
      const ok = await new Promise<boolean>((res) => {
        const t = setTimeout(() => res(false), 5000);
        el.addEventListener('canplay', () => { clearTimeout(t); res(true); }, { once: true });
        el.addEventListener('error', () => { clearTimeout(t); res(false); }, { once: true });
      });
      if (!ok) { el.remove(); return null; }
      return new FilmVideo(el);
    } catch { return null; }
  }

  /** Call every frame with the music time. */
  sync(t: number) {
    const el = this.el;
    if (el.paused) void el.play().catch(() => undefined);
    if (Math.abs(el.currentTime - t) > DRIFT) el.currentTime = t;
  }

  get time() { return this.el.currentTime; }
  close() { this.el.pause(); this.el.remove(); this.el.src = ''; }
}
