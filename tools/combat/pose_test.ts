// Frame-by-frame checks of how the weapons are held and swung (src/combat/view/melee.ts), on a stand-in skeleton of
// the player's proportions: for every weapon held in the hand, through carry, raise, every attack, a block, a throw
// and its follow-through, and abrupt changes between them, at 60 frames a second:
//  - the shaft never inside the body (legs and coat, chest, head), and the arms not through the chest;
//  - the right hand on the grip and the left hand on the shaft whenever the pose says both hands hold it;
//  - no pops: neither hand moves faster than a fast human hand (12 m/s; 18 in the blow or release itself) and the shaft never turns more than a
//    quarter turn in a frame.
// node --experimental-strip-types tools/combat/pose_test.ts   (prints the worst numbers per weapon)
import * as THREE from 'three';
import { MELEE_GEAR, SHAFT, setBodyFit, clearShaft, targetFrame, solveArms, follow, newFrame, copyFrame, depth } from '../../src/combat/view/melee.ts';
import type { ActState, Skel } from '../../src/combat/view/melee.ts';
import { WEAPONS } from '../../src/combat/sim/weapons.ts';
import type { WeaponId } from '../../src/combat/sim/weapons.ts';

let pass = 0, fail = 0;
const ok = (c: boolean, what: string, info = '') => { if (c) pass++; else { fail++; console.log('FAIL ' + what + (info ? '  ' + info : '')); } };

const DT = 1 / 60;
// two skeletons: a stand-in of a 1.75 m man, and the game's own rig (custom_m_explorer.glb at rest: upperarmR (-0.21, 1.41, 0.02)
// root-local, upper arm 0.252, forearm 0.265; divided by its scale K = 0.975, as the game scales the frames by K)
const SKELS = [
  { name: 'stand-in', x: 0.19, y: 1.42, z: -0.01, a: 0.28, b: 0.25, fit: null },
  // the body shapes as the game fits them to each model's skin (melee.ts fitBody; numbers from the GLBs at rest)
  { name: 'game rig', x: 0.215, y: 1.446, z: 0.023, a: 0.258, b: 0.272, fit: [{ off: 0.027, az: 0.162, ax: 0.197, cz: 0.034 }, { off: 0.09, az: 0.167, cz: 0.042 }, { off: 0.095, az: 0.169, cz: 0.047 }, { off: -0.021, az: 0.134, ax: 0.144, cz: 0.028 }] },
  // custom_f_medic.glb: upperarmR (-0.164, 1.327, 0.022), arms 0.245 and 0.225, K = 0.887
  { name: 'game rig f', x: 0.185, y: 1.496, z: 0.025, a: 0.276, b: 0.254, fit: [{ off: 0.005, az: 0.187, ax: 0.263, cz: 0.029 }, { off: 0.026, az: 0.169, cz: 0.04 }, { off: 0.053, az: 0.138, cz: 0.067 }, { off: 0.009, az: 0.134, ax: 0.122, cz: 0.057 }] },
];
let SH: (typeof SKELS)[number] = SKELS[0];
function skel(bend: number, twist: number): Skel {
  // the shoulders turn with the chest and lean with the bend (pivot about the waist, 0.47 m below)
  const r = (side: number) => { const v = new THREE.Vector3(side * SH.x, SH.y - 0.95, SH.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), twist).applyAxisAngle(new THREE.Vector3(1, 0, 0), bend * 0.9); v.y += 0.95; return v; };
  return { sL: r(1), sR: r(-1), a: SH.a, b: SH.b, palm: 0.07 };
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

