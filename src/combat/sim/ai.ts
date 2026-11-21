// How the creatures think. Each has senses (sight in a cone, hearing, smell down the wind), an alert level that
// rises while it senses you and falls when it does not, and a temperament that decides what it does about it.
// Every attack starts with a telegraph long enough to read and act on.
import { clamp, dist2, turnTo } from './core.ts';
import type { CombatSim } from './sim.ts';
import type { Enemy, AttackDef } from './species.ts';

const TAU = Math.PI * 2;

function los(sim: CombatSim, ax: number, az: number, bx: number, bz: number): boolean {
  const d = dist2(ax, az, bx, bz), n = Math.min(48, Math.floor(d / 0.7));
  for (let i = 1; i < n; i++) { const k = i / n; if (sim.env.blocked(ax + (bx - ax) * k, az + (bz - az) * k, 0.15)) return false; }
  return true;
}

/** How far this creature keeps from a fire right now (0: it does not care, or the fire is out). */
function fireKeep(e: Enemy, f: { r: number; torch?: boolean }): number {
  if (e.def.fireFear <= 0 || f.r <= 0) return 0;
  if (f.torch) return e.def.fireFear;
  return Math.max(e.def.fireFear, f.r * (e.def.temperament === 'stalker' ? 1 : 0.62));
}

/** Walk or run towards a point, turning at the body's own rate, sliding round trunks and staying out of firelight. */
function move(sim: CombatSim, e: Enemy, tx: number, tz: number, speed: number, dt: number, o: { fire?: boolean; face?: boolean } = {}) {
  const def = e.def;
  let dx = tx - e.x, dz = tz - e.z;
  const d = Math.hypot(dx, dz);
  if (e.heldT > 0 || d < 0.05 || speed <= 0) { e.speed = 0; return d; }
  dx /= d; dz /= d;
  if (o.fire !== false && def.fireFear > 0) {
    for (const f of sim.fires) {
      const keep = fireKeep(e, f);
      if (!keep) continue;
      const rx = e.x - f.x, rz = e.z - f.z, rd = Math.hypot(rx, rz) || 1e-3;
      if (rd > keep + 1.2) continue;
      // inside the edge: straight out; at the edge: no step further in
      const nx = rx / rd, nz = rz / rd, inward = -(dx * nx + dz * nz);
      if (rd < keep) { dx = nx; dz = nz; speed = Math.max(speed, def.run * 0.8); }
      else if (inward > 0) { dx += nx * inward; dz += nz * inward; const l = Math.hypot(dx, dz); if (l < 0.15) { dx = -nz * e.side; dz = nx * e.side; } else { dx /= l; dz /= l; } }
    }
  }
  const want = Math.atan2(dx, dz), turn = turnTo(e.yaw, want), max = def.turn * dt;
  e.yaw += clamp(turn, -max, max);
  // a heavy body goes where it points, not where it wants
  const align = def.mass > 3 ? Math.max(0.15, Math.cos(turnTo(e.yaw, want))) : 1;
  const hx = def.mass > 3 ? Math.sin(e.yaw) : dx, hz = def.mass > 3 ? Math.cos(e.yaw) : dz;
  const step = Math.min(speed * align * dt, d);
  const nx = e.x + hx * step, nz = e.z + hz * step;
  if (!sim.env.blocked(nx, nz, def.radius * 0.7)) { e.x = nx; e.z = nz; }
  else if (!sim.env.blocked(nx, e.z, def.radius * 0.7)) e.x = nx;
  else if (!sim.env.blocked(e.x, nz, def.radius * 0.7)) e.z = nz;
  else { e.side = -e.side; e.yaw += e.side * 1.2 * dt * def.turn; }
  e.speed = speed * align;
  return d;
}

function faceTo(e: Enemy, x: number, z: number, dt: number, rate = 1) {
  const want = Math.atan2(x - e.x, z - e.z), max = e.def.turn * rate * dt;
  e.yaw += clamp(turnTo(e.yaw, want), -max, max);
}

function setState(sim: CombatSim, e: Enemy, s: Enemy['state']) {
  if (e.state === s) return;
  e.state = s; e.stateT = 0;
  sim.emit({ t: 'state', id: e.id, what: s, x: e.x, z: e.z });
}

function mods(e: Enemy) {
  let speed = 1, tele = 1;
  const ph = e.def.phases;
  if (ph) for (let i = 0; i < e.phase && i < ph.length; i++) { speed *= ph[i].speed; tele *= ph[i].telegraph; }
  return { speed, tele };
}

