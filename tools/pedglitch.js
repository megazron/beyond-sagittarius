// pedglitch.js: a pedestrian-glitch detector for the city (Zenvora), run in the page every frame. Injected before the
// page loads (gpu_tour.py plan "inject": "pedglitch.js"); a plan then calls __ped.start(), walks routes with
// __ped.walk([[x, z], ...]) and reads __ped.report(). It reads __bs.awayPeds() (city.ts pedProbe: everyone drawn this
// frame, as a body or a card, with their look) after the frame is drawn, projects each with the game's camera and counts
// what a player could see go wrong:
//   vanish / appear     drawn one frame and not the next (or the other way) while in view within 25 m
//   vanishFar / appearFar   the same in view from 25 m to where the cards start to thin out
//   swap                a body turned into a card or a card into a body, in view within 25 m (screen height logged)
//   identity            the same walker wearing another look from one frame to the next, in view
//   lod                 a body's build or hair switching, in view within 25 m
//   teleport            moved more than 0.5 m in a frame, in view
//   road                standing or walking in a road lane (not crossing) with a car within 12 m, in view within 40 m
//   carHit              inside a car's footprint, in view within 40 m
//   overlap             two walkers closer than 0.45 m, in view within 25 m
//   slide               a body moving sideways (more than 0.6 m/s across the way it faces) for a quarter second, in view within 25 m
//   cardClose           someone drawn as a flat card in view within 12 m (not a change, but what reads as cardboard)
// and the most walkers in view within 27 m at once (near27), what a body budget has to cover.
// Conditions that last (road, carHit, overlap, slide) count once when they start (and again only after 0.5 s clear).
(() => {
  // samples kept per type (was 40: the Web overlaps of a 7-minute walk ran to 170 and only the first 40 could be read)
  const CAP = 400;
  const TYPES = ['vanish', 'appear', 'vanishFar', 'appearFar', 'swap', 'identity', 'lod', 'teleport', 'road', 'carHit', 'overlap', 'slide', 'cardClose'];
  const S = { on: false, counts: {}, samples: {}, frames: 0, prev: new Map(), hold: new Map(), lastOn: new Map(), quiet: 0, t0: 0, walk: null, stuck: 0, fpsN: 0, fpsT: 0, worst: 0, last: 0, maxPeds: 0, zone: '', enter: new Map(), camH: [] };
  const reset = () => { for (const k of TYPES) { S.counts[k] = 0; S.samples[k] = []; } S.byZone = {}; S.frames = 0; S.near27 = 0; S.maxBodies = 0; S.maxCalls = 0; S.maxTris = 0; S.prev.clear(); S.hold.clear(); S.lastOn.clear(); S.enter.clear(); };
  reset();
  const ev = (type, o) => {
    S.counts[type]++;
    const z = S.zone || '?'; const zb = S.byZone[z] || (S.byZone[z] = {}); zb[type] = (zb[type] || 0) + 1;
    if (S.samples[type].length < CAP) S.samples[type].push({ t: +((performance.now() - S.t0) / 1000).toFixed(2), zone: z, ...o });
  };
  const onset = (key, type, cond, o, needFrames = 1) => {
    // a lasting condition counts once when it has held needFrames frames, and again only after 0.5 s without it
    const now = performance.now(); let h = S.hold.get(key) || 0;
    if (cond) { h++; S.hold.set(key, h); if (h === needFrames && now - (S.lastOn.get(key) || -1e9) > 500) ev(type, o); if (h >= needFrames) S.lastOn.set(key, now); }
    else if (h) S.hold.set(key, 0);
  };
  const proj = (m, x, y, z) => { const e = m; const w = e[3] * x + e[7] * y + e[11] * z + e[15]; return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, w]; };
  const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    if (S.last) { const dt = now - S.last; S.worst = Math.max(S.worst, dt); S.fpsN++; S.fpsT += dt; }
    S.last = now;
    if (S.walk) steer();
    if (!S.on || !window.__bs) return;
    if (S.quiet > now) { S.prev.clear(); return; }
    const st = __bs.awayPeds && __bs.awayPeds(); const info = __bs.rnd && __bs.rnd.stageInfo && __bs.rnd.stageInfo();
    if (!st || !info || !info.camera) { S.prev.clear(); return; }
    const cam = info.camera; cam.updateMatrixWorld(); const VP = mul(cam.projectionMatrix.elements, cam.matrixWorldInverse.elements);
    const cx = cam.matrixWorld.elements[12], cz = cam.matrixWorld.elements[14];
    const H = (__bs.gl && __bs.gl.domElement.clientHeight) || 390;
    const inView = (x, y, z) => { for (const yy of [y + 0.1, y + 1.0, y + 1.7]) { const p = proj(VP, x, y + (yy - y), z); if (p[2] > 0.05 && Math.abs(p[0]) < 1.02 && Math.abs(p[1]) < 1.02) return true; } return false; };
    const px = (x, y, z) => { const a = proj(VP, x, y, z), b = proj(VP, x, y + 1.7, z); return a[2] > 0 && b[2] > 0 ? Math.round(Math.abs(b[1] - a[1]) / 2 * H) : 0; };
    // the drawn camera for the last few frames (with each teleport: what jumped), [t, x, y, z, forward x, forward z, you x, z]
    { const e = cam.matrixWorld.elements, ac = __bs.awayCam || {}; S.camH.push([+((now - S.t0) / 1000).toFixed(3), +cx.toFixed(2), +e[13].toFixed(2), +cz.toFixed(2), +(-e[8]).toFixed(3), +(-e[10]).toFixed(3), +(ac.x ?? 0).toFixed(2), +(ac.z ?? 0).toFixed(2)]); if (S.camH.length > 6) S.camH.shift(); }
    const thin = st.far * 0.83, cur = new Map(), dtS = S.prevT ? Math.max(1e-3, (now - S.prevT) / 1000) : 1 / 60; S.prevT = now;
    for (const r of st.peds) {
      const [id, rep, look, x, y, z, yaw, lod] = r; const d = Math.hypot(x - cx, z - cz);
      cur.set(id, { rep, look, x, y, z, yaw, lod, d, v: inView(x, y, z) });
    }
    S.maxPeds = Math.max(S.maxPeds, cur.size);
    const pf = __bs.perf; if (pf) { S.maxBodies = Math.max(S.maxBodies || 0, pf.bodies || 0); S.maxCalls = Math.max(S.maxCalls || 0, pf.calls || 0); S.maxTris = Math.max(S.maxTris || 0, pf.tris || 0); }
    const P = S.prev; S.frames++;
    if (P.size) {
      for (const [id, a] of P) if (!cur.has(id) && a.v && a.d < thin) ev(a.d < 25 ? 'vanish' : 'vanishFar', { id, rep: a.rep, d: +a.d.toFixed(1), px: px(a.x, a.y, a.z), at: [+a.x.toFixed(1), +a.z.toFixed(1)] });
      for (const [id, b] of cur) {
        const a = P.get(id);
        if (!a) { if (b.v && b.d < thin) ev(b.d < 25 ? 'appear' : 'appearFar', { id, rep: b.rep, d: +b.d.toFixed(1), px: px(b.x, b.y, b.z), at: [+b.x.toFixed(1), +b.z.toFixed(1)] }); continue; }
        const vis = a.v || b.v;
        if (vis && a.rep !== b.rep && b.d < 25) ev('swap', { id, from: a.rep, to: b.rep, d: +b.d.toFixed(1), px: px(b.x, b.y, b.z), look: [a.look, b.look] });
        if (vis && a.look !== b.look) ev('identity', { id, from: a.look, to: b.look, rep: [a.rep, b.rep], d: +b.d.toFixed(1), px: px(b.x, b.y, b.z) });
        if (vis && a.rep === 'b' && b.rep === 'b' && a.lod !== b.lod && b.d < 25) ev('lod', { id, from: a.lod, to: b.lod, d: +b.d.toFixed(1), px: px(b.x, b.y, b.z) });
        const mv = Math.hypot(b.x - a.x, b.z - a.z);
        if (vis && mv > 0.5) ev('teleport', { id, m: +mv.toFixed(2), rep: [a.rep, b.rep], d: +b.d.toFixed(1), from: [+a.x.toFixed(1), +a.z.toFixed(1)], to: [+b.x.toFixed(1), +b.z.toFixed(1)], cams: S.camH.slice(), view: st.diag ? st.diag.view : null, cut: st.diag ? st.diag.cut : null });
        if (b.rep === 'b' && b.v && b.d < 25 && mv < 0.5) {
          // sideways speed against the way the body faces (three's yaw: facing +z at 0, +x at pi/2)
          const vx = (b.x - a.x) / dtS, vz = (b.z - a.z) / dtS, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), side = Math.abs(vx * fz - vz * fx);
          onset(id + ':slide', 'slide', side > 0.6, { id, side: +side.toFixed(2), d: +b.d.toFixed(1) }, 15);
        }
      }
    }
    // roads, cars, overlaps (in view only)
    const near = []; let n27 = 0;
    for (const [id, b] of cur) {
      if (!b.v || b.d >= 27) S.enter.delete(id);
      if (!b.v || b.d > 40) continue;
      if (b.d < 25) near.push([id, b]);
      if (b.d < 27) n27++;
      // how they came within 27 m in view: at what distance and drawn as what (a card that came in at 27 m was missed by
      // the body budget; one first seen nearer came into the view by a turn of the camera)
      if (b.d < 27 && !S.enter.has(id)) S.enter.set(id, [+b.d.toFixed(1), b.rep]);
      onset(id + ':card', 'cardClose', b.rep === 'c' && b.d < 12, { id, d: +b.d.toFixed(1), look: b.look, why: st.diag || null, entered: S.enter.get(id) || null });
      let carNear = false, hit = false;
      for (const c of st.cars) {
        const dx = b.x - c[0], dz = b.z - c[1], dd = Math.hypot(dx, dz); if (dd < 12) carNear = true;
        const fx = Math.sin(c[2]), fz = Math.cos(c[2]), along = dx * fx + dz * fz, across = dx * fz - dz * fx;
        if (Math.abs(along) < 2.3 && Math.abs(across) < 1.0) hit = true;
      }
      onset(id + ':car', 'carHit', hit, { id, rep: b.rep, d: +b.d.toFixed(1), at: [+b.x.toFixed(1), +b.z.toFixed(1)] });
      // a road lane: the road surface is below the pavement (y under 0.07 where the paving is 0.14)
      onset(id + ':road', 'road', carNear && b.y < 0.07 && b.y > -0.1 /* lower is someone sitting */ && !(st.crossing || []).includes(id), { id, rep: b.rep, d: +b.d.toFixed(1), at: [+b.x.toFixed(1), +b.z.toFixed(1)], y: +b.y.toFixed(2) });
    }
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const [ia, a] = near[i], [ib, b] = near[j];
      // how each moved since the last frame (m/s along z, across x): head-on, catching up, or one standing
      const pa = P.get(ia), pb = P.get(ib), vz = (q, p) => (p ? +((q.z - p.z) / dtS).toFixed(2) : null), vx = (q, p) => (p ? +((q.x - p.x) / dtS).toFixed(2) : null);
      onset(ia + '|' + ib, 'overlap', Math.hypot(a.x - b.x, a.z - b.z) < 0.45, { ids: [ia, ib], reps: [a.rep, b.rep], d: +a.d.toFixed(1), at: [+a.x.toFixed(1), +a.z.toFixed(1)], vz: [vz(a, pa), vz(b, pb)], vx: [vx(a, pa), vx(b, pb)] });
    }
    S.near27 = Math.max(S.near27 || 0, n27);
    S.prev = cur;
  }
  requestAnimationFrame(tick);
  // the walk: hold W and turn towards each waypoint in turn; stuck for 6 s, the next one is a teleport (detection paused)
  function steer() {
    const w = S.walk, p = __bs.awayCam; if (!p) return;
    const now = performance.now();
    if (!w.pts.length) { __bs.key('KeyW', false); S.walk = null; return; }
    const [x, z] = w.pts[0];
    if (Math.hypot(x - p.x, z - p.z) < 1.2) { w.pts.shift(); w.since = now; w.best = 1e9; return; }
    const dd = Math.hypot(x - p.x, z - p.z); if (dd < w.best - 1) { w.best = dd; w.since = now; }
    if (now - w.since > 6000) { S.stuck++; __ped.pause(1.2); __bs.awayTeleport(x, z, p.yaw); w.pts.shift(); w.since = now; w.best = 1e9; return; }
    __bs.key('KeyW', true);
    const want = Math.atan2(-(x - p.x), -(z - p.z)); let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); __bs.awayYaw(p.yaw + d * 0.12);
  }
  window.__ped = {
    start() { reset(); S.on = true; S.t0 = performance.now(); S.worst = 0; S.fpsN = 0; S.fpsT = 0; return true; },
    stop() { S.on = false; return true; },
    zone(n) { S.zone = n; return n; },
    pause(sec) { S.quiet = performance.now() + sec * 1000; S.prev.clear(); return true; },
    /** Teleport there (detection paused for a second), then walk the waypoints. */
    go(x, z, yaw, pts, zone) { if (zone) S.zone = zone; __ped.pause(1.5); __bs.awayTeleport(x, z, yaw || 0); S.walk = { pts: pts.map((q) => q.slice()), since: performance.now() + 1500, best: 1e9 }; return true; },
    get walking() { return !!S.walk; },
    report() { return { frames: S.frames, secs: +((performance.now() - S.t0) / 1000).toFixed(1), fps: S.fpsT ? +(S.fpsN * 1000 / S.fpsT).toFixed(1) : 0, worstMs: Math.round(S.worst), maxPeds: S.maxPeds, near27: S.near27 || 0, maxBodies: S.maxBodies || 0, maxCalls: S.maxCalls || 0, maxTris: S.maxTris || 0, stuck: S.stuck, counts: { ...S.counts }, byZone: S.byZone, samples: S.samples }; },
  };
})();
