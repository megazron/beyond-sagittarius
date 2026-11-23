// Frame-by-frame checks of how the weapons are held and swung (src/combat/view/melee.ts), on a stand-in skeleton of
// the player's proportions: for every weapon held in the hand, through carry, raise, every attack, a block, a throw
// and its follow-through, and abrupt changes between them, at 60 frames a second:
//  - the shaft never inside the body (legs and coat, chest, head), and the arms not through the chest;
//  - the right hand on the grip and the left hand on the shaft whenever the pose says both hands hold it;
//  - no pops: neither hand moves faster than a fast human hand (12 m/s; 18 in the blow or release itself) and the shaft never turns more than a
//    quarter turn in a frame.
// node --experimental-strip-types tools/combat/pose_test.ts   (prints the worst numbers per weapon)
import * as THREE from 'three';
import { MELEE_GEAR, SHAFT, clearShaft, targetFrame, solveArms, follow, newFrame, copyFrame, depth } from '../../src/combat/view/melee.ts';
import type { ActState, Skel } from '../../src/combat/view/melee.ts';
import { WEAPONS } from '../../src/combat/sim/weapons.ts';
import type { WeaponId } from '../../src/combat/sim/weapons.ts';

let pass = 0, fail = 0;
const ok = (c: boolean, what: string, info = '') => { if (c) pass++; else { fail++; console.log('FAIL ' + what + (info ? '  ' + info : '')); } };

const DT = 1 / 60;
const SH = { x: 0.19, y: 1.42, z: -0.01 };
function skel(bend: number, twist: number): Skel {
  // the shoulders turn with the chest and lean with the bend (pivot about the waist, 0.47 m below)
  const r = (side: number) => { const v = new THREE.Vector3(side * SH.x, SH.y - 0.95, SH.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), twist).applyAxisAngle(new THREE.Vector3(1, 0, 0), bend * 0.9); v.y += 0.95; return v; };
  return { sL: r(1), sR: r(-1), a: 0.28, b: 0.25, palm: 0.07 };
}

type Step = Partial<ActState> & { t: number };
/** A timeline: a list of states held for t seconds (actT runs within each). */
function timeline(w: WeaponId): Step[][] {
  const m = WEAPONS[w].melee, out: Step[][] = [];
  const atk = (combo: number): Step[] => m ? [
    { act: 'windup', combo, t: m.windup }, { act: 'active', combo, t: m.active }, { act: 'recover', combo, t: m.recover }] : [];
  out.push([{ up: 0, t: 0.5 }, { up: 1, t: 0.6 }, ...atk(0), ...atk(1), { up: 1, t: 0.3 }, { up: 0, t: 0.6 }]);
  // straight from carry into a blow, and an attack cut off by a block, then a roll's worth of nothing
  out.push([{ up: 0, t: 0.2 }, ...atk(0).slice(0, 2), { blocking: true, t: 0.5 }, { up: 1, t: 0.3 }]);
  // a throw: draw, release, follow-through, back to carry
  out.push([{ up: 1, t: 0.3 }, { act: 'charge', t: 0.8 }, { thrown: true, t: 0.6 }, { up: 0, t: 0.5 }]);
  return out;
}