function sense(sim: CombatSim, e: Enemy, dt: number) {
  const def = e.def, p = sim.player;
  const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
  const asleep = e.state === 'asleep';
  let gain = 0;
  let range = sim.night ? def.sightNight : def.sightDay;
  // at night, standing in firelight, you are the one thing anyone can see
  if (sim.night && sim.lit(p.x, p.z) > 0) range = Math.max(range, def.sightDay * 1.15);
  if (p.sneaking) range *= 0.5;
  if (!asleep && !p.down && d < range) {
    const off = Math.abs(turnTo(e.yaw, Math.atan2(dx, dz)));
    if (off < def.fov / 2 || d < 2.2) {
      // the sight line is walked five times a second, not every step
      if (sim.t - e.losAt > 0.2) { e.losAt = sim.t; e.losOk = los(sim, e.x, e.z, p.x, p.z); }
      if (e.losOk) gain = (1.75 - d / range) * 1.1;
    }
  }
  // too close to miss, even for a sleeper
  const near = (asleep ? 1.1 : 1.6) + (p.sneaking ? 0 : asleep ? 0.9 : 1.2);
  if (d < near && !p.down) gain = Math.max(gain, asleep ? 1.4 : 2.4);
  // smell: you are up the wind from it
  if (!asleep && def.smell > 0 && d < def.smell * 0.6 && d > 0.1 && (-dx * sim.windX - dz * sim.windZ) / d > 0.35) gain = Math.max(gain, 0.3);
  for (const n of sim.noises) {
    if (n.t <= e.noiseSeen || n.from === e.id) continue;
    const dn = dist2(e.x, e.z, n.x, n.z), reach = n.r * def.hear * (asleep ? 0.6 : 1);
    if (dn > reach) continue;
    e.alert = Math.min(1.5, e.alert + (n.from === -1 ? 0.42 : n.from === -3 ? 0.6 : 0.3) * (1 - (dn / reach) * 0.6));
    // a sound it cannot put a body to pulls it that way
    if (!e.aware || (n.from !== -1 && e.lostT > 1.5)) { e.lkx = n.x; e.lkz = n.z; }
  }
  e.noiseSeen = sim.t;
  if (gain > 0) { e.alert = Math.min(1.5, e.alert + gain * dt * sim.tune.aggression); e.lkx = p.x; e.lkz = p.z; e.lostT = 0; }
  else { e.lostT += dt; e.alert = Math.max(0, e.alert - dt * (e.aware ? 0.11 : 0.16)); }
  if (!e.aware && e.alert >= 1) { e.aware = true; sim.emit({ t: 'state', id: e.id, what: 'alerted', x: e.x, z: e.z }); }
  else if (e.aware && e.alert < 0.3) { e.aware = false; sim.emit({ t: 'state', id: e.id, what: 'lost', x: e.x, z: e.z }); }
}

function wander(sim: CombatSim, e: Enemy, dt: number, range: number, speed: number) {
  e.wander -= dt;
  if (e.wander <= 0) {
    e.wander = 2.5 + sim.rand() * 4;
    const a = sim.rand() * TAU, r = sim.rand() * range;
    e.wx = e.homeX + Math.cos(a) * r; e.wz = e.homeZ + Math.sin(a) * r;
  }
  // half the time it stands and eats
  if (e.wander > 2.2) move(sim, e, e.wx, e.wz, speed, dt); else e.speed = 0;
}

function beginAttack(sim: CombatSim, e: Enemy, atk: AttackDef, tx: number, tz: number) {
  // only so many come at you at once: the others wait for an opening (machines and plants do not queue)
  if (e.target === -1 && e.def.walk > 0 && e.def.temperament !== 'machine') {
    let busy = 0;
    for (const o of sim.enemies) if (o !== e && !o.dead && o.target === -1 && (o.state === 'windup' || o.state === 'strike') && o.def.walk > 0) busy++;
    if (busy >= sim.tune.tokens) { e.cd = Math.max(e.cd, 0.5); return; }
  }
  e.atk = atk; e.atkHit = false; e.atkGone = 0;
  const d = Math.hypot(tx - e.x, tz - e.z) || 1;
  e.atkDx = (tx - e.x) / d; e.atkDz = (tz - e.z) / d;
  setState(sim, e, 'windup');
  const dur = atk.windup * sim.tune.telegraph * mods(e).tele * (atk.id === 'lunge' && sim.fires.some((f) => f.torch) ? 1.4 : 1);
  e.warned = dur;
  sim.emit({ t: 'telegraph', id: e.id, what: atk.id, dur, x: e.x, z: e.z, dx: e.atkDx, dz: e.atkDz, len: atk.reach, r: atk.id === 'stomp' || atk.id === 'lash' ? atk.reach : e.def.radius });
}

