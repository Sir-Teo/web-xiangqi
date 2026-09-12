#!/usr/bin/env node
"use strict";

// Exercise the shipped cores: setoption silently ignores out-of-range values,
// so a mock accepting every command cannot establish benchmark correctness.
const assert = require("node:assert/strict");
const { spawnSync, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { compareSnapshots, validateBaseline } = require("./bench-comparison.cjs");

const root = path.resolve(__dirname, "..");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiangqi-bench-config-"));
process.on("exit", () => fs.rmSync(outputDir, { recursive: true, force: true }));

function run(variant, extra = [], options = {}) {
  const out = path.join(outputDir, "snapshot.json");
  fs.rmSync(out, { force: true });
  const result = spawnSync(process.execPath, [
    ...(options.nodeArgs || []),
    "scripts/bench-nps.cjs", "--variant", variant, "--depth", "3",
    "--warmup", "0", "--repeats", "1", "--hash", "16", "--quiet", "--json",
    "--out", out, ...extra,
  ], {
    cwd: root,
    env: { ...process.env, PIKAFISH_BENCH_THREADS: "", ...options.env },
    encoding: "utf8", timeout: 30000,
  });
  assert.ifError(result.error);
  return { ...result, out };
}

const digests = new Map();
function expectedArtifact(file) {
  if (!digests.has(file)) {
    const bytes = fs.readFileSync(path.join(root, "dist", file));
    digests.set(file, { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return digests.get(file);
}

for (const variant of ["single", "single-simd", "threaded", "threaded-simd"]) {
  test(`${variant} records a supported default thread count`, () => {
    const result = run(variant);
    assert.equal(result.status, 0, result.stderr);
    const { snapshot } = JSON.parse(result.stdout);
    assert.equal(snapshot.resolvedVariant, variant);
    assert.match(snapshot.engineName, /^Pikafish /);
    assert.match(snapshot.fen, / w - - 0 1$/);
    const core = { single: 'pikafish-core-single', 'single-simd': 'pikafish-core-single-simd', threaded: 'pikafish-core', 'threaded-simd': 'pikafish-core-simd' }[variant];
    assert.deepEqual(snapshot.artifacts, {
      wrapper: expectedArtifact('pikafish.js'), coreJs: expectedArtifact(core + '.js'),
      coreWasm: expectedArtifact(core + '.wasm'), network: expectedArtifact('pikafish.nnue'),
    });
    assert.equal(snapshot.threads, variant.startsWith("single") ? 1 : Math.max(1, Math.min(os.cpus().length - 1, 32)));
    assert.equal(JSON.parse(fs.readFileSync(result.out, "utf8")).threads, snapshot.threads);
    assert.ok(snapshot.runs[0].depth >= 3);
    assert.ok(snapshot.runs[0].nps > 0);
  });
}

test("an explicit supported thread count is preserved", () => {
  const result = run("threaded-simd", ["--threads", "2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).snapshot.threads, 2);
});

for (const [variant, count] of [["single-simd", "2"], ["threaded-simd", "33"]]) {
  test(`${variant} rejects unsupported Threads ${count} without writing a snapshot`, () => {
    const result = run(variant, ["--threads", count]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside engine's supported range/);
    assert.equal(fs.existsSync(result.out), false);
  });
}

test("malformed thread counts fail instead of being rounded or clamped", () => {
  for (const value of ["0", "-1", "1.5", "NaN", ""]) {
    const result = run("single-simd", ["--threads", value]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /positive integer/);
    assert.equal(fs.existsSync(result.out), false);
  }
  assert.match(run("single-simd", ["--threads"]).stderr, /positive integer/);
});

test("an unknown variant cannot silently benchmark a different core", () => {
  const result = run("typo");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown benchmark variant/);
  assert.equal(fs.existsSync(result.out), false);
});

test("snapshots retain a custom position including side and move counters", () => {
  const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 20';
  const result = run('single-simd', ['--fen', fen]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).snapshot.fen, fen);
});

test("a failed performance gate does not save a passing-looking snapshot", () => {
  const result = run('single-simd', ['--min-median-nps', '1000000000000']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Benchmark sanity checks failed/);
  assert.equal(fs.existsSync(result.out), false);
});

const observer = path.join(outputDir, 'observe.cjs');
fs.writeFileSync(observer, `
const fs = require('node:fs');
const copy = fs.copyFileSync;
const destinations = [];
fs.copyFileSync = function(source, target, ...rest) {
  const result = copy.call(this, source, target, ...rest);
  destinations.push(target);
  if (process.env.TEST_COPY_LOG) fs.writeFileSync(process.env.TEST_COPY_LOG, JSON.stringify(destinations));
  if (process.env.TEST_COPY_FAILURE) throw new Error('Controlled copy failure');
  return result;
};
const stat = fs.statSync;
let reads = 0;
fs.statSync = function(file, options) {
  const result = stat.call(this, file, options);
  if (String(file).endsWith('pikafish.nnue') && options?.bigint && ++reads >= Number(process.env.TEST_STAMP_AT || Infinity)) {
    return { ...result, mtimeNs: result.mtimeNs + 1n };
  }
  return result;
};
`);

test("concurrent variants use independent temporary modules and remove them", async () => {
  const logs = ['single', 'single-simd'].map(variant => path.join(outputDir, variant + '-copies.json'));
  const results = await Promise.all(['single', 'single-simd'].map((variant, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', observer, 'scripts/bench-nps.cjs', '--variant', variant,
      '--depth', '3', '--warmup', '0', '--repeats', '1', '--threads', '1', '--hash', '16', '--quiet', '--json'],
      { cwd: root, env: { ...process.env, TEST_COPY_LOG: logs[i] }, timeout: 30000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  })));
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).snapshot.artifacts.coreWasm.sha256);
  }
  const copied = logs.flatMap(log => JSON.parse(fs.readFileSync(log, 'utf8')));
  assert.equal(copied.length, 4);
  assert.equal(new Set(copied).size, 4, 'Concurrent runs shared temporary module paths');
  assert.equal(new Set(copied.map(file => path.dirname(file))).size, 2);
  for (const file of copied) assert.equal(fs.existsSync(path.dirname(file)), false);
});

test("copy/setup failures also clean temporary modules", () => {
  const log = path.join(outputDir, 'failed-copies.json');
  const result = run('single-simd', [], { nodeArgs: ['--require', observer], env: { TEST_COPY_LOG: log, TEST_COPY_FAILURE: '1' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Controlled copy failure/);
  for (const file of JSON.parse(fs.readFileSync(log, 'utf8'))) assert.equal(fs.existsSync(path.dirname(file)), false);
  assert.equal(fs.existsSync(result.out), false);
});

for (const at of [2, 3]) test(`a changed artifact before/after hashing (${at}) rejects the snapshot`, () => {
  // Simulate stat changes without modifying the checked-in network.
  const result = run('single-simd', [], { nodeArgs: ['--require', observer], env: { TEST_STAMP_AT: String(at) } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Benchmark artifact changed during the run/);
  assert.equal(fs.existsSync(result.out), false);
});

test("matching workloads retain deltas for intentional thread, SIMD and network comparisons", () => {
  const baseline = { fen: 'position w - - 0 1', depth: 8, threads: 1, resolvedVariant: 'single', hashMB: 16,
    avgNps: 100, avgWallMs: 40, coldStartMs: 200, artifacts: { network: { sha256: 'old' } } };
  const current = { ...baseline, threads: 2, resolvedVariant: 'threaded-simd', hashMB: 32,
    avgNps: 150, avgWallMs: 20, coldStartMs: 250, artifacts: { network: { sha256: 'new' } } };
  const comparison = compareSnapshots(current, baseline);
  assert.equal(comparison.workloadStatus, 'same');
  assert.deepEqual(comparison.deltas, { avgNps: 0.5, avgWallMs: -0.5, coldStartMs: 0.25 });
  assert.deepEqual(comparison.context.filter(item => item.status === 'different').map(item => item.field),
    ['resolvedVariant', 'threads', 'hashMB', 'artifacts.network.sha256']);
  assert.ok(comparison.context.some(item => item.field === 'engineName' && item.status === 'unknown'));
});

test("different depths, sides and FEN counters suppress search deltas but preserve startup comparison", () => {
  const baseline = { fen: 'position w - - 0 1', depth: 8, avgNps: 100, avgWallMs: 40, coldStartMs: 200 };
  for (const changed of [{ depth: 9 }, { fen: 'position b - - 0 1' }, { fen: 'position w - - 0 20' }]) {
    const comparison = compareSnapshots({ ...baseline, ...changed, coldStartMs: 100 }, baseline);
    assert.equal(comparison.workloadStatus, 'different');
    assert.deepEqual(comparison.deltas, { avgNps: null, avgWallMs: null, coldStartMs: -0.5 });
  }
});

test("legacy workload omissions and zero denominators cannot produce invented percentages", () => {
  const baseline = { depth: 8, avgNps: 0, avgWallMs: 0, coldStartMs: 0 };
  const comparison = compareSnapshots({ ...baseline, fen: 'position w - - 0 1' }, baseline);
  assert.equal(comparison.workloadStatus, 'unknown');
  assert.deepEqual(comparison.deltas, { avgNps: null, avgWallMs: null, coldStartMs: null });
  assert.equal(comparison.workload[0].before, null);
  const same = compareSnapshots({ ...baseline, fen: 'same' }, { ...baseline, fen: 'same' });
  assert.equal(same.workloadStatus, 'same');
  assert.deepEqual(same.deltas, comparison.deltas);
});

test("malformed comparison snapshots are rejected without coercing metrics", () => {
  const valid = { depth: 8, avgNps: 100, avgWallMs: 40, coldStartMs: 200 };
  for (const invalid of [null, [], {}, { snapshot: valid }, { ...valid, depth: 1.5 },
    ...['avgNps', 'avgWallMs', 'coldStartMs'].flatMap(key =>
      [null, '100', -1, Infinity, NaN].map(value => ({ ...valid, [key]: value })))]) {
    assert.throws(() => validateBaseline(invalid), /Invalid benchmark comparison/);
  }
});

test("the CLI exposes comparison context in JSON and withholds legacy text deltas", () => {
  const first = run('single-simd');
  assert.equal(first.status, 0, first.stderr);
  const baseline = JSON.parse(first.stdout).snapshot;
  const file = path.join(outputDir, 'baseline.json');
  fs.writeFileSync(file, JSON.stringify(baseline));
  const matched = run('single-simd', ['--compare', file]);
  assert.equal(matched.status, 0, matched.stderr);
  const output = JSON.parse(matched.stdout);
  assert.equal(output.comparison.workloadStatus, 'same');
  assert.deepEqual(output.comparison.context, []);
  assert.equal(typeof output.comparison.deltas.avgNps, 'number');
  assert.deepEqual(output.compareTo, baseline);
  assert.equal(JSON.parse(fs.readFileSync(matched.out)).comparison, undefined, 'Saved snapshots stay independently reusable');
  delete baseline.fen;
  delete baseline.artifacts;
  fs.writeFileSync(file, JSON.stringify(baseline));
  const legacy = spawnSync(process.execPath, ['scripts/bench-nps.cjs', '--variant', 'single-simd', '--depth', '3',
    '--repeats', '1', '--warmup', '0', '--threads', '1', '--hash', '16', '--quiet', '--compare', file],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.ifError(legacy.error);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.match(legacy.stdout, /recorded FEN\/depth: unknown/);
  assert.match(legacy.stdout, /Search deltas withheld/);
  assert.match(legacy.stdout, /avg nps delta:  n\/a/);
  assert.match(legacy.stdout, /avg wall delta: n\/a/);
  assert.doesNotMatch(legacy.stdout, /NaN|undefined/);
  fs.writeFileSync(file, 'null');
  const invalid = run('single-simd', ['--compare', file]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid benchmark comparison/);
  assert.equal(fs.existsSync(invalid.out), false);
});
