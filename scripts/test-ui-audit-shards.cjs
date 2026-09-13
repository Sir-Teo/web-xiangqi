const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { scripts, selectShard } = require('./ui-audit-suites.cjs');

test('every registered browser regression runs exactly once in the CI shard matrix', () => {
  assert.equal(new Set(scripts).size, scripts.length);
  for (const count of [1, 8, scripts.length]) {
    const parts = Array.from({ length: count }, (_, i) => selectShard(scripts, `${i + 1}/${count}`));
    assert.deepEqual(parts.flat().sort(), [...scripts].sort());
    assert.equal(new Set(parts.flat()).size, scripts.length);
    assert.ok(Math.max(...parts.map(p => p.length)) - Math.min(...parts.map(p => p.length)) <= 1);
  }
  for (const script of scripts) assert.ok(fs.statSync(path.join(__dirname, script)).isFile());
});

test('invalid or empty shard assignments fail instead of silently skipping checks', () => {
  for (const shard of ['0/8', '9/8', '1/0', '1/9999', '1', '1/8junk', '-1/8', '1/9007199254740992']) {
    assert.throws(() => selectShard(scripts, shard));
  }
});


test('the workflow schedules the complete declared shard set', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
  const shards = [...workflow.matchAll(/--shard=(\d+\/\d+)/g)].map(match => match[1]);
  assert.ok(shards.length > 1);
  const planned = shards.flatMap(shard => selectShard(scripts, shard));
  assert.deepEqual(planned.sort(), [...scripts].sort());
});