function targetPos(sim: CombatSim, e: Enemy): { x: number; z: number; ally: boolean } {
  const a = sim.ally;
  if (e.target === -2 && a && !a.down) return { x: a.x, z: a.z, ally: true };
  return { x: sim.player.x, z: sim.player.z, ally: false };
}

/** Is this spot safe by a real fire (a torch is light, not a wall)? */
function sheltered(sim: CombatSim, x: number, z: number): number {
  let best = -1;
  for (const f of sim.fires) if (!f.torch && f.r > 0) best = Math.max(best, f.r - dist2(x, z, f.x, f.z));
  return best;
}

/** The body of a lunge, a nip or a charge: forward along its line until it lands, misses or runs out. */
function strikeBody(sim: CombatSim, e: Enemy, dt: number): boolean {
  const atk = e.atk!, p = sim.player, t = targetPos(sim, e);
  const steer = atk.id === 'charge' ? (e.stateT < atk.active * 0.4 ? 0.4 : 0.05) : 0.9;
  const want = Math.atan2(t.x - e.x, t.z - e.z), cur = Math.atan2(e.atkDx, e.atkDz), a = cur + clamp(turnTo(cur, want), -steer * dt, steer * dt);
  e.atkDx = Math.sin(a); e.atkDz = Math.cos(a); e.yaw = a;
  const sp = e.heldT > 0 ? 0 : atk.speed * (atk.id === 'charge' ? Math.min(1, 0.35 + e.stateT * 1.6) : 1);
  const nx = e.x + e.atkDx * sp * dt, nz = e.z + e.atkDz * sp * dt;
  e.speed = sp;
  if (sim.env.blocked(nx + e.atkDx * e.def.radius, nz + e.atkDz * e.def.radius, 0.3)) {
    // head first into a trunk
    if (atk.id === 'charge' && sp > 6) { e.stunT = 2.6; e.weakT = 2.6; sim.emit({ t: 'hit', id: e.id, what: 'crash', x: nx, y: e.y + 1, z: nz, n: 0 }); sim.noise(e.x, e.z, 18, e.id); }
    return true;
  }
  e.x = nx; e.z = nz; e.atkGone += sp * dt;
  const d = dist2(e.x, e.z, t.x, t.z), hitR = e.def.radius + (atk.id === 'charge' ? 0.75 : 0.65);
  if (atk.id === 'charge' && e.shock === 1) {
    // a bluff: it pulls up a few strides short, and the next one is real
    if (d < 4.2) { e.shock = 0; sim.emit({ t: 'sound', what: 'bluff', x: e.x, z: e.z, id: e.id }); return true; }
    return e.atkGone >= atk.reach || e.stateT >= atk.active;
  }
  if (!e.atkHit && d < hitR) {
    e.atkHit = true;
    if (t.ally) sim.hurtAlly(atk.dmg, e);
    else {
      const r = sim.hurtPlayer(atk.dmg, e.x, e.z, atk.knock, atk.id, e);
      if (r === 'parried') return false; // hurtPlayer already put it in a stagger
      if (r === 'dodged') { e.atkHit = atk.id !== 'charge'; e.weakT = Math.max(e.weakT, atk.open * 1.3); }
    }
    if (atk.id !== 'charge') return true;
  }
  if (atk.id === 'charge') { const pdx = p.x - e.x, pdz = p.z - e.z; if (pdx * e.atkDx + pdz * e.atkDz < -4.5) return true; }
  return e.atkGone >= atk.reach || e.stateT >= atk.active;
}

function endStrike(sim: CombatSim, e: Enemy) {
  const atk = e.atk;
  setState(sim, e, 'recover');
  if (atk) { e.weakT = Math.max(e.weakT, atk.open); e.cd = atk.cooldown / (sim.tune.aggression * mods(e).speed); }
}

function fleeFrom(sim: CombatSim, e: Enemy, x: number, z: number, dt: number, speed: number) {
  let dx = e.x - x, dz = e.z - z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  move(sim, e, e.x + dx * 8 + dz * e.side * 2, e.z + dz * 8 - dx * e.side * 2, speed, dt);
  return d;
}

