// The cheat menu's story presets (src/cheat/presets.ts), without a browser:
//   npx esbuild tools/cheat/presets_test.ts --bundle --platform=node --format=esm --outfile=$RUNNER_TEMP/pt.mjs && node $RUNNER_TEMP/pt.mjs
import { applyPreset, presetPick, summary } from '../../src/cheat/presets.ts';
import type { Decision, Qte, BranchState } from '../../src/game/branch/types.ts';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const D: Record<string, Decision> = {
  t1: { id: 't1', title: 'x', fallback: 'quiet', options: [
    { id: 'help', label: 'l1', effects: [{ trust: 'medic', by: 2 }, { flag: 'helped' }] },
    { id: 'leave', label: 'l2', effects: [{ trust: 'medic', by: -3 }, { kill: 'social', cause: 'left' }, { flag: 'left' }] },
    { id: 'quiet', label: 'l3', tone: 'silent', effects: [] }] },
};
const Q: Record<string, Qte> = { q1: { id: 'q1', title: 'x', label: 'x', seconds: 1, pass: [{ trait: 'nerve', by: 1 }], fail: [{ flag: 'hurt.x' }] } };
const fresh = (): { branch: BranchState; flags: Record<string, boolean>; level: number; day: number; timeOfDay: number; inventory: Record<string, number>; stats: { health: number; thirst: number; hunger: number; stamina: number } } => ({
  branch: { trust: { 'medic>scientist': 2 }, record: { honesty: 0, mercy: 0, nerve: 0, humour: 0 }, log: [{ id: 't1', kind: 'decision', pick: 'help', level: 4, day: 1, at: 0 }], dead: {}, pending: [], open: null, marks: {} },
  flags: { helped: true, other: true }, level: 5, day: 1, timeOfDay: 9, inventory: {}, stats: { health: 1, thirst: 1, hunger: 1, stamina: 1 },
});
ok(presetPick('a', D.t1, undefined, {}, 't1') === 'help' && presetPick('b', D.t1, undefined, {}, 't1') === 'leave', 'a is the first option shown, b the second (a silent one is never an option)');
ok(presetPick('a', undefined, Q.q1, {}, 'q1') === 'pass' && presetPick('b', undefined, Q.q1, {}, 'q1') === 'fail', 'reflexes: a passes, b fails');
ok(presetPick('ask', D.t1, undefined, {}, 't1') === null && presetPick('ask', D.t1, undefined, { t1: 'leave' }, 't1') === 'leave', 'ask keeps the record; a pick overrides');
let s = fresh(); applyPreset(s, 'a', {}, D, Q);
ok(JSON.stringify(s.branch.trust) === '{"medic>scientist":2}' && s.flags.helped && !s.branch.dead.social, 'a on an a-route save changes nothing');
s = fresh(); const ch = applyPreset(s, 'b', {}, D, Q, ['q1']);
ok(s.branch.trust['medic>scientist'] === -3, 'b takes the old trust back and puts the new on');
ok(!s.flags.helped && s.flags.left && s.flags.other, 'flags: the old answer\'s go, the new answer\'s come, others stay');
ok(!!s.branch.dead.social && summary(s.branch, ['scientist', 'medic', 'social']).find((x) => x.id === 'social')!.alive === false, 'who an answer costs is lost, and the summary says so');
ok(s.branch.log.find((l) => l.id === 't1')!.pick === 'leave' && s.branch.log.some((l) => l.id === 'q1' && l.pick === 'fail') && !!s.flags['hurt.x'], 'the log is rewritten; an unmet moment is written in');
ok(ch.length === 2, 'it says what it changed');
applyPreset(s, 'a', {}, D, Q, ['q1']);
ok(!s.branch.dead.social && s.branch.trust['medic>scientist'] === 2 && s.flags.helped && !s.flags['hurt.x'] && s.branch.record.nerve === 1, 'and back to a: the same as an a save (and the reflex passed)');
if (fails) { console.log(`${fails} failed`); process.exit(1); } else console.log('presets test passed');
