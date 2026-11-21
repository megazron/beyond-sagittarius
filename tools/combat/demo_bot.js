// A stand-in player for recordings: it plays the fight through the game's own controls (keys, mouse buttons, mouse
// look), never by reaching into the simulation to change it. tools/gpu_capture.py evals this file, then calls
// __cbBot('<mode>'). Modes: melee, ranged, guardian, hunt, night, chase, stealth, tour. __cbStop = true ends it.
window.__cbBot = (mode) => {
  const C = __bs.combat, held = {};
  window.__cbStop = false;
  const hold = (k, on) => { if (!!held[k] !== !!on) { held[k] = !!on; C.testHold(k, !!on); } };
  const tap = (k) => C.testTap(k);
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
      // a pack of Skritch, then the spear against them; the roll and the guard are both shown
      if (st === 0) { if (equip('spear')) { run.summon('skritch', 4); next(); } }
      else if (st === 1) { fight(living('skritch'), { roll: Math.floor(T / 6) % 2 === 1 }); if (!living('skritch').length && since() > 2) next(); }
      else if (st === 2) { if (equip('club')) { run.summon('skritch', 4); next(); } }
      else if (st === 3) fight(living('skritch'), {});
    } else if (mode === 'ranged') {
      if (st === 0) { if (equip('sling')) { run.summon('skritch', 3); next(); } }
      else if (st === 1) { const t = nearest(living('skritch')); if (t) shoot(t, { loft: 0.02 }); else if (since() > 2) { hold('Mouse2', 0); next(); } }
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
        if (p.act === 'charge') { stop(); look(prey.x, prey.z, prey.y + 0.3); if (p.charge >= 1) hold('KeyG', 0); }
        else if (d > 8.5) go(prey.x, prey.z);
        else { stop(); const off = look(prey.x, prey.z, prey.y + 0.3); if (off < 0.06 && p.act === 'idle' && prey.state !== 'flee') hold('KeyG', 1); }
      }
    } else if (mode === 'night') {
      const fire = sim.fires.find((f) => !f.torch && !f.burnsOut), food = run.markers.find((m) => m.kind === 'food');
      if (run.phase === 'prep') {
        // bait and a snare out in the dark, stakes on the way in, then say ready
        const dx = food.x - fire.x, dz = food.z - fire.z, l = Math.hypot(dx, dz), spot = [{ x: food.x + (dx / l) * 8, z: food.z + (dz / l) * 8 }, { x: food.x + (dx / l) * 7.6, z: food.z + (dz / l) * 7.6 }, { x: food.x + (dx / l) * 3.5, z: food.z + (dz / l) * 3.5 }];
        const order = ['Digit5', 'Digit1', 'Digit2'];
        if (st < 3) {
          if (flag.setting) { if (!C.setting && since() > 0.6) { flag.setting = 0; next(); } return; }
          const d = go(spot[st].x - (dx / l) * 1.3, spot[st].z - (dz / l) * 1.3);
          if (d < 0.9) { stop(); if (look(spot[st].x + dx, spot[st].z + dz) < 0.3 && since() > 1) { tap('KeyT'); setTimeout(() => key(order[st]), 250); flag.setting = 1; stT = performance.now(); } }
        } else if (st === 3) { const d = go(food.x - 0.6, food.z - 0.5); if (d < 0.8) { stop(); tap('KeyE'); next(); } }
        return;
      }
      const h = living('hound').find((e) => !e.routed), thieves = living('skritch').filter((e) => !e.routed && dist(e, food) < 8);
      if (fire.fuel < fire.max * 0.55 && (sim.inv.branch || 0) > 0 && !(h && (h.state === 'windup' || h.state === 'strike'))) { const d = go(fire.x, fire.z); if (d < 2.4) { stop(); if (since() > 0.8) { tap('KeyE'); stT = performance.now(); } } return; }
      if (h && (h.state === 'windup' || h.state === 'strike') && h.target === -1) { stop(); look(h.x, h.z, h.y + 0.6); hold('KeyQ', h.stateT > 0.3 || h.state === 'strike'); return; }
      hold('KeyQ', 0);
      if (h && h.weakT > 0 && dist(h, p) < 5) { fight([h]); return; }
      if (thieves.length) { fight(thieves); return; }
      const d = go(food.x - 0.8, food.z - 0.6); if (d < 0.7) { stop(); if (h) look(h.x, h.z, h.y + 0.6); }
    } else if (mode === 'chase') {
      const goal = run.markers.find((m) => m.kind === 'goal'), h = living('hound')[0];
      if (h && h.state === 'strike' && dist(h, p) < 3.6 && p.act !== 'roll' && p.stamina > 14) { hold('KeyD', 1); tap('KeyV'); setTimeout(() => hold('KeyD', 0), 450); return; }
      go(goal.x, goal.z, { sprint: p.stamina > 24 });
    } else if (mode === 'stealth') {
      if (st === 0) { tap('KeyX'); next(); return; }
      const way = [run.at(14, 3.5), run.at(30, -5), run.at(46, 2), run.at(60, 3), run.at(72, 0)], a = run.at(0, 0);
      const w = way.find((q) => Math.hypot(q.x - a.x, q.z - a.z) > Math.hypot(p.x - a.x, p.z - a.z) + 0.5) || way[4];
      go(w.x, w.z);
    } else if (mode === 'tour') {
      // free play: walk up to the animals of Verdaxis and look at them
      const t = nearest(living().filter((e) => e.kind === (flag.kind || 'mossback')));
      if (t) { const d = go(t.x, t.z, { sprint: dist(t, p) > 40 && p.stamina > 30 }); if (d < 14) { stop(); look(t.x, t.z, t.y + t.def.height * 0.5); } }
    }
  };
  tick();
};