export function think(sim: CombatSim, e: Enemy, dt: number) {
  const def = e.def, p = sim.player;
  e.stateT += dt;
  e.cd = Math.max(0, e.cd - dt);
  e.weakT = Math.max(0, e.weakT - dt);
  e.heldT = Math.max(0, e.heldT - dt);
  e.provoked = Math.max(0, e.provoked - dt);
  e.poise = Math.max(0, e.poise - dt * 6);
  if (e.dead) { e.deadT += dt; e.speed = 0; if (e.deadT > 7) e.gone = true; return; }
  if (e.inert) { e.speed = 0; e.stunT = 0; if (e.state === 'stagger' && e.stateT > 0.6) e.state = 'idle'; e.vx = e.vz = 0; return; }
  // what is left of a knock
  if (e.vx || e.vz) {
    const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
    if (!sim.env.blocked(nx, nz, def.radius * 0.7)) { e.x = nx; e.z = nz; }
    const k = Math.exp(-dt * 7); e.vx *= k; e.vz *= k;
    if (Math.abs(e.vx) + Math.abs(e.vz) < 0.05) e.vx = e.vz = 0;
  }
  e.y = sim.env.height(e.x, e.z);
  if (e.stunT > 0) { e.stunT -= dt; e.speed = 0; if (e.stunT <= 0 && e.state !== 'stagger' && e.state !== 'dormant') setState(sim, e, 'recover'); return; }
  if (e.state === 'stagger') { e.speed = 0; if (e.stateT > 0.95) setState(sim, e, e.routed ? 'flee' : 'idle'); return; }
  if (e.state !== 'dormant' && def.temperament !== 'ambush') sense(sim, e, dt);
  // keep a body's width from the rest of the pack
  if (def.walk > 0 && e.state !== 'strike') for (const o of sim.enemies) {
    if (o === e || o.dead || o.gone) continue;
    const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot(dx, dz), min = (def.radius + o.def.radius) * 0.9;
    if (d < min && d > 1e-3 && def.mass <= o.def.mass * 4) { const k = ((min - d) / d) * 0.5; e.x += dx * k; e.z += dz * k; }
  }
  const awake = def.active === 'both' || (def.active === 'night') === sim.night;
  if (e.state === 'asleep') {
    e.speed = 0;
    if (e.alert >= 1 || (awake && !e.sleeper)) { e.sleeper = false; setState(sim, e, 'idle'); sim.emit({ t: 'sound', what: 'wake:' + e.kind, x: e.x, z: e.z }); }
    return;
  }
  if (e.routed && e.state !== 'flee') setState(sim, e, 'flee');
  if (e.state === 'flee' && e.routed) {
    const d = fleeFrom(sim, e, p.x, p.z, dt, def.run);
    if (d > 48 || e.stateT > 9) e.gone = true;
    return;
  }
  switch (def.temperament) {
    case 'prey': prey(sim, e, dt); break;
    case 'skittish': skittish(sim, e, dt, awake); break;
    case 'stalker': stalker(sim, e, dt, awake); break;
    case 'territorial': territorial(sim, e, dt, awake); break;
    case 'ambush': ambush(sim, e, dt); break;
    case 'machine': machine(sim, e, dt); break;
  }
}

// ---------------- the hunted ----------------
function prey(sim: CombatSim, e: Enemy, dt: number) {
  const p = sim.player, def = e.def;
  if (e.state === 'idle') {
    wander(sim, e, dt, 7, def.walk);
    // head down, eating: it sees less
    if (e.aware) setState(sim, e, 'flee'); else if (e.alert > 0.4) setState(sim, e, 'investigate');
  } else if (e.state === 'investigate') {
    e.speed = 0; faceTo(e, e.lkx, e.lkz, dt);
    if (e.aware) setState(sim, e, 'flee'); else if (e.alert < 0.2 && e.stateT > 1.5) setState(sim, e, 'idle');
  } else if (e.state === 'flee') {
    const d = fleeFrom(sim, e, p.x, p.z, dt, def.run);
    if (d > 36 || e.stateT > 7) {
      e.escapes++; e.homeX = e.x; e.homeZ = e.z; e.alert = 0.2; e.aware = false;
      // three frights and it is gone for the day
      if (e.escapes >= 3) { e.routed = true; sim.emit({ t: 'fled', id: e.id, what: e.kind, x: e.x, z: e.z }); }
      setState(sim, e, e.routed ? 'flee' : 'idle');
    }
  } else setState(sim, e, 'idle');
}

