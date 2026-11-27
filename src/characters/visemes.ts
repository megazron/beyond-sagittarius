/**
 * The narrator's mouth: fifteen mouth shapes (visemes), each a mix of single muscle units built into his face
 * (tools/chars/config.py FACE_UNITS), read from a per-line track of what he is saying when (tools/tts/visemes.py).
 * Only he has them: the crew's mouths follow the loudness bands of lipsync.json.
 */
/** The units a shape is mixed from: the jaw (the 'open' morph and the jaw bone), then his lip units. */
export const VIS_UNITS = ['open', 'v_part', 'v_purse', 'v_prot', 'v_retr', 'v_comp', 'v_elev', 'v_ever', 'v_upret'] as const;
//                jaw   part  purse prot  retr  comp  elev  ever  upret
const SHAPES: Record<string, number[]> = {
  _: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  P: [0, 0, 0, 0, 0, 0.8, 0, 0, 0],                // p b m: lips pressed shut
  F: [0.04, 0.12, 0, 0, 0.1, 0, 0.75, 0, 0.4],     // f v: lower lip up under the upper teeth
  T: [0.14, 0.55, 0, 0, 0.1, 0, 0, 0, 0.1],        // th
  D: [0.1, 0.55, 0, 0, 0.12, 0, 0, 0, 0.05],       // t d
  K: [0.2, 0.45, 0, 0, 0.05, 0, 0, 0, 0],          // k g ng
  C: [0.08, 0.5, 0.25, 0.6, 0, 0, 0, 0.45, 0],     // ch j sh: lips forward and flared
  S: [0.03, 0.55, 0, 0, 0.42, 0, 0, 0, 0.12],      // s z: teeth together, corners back
  N: [0.12, 0.42, 0, 0, 0.05, 0, 0, 0, 0],         // n l
  R: [0.1, 0.4, 0.4, 0.28, 0, 0, 0, 0.1, 0],       // r
  A: [0.62, 0.35, 0, 0, 0.05, 0, 0, 0, 0.05],      // ah
  E: [0.34, 0.4, 0, 0, 0.25, 0, 0, 0, 0.05],       // eh, the neutral vowel
  I: [0.15, 0.5, 0, 0, 0.6, 0, 0, 0, 0.12],        // ee
  O: [0.42, 0.3, 0.5, 0.3, 0, 0, 0, 0.1, 0],       // oh
  U: [0.14, 0.25, 0.85, 0.55, 0, 0, 0, 0.15, 0],   // oo, w
};
export interface VisTrack { t: Float32Array; v: string; peak: Float32Array }
const cache = new Map<string, VisTrack>();
/** "cs:v,cs:v,..." -> times (s), letters, and the moment each shape is fully made (a little into its span). */
export function parseVis(s: string): VisTrack {
  let tr = cache.get(s);
  if (tr) return tr;
  const parts = s.split(',').filter(Boolean), n = parts.length;
  const t = new Float32Array(n), peak = new Float32Array(n); let v = '';
  parts.forEach((p, i) => { const k = p.indexOf(':'); t[i] = +p.slice(0, k) / 100; v += p[k + 1] ?? '_'; });
  for (let i = 0; i < n; i++) {
    const end = i + 1 < n ? t[i + 1] : t[i], c = v[i];
    // a closure (p, b, m, f, v) is made at once and held; a vowel is reached a third of the way in; the rest is made at its start
    peak[i] = c === '_' ? t[i] + Math.min(0.09, (end - t[i]) * 0.5) : t[i] + (end - t[i]) * (c === 'P' || c === 'F' ? 0.2 : 0.38);
  }
  tr = { t, v, peak }; cache.set(s, tr);
  return tr;
}
/** The unit weights at second `at` of the line (the mouth leads the sound by a few hundredths). */
export function mouthAt(tr: VisTrack, at: number, out: number[]) {
  const n = tr.t.length, t = at + 0.045;
  for (let u = 0; u < VIS_UNITS.length; u++) out[u] = 0;
  if (!n || t <= tr.peak[0] - 0.12 || t >= tr.peak[n - 1]) return out;
  let k = 0;
  while (k + 1 < n && tr.peak[k + 1] <= t) k++;
  const a = t < tr.peak[0] ? SHAPES._ : SHAPES[tr.v[k]] ?? SHAPES._, b = t < tr.peak[0] ? SHAPES[tr.v[0]] ?? SHAPES._ : SHAPES[tr.v[Math.min(n - 1, k + 1)]] ?? SHAPES._;
  const t0 = t < tr.peak[0] ? tr.peak[0] - 0.12 : tr.peak[k], t1 = t < tr.peak[0] ? tr.peak[0] : tr.peak[Math.min(n - 1, k + 1)];
  let x = t1 > t0 ? (t - t0) / (t1 - t0) : 1; x = x * x * (3 - 2 * x);
  for (let u = 0; u < VIS_UNITS.length; u++) out[u] = a[u] + (b[u] - a[u]) * x;
  return out;
}
