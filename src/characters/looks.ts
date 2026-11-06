import type { FaceLook } from './face';
import { fx, fy } from './face';
import type { HairColors, HairStyleId } from './hair';

export type CrewId = Exclude<HairStyleId, 'suit'>;

/** Body build, relative to a 1.75 m figure. */
export interface Build { height: number; shoulder: number; chest: number; waist: number; hip: number; limb: number; bust: number; head: number; }

/** How a character carries themselves. */
export interface Persona {
  stride: number; armSwing: number; bounce: number; hipSway: number; shoulderSway: number;
  lean: number; stoop: number; stance: number;
  idle: 'fidget' | 'folded' | 'clasped' | 'scout' | 'shrug' | 'pose';
}

export interface Look {
  build: Build; persona: Persona; face: FaceLook; hair: HairColors;
  /** Limb skin glow: marks painted on arms and neck. */
  glow: number; marks: 'dots' | 'cracks' | 'veins' | 'stripes' | 'plates' | 'stars';
}

const dots = (e: CanvasRenderingContext2D, c: CanvasRenderingContext2D, col: string) => {
  e.fillStyle = col; c.fillStyle = col;
  for (const [x, y, r] of [[-0.72, -0.1, 4], [-0.64, -0.24, 3], [-0.76, -0.3, 2.5], [-0.58, -0.09, 2.2], [0.72, -0.1, 4], [0.64, -0.24, 3], [0.76, -0.3, 2.5], [0.58, -0.09, 2.2], [-0.16, 0.56, 2.5], [0.13, 0.62, 2]]) {
    e.beginPath(); e.arc(fx(x), fy(y), r, 0, 7); e.fill(); c.beginPath(); c.arc(fx(x), fy(y), r, 0, 7); c.fill();
  }
};

