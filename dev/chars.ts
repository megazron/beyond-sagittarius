// Dev-only turntable for the crew (not part of the build): vite, then /dev/chars.html
import * as THREE from 'three';
import { randomLook, OUTFITS } from '../src/characters/custom';
import { createCharacter, CrewId, Character, CrewPose, CHAR_BUDGET, CLOTH_PULL, CLOTH_LIFT } from '../src/characters/character';
CHAR_BUDGET.throttle = false; CHAR_BUDGET.lodFar = Infinity; // the gate poses a body many times before it draws it once: every call must count
import { voice } from '../src/core/voice';
import { DECREEP } from '../src/characters/decreep';
import { preloadCrew } from '../src/characters/assets';
import { runScenario, scenarioFrames, scenarioNames, live } from './animqa';

const ids: CrewId[] = ['scientist', 'strong', 'medic', 'explorer', 'builder', 'social', 'megazron'];
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight);
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
r.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4d6a78);
const sun = new THREE.DirectionalLight(0xfff0d8, 3.6); sun.position.set(4, 7, 6); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight(0xbcd6e8, 0x394034, 1.3));
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshStandardMaterial({ color: 0x35402f, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// ?studio: a portrait setup that shows cloth and skin honestly (soft key, low fill, rim from behind)
if (new URLSearchParams(location.search).has('studio')) {
  scene.background = new THREE.Color(0x8f8c88);
  sun.color.set(0xfff4e6); sun.intensity = 2.6; sun.position.set(-3, 5, 6);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.0); fill.position.set(5, 2, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 2.2); rim.position.set(2, 4, -6);
  scene.add(fill, rim);
  (ground.material as THREE.MeshStandardMaterial).color.set(0x77736e);
}
const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
const alt = new URLSearchParams(location.search).get('skin') ?? undefined;
const customs = new URLSearchParams(location.search).get('custom');
// ?custom=all: every creator outfit in both builds (twelve townsfolk), each with a fixed random look, so the skin gate
// sees all of them on every run instead of two picked at random
// mulberry32: a repeatable Math.random for the skin gate
const seeded = (seed: number) => { let s = seed | 0; return () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
// ?gate: the same build gives the same numbers on every run. Clip start times, blinks, glances and sway phases are
// random, and the bodies attach in whatever order their files arrive; here every file is loaded first, so they attach
// in roster order on a seeded Math.random, and gateStart() gives each character its own seed and clock, so a body's
// pose in a close-up never depends on who was looked at before it (or on --only).
const GATE = new URLSearchParams(location.search).has('gate');
let solo = false;
const lookOf = (i: number) => {
  if (customs !== 'all') return randomLook({ name: 'x', gender: i % 2 ? 'f' : 'm' });
  const rnd = Math.random;
  Math.random = seeded(0x9e3779b9 ^ (i * 7919));
  const l = randomLook({ name: 'x', gender: i % 2 ? 'f' : 'm' }); Math.random = rnd;
  return { ...l, outfit: OUTFITS[i >> 1] };
};
const roster: CrewId[] = customs === 'all' ? OUTFITS.flatMap((o) => [o, o] as CrewId[]) : ids;
const detail = Number(new URLSearchParams(location.search).get('detail') ?? 1);
const chars: Character[] = (window as unknown as { chars: Character[] }).chars = [];
const make = () => roster.forEach((id, i) => { const c = customs ? createCharacter('scientist', detail, lookOf(i)) : createCharacter(id, detail, undefined, id === 'strong' ? alt : undefined); c.root.position.x = (i - 2.5) * 1.3; scene.add(c.root); chars.push(c); });
let pose: CrewPose = 'stand', amount = 0, t = 0, phase = 0;
const W = window as unknown as Record<string, unknown>;
W.view = (i: number, d: number, yaw: number, h: number, dist: number) => {
  const c = i < 0 ? new THREE.Vector3(0, 0, 0) : chars[i].root.position;
  cam.position.set(c.x + Math.sin(yaw) * dist, h, c.z + Math.cos(yaw) * dist);
  cam.lookAt(c.x, d, c.z);
  const el = W.eyeLight as THREE.PointLight | undefined; if (el) el.position.copy(cam.position).add(new THREE.Vector3(0.15, 0.25, 0));
};
W.viewAt = (x: number, y: number, z: number, yaw: number, up: number, dist: number) => { cam.position.set(x + Math.sin(yaw) * dist, y + up, z + Math.cos(yaw) * dist); cam.lookAt(x, y, z); };
W.pose = (p: CrewPose, a = 0) => { pose = p; amount = a; };
// review hooks for the de-creep pass: someone to look at, and a spoken line without audio (a syllable envelope)
W.gaze = (i: number, x: number, y: number, z: number) => chars[i].setLookTarget(new THREE.Vector3(x, y, z));
W.say = (i: number, sec: number) => chars[i].say(sec);
{ const v = voice as unknown as { mouth: (o: { open: number; round: number; wide: number }) => void };
  v.mouth = (o) => { const syl = Math.max(0, Math.sin(t * 13.5)) * (0.55 + 0.45 * Math.sin(t * 3.1 + 1)), gap = Math.sin(t * 1.7) > -0.75 ? 1 : 0;
    o.open = syl * gap; o.round = Math.max(0, Math.sin(t * 4.3)) * 0.5 * gap; o.wide = Math.max(0, Math.sin(t * 5.9 + 2)) * 0.5 * gap; }; }
// skin gate: every skin surface shaded flat grey from the front and flag magenta from behind; any magenta pixel on
// screen is the inside of a body seen through a hole (culled skin a camera can see). Clothes and hair render grey both
// sides (a coat's lining is meant to be seen); the background is black.
W.flagMode = () => {
  scene.background = new THREE.Color(0x000000); ground.visible = false; grid.visible = false;
  const flag = new THREE.ShaderMaterial({ side: THREE.DoubleSide, vertexShader: `#include <common>\n#include <skinning_pars_vertex>\n#include <morphtarget_pars_vertex>\nvarying vec3 vN;\nvoid main(){\n#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <skinning_vertex>\nvN = normalize(normalMatrix * objectNormal);\ngl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);}`,
    fragmentShader: `varying vec3 vN; void main(){ gl_FragColor = gl_FrontFacing ? vec4(vec3(0.35 + 0.4 * abs(vN.z)), 1.0) : vec4(1.0, 0.0, 1.0, 1.0); }` });
  const grey = new THREE.MeshBasicMaterial({ color: 0x777777, side: THREE.DoubleSide });
  scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || m === ground) return; m.material = m.name.startsWith('skin') ? flag : grey; });
};
// the camera inside a body or a garment (a sweep angle that lands in the hip as the hand swings past): the first
// surface on the way to the target is seen from behind, or sits so close the near plane cuts it open. Not a view anyone gets; the skin gate skips it.
const rc = new THREE.Raycaster(), rcN = new THREE.Vector3();
W.camInside = (x: number, y: number, z: number) => {
  const to = new THREE.Vector3(x, y, z), dir = to.clone().sub(cam.position); const far = dir.length(); dir.normalize();
  rc.set(cam.position, dir); rc.near = 0; rc.far = far - 0.02;
  const ms: THREE.Object3D[] = [];
  scene.traverseVisible((o) => { const m = o as THREE.SkinnedMesh; if (m.isMesh && m !== ground) { if (m.isSkinnedMesh) { m.computeBoundingSphere(); m.computeBoundingBox(); } ms.push(m); } });
  const hits = rc.intersectObjects(ms, false).filter((h) => h.face);
  const hit = hits[0];
  if (!hit) return false;
  if (hit.distance < cam.near * 1.6) return true; // a surface at the lens is cut open by the near plane: the same thing
  rcN.copy(hit.face!.normal).transformDirection(hit.object.matrixWorld);
  return rcN.dot(dir) > 0;
};
// the near plane cuts a body or a garment away somewhere in the frame, not only on the ray to the target (the lens a
// few centimetres from a coat: the cloth between the lens and the near plane is not drawn and the skin under it shows,
// at a corner of the screen or across all of it). Not a view anyone gets, the same as the camera inside it. Every
// skinned triangle, posed as drawn (morphs and bones), is clipped to the sliver of the view in front of the near plane
// (the pyramid from a tenth of the near distance out to the near plane's rectangle: a surface that only grazes the
// lens itself shows as a line, not as a hole): what is left of them was cut away. A cut counts once it
// takes at least minPx pixels out of the picture (the gate's own limit: a smaller cut cannot show more than that).
const ncV = new THREE.Vector3();
W.nearCut = (minPx = 25) => {
  cam.updateMatrixWorld(); const inv = cam.matrixWorldInverse, n = cam.near;
  const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tx = ty * cam.aspect;
  // half-spaces as f(p) >= 0, p = [x, y, z] in camera space (looking down -z)
  const planes: ((p: number[]) => number)[] = [(p) => -p[2] - n * 0.1, (p) => n + p[2], (p) => -tx * p[2] - p[0], (p) => -tx * p[2] + p[0], (p) => -ty * p[2] - p[1], (p) => -ty * p[2] + p[1]];
  // the part of a triangle in that sliver, as screen pixels (what the cut takes out of the picture)
  const ph = r.getContext().drawingBufferHeight, pw = r.getContext().drawingBufferWidth;
  const clip = (poly: number[][]) => {
    for (const f of planes) {
      const out: number[][] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
        if (fa >= 0) out.push(a);
        if ((fa >= 0) !== (fb >= 0)) { const s = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]); }
      }
      poly = out; if (poly.length < 3) return 0;
    }
    const q = poly.map((p) => [p[0] / (-p[2] * tx) * pw / 2, p[1] / (-p[2] * ty) * ph / 2]);
    let a2 = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; a2 += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(a2) / 2;
  };
  let cut = false, px = 0;
  scene.traverseVisible((o) => {
    const m = o as THREE.SkinnedMesh; if (cut || !m.isSkinnedMesh) return;
    const g = m.geometry, pos = g.getAttribute('position'), idx = g.getIndex();
    const P = new Float32Array(pos.count * 3);
    let close = false;
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, ncV); ncV.applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      P[i * 3] = ncV.x; P[i * 3 + 1] = ncV.y; P[i * 3 + 2] = ncV.z;
      if (ncV.z > -n) close = true;
    }
    if (!close) return;
    const nt = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < nt && !cut; t++) {
      const v = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
      if (v.every((i) => P[i * 3 + 2] < -n) || v.every((i) => P[i * 3 + 2] > 0)) continue;
      px += clip(v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
      if (px >= minPx) { cut = true; W.nearWhy = { mesh: m.name, tri: v, px }; }
    }
  });
  return cut;
};
// probe: the near plane moved (a cut it made shows as the difference)
W.setNear = (n: number) => { cam.near = n; cam.updateProjectionMatrix(); };
// probe: each visible mesh's nearest vertex along the view (metres) and whether it is skinned
W.nearest = () => {
  cam.updateMatrixWorld(); const out: [string, boolean, number][] = [];
  scene.traverseVisible((o) => {
    const m = o as THREE.SkinnedMesh; if (!m.isMesh || m === ground) return;
    const pos = m.geometry.getAttribute('position'); let z = 1e9;
    for (let i = 0; i < pos.count; i++) { m.getVertexPosition(i, ncV); ncV.applyMatrix4(m.matrixWorld).applyMatrix4(cam.matrixWorldInverse); z = Math.min(z, -ncV.z); }
    out.push([m.name || m.type, !!m.isSkinnedMesh, +z.toFixed(4)]);
  });
  return out.sort((a, b) => a[2] - b[2]).slice(0, 8);
};
// skin gate probe: what is under some screen pixels (first surface along the ray, front or back): mesh, triangle, bones
W.probeHits = (pts: [number, number][]) => {
  const out: unknown[] = []; const ms: THREE.Object3D[] = [];
  scene.traverseVisible((o) => { const m = o as THREE.SkinnedMesh; if (m.isMesh && m !== ground) { if (m.isSkinnedMesh) { m.computeBoundingSphere(); } ms.push(m); } });
  for (const [x, y] of pts) {
    rc.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam); rc.near = 0; rc.far = 100;
    const h = rc.intersectObjects(ms, false)[0]; if (!h || !h.face) { out.push(null); continue; }
    const m = h.object as THREE.SkinnedMesh, g = m.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const bones = [h.face.a, h.face.b, h.face.c].map((v) => { const r: string[] = []; if (si) for (let j = 0; j < 4; j++) { const w = sw.getComponent(v, j); if (w > 0.05) r.push(`${m.skeleton.bones[si.getComponent(v, j)].name}:${w.toFixed(2)}`); } return r.join(' '); });
    const fn = h.face.normal.clone().transformDirection(m.matrixWorld);
    out.push({ mesh: m.name, face: [h.face.a, h.face.b, h.face.c], back: fn.dot(rc.ray.direction) > 0, d: +h.distance.toFixed(3), bones });
  }
  return out;
};
W.flagCount = () => { const g = r.getContext(); const w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) n++; return n; };
// the eye light: a small soft source by the lens, so eyes are never dead sockets (de-creep only)
if (DECREEP) { const eyeLight = new THREE.PointLight(0xfff2e0, 0.55, 6, 1.5); scene.add(eyeLight); W.eyeLight = eyeLight; }

