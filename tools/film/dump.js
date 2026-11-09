// Runs in the page. Reads one frame of whatever is on stage into plain data: the camera, the lights,
// every mesh's transform, and the final vertices of anything skinned or morphing.
window.__filmDump = (() => {
  const seen = new Set();
  const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  const hex = (c) => (c ? c.getHex() : 0);
  const mat = (m) => {
    const o = { name: m.name || '', type: m.type, film: m.userData?.film ?? null, opacity: m.opacity ?? 1, transparent: !!m.transparent };
    if (m.color) o.color = hex(m.color);
    if (m.emissive) { o.emissive = hex(m.emissive); o.emissiveIntensity = m.emissiveIntensity ?? 1; }
    if (m.roughness !== undefined) o.roughness = m.roughness;
    if (m.metalness !== undefined) o.metalness = m.metalness;
    if (m.uniforms?.uColor?.value?.getHex) o.uColor = m.uniforms.uColor.value.getHex();
    return o;
  };
  const geom = (x) => {
    const g = x.geometry, p = g.attributes.position, o = { n: p.count, pos: b64(new Float32Array(p.array.slice(0, p.count * 3))) };
    // quantised glTF attributes are copied through the accessor so the numbers come out true
    if (!(p.array instanceof Float32Array)) { const f = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { f[i * 3] = p.getX(i); f[i * 3 + 1] = p.getY(i); f[i * 3 + 2] = p.getZ(i); } o.pos = b64(f); }
    if (g.index) o.idx = b64(new Uint32Array(g.index.array));
    const uv = g.attributes.uv;
    if (uv) { const f = new Float32Array(uv.count * 2); for (let i = 0; i < uv.count; i++) { f[i * 2] = uv.getX(i); f[i * 2 + 1] = uv.getY(i); } o.uv = b64(f); }
    for (const a of ['aT', 'aLayer', 'aDens']) { const v = g.attributes[a]; if (v) { const f = new Float32Array(v.count); for (let i = 0; i < v.count; i++) f[i] = v.getX(i); o[a] = b64(f); } }
    return o;
  };
  const BONES = new Set(['hips', 'spine1', 'chest', 'neck', 'handL', 'handR', 'finger3_2L', 'finger3_2R', 'lowerarmL', 'lowerarmR', 'upperarmL', 'upperarmR']);
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  return () => {
    const st = __bs.stageInfo(), scene = st.scene, cam = st.camera;
    scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
    const out = { bones: {}, beat: __bs.film.beat, camera: { m: Array.from(cam.matrixWorld.elements), fov: cam.fov, focus: st.focus, aperture: st.aperture }, lights: [], meshes: [], fresh: {} };
    if (window.__hole) out.hole = { on: 1, p: window.__hole, warp: 0 };
    const v = cam.position.clone();
    scene.traverse((o) => {
      const un = o.material?.uniforms;
      if (un?.uBHPos) { const q = un.uBHPos.value; out.hole = { on: un.uBH?.value ?? 0, p: [q.x, q.y, q.z], warp: un.uWarp?.value ?? 0 }; return; }
      if (!shown(o)) return;
      if (o.isLight) { o.getWorldPosition(v); out.lights.push({ type: o.type, color: hex(o.color), i: o.intensity, d: o.distance ?? 0, p: [v.x, v.y, v.z] }); return; }
      if (o.isPoints) { out.meshes.push({ id: o.uuid, points: true, name: o.name }); return; }
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const rec = { id: o.uuid, m: Array.from(o.matrixWorld.elements) };
      // the skeleton too, for the clipping check: the torso line and the hands
      if (o.isSkinnedMesh) {
        const sk = o.skeleton.bones[0].uuid; rec.skel = sk; // one id per character: every part shares its root bone
        if (!out.bones[sk]) { out.bones[sk] = {}; for (const b of o.skeleton.bones) if (BONES.has(b.name)) { b.getWorldPosition(v); out.bones[sk][b.name] = [v.x, v.y, v.z]; } }
      }
      if (!seen.has(o.uuid)) { seen.add(o.uuid); out.fresh[o.uuid] = { name: o.name, parent: o.parent?.name ?? '', material: mat(m), geo: geom(o), skinned: !!o.isSkinnedMesh, instanced: !!o.isInstancedMesh }; }
      if (o.isInstancedMesh) rec.inst = b64(new Float32Array(o.instanceMatrix.array.slice(0, o.count * 16)));
      const moving = o.isSkinnedMesh || (o.morphTargetInfluences && o.morphTargetInfluences.some((x) => x !== 0)) || o.geometry.attributes.position.usage === 35048;
      if (moving) {
        const n = o.geometry.attributes.position.count, f = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); f[i * 3] = v.x; f[i * 3 + 1] = v.y; f[i * 3 + 2] = v.z; }
        rec.baked = b64(f);
      }
      out.meshes.push(rec);
    });
    return out;
  };
})();
