import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Simplex } from '../core/noise';

/**
 * Episode Two's rock shelter (level 13): an overhang in a low cliff, not boxes. One curved sheet of rock is the back wall
 * and the roof, bowed in from the sides and running out past the floor as a lip; the cliff's mass is built round it from
 * weathered blocks. The rock is banded (bedding planes), its colour varies band to band; the roof is blackened with old
 * soot where fires were made under it for a long time, darkest above the hearth and along the lip where the smoke ran
 * out. Negative hand stencils are projected onto the back wall itself (decals that follow the rock), not cards in front
 * of it.
 *
 * Local frame: x across the opening, z into the rock, y up; the origin on the floor in the middle of the shelter.
 */
export interface RockShelter { group: THREE.Group; wall: THREE.Mesh; hands: THREE.Vector3[]; hearth: THREE.Vector3 }

const N = new Simplex(1307);
const fbm = (x: number, y: number) => N.noise2(x, y) * 0.6 + N.noise2(x * 2.1 + 7, y * 2.1 - 3) * 0.3 + N.noise2(x * 4.3 - 11, y * 4.3 + 5) * 0.12;

/** The profile of the back wall and roof, bottom to lip, as (z, y) in metres. */
const PROFILE: [number, number][] = [[1.9, -0.45], [2.3, 0.55], [2.25, 1.45], [1.75, 2.25], [0.7, 2.62], [-0.5, 2.62], [-1.4, 2.55]]; // the lip's edge ends inside the lip's bed
function profile(v: number) {
  const pts = PROFILE.map(([z, y]) => new THREE.Vector3(0, y, z));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoint(v);
}

function rockColour(y: number, n: number, out: THREE.Color) {
  // bedding: bands of slightly different stone every 25 to 40 cm, broken by the noise
  const band = Math.sin(y * 17 + n * 4) * 0.5 + 0.5, fine = Math.sin(y * 61 + n * 9) * 0.5 + 0.5;
  // a warm grey-brown sandstone, darker and lighter by bed (sRGB values: the vertex colours are linear)
  out.setRGB(0.5 + band * 0.1 + fine * 0.03 + n * 0.05, 0.41 + band * 0.08 + fine * 0.025 + n * 0.04, 0.32 + band * 0.05 + fine * 0.02 + n * 0.03, THREE.SRGBColorSpace);
  return out;
}

/** A weathered block: an icosphere pushed about by noise and cut into layers. */
function block(sx: number, sy: number, sz: number, seed: number) {
  const ico = new THREE.IcosahedronGeometry(1, 4); ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  const g = mergeVertices(ico), p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.3 + seed, v.z * 1.3 + v.y * 0.7 - seed);
    // flatter on top and bottom (bedding), rounded at the corners
    const r = 1 + n * 0.16 + Math.sin(v.y * 7 + seed) * 0.03;
    v.multiplyScalar(r); v.y = Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.8);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