// ---------------- the scavenger pack ----------------
function skittish(sim: CombatSim, e: Enemy, dt: number, awake: boolean) {
  const p = sim.player, def = e.def, atk = def.attacks[0];
  const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
  if (e.state === 'windup') { const t = targetPos(sim, e); faceTo(e, t.x, t.z, dt, 2); e.speed = 0; if (e.stateT >= e.warned) { e.atkDx = Math.sin(e.yaw); e.atkDz = Math.cos(e.yaw); setState(sim, e, 'strike'); sim.emit({ t: 'sound', what: 'nip', x: e.x, z: e.z }); } return; }
  if (e.state === 'strike') { if (strikeBody(sim, e, dt)) endStrike(sim, e); return; }
  if (e.state === 'recover') { e.speed = 0; if (e.stateT > (e.atk?.recover ?? 0.6)) { e.atk = null; setState(sim, e, 'flee'); e.wander = 1.4; } return; }
  if (e.state === 'call') {
    e.speed = 0;
    if (e.stateT < dt * 1.5) {
      sim.emit({ t: 'sound', what: 'shriek', x: e.x, z: e.z, id: e.id });
      sim.noise(e.x, e.z, 24, e.id);
      for (const o of sim.enemies) if (o.pack === e.pack && o !== e && !o.dead && !o.routed) { o.alert = 1.2; o.aware = true; o.lkx = p.x; o.lkz = p.z; o.provoked = 8; }
    }
    if (e.stateT > 0.6) { setState(sim, e, 'flee'); e.wander = 2.4; }
    return;
  }
  if (e.state === 'flee') {
    // a short dart away (wander holds how long), or home with what it stole
    if (e.carrying) { const dh = move(sim, e, e.homeX, e.homeZ, def.run, dt); if (dh < 1.5 || e.stateT > 8) { e.carrying = false; setState(sim, e, 'idle'); } return; }
    fleeFrom(sim, e, p.x, p.z, dt, def.run);
    e.wander -= dt;
    if (e.wander <= 0 || d > 16) setState(sim, e, e.aware ? 'stalk' : 'idle');
    return;
  }
  // how brave the pack feels
  let near = 0;
  for (const o of sim.enemies) if (o.kind === e.kind && !o.dead && !o.routed && !o.gone && dist2(o.x, o.z, e.x, e.z) < 12) near++;
  const facing = (-dx * p.fx - dz * p.fz) / d > 0.6;
  const torch = sim.fires.some((f) => f.torch);
  e.courage = (0.22 * near + (p.hp < 40 ? 0.25 : 0) + (sim.night ? 0.12 : 0) + (e.provoked > 0 ? 0.3 : 0) - (torch ? 0.6 : 0) - (facing && d < 7 ? 0.2 : 0) + (p.down ? 0.4 : 0)) * sim.tune.aggression;
  // food first
  let food = null as null | { x: number; z: number; id: number; food: number };
  let fd = def.smell;
  for (const s of sim.scents) { const ds = dist2(e.x, e.z, s.x, s.z); if (ds < fd && s.food > 0) { fd = ds; food = s; } }
  if (!awake && !e.aware && !food) { setState(sim, e, 'asleep'); return; }
  if (e.state === 'feed') {
    if (!food) { setState(sim, e, e.aware ? 'stalk' : 'idle'); return; }
    // someone big walks at it: it backs off, and comes again
    if (d < 4.2 && facing && e.courage < 0.9) { setState(sim, e, 'flee'); e.wander = 1.6; return; }
    const df = move(sim, e, food.x, food.z, def.run * 0.8, dt);
    if (df < 0.9) {
      e.speed = 0; e.atkGone += dt;
      if (e.atkGone > 2.4) {
        e.atkGone = 0; food.food -= 1; sim.stats.foodLost++;
        sim.emit({ t: 'beat', what: 'foodStolen', id: e.id, x: food.x, z: food.z, n: food.food });
        if (food.food <= 0) { sim.scents = sim.scents.filter((s) => s !== food); for (const tr of sim.traps) if (tr.scent === food.id) tr.armed = false; }
        e.carrying = true; setState(sim, e, 'flee');
      }
    } else e.atkGone = 0;
    return;
  }
  if (food && e.cd < 2) { e.atkGone = 0; setState(sim, e, 'feed'); return; }
  if (e.state === 'idle' || e.state === 'investigate') {
    if (e.aware) setState(sim, e, 'stalk');
    else if (e.alert > 0.4) { setState(sim, e, 'investigate'); move(sim, e, e.lkx, e.lkz, def.walk * 1.5, dt); }
    else { if (e.state !== 'idle') setState(sim, e, 'idle'); wander(sim, e, dt, 8, def.walk); }
    return;
  }
  // stalk: hang at the edge of reach, in and out, and go in when the pack is brave enough
  if (!e.aware) { setState(sim, e, 'idle'); return; }
  const a = sim.ally;
  e.target = a && !a.down && d > 9 && dist2(e.x, e.z, a.x, a.z) < 14 && e.courage >= 0.75 ? -2 : -1;
  const t = targetPos(sim, e), dt2 = dist2(e.x, e.z, t.x, t.z);
  if (e.courage >= 0.75 && e.cd <= 0 && sheltered(sim, t.x, t.z) < 1) {
    if (dt2 <= atk.max) { beginAttack(sim, e, atk, t.x, t.z); return; }
    move(sim, e, t.x, t.z, def.run, dt);
    return;
  }
  if (d < 4 && e.courage < 0.75) { setState(sim, e, 'flee'); e.wander = 1.2; return; }
  e.angle += e.side * 0.55 * dt;
  move(sim, e, p.x + Math.cos(e.angle) * 7.5, p.z + Math.sin(e.angle) * 7.5, def.run * 0.6, dt);
}

