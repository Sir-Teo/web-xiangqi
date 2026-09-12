"use strict";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const wrapper = fs.readFileSync(path.join(__dirname, '../templates/pikafish.js'), 'utf8');

// Run the real build script in a disposable repository. Compiler/git stubs
// exercise publication and failure handling, not WebAssembly correctness.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangqi-build-publication-'));
  for (const dir of ['scripts', 'templates/emscripten', 'patches', 'public', 'dist', 'demo', 'bin', '.deps/pikafish/.git', '.deps/pikafish/src']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, 'build-pikafish.sh'), path.join(root, 'scripts/build-pikafish.sh'));
  for (const [name, content] of Object.entries({
    'templates/pikafish.js': wrapper, 'templates/emscripten/wasm-makefile.mk': '',
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
if (process.env.TEST_EXPECT_NETWORK) {
  const file = path.join(dir, 'pikafish.nnue');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== process.env.TEST_EXPECT_NETWORK) {
    console.error('Pinned network was not available before compiling ' + base); process.exit(3);
  }
  fs.appendFileSync(path.join(dir, 'network-builds.log'), base + '\\n');
}
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
        TEST_FAIL_FLAVOR: '', TEST_OMIT_WASM: '', TEST_EXPECT_NETWORK: '', ...extra } }),
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
      assert.equal(files[dir + '/pikafish.js'], wrapper);
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

for (const simd of ['yes', 'no']) test(`all ${simd === 'yes' ? 'four' : 'two scalar'} flavors reuse pinned weights in a clean upstream checkout`, () => {
  const f = fixture();
  try {
    // A real git clean removes the ignored upstream network. The public copy
    // must be available before make's config-sanity/net prerequisite runs.
    fs.rmSync(path.join(f.root, '.deps/pikafish/src/pikafish.nnue'));
    const result = f.run({ WASM_BUILD_SIMD: simd, TEST_EXPECT_NETWORK: 'pinned network' });
    assert.equal(result.status, 0, result.stderr);
    const compiled = fs.readFileSync(path.join(f.root, '.deps/pikafish/src/network-builds.log'), 'utf8').trim().split('\n');
    assert.deepEqual(compiled, simd === 'yes'
      ? ['pikafish-core', 'pikafish-core-simd', 'pikafish-core-single', 'pikafish-core-single-simd']
      : ['pikafish-core', 'pikafish-core-single']);
    const files = f.readPublished();
    for (const dir of ['dist', 'public']) assert.equal(files[dir + '/pikafish.nnue'], 'pinned network');
    f.assertClean();
  } finally { f.clean(); }
});

test('a scalar-only build removes old SIMD artifacts and disables their automatic selection', () => {
  const f = fixture();
  try {
    for (const dir of ['public', 'dist']) {
      fs.writeFileSync(path.join(f.root, dir, 'pikafish-core-simd.worker.js'), 'old SIMD worker');
      fs.writeFileSync(path.join(f.root, dir, 'pikafish-core-single-simd.worker.js'), 'old SIMD worker');
    }
    const result = f.run({ WASM_BUILD_SIMD: 'no' });
    assert.equal(result.status, 0, result.stderr);
    const files = f.readPublished();
    assert.deepEqual(Object.keys(files).filter(file => file.includes('-simd.')), []);
    for (const dir of ['public', 'dist']) {
      assert.equal(files[dir + '/pikafish.js'], wrapper.replace('const BUILD_HAS_SIMD = true;', 'const BUILD_HAS_SIMD = false;'));
      assert.equal(files[dir + '/pikafish-core.js'], 'new pikafish-core');
      assert.equal(files[dir + '/pikafish-core-single.js'], 'new pikafish-core-single');
    }
    f.assertClean();
  } finally { f.clean(); }
});

test('a failed scalar-only build preserves the previous SIMD build', () => {
  const f = fixture();
  try {
    const before = f.readPublished();
    const result = f.run({ WASM_BUILD_SIMD: 'no', TEST_FAIL_FLAVOR: 'pikafish-core-single' });
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(f.readPublished(), before);
    f.assertClean();
  } finally { f.clean(); }
});

test('invalid SIMD build options fail without changing published files', () => {
  const f = fixture();
  try {
    const before = f.readPublished();
    for (const value of ['false', '0', 'typo', '']) {
      const result = f.run({ WASM_BUILD_SIMD: value });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /WASM_BUILD_SIMD must be yes or no/);
      assert.deepEqual(f.readPublished(), before);
      f.assertClean();
    }
  } finally { f.clean(); }
});

test('the engine contract accepts a scalar build and rejects stale artifacts or wrapper drift', () => {
  const f = fixture();
  try {
    assert.equal(f.run({ WASM_BUILD_SIMD: 'no' }).status, 0);
    fs.mkdirSync(path.join(f.root, 'src/utils'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../src/utils/analysisProfile.ts'), path.join(f.root, 'src/utils/analysisProfile.ts'));
    fs.copyFileSync(path.join(__dirname, 'test-engine-contract.cjs'), path.join(f.root, 'scripts/test-engine-contract.cjs'));
    // Use actual shipped core JS for the existing ABI/pool checks.
    for (const dir of ['public', 'dist']) for (const core of ['pikafish-core.js', 'pikafish-core-single.js']) {
      fs.copyFileSync(path.join(__dirname, '../public', core), path.join(f.root, dir, core));
    }
    const check = () => spawnSync(process.execPath, ['scripts/test-engine-contract.cjs'], { cwd: f.root, encoding: 'utf8', timeout: 15000 });
    const valid = check();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /2 cores/);
    const stale = path.join(f.root, 'public/pikafish-core-simd.wasm');
    fs.writeFileSync(stale, 'old SIMD');
    assert.match(check().stderr, /is stale: the wrapper declares a scalar-only build/);
    fs.rmSync(stale);
    const distWrapper = path.join(f.root, 'dist/pikafish.js');
    const scalar = fs.readFileSync(distWrapper, 'utf8');
    fs.writeFileSync(distWrapper, wrapper);
    assert.match(check().stderr, /wrappers disagree/);
    fs.writeFileSync(distWrapper, scalar + '\n// stale wrapper change\n');
    assert.match(check().stderr, /does not match templates/);
    fs.writeFileSync(distWrapper, scalar.replace('const BUILD_HAS_SIMD = false;', ''));
    assert.match(check().stderr, /must declare one BUILD_HAS_SIMD setting/);
  } finally { f.clean(); }
});
