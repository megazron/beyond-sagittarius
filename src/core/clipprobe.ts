import * as THREE from 'three';

/** Test: bodies passing through the set, and bodies through each other, in whatever scene is being drawn (the deck,
 *  the pull, the landing sets, the wake-up, the Vault). Every character's head, chest, hips, hands and feet are probed
 *  with six short rays: a hit closer than the part's own radius means a surface goes through it; the first surface
 *  along a ray seen from behind (on a single-sided material) means the part is inside a solid. Two characters' parts
 *  closer than their radii added are counted too. Held props are part of the character and do not count. */
export type ClipHit = { who: string; part: string; what: string; depth: number; kind: 'through' | 'inside' | 'body' };

const PARTS: [RegExp, string, number][] = [
  [/^head$/i, 'head', 0.09], [/^(chest|spine2|upperchest)$/i, 'chest', 0.12], [/^(hips|pelvis)$/i, 'hips', 0.11],
  [/^handL$/i, 'handL', 0.035], [/^handR$/i, 'handR', 0.035], [/^footL$/i, 'footL', 0.04], [/^footR$/i, 'footR', 0.04],
  [/^lowerarmL$/i, 'elbowL', 0.04], [/^lowerarmR$/i, 'elbowR', 0.04], [/^lowerlegL$/i, 'kneeL', 0.05], [/^lowerlegR$/i, 'kneeR', 0.05],
];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((d) => new THREE.Vector3(...d));

const ghost = (o: THREE.Object3D) => {
  const m = o as THREE.Mesh, mt = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
  if (!mt) return true;
  return (mt.transparent && (!mt.depthWrite || mt.blending === THREE.AdditiveBlending || mt.opacity < 0.5)) || !mt.visible || mt.colorWrite === false;
};
const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
const label = (o: THREE.Object3D) => { const c: string[] = []; for (let q: THREE.Object3D | null = o; q && c.length < 4; q = q.parent) c.push(q.name || q.type); return c.join(' < '); };
const nameOf = (r: THREE.Object3D) => (r.userData.id as string | undefined) ?? (r.userData.crewId as string | undefined) ?? r.name ?? 'character';

export function clipProbe(scene: THREE.Scene, names?: (root: THREE.Object3D) => string): ClipHit[] {
  scene.updateMatrixWorld(true);
  const chars: THREE.Object3D[] = [];
  scene.traverse((o) => { if (o.userData.isCharacter && shown(o)) chars.push(o); });
  const inChar = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.isCharacter) return true; return false; };
  const targets: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || !shown(o) || inChar(o) || ghost(o)) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    // the sky, the far ground disc and other things hundreds of metres wide are probed only where they are flat ground
    const r = m.geometry.boundingSphere!.radius * o.getWorldScale(new THREE.Vector3()).x;
    if (r > 400 && !(m as THREE.InstancedMesh).isInstancedMesh && !o.userData.ground) return;
    targets.push(o);
  });
  const out: ClipHit[] = [];
  const rc = new THREE.Raycaster(), p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const pts: { who: string; part: string; r: number; p: THREE.Vector3; root: THREE.Object3D }[] = [];
  for (const root of chars) {
    const who = names?.(root) ?? nameOf(root);
    const seen = new Set<string>();
    root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const def = PARTS.find(([re]) => re.test(o.name)); if (!def || seen.has(def[1])) return;
      seen.add(def[1]); pts.push({ who, part: def[1], r: def[2], p: o.getWorldPosition(new THREE.Vector3()), root });
    });
  }
  for (const q of pts) {
    let worst: ClipHit | null = null;
    for (const d of DIRS) {
      rc.set(p.copy(q.p), d); rc.near = 0; rc.far = 3;
      const h = rc.intersectObjects(targets, false)[0];
      if (!h || !h.face) continue;
      const mt = (h.object as THREE.Mesh).material as THREE.Material;
      nm.getNormalMatrix(h.object.matrixWorld); n.copy(h.face.normal).applyMatrix3(nm).normalize();
      const back = n.dot(d) > 0.05 && mt.side === THREE.FrontSide;
      // a foot standing on a floor touches it: only count it if it is below the floor
      const foot = q.part.startsWith('foot') && d.y < 0;
      const depth = back ? q.r + h.distance : q.r - h.distance;
      if (back && h.distance < 0.6) { if (!worst || depth > worst.depth) worst = { who: q.who, part: q.part, what: label(h.object), depth, kind: 'inside' }; }
      else if (!back && h.distance < q.r * (foot ? 0.4 : 1)) { if (!worst || depth > worst.depth) worst = { who: q.who, part: q.part, what: label(h.object), depth, kind: 'through' }; }
    }
    if (worst) out.push({ ...worst, depth: Math.round(worst.depth * 100) / 100 });
  }
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j]; if (a.root === b.root) continue;
    const d = a.p.distanceTo(b.p), lim = a.r + b.r;
    if (d < lim) out.push({ who: `${a.who}.${a.part}`, part: b.part, what: b.who, depth: Math.round((lim - d) * 100) / 100, kind: 'body' });
  }
  return out;
}
