/**
 * The Scatter stages, dressed to the city's standard: a real sky that also lights the ground (image-based light from
 * the stage's own sky), giants with banded weather and lit rings, scale cues from the pebble to the horizon, and one
 * piece of megascale per place: the ice river of Skyvra's ring, the mother asteroid over Bolzar's rubble, the rest of
 * the liner around Lyrra, the haze, spires and plumes of Draxum's moon, the cloud towers of Nuvexa.
 */
import * as THREE from 'three';
import { createSpaceDome } from '../../cinematic/space';
import { NOISE_GLSL } from '../../core/glsl';
import { mulberry32, Simplex } from '../../core/noise';

export interface DressPad { x: number; z: number; r: number; y: number }
type Height = (x: number, z: number) => number;

/** A gas or ice giant: bands with turbulence and a storm, a lit limb and a terminator, an atmosphere rim. */
function giant(r: number, c0: THREE.Color, c1: THREE.Color, sunDir: THREE.Vector3, seed: number, ring = 0) {
  const g = new THREE.Group();
  const u = { uSun: { value: sunDir }, uA: { value: c0 }, uB: { value: c1 }, uSeed: { value: seed } };
  const surf = new THREE.ShaderMaterial({
    uniforms: u, fog: false,
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix) * normal); vWP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWP, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uSun, uA, uB; uniform float uSeed; varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
      ${NOISE_GLSL}
      void main(){
        vec3 n = normalize(vN);
        float warp = fbm3(n * 3.0 + uSeed) * 0.35 + fbm3(n * 11.0 + uSeed) * 0.06;
        float lat = n.y + warp * 0.18;
        float band = sin(lat * 26.0) * 0.5 + 0.5, fine = sin(lat * 71.0 + warp * 6.0) * 0.5 + 0.5;
        vec3 col = mix(uA, uB, band * 0.75 + fine * 0.25);
        // one great storm, with its wake
        vec2 sp = vec2(atan(n.z, n.x) - 0.9, n.y + 0.32); float storm = smoothstep(0.16, 0.0, length(sp * vec2(0.55, 1.6)));
        col = mix(col, uB * 1.25 + vec3(0.06, 0.02, 0.0), storm * 0.8);
        vec3 N = normalize(vWN), V = normalize(cameraPosition - vWP);
        float ndl = dot(N, uSun), lit = smoothstep(-0.12, 0.5, ndl);
        col *= 0.035 + lit * 1.35;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        col += mix(uB, vec3(0.7, 0.85, 1.0), 0.35) * fres * smoothstep(-0.25, 0.4, ndl) * 0.7;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64), surf));
  if (ring) {
    // rings drawn by radius in the shader: gaps, ringlets and the planet's shadow across them
    const rm = new THREE.ShaderMaterial({
      uniforms: { uSun: u.uSun, uR0: { value: r * 1.25 }, uR1: { value: r * ring }, uCol: { value: c1.clone().lerp(new THREE.Color(0xffffff), 0.35) }, uRp: { value: r } },
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */ `varying vec3 vL; varying vec3 vW; void main(){ vL = position; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uSun, uCol; uniform float uR0, uR1, uRp; varying vec3 vL; varying vec3 vW;
        ${NOISE_GLSL}
        void main(){
          float rr = length(vL.xy), k = (rr - uR0) / (uR1 - uR0);
          if (k < 0.0 || k > 1.0) discard;
          float d = 0.35 + 0.65 * vnoise2(vec2(k * 90.0, 0.5)) * vnoise2(vec2(k * 23.0, 3.1));
          d *= smoothstep(0.0, 0.04, k) * smoothstep(1.0, 0.9, k) * (1.0 - 0.85 * smoothstep(0.47, 0.49, k) * smoothstep(0.55, 0.53, k));
          // the planet's shadow: the ring point seen from the sun, behind the planet
          vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, p = vW - c;
          float along = dot(p, uSun); float off = length(p - uSun * along);
          float sh = (along < 0.0 && off < uRp) ? 0.08 : 1.0;
          gl_FragColor = vec4(uCol * (0.25 + 1.1 * sh), d * 0.85);
        }`,
    });
    const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.25, r * ring, 256, 1), rm);
    rg.rotation.x = -Math.PI / 2 + 0.32; g.add(rg);
  }
  return g;
}

