import * as THREE from 'three';

export interface FaceLook {
  skin: number;
  /** Shadow / blush tint painted over the skin. */
  shade: number;
  iris: number;
  glow: boolean;
  eye: 'tired' | 'narrow' | 'calm' | 'bright' | 'squint' | 'doll';
  brow: number;
  /** Extra marks drawn on the face: paint(colour canvas, glow canvas). */
  marks?: (c: CanvasRenderingContext2D, e: CanvasRenderingContext2D) => void;
  mouth: 'smirk' | 'flat' | 'soft' | 'grin' | 'wide' | 'gloss';
  lip?: string;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export const S = 512;
/** Head-space -> canvas: face covers x,y in [-1.15, 1.15] of the unit head. */
export const fx = (x: number) => (0.5 + x / 2.3) * S;
export const fy = (y: number) => (0.5 - y / 2.3) * S;

function paintEye(c: CanvasRenderingContext2D, e: CanvasRenderingContext2D, f: FaceLook, side: number, closed: boolean) {
  const cx = fx(side * 0.42), cy = fy(0.02);
  const shape = { tired: [38, 30, 0.72], narrow: [36, 17, 0.8], calm: [40, 30, 0.72], bright: [40, 42, 0.74], squint: [36, 19, 0.82], doll: [44, 46, 0.76] }[f.eye] as number[];
  const [w, h, ir] = shape;
  const lash = f.eye === 'narrow' || f.eye === 'squint' ? '#15110f' : '#120b10';
  if (closed) {
    c.strokeStyle = lash; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx - w, cy + 2); c.quadraticCurveTo(cx, cy + 14, cx + w, cy + 2); c.stroke();
    return;
  }
  // sclera
  c.save();
  c.beginPath(); c.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#f4f2ee'; c.fillRect(cx - w, cy - h, w * 2, h * 2);
  // iris
  const R = h * ir * 1.32 + 3;
  const irisG = c.createRadialGradient(cx, cy + R * 0.3, 2, cx, cy, R);
  const col = new THREE.Color(f.iris);
  irisG.addColorStop(0, hex(col.clone().lerp(new THREE.Color(0xffffff), 0.5).getHex()));
  irisG.addColorStop(0.55, hex(f.iris));
  irisG.addColorStop(1, hex(col.clone().multiplyScalar(0.25).getHex()));
  c.fillStyle = irisG; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();
  c.fillStyle = '#0a0810'; c.beginPath(); c.ellipse(cx, cy, R * 0.42, R * 0.55, 0, 0, 7); c.fill();
  // upper-lid shadow on the eyeball
  const sh = c.createLinearGradient(0, cy - h, 0, cy - h * 0.1);
  sh.addColorStop(0, 'rgba(10,6,20,0.65)'); sh.addColorStop(1, 'rgba(10,6,20,0)');
  c.fillStyle = sh; c.fillRect(cx - w, cy - h, w * 2, h);
  // catchlights
  c.fillStyle = '#fff';
  c.beginPath(); c.ellipse(cx - R * 0.32 * side - R * 0.1, cy - R * 0.38, R * 0.24, R * 0.3, 0, 0, 7); c.fill();
  c.beginPath(); c.arc(cx + R * 0.32, cy + R * 0.34, R * 0.1, 0, 7); c.fill();
  c.restore();
  if (f.glow) {
    const g = e.createRadialGradient(cx, cy, R * 0.35, cx, cy, R * 1.1);
    g.addColorStop(0, hex(f.iris)); g.addColorStop(1, 'rgba(0,0,0,0)');
    e.fillStyle = g; e.beginPath(); e.arc(cx, cy, R * 1.1, 0, 7); e.fill();
  }
  // upper lash line: thick, swept out
  c.strokeStyle = lash; c.lineCap = 'round';
  c.lineWidth = f.eye === 'doll' ? 9 : f.eye === 'bright' || f.eye === 'calm' ? 7 : 6;
  c.beginPath(); c.moveTo(cx - side * w * 1.02, cy + h * 0.25);
  c.quadraticCurveTo(cx, cy - h * 1.3, cx + side * (w + 7), cy - h * 0.18); c.stroke();
  if (f.eye === 'doll' || f.eye === 'bright') {
    c.lineWidth = 5; c.beginPath(); c.moveTo(cx + side * (w + 3), cy - h * 0.2); c.lineTo(cx + side * (w + 17), cy - h * 0.42); c.stroke();
  }
  c.lineWidth = 2; c.strokeStyle = 'rgba(30,14,20,0.55)';
  c.beginPath(); c.moveTo(cx - w * 0.75, cy + h * 0.9); c.quadraticCurveTo(cx, cy + h * 1.15, cx + w * 0.8, cy + h * 0.7); c.stroke();
  if (f.eye === 'tired') { c.strokeStyle = 'rgba(0,0,30,0.28)'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - w * 0.7, cy + h * 1.25); c.quadraticCurveTo(cx, cy + h * 1.6, cx + w * 0.7, cy + h * 1.2); c.stroke(); }
}

function paintBrow(c: CanvasRenderingContext2D, f: FaceLook, side: number) {
  const cx = fx(side * 0.42), cy = fy(0.36);
  const heavy = f.eye === 'narrow' || f.eye === 'squint';
  c.strokeStyle = hex(f.brow); c.lineCap = 'round'; c.lineWidth = heavy ? 11 : 5.5;
  c.beginPath();
  const tilt = heavy ? 14 : f.eye === 'tired' ? -6 : 0;
  c.moveTo(cx - side * 42, cy + tilt); c.quadraticCurveTo(cx, cy - 12, cx + side * 50, cy + 6 - tilt * 0.3); c.stroke();
}

