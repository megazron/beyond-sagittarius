import * as THREE from 'three';

/**
 * Street-level density for Port Sahil: neon on every facade from the pavement to the roofline (Kabukicho density,
 * desi storytelling), big screens, impostor crowds filling the far street in both directions, and the neon's
 * reflection smeared on the wet road. Every sign design is one InstancedMesh; the crowd is one InstancedMesh of
 * camera-facing cards; reflections are one more. Phones get about a third of everything.
 */

export interface Facade { side: number; z0: number; z1: number; h: number }
export interface DenseOpts { rich: boolean; FRONT: number; S: number; N: number; facades: Facade[] }

let seed = 4242;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
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
  const add = <T extends THREE.Object3D>(x: T) => { x.userData.ground = false; scene.add(x); return x; };

  // ---- vertical neon blades on every facade, stacked from the pavement to the roofline ----
  const slots: { k: number; m: THREE.Matrix4; side: number; x: number; z: number; y: number; col: THREE.Color }[] = [];
  for (const f of o.facades) for (let z = f.z1 + 1.2; z < f.z0 - 1; z += rich ? 2.1 : 4.2) {
    if (rnd() < 0.1) continue;
    for (let y = 2.1; y < f.h - 1.2; y += 2.8 + rnd() * 1.2) {
      if (rnd() < 0.15) continue;
      const k = Math.floor(rnd() * SIGNS.length), x = f.side * (FRONT - 0.75 - rnd() * 0.25);
      const hgt = 2.2 + rnd() * 1.6;
      slots.push({ k, side: f.side, x, z, y: y + hgt / 2, col: new THREE.Color(SIGNS[k][1]), m: new THREE.Matrix4().compose(new THREE.Vector3(x, y + hgt / 2, z), new THREE.Quaternion(), new THREE.Vector3(0.75, hgt, 1)) });
    }
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  for (let k = 0; k < SIGNS.length; k++) {
    const mine = slots.filter((s) => s.k === k); if (!mine.length) continue;
    const tex = blade(...SIGNS[k]);
    const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.1, 2.1, 2.1), toneMapped: false, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(plane, m, mine.length); mine.forEach((s, i) => im.setMatrixAt(i, s.m)); add(im);
  }

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
  const screens: { c: HTMLCanvasElement; t: THREE.CanvasTexture; k: number }[] = [];
  const big = o.facades.filter((f) => f.h > 8 && f.z0 - f.z1 > 9);
  for (let i = 0; i < big.length; i += rich ? 2 : 5) {
    const f = big[i], c = document.createElement('canvas'); c.width = 512; c.height = 288; draw(c, i);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const w = Math.min(8, f.z0 - f.z1 - 3), scr = add(new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.56), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false })));
    scr.position.set(f.side * (FRONT - 0.12), f.h - w * 0.4, (f.z0 + f.z1) / 2); scr.rotation.y = f.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    screens.push({ c, t, k: i });
  }
  let adT = 0;
  updates.push((dt) => { adT += dt; if (adT > 3.5) { adT = 0; for (const s of screens) { s.k++; draw(s.c, s.k); s.t.needsUpdate = true; } } });

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
        const x = i * 64 + 32, kid = i === 5, s = kid ? 0.7 : 1, [a, b] = cols[i];
        g.fillStyle = '#4a3226'; g.beginPath(); g.arc(x, 128 - 108 * s, 9 * s, 0, 7); g.fill();
        g.fillStyle = a; g.beginPath(); g.moveTo(x - 13 * s, 128 - 96 * s); g.lineTo(x + 13 * s, 128 - 96 * s); g.lineTo(x + (i % 2 ? 16 : 11) * s, 128 - 40 * s); g.lineTo(x - (i % 2 ? 16 : 11) * s, 128 - 40 * s); g.fill();
        g.fillStyle = b; g.fillRect(x - 10 * s, 128 - 92 * s, 4 * s, 34 * s);
        g.fillStyle = '#1e1e26'; g.fillRect(x - 9 * s, 128 - 40 * s, 7 * s, 40 * s); g.fillRect(x + 2 * s, 128 - 40 * s, 7 * s, 40 * s);
        if (i === 6) { g.fillStyle = '#c8a46a'; g.fillRect(x - 18, 128 - 110, 36, 6); }
      }
    });
    const mat = new THREE.MeshBasicMaterial({ map: sheet, transparent: true, alphaTest: 0.4, color: new THREE.Color(0.55, 0.52, 0.6) });
    const n = rich ? 240 : 80, gateN = rich ? 140 : 45;
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
    const offs = new Float32Array(n + gateN); for (let i = 0; i < n + gateN; i++) offs[i] = Math.floor(rnd() * 8) / 8; // every card its own figure, gate crowd included
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 1));
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aOff;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = vec2(uv.x / 8.0 + aOff, uv.y);');
    };
    const im = new THREE.InstancedMesh(geo, mat, n + gateN);
    const ppl = Array.from({ length: n }, (_, i) => {
      const side = i % 2 ? 1 : -1, x = side * (4.7 + rnd() * 3.8);
      return { x, z: S + 4 + rnd() * (N - S - 14), v: (rnd() < 0.5 ? 1 : -1) * (0.8 + rnd() * 0.7), h: (offs[i] === 5 / 8 ? 1.15 : 1.65) + rnd() * 0.15, p: rnd() * 6, gate: false };
    });
    // travellers thronging the gate plaza: across the whole width, milling slowly, life-size
    for (let i = 0; i < gateN; i++) ppl.push({ x: (rnd() - 0.5) * 17, z: S + 2 + rnd() * 18, v: (rnd() - 0.5) * 0.5, h: 1.6 + rnd() * 0.25, p: rnd() * 6, gate: true });
    add(im);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), E = new THREE.Euler();
    updates.push((dt, t, cam) => {
      const cp = cam?.position;
      ppl.forEach((q, i) => {
        q.z += q.v * dt;
        if (q.gate) { if (q.z > S + 20) q.z = S + 2; if (q.z < S + 2) q.z = S + 20; } else { if (q.z > N - 10) q.z = S + 4; if (q.z < S + 4) q.z = N - 10; }
        // near the camera a card would show what it is: those stay in the distance (the animated people are near)
        const d = cp ? Math.hypot(q.x - cp.x, q.z - cp.z) : 99;
        const vis = d > (q.gate ? 11 : 9) ? 1 : 0; // near the camera the animated people take over
        const bob = Math.abs(Math.sin(t * 6 * Math.abs(q.v) + q.p)) * 0.04;
        E.set(0, cp ? Math.atan2(cp.x - q.x, cp.z - q.z) : 0, 0); Q.setFromEuler(E);
        P.set(q.x, 0.14 + bob, q.z); SC.set(q.h * 0.42 * vis, q.h * vis, 1);
        im.setMatrixAt(i, M.compose(P, Q, SC));
      });
      im.instanceMatrix.needsUpdate = true;
    });
  }

  return { update: (dt: number, t: number, cam: THREE.Camera | null) => { for (const u of updates) u(dt, t, cam); } };
}