export const LOOKS: Record<CrewId, Look> = {
  // Ulari-human, Europa under-ice: teal skin, bioluminescent freckles.
  scientist: {
    build: { height: 1.0, shoulder: 0.93, chest: 0.9, waist: 0.92, hip: 0.92, limb: 0.86, bust: 0, head: 1 },
    persona: { stride: 0.8, armSwing: 0.5, bounce: 0.04, hipSway: 0.02, shoulderSway: 0.03, lean: 0.11, stoop: 0.14, stance: 0.06, idle: 'fidget' },
    face: { skin: 0x57b3ad, shade: 0x1c6f88, iris: 0x7ffcff, glow: true, eye: 'tired', brow: 0x12305a, mouth: 'smirk',
      marks: (c, e) => dots(e, c, '#a8fff5') },
    hair: { root: 0x0a1433, mid: 0x142c66, tip: 0x24c6d8, shine: 0x7fd8ff },
    glow: 0x6ff6e6, marks: 'dots',
  },
  // Korrath-human, Titan foundries: amber bronze hide, ember seams, swept horns.
  strong: {
    build: { height: 1.11, shoulder: 1.34, chest: 1.3, waist: 1.14, hip: 1.1, limb: 1.42, bust: 0, head: 0.93 },
    persona: { stride: 0.74, armSwing: 0.46, bounce: 0.03, hipSway: 0.02, shoulderSway: 0.12, lean: 0.05, stoop: 0, stance: 0.15, idle: 'folded' },
    face: { skin: 0xc77d33, shade: 0x7c3016, iris: 0xffc23a, glow: true, eye: 'narrow', brow: 0x3b0f08, mouth: 'flat',
      marks: (c, e) => {
        // eyebrow scar and ember seams along the jaw
        c.strokeStyle = '#e8c49a'; c.lineWidth = 4; c.beginPath(); c.moveTo(fx(0.34), fy(0.5)); c.lineTo(fx(0.5), fy(0.05)); c.stroke();
        e.strokeStyle = c.strokeStyle = '#ff8a22'; e.lineWidth = 3; c.lineWidth = 3; e.lineCap = c.lineCap = 'round';
        for (const s of [-1, 1]) for (const g of [c, e]) { g.beginPath(); g.moveTo(fx(s * 0.82), fy(-0.05)); g.lineTo(fx(s * 0.67), fy(-0.3)); g.lineTo(fx(s * 0.74), fy(-0.42)); g.lineTo(fx(s * 0.5), fy(-0.72)); g.stroke(); }
      } },
    hair: { root: 0x4a0612, mid: 0xc4201e, tip: 0xffb02e, shine: 0xffd27a },
    glow: 0xff7a1e, marks: 'cracks',
  },
  // Vael-human, Martian garden domes: soft violet skin, long ears, brow sigil.
  medic: {
    build: { height: 0.97, shoulder: 0.84, chest: 0.84, waist: 0.76, hip: 0.96, limb: 0.76, bust: 0.75, head: 1 },
    persona: { stride: 0.56, armSwing: 0.22, bounce: 0.02, hipSway: 0.05, shoulderSway: 0.02, lean: 0.02, stoop: -0.03, stance: 0.04, idle: 'clasped' },
    face: { skin: 0xc3a8ee, shade: 0x7a58c8, iris: 0xe4d6ff, glow: true, eye: 'calm', brow: 0xbbb4e0, mouth: 'soft',
      marks: (c, e) => {
        for (const g of [c, e]) { g.fillStyle = '#e9dcff'; g.beginPath(); g.moveTo(fx(0), fy(0.68)); g.lineTo(fx(0.055), fy(0.56)); g.lineTo(fx(0), fy(0.44)); g.lineTo(fx(-0.055), fy(0.56)); g.fill(); }
      } },
    hair: { root: 0x6d6aa8, mid: 0xb6b8dc, tip: 0xe9e6f8, shine: 0x6a6c8a },
    glow: 0xc8a8ff, marks: 'veins',
  },
  // Tarnkin-human, Ganymede ice caravans: coral rose skin, darker stripes, a tail.
  explorer: {
    build: { height: 0.98, shoulder: 0.9, chest: 0.86, waist: 0.8, hip: 0.97, limb: 0.84, bust: 0.62, head: 1 },
    persona: { stride: 1.12, armSwing: 0.8, bounce: 0.075, hipSway: 0.04, shoulderSway: 0.06, lean: 0.12, stoop: 0, stance: 0.09, idle: 'scout' },
    face: { skin: 0xe68a78, shade: 0xb23d4c, iris: 0x4cf08c, glow: true, eye: 'bright', brow: 0x6e2a12, mouth: 'grin',
      marks: (c) => {
        c.fillStyle = 'rgba(120,32,44,0.75)';
        for (const s of [-1, 1]) for (const [y, l] of [[0.1, 0.2], [-0.1, 0.24], [-0.3, 0.18]]) {
          c.beginPath(); c.moveTo(fx(s * 0.98), fy(y + 0.04)); c.lineTo(fx(s * (0.98 - l)), fy(y)); c.lineTo(fx(s * 0.98), fy(y - 0.05)); c.fill();
        }
        // a strip of field tape across the nose
        c.fillStyle = '#f3e7cf'; c.fillRect(fx(-0.17), fy(-0.13), fx(0.17) - fx(-0.17), 12);
      } },
    hair: { root: 0x8c2a0a, mid: 0xf07a18, tip: 0xffd24a, shine: 0xffe6a0 },
    glow: 0xff5e6e, marks: 'stripes',
  },
  // Ortek-human, Ceres shipyards: jade skin, stone brow plates, short and wide.
  builder: {
    build: { height: 0.9, shoulder: 1.2, chest: 1.2, waist: 1.24, hip: 1.14, limb: 1.26, bust: 0, head: 1.03 },
    persona: { stride: 0.68, armSwing: 0.55, bounce: 0.05, hipSway: 0.07, shoulderSway: 0.1, lean: 0.06, stoop: 0.06, stance: 0.14, idle: 'shrug' },
    face: { skin: 0x6fa867, shade: 0x2c6a48, iris: 0xff9a32, glow: true, eye: 'squint', brow: 0x123a30, mouth: 'wide',
      marks: (c) => { c.fillStyle = 'rgba(30,30,30,0.5)'; c.beginPath(); c.ellipse(fx(-0.52), fy(-0.42), 22, 11, 0.4, 0, 7); c.fill(); } },
    hair: { root: 0x063a3a, mid: 0x12a48c, tip: 0xb6ff5a, shine: 0xdcffb0 },
    glow: 0xffa030, marks: 'plates',
  },
  // MegaZroN: not on any crew list. Nobody knows what he is.
  megazron: {
    build: { height: 1.2, shoulder: 0.92, chest: 0.84, waist: 0.72, hip: 0.8, limb: 0.74, bust: 0, head: 0.96 },
    persona: { stride: 0.5, armSwing: 0.15, bounce: 0.01, hipSway: 0, shoulderSway: 0.02, lean: 0, stoop: 0.05, stance: 0.05, idle: 'clasped' },
    face: { skin: 0x23213c, shade: 0x09081a, iris: 0xffc36a, glow: true, eye: 'calm', brow: 0xe8e4f6, mouth: 'smirk',
      marks: (c, e) => {
        for (let i = 0; i < 60; i++) { const a = (i * 2.399) % 6.283, r = 0.25 + ((i * 37) % 70) / 100; for (const g of [c, e]) { g.fillStyle = '#d8dcff'; g.beginPath(); g.arc(fx(Math.cos(a) * r), fy(Math.sin(a) * r * 1.1), 0.9 + (i % 3) * 0.5, 0, 7); g.fill(); } }
      } },
    hair: { root: 0x5f6bb4, mid: 0xc4c7e4, tip: 0xf2ecd2, shine: 0x70708a },
    glow: 0xd8dcff, marks: 'dots',
  },
  // Sirelle-human, Venus cloud cities: cobalt skin, gold stars, little antennae.
  social: {
    build: { height: 0.96, shoulder: 0.86, chest: 0.88, waist: 0.76, hip: 1.02, limb: 0.8, bust: 0.8, head: 1.02 },
    persona: { stride: 0.92, armSwing: 0.62, bounce: 0.05, hipSway: 0.13, shoulderSway: 0.08, lean: 0, stoop: -0.05, stance: 0.07, idle: 'pose' },
    face: { skin: 0x4d70e0, shade: 0x2a2f9e, iris: 0xffd84a, glow: true, eye: 'doll', brow: 0xc32e8f, mouth: 'gloss', lip: '#ff4fa8',
      marks: (c, e) => {
        const star = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
          g.beginPath();
          for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283, q = i % 2 ? r * 0.36 : r; g.lineTo(fx(x) + Math.cos(a) * q, fy(y) + Math.sin(a) * q); }
          g.fill();
        };
        for (const g of [c, e]) { g.fillStyle = '#ffe07a'; star(g, 0.62, -0.22, 13); star(g, 0.78, -0.08, 7); star(g, -0.68, -0.24, 8); }
      } },
    hair: { root: 0x8a1266, mid: 0xff3f9e, tip: 0xffb0e6, shine: 0xffe4f6 },
    glow: 0xffe07a, marks: 'stars',
  },
};
