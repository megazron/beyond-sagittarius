// A stand-in player for recordings: it plays the fight through the game's own controls (keys, mouse buttons, mouse
// look), never by reaching into the simulation to change it. tools/gpu_capture.py evals this file, then calls
// __cbBot('<mode>'). Modes: melee, ranged, guardian, hunt, night, chase, stealth, tour. __cbStop = true ends it.
window.__cbBot = (mode) => {
  const C = __bs.combat, held = {};
  window.__cbStop = false;
  const hold = (k, on) => { if (!!held[k] !== !!on) { held[k] = !!on; C.testHold(k, !!on); } };
  const tap = (k) => C.testTap(k);
  // E goes through the game's own interact, which reads real key presses
  const tapE = () => { key('KeyE'); setTimeout(() => keyUp('KeyE'), 70); };
  const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const keyUp = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  const SENS = 0.0024 * (__bs.sens || 1);
  // turn the view towards a point, like a hand on a mouse: fast when far off, gentle when close
  const look = (x, z, y) => {
    const c = C.cam, want = Math.atan2(-(x - c.x), -(z - c.z)), d = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
    const dist = Math.hypot(x - c.x, z - c.z), wp = y === undefined ? -0.14 : Math.atan2(y - (c.y + 1.55), dist) - 0.02;
    const k = Math.abs(d) > 0.5 ? 0.22 : 0.3;
    C.testLook(Math.max(-70, Math.min(70, (-d / SENS) * k)), Math.max(-30, Math.min(30, ((c.pitch - wp) / SENS) * 0.2)));
    return Math.abs(d);
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const go = (x, z, o = {}) => { const off = look(x, z); hold('KeyW', off < 0.6); hold('ShiftLeft', !!o.sprint && off < 0.6); return dist(C.cam, { x, z }); };
  const stop = () => { hold('KeyW', 0); hold('ShiftLeft', 0); hold('KeyA', 0); hold('KeyD', 0); hold('KeyS', 0); };
  let t0 = performance.now(), st = 0, stT = 0, flag = {};
  const next = (n) => { st = n === undefined ? st + 1 : n; stT = performance.now(); };
  const since = () => (performance.now() - stT) / 1000;
  const equip = (w) => { const p = C.activeSim.player; if (p.weapon !== w && p.act === 'idle' && since() > 0.35) { tap('KeyR'); stT = performance.now(); } return p.weapon === w; };
  const tension = () => {
    const cur = C.tensionUi && C.tensionUi.cur; if (!cur || cur.T.result) return false;
    const T = cur.T, k = T.spec.kind;
    if (performance.now() - (flag.tOpen || (flag.tOpen = performance.now())) < 320) return true;
    if (k === 'quick') { if (T.ring <= (T.win[0] + T.win[1]) / 2 + 0.02 && !flag.pressed) { flag.pressed = 1; key('Space'); setTimeout(() => { keyUp('Space'); flag.pressed = 0; }, 80); } }
    else if (k === 'breath') { if (Math.abs(T.beat - 1) < 0.045 && !flag.pressed) { flag.pressed = 1; key('Space'); setTimeout(() => { keyUp('Space'); flag.pressed = 0; }, 160); } }
    else if (k === 'steady') { const d = T.band - T.marker; if (d > 0.05) { key('KeyD'); keyUp('KeyA'); } else if (d < -0.05) { key('KeyA'); keyUp('KeyD'); } else { keyUp('KeyA'); keyUp('KeyD'); } }
    return true;
  };
  const living = (kind) => C.activeSim.enemies.filter((e) => !e.dead && !e.gone && (!kind || e.kind === kind));
  const nearest = (list) => { const p = C.activeSim.player; return list.slice().sort((a, b) => dist(a, p) - dist(b, p))[0]; };
  const danger = () => { const p = C.activeSim.player; return C.activeSim.enemies.find((e) => !e.dead && e.target === -1 && (e.state === 'strike' || (e.state === 'windup' && e.stateT > e.warned - 0.25)) && dist(e, p) < (e.kind === 'mossback' ? 7 : e.kind === 'guardian' ? 30 : 4)); };
  const fight = (targets, o = {}) => {
    const sim = C.activeSim, p = sim.player, t = nearest(targets);
    if (!t) { stop(); hold('KeyQ', 0); return; }
    const d = dist(t, p), dg = danger();
    look(t.x, t.z, t.y + t.def.height * 0.5);
    if (dg && o.roll && p.act !== 'roll' && p.stamina > 20) { hold('KeyQ', 0); hold('KeyA', 1); tap('KeyV'); setTimeout(() => hold('KeyA', 0), 500); return; }
    hold('KeyQ', !!dg && !o.roll && p.stamina > 8);
    if (dg && !o.roll) { stop(); return; }
    const reach = (sim.player.weapon === 'spear' ? 2.3 : 1.4) + t.def.radius;
    hold('KeyW', d > reach); hold('ShiftLeft', 0);
    if (d <= reach + 0.3 && (p.act === 'idle' || p.act === 'recover') && p.stamina > 14) tap('Mouse0');
  };
  const shoot = (t, o = {}) => {
    const p = C.activeSim.player;
    hold('Mouse2', 1);
    const off = look(t.x + t.vx * 0.25, t.z + t.vz * 0.25, t.y + t.def.height * 0.55 + dist(t, p) * (o.loft || 0.012));
    if (p.act === 'charge') { if (p.charge >= 1 && off < 0.05) hold('Mouse0', 0); }
    else if (p.act === 'idle' && off < 0.12) hold('Mouse0', 1);
  };
  const tick = () => {
    if (window.__cbStop) { for (const k in held) hold(k, false); return; }
    requestAnimationFrame(tick);
    const sim = C.activeSim, run = C.run; if (!sim || __bs.paused) return;
    if (tension()) { stop(); return; } flag.tOpen = 0;
    const p = sim.player, T = (performance.now() - t0) / 1000;
    if (mode === 'melee') {
      // the spear against a pack of Skritch, then the club against a Duskhound; the roll and the guard are both shown
      if (st === 0) { if (equip('spear')) { run.summon('skritch', 4); next(); } }
      else if (st === 1) { fight(living('skritch'), { roll: Math.floor(T / 6) % 2 === 1 }); if ((!living('skritch').length && since() > 2) || since() > 24) next(); }
      else if (st === 2) { if (equip('club')) { run.summon('hound', 1); next(); } }
      else if (st === 3) fight(living('hound').length ? living('hound') : living('skritch'), { roll: true });
    } else if (mode === 'ranged') {
      if (st === 0) { if (equip('sling')) { run.summon('skritch', 3); next(); } }
      else if (st === 1) { const t = nearest(living('skritch')); if (t && since() < 22) shoot(t, { loft: 0.02 }); else { hold('Mouse2', 0); hold('Mouse0', 0); next(); } }
      else if (st === 2) { if (equip('bow')) { run.summon('nibbet', 3); next(); } }
      else if (st === 3) { const t = nearest(living('nibbet')); if (t) shoot(t); else { hold('Mouse2', 0); hold('Mouse0', 0); } }
    } else if (mode === 'guardian') {
      const g = living('guardian')[0];
      if (st === 0) { if (equip('coil')) next(); }
      else if (st === 1) { if (!g) return; const d = go(g.x, g.z); if (d < 9 || g.state !== 'dormant') { stop(); next(); } }
      else if (g) {
        const dg = danger(), d = dist(g, p);
        hold('Mouse2', 1); look(g.x, g.z, g.y + 1.9);
        hold('KeyA', 1); hold('KeyW', d > 15); hold('KeyS', d < 9);
        if (dg && p.act !== 'roll' && p.stamina > 20) tap('KeyV');
        hold('Mouse0', !dg);
      } else { stop(); hold('Mouse0', 0); hold('Mouse2', 0); }
    } else if (mode === 'hunt') {
      const prey = nearest(living('nibbet').filter((e) => !e.routed));
      if (run.phase === 'respect') { const m = run.markers[0]; if (p.sneaking && !flag.up) { flag.up = 1; tap('KeyX'); } const d = go(m.x, m.z); if (d < 1.1) stop(); return; }
      if (st === 0) { tap('KeyX'); next(); }
      else if (!p.has.spear) { const k = sim.pickups.find((q) => q.weapon === 'spear'); if (k) go(k.x, k.z); }
      else if (prey) {
        const d = dist(prey, p);
        // a patient hunter: creep in to about ten metres, wait for it to settle, lead it a little, one full throw
        const lead = 0.35, lx = prey.x + prey.vx * lead, lz = prey.z + prey.vz * lead, loft = prey.y + 0.25 + d * 0.035;
        if (p.act === 'charge') { stop(); look(lx, lz, loft); if (p.charge >= 1 && prey.state !== 'flee') hold('KeyG', 0); }
        else if (d > 10.5) { if (prey.state === 'flee' || prey.alert > 0.5) stop(); else go(prey.x, prey.z); }
        else { stop(); const off = look(lx, lz, loft); if (off < 0.05 && p.act === 'idle' && prey.state !== 'flee' && Math.hypot(prey.vx, prey.vz) < 0.8) hold('KeyG', 1); }
      }
    } else if (mode === 'night') {
      const fire = sim.fires.find((f) => !f.torch && !f.burnsOut), food = run.markers.find((m) => m.kind === 'food');
      const wx = sim.windX, wz = sim.windZ, bait = { x: food.x + wx * 8, z: food.z + wz * 8 };
      if (run.phase === 'prep') {
        // read the smoke: they will come up the wind. Stakes on the line in, bait out downwind, a snare on the bait.
        // Each one is set facing downwind: the last two metres are walked along the wind, so the body faces that way.
        const plan = [{ k: 'Digit2', x: food.x + wx * 3.5, z: food.z + wz * 3.5 }, { k: 'Digit5', x: bait.x, z: bait.z }, { k: 'Digit1', x: bait.x, z: bait.z }];
        const now = performance.now();
        window.__cbDbg = { st, since: +since().toFixed(1), stuck: flag.stuck || 0, leg: flag.leg || 0, setting: !!C.setting, p: [+(p.x - food.x).toFixed(1), +(p.z - food.z).toFixed(1)], traps: sim.traps.map((q) => q.kind) };
        if (st < plan.length) {
          const s = plan[st];
          if (flag.setting) { if ((!C.setting && since() > 0.9) || since() > 6) { flag.setting = 0; flag.leg = 0; flag.stuck = 0; next(); } return; }
          const pre = { x: s.x - wx * 3, z: s.z - wz * 3 }, at = { x: s.x - wx * 1.3, z: s.z - wz * 1.3 };
          const goal = flag.leg ? at : pre, d = dist(p, goal);
          // a walk that makes no headway for 1.5 s: step aside once, then give up on the spot and set it here
          if (!flag.wpT || now - flag.wpT > 1500) { if (flag.wp && dist(flag.wp, p) < 0.25 && d > 0.8) flag.stuck = (flag.stuck || 0) + 1; flag.wp = { x: p.x, z: p.z }; flag.wpT = now; }
          if (!flag.leg && (d < 0.8 || flag.stuck >= 2 || dist(p, at) < 1.2)) { flag.leg = 1; flag.stuck = 0; return; }
          if (flag.leg && !(d < 0.6 || flag.stuck >= 2 || since() > 18)) { go(goal.x, goal.z); hold('KeyA', flag.stuck === 1); return; }
          if (!flag.leg && since() < 18) { go(goal.x, goal.z); hold('KeyA', flag.stuck === 1); return; }
          stop();
          if (look(p.x + wx * 10, p.z + wz * 10) < 0.2 && since() > 0.3) { tap('KeyT'); setTimeout(() => key(s.k), 260); setTimeout(() => keyUp(s.k), 340); flag.setting = 1; stT = now; }
        } else if (st === plan.length) {
          // ready, said out here (by the fire the same key feeds it)
          stop(); if (since() > 0.8) { tapE(); next(); }
        } else if (since() > 3) { const d = go(food.x - wx * 1.2, food.z - wz * 1.2); if (d < 0.8) stop(); }
        return;
      }
      const h = living('hound').find((e) => !e.routed), thieves = living('skritch').filter((e) => !e.routed && dist(e, food) < 5);
      if (fire.fuel < fire.max * 0.55 && (sim.inv.branch || 0) > 0 && !(h && (h.state === 'windup' || h.state === 'strike'))) { const d = go(fire.x, fire.z); if (d < 2.4) { stop(); if (since() > 0.8) { tapE(); stT = performance.now(); } } return; }
      if (h && (h.state === 'windup' || h.state === 'strike') && h.target === -1) { stop(); look(h.x, h.z, h.y + 0.6); hold('KeyQ', h.stateT > 0.3 || h.state === 'strike'); return; }
      hold('KeyQ', 0);
      if (h && h.weakT > 0 && dist(h, p) < 5) { fight([h]); return; }
      if (thieves.length) { fight(thieves); return; }
      // otherwise guard the food from its upwind side, looking out over the traps to the dark they come from
      const d = go(food.x - wx * 1.2, food.z - wz * 1.2); if (d < 0.7) { stop(); if (h && dist(h, p) < 14) look(h.x, h.z, h.y + 0.6); else look(bait.x, bait.z, food.y); }
    } else if (mode === 'chase') {
      const goal = run.markers.find((m) => m.kind === 'goal'), h = living('hound')[0];
      if (h && h.state === 'strike' && dist(h, p) < 3.6 && p.act !== 'roll' && p.stamina > 14) { hold('KeyD', 1); tap('KeyV'); setTimeout(() => hold('KeyD', 0), 450); return; }
      go(goal.x, goal.z, { sprint: p.stamina > 24 });
    } else if (mode === 'stealth') {
      if (st === 0) { tap('KeyX'); next(); return; }
      const way = [run.at(14, 3.5), run.at(30, -5), run.at(46, 2), run.at(60, 3), run.at(72, 0)], a = run.at(0, 0);
      const w = way.find((q) => Math.hypot(q.x - a.x, q.z - a.z) > Math.hypot(p.x - a.x, p.z - a.z) + 0.5) || way[4];
      go(w.x, w.z);
    } else if (mode === 'atlatlplay' || mode === 'bowplay') {
      const wpn = mode === 'bowplay' ? 'bow' : 'atlatl';
      if (st === 0) { if (equip(wpn)) { run.summon('nibbet', 3); next(); } }
      else { const t = nearest(living('nibbet')); if (t) shoot(t, { loft: wpn === 'atlatl' ? 0.02 : 0.012 }); else if (since() > 3) { run.summon('skritch', 3); stT = performance.now(); } }
    } else if (mode === 'bowref' || mode === 'slingref' || mode === 'atlatlref') {
      // a reference: the same shot again and again at a point ahead, standing still, for a side camera
      const wpn = mode === 'bowref' ? 'bow' : mode === 'atlatlref' ? 'atlatl' : 'sling';
      if (st === 0) { if (equip(wpn)) { flag.yaw = C.cam.yaw; next(); } return; }
      const f = { x: C.cam.x - Math.sin(flag.yaw) * 30, z: C.cam.z - Math.cos(flag.yaw) * 30 };
      look(f.x, f.z, C.cam.y + 1.4);
      const cyc = since() % 5.2;
      hold('Mouse2', cyc > 0.4);
      hold('Mouse0', cyc > 1.0 && cyc < (mode === 'bowref' ? 3.4 : 3.0));
    } else if (mode === 'tour') {
      // free play: walk up to the animals of Verdaxis and look at them
      const t = nearest(living().filter((e) => e.kind === (flag.kind || 'mossback')));
      if (t) { const d = go(t.x, t.z, { sprint: dist(t, p) > 40 && p.stamina > 30 }); if (d < 14) { stop(); look(t.x, t.z, t.y + t.def.height * 0.5); } }
    }
  };
  tick();
};
