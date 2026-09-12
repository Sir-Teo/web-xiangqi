"use strict";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Run the real build script in a disposable repository. Compiler/git stubs
// exercise publication and failure handling, not WebAssembly correctness.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangqi-build-publication-'));
  for (const dir of ['scripts', 'templates/emscripten', 'patches', 'public', 'dist', 'demo', 'bin', '.deps/pikafish/.git', '.deps/pikafish/src']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, 'build-pikafish.sh'), path.join(root, 'scripts/build-pikafish.sh'));
  for (const [name, content] of Object.entries({
    'templates/pikafish.js': 'new wrapper', 'templates/emscripten/wasm-makefile.mk': '',
    'templates/emscripten/pre.js': '', '.deps/pikafish/src/main.cpp': 'extern "C" void command',
    '.deps/pikafish/src/pikafish.nnue': 'upstream network', 'public/pikafish.nnue': 'pinned network',
    'public/THIRD_PARTY_NOTICES.md': 'notices', 'public/Pikafish-Copying.txt': 'license',
    'demo/index.html': 'demo', 'demo/sw.js': 'demo worker',
  })) fs.writeFileSync(path.join(root, name), content);
  for (const dir of ['public', 'dist']) {
    for (const base of ['pikafish-core', 'pikafish-core-simd', 'pikafish-core-single', 'pikafish-core-single-simd']) {
      for (const ext of ['js', 'wasm']) fs.writeFileSync(path.join(root, dir, `${base}.${ext}`), 'old ' + base);
    }
    fs.writeFileSync(path.join(root, dir, 'pikafish.js'), 'old wrapper');
    fs.writeFileSync(path.join(root, dir, 'unrelated.txt'), 'keep');
  }
  fs.writeFileSync(path.join(root, 'dist/pikafish.nnue'), 'old dist network');
  for (const name of ['git', 'emcc']) fs.writeFileSync(path.join(root, 'bin', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/make'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('objclean')) process.exit(0);
const base = 'pikafish-core' + (args.includes('WASM_SINGLE_THREADED=yes') ? '-single' : '') + (args.includes('WASM_SIMD=yes') ? '-simd' : '');
if (process.env.TEST_FAIL_FLAVOR === base) { console.error('Controlled compiler failure: ' + base); process.exit(2); }
const dir = args[args.indexOf('-C') + 1];
fs.writeFileSync(path.join(dir, base + '.js'), 'new ' + base);
if (process.env.TEST_OMIT_WASM !== base) fs.writeFileSync(path.join(dir, base + '.wasm'), 'new ' + base);
if (!base.includes('single')) fs.writeFileSync(path.join(dir, base + '.worker.js'), 'new worker ' + base);
`, { mode: 0o755 });
  const readPublished = () => Object.fromEntries(['public', 'dist'].flatMap(dir => fs.readdirSync(path.join(root, dir))
    .map(file => [dir + '/' + file, fs.readFileSync(path.join(root, dir, file), 'utf8')])));
  return { root, readPublished,
    run: (extra = {}) => spawnSync('bash', ['scripts/build-pikafish.sh'], { cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
        PIKAFISH_UPSTREAM_DIR: path.join(root, '.deps/pikafish'), WASM_BUILD_SIMD: 'yes', JOBS: '1',
        TEST_FAIL_FLAVOR: '', TEST_OMIT_WASM: '', ...extra } }),
    clean: () => fs.rmSync(root, { recursive: true, force: true }),
    assertClean: () => assert.deepEqual(fs.readdirSync(path.join(root, '.deps')).filter(name => name.startsWith('pikafish-artifacts.')), []),
  };
}

for (const flavor of ['pikafish-core', 'pikafish-core-simd', 'pikafish-core-single', 'pikafish-core-single-simd']) {
  test(`a failed ${flavor} compilation preserves published files`, () => {
    const f = fixture();
    try {
      const before = f.readPublished();
      const result = f.run({ TEST_FAIL_FLAVOR: flavor });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Controlled compiler failure/);
      assert.deepEqual(f.readPublished(), before);
      f.assertClean();
    } finally { f.clean(); }
  });
}

test('a missing final WASM artifact preserves published files', () => {
  const f = fixture();
  try {
    const before = f.readPublished();
    const result = f.run({ TEST_OMIT_WASM: 'pikafish-core-single-simd' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.readPublished(), before);
    f.assertClean();
  } finally { f.clean(); }
});

test('a successful build publishes every variant, wrapper and pinned network', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const files = f.readPublished();
    for (const dir of ['public', 'dist']) {
      for (const base of ['pikafish-core', 'pikafish-core-simd', 'pikafish-core-single', 'pikafish-core-single-simd']) {
        for (const ext of ['js', 'wasm']) assert.equal(files[`${dir}/${base}.${ext}`], 'new ' + base);
      }
      assert.equal(files[dir + '/pikafish-core.worker.js'], 'new worker pikafish-core');
      assert.equal(files[dir + '/pikafish.js'], 'new wrapper');
      assert.equal(files[dir + '/pikafish.nnue'], 'pinned network');
      assert.equal(files[dir + '/unrelated.txt'], 'keep');
    }
    assert.equal(files['dist/index.html'], 'demo');
    assert.equal(files['dist/sw.js'], 'demo worker');
    assert.equal(files['dist/THIRD_PARTY_NOTICES.md'], 'notices');
    assert.equal(files['dist/Pikafish-Copying.txt'], 'license');
    assert.deepEqual(JSON.parse(files['dist/package.json']), { type: 'commonjs' });
    f.assertClean();
  } finally { f.clean(); }
});

for (const missing of ['network', 'demo']) test(`missing ${missing} files prevent publication after compilation`, () => {
  const f = fixture();
  try {
    if (missing === 'network') {
      fs.rmSync(path.join(f.root, 'public/pikafish.nnue'));
      fs.rmSync(path.join(f.root, '.deps/pikafish/src/pikafish.nnue'));
    } else fs.rmSync(path.join(f.root, 'demo/index.html'));
    const before = f.readPublished();
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.readPublished(), before);
    f.assertClean();
  } finally { f.clean(); }
});

test('an upstream network is published to both destinations when no pinned network exists', () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.root, 'public/pikafish.nnue'));
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const files = f.readPublished();
    for (const dir of ['dist', 'public']) assert.equal(files[dir + '/pikafish.nnue'], 'upstream network');
    f.assertClean();
  } finally { f.clean(); }
});
