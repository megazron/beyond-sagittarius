import * as THREE from 'three';
import { cycleAtlas, cycleMaterial, stamp } from '../../core/cycle';
import { fitCanvasText } from '../../core/canvastext';
import { nearFade } from '../../core/nearfade';

/**
 * Street-level density for Zenvora: neon on every facade from the pavement to the roofline (Kabukicho density,
 * desi storytelling), big screens, impostor crowds filling the far street in both directions, and the neon's
 * reflection smeared on the wet road. Every sign design is one InstancedMesh; the crowd is one InstancedMesh of
 * camera-facing cards; reflections are one more. Phones get about a third of everything.
 */

export interface Facade { side: number; z0: number; z1: number; h: number }
/** k: who it is (an index of the caller's); v: which baked look it wears (k if not given). */
export interface StandIn { x: number; y: number; z: number; h: number; k: number; v?: number; yaw?: number; walk?: boolean }
export interface DenseOpts { /** Where what is seen from the whole city goes (the stand-in cards). */ top?: THREE.Object3D; rich: boolean; FRONT: number; S: number; N: number; facades: Facade[] }

/**
 * Where across the pavement someone walking along z should be to pass whoever is just ahead: the x nearest `pref` in
 * [lo, hi] that is `r` metres clear of every obstacle from 0.5 m behind to 2.4 m ahead ([x, z, x, z, ...], `self` = index
 * of their own pair to skip). `blocked`: nowhere is clear and someone is right ahead (within 1 m): they wait.
 */
export function laneX(x: number, z: number, dir: number, lo: number, hi: number, ob: ArrayLike<number>, r: number, pref: number, self = -1) {
  const near: number[] = [];
  let ahead = false;
  for (let k = 0; k + 1 < ob.length; k += 2) {
    if (k / 2 === self) continue;
    const a = (ob[k + 1] - z) * dir;
    if (a > -0.5 && a < 2.4 && ob[k] > lo - r && ob[k] < hi + r) { near.push(ob[k]); if (a > 0 && a < 1.0 && Math.abs(ob[k] - x) < r) ahead = true; }
  }
  if (!near.length) return { tx: Math.min(hi, Math.max(lo, pref)), blocked: false };
  let best = NaN, cost = 1e9;
  for (let t = lo; t <= hi + 1e-6; t += 0.1) {
    let ok = true; for (const o of near) if (Math.abs(o - t) < r) { ok = false; break; }
    if (!ok) continue;
    const c = Math.abs(t - pref) + 0.5 * Math.abs(t - x);
    if (c < cost) { cost = c; best = t; }
  }
  return Number.isNaN(best) ? { tx: x, blocked: ahead } : { tx: best, blocked: false };
}

let seed = 4242;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; fitCanvasText(c.getContext('2d')!, draw);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** The sign set: parody brands, bazaar trades, and Hindi and Urdu shop signs. */
const SIGNS: [string, string, string][] = [
  ['LAMAZON', '#ff9900', '#1a1206'], ['CAPPLE', '#bfe9ff', '#0b1420'], ['CHAI COSMOS', '#ffcf7a', '#2a1006'], ['SNAPGRAM', '#ff5d8f', '#1e0612'],
  ['RISHTA.AI', '#7fd8ff', '#06121e'], ['BIRYANI', '#7cff9a', '#061a0c'], ['MEHNDI', '#ff6ec7', '#1e0616'], ['JALEBI', '#ffb36e', '#1e0e04'],
  ['PAAN', '#b6ff6e', '#0e1a04'], ['HOVER FIX', '#6ef7ff', '#041618'], ['GOLD', '#ffe36e', '#1a1404'], ['SIM CARDS', '#9fd8ff', '#06101a'],
  ['NEURO SPA', '#c79fff', '#12061e'], ['TAILOR', '#ff9f6e', '#1a0a04'], ['KARAOKE', '#ff6e9f', '#1a0410'], ['24 HRS', '#ffffff', '#101010'],
  ['चाय', '#ffcf7a', '#2a1006'], ['मिठाई', '#ff6ec7', '#1e0616'], ['दवाई', '#5fffd0', '#04161a'], ['होटल', '#ffd36e', '#1a1204'], ['सिनेमा', '#7fd8ff', '#06121e'],
  ['چائے', '#ffb347', '#1e0e04'], ['مٹھائی', '#ff8fd0', '#1e0616'], ['کباب', '#ff6e6e', '#1e0606'], ['دوا خانہ', '#6effc0', '#041a10'], ['ہوٹل', '#9fd8ff', '#06101a'],
  ['ROBO REPAIR', '#6ef7ff', '#041618'], ['QUANTUM LASSI', '#ffd36e', '#1a1204'], ['ORBIT TRAVELS', '#bfe9ff', '#0b1420'], ['DESI DRONES', '#b6ff6e', '#0e1a04'],
];