/** Paint vertex colours: banded rock, and soot near `hearth` (world) and under the lip. */
function paint(g: THREE.BufferGeometry, m: THREE.Matrix4, hearth: THREE.Vector3 | null, lipZ: number | null, into: THREE.Vector3 | null) {
  const p = g.attributes.position as THREE.BufferAttribute, col = new Float32Array(p.count * 3), v = new THREE.Vector3(), c = new THREE.Color();
  const loc = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    loc.fromBufferAttribute(p, i); v.copy(loc).applyMatrix4(m);
    rockColour(v.y, fbm(v.x * 0.4, v.z * 0.4), c);
    // lichen-pale on the weather side, high up
    const pale = Math.max(0, fbm(v.x * 0.9 + 4, v.z * 0.9) * 0.5 + 0.1) * THREE.MathUtils.smoothstep(v.y - (hearth?.y ?? 0), 2.6, 4.5);
    c.lerp(new THREE.Color().setRGB(0.62, 0.6, 0.52, THREE.SRGBColorSpace), pale * 0.5);
    if (hearth) {
      // soot: a long-burnt ceiling, heaviest straight over the hearth and pulled out along the roof to the lip
      const d = v.distanceTo(hearth), over = v.y - hearth.y;
      let s = Math.max(0, 1 - d / 2.0) * THREE.MathUtils.smoothstep(over, 1.8, 2.5);
      if (lipZ !== null && into) { const z = loc.z; s = Math.max(s, THREE.MathUtils.smoothstep(over, 1.9, 2.6) * THREE.MathUtils.smoothstep(-z, -0.2, 1.4) * 0.8); }
      s *= 0.75 + 0.25 * fbm(v.x * 3, v.z * 3 + v.y);
      c.lerp(new THREE.Color().setRGB(0.12, 0.1, 0.085, THREE.SRGBColorSpace), Math.min(0.78, s));
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * Build the shelter. `origin` is the middle of the floor, `into` the way into the rock (level), `side` across the
 * opening; `ground(x, z)` the terrain height. `handTex(n)` draws a stencil with n fingers.
 */
export function buildRockShelter(origin: THREE.Vector3, into: THREE.Vector3, side: THREE.Vector3, ground: (x: number, z: number) => number, handTex: (n: number) => THREE.Texture): RockShelter {
  const group = new THREE.Group();
  const basis = new THREE.Matrix4().makeBasis(side.clone().normalize(), new THREE.Vector3(0, 1, 0), into.clone().normalize());
  const toWorld = basis.clone().setPosition(origin);
  // a little warm light of its own: the sunlit ground's bounce into the overhang (the inside was near black on screen)
  // (still near black inside on the GPU take B: more of the bounce, and the soot below kept off the back wall)
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide, emissive: 0x3d2d1e, emissiveIntensity: 0.95 });
  const hearth = origin.clone().addScaledVector(into, 0.15); hearth.y = ground(hearth.x, hearth.z);

  // ---- the wall and roof: one sheet, u across, v bottom to lip
  const NU = 44, NV = 30, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV, P = profile(v), vv = THREE.MathUtils.smoothstep(v, 0.3, 1);
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * 2 - 1, W = 3.0 + vv * 0.25;
      // the sides bow forward and down into the piers; at the lip they do not hang (they read as cloth)
      let x = u * W, z = P.z - 1.7 * u * u * (1 - 0.75 * vv), y = P.y - 1.2 * Math.pow(Math.abs(u), 4) * vv * (1 - THREE.MathUtils.smoothstep(v, 0.55, 0.9));
      // the sides come down to the ground: below it, nothing is seen anyway
      const w = new THREE.Vector3(x, y, z).applyMatrix4(toWorld);
      const n = fbm(w.x * 0.35, w.z * 0.35 + w.y * 0.5);
      // a rough face: big lumps, the bedding's ledges, small grit; pushed along the bowl's own inward direction
      const push = n * 0.28 + Math.sin(y * 17 + n * 4) * 0.035 + N.noise2(w.x * 5, w.y * 5 + w.z) * 0.02;
      const len = Math.hypot(x, y - 1.2, z) || 1;
      x += (x / len) * push; y += ((y - 1.2) / len) * push; z += (z / len) * push;
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const sheetG = new THREE.BufferGeometry();
  sheetG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sheetG.setIndex(idx); sheetG.computeVertexNormals();
  paint(sheetG, toWorld, hearth, 0, into);
  const wall = new THREE.Mesh(sheetG, rock); wall.name = 'shelterWall';
  wall.matrixAutoUpdate = false; wall.matrix.copy(toWorld); wall.receiveShadow = true; wall.castShadow = true;
  group.add(wall);

  // ---- the cliff round it: blocks behind the wall, over the roof (its thickness) and along the lip
  const outer = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, side: THREE.DoubleSide });
  // the cliff: one continuous sculpted face (owner: from the front the stacked beds read as "grey slabs"). A U of rock
  // round the opening: piers either side that come down to the ground, the face over the lip, and the top running back.
  // Its beds are terraces 50 to 75 cm high that wander, each undercut at its foot and rounded over at its top; big
  // lumps and fine grit on top of that. The opening (|x| < 2.9 m, below the lip) is left open for the wall sheet.
  {
    const NS = 96, NH = 64, S0 = 9.5, H0 = -0.7, H1 = 6.4, TOP = 5.0;
    const pos: number[] = [], idx: number[] = [], keep: boolean[] = [];
    const bedOf = (y: number, x: number) => { const k = y / 0.62 + fbm(x * 0.18 + 3, y * 0.1) * 0.8; return k - Math.floor(k); };
    for (let j = 0; j <= NH; j++) {
      const hv = j / NH, h = H0 + (H1 + TOP - H0) * hv;
      for (let i = 0; i <= NS; i++) {
        const sx = (i / NS) * 2 - 1, x0 = sx * S0, ax = Math.abs(x0);
        // the front line: the lip's face across the middle, the piers just outside the opening, curving back further out
        const front = ax < 3.1 ? -1.45 : -1.0 + Math.pow(Math.max(0, ax - 3.1) / 6.4, 1.6) * 3.2;
        let x = x0, y: number, z: number;
        if (h <= H1) {
          y = h;
          // the face leans back as it goes up; a bed's foot is undercut, its top edge rounded over
          const t = bedOf(y, x), lean = Math.max(0, y - 2.4) * 0.14;
          const bed = (1 - t) ** 3 * 0.22 - Math.pow(Math.max(0, t - 0.75) / 0.25, 2) * 0.1;
          z = front + lean + bed;
          // the piers lean in towards the opening at their tops, round the lip
          if (ax >= 2.9 && ax < 4.2 && y < 2.6) x = Math.sign(x0) * (2.9 + (ax - 2.9) * (0.6 + 0.4 * (y / 2.6)));
        } else {
          // over the top and back into the hillside
          const back = h - H1;
          y = H1 + Math.sin(Math.min(1, back / 1.2) * Math.PI / 2) * 0.55 + back * 0.06;
          z = front + (H1 - 2.4) * 0.14 + back * 1.2;
        }
        const w = new THREE.Vector3(x, y, z).applyMatrix4(toWorld);
        const n = fbm(w.x * 0.28 + 11, w.y * 0.32 + w.z * 0.2), m = N.noise2(w.x * 1.7 + w.z, w.y * 2.1) ;
        z += n * 0.45 + m * 0.08 + N.noise2(w.x * 6, w.y * 6 + w.z) * 0.025;
        if (h > H1) y += n * 0.25;
        pos.push(x, y, z);
        keep.push(!(ax < 2.95 && h < 2.42));
      }
    }
    for (let j = 0; j < NH; j++) for (let i = 0; i < NS; i++) {
      const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1;
      if (keep[a] && keep[b] && keep[c] && keep[d]) idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    paint(g, toWorld, hearth, null, null);
    const o = new THREE.Mesh(g, outer); o.name = 'shelterCliff'; o.matrixAutoUpdate = false; o.matrix.copy(toWorld); o.castShadow = true; o.receiveShadow = true;
    group.add(o);
  }
  // a few weathered boulders at the foot
  const blocks: [number, number, number, number, number, number, number][] = [[-5.9, 0.3, -0.6, 1.3, 1.0, 1.4, 1.1], [6.1, 0.2, -0.3, 1.1, 0.9, 1.2, 0.3]];
  blocks.forEach(([x, y, z, sx, sy, sz, turn], k) => {
    const g = block(sx, sy, sz, k * 3.7 + 1);
    const m = new THREE.Matrix4().makeRotationY(turn).setPosition(x, y, z).premultiply(toWorld);
    paint(g, m, hearth, null, null);
    const o = new THREE.Mesh(g, outer); o.matrixAutoUpdate = false; o.matrix.copy(m); o.castShadow = true; o.receiveShadow = true;
    group.add(o);
  });
  // fallen pieces on the floor at the sides
  for (let k = 0; k < 5; k++) {
    const x = (k % 2 ? 1 : -1) * (2.9 + k * 0.3), z = -0.6 + (k * 0.7) % 1.6;
    const w = new THREE.Vector3(x, 0, z).applyMatrix4(toWorld), s = 0.22 + (k % 3) * 0.12;
    const g = block(s * 1.3, s * 0.7, s, 40 + k), m = new THREE.Matrix4().makeRotationY(k * 1.9).setPosition(w.x, ground(w.x, w.z) + s * 0.4, w.z);
    paint(g, m, null, null, null);
    const o = new THREE.Mesh(g, outer); o.matrixAutoUpdate = false; o.matrix.copy(m); o.castShadow = true; o.receiveShadow = true; group.add(o);
  }

  // ---- negative hand stencils on the back wall: found by casting from inside the shelter onto the rock, projected onto it
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), hands: THREE.Vector3[] = [];
  const look = new THREE.Object3D();
  // x across, height, size, fingers: small ones (four fingers drawn, the fifth bent), one his size, high and low
  const spots: [number, number, number, number][] = [[-0.95, 1.25, 0.21, 4], [-0.62, 1.55, 0.19, 4], [-0.35, 1.08, 0.22, 4], [0.05, 1.42, 0.18, 4], [-0.2, 1.75, 0.17, 4], [0.48, 1.22, 0.27, 5]];
  for (const [x, y, size, n] of spots) {
    const from = new THREE.Vector3(x, y, 0).applyMatrix4(toWorld), dir = into.clone().normalize();
    ray.set(from, dir); ray.far = 4;
    const hit = ray.intersectObject(wall, false)[0];
    if (!hit || !hit.face) continue;
    const nrm = hit.face.normal.clone().transformDirection(wall.matrixWorld);
    if (nrm.dot(dir) > 0) nrm.negate(); // the face towards the shelter
    look.position.copy(hit.point); look.lookAt(hit.point.clone().add(nrm)); look.rotateZ((x * 7.3 % 1) * 0.5 - 0.25);
    const dg = new DecalGeometry(wall, hit.point, look.rotation.clone(), new THREE.Vector3(size, size, 0.3));
    const mat = new THREE.MeshStandardMaterial({ map: handTex(n), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.95, opacity: 0.92 });
    const d = new THREE.Mesh(dg, mat); d.name = 'handStencil'; d.receiveShadow = true;
    group.add(d); hands.push(hit.point.clone().addScaledVector(nrm, 0.01));
  }
  return { group, wall, hands, hearth };
}