// ---------------- the night hunter ----------------
function stalker(sim: CombatSim, e: Enemy, dt: number, awake: boolean) {
  const p = sim.player, def = e.def, atk = def.attacks[0];
  const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
  if (e.state === 'windup') {
    const t = targetPos(sim, e);
    // prey on the move is leapt at on the move: it gathers itself while it runs
    if (!t.ally && p.speed > 2 && dist2(e.x, e.z, t.x, t.z) > 3) move(sim, e, t.x, t.z, def.run, dt, { fire: false }); else { faceTo(e, t.x, t.z, dt, 1.5); e.speed = 0; }
    if (e.stateT >= e.warned) { const l = Math.hypot(t.x - e.x, t.z - e.z) || 1; e.atkDx = (t.x - e.x) / l; e.atkDz = (t.z - e.z) / l; setState(sim, e, 'strike'); sim.emit({ t: 'sound', what: 'lunge', x: e.x, z: e.z }); }
    return;
  }
  if (e.state === 'strike') {
    // through a real fire it does not go: it breaks off
    if (!targetPos(sim, e).ally && sheltered(sim, e.x, e.z) > 1.2) { sim.hurtEnemy(e, 4, 'fire', e.x + e.atkDx, e.z + e.atkDz, 0, 0, 'trap'); return; }
    if (strikeBody(sim, e, dt)) endStrike(sim, e);
    return;
  }
  if (e.state === 'recover') { e.speed = 0; if (e.stateT > (e.atk?.recover ?? 1)) { const nip = e.atk?.id === 'nip'; e.atk = null; setState(sim, e, nip ? 'flee' : e.aware ? 'stalk' : 'idle'); if (nip) e.stateT = 2.2; e.angle = Math.atan2(e.z - p.z, e.x - p.x); } return; }
  if (e.state === 'flee') { fleeFrom(sim, e, p.x, p.z, dt, def.run); if (e.stateT > 3.2) { setState(sim, e, 'stalk'); e.angle = Math.atan2(e.z - p.z, e.x - p.x); } return; }
  if (!awake && !e.aware && e.provoked <= 0 && e.alert < 0.3) { setState(sim, e, 'asleep'); return; }
  if (e.state === 'idle' || e.state === 'investigate') {
    if (e.aware) { setState(sim, e, 'stalk'); e.angle = Math.atan2(e.z - p.z, e.x - p.x); sim.emit({ t: 'sound', what: 'growl', x: e.x, z: e.z }); return; }
    // it goes to look, and it looks for a while before it lets it go
    const dl0 = dist2(e.x, e.z, e.lkx, e.lkz);
    if (e.alert > 0.35 || (e.state === 'investigate' && e.stateT < 14 && (dl0 > 1.2 || e.wander > 0))) {
      if (e.state !== 'investigate') { setState(sim, e, 'investigate'); e.wander = 3; }
      const dl = move(sim, e, e.lkx, e.lkz, def.walk * 1.4, dt);
      if (dl < 1.2) { e.speed = 0; e.wander -= dt; e.yaw += Math.sin(e.stateT * 1.7) * dt * 1.5; }
    } else { if (e.state !== 'idle') setState(sim, e, 'idle'); wander(sim, e, dt, 10, def.walk); }
    return;
  }
  // stalk
  if (!e.aware) { setState(sim, e, 'investigate'); return; }
  // crowded, it snaps and springs away
  if (d < 3.3 && e.cd <= 0.7 && !p.down) { e.target = -1; beginAttack(sim, e, def.attacks[1], p.x, p.z); return; }
  const a = sim.ally;
  const lookDot = (-dx * sim.lookX - dz * sim.lookZ) / d;
  const watched = lookDot > 0.9 && d < 20;
  // round to where you are not looking
  const behind = Math.atan2(-sim.lookZ, -sim.lookX), turn = turnTo(e.angle, behind);
  if (Math.abs(turn) > 0.25) { if (Math.abs(turn) < 2.6) e.side = Math.sign(turn); e.angle += e.side * 0.55 * sim.tune.aggression * dt * (watched ? 0.3 : 1); }
  // prey that moves away is followed closer before the leap: a leap from ten metres never catches a runner
  const R = 10 - Math.min(5.5, p.speed);
  const tx = p.x + Math.cos(e.angle) * R, tz = p.z + Math.sin(e.angle) * R;
  // prey that runs is chased: straight after it, flat out
  if (d > 14) { move(sim, e, p.x, p.z, def.run, dt); e.angle = Math.atan2(e.z - p.z, e.x - p.x); }
  else move(sim, e, tx, tz, watched ? def.walk * 0.5 : def.run * 0.62, dt);
  if (!watched || d > 12) faceTo(e, p.x, p.z, dt, 0.3);
  // the clock to the leap runs slower while you stare it down
  e.atkGone += dt * (watched ? 0.45 : 1);
  const patience = e.atkGone * sim.tune.aggression;
  const pShelter = sheltered(sim, p.x, p.z);
  if (e.cd <= 0 && patience > 2.2) {
    if (pShelter < 0.8) {
      if (d >= atk.min * 0.6 && d <= atk.max - p.speed * 0.9 && (lookDot < 0.25 || patience > 6.5)) { e.target = -1; e.atkGone = 0; beginAttack(sim, e, atk, p.x, p.z); return; }
    } else if (a && !a.down && sheltered(sim, a.x, a.z) < 0.8 && dist2(e.x, e.z, a.x, a.z) <= atk.max) {
      // you are safe in the light. Whoever is with you is not.
      e.target = -2; e.atkGone = 0; beginAttack(sim, e, atk, a.x, a.z); return;
    } else if (patience > 9) { e.atkGone = 3; sim.emit({ t: 'sound', what: 'howl', x: e.x, z: e.z }); }
  }
}

