/**
 * How the picture is hurt this frame: a body that has just hit the ground, or one with low health. The grade (renderer.ts
 * FinalShader) reads it each frame; every term costs nothing while zero.
 * blur: soft focus, 0..1. double: double vision, offset in screen widths (0..0.02). tunnel: the edges go dark, 0..1.
 * desat: colour drains, 0..1. red: a warm wash over the frame (the eyelids), 0..1. flash: white added (the hit).
 * black: the eyes closed, 0..1.
 * The arrival films (game/arrival.ts) set `film`; play (game/injury.ts) sets `play`; the stronger of each term wins.
 */
export interface Hurt { blur: number; double: number; tunnel: number; desat: number; red: number; flash: number; black: number }
export const hurtZero = (): Hurt => ({ blur: 0, double: 0, tunnel: 0, desat: 0, red: 0, flash: 0, black: 0 });
export const HURT = { film: hurtZero(), play: hurtZero() };
export function hurtNow(out: Hurt = hurtZero()): Hurt {
  const a = HURT.film, b = HURT.play;
  out.blur = Math.max(a.blur, b.blur); out.double = Math.max(a.double, b.double); out.tunnel = Math.max(a.tunnel, b.tunnel);
  out.desat = Math.max(a.desat, b.desat); out.red = Math.max(a.red, b.red); out.flash = Math.max(a.flash, b.flash); out.black = Math.max(a.black, b.black);
  return out;
}
export function clearHurt(which: 'film' | 'play') { Object.assign(HURT[which], hurtZero()); }
