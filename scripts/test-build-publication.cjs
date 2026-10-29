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
  fs.copyFileSync(path.join(__dirname, 'write-engine-manifest.cjs'), path.join(root, 'scripts/write-engine-manifest.cjs'));
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
  fs.writeFileSync(path.join(root, 'bin/git'), '#!/bin/sh\necho called >> "$TEST_GIT_LOG"\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/make'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
// Make command-line assignments override inherited environment variables.
const value = name => args.filter(arg => arg.startsWith(name + '=')).at(-1)?.slice(name.length + 1) ?? process.env[name];
const single = value('WASM_SINGLE_THREADED'), simd = value('WASM_SIMD');
fs.appendFileSync(process.env.TEST_MAKE_LOG, JSON.stringify({ single, simd, clean: args.includes('objclean') }) + '\\n');
if (args.includes('objclean')) process.exit(0);
const base = 'pikafish-core' + (single === 'yes' ? '-single' : '') + (simd === 'yes' ? '-simd' : '');
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
        WASM_PROFILE: 'release', WASM_ALLOW_MEMORY_GROWTH: 'yes', WASM_ENABLE_LTO: 'yes', WASM_DISABLE_RTTI: 'yes',
        WASM_SINGLE_THREADED: 'no', WASM_SIMD: 'no',
        TEST_GIT_LOG: path.join(root, 'git-calls.log'), TEST_MAKE_LOG: path.join(root, 'make-calls.log'),
        TEST_FAIL_FLAVOR: '', TEST_OMIT_WASM: '', TEST_EXPECT_NETWORK: '', ...extra } }),
    clean: () => fs.rmSync(root, { recursive: true, force: true }),
    assertClean: () => assert.deepEqual(fs.readdirSync(path.join(root, '.deps')).filter(name => name.startsWith('pikafish-artifacts.')), []),
  };
}