/** A sky for stages with air: zenith to horizon, a sun glow, a band of haze at the horizon. */
function airSky(zen: number, hor: number, glow: number, sunDir: THREE.Vector3) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uZ: { value: new THREE.Color(zen) }, uH: { value: new THREE.Color(hor) }, uG: { value: new THREE.Color(glow) }, uSun: { value: sunDir } },
    vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position,1.0)).xyz, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `uniform vec3 uZ, uH, uG, uSun; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(uH, uZ, pow(smoothstep(-0.05, 0.75, h), 0.7));
        float s = max(dot(d, uSun), 0.0); c += uG * (pow(s, 6.0) * 0.6 + pow(s, 60.0) * 1.6);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m); sky.scale.setScalar(8000); sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}

/** Soft round puff for haze, plumes and clouds. */
function puff(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, r = mulberry32(5);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (r() - .5) * 60, y = 64 + (r() - .5) * 40, rad = 18 + r() * 34, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** A big body seen from afar: many faces, layered noise, craters pressed in. */
function bigRock(seed: number) {
  const nz = new Simplex(seed), g = new THREE.IcosahedronGeometry(1, 5), p = g.attributes.position, v = new THREE.Vector3(), r = mulberry32(seed);
  const craters = Array.from({ length: 18 }, () => ({ c: new THREE.Vector3(r() - .5, r() - .5, r() - .5).normalize(), s: .08 + r() * .22 }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); let k = 1 + .22 * nz.fbm(v.x * 1.4, v.y * 1.4 + v.z, 5);
    for (const c of craters) { const d = v.distanceTo(c.c) / c.s; if (d < 1.25) k -= d < 1 ? .05 * (1 - d * d) : -.02 * (1.25 - d) * 4; }
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals(); return g;
}

const Q = new THREE.Quaternion(), E = new THREE.Euler(), M = new THREE.Matrix4(), S = new THREE.Vector3(), T = new THREE.Vector3();

/**
 * Dresses a built stage. `rich` is the device budget (counts scale with it). Returns a per-frame update.
 */
export function dressStage(name: string, scene: THREE.Scene, pads: DressPad[], h: Height, sunDir: THREE.Vector3, rockGeoIn: (seed: number) => THREE.BufferGeometry, rockMIn: THREE.Material, rich: boolean, hull = false) {
  // on a piece of ship the loose things are ship: plates, brackets and boxes, not stones
  const parts = [new THREE.BoxGeometry(1.4, .25, 1), new THREE.BoxGeometry(.6, .6, .6), new THREE.CylinderGeometry(.18, .18, 1.6, 8).rotateZ(Math.PI / 2)];
  const rockGeo = hull ? (seed: number) => parts[Math.abs(Math.round(seed)) % 3] : rockGeoIn;
  const rockM = hull ? new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: .5, metalness: .7 }) : rockMIn;
  const rnd = mulberry32(name.length * 131 + 17), noise = new Simplex(name.length * 7 + 1);
  const updates: ((dt: number, t: number, cam: THREE.Camera | null) => void)[] = [];
  const k = rich ? 1 : .45;
  const airless = name === 'ring' || name === 'scree' || name === 'wreck';

  // ---- the sky, and image-based light from it ----
  if (airless) {
    const dome = createSpaceDome(); dome.uniforms.uNebula.value = name === 'wreck' ? 1.1 : .8; dome.uniforms.uBH.value = 0;
    scene.add(dome.mesh); scene.background = null;
    scene.userData.skyForEnv = dome.mesh; scene.userData.envIntensity = .55;
    // the sun itself: a hard disc with glare, where the shadows come from
    const sm = new THREE.SpriteMaterial({ map: puff(), color: 0xfff4e0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const sunS = new THREE.Sprite(sm); sunS.scale.setScalar(260); sunS.position.copy(sunDir).multiplyScalar(4000); scene.add(sunS);
    const core = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6e8).multiplyScalar(6), fog: false }));
    core.position.copy(sunS.position); scene.add(core);
    updates.push((_dt, t) => { dome.uniforms.uTime.value = t; });
  } else {
    const sky = name === 'moon' ? airSky(0x3a1c0c, 0xc07a3a, 0xffc070, sunDir) : airSky(0x3a5c96, 0xd8a868, 0xfff0d0, sunDir);
    scene.add(sky); scene.background = null; scene.userData.skyForEnv = sky; scene.userData.envIntensity = name === 'moon' ? .9 : 1.1;
  }
  scene.userData.ao = rich;

  // ---- small scale: pebbles everywhere and boulders at the edges, so the eye has a ruler ----
  for (const b of pads) {
    const n = Math.round(b.r * b.r * 1.6 * k), peb = new THREE.InstancedMesh(rockGeo(b.z + 9), rockM, n);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * b.r * .95, x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr, sc = .03 + rnd() * rnd() * .12;
      E.set(rnd() * 6, rnd() * 6, rnd() * 6); peb.setMatrixAt(i, M.compose(T.set(x, h(x, z) + sc * .2, z), Q.setFromEuler(E), S.set(sc * 1.3, sc * .6, sc)));
    }
    peb.receiveShadow = true; scene.add(peb);
    const nb = Math.round(b.r * .9), bl = new THREE.InstancedMesh(rockGeo(b.x * 3 + 1), rockM, nb);
    for (let i = 0; i < nb; i++) {
      const a = rnd() * 6.283, rr = b.r * (.82 + rnd() * .14), x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr, sc = .7 + rnd() * 1.6;
      E.set(rnd() * 6, rnd() * 6, rnd() * 6); bl.setMatrixAt(i, M.compose(T.set(x, h(x, z) + sc * .15, z), Q.setFromEuler(E), S.set(sc * (1 + rnd() * .5), sc * (.6 + rnd() * .5), sc)));
    }
    bl.castShadow = bl.receiveShadow = true; scene.add(bl);
  }
  const P0 = pads[0];

  // ---- megascale, one per place ----
  if (name === 'ring') {
    // the giant, banded, with its rings lit and shadowed, filling half the sky
    const gi = giant(900, new THREE.Color(0x9a6a40), new THREE.Color(0xe8c89a), sunDir, 3.1, 2.3); gi.position.set(-1500, 260, -1400); scene.add(gi);
    // the river of ice: the ring she stands in, a flat band of blocks running to both horizons
    const n = Math.round(3200 * k), ice = new THREE.InstancedMesh(rockGeo(7), new THREE.MeshStandardMaterial({ color: 0xd8ecfa, roughness: .3, metalness: 0, envMapIntensity: 1.2 }), n);
    for (let i = 0; i < n; i++) {
      const along = (rnd() - .5) * 2400, across = (rnd() - .5) * (60 + Math.abs(along) * .12) + 30 * Math.sin(along / 300), y = (rnd() - .5) * (6 + Math.abs(along) * .01) - 4;
      if (Math.hypot(along, across) < 55) { ice.setMatrixAt(i, M.makeScale(0, 0, 0)); continue; }
      const sc = .6 + rnd() * rnd() * (4 + Math.abs(along) * .006);
      E.set(rnd() * 6, rnd() * 6, rnd() * 6); ice.setMatrixAt(i, M.compose(T.set(along * .8 + across * .6, y, -along * .6 + across * .8), Q.setFromEuler(E), S.setScalar(sc)));
    }
    ice.castShadow = false; ice.receiveShadow = true; scene.add(ice);
    // ice spires growing out of the floe, glassy, catching the sun
    const sp = new THREE.InstancedMesh(new THREE.ConeGeometry(.35, 3, 6), new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: .08, metalness: 0, transmission: rich ? .6 : 0, thickness: .5, envMapIntensity: 1.6 }), Math.round(30 * k));
    for (let i = 0; i < sp.count; i++) {
      const b = pads[1 + (i % (pads.length - 1))] ?? pads[0], a = rnd() * 6.283, rr = b.r * (.72 + rnd() * .22), x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr, sc = .25 + rnd() * rnd() * .7;
      E.set((rnd() - .5) * .5, rnd() * 6, (rnd() - .5) * .5); sp.setMatrixAt(i, M.compose(T.set(x, h(x, z) + sc * 1.2, z), Q.setFromEuler(E), S.set(sc, sc * (1 + rnd()), sc)));
    }
    sp.castShadow = true; scene.add(sp);
  } else if (name === 'scree') {
    // the mother body the rubble came from, close enough to show its craters, half in shadow
    const big = new THREE.Mesh(bigRock(41), new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: .95, metalness: 0 })); big.scale.set(260, 190, 230); big.position.set(420, 120, -640); scene.add(big);
    const mid = new THREE.Mesh(bigRock(17), rockM);
    const fill = new THREE.DirectionalLight(0x8aa0d8, .55); fill.position.set(-.6, .3, -.7); scene.add(fill); mid.scale.set(38, 26, 30); mid.position.set(-120, 30, -160); mid.castShadow = true; scene.add(mid);
    // dust lifted by every step stays up a long time in this gravity: a slow glittering haze around the pads
    const n = Math.round(1400 * k), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const b = pads[i % pads.length], a = rnd() * 6.283, rr = rnd() * b.r * 1.4; pos.set([b.x + Math.cos(a) * rr, b.y + rnd() * 3, b.z + Math.sin(a) * rr], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8d0c0, size: .05, transparent: true, opacity: .55, depthWrite: false })); scene.add(dust);
    updates.push((_dt, t) => { dust.rotation.y = t * .004; });
  } else if (name === 'wreck') {
    // the rest of the liner: a broken hull section with its ribs open, girders and cables trailing, far and slow
    { const fill = new THREE.DirectionalLight(0x9a88ff, .5); fill.position.set(-.5, .2, -.8); scene.add(fill); } // the nebula's light
    const hullM = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: .45, metalness: .75 }), darkM = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: .6, metalness: .6 });
    const sec = new THREE.Group(); sec.position.set(-90, 40, -260); sec.rotation.set(.4, .7, .25); scene.add(sec);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(38, 38, 140, 48, 1, true, 0, Math.PI * 1.3), hullM); shell.material.side = THREE.DoubleSide; sec.add(shell);
    for (let i = 0; i < 14; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(37, 1.1, 6, 40, Math.PI * (1.3 + rnd() * .5)), darkM); rib.rotation.x = Math.PI / 2; rib.position.y = -64 + i * 10; sec.add(rib); }
    const lightM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5030).multiplyScalar(4) }), lights: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(.9, 8, 6), lightM); const a = rnd() * Math.PI * 1.3; l.position.set(Math.cos(a) * 39, -60 + rnd() * 120, Math.sin(a) * 39); sec.add(l); lights.push(l); }
    // girders and plates drifting around the piece she is on
    const n = Math.round(160 * k), gir = new THREE.InstancedMesh(new THREE.BoxGeometry(.4, .4, 6), darkM, n), plates = new THREE.InstancedMesh(new THREE.BoxGeometry(3, .12, 2), hullM, n);
    const drift: { p: THREE.Vector3; w: THREE.Vector3; r: THREE.Euler; s: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, rr = 22 + rnd() * 140, p = new THREE.Vector3(P0.x + Math.cos(a) * rr, (rnd() - .4) * 60, P0.z + Math.sin(a) * rr);
      drift.push({ p, w: new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).multiplyScalar(.08), r: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), s: .6 + rnd() * 1.8 });
    }
    scene.add(gir, plates); gir.castShadow = plates.castShadow = true;
    updates.push((_dt, t) => {
      drift.forEach((d, i) => {
        E.set(d.r.x + d.w.x * t, d.r.y + d.w.y * t, d.r.z + d.w.z * t); Q.setFromEuler(E); S.setScalar(d.s);
        T.copy(d.p).addScaledVector(d.w, t * 2); (i % 2 ? plates : gir).setMatrixAt(i, M.compose(T, Q, S));
      });
      gir.instanceMatrix.needsUpdate = plates.instanceMatrix.needsUpdate = true;
      lights.forEach((l, i) => { l.visible = Math.sin(t * 2.2 + i * 1.7) > .6; });
    });
  } else if (name === 'moon') {
    // the giant through the haze, banded in its own oranges
    const gi = giant(900, new THREE.Color(0xb07040), new THREE.Color(0xf0c890), sunDir, 7.7); gi.position.set(-500, 620, -1500); scene.add(gi);
    // ice spires worn by methane rain, standing out of the lakes
    const sm = new THREE.MeshStandardMaterial({ color: 0x8a6448, roughness: .7 }), n = Math.round(70 * k), spG = new THREE.CylinderGeometry(.35, 1.5, 1, 9, 12); { const p = spG.attributes.position, nz = new Simplex(9);
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), w = 1 + .35 * nz.fbm(x * 2 + y * 3, z * 2 - y * 3, 3) + .25 * Math.sin(y * 9); p.setXYZ(i, x * w, y, z * w); }
      spG.computeVertexNormals(); }
    const sp = new THREE.InstancedMesh(spG, sm, n);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, rr = 25 + rnd() * 160, x = P0.x + Math.cos(a) * rr, z = P0.z + Math.sin(a) * rr, hh = 6 + rnd() * rnd() * 40;
      if (pads.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + 3)) { sp.setMatrixAt(i, M.makeScale(0, 0, 0)); continue; }
      E.set((rnd() - .5) * .15, rnd() * 6, (rnd() - .5) * .15); sp.setMatrixAt(i, M.compose(T.set(x, hh / 2 - 2, z), Q.setFromEuler(E), S.set(1 + rnd() * 2, hh, 1 + rnd() * 2)));
    }
    sp.castShadow = true; scene.add(sp);
    // haze in layers, and two cryovolcano plumes rising into it
    const pt = puff(), hz: THREE.Sprite[] = [];
    for (let i = 0; i < Math.round(40 * k); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, color: 0xe0a060, transparent: true, opacity: .16, depthWrite: false, fog: false }));
      const a = rnd() * 6.283, rr = 60 + rnd() * 260; s.position.set(Math.cos(a) * rr, 6 + rnd() * 30, Math.sin(a) * rr); s.scale.set(120 + rnd() * 160, 30 + rnd() * 30, 1); scene.add(s); hz.push(s);
    }
    for (const [px, pz] of [[-140, -210], [190, -150]]) for (let j = 0; j < 14; j++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, color: 0xf0d8c0, transparent: true, opacity: .5 - j * .025, depthWrite: false, fog: false }));
      s.position.set(px + (rnd() - .5) * 6, j * 9, pz + (rnd() - .5) * 6); s.scale.setScalar(14 + j * 5); scene.add(s); hz.push(s);
    }
    updates.push((_dt, t) => { hz.forEach((s, i) => { s.material.rotation = t * .01 * ((i % 3) - 1); }); });
  } else if (name === 'clouds') {
    // cloud towers rising from the deck below, and the layer above; lightning far off inside them
    const pt = puff(), cl: THREE.Sprite[] = [];
    const n = Math.round(150 * k);
    for (let i = 0; i < n; i++) {
      const tower = i % 3 === 0, a = rnd() * 6.283, rr = 60 + rnd() * 420, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (tower) {
        // a cumulus tower: a shaded body rising from the deck below, a sunlit crown on top
        const hgt = 60 + rnd() * 120, w = 50 + rnd() * 90;
        for (let j = 0; j < 4; j++) {
          const lit = j / 3, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, color: new THREE.Color(0x8a6a58).lerp(new THREE.Color(0xfff8ec), lit), transparent: true, opacity: .95, depthWrite: false, fog: false }));
          s.position.set(x + (rnd() - .5) * 10, -40 + hgt * (j / 3), z + (rnd() - .5) * 10); s.scale.set(w * (1.1 - lit * .3), hgt * .55, 1); scene.add(s); cl.push(s);
        }
      } else {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, color: rnd() < .5 ? 0xb88a5a : 0xe8c890, transparent: true, opacity: .8, depthWrite: false, fog: false }));
        s.position.set(x, rnd() < .6 ? -45 - rnd() * 25 : 120 + rnd() * 40, z); s.scale.set(90 + rnd() * 150, 25 + rnd() * 25, 1); scene.add(s); cl.push(s);
      }
    }
    const bolt = new THREE.PointLight(0xd8e4ff, 0, 600, 1.2); scene.add(bolt); let next = 4;
    updates.push((dt, t) => {
      if (t > next) { next = t + 5 + Math.abs(noise.fbm(t, 1, 2)) * 9; const s = cl[Math.floor(rnd() * cl.length)]; bolt.position.copy(s.position); bolt.intensity = 9e4; }
      bolt.intensity *= Math.exp(-dt * 14);
      cl.forEach((s, i) => { s.position.x += Math.sin(i) * dt * .3; });
    });
  }
  return (dt: number, t: number, cam: THREE.Camera | null) => { for (const u of updates) u(dt, t, cam); };
}