const blade = (txt: string, fg: string, bg: string) => canvasTex(128, 512, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, 128, 512);
  g.strokeStyle = fg; g.lineWidth = 6; g.shadowColor = fg; g.shadowBlur = 16; g.strokeRect(8, 8, 112, 496);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const latin = /^[\x20-\x7e]+$/.test(txt);
  if (latin) { const chars = txt.replace(/ /g, '').split(''); const step = Math.min(78, 470 / chars.length); g.font = `700 ${Math.min(72, step * 0.95)}px Rajdhani, sans-serif`; chars.forEach((ch, i) => g.fillText(ch, 64, 40 + step / 2 + i * step)); }
  else { g.save(); g.translate(64, 256); g.rotate(Math.PI / 2); g.font = '700 64px "Noto Sans Devanagari", "Noto Nastaliq Urdu", "Noto Naskh Arabic", sans-serif'; g.fillText(txt, 0, 0); g.restore(); }
});

export function buildDense(scene: THREE.Scene, o: DenseOpts) {
  seed = 4242;
  const { rich, FRONT, S, N } = o;
  const updates: ((dt: number, t: number, cam: THREE.Camera | null) => void)[] = [];
  /** The painted crowd: where each card is and which way it walks; `taken` cards are hidden (a real body walks them). */
  // the street's walkers turn back 12 m into the gate's plaza (at 4 m they all ended in the plaza's throng: a knot of
  // cards walking through each other and through the groups there, most of the detector's overlaps)
  const S0 = S + 12;
  let cards: { x: number; z: number; v: number; gate: boolean; who: number; lane: number; wait?: boolean; waitT?: number; holdT?: number }[] = [], taken = new Uint8Array(0);
  /** Stand-ins: a card where a far body is not drawn (city.ts fills it each frame). */
  let standIns: (list: StandIn[], cam: THREE.Camera | null) => void = () => undefined;
  /** Where people stand or walk in the street this frame, [x, z, x, z, ...]: the cards walk round them. */
  let obstacles: number[] = [];
  const all: number[] = [], mirrored: number[] = [];
  /** The pairs seen from one side of the street walking one way: x times the side, z times the way (laneX works in +x, +z). */
  const mirror = (a: number[], sx: number, sz: number) => { mirrored.length = a.length; for (let k = 0; k < a.length; k += 2) { mirrored[k] = a[k] * sx; mirrored[k + 1] = a[k + 1] * sz; } return mirrored; };
  /** Baked impostors (impostor.ts) take over from the painted figures when they are ready. */
  let imp: { cols: number; rows: number; variants: number; views: number } | null = null;
  const grid = { value: new THREE.Vector2(1 / 8, 1) };
  /** Where far cards stop being drawn: they thin out (dithered) over the last sixth instead of blinking out. */
  const cardFar = { value: 1e5 };
  let setAtlas: (t: THREE.Texture, cols: number, rows: number, variants: number, views: number) => void = () => undefined, setLight: (c: THREE.Color) => void = () => undefined;
  const add = <T extends THREE.Object3D>(x: T) => { x.userData.ground = false; scene.add(x); return x; };

  // ---- vertical neon blades on every facade, stacked from the pavement to the roofline ----
  const slots: { k: number; m: THREE.Matrix4; side: number; x: number; z: number; y: number; col: THREE.Color }[] = [];
  for (const f of o.facades) for (let z = f.z1 + 1.2; z < f.z0 - 1; z += rich ? 2.1 : 4.2) {
    if (rnd() < 0.1) continue;
    // from just above the follow camera's height: a blade at 2.1 m stuck out over the pavement where the camera passes
    for (let y = 2.9; y < f.h - 0.4; y += 2.6 + rnd() * 1.1) {
      if (rnd() < 0.15) continue;
      const k = Math.floor(rnd() * SIGNS.length), x = f.side * (FRONT - 0.75 - rnd() * 0.25);
      const hgt = 2.2 + rnd() * 1.6;
      slots.push({ k, side: f.side, x, z, y: y + hgt / 2, col: new THREE.Color(SIGNS[k][1]), m: new THREE.Matrix4().compose(new THREE.Vector3(x, y + hgt / 2, z), new THREE.Quaternion(), new THREE.Vector3(0.75, hgt, 1)) });
    }
  }
  // every design on one atlas (16 x 2 tiles of 128 x 512): all the blades are one draw, each picks its tile
  const COLS = 16, ROWS = Math.ceil(SIGNS.length / COLS);
  const atlas = canvasTex(128 * COLS, 512 * ROWS, (g) => SIGNS.forEach((sg, k) => g.drawImage(blade(...sg).image as HTMLCanvasElement, (k % COLS) * 128, Math.floor(k / COLS) * 512)));
  const plane = new THREE.PlaneGeometry(1, 1);
  const tile = new Float32Array(slots.length * 2);
  // the canvas is flipped on upload: its top row of tiles is the top of the texture
  slots.forEach((s, i) => { tile[i * 2] = (s.k % COLS) / COLS; tile[i * 2 + 1] = 1 - (Math.floor(s.k / COLS) + 1) / ROWS; });
  const geo = plane.clone(); geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 2));
  const bm = new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(2.1, 2.1, 2.1), toneMapped: false, side: THREE.DoubleSide });
  bm.onBeforeCompile = (sh) => {
    sh.vertexShader = `attribute vec2 aTile;\n${sh.vertexShader}`.replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv = aTile + vMapUv * vec2(${1 / COLS}, ${1 / ROWS});`);
    nearFade(bm, sh); // a blade passing the lens dissolves, as before
  };
  bm.customProgramCacheKey = () => 'sign-atlas|nearfade';
  const blades = new THREE.InstancedMesh(geo, bm, Math.max(1, slots.length));
  slots.forEach((s, i) => blades.setMatrixAt(i, s.m)); blades.count = slots.length; add(blades);

  // ---- big screens on the upper floors: ads that change, the brightest things in the street ----
  const ADS: [string, string, string][] = [
    ['LAMAZON ORBIT', 'Same day to Saturn', '#ff9900'], ['CAPPLE VISION 9', 'See more. Blink less.', '#bfe9ff'], ['CHAI COSMOS', 'Now on Europa', '#ffcf7a'],
    ['SNAPGRAM', 'Post it before it happens', '#ff5d8f'], ['RISHTA.AI', 'Your aunty, but faster', '#7fd8ff'], ['चाय पियो', 'चाय कॉसमॉस', '#ffcf7a'], ['چائے پیو', 'چائے کاسموس', '#ffb347'],
  ];
  const draw = (c: HTMLCanvasElement, k: number) => {
    const g = c.getContext('2d')!, [a, b, col] = ADS[k % ADS.length];
    const gr = g.createLinearGradient(0, 0, 512, 288); gr.addColorStop(0, '#120a24'); gr.addColorStop(1, '#2a0f3a'); g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 26; g.textAlign = 'center'; g.font = '700 58px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif'; g.fillText(a, 256, 130);
    g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.font = '500 32px Rajdhani, "Noto Sans Devanagari", "Noto Nastaliq Urdu", sans-serif'; g.fillText(b, 256, 196);
  };
  // every ad painted once into one atlas, each screen stepping through it in the shader (core/cycle.ts): they were a
  // canvas, a texture upload every 3.5 s and a material each, a dozen at the gate
  const adAt = cycleAtlas(ADS.length, 512, 288, (g, k) => draw(g.canvas, k));
  const adM = cycleMaterial(adAt, { color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false });
  const big = o.facades.filter((f) => f.h > 8 && f.z0 - f.z1 > 9);
  for (let i = 0; i < big.length; i += rich ? 2 : 5) {
    const f = big[i], w = Math.min(8, f.z0 - f.z1 - 3);
    const scr = add(new THREE.Mesh(stamp(new THREE.PlaneGeometry(w, w * 0.56), { aCycle: [i % ADS.length, 3.5] }), adM));
    scr.position.set(f.side * (FRONT - 0.12), f.h - w * 0.4, (f.z0 + f.z1) / 2); scr.rotation.y = f.side > 0 ? -Math.PI / 2 : Math.PI / 2;
  }

  // ---- the neon's reflection on the wet road and paving: long soft streaks under every sign ----
  {
    const streak = canvasTex(32, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(6, 0, 20, 256); });
    const use = slots.filter((_, i) => i % (rich ? 2 : 4) === 0);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: streak, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), use.length);
    use.forEach((s, i) => {
      const len = 3 + rnd() * 4; // a streak reaching from the wall foot out across the pavement and into the road
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.side * (FRONT - 0.6 - len / 2), 0.16, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, s.side > 0 ? -Math.PI / 2 : Math.PI / 2)), new THREE.Vector3(0.55, len, 1)));
      im.setColorAt(i, s.col.clone().multiplyScalar(0.9));
    });
    add(im);
  }

  // ---- impostor crowds: camera-facing cards of people, walking both ways, filling the far street ----
  {
    const sheet = canvasTex(512, 128, (g) => { // eight figures: saris, kurtas, suits, kids, a vendor with a tray
      const cols = [['#c0392b', '#f1c40f'], ['#2c3e94', '#ecf0f1'], ['#16a085', '#f39c12'], ['#8e44ad', '#ffe0f0'], ['#2c2c2c', '#9fd8ff'], ['#d35400', '#ffffff'], ['#27ae60', '#f5e6c8'], ['#34495e', '#ff6ec7']];
      for (let i = 0; i < 8; i++) {
        const x = i * 64 + 32, kid = i === 5, s = kid ? 0.7 : 1, [a, b] = cols[i], Y = (v: number) => 128 - v * s;
        // legs, slightly apart and tapering, then the body with round shoulders, arms, neck and head
        g.fillStyle = '#1e1e26';
        g.beginPath(); g.moveTo(x - 9 * s, Y(42)); g.lineTo(x - 1 * s, Y(42)); g.lineTo(x - 3 * s, Y(1)); g.lineTo(x - 8 * s, Y(1)); g.fill();
        g.beginPath(); g.moveTo(x + 1 * s, Y(42)); g.lineTo(x + 9 * s, Y(42)); g.lineTo(x + 8 * s, Y(1)); g.lineTo(x + 3 * s, Y(1)); g.fill();
        g.fillStyle = a; g.beginPath();
        g.moveTo(x - 7 * s, Y(99)); g.quadraticCurveTo(x - 15 * s, Y(98), x - 14 * s, Y(88));
        g.lineTo(x - (i % 2 ? 17 : 11) * s, Y(38)); g.lineTo(x + (i % 2 ? 17 : 11) * s, Y(38));
        g.lineTo(x + 14 * s, Y(88)); g.quadraticCurveTo(x + 15 * s, Y(98), x + 7 * s, Y(99)); g.fill();
        g.lineCap = 'round'; g.strokeStyle = a; g.lineWidth = 5 * s;
        g.beginPath(); g.moveTo(x - 14 * s, Y(90)); g.lineTo(x - 17 * s, Y(60)); g.moveTo(x + 14 * s, Y(90)); g.lineTo(x + 16 * s, Y(62)); g.stroke();
        g.fillStyle = b; g.beginPath(); g.moveTo(x - 10 * s, Y(94)); g.lineTo(x - 5 * s, Y(94)); g.lineTo(x - 2 * s, Y(56)); g.lineTo(x - 8 * s, Y(56)); g.fill();
        g.fillStyle = '#6b4632'; g.fillRect(x - 3 * s, Y(104), 6 * s, 7 * s);
        g.beginPath(); g.ellipse(x, Y(110), 7.5 * s, 9 * s, 0, 0, 7); g.fill();
        g.fillStyle = i === 3 ? a : '#17110e'; g.beginPath(); g.ellipse(x, Y(114), 8 * s, 6 * s, 0, Math.PI, 0); g.fill(); // hair (a dupatta on one)
        if (i === 6) { g.fillStyle = '#c8a46a'; g.fillRect(x - 18, 128 - 124, 36, 6); }
      }
      // a soft edge, so a card never shows a cut-out outline
      const c2 = document.createElement('canvas'); c2.width = 512; c2.height = 128; const g2 = c2.getContext('2d')!;
      g2.filter = 'blur(1.2px)'; g2.drawImage(g.canvas, 0, 0); g.clearRect(0, 0, 512, 128); g.drawImage(c2, 0, 0);
    });
    const mat = new THREE.MeshBasicMaterial({ map: sheet, transparent: true, alphaTest: 0.22, color: new THREE.Color(0.55, 0.52, 0.6) });
    // a busy street, not a packed one (the owner: "too many people, too crowded"); halved again with the pedestrian
    // fixes: near the camera every one of them is a body now, and the bodies have to cover them all
    // (thinned again, p29: with 64 on Web and 22 on phones more of them came into the view within 27 m than there were
    // bodies, and the rest stayed flat cards up to you: the detector's cardClose, most of them these cards)
    const n = rich ? 36 : 12, gateN = rich ? 4 : 2;
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
    const offs = new Float32Array(n + gateN); for (let i = 0; i < n + gateN; i++) offs[i] = Math.floor(rnd() * 8) / 8; // every card its own figure, gate crowd included
    const tiles = new Float32Array((n + gateN) * 2); for (let i = 0; i < n + gateN; i++) tiles[i * 2] = offs[i];
    const tileA = new THREE.InstancedBufferAttribute(tiles, 2); tileA.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', tileA);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGrid = grid; sh.uniforms.uFar = cardFar;
      sh.vertexShader = 'attribute vec2 aTile;\nuniform vec2 uGrid;\nvarying float vH;\nvarying float vD;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = aTile + uv * uGrid; vH = uv.y;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  { vec3 wc = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vD = length(wc.xz - cameraPosition.xz); }');
      // darker towards the feet, as a lit street shades people from below; thinning out towards the far limit
      sh.fragmentShader = 'uniform float uFar;\nvarying float vH;\nvarying float vD;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.0, 0.6, vH);\n  if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > smoothstep(uFar, uFar * 0.83, vD)) discard;');
    };
    const im = new THREE.InstancedMesh(geo, mat, n + gateN);
    taken = new Uint8Array(n + gateN);
    const ppl = Array.from({ length: n }, (_, i) => {
      const side = i % 2 ? 1 : -1, x = side * (4.7 + rnd() * 3.8);
      return { x, z: S0 + rnd() * (N - 10 - S0), v: (rnd() < 0.5 ? 1 : -1) * (0.8 + rnd() * 0.7), h: (offs[i] === 5 / 8 ? 1.1 : 1.55) + rnd() * 0.3, wd: 0.37 + rnd() * 0.1, p: rnd() * 6, gate: false, who: i, lane: x, wait: false, waitT: 0, holdT: 0 };
    });
    // travellers thronging the gate plaza: across the whole width, milling slowly, life-size
    cards = ppl;
    for (let i = 0, tries = 0; i < gateN && tries < 400; tries++) { const gx = (rnd() < 0.5 ? -1 : 1) * (4.8 + rnd() * 3.6), gz = S + 2 + rnd() * 18; if (ppl.some((o) => o.gate && Math.hypot(o.x - gx, o.z - gz) < 1.6)) continue; ppl.push({ x: gx /* on the pavements, a step apart: the road through the gate is for the cars */, z: gz, v: (rnd() - 0.5) * 0.5, h: (offs[n + i] === 5 / 8 ? 1.1 : 1.55) + rnd() * 0.3, wd: 0.37 + rnd() * 0.1, p: rnd() * 6, gate: true, who: n + i, lane: gx, wait: false, waitT: 0, holdT: 0 }); i++; }
    // each card its own shade: a little warmer or cooler, lighter or darker, so no two neighbours match
    const TC = new THREE.Color();
    for (let i = 0; i < n + gateN; i++) { const k = 0.78 + rnd() * 0.42; im.setColorAt(i, TC.setRGB(k * (0.94 + rnd() * 0.12), k * (0.94 + rnd() * 0.1), k * (0.94 + rnd() * 0.12))); }
    add(im);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), E = new THREE.Euler();
    let time = 0;
    /** The atlas tile for a card: which body, seen from which side (rel: the camera's bearing from the way they face), which walk frame (phase < 0: standing). */
    const tileOf = (arr: Float32Array, i: number, who: number, rel: number, phase: number) => {
      const A = imp!, NV = A.views, view = ((Math.round(rel / (Math.PI * 2 / NV)) % NV) + NV) % NV, v = ((who % A.variants) + A.variants) % A.variants;
      // the atlas may hold the looks in bands (impostor.ts): VPR looks a band, F frames a band
      const VPR = A.cols / NV, F = A.rows / Math.ceil(A.variants / VPR);
      const frame = phase < 0 ? F - 1 : Math.floor(phase % 1 * (F - 1) + (F - 1)) % (F - 1);
      arr[i * 2] = ((v % VPR) * NV + view) / A.cols; arr[i * 2 + 1] = (Math.floor(v / VPR) * F + frame) / A.rows;
    };
    const baseCol = new THREE.Color(0.55, 0.52, 0.6);
    setAtlas = (t, cols, rows, variants, views) => { imp = { cols, rows, variants, views }; mat.map = t; mat.alphaTest = 0.5; mat.needsUpdate = true; grid.value.set(1 / cols, 1 / rows); baseCol.setRGB(1, 1, 1); };
    setLight = (c) => { mat.color.copy(baseCol).multiply(c); };
    // far townsfolk: past a few dozen metres a body (a dozen draw calls, tens of thousands of triangles) is swapped for
    // a card of the same height, so the street stays full and nobody blinks out
    {
      const CAP = 640, g2 = geo.clone(), o2 = new Float32Array(CAP * 2);
      for (let i = 0; i < CAP; i++) o2[i * 2] = Math.floor(rnd() * 8) / 8;
      const t2 = new THREE.InstancedBufferAttribute(o2, 2); t2.setUsage(THREE.DynamicDrawUsage);
      g2.setAttribute('aTile', t2);
      const si = new THREE.InstancedMesh(g2, mat, CAP); si.count = 0; si.frustumCulled = false;
      for (let i = 0; i < CAP; i++) si.setColorAt(i, new THREE.Color(0.9, 0.88, 0.92));
      si.userData.ground = false; si.matrixAutoUpdate = false; (o.top ?? scene).add(si);
      const M2 = new THREE.Matrix4(), Q2 = new THREE.Quaternion(), P2 = new THREE.Vector3(), S2 = new THREE.Vector3(), E2 = new THREE.Euler();
      standIns = (list, cam) => {
        time = performance.now() / 1000;
        const cp = cam?.position; let n = 0;
        for (const q of list) {
          if (n >= CAP) break;
          const a = cp ? Math.atan2(cp.x - q.x, cp.z - q.z) : 0;
          E2.set(0, a, 0); Q2.setFromEuler(E2);
          const k = q.h / 1.72;
          P2.set(q.x, q.y, q.z); if (imp) S2.set(1.1 * k, 2.0 * k, 1); else S2.set(q.h * 0.42, q.h, 1);
          if (imp) tileOf(o2, n, q.v ?? q.k, a - (q.yaw ?? 0), q.walk ? time * 1.7 + q.k : -1);
          si.setMatrixAt(n++, M2.compose(P2, Q2, S2));
        }
        si.count = n; si.instanceMatrix.needsUpdate = true; if (imp) t2.needsUpdate = true;
      };
    }
    updates.push((dt, t, cam) => {
      const cp = cam?.position;
      // they keep a step apart and out of the way of whoever stands or walks in the street (obstacles, from city.ts):
      // someone within 0.8 m across and up to 2.2 m ahead is passed by easing aside, at most 0.6 m/s, on their own
      // pavement. Cards used to walk through each other and through the people standing in the street
      // (the nearest one ahead is passed on the side the card is on, or on the other side when that is off the pavement:
      // pushed apart towards the kerb, two used to end up pressed into each other at its edge)
      // the nearest clear line across the pavement (laneX), back to their own lane once past; nowhere clear and someone
      // right ahead, they wait
      const lo = 4.75, hi = FRONT - 0.7;
      all.length = 0; for (const q of ppl) all.push(q.x, q.z); for (let k = 0; k < obstacles.length; k++) all.push(obstacles[k]);
      for (let i = 0; i < ppl.length; i++) {
        const q = ppl[i], sv = q.v >= 0 ? 1 : -1, side = q.x >= 0 ? 1 : -1;
        const L = laneX(q.x * side, q.z * sv, 1, lo, hi, mirror(all, side, sv), 0.8, q.lane * side, i);
        q.wait = L.blocked; q.waitT = q.wait ? (q.waitT ?? 0) + dt : 0;
        if ((q.waitT ?? 0) > 3) { q.v = -q.v; q.waitT = 0; q.wait = false; } // still blocked after 3 s: they turn back
        q.x = side * Math.min(hi, Math.max(lo, q.x * side + Math.max(-0.45 * dt, Math.min(0.45 * dt, (L.tx - q.x * side) * 2 * dt))));
      }
      ppl.forEach((q, i) => {
        // a step that would take them within half a metre of someone ahead of them is not taken (they keep easing
        // aside meanwhile): the aside alone, at 0.45 m/s, was too slow for two meeting head on, and they walked through
        // each other (the detector's overlaps; most at the gate end of the street). Held for 3 s, they turn back
        if (!q.wait) {
          const nz = q.z + q.v * dt, sv = q.v >= 0 ? 1 : -1;
          let clash = false;
          for (let k = 0; k + 1 < all.length && !clash; k += 2) {
            if (k / 2 === i) continue;
            const ox = all[k], oz = all[k + 1];
            if (Math.abs(ox - q.x) < 0.5 && Math.abs(oz - nz) < 0.5 && (oz - q.z) * sv > 0) clash = true;
          }
          if (!clash) { q.z = nz; q.holdT = 0; }
          else if ((q.holdT = (q.holdT ?? 0) + dt) > 3) { q.v = -q.v; q.holdT = 0; }
        }
        // at the ends of their stretch they turn round (they used to jump to the other end: a walker blinking out at the
        // gate and in at the bazaar, in plain view)
        const z0 = q.gate ? S + 2 : S0, z1 = q.gate ? S + 20 : N - 10;
        if ((q.z > z1 && q.v > 0) || (q.z < z0 && q.v < 0)) q.v = -q.v;
        // near the camera a real body takes a card's place (city.ts: the crowd pool walks it); a card nobody took stays
        // drawn, so nobody vanishes as you walk up
        const vis = taken[i] ? 0 : 1;
        const bob = Math.abs(Math.sin(t * 6 * Math.abs(q.v) + q.p)) * 0.04;
        const a = cp ? Math.atan2(cp.x - q.x, cp.z - q.z) : 0;
        E.set(0, a, 0); Q.setFromEuler(E);
        if (imp) { const k = q.h / 1.72; P.set(q.x, 0.14, q.z); SC.set(1.1 * k * vis, 2.0 * k * vis, 1); tileOf(tiles, i, q.who, a - (q.v > 0 ? 0 : Math.PI), Math.abs(q.v) > 0.3 && !q.wait && !q.holdT ? t * Math.abs(q.v) * 1.3 + q.p : -1); }
        else { P.set(q.x, 0.14 + bob, q.z); SC.set(q.h * q.wd * vis, q.h * vis, 1); }
        im.setMatrixAt(i, M.compose(P, Q, SC));
      });
      im.instanceMatrix.needsUpdate = true; if (imp) tileA.needsUpdate = true;
    });
  }

  return { update: (dt: number, t: number, cam: THREE.Camera | null, on = true) => { if (on) for (const u of updates) u(dt, t, cam); }, get cards() { return cards; }, get taken() { return taken; },
    standIns: (list: StandIn[], cam: THREE.Camera | null) => standIns(list, cam), setObstacles: (o: number[]) => { obstacles = o; }, setFar: (m: number) => { cardFar.value = m; },
    setAtlas: (t: THREE.Texture, cols: number, rows: number, variants: number, views = 4) => setAtlas(t, cols, rows, variants, views), setLight: (c: THREE.Color) => setLight(c),
    /** Where card i walks to and fro (z from, to): the gate's plaza or the street. */
    stretch: (i: number): [number, number] => (cards[i].gate ? [S + 2, S + 20] : [S0, N - 10]),
    /** Test hook (tools/pedglitch.js): which look a crowd card and a stand-in card wear (-1: a painted figure, before the bake) and where cards stop. */
    cardLook: (i: number) => (imp ? ((cards[i].who % imp.variants) + imp.variants) % imp.variants : -1), standLook: (s: StandIn) => (imp ? (((s.v ?? s.k) % imp.variants) + imp.variants) % imp.variants : -1), get far() { return cardFar.value; } };
}
