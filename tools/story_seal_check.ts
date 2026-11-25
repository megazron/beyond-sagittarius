// Prints the sealed Episode One data as the game's decoder (src/game/branch/sealed.ts) reads it; tools/story_seal.py
// check compares it with its own reading.
import { readFileSync } from 'node:fs';
import { unseal } from '../src/game/branch/sealed.ts';

const file = process.argv[2] ?? new URL('../src/game/branch/episode1.sealed', import.meta.url);
const text = readFileSync(file, 'utf8');
process.stdout.write(JSON.stringify(await unseal(text)));
