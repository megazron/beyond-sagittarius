import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Zenvora's own saloon (an original design: a long bonnet, a glass cabin on pillars, a short boot, four wheels in
 * arches, lamps front and back), for every street of the city. Three geometries, to be drawn instanced: the body (paint
 * by instance colour; tyres, arches, bumpers and trim dark by vertex colour), the glass, the lamps. The nose points +z,
 * the wheels stand on y = 0.
 */
let kit: ReturnType<typeof build> | null = null;
export function carKit() { return (kit ??= build()); }

function build() {
  const paint = (g: THREE.BufferGeometry, c: number) => { const n = g.attributes.position.count, a = new Float32Array(n * 3), k = new THREE.Color(c); for (let i = 0; i < n; i++) { a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const prep = (g: THREE.BufferGeometry, c: number) => { const q = g.index ? g.toNonIndexed() : g; q.deleteAttribute('uv'); return paint(q, c); };
  const side = (pts: [number, number][], w: number, bevel = 0.05) => {
    const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(w - bevel * 2) / 2); g.rotateY(-Math.PI / 2); // the profile's +x is the nose: towards +z
    return g;
  };
  const WHITE = 0xffffff, TRIM = 0x0c0d10;
  const bodyParts: THREE.BufferGeometry[] = [
    // the lower body: bumper to bumper, a waist line at 1.0 m
    prep(side([[-2.28, 0.34], [-2.34, 0.62], [-2.22, 0.98], [-1.2, 1.02], [1.05, 1.0], [2.05, 0.9], [2.32, 0.72], [2.3, 0.34]], 1.84, 0.07), WHITE),
    // the roof, on four pillars a side
    prep(new THREE.BoxGeometry(1.42, 0.06, 1.42).translate(0, 1.47, -0.3), WHITE),
    ...[-1, 1].flatMap((sx) => [
      prep(new THREE.BoxGeometry(0.07, 0.52, 0.09).rotateX(0.62).translate(sx * 0.73, 1.23, 0.72), WHITE),   // A pillar, raked with the windscreen
      prep(new THREE.BoxGeometry(0.07, 0.46, 0.1).translate(sx * 0.75, 1.24, -0.2), TRIM),                    // B
      prep(new THREE.BoxGeometry(0.07, 0.5, 0.14).rotateX(-0.5).translate(sx * 0.73, 1.23, -1.12), WHITE),   // C, raked with the rear glass
      // arches, sills and mirrors
      prep(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(sx * 0.9, 0.36, 1.38), TRIM),
      prep(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(sx * 0.9, 0.36, -1.36), TRIM),
      prep(new THREE.BoxGeometry(0.06, 0.1, 1.9).translate(sx * 0.93, 0.36, 0), TRIM),
      prep(new THREE.BoxGeometry(0.2, 0.1, 0.12).translate(sx * 1.0, 1.06, 0.78), WHITE),
      // the wheels: tyre and a bright hub
      prep(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16).rotateZ(Math.PI / 2).translate(sx * 0.82, 0.34, 1.38), 0x08080a),
      prep(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16).rotateZ(Math.PI / 2).translate(sx * 0.82, 0.34, -1.36), 0x08080a),
      prep(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10).rotateZ(Math.PI / 2).translate(sx * 0.82, 0.34, 1.38), 0x9a9da2),
      prep(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10).rotateZ(Math.PI / 2).translate(sx * 0.82, 0.34, -1.36), 0x9a9da2),
    ]),
    // bumpers, the grille and the number plates
    prep(new THREE.BoxGeometry(1.8, 0.16, 0.1).translate(0, 0.44, 2.3), TRIM), prep(new THREE.BoxGeometry(1.8, 0.16, 0.1).translate(0, 0.46, -2.31), TRIM),
    prep(new THREE.BoxGeometry(0.9, 0.14, 0.05).translate(0, 0.68, 2.31), TRIM),
    prep(new THREE.BoxGeometry(0.5, 0.13, 0.03).translate(0, 0.56, -2.35), 0xd8d4c4),
  ];
  const bodyG = mergeGeometries(bodyParts)!;
  // the cabin's glass: the windscreen, the rear screen and the side windows as one dark solid under the roof
  const glassG = side([[-1.42, 1.0], [-1.0, 1.44], [0.42, 1.44], [1.02, 1.0]], 1.5, 0);
  const lightG = mergeGeometries([
    ...[-0.62, 0.62].map((x) => new THREE.BoxGeometry(0.42, 0.13, 0.06).translate(x, 0.78, 2.3)),
    ...[-0.64, 0.64].map((x) => new THREE.BoxGeometry(0.44, 0.1, 0.06).translate(x, 0.86, -2.3)),
    new THREE.BoxGeometry(1.2, 0.03, 0.04).translate(0, 0.92, -2.3),
  ].map((g) => g.toNonIndexed()))!;
  { const n = lightG.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const z = lightG.attributes.position.getZ(i); a.set(z > 0 ? [3.2, 3.0, 2.6] : [3.0, 0.12, 0.08], i * 3); } lightG.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  const carBodyM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.55 });
  const carGlassM = new THREE.MeshStandardMaterial({ color: 0x0a1016, roughness: 0.04, metalness: 0.92 });
  const carLightM = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  return { bodyG, glassG, lightG, carBodyM, carGlassM, carLightM };
}
