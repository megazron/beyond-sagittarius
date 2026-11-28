// The Ledger's questions without a browser: every level-end beat is due once and only once, the board follows the save,
// (run from the repo root)
// a save round-trips, the recap reads from it. Nothing is printed of the story itself (keys and counts only).
//   npx esbuild tools/mystery_test.ts --bundle --platform=node --format=esm --outfile=$RUNNER_TEMP/mt.mjs && node $RUNNER_TEMP/mt.mjs
import { readFileSync } from 'node:fs';
import { unseal } from '../src/game/branch/sealed.ts';
import { setMystery, type MyData } from '../src/game/branch/mysterydata.ts';
import { board, hookBeats, hookFor, hookPlayed, markSeen, recapDue, recapLines, findsOpen, pickFind } from '../src/game/mystery.ts';
import { emptyBranch } from '../src/game/branch/engine.ts';
import type { SaveData } from '../src/core/save.ts';
import { PROP_KINDS } from '../src/world/finds.ts';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

const d = await unseal<MyData>(readFileSync('src/game/branch/mystery.sealed', 'utf8'));
setMystery(d);
const save = (): SaveData => ({ version: 1, level: 1, completed: [], stats: { health: 100, thirst: 100, hunger: 100, stamina: 100 }, inventory: {}, pos: [0, 0, 0], yaw: 0,
  timeOfDay: 9, day: 1, flags: {}, collected: [], branch: emptyBranch(), savedAt: Date.now() } as SaveData);

// every level 0 to 21 has exactly one beat, and it is due once only
const s = save();
ok(d.hooks.length === 22 && new Set(d.hooks.map((h) => h.level)).size === 22, 'a beat for each of levels 0 to 21');
let fired = 0;
for (let n = 0; n <= 21; n++) {
  if (n > 0) { s.completed.push(n); s.level = n + 1; }
  const h = hookFor(n, s);
  ok(!!h && hookBeats(h, s).length > 0, `level ${n}: its beat is due and has beats`);
  if (h) { hookPlayed(n, s); fired++; }
  ok(hookFor(n, s) === null, `level ${n}: not due again once played`);
}
ok(fired === 22, 'all 22 fired once');
for (let n = 0; n <= 21; n++) ok(hookFor(n, s) === null, `level ${n}: still not due on a second pass`);

// never on a replay
const r = save(); r.replay = 2; r.completed = [11]; ok(hookFor(11, r) === null, 'no beat on a replay slot');

// the board follows the save
const b0 = board(save());
ok(b0.questions.length === 1 && b0.clues.filter((c) => c.found).length === 1, 'fresh save: one question, one entry');
const s10 = save(); for (let n = 1; n <= 10; n++) s10.completed.push(n); s10.level = 11;
const b10 = board(s10);
ok(b10.clues.filter((c) => c.found).length === 11 && b10.questions.length === 5, 'after level 10: eleven entries, five questions');
ok(b10.past.length === 4 && b10.past.every((n) => n <= 10), 'after level 10: four things walked past, levels named');
ok(b10.fresh > 0, 'after level 10: something new');
markSeen(s10);
ok(board(s10).fresh === 0, 'opened: nothing new');
pickFind('F1', s10);
const b10b = board(s10);
ok(b10b.past.length === 3 && b10b.clues.filter((c) => c.found).length === 12 && b10b.fresh === 1, 'a find fills its tile and is new');
ok(findsOpen(s10).every((f) => f.id !== 'F1') && findsOpen(s10).length === 3, 'a picked find is not offered again');
const s21 = save(); for (let n = 1; n <= 21; n++) s21.completed.push(n); s21.level = 22;
const b21 = board(s21);
ok(b21.questions.every((q) => q.found <= q.total) && b21.clues.some((c) => c.paid), 'after 21: answers paid, counts sane');
ok(b21.questions.some((q) => q.history.some((h) => h.answer)), 'after 21: a struck question with its answer');
// every pay comes after its plant; every clue names known questions
const ids = new Set(d.questions.map((q) => q.id));
ok(d.clues.every((c) => c.q.every((l) => ids.has(l))), 'every entry names known questions');
ok(d.clues.every((c) => !c.pay || c.pay.level > c.level), 'every small answer comes after its plant');

// (run from the repo root)
// a save round-trips (JSON, as localStorage keeps it)
const back = JSON.parse(JSON.stringify(s10)) as SaveData;
ok(JSON.stringify(board(back)) === JSON.stringify(board(s10)), 'board identical after a save round-trip');
ok(hookFor(5, back) === hookFor(5, s10), 'once-only survives the round-trip');

// the recap
const rc = recapLines(s10);
ok(!!rc && rc.lines.length === 3, 'recap: three lines');
ok(recapDue({ ...s10, savedAt: Date.now() - 30 * 60e3 }, 'break') && !recapDue({ ...s10, savedAt: Date.now() - 60e3 }, 'break'), 'recap after a break only');
ok(!recapDue(s10, 'never') && recapDue(s10, 'always'), 'recap setting');

// every key the data uses has en, hi, ur and hl text
const keys = new Set<string>();
for (const q of d.questions) for (const st of q.stages) { keys.add(st.key); if (st.answers) keys.add(st.answers); }
for (const c of d.clues) { keys.add(c.title); keys.add(c.text); if (c.pay) keys.add(c.pay.key); }
for (const h of d.hooks) for (const b of [...h.beats, ...(h.variants ?? []).flatMap((v) => v.beats)]) if (b.key) keys.add(b.key);
for (const f of d.finds) keys.add(f.line);
for (const k of Object.values(d.recaps.levels)) keys.add(k);
for (const x of d.recaps.flags) keys.add(x.key);
keys.add(d.recaps.fallback); for (const k of Object.values(d.footer)) keys.add(k);
for (const l of ['en', 'hi', 'ur', 'hl'] as const) {
  const miss = [...keys].filter((k) => !d.strings?.[l]?.[k]);
  ok(!miss.length, `${l}: text for all ${keys.size} keys${miss.length ? ` (missing ${miss.slice(0, 5).join(', ')})` : ''}`);
}
const props = new Set<string>([...d.hooks.flatMap((h) => [...h.beats, ...(h.variants ?? []).flatMap((v) => v.beats)]).map((b) => b.prop).filter((x): x is string => !!x), ...d.finds.map((f) => f.prop)]);
ok([...props].every((k) => PROP_KINDS.includes(k)), `every prop named is one the game builds (${props.size})`);
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
