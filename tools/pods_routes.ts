// The run to the pods, measured from its routes alone (no browser): how near any two of the six come to each other for
// every set of answers. Exits 1 if two bodies would be inside each other.
//   npx esbuild tools/pods_routes.ts --bundle --format=esm --platform=node --outfile=/tmp/pods_routes.mjs && node /tmp/pods_routes.mjs
import { buildRun, crowding, reach, routeAt, type P3, type RunId } from '../src/cinematic/podsrun';
import { PASSAGE } from '../src/cinematic/passage';

// where the call finds the six (chests, deck units): from a GPU take's continuity log
const START: Record<RunId, P3> = { scientist: [0.23, -0.75, -0.65], strong: [2.58, 1.3, -1.6], medic: [3.19, -0.5, -1.52], explorer: [2.7, -0.3, -2.04], builder: [3.98, -0.6, -2.26], social: [0.96, -0.7, -0.57] };
let bad = 0;
for (const hand of [true, false]) for (const core of hand ? [false] : [true, false]) for (const hurtN of [false, true]) for (const hurtD of [false, true]) {
  const { R, roles } = buildRun(START, { hand, core, hurtN, hurtD, bothHands: true });
  const name = `${hand ? 'hand' : core ? 'core' : 'silence'}${hurtN ? ' +Nuvexa hurt' : ''}${hurtD ? ' +Draxum hurt' : ''}`;
  for (const [id, keys] of Object.entries(R)) for (let i = 1; i < keys.length; i++) if (keys[i][0] <= keys[i - 1][0]) { console.log(`${name}: ${id} keys out of order at ${keys[i][0]}`); bad++; }
  const c = crowding(R, roles, 0);
  const worst = c.filter((x) => x.bad);
  const pairs = c.filter((x) => roles[x.a].partner === x.b).map((x) => `${x.a.slice(0, 3)}-${x.b.slice(0, 3)} ${x.d.toFixed(2)}`).join(', ');
  console.log(`${name}: ${worst.length ? worst.map((x) => `${x.a}~${x.b} ${x.d.toFixed(2)} m at ${x.t.toFixed(1)} s`).join('; ') : 'clear'}   [pairs' nearest: ${pairs}]`);
  const far = reach(R, roles);
  console.log(`   joined pairs' furthest: ${far.map((x) => `${x.a.slice(0, 3)}-${x.b.slice(0, 3)} ${x.d.toFixed(2)} at ${x.t.toFixed(1)}${x.d > 1.05 ? ' TOO FAR' : ''}`).join(', ')}`);
  // the pairs apart in the passage: the nearest two who are not partners, both through the hatch (the six read as one
  // cluster through the hatch when the pairs were 1.8 m apart, a12)
  { let best = Infinity, at = 0, who = ''; const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 }, ids = Object.keys(R) as RunId[];
    for (let t = 8; t <= 20.2; t += 0.1) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (roles[ids[i]].partner === ids[j]) continue; routeAt(R[ids[i]], t, p); routeAt(R[ids[j]], t, q);
      if (p.x < PASSAGE.doorX || q.x < PASSAGE.doorX) continue; const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); if (d < best) { best = d; at = t; who = `${ids[i].slice(0, 3)}-${ids[j].slice(0, 3)}`; } }
    console.log(`   in the passage, nearest who are not a pair: ${who} ${best.toFixed(2)} m at ${at.toFixed(1)}; through the hatch at ${Object.entries(roles).map(([id, r]) => `${id.slice(0, 3)} ${r.door.toFixed(1)}`).join(', ')}`); }
  bad += worst.length + far.filter((x) => x.d > 1.05).length;
  if (process.argv.includes('-v')) for (const x of c) console.log(`   ${x.a.padEnd(10)} ${x.b.padEnd(10)} ${x.d.toFixed(2)} at ${x.t.toFixed(1)}`);
}
process.exit(bad ? 1 : 0);