for (const w of MELEE_GEAR) {
  const m = WEAPONS[w]?.melee;
  let wTurn = '', wArm = '', wMiss = '', worstPen = 0, worstArm = 0, worstMissR = 0, worstMissL = 0, worstV = 0, worstTurn = 0, frames = 0, both = 0;
  for (const tl of timeline(w)) {
    const cur = newFrame(), tgt = newFrame(), tmp = newFrame();
    let lPrev: number | null = null, up = 0, prevR: THREE.Vector3 | null = null, prevL: THREE.Vector3 | null = null, prevD: THREE.Vector3 | null = null, first = true, since = 9;
    for (const st of tl) {
      for (let tt = 0; tt < st.t; tt += DT) {
        up += ((st.up ?? (st.act && st.act !== 'idle' ? 1 : up)) - up) * (1 - Math.exp(-DT * 9));
        if (st.thrown) since += DT; else since = st.act === 'charge' ? 0 : 9;
        const s: ActState = { weapon: w, act: st.act ?? 'idle', actT: tt, combo: st.combo ?? 0, charge: Math.min(1, tt / 0.6), charging: 'throw', blocking: !!st.blocking, blockT: tt, up, since: st.thrown ? since : 9, thrown: !!st.thrown, windup: m?.windup ?? 0.3, active: m?.active ?? 0.1, recover: m?.recover ?? 0.4 };
        targetFrame(s, tgt, tmp); clearShaft(tgt, w);
        if (first) { copyFrame(tgt, cur); first = false; } else follow(cur, tgt, DT, 0.04, s.act === 'active' || (s.thrown && since < 0.2) ? 60 : 24);
        const f = copyFrame(cur, newFrame());
        const r = solveArms(f, w, skel(f.bend, f.twist), 1, 1, lPrev, DT); lPrev = r.f.l;
        frames++;
        worstPen = Math.max(worstPen, r.penetration); worstArm = Math.max(worstArm, r.armIn);
        worstMissR = Math.max(worstMissR, r.missR);
        if (r.f.l !== null) { both++; worstMissL = Math.max(worstMissL, r.missL); }
        if (prevR) { const fastV = s.act === 'active' || (s.thrown && since < 0.2); worstV = Math.max(worstV, Math.max(r.wR.distanceTo(prevR), prevL!.distanceTo(r.wL)) / DT * (fastV ? 12 / 18 : 1)); }
        // a blow or a release is fast on purpose (a club turns ~150 degrees in a tenth of a second): there a frame may
        // turn up to 65 degrees; anywhere else more than 30 in a frame is a pop
        const fast = s.act === 'active' || (s.thrown && since < 0.2);
        if (prevD) { const a = prevD.angleTo(r.f.d) * (fast ? 30 / 65 : 1); if (a > worstTurn) { worstTurn = a; wTurn = `${s.act} ${tt.toFixed(2)}`; } }
        if (r.armIn >= worstArm) wArm = `${s.act} up ${up.toFixed(2)} block ${s.blocking} t ${tt.toFixed(2)} l ${r.f.l}`;
        if (r.f.l !== null && r.missL >= worstMissL) wMiss = `${s.act} up ${up.toFixed(2)} block ${s.blocking} t ${tt.toFixed(2)} l ${r.f.l?.toFixed(2)}`;
        if (process.env.POSE_DEBUG === w) { const vR = prevR ? r.wR.distanceTo(prevR) / DT : 0, vL = prevL ? r.wL.distanceTo(prevL) / DT : 0; if (r.armIn > 0.01 || (r.f.l !== null && r.missL > 0.02) || vR > 12 || vL > 12) console.log(`  ${s.act} up ${up.toFixed(2)} thrown ${s.thrown} t ${tt.toFixed(2)} g ${r.f.g.toArray().map((x) => x.toFixed(2))} d ${r.f.d.toArray().map((x) => x.toFixed(2))} l ${r.f.l?.toFixed(2)} lh ${r.f.lh.toArray().map((x) => x.toFixed(2))} armIn ${(r.armIn * 100).toFixed(1)} missL ${(r.missL * 100).toFixed(1)} vR ${vR.toFixed(1)} vL ${vL.toFixed(1)}`); }
        prevR = r.wR.clone(); prevL = r.wL.clone(); prevD = r.f.d.clone();
        // the drawn shaft, checked again on its own (not what the solver says of itself)
        const S = SHAFT[w]!;
        for (let k = -S.back; k <= S.front; k += 0.02) worstPen = Math.max(worstPen, depth(r.f.g.clone().addScaledVector(r.f.d, k), r.f.bend, S.r));
      }
    }
  }
  console.log(`${w.padEnd(10)} frames ${frames} (both hands ${both})  shaft in body ${(worstPen * 100).toFixed(1)} cm  arm in chest ${(worstArm * 100).toFixed(1)} cm  right hand off ${(worstMissR * 100).toFixed(1)} cm  left hand off ${(worstMissL * 100).toFixed(1)} cm  hand speed ${worstV.toFixed(1)} m/s  shaft turn ${(worstTurn * 57.3).toFixed(0)} deg/frame`);
  ok(worstPen <= 0.003, `${w}: the shaft stays out of the body`, `${(worstPen * 100).toFixed(1)} cm`);
  ok(worstArm <= 0.01, `${w}: the arms stay out of the chest`, `${(worstArm * 100).toFixed(1)} cm at ${wArm}`);
  ok(worstMissR <= 0.02, `${w}: the right hand stays on the grip`, `${(worstMissR * 100).toFixed(1)} cm`);
  ok(worstMissL <= 0.02, `${w}: the left hand stays on the shaft while it holds it`, `${(worstMissL * 100).toFixed(1)} cm at ${wMiss}`);
  ok(worstV <= 12, `${w}: no hand jumps (12 m/s; 18 in a blow or a release, a thrower's hand)`, `${worstV.toFixed(1)} m/s`);
  ok(worstTurn <= Math.PI / 6, `${w}: the shaft never snaps round (30 deg a frame; 65 in a blow)`, `${(worstTurn * 57.3).toFixed(0)} deg (scaled) at ${wTurn}`);
}
console.log(`\npose: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
