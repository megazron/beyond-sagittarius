import type * as THREE from 'three';

/**
 * `?perf=1`: the frame-time budget on screen, so a regression shows while you play. Frames a second (and the worst
 * frame of the last second), milliseconds in the game's update and in drawing, draw calls, triangles, and how many
 * skinned bodies were drawn. The same numbers are on `window.__bs.perf` for the perf gate (tools/perf_gate.py), which
 * cannot measure time under software GL but can count.
 */
export const PERF = { on: new URLSearchParams(location.search).has('perf'), fps: 0, worst: 0, tick: 0, draw: 0, calls: 0, tris: 0, bodies: 0, skinned: 0, frame: 1, _b: 0, _s: 0 };

/** A body's mesh is being drawn by a game camera (character.ts): `last` is that body's own frame stamp; returns the new one. */
export function perfBody(last: number) { PERF._s++; if (last !== PERF.frame) PERF._b++; return PERF.frame; }

let el: HTMLDivElement | null = null, frames = 0, acc = 0, worst = 0, tickAcc = 0, drawAcc = 0;

/** Count one frame: `tickMs` in update, `drawMs` in render. Reads the renderer's counters (reset by the caller's frame). */
export function perfFrame(gl: THREE.WebGLRenderer, dt: number, tickMs: number, drawMs: number) {
  frames++; acc += dt; worst = Math.max(worst, dt); tickAcc += tickMs; drawAcc += drawMs;
  PERF.calls = gl.info.render.calls; PERF.tris = gl.info.render.triangles; gl.info.reset();
  PERF.bodies = PERF._b; PERF.skinned = PERF._s; PERF._b = PERF._s = 0; PERF.frame++;
  if (acc < 0.5) return;
  PERF.fps = frames / acc; PERF.worst = worst * 1000; PERF.tick = tickAcc / frames; PERF.draw = drawAcc / frames;
  frames = 0; acc = 0; worst = 0; tickAcc = 0; drawAcc = 0;
  if (!PERF.on) return;
  if (!el) {
    el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;font:600 12px/1.35 ui-monospace,monospace;color:#e8a33d;background:rgba(10,9,14,.72);padding:6px 9px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
  }
  const k = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(2)} M` : n > 1e3 ? `${(n / 1e3).toFixed(0)} k` : `${n}`);
  el.textContent = `${PERF.fps.toFixed(0)} fps  worst ${PERF.worst.toFixed(0)} ms\nupdate ${PERF.tick.toFixed(1)} ms  draw ${PERF.draw.toFixed(1)} ms\n${PERF.calls} draws  ${k(PERF.tris)} tris\n${PERF.bodies} bodies  ${PERF.skinned} skinned draws  pr ${gl.getPixelRatio().toFixed(2)}`;
}
