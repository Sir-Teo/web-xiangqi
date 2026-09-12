// Compare the private scan with a supplied git revision, without loading React.
// Run: node scripts/bench-variation-scan.cjs <baseline-ref>
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const ts = require('typescript');
const baseline = process.argv[2];
if (!baseline) throw new Error('Pass a baseline git revision.');
const file = 'src/utils/moveImport.ts';
function load(source) {
  const start = source.indexOf('function stripParentheticalVariations(');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, 'Expected the variation scan in the supplied revision');
  const js = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  return new Function(js + '; return stripParentheticalVariations;')();
}
const before = load(execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }));
const after = load(fs.readFileSync(file, 'utf8'));
let seed = 12345;
for (let trial = 0; trial < 10000; trial++) {
  let text = '';
  for (let n = 0; n < 80; n++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    text += ['(', ')', 'h2e2', '😀', 'x', ' '][seed % 6];
  }
  assert.equal(after(text), before(text), `Changed output for ${JSON.stringify(text)}`);
}
const samples = [];
for (const [name, text] of [
  ['plain record', 'h2e2 '.repeat(40000)],
  ['cloud-shaped junk', Array(40000).fill('move:h2e2,score:1,rank:0,note:x,winrate:50').join('|')],
  ['nested variation', 'h2e2 (' + 'junk '.repeat(40000) + '(h0g2)) h9g7'],
]) {
  const sample = { name, chars: text.length };
  for (const [label, fn] of [['beforeMedianMs', before], ['afterMedianMs', after]]) {
    const times = [];
    for (let run = 0; run < 9; run++) {
      const start = performance.now(); fn(text); times.push(performance.now() - start);
    }
    sample[label] = times.sort((a, b) => a - b)[4];
  }
  samples.push(sample);
}
console.log(JSON.stringify({ baseline, parityCases: 10000, scope: 'variation stripping only, not complete import latency', samples }, null, 2));