// ---------------- the big grazer ----------------
function territorial(sim: CombatSim, e: Enemy, dt: number, awake: boolean) {
  const p = sim.player, def = e.def, atk = def.attacks[0];
  const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
  if (d > 20) e.provoked = Math.max(0, e.provoked - dt * 2);
  if (e.state === 'windup') {
    faceTo(e, p.x, p.z, dt, 2); e.speed = 0;
    if (e.stateT >= e.warned) { e.atkDx = Math.sin(e.yaw); e.atkDz = Math.cos(e.yaw); setState(sim, e, 'strike'); sim.emit({ t: 'sound', what: 'charge', x: e.x, z: e.z }); sim.noise(e.x, e.z, 20, e.id); }
    return;
  }
  if (e.state === 'strike') { if (strikeBody(sim, e, dt)) endStrike(sim, e); return; }
  if (e.state === 'recover') { e.speed = 0; if (e.stateT > atk.recover) { e.atk = null; setState(sim, e, 'idle'); } return; }
  if (e.state === 'warn') {
    e.speed = 0; faceTo(e, p.x, p.z, dt, 1.5);
    // the first answer to someone who will not back off is a bluff: a charge that stops short
    if (e.stateT > 1.6 * sim.tune.telegraph) { if (d < 6.5 && !p.down) { e.provoked = 14; e.shock = e.escapes === 0 ? 1 : 0; e.escapes = 1; } e.warned = 6; setState(sim, e, 'idle'); }
    return;
  }
  if (!awake && e.provoked <= 0 && !e.aware) { setState(sim, e, 'asleep'); return; }
  if (e.provoked > 0 && !p.down) {
    if (e.cd <= 0 && d <= atk.max) { if (d < atk.min) { faceTo(e, p.x, p.z, dt, 2); if (Math.abs(turnTo(e.yaw, Math.atan2(dx, dz))) < 0.5) beginAttack(sim, e, atk, p.x, p.z); } else beginAttack(sim, e, atk, p.x, p.z); }
    else { faceTo(e, p.x, p.z, dt); e.speed = 0; }
    return;
  }
  // it tells you once, loudly
  e.warned = Math.max(0, e.warned - dt);
  if (e.aware && !p.down) {
    if (p.speed > 5.5 && d < 7) { e.provoked = 14; return; }
    if (d < 8 && e.warned <= 0) { setState(sim, e, 'warn'); sim.emit({ t: 'telegraph', id: e.id, what: 'warn', dur: 1.6 * sim.tune.telegraph, x: e.x, z: e.z, r: 6.5 }); sim.emit({ t: 'sound', what: 'snort', x: e.x, z: e.z }); return; }
  }
  wander(sim, e, dt, 9, def.walk);
}

