const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Load the real wrapper and WASM filesystem in a blank page. Instrument
    // only the filesystem write, so the assertion observes actual allocation
    // ownership instead of a mock implementation of canOwn.
    await page.route('**/qa-nnue.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>NNUE memory QA</title>' }));
    await page.goto(new URL('qa-nnue.html', base).href);
    await page.addScriptTag({ url: new URL('pikafish.js', base).href });
    await page.addScriptTag({ url: new URL('pikafish-core-single-simd.js', base).href });
    const result = await page.evaluate(async basePath => {
      const originalFetch = window.fetch.bind(window);
      const network = new Uint8Array(await (await originalFetch(basePath + 'pikafish.nnue')).arrayBuffer());
      window.fetch = async (input, options) => {
        const url = new URL(String(input), location.href);
        if (!url.pathname.endsWith('/qa-net.nnue')) return originalFetch(input, options);
        let offset = 0;
        return new Response(new ReadableStream({ pull(controller) {
          if (offset === network.length) { controller.close(); return; }
          const end = Math.min(network.length, offset + 256 * 1024);
          controller.enqueue(network.subarray(offset, end)); offset = end;
        } }), { headers: url.searchParams.has('size') ? { 'content-length': url.searchParams.get('size') } : {} });
      };
      const writes = [];
      let filesystem;
      const engine = await window.Pikafish({
        basePath, variant: 'single-simd', autoLoadNNUE: false, threads: 1, hashMB: 16,
        onAssetProgress() {},
        coreFactory: async options => {
          const module = await window.PikafishCoreSingleSimd(options);
          filesystem = module.FS;
          const write = filesystem.writeFile.bind(filesystem);
          filesystem.writeFile = (path, bytes, options) => {
            write(path, bytes, options);
            if (path !== '/pikafish.nnue') return;
            const stored = filesystem.lookupPath(path).node.contents;
            writes.push({ shared: stored.buffer === bytes.buffer, inputCapacity: bytes.buffer.byteLength,
              storedCapacity: stored.buffer.byteLength, length: stored.length,
              intact: stored.every((byte, index) => byte === network[index]) });
          };
          return module;
        },
      });
      try {
        for (const size of [network.length, network.length + 1024, null]) {
          await engine.loadNNUE(basePath + 'qa-net.nnue' + (size === null ? '' : `?size=${size}`));
        }
        await engine.loadNNUE(network);
        network[0] ^= 255;
        const callerIsolated = filesystem.lookupPath('/pikafish.nnue').node.contents[0] !== network[0];
        network[0] ^= 255;
        await engine.uci(); await engine.isReady();
        const bestmove = engine.waitForLine(/^bestmove /, { timeoutMs: 30000 });
        engine.postMessage('position startpos'); engine.postMessage('go depth 1');
        return { writes, callerIsolated, bestmove: await bestmove };
      } finally { await engine.terminate(); window.fetch = originalFetch; }
    }, base);
    const [exact, encoded, unknown, caller] = result.writes;
    assert.equal(exact.shared, true, 'Exact downloaded weights should not allocate a second filesystem buffer');
    assert.equal(encoded.shared, true, 'Small encoded-length slack should not force a full network copy');
    assert.equal(unknown.shared, false, 'An oversized growth buffer must not become permanent filesystem storage');
    assert.equal(unknown.storedCapacity, unknown.length);
    assert.equal(caller.shared, false); assert.equal(result.callerIsolated, true, 'Caller mutations must not change the loaded file');
    assert.ok(result.writes.every(write => write.intact), 'Every loaded file must contain the complete network');
    assert.match(result.bestmove, /^bestmove [a-i][0-9][a-i][0-9]/);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: real MEMFS avoids ${exact.length} copied bytes; encoded hints, unknown-size retention, caller isolation and real search passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
