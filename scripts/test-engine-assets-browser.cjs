const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { browserType } = require('./qa-browser.cjs');
const wrapper = fs.readFileSync('public/pikafish.js', 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
(async () => {
  const browser = await browserType.launch();
  let server;
  try {
    let version = 1, manifestStatus = 200;
    const requests = [];
    const assets = () => ({
      'pikafish-core-single.js': Buffer.from(`self.PikafishCoreSingle = async options => {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (!options.wasmBinary || options.wasmBinary[0] !== ${version}) throw new Error('Wrong WASM');
        const files = new Map();
        return { ccall(_name, _return, _types, [command]) {
          if (command === 'uci') options.listener('uciok');
          if (command === 'isready') options.listener('readyok');
        }, FS: { unlink: name => files.delete(name), writeFile: (name, bytes) => files.set(name, bytes), readFile: name => files.get(name) } };
      };`),
      'pikafish-core-single.wasm': Buffer.from([version, 2, 3]),
      'pikafish.nnue': Buffer.from([version, 7, 9, 11]),
    });
    const manifest = () => {
      const entries = Object.fromEntries(Object.entries(assets()).map(([name, bytes]) => [name, { sha256: hash(bytes), size: bytes.length }]));
      return { version: 1, buildId: hash(JSON.stringify(entries)), assets: entries };
    };
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost'), name = url.pathname.slice(1);
      requests.push({ name, search: url.search, at: Date.now() });
      const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store' };
      if (name === 'engine-assets.json') { res.writeHead(manifestStatus, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(manifest())); return; }
      const bytes = assets()[name];
      const body = name === 'pikafish.js' ? wrapper : bytes || '<!doctype html><script src="/pikafish.js"></script>';
      const send = () => { res.writeHead(200, { ...headers, 'Content-Type': name.endsWith('.js') ? 'application/javascript' : bytes ? 'application/octet-stream' : 'text/html' }); res.end(body); };
      if (name === 'pikafish.nnue') setTimeout(send, 350); else send();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const boot = () => page.evaluate(async () => {
      const timings = [];
      window.engine = await window.Pikafish.createWorkerEngine({ variant: 'single', allowSIMD: false, threads: 1, hashMB: 16, onStartupTiming: event => timings.push(event) });
      const bytes = Array.from(await window.engine.readFile('/pikafish.nnue'));
      await window.engine.terminate();
      return { bytes, timings };
    });
    await page.goto(url);
    const cold = await boot();
    assert.deepEqual(cold.bytes, [1, 7, 9, 11]);
    const phases = Object.fromEntries(cold.timings.map(event => [event.phase, event.elapsedMs]));
    for (const phase of ['manifest-ready', 'core-download-ready', 'core-start', 'core-ready', 'weights-ready', 'network-installed', 'engine-created']) assert.ok(Number.isFinite(phases[phase]), phase);
    assert.ok(phases['core-ready'] < phases['weights-ready'], 'Core initialization did not overlap weights download');
    const firstAssets = requests.filter(r => r.search.includes('pikafish-sha256'));
    assert.equal(firstAssets.length, 3);
    assert.ok(Math.max(...firstAssets.map(r => r.at)) - Math.min(...firstAssets.map(r => r.at)) < 300, 'Asset requests ran serially');
    requests.length = 0; await page.reload();
    assert.deepEqual((await boot()).bytes, cold.bytes);
    assert.equal(requests.filter(r => r.name === 'engine-assets.json').length, 1, 'Returning visits must refresh the manifest');
    assert.equal(requests.filter(r => r.search.includes('pikafish-sha256')).length, 0, 'Warm boot fetched cached engine bodies');
    // Corrupt one persistent body: reject it, remove it, then repair on retry.
    await page.evaluate(async () => {
      const name = (await caches.keys()).find(key => key.startsWith('pikafish-assets-v1-'));
      const cache = await caches.open(name);
      const request = (await cache.keys()).find(request => new URL(request.url).pathname.endsWith('.nnue'));
      await cache.put(request, new Response(new Uint8Array([0, 0, 0, 0])));
    });
    await assert.rejects(boot(), /integrity mismatch/);
    assert.deepEqual((await boot()).bytes, cold.bytes);
    version = 2; requests.length = 0;
    assert.deepEqual((await boot()).bytes, [2, 7, 9, 11]);
    assert.equal(requests.filter(r => r.search.includes('pikafish-sha256')).length, 3, 'New build reused an incompatible old body');
    version = 3; await boot();
    assert.equal(await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('pikafish-assets-v1-')).length), 2, 'Asset caches grew without a bound');
    manifestStatus = 503;
    await assert.rejects(boot(), /manifest/);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: overlapping startup, phase timing, zero warm asset requests, hash rejection/repair, build changes, cache bounds and manifest failure passed`);
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
