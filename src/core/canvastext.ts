/**
 * Words painted into textures (shop signs, neon, posters, boards) stay on their sign. Inside `fitCanvasText`,
 * every fillText/strokeText is measured where it will land on the canvas (any transform included); text that
 * would run past the canvas edge is drawn smaller about its own anchor until it fits, down to 40 % of its size,
 * and squeezed sideways only after that. Canvases drawn outside it (the scrolling message tower) are untouched.
 */
const MARGIN = 0.035; // of the canvas side kept clear at each edge
let depth = 0;
let installed = false;
/** Counts for the text-fit test: texts drawn, ones that had to shrink, ones still too long at the smallest size. */
export const canvasFitStats = { drawn: 0, shrunk: 0, squeezed: 0, off: false };
/** Canvases that hold words (drawn on them, or copied in from one that does): the sign-orientation test reads these. */
const worded = new WeakSet<object>();
export const hasWords = (c: unknown) => !!c && typeof c === 'object' && worded.has(c as object);

type Draw = (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) => void;

function boxFits(g: CanvasRenderingContext2D, text: string, x: number, y: number, k: number, w0: number) {
  const W = g.canvas.width, H = g.canvas.height, mx = W * MARGIN, my = H * MARGIN * 0.5;
  const w = w0 * k;
  const m = g.measureText(text);
  const asc = (m.actualBoundingBoxAscent || 0) * k, desc = (m.actualBoundingBoxDescent || 0) * k;
  const al = g.textAlign, rtl = g.direction === 'rtl';
  const left = al === 'center' ? x - w / 2 : al === 'right' || (al === 'start' && rtl) || (al === 'end' && !rtl) ? x - w : x;
  const t = g.getTransform();
  const pts = [[left, y - asc], [left + w, y - asc], [left, y + desc], [left + w, y + desc]];
  for (const [px, py] of pts) {
    const cx = t.a * px + t.c * py + t.e, cy = t.b * px + t.d * py + t.f;
    if (cx < mx - 0.5 || cx > W - mx + 0.5 || cy < my - 0.5 || cy > H - my + 0.5) return false;
  }
  return true;
}

function wrap(orig: Draw): Draw {
  return function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    if (text) worded.add(this.canvas);
    if (depth === 0 || canvasFitStats.off || !text) { orig.call(this, text, x, y, maxWidth as number); return; }
    canvasFitStats.drawn++;
    const w0 = Math.min(this.measureText(text).width, maxWidth ?? Infinity);
    if (boxFits(this, text, x, y, 1, w0)) { orig.call(this, text, x, y, maxWidth as number); return; }
    const font = this.font, m = /(\d+(?:\.\d+)?)px/.exec(font);
    if (!m) { orig.call(this, text, x, y, maxWidth as number); return; }
    const px = parseFloat(m[1]);
    let lo = 0.4, hi = 1;
    const at = (k: number) => { this.font = font.replace(m[0], `${(px * k).toFixed(1)}px`); return boxFits(this, text, x, y, 1, Math.min(this.measureText(text).width, maxWidth ?? Infinity)); };
    if (at(lo)) {
      for (let i = 0; i < 7; i++) { const k = (lo + hi) / 2; if (at(k)) lo = k; else hi = k; }
      at(lo);
      canvasFitStats.shrunk++;
      orig.call(this, text, x, y, maxWidth as number);
    } else {
      // still too long at 40 %: squeeze it into what the canvas has across
      canvasFitStats.squeezed++;
      const W = this.canvas.width, al = this.textAlign, t = this.getTransform(), sx = Math.hypot(t.a, t.b) || 1;
      const room = (al === 'center' ? 2 * Math.min(x * sx + t.e, W - (x * sx + t.e)) : W * (1 - 2 * MARGIN)) / sx;
      orig.call(this, text, x, y, Math.max(8, Math.min(room * (1 - 2 * MARGIN), maxWidth ?? Infinity)));
    }
    this.font = font;
  };
}

function install() {
  if (installed || typeof CanvasRenderingContext2D === 'undefined') return;
  installed = true;
  const P = CanvasRenderingContext2D.prototype;
  P.fillText = wrap(P.fillText as Draw) as typeof P.fillText;
  P.strokeText = wrap(P.strokeText as Draw) as typeof P.strokeText;
  // a canvas copied into another (the stacked sign atlases, the halved phone canvases) carries its words with it
  const di = P.drawImage as (this: CanvasRenderingContext2D, ...a: unknown[]) => void;
  P.drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) { if (worded.has(a[0] as object)) worded.add(this.canvas); return di.apply(this, a); } as typeof P.drawImage;
}

/** Run a texture's drawing with every text kept on the canvas. */
export function fitCanvasText<T>(g: CanvasRenderingContext2D, draw: (g: CanvasRenderingContext2D) => T): T {
  install();
  depth++;
  try { return draw(g); } finally { depth--; }
}

// marking starts with the page, so every canvas with words is known (the sign test reads them), not only those drawn
// after the first fitCanvasText
install();
