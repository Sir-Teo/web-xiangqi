import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
// Run from the repo: node scripts/bench-import-text.mjs <baseline-ref>
const root = process.cwd(), ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline git revision.');
const baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const previous = execFileSync('git', ['show', `${baseline}:src/utils/moveImport.ts`], { cwd: root, encoding: 'utf8' });
const server = await createServer({ root, configFile: false, cacheDir: '.cache/bench-move-import', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, plugins: [{
  name: 'move-import-baseline', enforce: 'pre', load(id) { if (id.endsWith('/src/utils/moveImport.ts?import-baseline')) return previous; },
}] });
try {
  const before = await server.ssrLoadModule('/src/utils/moveImport.ts?import-baseline'), after = await server.ssrLoadModule('/src/utils/moveImport.ts');
  const operations = ['stripRecordMetadata', 'extractUciMoveLine', 'extractUciMoveTree', 'hasTooManyUciMoves'];
  let seed = 0x51a9f17;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const atoms = ['h2e2', 'h9g7', '(b2e2)', '(', ')', '{note h0g2 (hidden)}', '[Event "Cup"]', '[broken', '{', '}', '; ignored h0g2\n', '% ignored h0g2\n', 'bad', 'a3 -> a4', '$2', '!?', '   ', '\r\n'];
  for (let sample = 0; sample < 1000; sample++) {
    const text = Array.from({ length: 1 + random(12) }, () => atoms[random(atoms.length)]).join(' ');
    for (const operation of operations) assert.equal(JSON.stringify(after[operation](text)), JSON.stringify(before[operation](text)), `${operation}: ${text}`);
  }
  console.log(JSON.stringify({ baseline, runtime: process.version, scope: 'Parser calls only; excludes rendering, storage and engine work', identicalGeneratedSamples: 1000 }));
  for (const [name, text] of Object.entries({
    'empty escape lines': '%\n'.repeat(100000), 'malformed quoted tags': '[A "]" '.repeat(28000),
    'minified unrelated text': 'function f(){return[1,2,3]}'.repeat(20000),
    'plain coordinates': Array.from({ length: 1024 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]).join(' '),
    'annotated variations': '1.h2e2 {Cannon plan} h9g7 (1...b9c7 {Alternative}) '.repeat(1000),
  })) for (const operation of operations) {
    assert.equal(JSON.stringify(after[operation](text)), JSON.stringify(before[operation](text)));
    const samples = { before: [], after: [] };
    for (let run = 0; run < 9; run++) for (const [label, module] of (run % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]])) {
      const start = performance.now(); module[operation](text); if (run > 1) samples[label].push(performance.now() - start);
    }
    console.log(JSON.stringify({ name, chars: text.length, operation, medianMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, +values.sort((a,b) => a-b)[3].toFixed(2)])) }));
  }
} finally { await server.close(); }