function inspectBuildFlags(options = {}, inherited = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangqi-build-flags-'));
  try {
    const probe = path.join(root, 'flags.mk');
    fs.writeFileSync(probe, '$(info QA_CXX=$(EM_CXXFLAGS))\n$(info QA_LINK=$(EM_LDFLAGS))\n.PHONY: qa-flags\nqa-flags:\n');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('WASM_')) delete env[key];
    Object.assign(env, inherited);
    return spawnSync('make', ['-s', '-f', path.join(__dirname, '../templates/emscripten/wasm-makefile.mk'),
      '-f', probe, 'qa-flags', ...Object.entries({ WASM_PROFILE: 'release', WASM_ALLOW_MEMORY_GROWTH: 'yes',
        WASM_ENABLE_LTO: 'yes', WASM_DISABLE_RTTI: 'yes', ...options }).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`)],
    { cwd: root, env, encoding: 'utf8', timeout: 15000 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const buildSimd of ['yes', 'no']) test(`${buildSimd === 'yes' ? 'four-flavor' : 'scalar-only'} builds ignore inherited per-flavor modes`, () => {
  for (const [single, simd] of [['yes', 'no'], ['no', 'yes'], ['yes', 'yes']]) {
    const f = fixture();
    try {
      const result = f.run({ WASM_BUILD_SIMD: buildSimd, WASM_SINGLE_THREADED: single, WASM_SIMD: simd });
      assert.equal(result.status, 0, `Inherited single=${single}, simd=${simd}: ${result.stderr}`);
      const modes = buildSimd === 'yes' ? [['no', 'no'], ['no', 'yes'], ['yes', 'no'], ['yes', 'yes']] : [['no', 'no'], ['yes', 'no']];
      const calls = fs.readFileSync(path.join(f.root, 'make-calls.log'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(calls, modes.flatMap(([single, simd]) => [{ single, simd, clean: true }, { single, simd, clean: false }]), 'Clean and build must agree on each requested mode');
      const files = f.readPublished();
      assert.equal(files['public/engine-assets.json'], files['dist/engine-assets.json']);
      const manifest = JSON.parse(files['public/engine-assets.json']);
      assert.equal(manifest.version, 1);
      for (const [name, asset] of Object.entries(manifest.assets)) {
        assert.equal(asset.size, Buffer.byteLength(files['public/' + name]));
        assert.equal(asset.sha256, require('node:crypto').createHash('sha256').update(files['public/' + name]).digest('hex'));
      }
      for (const [single, simd] of modes) {
        const base = 'pikafish-core' + (single === 'yes' ? '-single' : '') + (simd === 'yes' ? '-simd' : '');
        for (const dir of ['public', 'dist']) for (const ext of ['js', 'wasm']) assert.equal(files[`${dir}/${base}.${ext}`], 'new ' + base);
      }
      if (buildSimd === 'no') assert.deepEqual(Object.keys(files).filter(file => file.includes('-simd.')), []);
      f.assertClean();
    } finally { f.clean(); }
  }
});

test('real Make uses explicit variant settings over conflicting environment values', () => {
  for (const single of ['yes', 'no']) for (const simd of ['yes', 'no']) {
    const result = inspectBuildFlags({ WASM_SINGLE_THREADED: single, WASM_SIMD: simd },
      { WASM_SINGLE_THREADED: single === 'yes' ? 'no' : 'yes', WASM_SIMD: simd === 'yes' ? 'no' : 'yes' });
    assert.equal(result.status, 0, result.stderr);
    const [compile, link] = result.stdout.trim().split('\n');
    assert.equal(compile.includes('-D__EMSCRIPTEN_SINGLE_THREADED__'), single === 'yes');
    for (const flags of [compile, link]) {
      assert.equal(flags.includes('-pthread'), single === 'no');
      assert.equal(flags.includes('-msimd128'), simd === 'yes');
    }
    assert.ok(link.includes(`USE_PTHREADS=${single === 'yes' ? 0 : 1}`));
    const factory = 'PikafishCore' + (single === 'yes' ? 'Single' : '') + (simd === 'yes' ? 'Simd' : '');
    assert.match(link, new RegExp(`\\b${factory}\\b`));
  }
});

test('invalid optimization settings fail before checkout or publication', () => {
  const f = fixture();
  try {
    const before = f.readPublished();
    for (const [key, values] of Object.entries({
      WASM_PROFILE: ['relese', 'Release', '', 'release debug'],
      WASM_ENABLE_LTO: ['ye', '', 'yes no'],
      WASM_DISABLE_RTTI: ['ture', '', '%'],
      WASM_ALLOW_MEMORY_GROWTH: ['off', '', 'true false'],
    })) for (const value of values) {
      const result = f.run({ [key]: value });
      assert.equal(result.status, 2, `${key}=${value}: ${result.stderr}`);
      assert.ok(result.stderr.includes(key));
      assert.equal(fs.existsSync(path.join(f.root, 'git-calls.log')), false, 'Invalid settings must not touch the checkout');
      assert.deepEqual(f.readPublished(), before);
      f.assertClean();
    }
  } finally { f.clean(); }
});

test('the actual Makefile rejects invalid profiles and boolean switches', () => {
  for (const [key, values] of Object.entries({ WASM_PROFILE: ['relese', '', 'release debug'],
    WASM_ENABLE_LTO: ['ye', '', 'yes no'], WASM_DISABLE_RTTI: ['ture', '', '%'],
    WASM_ALLOW_MEMORY_GROWTH: ['off', '', 'true false'] })) for (const value of values) {
    const result = inspectBuildFlags({ [key]: value });
    assert.notEqual(result.status, 0, `${key}=${value} must not silently select different flags`);
    assert.ok(result.stderr.includes(key), result.stderr);
  }
});

test('release/debug profiles and documented boolean aliases produce the intended compiler/linker flags', () => {
  const defaults = inspectBuildFlags({ WASM_PROFILE: undefined });
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.match(defaults.stdout, /-O3\b/);
  for (const [enabled, values] of [[true, ['yes', 'true', '1']], [false, ['no', 'false', '0']]]) for (const value of values) {
    const result = inspectBuildFlags({ WASM_ENABLE_LTO: value, WASM_DISABLE_RTTI: value, WASM_ALLOW_MEMORY_GROWTH: value });
    assert.equal(result.status, 0, result.stderr);
    const [compile, link] = result.stdout.trim().split('\n');
    for (const flags of [compile, link]) { assert.match(flags, /-O3\b/); assert.equal(flags.includes('-flto'), enabled); }
    assert.equal(compile.includes('-fno-rtti'), enabled);
    assert.ok(link.includes(`ALLOW_MEMORY_GROWTH=${enabled ? 1 : 0}`));
    assert.match(link, /ASSERTIONS=0/);
  }
  const debug = inspectBuildFlags({ WASM_PROFILE: 'debug' });
  assert.equal(debug.status, 0, debug.stderr);
  assert.doesNotMatch(debug.stdout, /-O3|-flto|-DNDEBUG/);
  assert.match(debug.stdout, /-g\b/); assert.match(debug.stdout, /ASSERTIONS=1/);
  const f = fixture();
  try {
    assert.equal(f.run({ WASM_PROFILE: 'debug', WASM_ENABLE_LTO: 'false', WASM_DISABLE_RTTI: '0', WASM_ALLOW_MEMORY_GROWTH: 'true' }).status, 0);
    f.assertClean();
  } finally { f.clean(); }
});

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
    for (const dir of ['public', 'dist']) require('./write-engine-manifest.cjs').writeEngineManifest(path.join(f.root, dir));
    const check = () => spawnSync(process.execPath, ['scripts/test-engine-contract.cjs'], { cwd: f.root, encoding: 'utf8', timeout: 15000 });
    const valid = check();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /2 cores/);
    const manifestPath = path.join(f.root, 'public/engine-assets.json');
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    fs.writeFileSync(manifestPath, manifest.replace(/"size":\d+/, '"size":0'));
    assert.match(check().stderr, /does not describe the shipped binaries/);
    fs.writeFileSync(manifestPath, manifest);
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
