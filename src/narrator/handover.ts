import * as THREE from 'three';

// The end of MegaZroN's cold open: the black hole's photon ring, the last light left in the frame, becomes the lit limb
// of the Earth on the title screen. A drawn ring over the black between the two scenes: it starts where the film's
// ring is, travels and narrows to an arc where the planet's edge will be, and lets go as the title comes up under it.

export interface Disc { x: number; y: number; r: number; sun: number }

/** A sphere of radius `R` at `at`, as the camera sees it: centre and radius in CSS pixels, and the screen angle its lit side faces. */
export function discOnScreen(cam: THREE.PerspectiveCamera, at: THREE.Vector3, R: number, sunDir: THREE.Vector3, w = innerWidth, h = innerHeight): Disc {
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const p = at.clone().project(cam), d = cam.position.distanceTo(at);
  const r = (Math.tan(Math.asin(Math.min(0.999, R / d))) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * (h / 2);
  const s = sunDir.clone().applyQuaternion(cam.quaternion.clone().invert());
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, r, sun: Math.atan2(-s.y, s.x) };
}

const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class RingHandover {
  private c = document.createElement('canvas');
  private t0 = 0; private raf = 0; private letGo = 0; private done = false;
  /**
   * `from`: the film's ring (fractions of the frame's height round the centre). `to`: the planet's disc on the title.
   * `travel`: seconds for the ring to get there.
   */
  constructor(private from: { r: number }, private to: Disc, private travel = 3.0) {
    const c = this.c; c.id = 'mz-ring';
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:51;pointer-events:none';
    document.body.appendChild(c);
    this.t0 = performance.now();
    const step = () => { if (this.done) return; this.draw((performance.now() - this.t0) / 1000); this.raf = requestAnimationFrame(step); };
    step();
  }
  /** Tools: where the ring is (0 film ring .. 1 on the limb), and whether it is still up. */
  get state() { return { k: sm(0.5, this.travel, (performance.now() - this.t0) / 1000), up: !this.done }; }
  /** The title is coming up under it: the arc stays on the limb for a moment, then is the limb. */
  release(secs = 2.2) { if (!this.letGo) this.letGo = performance.now(); this.fadeSecs = secs; }
  private fadeSecs = 2.2;
  stop() { this.done = true; cancelAnimationFrame(this.raf); this.c.remove(); }
  private draw(t: number) {
    const c = this.c, dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const out = this.letGo ? 1 - sm(0.5, this.fadeSecs, (performance.now() - this.letGo) / 1000) : 1;
    if (this.letGo && out <= 0) { this.stop(); return; }
    const k = sm(0.5, this.travel, t), a = sm(0, 0.7, t) * out;
    const x = w / 2 + (this.to.x - w / 2) * k, y = h / 2 + (this.to.y - h / 2) * k, r = this.from.r * h + (this.to.r - this.from.r * h) * k;
    // from the whole ring to the lit arc: it closes from the dark side
    const half = Math.PI * (1 - 0.56 * sm(0.15, 1, k));
    const col = (o: number) => `rgba(${Math.round(255 - 120 * k)},${Math.round(196 + 14 * k)},${Math.round(128 + 127 * k)},${o})`;
    g.lineCap = 'round';
    // drawn in short pieces so the arc thins and dims to nothing at its two ends
    const N = 96;
    for (const [lw, o, blur] of [[9, 0.10, 18], [3.4, 0.35, 8], [1.5, 0.95, 0]] as const) {
      g.shadowColor = col(0.9); g.shadowBlur = blur;
      for (let i = 0; i < N; i++) {
        const u0 = i / N, u1 = (i + 1.15) / N, m = (u0 + u1) / 2;
        const edge = k < 0.15 ? 1 : Math.pow(Math.sin(Math.PI * m), 0.6);
        g.strokeStyle = col(o * a * edge); g.lineWidth = lw * (0.45 + 0.55 * edge) * (h / 720);
        g.beginPath(); g.arc(x, y, r, this.to.sun - half + u0 * 2 * half, this.to.sun - half + u1 * 2 * half); g.stroke();
      }
    }
    g.shadowBlur = 0;
  }
}