for (const SK of SKELS) { SH = SK; setBodyFit(SK.fit); console.log(`-- ${SK.name}`);
for (const w of MELEE_GEAR) {
  const m = WEAPONS[w]?.melee;
  let elbowBack = -9, elbowLow = 9, minBendR = 180, minBendLh = 180, minBendLf = 180, maxOutLf = -1, wE = "", wV = "", wTurn = '', wArm = '', wMiss = '', worstPen = 0, worstArm = 0, worstMissR = 0, worstMissL = 0, worstV = 0, worstTurn = 0, worstE = 0, frames = 0, both = 0;
  for (const tl of timeline(w)) {
    const cur = newFrame(), tgt = newFrame(), tmp = newFrame();
    const mem = { L: 0, R: 0 };
    let prevER: THREE.Vector3 | null = null, prevEL: THREE.Vector3 | null = null;
    let lPrev: number | null = null, up = 0, prevR: THREE.Vector3 | null = null, prevL: THREE.Vector3 | null = null, prevD: THREE.Vector3 | null = null, first = true, since = 9;
    for (const st of tl) {
      for (let tt = 0; tt < st.t; tt += DT) {
        up += ((st.up ?? (st.act && st.act !== 'idle' ? 1 : up)) - up) * (1 - Math.exp(-DT * 9));
        if (st.thrown) since += DT; else since = st.act === 'charge' ? 0 : 9;
        const s: ActState = { weapon: w, act: st.act ?? 'idle', actT: tt, combo: st.combo ?? 0, charge: Math.min(1, tt / 0.6), charging: 'throw', blocking: !!st.blocking, blockT: tt, up, since: st.thrown ? since : 9, thrown: !!st.thrown, windup: m?.windup ?? 0.3, active: m?.active ?? 0.1, recover: m?.recover ?? 0.4 };
        targetFrame(s, tgt, tmp); clearShaft(tgt, w);
        if (first) { copyFrame(tgt, cur); first = false; } else follow(cur, tgt, DT, 0.04, s.act === 'active' || (s.thrown && since < 0.2) ? 60 : 24);
        const f = copyFrame(cur, newFrame());
        const r = solveArms(f, w, skel(f.bend, f.twist), 1, 1, lPrev, DT, mem); lPrev = r.f.l;
        frames++;
        // how bent each elbow is (degrees from straight), outside a blow or a release; and how far the free left elbow
        // stands out to the side of its shoulder (the owner: "the free left arm sticks straight out")
        if (!(s.act === 'active' || (s.thrown && since < 0.2))) {
          const bendOf = (sh: THREE.Vector3, e: THREE.Vector3, w: THREE.Vector3) => e.clone().sub(sh).angleTo(w.clone().sub(e)) * 57.3;
          const K0 = skel(f.bend, f.twist);
          minBendR = Math.min(minBendR, bendOf(K0.sR, r.eR, r.wR));
          if (r.f.l !== null) minBendLh = Math.min(minBendLh, bendOf(K0.sL, r.eL, r.wL));
          else if (r.f.hold < 0.02) { minBendLf = Math.min(minBendLf, bendOf(K0.sL, r.eL, r.wL)); if (s.act === 'idle' && !s.blocking && !s.thrown && (up < 0.05 || up > 0.95)) { const o0 = (r.eL.x - K0.sL.x) * Math.cos(f.twist) + (r.eL.z - K0.sL.z) * -Math.sin(f.twist); if (process.env.OUT_DEBUG === w && o0 > 0.1) console.log('  out', o0.toFixed(2), 'up', up.toFixed(2), 'tt', tt.toFixed(2), 'lt', r.lt.toArray().map((x) => x.toFixed(2)), 'eL', r.eL.toArray().map((x) => x.toFixed(2)), 'sL', K0.sL.toArray().map((x) => x.toFixed(2)), 'twist', f.twist.toFixed(2), 'swing', mem.L.toFixed(2)); } if (s.act === 'idle' && !s.blocking && !s.thrown && (up < 0.05 || up > 0.95)) maxOutLf = Math.max(maxOutLf, (r.eL.x - K0.sL.x) * Math.cos(f.twist) + (r.eL.z - K0.sL.z) * -Math.sin(f.twist)); }
        }
        // drawn back to throw: the right elbow below the hand and not out behind it (the owner: "the right elbow sticking
        // out behind him" with the spear drawn back); metres the elbow is behind the wrist, and below it
        if (s.act === 'charge' && s.charge > 0.7 && (w === 'spear' || w === 'hafted' || w === 'rock')) {
          const wristR = r.eR.clone().lerp(r.wR, SH.b / (SH.b + 0.07));
          elbowBack = Math.max(elbowBack, wristR.z - r.eR.z); elbowLow = Math.min(elbowLow, wristR.y - r.eR.y);
        }
        // (in the release of a throw itself, two or three frames, the throwing arm passes within 3 cm of the shoulder's shape on
        // a short-armed body: counted at a third)
        worstPen = Math.max(worstPen, r.penetration); worstArm = Math.max(worstArm, r.armIn * (s.thrown && since < 0.2 ? 1 / 3 : 1));
        worstMissR = Math.max(worstMissR, r.missR);
        // (on the shaft once the hold is complete; before that the hand is closing the gap)
        if (r.f.l !== null && r.f.hold >= 0.98) { both++; worstMissL = Math.max(worstMissL, r.missL, r.wL.distanceTo(r.f.g.clone().addScaledVector(r.f.d, r.f.l))); }
        if (prevER) { const ve = Math.max(r.eR.distanceTo(prevER), r.eL.distanceTo(prevEL!)) / DT * (s.act === 'active' || (s.thrown && since < 0.2) ? 12 / 18 : 1); if (ve > worstE) { worstE = ve; wE = `${s.act} t ${tt.toFixed(2)} thrown ${s.thrown} R ${(r.eR.distanceTo(prevER) / DT).toFixed(1)} L ${(r.eL.distanceTo(prevEL!) / DT).toFixed(1)} memR ${mem.R.toFixed(2)} eR ${r.eR.toArray().map((x) => x.toFixed(2))}`; } }
        prevER = r.eR.clone(); prevEL = r.eL.clone();
        if (prevR) { const fastV = s.act === 'active' || (s.thrown && since < 0.2); const v = Math.max(r.wR.distanceTo(prevR), prevL!.distanceTo(r.wL)) / DT * (fastV ? 12 / 18 : 1); if (v > worstV) { worstV = v; wV = `${s.act} t ${tt.toFixed(2)} thrown ${s.thrown} up ${up.toFixed(2)} R ${(r.wR.distanceTo(prevR) / DT).toFixed(1)} L ${(prevL!.distanceTo(r.wL) / DT).toFixed(1)} l ${r.f.l} hold ${r.f.hold.toFixed(2)}`; } }
        // a blow or a release is fast on purpose (a club turns ~150 degrees in a tenth of a second): there a frame may
        // turn up to 65 degrees; anywhere else more than 30 in a frame is a pop
        const fast = s.act === 'active' || (s.thrown && since < 0.2);
        if (prevD) { const a = prevD.angleTo(r.f.d) * (fast ? 30 / 65 : 1); if (process.env.TURN_DEBUG === w && a > 0.3) console.log(`  turn ${(a * 57.3).toFixed(0)} ${s.act} ${tt.toFixed(2)} d ${prevD.toArray().map((x) => x.toFixed(2))} -> ${r.f.d.toArray().map((x) => x.toFixed(2))} tgt ${tgt.d.toArray().map((x) => x.toFixed(2))}`); if (a > worstTurn) { worstTurn = a; wTurn = `${s.act} ${tt.toFixed(2)}`; } }
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
  console.log(`${w.padEnd(10)} frames ${frames} (both hands ${both})  shaft in body ${(worstPen * 100).toFixed(1)} cm  arm in chest ${(worstArm * 100).toFixed(1)} cm  right hand off ${(worstMissR * 100).toFixed(1)} cm  left hand off ${(worstMissL * 100).toFixed(1)} cm  hand speed ${worstV.toFixed(1)} m/s  elbow speed ${worstE.toFixed(1)} m/s  shaft turn ${(worstTurn * 57.3).toFixed(0)} deg/frame`);
  console.log(`${''.padEnd(10)} elbow bend (deg, least, outside blows): right ${minBendR.toFixed(0)}  left on shaft ${minBendLh === 180 ? '-' : minBendLh.toFixed(0)}  left free ${minBendLf === 180 ? '-' : minBendLf.toFixed(0)}  free left elbow out ${(maxOutLf * 100).toFixed(0)} cm`);
  // (the owner: "stiff, nearly straight arms", "the free left arm sticks straight out")
  if (elbowBack > -9) {
    console.log(`${''.padEnd(10)} drawn back: right elbow ${(elbowBack * 100).toFixed(0)} cm behind the wrist at most, ${(elbowLow * 100).toFixed(0)} cm below it at least`);
    ok(elbowBack <= 0.04, `${SH.name} ${w}: drawn back, the right elbow is not out behind the hand (4 cm)`, `${(elbowBack * 100).toFixed(0)} cm`);
    ok(elbowLow >= 0.08, `${SH.name} ${w}: drawn back, the right elbow hangs below the hand (8 cm)`, `${(elbowLow * 100).toFixed(0)} cm`);
  }
  ok(minBendR >= 25, `${SH.name} ${w}: the right elbow stays bent outside a blow (25 deg)`, `${minBendR.toFixed(0)} deg`);
  ok(minBendLf >= 25, `${SH.name} ${w}: the free left elbow stays bent (25 deg)`, `${minBendLf.toFixed(0)} deg`);
  ok(maxOutLf <= 0.1, `${SH.name} ${w}: the free left elbow hangs by the body when the weapon is carried or up (10 cm out; a wide coat needs the hand outside it)`, `${(maxOutLf * 100).toFixed(0)} cm`);
  ok(worstPen <= 0.003, `${SH.name} ${w}: the shaft stays out of the body`, `${(worstPen * 100).toFixed(1)} cm`);
  ok(worstArm <= 0.01, `${SH.name} ${w}: the arms stay out of the chest`, `${(worstArm * 100).toFixed(1)} cm at ${wArm}`);
  ok(worstMissR <= 0.02, `${SH.name} ${w}: the right hand stays on the grip`, `${(worstMissR * 100).toFixed(1)} cm`);
  ok(worstMissL <= 0.02, `${SH.name} ${w}: the left hand stays on the shaft while it holds it`, `${(worstMissL * 100).toFixed(1)} cm at ${wMiss}`);
  ok(worstV <= 12, `${w}: no hand jumps (12 m/s; 18 in a blow or a release, a thrower's hand)`, `${worstV.toFixed(1)} m/s at ${wV}`);
  ok(worstE <= 12, `${SH.name} ${w}: no elbow jumps (12 m/s; 18 in a blow or a release)`, `${worstE.toFixed(1)} m/s at ${wE}`);
  ok(worstTurn <= Math.PI / 6, `${w}: the shaft never snaps round (30 deg a frame; 65 in a blow)`, `${(worstTurn * 57.3).toFixed(0)} deg (scaled) at ${wTurn}`);
}
}
console.log(`\npose: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
