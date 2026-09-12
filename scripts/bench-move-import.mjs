import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

// Run: node scripts/bench-move-import.mjs <baseline-ref>
// Parsing only: excludes validation, board reconstruction, React and storage.
const ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline git revision, e.g. 5fbf7b9.');
const baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
const source = execFileSync('git', ['show', `${baseline}:src/utils/moveImport.ts`], { encoding: 'utf8' });
const server = await createServer({ server: { middlewareMode: true }, plugins: [{
  name: 'import-benchmark-baseline', enforce: 'pre',
  load(id) { if (id.endsWith('/src/utils/moveImport.ts?import-baseline')) return source; },
}] });
try {
  const current = await server.ssrLoadModule('/src/utils/moveImport.ts');
  const previous = await server.ssrLoadModule('/src/utils/moveImport.ts?import-baseline');
  let seed = 0x5949414e;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const atoms = ['h2e2', 'h9g7', 'b2e2', 'a9a8', '(', ')', '{Plan 中炮 🐎}', '; Reply idea\n', '$1', '$14', '?!', '{[%eval -.75,18]}'];
  for (let trial = 0; trial < 2000; trial++) {
    const text = Array.from({ length: 5 + random(80) }, () => atoms[random(atoms.length)]).join(' ');
    assert.deepEqual(current.extractUciMoveTree(text), previous.extractUciMoveTree(text), `Tree changed at generated sample ${trial}`);
  }
  const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
  const fixtures = {
    '1024 plain moves': Array.from({ length: 1024 }, (_, index) => cycle[index % 4]).join(' '),
    '1024 annotated moves': Array.from({ length: 1024 }, (_, index) => `${cycle[index % 4]} $1 {[%eval .42,18] Plan ${index}: keep the file open.}`).join(' '),
    '198KB malformed-command note': `h2e2 {${'[%'.repeat(99000)}} h9g7`,
  };
  console.log(JSON.stringify({ baseline, runtime: process.version, scope: 'Parser calls only; old App used both parsers, new App uses the tree parser', identicalGeneratedTrees: 2000 }));
  for (const [name, text] of Object.entries(fixtures)) {
    assert.deepEqual(current.extractUciMoveTree(text), previous.extractUciMoveTree(text));
    const operations = {
      previousTree: () => previous.extractUciMoveTree(text),
      currentTree: () => current.extractUciMoveTree(text),
      removedSecondPass: () => previous.extractAnnotatedMainLine(text),
      previousBothPasses: () => { previous.extractUciMoveTree(text); previous.extractAnnotatedMainLine(text); },
    };
    for (const operation of Object.values(operations)) for (let warmup = 0; warmup < 8; warmup++) operation();
    const samples = Object.fromEntries(Object.keys(operations).map(key => [key, []]));
    for (let sample = 0; sample < 31; sample++) {
      const entries = Object.entries(operations);
      if (sample % 2) entries.reverse();
      for (const [key, operation] of entries) {
        const start = performance.now(); operation(); samples[key].push(performance.now() - start);
      }
    }
    console.log(JSON.stringify({ name, characters: text.length, medianMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, +values.sort((a, b) => a - b)[15].toFixed(3)])) }));
  }
} finally { await server.close(); }
