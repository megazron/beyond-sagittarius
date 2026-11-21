/**
 * The title sequence as a rendered film. The picture is a <video>; the music, voices, cards and
 * subtitles stay with the game, and the video follows the music clock, so they can't drift apart.
 * No manifest, or a file that won't start in time: the real-time sequence plays as before.
 */
const BASE = `${import.meta.env.BASE_URL}film/`;
const DRIFT = 0.1;
const SEEK = 0.25; // further off than this, jump

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
    // a seek in flight is left to land: seeking again every frame kept a short take decoding from its first frame and
    // it froze on screen (A4 held one frame for two seconds). Small drift is taken up by the playback rate instead
    if (el.seeking) return;
    const d = t - el.currentTime;
    if (Math.abs(d) > SEEK) { el.currentTime = t; el.playbackRate = 1; return; }
    el.playbackRate = Math.abs(d) > DRIFT * 0.3 ? Math.min(1.5, Math.max(0.6, 1 + d * 2)) : 1;
  }

  get time() { return this.el.currentTime; }
  /** Several takes share one layer: only the playing one is shown, the rest wait paused. */
  visible(on: boolean) { this.el.style.display = on ? 'block' : 'none'; if (!on) this.el.pause(); }
  close() { this.el.pause(); this.el.remove(); this.el.src = ''; }
}
