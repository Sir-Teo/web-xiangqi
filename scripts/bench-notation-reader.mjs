import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
const root = process.cwd();
// Run: node scripts/bench-notation-reader.mjs <baseline-ref>
// Parser calls only; excludes rendering, storage and engine work.
const ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline git revision.');
const baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const previousSource = execFileSync('git', ['show', `${baseline}:src/utils/xiangqiNotation.ts`], { cwd: root, encoding: 'utf8' });
const server = await createServer({ root, configFile: false, cacheDir: '.cache/bench-notation', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, plugins: [{
  name: 'notation-reader-baseline', enforce: 'pre',
  load(id) { if (id.endsWith('/src/utils/xiangqiNotation.ts?notation-baseline')) return previousSource; },
}] });
try {
  const before = await server.ssrLoadModule('/src/utils/xiangqiNotation.ts?notation-baseline');
  const after = await server.ssrLoadModule('/src/utils/xiangqiNotation.ts');
  const { parseFenBoard, START_FEN } = await server.ssrLoadModule('/src/utils/xiangqi.ts');
  const board = parseFenBoard(START_FEN);
  let seed = 0x12345678;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const atoms = ['C2=5', '炮二平五', 'h2e2', 'H8+7', '马8进7', 'h9g7', 'hello', 'C9=9', 'a0a1', 'H2E2', '1.C2=5!', '1...', '*', '\n', '   ', 'R9+9', 'C2=5?!', 'h2e2!'];
  for (let run = 0; run < 1000; run++) {
    const text = Array.from({ length: 1 + random(12) }, () => atoms[random(atoms.length)]).join(' ');
    assert.deepEqual(after.parseNotationRecord(undefined, text), before.parseNotationRecord(undefined, text), text);
    const atom = atoms[random(atoms.length)];
    assert.equal(after.parseMoveInNotation(board, 'w', atom), before.parseMoveInNotation(board, 'w', atom), atom);
  }
  console.log(JSON.stringify({ baseline, runtime: process.version, scope: 'Parser calls only; excludes rendering, storage and engine work', identicalGeneratedSamples: 1000 }));
  const fixtures = {
    'cloud-shaped text': Array.from({ length: 40_000 }, () => 'move:h2e2,score:1,rank:0,note:x,winrate:50').join('|'),
    '200KB non-move words': 'hello '.repeat(33_333),
    'rejected notation': 'C9=9 '.repeat(40_000),
    'valid 80-ply coordinates': Array.from({ length: 80 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]).join(' '),
  };
  for (const [name, text] of Object.entries(fixtures)) {
    assert.deepEqual(after.parseNotationRecord(undefined, text), before.parseNotationRecord(undefined, text));
    const samples = { before: [], after: [] };
    for (let run = 0; run < 9; run++) {
      for (const [label, module] of (run % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]])) {
        const start = performance.now(); module.parseNotationRecord(undefined, text);
        if (run > 1) samples[label].push(performance.now() - start);
      }
    }
    console.log(JSON.stringify({ name, chars: text.length, medianMs: Object.fromEntries(Object.entries(samples).map(([label, values]) => [label, +values.sort((a, b) => a - b)[3].toFixed(2)])) }));
  }
} finally { await server.close(); }
