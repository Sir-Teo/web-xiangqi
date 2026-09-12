#!/usr/bin/env node
"use strict";

// Exercise the shipped cores: setoption silently ignores out-of-range values,
// so a mock accepting every command cannot establish benchmark correctness.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiangqi-bench-config-"));
process.on("exit", () => fs.rmSync(outputDir, { recursive: true, force: true }));

function run(variant, extra = []) {
  const out = path.join(outputDir, "snapshot.json");
  fs.rmSync(out, { force: true });
  const result = spawnSync(process.execPath, [
    "scripts/bench-nps.cjs", "--variant", variant, "--depth", "3",
    "--warmup", "0", "--repeats", "1", "--hash", "16", "--quiet", "--json",
    "--out", out, ...extra,
  ], {
    cwd: root,
    env: { ...process.env, PIKAFISH_BENCH_THREADS: "" },
    encoding: "utf8", timeout: 30000,
  });
  assert.ifError(result.error);
  return { ...result, out };
}

for (const variant of ["single", "single-simd", "threaded", "threaded-simd"]) {
  test(`${variant} records a supported default thread count`, () => {
    const result = run(variant);
    assert.equal(result.status, 0, result.stderr);
    const { snapshot } = JSON.parse(result.stdout);
    assert.equal(snapshot.resolvedVariant, variant);
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
