// A stand-in player for recordings: it plays the fight through the game's own controls (keys, mouse buttons, mouse
// look), never by reaching into the simulation to change it. tools/gpu_capture.py evals this file, then calls
// __cbBot('<mode>'). Modes: melee, ranged, guardian, hunt, night, chase, stealth, tour, fish (log in window.__cbFishLog). __cbStop = true ends it.
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
    // (a man on watch turns his head, he does not flick it: v14 swung half round in a few frames, which read as a cut)
    const mx = flag.calm ? 22 : 70;
    const mp = flag.calmPitch ? 9 : 30; // (fishing: the view itself tips with the look, so it tips slowly)
    C.testLook(Math.max(-mx, Math.min(mx, (-d / SENS) * k)), Math.max(-mp, Math.min(mp, ((c.pitch - wp) / SENS) * 0.2)));
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
    flag.calm = false;
    const sim = C.activeSim, p = sim.player, t = nearest(targets);
    if (!t) { stop(); hold('KeyQ', 0); return; }
    const d = dist(t, p), dg = danger();
    // (o.level: eyes on the horizon, not down at a small animal at the feet: the follow camera went overhead)
    look(t.x, t.z, o.level ? C.cam.y + 1.3 : t.y + t.def.height * 0.5);
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
      else if (st === 3) { const t = nearest(living('nibbet')); if (t && since() < 24) shoot(t); else { hold('Mouse2', 0); hold('Mouse0', 0); if (window.__cbRangedAtlatl) next(); } }
      // (and the spear-thrower, when the take asks for it: the aim views after the camera fix)
      else if (st === 4) { if (equip('atlatl')) { run.summon('skritch', 2); next(); } }
      else if (st === 5) { const t = nearest(living('skritch')); if (t && since() < 22) shoot(t, { loft: 0.016 }); else { hold('Mouse2', 0); hold('Mouse0', 0); window.__cbRangedDone = true; } }
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
      if (!fire || !food || run.id !== 'night.defence') return; // the night has not started yet
      const wx = sim.windX, wz = sim.windZ, bait = { x: food.x + wx * 5.5, z: food.z + wz * 5.5 };
      if (run.phase === 'prep') {
        // read the smoke: they will come up the wind. Stakes on the line in, bait out downwind, a snare on the bait.
        // Each one is set facing downwind: the last two metres are walked along the wind, so the body faces that way.
        // the snare goes on the bait where it really lies (a walk that ends short sets the bait where it stands)
        const laid = sim.traps.find((q) => q.kind === 'bait'), sn = laid ? { x: laid.x, z: laid.z } : bait;
        const plan = [{ k: 'Digit2', x: food.x + wx * 2.6, z: food.z + wz * 2.6 }, { k: 'Digit5', x: bait.x, z: bait.z }, { k: 'Digit1', x: sn.x, z: sn.z }];
        const now = performance.now();
        window.__cbDbg = { st, since: +since().toFixed(1), stuck: flag.stuck || 0, leg: flag.leg || 0, setting: !!C.setting, p: [+(p.x - food.x).toFixed(1), +(p.z - food.z).toFixed(1)], traps: sim.traps.map((q) => q.kind) };
        if (st < plan.length) {
          const s = plan[st];
          if (flag.setting) { if ((!C.setting && since() > 0.9) || since() > 6) { flag.setting = 0; flag.leg = 0; flag.stuck = 0; next(); } return; }
          const pre = { x: s.x - wx * 3, z: s.z - wz * 3 }, at = { x: s.x - wx * 1.3, z: s.z - wz * 1.3 };
          const goal = flag.leg ? at : pre, d = dist(p, goal);
          // a walk that makes no headway for 1.5 s: step aside once, then give up on the spot and set it here
          // (only while it is walking: turning on the spot to face the way is not being stuck)
          if (!flag.wpT || now - flag.wpT > 1500) { if (flag.wp && flag.walked && dist(flag.wp, p) < 0.25 && d > 0.8) flag.stuck = (flag.stuck || 0) + 1; flag.wp = { x: p.x, z: p.z }; flag.wpT = now; flag.walked = false; }
          if (held.KeyW) flag.walked = true;
          if (!flag.leg && (d < 0.8 || flag.stuck >= 2 || dist(p, at) < 1.2)) { flag.leg = 1; flag.stuck = 0; return; }
          if (flag.leg && !(d < 0.6 || flag.stuck >= 2 || since() > 18)) { go(goal.x, goal.z); hold('KeyA', flag.stuck === 1); return; }
          if (!flag.leg && since() < 18) { go(goal.x, goal.z); hold('KeyA', flag.stuck === 1); return; }
          stop();
          if (look(p.x + wx * 10, p.z + wz * 10) < 0.2 && since() > 0.3) { tap('KeyT'); setTimeout(() => key(s.k), 260); setTimeout(() => keyUp(s.k), 340); flag.setting = 1; stT = now; }
        } else if (st === plan.length) {
          // ready, said out here (by the fire the same key feeds it)
          // the spear in the hand for the watch (it braces against a lunge when held up), then ready
          stop(); if (!equip('spear')) return; if (since() > 0.8) { tapE(); next(); }
        } else if (since() > 3) { const d = go(food.x + wx * 2.8 - wz * 4, food.z + wz * 2.8 + wx * 4); if (d < 0.8) stop(); }
        return;
      }
      // a hunter waits beside the snare, still, looking out into the dark the smoke goes to (where they come from).
      // The game's own look turns the view to the snare when something is heard at it; the bot does not turn for it
      const sq = sim.traps.find((q) => q.kind === 'snare') || bait;
      // (he watched from beside the snare, 7 m or more out from the fire: much of the s5 take was dark field. Now from the
      // edge of the firelight on the snare's side, a step to the side of the line, so the fire, he and the snare share the frame)
      const fsx = sq.x - fire.x, fsz = sq.z - fire.z, fsl = Math.hypot(fsx, fsz) || 1, gd = Math.min(2.6, fsl * 0.5);
      const guard = { x: fire.x + (fsx / fsl) * gd - (fsz / fsl) * 1.3, z: fire.z + (fsz / fsl) * gd + (fsx / fsl) * 1.3 }, out = { x: sq.x + wx * 16 - wz * 2, z: sq.z + wz * 16 + wx * 2 };
      // a record of every catch (window.__cbTrapLog), so a take can be checked for one without watching it all
      for (const q of sim.traps) if (q.sprungT >= 0 && !(window.__cbTrapLog ||= []).some((r) => r.id === q.id && r.t === q.sprungT)) window.__cbTrapLog.push({ id: q.id, kind: q.kind, t: q.sprungT, caught: q.caught, wave: run.wave, d: +dist(q, p).toFixed(1), rec: +((performance.now() - t0) / 1000).toFixed(1) });
      // and every warning cue (rustle, voice, twig before the snap), with its time in the take, to listen for it
      { const b = C.beat; if (b && b.snapT < 0 && b !== flag.cueB) { flag.cueB = b; (window.__cbTrapLog ||= []).push({ cue: b.id, t: +sim.t.toFixed(2), rec: +((performance.now() - t0) / 1000).toFixed(2) }); } }
      // the watch: a man alone at night keeps busy. He keeps the fire up a branch at a time, scans the dark, the snare
      // and the stakes, turns his head to what he hears out there (and raises the spear at a growl), and when something
      // is heard AT a trap he leaves the view to the game's own look and goes a few steps that way, spear up
      const watch = (o = {}) => {
        const now = performance.now(); flag.calm = true;
        // a cue at a trap: hands off the view (the game turns the head; a turn of ours would cancel it)
        if (C.beat) { stop(); hold('KeyQ', 0); flag.trapHeard = { id: C.beat.id, at: now }; return; }
        if (flag.trapHeard && now - flag.trapHeard.at < 5200) {
          const tr = sim.traps.find((q) => q.id === flag.trapHeard.id);
          // after the beat: a few steps towards it if it is far, a step back from it if he stands over it (his body hid
          // the catch in v13), then the spear up, facing it
          if (tr) {
            const d = dist(p, tr), early = now - flag.trapHeard.at < 3200; look(tr.x, tr.z, C.cam.y + 0.5);
            if (d > 4.5 && early) { hold('KeyS', 0); hold('KeyW', 1); hold('KeyQ', 0); } else if (d < 3 && early) { hold('KeyW', 0); hold('KeyS', 1); hold('KeyQ', 0); } else { stop(); hold('KeyQ', 1); }
            return;
          }
        }
        if (flag.trapHeard) { flag.trapHeard = null; hold('KeyQ', 0); }
        // a sound out in the dark (a chitter, a growl, a rustle: the game's own placed sounds, C.heard): the head goes
        // to it for a couple of seconds; a hound's voice brings the spear up
        // (a held animal's struggling is not new: it is not turned to again; after a listen, three seconds of other
        // business before the next small sound turns the head; a growl always does)
        flag.fedAt ||= now;
        const low = fire.fuel < fire.max * (o.hold1 ? 0.45 : 0.66), due = !o.hold1 && now - flag.fedAt > 30000 && fire.fuel < fire.max * 0.92;
        const wood = (sim.inv.branch || 0) + (fire.pile || 0) > 0, busy = flag.feeding || (wood && low);
        const H = (C.heard || []).filter((h) => h.t > (flag.heardT || 0) && h.t <= now && /chitter|squeak|growl|snarl|howl|rustle|twig|snort/.test(h.name) && dist(h, p) > 2.5 && dist(h, p) < 24);
        if (H.length) {
          const h = H[H.length - 1], hound = /growl|snarl|howl/.test(h.name); flag.heardT = h.t;
          if (hound || (!busy && now - (flag.listenEnd || 0) > 3000)) flag.listen = { x: h.x, z: h.z, at: now, hound, name: h.name };
        }
        if (flag.listen && now - flag.listen.at < 2400) {
          stop(); look(flag.listen.x, flag.listen.z, C.cam.y + 0.5); hold('KeyQ', flag.listen.hound && now - flag.listen.at > 400);
          window.__cbWatchLog = (window.__cbWatchLog || []); if (flag.listenLogged !== flag.listen.at) { flag.listenLogged = flag.listen.at; window.__cbWatchLog.push({ heard: flag.listen.name, rec: +((now - t0) / 1000).toFixed(1) }); }
          return;
        }
        if (flag.listen) { flag.listen = null; flag.listenEnd = now; hold('KeyQ', 0); }
        // the fire: fed when it is down to two thirds (or every half minute while it is not full), a branch at a time,
        // walked to and back; in wave 1 only when it is low (the snare is watched)
        if (wood && (flag.feeding || low || due)) {
          if (!flag.feeding) { flag.feeding = now; flag.fed = 0; (window.__cbWatchLog ||= []).push({ feed: +(fire.fuel / fire.max).toFixed(2), rec: +((now - t0) / 1000).toFixed(1) }); }
          const d = go(fire.x, fire.z);
          if (d < 2.2) { stop(); look(fire.x, fire.z, C.cam.y + 0.3); if (!flag.fed && now - flag.feeding > 600) { tapE(); flag.fed = now; } }
          if ((flag.fed && now - flag.fed > 1600) || now - flag.feeding > 14000) { flag.feeding = 0; flag.fedAt = now; }
          return;
        }
        // the scan: out where the smoke goes, along to the snare, across the dark, to the stakes, back out, the fire
        const d = go(guard.x, guard.z);
        if (d < 0.7) {
          stop();
          const st2 = sim.traps.find((q) => q.kind === 'stakes') || sq;
          const spots = [out, sq, { x: out.x - wz * 9, z: out.z + wx * 9 }, st2, out, { x: out.x + wz * 9, z: out.z - wx * 9 }, fire];
          const i = Math.floor(now / 3400) % spots.length, s2 = spots[i];
          look(s2.x, s2.z, C.cam.y + (s2 === fire ? 0.3 : s2 === sq || s2 === st2 ? 0.2 : 1.1));
        }
      };
      if (run.phase === 'hush') { watch({ hold1: true }); return; }
      const h = living('hound').find((e) => !e.routed), thieves = living('skritch').filter((e) => !e.routed && dist(e, food) < 5);
      // wave 1 is watched from the watch spot, whatever the food and the fire do (only a fire nearly out calls it back)
      const hold1 = run.wave <= 1 && fire.fuel > fire.max * 0.2;
      if (h && (h.state === 'windup' || h.state === 'strike') && h.target === -1) { flag.calm = false; stop(); look(h.x, h.z, h.y + 0.6); hold('KeyQ', h.stateT > 0.3 || h.state === 'strike'); return; }
      hold('KeyQ', 0);
      const close = living('skritch').filter((e) => !e.routed && e.heldT <= 0 && dist(e, p) < 2.2);
      // a fire near out comes first, whatever is at the heels (they follow him to the light and are fought there)
      const dying = fire.fuel < fire.max * 0.3 && (sim.inv.branch || 0) + (fire.pile || 0) > 0;
      if (close.length && !(dying && dist(p, fire) > 2.2)) { if (dying && dist(p, fire) <= 2.2 && since() > 0.8) { tapE(); stT = performance.now(); } fight(close, { level: true }); return; }
      if (dying) { const d = go(fire.x, fire.z); if (d < 2.2) { stop(); look(fire.x, fire.z, C.cam.y + 0.3); if (since() > 0.8) { tapE(); stT = performance.now(); } } return; }
      if (!hold1) {
        if (h && h.weakT > 0 && dist(h, p) < 5) { fight([h]); return; }
        if (thieves.length && !flag.feeding) { fight(thieves, { level: true }); return; }
      }
      watch({ hold1 });
    } else if (mode === 'chase') {
      const goal = run.markers.find((m) => m.kind === 'goal'), h = living('hound')[0];
      // a runner who has seen it gather: roll out of the lunge's line when it is about a third of a second from
      // landing (the roll's cover lasts 0.42 s), to the side away from the line; one roll per lunge
      if (!(h && h.state === 'strike')) flag.lastT = performance.now();
      if (h && h.state !== flag.hState) { flag.hState = h.state; if (h.state === 'strike') flag.strikeN = (flag.strikeN || 0) + 1; }
      if (h && h.state === 'strike' && p.act !== 'roll' && p.stamina > 14 && flag.rollFor !== flag.strikeN) {
        const ox = p.x - h.x, oz = p.z - h.z, along = ox * h.atkDx + oz * h.atkDz, d = dist(h, p);
        // time to contact from the closing speed (the lunge is ~14 m/s, the runner ~6), plus one bot tick of lag
        const now = performance.now(), tick = Math.min(0.15, (now - (flag.lastT || now)) / 1000); flag.lastT = now;
        const closing = Math.max(4, Math.hypot(h.vx, h.vz) - p.speed * 0.8), ttc = (d - 1.2) / closing;
        if (along > 0 && ttc < 0.3 + tick && d > 0.5) {
          const side = Math.sign(h.atkDx * oz - h.atkDz * ox) || 1, nx = -h.atkDz * side, nz = h.atkDx * side;
          const y = C.cam.yaw, rx = Math.cos(y), rz = -Math.sin(y), k = nx * rx + nz * rz > 0 ? 'KeyD' : 'KeyA';
          flag.rollFor = flag.strikeN; hold(k, 1); tap('KeyV'); setTimeout(() => hold(k, 0), 450); return;
        }
      }
      // a runner who has seen the spore plant gives it a wide berth (its lash reaches 3.5 m; it stands just off the path)
      const bl = living('lashbloom')[0];
      if (bl) {
        const gx = goal.x - p.x, gz = goal.z - p.z, gl = Math.hypot(gx, gz) || 1, ux = gx / gl, uz = gz / gl;
        const bx = bl.x - p.x, bz = bl.z - p.z, along = bx * ux + bz * uz, off = bx * -uz + bz * ux;
        if (along > -1.5 && along < 16) {
          const s = Math.sign(off) || 1, w = { x: bl.x + uz * s * 7 + ux * 1.5, z: bl.z - ux * s * 7 + uz * 1.5 };
          go(w.x, w.z, { sprint: p.stamina > 24 }); return;
        }
      }
      go(goal.x, goal.z, { sprint: p.stamina > 24 });
    } else if (mode === 'stealth') {
      if (st === 0) { tap('KeyX'); next(); return; }
      const way = [run.at(14, 3.5), run.at(30, -5), run.at(46, 2), run.at(60, 3), run.at(72, 0)], a = run.at(0, 0);
      const w = way.find((q) => Math.hypot(q.x - a.x, q.z - a.z) > Math.hypot(p.x - a.x, p.z - a.z) + 0.5) || way[4];
      go(w.x, w.z);
    } else if (mode === 'pose') {
      // close and slowed: each hand weapon in turn, carried, raised, three blows, a block, and a throw where it can
      // be thrown, seen from the side then from the front (for the owner's "the spear goes inside the person")
      const list = window.__cbPoseList || ['spear', 'club', 'throwstick', 'rock'];
      const now = performance.now();
      if (st === 0) { C.testSlow = 0.35; flag.i = 0; flag.t = now; next(); return; }
      const w = list[flag.i];
      if (!w) { __bs.photo(null); C.testSlow = 1; window.__cbPoseDone = true; return; }
      if (p.weapon !== w) { if (p.act === 'idle' && now - (flag.rT || 0) > 250) { tap('KeyR'); flag.rT = now; } if (now - flag.t > 6000) { flag.i++; flag.t = now; } return; }
      const T = (now - flag.t) / 1000, side = flag.i % 2 === 0, y = flag.yaw ?? (flag.yaw = C.cam.yaw);
      const fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y), c = C.cam;
      const cam = side ? [p.x - rx * 2.3 + fx * 0.4, c.y + 1.25, p.z - rz * 2.3 + fz * 0.4] : [p.x + fx * 2.6 - rx * 0.5, c.y + 1.3, p.z + fz * 2.6 - rz * 0.5];
      __bs.photo(cam, [p.x, c.y + 1.05, p.z]);
      // (the bow, the sling and the spear-thrower: drawn, whirled or cocked, and let go, the same way)
      const throwable = w === 'spear' || w === 'throwstick' || w === 'rock' || w === 'bow' || w === 'sling' || w === 'atlatl';
      if (T < 1.5) { stop(); }
      else if (T < 10.5) { if (Math.floor((T - 1.5) / 3) !== flag.blow) { flag.blow = Math.floor((T - 1.5) / 3); tap('Mouse0'); } }
      else if (T < 12.5) hold('KeyQ', 1);
      else if (T < 13.5) hold('KeyQ', 0);
      else if (throwable && T < 18) { hold('Mouse2', 1); hold('Mouse0', T < 16.5); }
      else { hold('Mouse2', 0); hold('Mouse0', 0); flag.i++; flag.t = now; flag.blow = -1; }
    } else if (mode === 'fish') {
      // spear fishing: walk to the water's edge across from a fish that is holding still (never wading in unless no
      // fish is within reach of the bank), aim the reticle exactly (the camera's own line), the first thrust at where
      // the fish is SEEN (it goes over: the lesson), then at where it really is (below)
      // (v2 never thrust: the low camera clamped the orbit, the view looked at his head from 5 m back and its line
      // could not tip down to a fish, so the aim never settled. player.ts now looks along the look in this scene.)
      // Every step it takes, and why it waits, goes to window.__cbFishLog (ev: start, target, walk, edge, aim, stall,
      // thrust, result, lost, cam, hitch), so a take shows what the stand-in was doing.
      const P = C.d.player, cam = P.camera, eye = cam.position, now = performance.now(), env = sim.env;
      const rec = +((now - t0) / 1000).toFixed(1);
      const log = (ev, o = {}) => { const L = window.__cbFishLog || (window.__cbFishLog = []); if (L.length < 600) L.push({ ev, rec, ...o }); };
      const depth = (x, z) => { const w = env.water ? env.water(x, z) : null; return w === null || w === undefined ? -1 : w - env.height(x, z); };
      const camPitch = () => { const e = cam.matrixWorld.elements; return Math.asin(Math.max(-1, Math.min(1, -e[9]))); };
      flag.calm = true; flag.calmPitch = true;
      // the camera: a jump or a hitch between two frames is logged with what the camera was doing
      {
        const q = cam.quaternion, last = flag.camLast, ms = flag.camT ? now - flag.camT : 16;
        if (last) {
          const dpos = Math.hypot(eye.x - last.x, eye.y - last.y, eye.z - last.z), dot = Math.min(1, Math.abs(q.x * last.qx + q.y * last.qy + q.z * last.qz + q.w * last.qw)), dang = 2 * Math.acos(dot);
          const info = { dpos: +dpos.toFixed(2), dang: +dang.toFixed(2), ms: Math.round(ms), clip: +(P.camClip ?? 0).toFixed(2), distS: +(P.distS ?? 0).toFixed(2), swim: !!P.swimming, act: p.act, st, tid: flag.tid || 0 };
          if (dpos > 0.35 || dang > 0.2) log('cam', info);
          else if (ms > 200) log('hitch', info);
        }
        flag.camLast = { x: eye.x, y: eye.y, z: eye.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }; flag.camT = now;
      }
      const seenY = (px, py, pz, surf) => {
        const hc = eye.y - surf, df = surf - py, D = Math.hypot(px - eye.x, pz - eye.z);
        if (df <= 0 || hc <= 0) return py; if (D < 1e-3) return surf - df / 1.333;
        let lo = 0, hi = D; for (let i = 0; i < 40; i++) { const x = (lo + hi) / 2; if (x / Math.hypot(x, hc) > 1.333 * (D - x) / Math.hypot(D - x, df)) hi = x; else lo = x; }
        const x = Math.max(1e-4, (lo + hi) / 2); return surf - ((D - x) * hc) / x;
      };
      // a hand on a mouse: a steady turn, never a flick (the yaw and pitch steps are small)
      const aimAt = (x, y, z) => {
        const e = cam.matrixWorld.elements, fx = -e[8], fy = -e[9], fz = -e[10];
        const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z, l = Math.hypot(dx, dy, dz);
        const d = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - Math.atan2(-fx, -fz)), Math.cos(Math.atan2(-dx, -dz) - Math.atan2(-fx, -fz)));
        const dp = Math.asin(Math.max(-1, Math.min(1, fy))) - Math.asin(dy / l);
        C.testLook(Math.max(-18, Math.min(18, (-d / SENS) * 0.35)), Math.max(-14, Math.min(14, (dp / SENS) * 0.35)));
        return { err: Math.hypot(d, dp), d, dp };
      };
      // where to stand for a fish: back from it towards him to the first dry ground (the water's edge), a step onto
      // the bank; when that is out of a thrust's reach, a short way into the shallows instead (2 m from the fish)
      const REACH = 2.2;
      const stand = (f) => {
        const dx = p.x - f.x, dz = p.z - f.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
        let k = 0;
        for (; k < Math.min(l + 3, 12); k += 0.2) if (depth(f.x + ux * k, f.z + uz * k) < 0.06) break;
        const de = k;
        if (de <= REACH) { const s = Math.min(de + 0.25, REACH); return { x: f.x + ux * s, z: f.z + uz * s, de, wade: false }; }
        return { x: f.x + ux * 2.0, z: f.z + uz * 2.0, de, wade: true };
      };
      if (st === 0) { if (equip('spear')) { flag.n = 0; flag.seenLog = 0; log('start', { x: +p.x.toFixed(1), z: +p.z.toFixed(1), feet: +depth(p.x, p.z).toFixed(2) }); next(); } return; }
      // what the sim made of each thrust
      if (sim.fishLog.length > flag.seenLog) { for (const w of sim.fishLog.slice(flag.seenLog)) log('result', { what: w }); flag.seenLog = sim.fishLog.length; }
      const fish = living('darter').filter((e) => e.state !== 'flee');
      let t = flag.tid ? fish.find((e) => e.id === flag.tid) : null;
      if (flag.tid && !t) { log('lost', { id: flag.tid }); flag.tid = 0; }
      let S = t ? stand(t) : null;
      if (t && S.de > REACH + 0.6 && !S.wade) { log('lost', { id: t.id, why: 'moved off', de: +S.de.toFixed(2) }); t = null; flag.tid = 0; }
      if (!t) {
        // the fish easiest to reach from the bank: nearest to its own water's edge, then nearest to walk to
        let best = null, bc = 1e9;
        for (const f of fish) { const q = stand(f), c = q.de + (q.wade ? 3 : 0) + 0.25 * Math.hypot(q.x - p.x, q.z - p.z); if (c < bc) { bc = c; best = f; S = q; } }
        t = best;
        if (!t) { stop(); if (!flag.none) { flag.none = 1; log('stall', { why: 'no fish holding still' }); } return; }
        flag.none = 0; flag.tid = t.id; flag.arrived = 0; flag.aimLogT = 0; flag.aimT = 0; flag.stallT = 0; flag.walking = 0;
        log('target', { id: t.id, d: +dist(t, p).toFixed(2), de: +S.de.toFixed(2), wade: S.wade, state: t.state });
      }
      const ds = Math.hypot(S.x - p.x, S.z - p.z);
      if (!flag.arrived && ds > 0.35) {
        if (!p.sneaking && !flag.sn) { flag.sn = 1; tap('KeyX'); }
        if (!flag.walking) { flag.walking = 1; log('walk', { to: [+S.x.toFixed(1), +S.z.toFixed(1)], ds: +ds.toFixed(2), wade: S.wade }); }
        go(S.x, S.z); flag.still = now; return;
      }
      if (!flag.arrived) { flag.arrived = 1; flag.walking = 0; flag.still = Math.max(flag.still || 0, now); log('edge', { d: +dist(t, p).toFixed(2), feet: +depth(p.x, p.z).toFixed(2), wade: S.wade }); }
      // standing: only walk again if the spot has moved well off (the fish glided)
      if (ds > 0.9) { flag.arrived = 0; return; }
      stop();
      if (p.act !== 'idle') return;
      const d = dist(t, p);
      const cy = t.y + t.def.height * 0.5, surf = (env.water && env.water(t.x, t.z)) ?? 0;
      // first thrust: at the fish as it is seen; after that, below it (at where it is)
      const y = flag.n === 0 ? seenY(t.x, cy, t.z, surf) : cy;
      const a = aimAt(t.x, y, t.z);
      if (!flag.aimT) flag.aimT = now;
      const settled = now - flag.still > 700, ok = a.err < 0.006 && settled && p.stamina > 14;
      if (now - (flag.aimLogT || 0) > 1500) { flag.aimLogT = now; log('aim', { id: t.id, err: +a.err.toFixed(4), dyaw: +a.d.toFixed(3), dpitch: +a.dp.toFixed(3), pitch: +C.cam.pitch.toFixed(3), camPitch: +camPitch().toFixed(3), d: +d.toFixed(2), stamina: Math.round(p.stamina), settled }); }
      if (now - flag.aimT > 6000 && !flag.stallT) { flag.stallT = 1; log('stall', { why: a.err >= 0.006 ? 'aim does not settle' : !settled ? 'waiting' : 'stamina', err: +a.err.toFixed(4), camPitch: +camPitch().toFixed(3), pitch: +C.cam.pitch.toFixed(3) }); }
      if (ok) {
        tap('Mouse0'); flag.n++; flag.still = now + 1200; flag.tid = 0; flag.stallT = 0;
        log('thrust', { n: flag.n, aim: flag.n === 1 ? 'seen' : 'true', d: +d.toFixed(2), err: +a.err.toFixed(4), camPitch: +camPitch().toFixed(3), wait: +((now - flag.aimT) / 1000).toFixed(1) });
      }
    } else if (mode === 'throwplay') {
      // the throwing stick: stand in the open, throw side-arm at a Nibbet within twelve metres (or at the grass ahead
      // when none is), walk out and fetch the stick, come back to the spot; never chase (they outrun anyone)
      if (st === 0) { if (equip('throwstick')) { flag.home = { x: p.x, z: p.z }; flag.yaw = C.cam.yaw; run.summon('nibbet', 3, 8); flag.sumT = performance.now(); next(); } return; }
      // a recording may ask for a slow side view of a throw (window.__cbSide = [from, to] seconds): framed on the spot
      // it throws from, switched on only when it is standing there
      const W = window.__cbSide, Tm = (performance.now() - t0) / 1000;
      if (W && Tm > W[0] && Tm < W[1] && !flag.side && dist(p, flag.home) < 1.2 && p.has.throwstick) {
        flag.side = 1; const y = C.cam.yaw, fx = -Math.sin(y), fz = -Math.cos(y), px = -Math.cos(y), pz = Math.sin(y), h = flag.home, cy = C.cam.y;
        // the stick spins flat (side-arm), so the camera looks down on the throw from the side and above: the turning
        // stick shows as a turning bar, not as a stick growing and shrinking edge-on. Square to the middle of the
        // throw (the Nibbets sit about 8 m out) and far enough back that the thrower, head to feet, and the landing
        // are both inside the frame (the thrower stood at the edge, half cut off, in v4)
        // framed on the Nibbet it will throw at (v5 framed a fixed point 3.4 m out and the animals were specks at the
        // edge): the middle of thrower and prey, as far off to the side as they are apart, so both fill the frame
        const pr = nearest(living('nibbet').filter((e) => dist(e, p) < 14));
        const tx = pr ? pr.x : h.x + fx * 8, tz = pr ? pr.z : h.z + fz * 8, mx = (h.x + tx) / 2, mz = (h.z + tz) / 2;
        const D = Math.hypot(tx - h.x, tz - h.z) || 1, ux = (tx - h.x) / D, uz = (tz - h.z) / D, L = Math.max(4.5, D * 0.8);
        // to the throwing-arm side of the line from thrower to prey
        const sx = -uz, sz = ux;
        __bs.photo([mx + sx * L, cy + 2.2, mz + sz * L], [mx, cy + 0.5, mz]); C.testSlow = 0.3;
        flag.camP = [mx + sx * L, cy + 2.2, mz + sz * L]; flag.camT = [mx, cy + 0.5, mz]; flag.side1 = { sx, sz };
      }
      // once the stick is down, the camera goes with the fetch at full speed: the thrower walks out to the stick (and
      // the animal it hit) and back, framed from the same side, the view eased (v6 held its spot and showed grass)
      if (flag.side === 1 && !p.has.throwstick) {
        const k = sim.pickups.find((q) => q.weapon === 'throwstick');
        if (k) {
          if (!flag.landT) flag.landT = performance.now();
          if (performance.now() - flag.landT > 1500) {
            C.testSlow = 1;
            const mx = (p.x + k.x) / 2, mz = (p.z + k.z) / 2, D = Math.hypot(k.x - p.x, k.z - p.z), L = Math.max(4.5, D * 0.75 + 2.5), S = flag.side1;
            const want = [mx + S.sx * L, C.cam.y + 2.0, mz + S.sz * L], tgt = [mx, C.cam.y + 0.6, mz];
            for (let i = 0; i < 3; i++) { flag.camP[i] += (want[i] - flag.camP[i]) * 0.06; flag.camT[i] += (tgt[i] - flag.camT[i]) * 0.1; }
            __bs.photo(flag.camP, flag.camT);
          }
        }
      }
      // picked up: follow the walk home for a few seconds, then hand the view back
      if (flag.side === 1 && p.has.throwstick && flag.landT) { flag.landT = 0; flag.back = performance.now(); }
      if (flag.side === 1 && flag.back) {
        const S = flag.side1, L = 5, want = [p.x + S.sx * L, C.cam.y + 2.0, p.z + S.sz * L], tgt = [p.x, C.cam.y + 0.9, p.z];
        for (let i = 0; i < 3; i++) { flag.camP[i] += (want[i] - flag.camP[i]) * 0.06; flag.camT[i] += (tgt[i] - flag.camT[i]) * 0.1; }
        __bs.photo(flag.camP, flag.camT);
        if (performance.now() - flag.back > 5000) { flag.side = 2; flag.back = 0; __bs.photo(null); C.testSlow = 1; }
      }
      if (W && Tm >= W[1] && flag.side === 1) { flag.side = 2; __bs.photo(null); C.testSlow = 1; }
      if (!p.has.throwstick) { const k = sim.pickups.find((q) => q.weapon === 'throwstick'); if (k) go(k.x, k.z); return; }
      if (p.weapon !== 'throwstick') { equip('throwstick'); return; }
      if (dist(p, flag.home) > 1.2 && p.act !== 'charge') { go(flag.home.x, flag.home.z); return; }
      const prey = nearest(living('nibbet').filter((e) => dist(e, p) < 12));
      if (!prey && performance.now() - flag.sumT > 6000) { living('nibbet').length < 6 && run.summon('nibbet', 2, 8); flag.sumT = performance.now(); }
      const ahead = { x: flag.home.x - Math.sin(flag.yaw) * 10, z: flag.home.z - Math.cos(flag.yaw) * 10, vx: 0, vz: 0, y: C.cam.y };
      const t = prey || ahead, d = dist(t, p), lx = t.x + t.vx * 0.3, lz = t.z + t.vz * 0.3, loft = t.y + 0.2 + d * 0.03;
      stop();
      if (p.act === 'charge') { look(lx, lz, loft); if (p.charge >= 1) hold('KeyG', 0); }
      // like a hunter: throw when the animal has settled (a running Nibbet is past the stick before it lands)
      else { const off = look(lx, lz, loft); if (off < 0.06 && p.act === 'idle' && since() > 1.2 && (!prey || Math.hypot(prey.vx, prey.vz) < 1 || since() > 6)) { hold('KeyG', 1); stT = performance.now(); } }
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
      // game time, so a slow-motion take keeps the same draw and cast
      const now = performance.now(); flag.gt = (flag.gt || 0) + Math.min(0.1, (now - (flag.rt || now)) / 1000) * (C.testSlow || 1); flag.rt = now;
      const cyc = flag.gt % 5.2;
      hold('Mouse2', cyc > 0.4);
      // the spear-thrower is cast as soon as it is drawn (nobody holds a full draw); the bow is held to aim
      hold('Mouse0', cyc > 1.0 && cyc < (mode === 'bowref' ? 3.4 : mode === 'atlatlref' ? 2.0 : 3.0));
    } else if (mode === 'tour') {
      // free play: walk up to the animals of Verdaxis and look at them
      const t = nearest(living().filter((e) => e.kind === (flag.kind || 'mossback')));
      if (t) { const d = go(t.x, t.z, { sprint: dist(t, p) > 40 && p.stamina > 30 }); if (d < 14) { stop(); look(t.x, t.z, t.y + t.def.height * 0.5); } }
    }
  };
  tick();
};