// ---- play capture (tools/play_capture.py): the game's own follow camera and flag passes for skin and cloth in motion ----
// Layers: body skin 0, footwear 0.5 (it goes on under the trouser hem), each other garment 1 + its order in the outfit.
// A visible surface with a more outer layer lying just behind it (within POKE_MM) has come out through that layer:
// skin through cloth (yellow) or an inner garment through an outer one (cyan). Skin seen from behind is magenta.
const POKE_MM = 12;
let tileLayer = [1, 2, 3, 4], tiles = 4;
W.setLayers = (layers: number[]) => { tiles = layers.length; tileLayer = [...layers, 9, 9, 9, 9].slice(0, 4); };
const layerVS = `#include <common>\n#include <skinning_pars_vertex>\n#include <morphtarget_pars_vertex>\nuniform float uTiles; uniform vec4 uTileLayer; uniform float uBase; uniform float uPull; uniform float uLift;\nvarying float vLayer; varying float vViewZ;\nvoid main(){\n#include <beginnormal_vertex>\n#include <morphnormal_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <begin_vertex>\n#include <morphtarget_vertex>\n#include <skinning_vertex>\n
  float L = uBase;
  if (uBase > 0.5 && uBase < 1.5) { int k = 0; if (uTiles < 1.5) k = 0; else if (uTiles < 2.5) k = uv.x >= 0.5 ? 1 : 0; else k = (uv.x >= 0.5 ? 1 : 0) + (uv.y >= 0.46875 ? 2 : 0); L = uTileLayer[k]; }
  vLayer = L; vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  if (L > 0.25 && L < 50.0) mv.xyz *= max(0.0, 1.0 - (uLift + L * uPull) / max(length(mv.xyz), 1e-3)); // as the game draws cloth (CLOTH_LIFT, CLOTH_PULL)
  vViewZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
const enc = `vec3 encD(float d){ float m = clamp(d * 1000.0, 0.0, 16777000.0); return vec3(floor(m / 65536.0), mod(floor(m / 256.0), 256.0), mod(floor(m), 256.0)) / 255.0; }`;
const mk = (frag: string, side: THREE.Side = THREE.DoubleSide) => new THREE.ShaderMaterial({ side, vertexShader: layerVS, fragmentShader: frag, uniforms: { uTiles: { value: 4 }, uTileLayer: { value: new THREE.Vector4() }, uBase: { value: 0 }, uMin: { value: 0 }, uPull: { value: CLOTH_PULL }, uLift: { value: CLOTH_LIFT } } });
// id: r = layer * 40 + 20 (skin from behind 250), g/b/a unused; depth: packed view depth (mm) of whatever is drawn
const idMat = () => mk(`varying float vLayer; varying float vViewZ; void main(){ float c = vLayer > 50.0 ? 240.0 : vLayer * 40.0 + 20.0; if (vLayer < 0.25 && !gl_FrontFacing) c = 250.0; gl_FragColor = vec4(c / 255.0, 0.0, 0.0, 1.0); }`);
const depMat = () => mk(`${enc}\nuniform float uMin; varying float vLayer; varying float vViewZ; void main(){ if (vLayer <= uMin || vLayer > 50.0) discard; gl_FragColor = vec4(encD(vViewZ), 1.0); }`);
const kindOf = (m: THREE.Mesh) => { const n = m.name; if (n.startsWith('skin_body')) return 0; if (n === 'cloth') return 1; return 99; };
const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
let rt: THREE.WebGLRenderTarget | null = null;
const read = () => { const g = r.getContext(); const w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); return { w, h, px }; };
const withMats = (make: (m: THREE.Mesh, k: number) => THREE.Material | null, bg: number) => {
  const old = scene.background; scene.background = new THREE.Color(bg); const gv = ground.visible, gr = grid.visible; ground.visible = false; grid.visible = false;
  scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || m === ground) return; saved.set(m, m.material); const k = kindOf(m); const x = make(m, k); if (x) m.material = x; else m.visible = false; });
  const g = r.getContext(); const w = g.drawingBufferWidth, h = g.drawingBufferHeight;
  if (!rt || rt.width !== w || rt.height !== h) { rt?.dispose(); rt = new THREE.WebGLRenderTarget(w, h, { samples: 0, colorSpace: THREE.NoColorSpace }); }
  // no MSAA and no tone mapping: an edge pixel keeps one surface's id and depth instead of a blend of two
  const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping; r.setRenderTarget(rt); r.render(scene, cam);
  const px = new Uint8Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, px); r.setRenderTarget(null); r.toneMapping = tm;
  const out = { w, h, px };
  saved.forEach((v, m) => { m.material = v; m.visible = true; }); saved.clear(); scene.background = old; ground.visible = gv; grid.visible = gr;
  return out;
};
const cache = new Map<string, THREE.ShaderMaterial>();
const getM = (key: string, f: () => THREE.ShaderMaterial, base: number) => { let m = cache.get(key); if (!m) { m = f(); cache.set(key, m); } m.uniforms.uBase.value = base; m.uniforms.uTiles.value = tiles; (m.uniforms.uTileLayer.value as THREE.Vector4).fromArray(tileLayer); return m; };
/** Flag passes over the current view: counts and (with shot) a composite of the shaded frame with every flag pixel painted. */
W.poke = (shot = false) => {
  const hidden: THREE.Object3D[] = []; scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.visible) hidden.push(o); });
  const keepHidden = (m: THREE.Mesh) => hidden.includes(m);
  const shade = shot ? (r.render(scene, cam), read()) : null;
  const id = withMats((m, k) => keepHidden(m) ? null : getM('id' + k, idMat, k === 0 ? 0 : k === 1 ? 1 : 99), 0x000000);
  const layers = [0, 0.5, ...tileLayer.filter((x) => x < 9)];
  const dep = new Map<number, Uint8Array>();
  for (const L of [...new Set(layers)]) {
    const res = withMats((m, k) => { if (keepHidden(m) || k === 99) return null; const x = getM('d' + k, depMat, k === 0 ? 0 : 1); x.uniforms.uMin.value = L; return x; }, 0xffffff);
    dep.set(L, res.px);
  }
  const vis = withMats((m, k) => { if (keepHidden(m)) return null; const x = getM('v' + k, depMat, k === 0 ? 0 : k === 1 ? 1 : 99); x.uniforms.uMin.value = -1; return k === 99 ? getM('v99', depMat, 0) : x; }, 0xffffff);
  const { w, h } = id; let skinPoke = 0, clothPoke = 0, back = 0;
  const D = (px: Uint8Array, i: number) => px[i] * 65536 + px[i + 1] * 256 + px[i + 2];
  const flag = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < id.px.length; i += 4, p++) {
    const c = id.px[i]; if (c === 0 || c === 240) continue;
    if (c === 250) { back++; flag[p] = 3; continue; }
    const Lv = (c - 20) / 40, dv = D(vis.px, i);
    const ks = [...dep.keys()].filter((L) => L >= Lv - 1e-3).sort((a, b) => a - b); if (!ks.length) continue;
    const px = dep.get(ks[0])!; if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) continue;
    const dd = D(px, i) - dv;
    if (dd > 0 && dd < POKE_MM) { if (Lv < 0.25) { skinPoke++; flag[p] = 1; } else { clothPoke++; flag[p] = 2; } }
  }
  let url = '';
  if (shot && shade) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g2 = cv.getContext('2d')!; const im = g2.createImageData(w, h);
    const C = [[0, 0, 0], [255, 230, 0], [0, 230, 255], [255, 0, 255]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 4, f = flag[(h - 1 - y) * w + x];
      if (f) { im.data[d] = C[f][0]; im.data[d + 1] = C[f][1]; im.data[d + 2] = C[f][2]; } else { im.data[d] = shade.px[s]; im.data[d + 1] = shade.px[s + 1]; im.data[d + 2] = shade.px[s + 2]; } im.data[d + 3] = 255; }
    g2.putImageData(im, 0, 0); url = cv.toDataURL('image/jpeg', 0.82);
  }
  return { skinPoke, clothPoke, back, url };
};
/** The game's follow camera (src/game/player.ts: fov 60, near 0.1, 5.2 m out by default) round character i. */
W.followCam = (i: number, yawOff: number, dist = 5.2, pitch = 0.22, fov = 60) => {
  const c = chars[i]; cam.fov = fov; cam.near = 0.1; cam.updateProjectionMatrix();
  const p = c.root.position, y = c.root.rotation.y + yawOff, fy = p.y + 1.45;
  cam.position.set(p.x - Math.sin(y) * Math.cos(pitch) * dist, fy + Math.sin(pitch) * dist, p.z - Math.cos(y) * Math.cos(pitch) * dist); cam.lookAt(p.x, fy - 0.15, p.z);
};
/** One step of character i alone: pose, ground speed (m/s, really moving), turn rate (rad/s). */
W.act = (i: number, kind: CrewPose, v: number, w: number, dt = 1 / 30, talk = false) => {
  const c = chars[i]; chars.forEach((o, j) => { o.root.visible = j === i; }); c.setGround(() => 0);
  if (talk) c.say(0.5);
  t += dt; c.root.rotation.y += w * dt; c.root.position.x += Math.sin(c.root.rotation.y) * v * dt; c.root.position.z += Math.cos(c.root.rotation.y) * v * dt;
  c.root.updateMatrixWorld(true); c.animate(kind, 0, v / 4, t, dt); // drawn only when a pass or a clip frame needs it (throttle is off here)
};
W.resetPos = (i: number) => { const c = chars[i]; c.root.position.set(0, 0, 0); c.root.rotation.y = 0; };
W.renderNow = () => r.render(scene, cam);
W.step = (n: number, dt = 1 / 30) => { for (let k = 0; k < n; k++) { t += dt; phase += dt * 7 * amount; chars.forEach((c) => { if (solo && !c.root.visible) return; c.root.updateMatrixWorld(); c.animate(pose, phase, amount, t, dt); }); } r.render(scene, cam); };
/** Skin gate: show only character i, on its own seed and clock; from now on only visible characters animate. */
W.gateStart = (i: number) => { chars.forEach((c, j) => { c.root.visible = j === i; }); Math.random = seeded(0x2545f491 + i * 977); t = 0; phase = 0; solo = true; };
/** Foot slide probe: walk a character at v m/s over flat ground, report world drift of planted feet. */
W.slide = (i: number, v: number, n = 240, dt = 1 / 60) => {
  const c = chars[i]; const res: number[] = [];
  c.setGround(() => 0);
  const b = (name: string) => c.fig.getObjectByName(name)!;
  const last: Record<string, THREE.Vector3> = {};
  const p = new THREE.Vector3(), lows: number[] = [];
  for (let k = 0; k < n; k++) {
    c.root.position.z += v * dt; t += dt;
    c.root.updateMatrixWorld(true);
    c.animate('walk', 0, v / 4, t, dt);
    c.root.updateMatrixWorld(true);
    for (const s of ['footL', 'footR']) {
      b(s).getWorldPosition(p);
      if (last[s] && k > 60 && p.y < 0.13) res.push(Math.hypot(p.x - last[s].x, p.z - last[s].z) / dt);
      if (k > 60) lows.push(p.y);
      (last[s] ??= new THREE.Vector3()).copy(p);
    }
  }
  res.sort((a, b2) => a - b2);
  c.root.position.z = 0;
  return { medianStanceSlide: res[res.length >> 1], p90: res[Math.floor(res.length * 0.9)], minFootY: Math.min(...lows) };
};
/** Deterministic driven take for video: speed and turn profile over time, camera following. */
const grid = new THREE.GridHelper(200, 200, 0xc8d0c0, 0x7f8a7a); grid.position.y = 0.004; grid.visible = !new URLSearchParams(location.search).has('studio'); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5; scene.add(grid);
let driveT = 0, yawNow = 0;
const profile = (s: number): [number, number] => {
  // seconds -> [m/s, rad/s]
  const seg = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const v = 1.4 * seg(1, 1.6, s) + 1.6 * seg(4, 4.6, s) + 3.2 * seg(7, 7.6, s) - 6.2 * seg(9.5, 10.3, s);
  const w = (s > 5 && s < 6 ? 0.9 : 0) + (s > 11 && s < 12.4 ? 1.8 : 0) + (s > 13.2 && s < 14.2 ? -2.4 : 0);
  return [Math.max(0, v), w];
};
W.drive = (i: number, dt = 1 / 30, sideView = false) => {
  const c = chars[i];
  chars.forEach((o, j) => { o.root.visible = j === i; });
  c.setGround(() => 0);
  for (let k = 0; k < 2; k++) {
    const h = dt / 2; driveT += h; t += h;
    const [v, w] = profile(driveT);
    yawNow += w * h;
    c.root.rotation.y = yawNow;
    c.root.position.x += Math.sin(yawNow) * v * h; c.root.position.z += Math.cos(yawNow) * v * h;
    c.root.updateMatrixWorld(true);
    c.animate('idle', 0, v / 4, t, h);
  }
  const p = c.root.position;
  if (sideView) { cam.position.set(p.x + 3.8, 1.0, p.z); cam.lookAt(p.x, 0.92, p.z); }
  else { cam.position.set(p.x - Math.sin(yawNow - 0.5) * 3.6, 1.55, p.z - Math.cos(yawNow - 0.5) * 3.6); cam.lookAt(p.x, 0.95, p.z); }
  r.render(scene, cam);
  return driveT;
};
/** Shake probe: head travel per frame while standing, and worst frame-to-frame jerk (mm). */
W.calm = (i: number, kind: CrewPose = 'stand', n = 240, dt = 1 / 60) => {
  const c = chars[i]; const h = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let v = 0, jerk = 0, peak = 0;
  for (let k = 0; k < n; k++) {
    t += dt; c.root.updateMatrixWorld(true); c.animate(kind, 0, 0, t, dt); c.root.updateMatrixWorld(true);
    c.head.getWorldPosition(h);
    if (k > 90) { const d = h.distanceTo(a); v += d; peak = Math.max(peak, d); jerk = Math.max(jerk, h.clone().sub(a).sub(a.clone().sub(b)).length()); }
    b.copy(a); a.copy(h);
  }
  return { meanMmPerFrame: v / (n - 91) * 1000, peakMm: peak * 1000, jerkMm: jerk * 1000 };
};
W.trace = (i: number, n = 200, dt = 1 / 60) => {
  const c = chars[i]; const a = new THREE.Vector3(), h = new THREE.Vector3(), out: unknown[] = [];
  const hips = c.fig.getObjectByName('hips')!, hp = new THREE.Vector3(), lp = new THREE.Vector3();
  const last = new Map<string, THREE.Quaternion>();
  for (let k = 0; k < n; k++) {
    t += dt; c.root.updateMatrixWorld(true); c.animate('stand', 0, 0, t, dt); c.root.updateMatrixWorld(true);
    c.head.getWorldPosition(h); hips.getWorldPosition(hp);
    const d = h.distanceTo(a) * 1000, e = hp.distanceTo(lp) * 1000;
    if (k > 0 && d > 3) { const bad: string[] = []; c.fig.traverse((o) => { if (!(o as THREE.Bone).isBone) return; const l = last.get(o.name); if (l) { const a2 = l.angleTo(o.quaternion) * 57.3; if (a2 > 0.5) bad.push(o.name + ':' + a2.toFixed(1)); } }); out.push([k, +d.toFixed(1), +e.toFixed(1), bad.join(' ')]); }
    c.fig.traverse((o) => { if ((o as THREE.Bone).isBone) last.set(o.name, o.quaternion.clone()); });
    a.copy(h); lp.copy(hp);
  }
  return out;
};
/** Walk one character past the camera, a frame every few steps. */
W.film = (i: number, v: number, k: number) => {
  const c = chars[i];
  chars.forEach((o, j) => { o.root.visible = j === i; });
  c.setGround(() => 0);
  for (let n = 0; n < k; n++) { c.root.position.z += v / 60; t += 1 / 60; c.root.updateMatrixWorld(true); c.animate('walk', 0, v / 4, t, 1 / 60); }
  const p = c.root.position;
  cam.position.set(p.x + 3.6, 1.1, p.z + 0.2); cam.lookAt(p.x, 0.95, p.z);
  r.render(scene, cam);
};
/** Animation QA probe (dev/animqa.ts, tools/anim_qa.py): one scenario on character i, measured every frame; every > 0
 * also samples the pixel flags (poke) from the talking-distance front and side and a three-quarter view. */
const QA_CAMS: [number, number][] = [[Math.PI, 2.4], [-Math.PI / 2, 2.4], [-2.4, 3.4]];
W.qaNames = (crew: boolean) => scenarioNames(crew);
W.qa = (i: number, name: string, every = 10, sampleEvery = 0) => {
  const c0 = chars[i]; chars.forEach((o, j) => { o.root.visible = j === i; }); c0.setGround(() => 0);
  const step = (c: Character, p: CrewPose, amount: number, dt: number) => { t += dt; c.root.updateMatrixWorld(true); c.animate(p, 0, amount, t, dt); };
  const poke = W.poke as (shot: boolean) => { skinPoke: number; clothPoke: number; back: number };
  const follow = W.followCam as (i: number, yo: number, d: number) => void;
  return runScenario(c0, name, {
    step,
    settle: (c) => { c.root.position.set(0, 0, 0); c.root.rotation.y = 0; for (let k = 0; k < 45; k++) step(c, 'stand', 0, 1 / 30); },
    flags: every > 0 && !sampleEvery ? () => { const s = { skinPoke: 0, clothPoke: 0, back: 0 }; for (const [yo, d] of QA_CAMS) { follow(i, yo, d); const f = poke(false); s.skinPoke += f.skinPoke; s.clothPoke += f.clothPoke; s.back += f.back; } return s; } : null,
  }, Math.max(1, every), sampleEvery);
};
/** The probe's scenarios drawn live for the review clips (GPU capture): character i through each named scenario at
 * `slow` x real time, a close camera from `yaw` (radians, 0 = from the front) at `dist` m, the scenario and live
 * numbers in a caption. window.qaDone turns true at the end. */
const qaStone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 1), new THREE.MeshStandardMaterial({ color: 0x6e6a64, roughness: 0.9 }));
const qaShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.8 }));
const qaDots = [0xff3030, 0x3080ff].map((c) => new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false })));
[qaStone, qaShaft, ...qaDots].forEach((m) => { m.visible = false; m.renderOrder = 9; scene.add(m); });
W.qaLive = (i: number, names: string[], slow = 0.5, yaw = -2.4, dist = 2.0, every = 0) => {
  const c0 = chars[i]; chars.forEach((o, j) => { o.root.visible = j === i; }); c0.setGround(() => 0);
  const cap = document.getElementById('qa-cap') ?? Object.assign(document.body.appendChild(document.createElement('div')), { id: 'qa-cap' });
  cap.setAttribute('style', 'position:fixed;left:16px;top:12px;font:600 22px sans-serif;color:#fff;text-shadow:0 1px 3px #000;white-space:pre');
  const step = (c: Character, p: CrewPose, amount: number, dt: number) => { t += dt; c.root.updateMatrixWorld(true); c.animate(p, 0, amount, t, dt); };
  W.qaDone = false; W.qaLiveRes = [];
  let ni = 0, gen: Generator<number, unknown> | null = null, last = performance.now(), acc = 0;
  const tick = () => {
    if (!gen) {
      if (ni >= names.length) { W.qaDone = true; cap.textContent = ''; return; }
      gen = scenarioFrames(c0, names[ni], { step, settle: (c) => { c.root.position.set(0, 0, 0); c.root.rotation.y = 0; for (let k = 0; k < 45; k++) step(c, 'stand', 0, 1 / 30); }, flags: null }, Math.max(1, every));
    }
    const now = performance.now(); acc += (now - last) / 1000 * slow * 30; last = now;
    let it: IteratorResult<number, unknown> | null = null;
    for (let n = 0; acc >= 1 && n < 3; n++, acc--) { it = gen.next(); if (it.done) break; }
    if (it?.done) { (W.qaLiveRes as unknown[]).push(it.value); gen = null; ni++; }
    // the held things where the hands are told to be: a shaft through both grips (a spear), a stone at a single grip
    const h = live.hold;
    qaStone.visible = !!h && !(h.L && h.R) && /stone|throw/.test(live.name); qaShaft.visible = !!h && !!h.L && !!h.R && /spear/.test(live.name);
    qaDots.forEach((d, j) => { const s = j ? h?.L : h?.R; d.visible = !!s; if (s) d.position.copy(s.at); });
    if (qaStone.visible) { const s = (h!.R ?? h!.L)!; qaStone.position.copy(s.at).addScaledVector(s.palm, -0.045).addScaledVector(s.fingers, 0.06); }
    if (qaShaft.visible) { const a = h!.R!.at, b = h!.L!.at, d = b.clone().sub(a).normalize(); qaShaft.position.copy(a).addScaledVector(d, 0.3); qaShaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); }
    const p = c0.root.position, y = c0.root.rotation.y + yaw;
    cam.fov = 40; cam.near = 0.05; cam.updateProjectionMatrix();
    cam.position.set(p.x + Math.sin(y) * dist, p.y + 1.25, p.z + Math.cos(y) * dist); cam.lookAt(p.x, p.y + 0.85, p.z);
    cap.textContent = `${names[Math.min(ni, names.length - 1)]}   ${slow}x   (red/blue dots: where each hand is told to be)`;
    r.render(scene, cam); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
(W.view as Function)(-1, 1, 0, 1.3, 11);
const keys = customs === 'all' ? roster.map((o, i) => `custom_${i % 2 ? 'f' : 'm'}_${o}`) : roster.map((id) => (id === 'strong' && alt ? 'strong_suit' : id));
(GATE ? (Math.random = seeded(0x51a7e), preloadCrew(keys, detail)) : Promise.resolve()).then(() => { make(); return Promise.all(chars.map((c) => c.whenReady)); })
  .then(() => { (W.step as Function)(4); setTimeout(() => { (W.step as Function)(2); W.ready = true; }, 3000); });