function paintMouth(c: CanvasRenderingContext2D, f: FaceLook, open: boolean) {
  const x = fx(0), y = fy(-0.56);
  c.lineCap = 'round';
  const dark = 'rgba(40,12,18,0.85)';
  if (open) {
    c.fillStyle = '#3a1016'; c.beginPath(); c.ellipse(x, y + 2, 21, 13, 0, 0, 7); c.fill();
    c.fillStyle = '#f6efe8'; c.fillRect(x - 15, y - 9, 30, 6);
    return;
  }
  c.strokeStyle = dark; c.lineWidth = 3.4;
  c.beginPath();
  if (f.mouth === 'smirk') { c.moveTo(x - 20, y + 2); c.quadraticCurveTo(x + 2, y + 6, x + 25, y - 7); }
  else if (f.mouth === 'flat') { c.moveTo(x - 26, y); c.lineTo(x + 26, y + 1); }
  else if (f.mouth === 'soft') { c.moveTo(x - 17, y); c.quadraticCurveTo(x, y + 5, x + 17, y); }
  else if (f.mouth === 'grin' || f.mouth === 'wide') {
    c.stroke(); c.fillStyle = '#f7f1ea'; c.beginPath(); c.moveTo(x - 29, y - 4); c.quadraticCurveTo(x, y + 2, x + 29, y - 4); c.quadraticCurveTo(x, y + 18, x - 29, y - 4); c.fill();
    c.strokeStyle = dark; c.beginPath(); c.moveTo(x - 31, y - 5); c.quadraticCurveTo(x, y + 21, x + 31, y - 5); c.moveTo(x - 31, y - 5); c.quadraticCurveTo(x, y + 1, x + 31, y - 5);
  } else { c.moveTo(x - 18, y); c.quadraticCurveTo(x, y + 4, x + 18, y); }
  c.stroke();
  if (f.lip) { c.fillStyle = f.lip; c.beginPath(); c.moveTo(x - 20, y); c.quadraticCurveTo(x - 6, y - 8, x, y - 4); c.quadraticCurveTo(x + 6, y - 8, x + 20, y); c.quadraticCurveTo(x, y + 13, x - 20, y); c.fill(); }
}

/** Paints the face: colour + emissive canvases; variants for blink and talk. */
export function paintFace(f: FaceLook) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const render = (closed: boolean, open: boolean) => {
    const col = mk(), glow = mk();
    const c = col.getContext('2d')!, e = glow.getContext('2d')!;
    c.fillStyle = hex(f.skin); c.fillRect(0, 0, S, S);
    e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
    // soft modelling: cheeks, nose, under-lip
    const blot = (x: number, y: number, r: number, a: number, colr = f.shade) => {
      const g = c.createRadialGradient(fx(x), fy(y), 0, fx(x), fy(y), r);
      const q = new THREE.Color(colr);
      g.addColorStop(0, `rgba(${q.r * 255 | 0},${q.g * 255 | 0},${q.b * 255 | 0},${a})`); g.addColorStop(1, `rgba(${q.r * 255 | 0},${q.g * 255 | 0},${q.b * 255 | 0},0)`);
      c.fillStyle = g; c.fillRect(0, 0, S, S);
    };
    blot(-0.5, -0.2, 70, 0.34); blot(0.5, -0.2, 70, 0.34);
    blot(0, -0.72, 40, 0.18); blot(-0.42, 0.14, 62, 0.2); blot(0.42, 0.14, 62, 0.2);
    // nose: a small shadow and tip light, anime-simple
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(fx(0.04), fy(-0.2)); c.quadraticCurveTo(fx(0.08), fy(-0.3), fx(-0.03), fy(-0.33)); c.stroke();
    paintBrow(c, f, -1); paintBrow(c, f, 1);
    paintEye(c, e, f, -1, closed); paintEye(c, e, f, 1, closed);
    paintMouth(c, f, open);
    f.marks?.(c, e);
    return { col, glow };
  };
  const tex = (cv: HTMLCanvasElement, srgb = true) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const open = render(false, false), blink = render(true, false), talk = render(false, true);
  return { open: tex(open.col), blink: tex(blink.col), talk: tex(talk.col), glowMap: tex(open.glow), glowBlink: tex(blink.glow) };
}

/** Anime-proportioned head: small chin, soft cheeks, UVs projected from the front. */
export function headGeometry(detail = 1): THREE.BufferGeometry {
  const seg = detail < 0.8 ? 22 : 36;
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.8));
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const low = Math.max(0, -y);
    // narrow jaw into a soft point
    const jaw = 1 - 0.27 * Math.pow(low, 1.5);
    x *= jaw; z *= 1 - 0.2 * Math.pow(low, 1.5);
    if (y < 0) y *= 1 + 0.12 * Math.pow(low, 2);
    if (y < -0.5) z += 0.11 * (low - 0.5);
    // tiny nose ridge + brow, soft eye sockets
    if (z > 0) {
      const nose = Math.exp(-((x * x) / 0.012 + ((y + 0.26) * (y + 0.26)) / 0.04));
      z += 0.075 * nose;
      for (const s of [-0.42, 0.42]) z -= 0.04 * Math.exp(-(((x - s) * (x - s)) / 0.045 + (y * y) / 0.03));
    }
    p.setXYZ(i, x, y, z);
    if (z > -0.15) uv.setXY(i, (x / 2.3 + 0.5), (y / 2.3 + 0.5));
    else uv.setXY(i, 0.012, 0.012);
  }
  g.computeVertexNormals();
  return g;
}
