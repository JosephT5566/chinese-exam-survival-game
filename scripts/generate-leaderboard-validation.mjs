import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../firestore.rules', import.meta.url);
const source = readFileSync(path, 'utf8');
const start = '    // BEGIN GENERATED LEADERBOARD VALIDATION';
const end = '    // END GENERATED LEADERBOARD VALIDATION';
const generated = [start, '    function entriesValid(entries) {',
  '      let count = entries.size();',
  '      return entries is list && count <= 15',
  ...Array.from({ length: 15 }, (_, i) => `        && (count <= ${i} || entry(entries[${i}]))`),
  '      ;', '    }', end].join('\n');
const first = source.indexOf(start);
const last = source.indexOf(end);
if (first < 0 || last < first) throw new Error('Missing generation markers');
const result = source.slice(0, first) + generated + source.slice(last + end.length);
if (process.argv.includes('--check')) {
  if (source !== result) throw new Error('Run node scripts/generate-leaderboard-validation.mjs');
} else {
  writeFileSync(path, result);
}