// ---------------- the plant ----------------
function ambush(sim: CombatSim, e: Enemy, dt: number) {
  const p = sim.player, atk = e.def.attacks[0];
  const d = dist2(e.x, e.z, p.x, p.z);
  e.speed = 0;
  if (e.state === 'windup') {
    if (e.stateT >= e.warned) {
      setState(sim, e, 'strike');
      if (d <= atk.reach && !p.down) {
        const r = sim.hurtPlayer(atk.dmg, e.x, e.z, 0, 'lash', e);
        if (r === 'hit') { p.snareT = 1.7; sim.emit({ t: 'player', what: 'snared', x: p.x, z: p.z }); }
      }
      sim.clouds.push({ x: e.x, z: e.z, r: 3, left: 5 });
      sim.emit({ t: 'sound', what: 'spore', x: e.x, z: e.z });
    }
    return;
  }
  if (e.state === 'strike') { if (e.stateT >= atk.active) endStrike(sim, e); return; }
  if (e.state === 'recover') { if (e.stateT > atk.recover) { e.atk = null; setState(sim, e, 'idle'); } return; }
  if (e.state !== 'idle') { setState(sim, e, 'idle'); return; }
  // it feels the ground: a careful step passes, a careless one does not
  let felt = !p.down && d < (p.sneaking ? 1.25 : sim.night ? 3.2 : 2.7) && (p.speed > 0.3 || d < 1.25);
  for (const n of sim.noises) { if (n.t > e.noiseSeen && n.from !== e.id && dist2(e.x, e.z, n.x, n.z) < Math.min(3.2, n.r)) felt = true; }
  e.noiseSeen = sim.t;
  // what it felt stays with it for a moment
  if (felt) e.alert = 1; else e.alert = Math.max(0, e.alert - dt);
  if (e.alert > 0.2 && e.cd <= 0) { e.yaw = Math.atan2(p.x - e.x, p.z - e.z); beginAttack(sim, e, atk, p.x, p.z); }
}

// ---------------- the machine ----------------
function machine(sim: CombatSim, e: Enemy, dt: number) {
  const p = sim.player, def = e.def, m = mods(e);
  const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
  if (e.state === 'dormant') {
    e.speed = 0;
    // it stands until something comes too close or strikes it
    if (!e.sleeper && d < 4.5 && !p.down) { setState(sim, e, 'idle'); e.cd = 1.6; sim.emit({ t: 'state', id: e.id, what: 'wake', x: e.x, z: e.z }); }
    return;
  }
  e.aware = true; e.alert = 1.2;
  const atk = e.atk;
  if (e.state === 'windup' && atk) {
    e.speed = 0;
    if (atk.id === 'beam') faceTo(e, p.x, p.z, dt, 0.42);
    if (e.stateT >= e.warned) { setState(sim, e, 'strike'); sim.emit({ t: 'sound', what: atk.id, x: e.x, z: e.z }); }
    return;
  }
  if (e.state === 'strike' && atk) {
    e.speed = 0;
    if (atk.id === 'beam') {
      // overclocked, the beam sweeps after you
      if (e.phase > 0) faceTo(e, p.x, p.z, dt, 0.5);
      const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), along = dx * fx + dz * fz, off = Math.abs(dx * fz - dz * fx);
      if (!e.atkHit && along > 0.5 && along < atk.reach && off < 0.85 && los(sim, e.x, e.z, p.x, p.z)) { if (sim.hurtPlayer(atk.dmg, e.x, e.z, atk.knock, 'beam', e) !== 'dodged') e.atkHit = true; }
    } else {
      const ring = atk.reach * Math.min(1, e.stateT / atk.active);
      if (!e.atkHit && !p.air && Math.abs(d - ring) < 0.9) { if (sim.hurtPlayer(atk.dmg, e.x, e.z, atk.knock, 'stomp', e) !== 'dodged') e.atkHit = true; }
    }
    if (e.stateT >= atk.active) endStrike(sim, e);
    return;
  }
  if (e.state === 'recover') { e.speed = 0; if (e.stateT > (atk?.recover ?? 1.2)) { e.atk = null; setState(sim, e, 'idle'); } return; }
  if (e.state !== 'idle') setState(sim, e, 'idle');
  if (p.down) { e.speed = 0; return; }
  faceTo(e, p.x, p.z, dt);
  if (d > 11) move(sim, e, p.x, p.z, def.walk * m.speed, dt); else if (d < 6) move(sim, e, e.x - dx, e.z - dz, def.walk * 0.6 * m.speed, dt); else e.speed = 0;
  if (e.cd <= 0) {
    const stomp = def.attacks[0], beam = def.attacks[1];
    if (d <= stomp.max) beginAttack(sim, e, stomp, p.x, p.z);
    else if (d <= beam.max && Math.abs(turnTo(e.yaw, Math.atan2(dx, dz))) < 0.5) beginAttack(sim, e, beam, p.x, p.z);
  }
}
