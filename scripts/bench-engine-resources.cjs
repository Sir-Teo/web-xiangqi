const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
// Same recorded position/depth across resource settings; run alone on an idle
// machine. NPS is descriptive, never a cross-machine CI pass/fail threshold.
const depth = process.env.PIKAFISH_RESOURCE_DEPTH || '16';
const results = [];
for (const [threads, hash] of [[1, 16], [1, 64], [2, 64], [4, 64], [8, 64], [4, 128], [8, 256]]) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'bench-nps.cjs'), '--variant', 'threaded-simd', '--depth', depth,
    '--threads', String(threads), '--hash', String(hash), '--repeats', '2', '--warmup', '1', '--quiet', '--json'], { encoding: 'utf8', timeout: 240_000 });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || 'Resource benchmark failed');
  const { snapshot } = JSON.parse(run.stdout);
  results.push(snapshot);
  console.log(JSON.stringify({ threads, hashMB: hash, depth: snapshot.depth, medianNps: snapshot.medianNps, medianWallMs: snapshot.medianWallMs, coldStartMs: snapshot.coldStartMs }));
}
if (process.env.PIKAFISH_RESOURCE_OUT) writeFileSync(process.env.PIKAFISH_RESOURCE_OUT, JSON.stringify(results, null, 2) + '\n');
