const assert = require('node:assert/strict');
const http = require('node:http');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const MB = 1024 * 1024;

(async () => {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const errors = [];
  let server;
  page.on('pageerror', error => errors.push(error.message));
  try {
    // A real worker executes the shipped wrapper. The fixture replaces only
    // the core/stream so chunk sizes and declared lengths are deterministic.
    const coreFixture = `
      const fetchOriginal = self.fetch.bind(self);
      self.fetch = input => {
        const url = new URL(input);
        if (!url.pathname.endsWith('/qa-progress.nnue')) return fetchOriginal(input);
        const length = Number(url.searchParams.get('length'));
        const declared = url.searchParams.get('declared');
        let sent = 0;
        return Promise.resolve(new Response(new ReadableStream({ pull(controller) {
          if (sent >= length) { controller.close(); return; }
          const chunk = new Uint8Array(Math.min(4096, length - sent)).fill(7);
          sent += chunk.length; controller.enqueue(chunk);
        } }), { headers: declared ? { 'content-length': declared } : {} }));
      };
      self.PikafishCoreSingleSimd = async () => {
        const files = new Map();
        return { ccall() {}, FS: {
          unlink: path => files.delete(path), writeFile: (path, bytes) => files.set(path, bytes),
          readFile: path => files.get(path),
        } };
      };
    `;
    const wrapperResponse = await fetch(new URL('pikafish.js', base));
    assert.equal(wrapperResponse.status, 200);
    const wrapper = await wrapperResponse.text();
    // Firefox's importScripts requests do not pass through Playwright routing.
    // Serve fixtures over real HTTP, with the wrapper fetched from the QA app.
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const body = pathname === '/pikafish.js' ? wrapper : pathname === '/qa-progress-core.js' ? coreFixture
        : '<!doctype html><script src="./pikafish.js"></script>';
      res.writeHead(200, {
        'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      res.end(body);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await page.goto(`http://127.0.0.1:${server.address().port}/qa-progress.html`);
    await page.evaluate(async () => {
      window.__progress = [];
      window.__engine = await window.Pikafish.createWorkerEngine({
        variant: 'single-simd', coreScript: new URL('qa-progress-core.js', location.href).href,
        autoLoadNNUE: false, onAssetProgress: event => window.__progress.push(event),
      });
    });
    for (const [length, declared] of [[2 * MB + 3, 2 * MB + 3], [2 * MB + 3, null], [2 * MB + 3, MB], [17, 17], [0, null]]) {
      const result = await page.evaluate(async ({ length, declared }) => {
        window.__progress = [];
        const url = new URL('qa-progress.nnue', location.href);
        url.searchParams.set('length', length);
        if (declared !== null) url.searchParams.set('declared', declared);
        await window.__engine.loadNNUE(url.href);
        const bytes = await window.__engine.readFile('/pikafish.nnue');
        return { events: window.__progress, length: bytes.length, intact: bytes.every(byte => byte === 7) };
      }, { length, declared });
      assert.equal(result.length, length);
      assert.equal(result.intact, true, 'Progress coalescing changed downloaded bytes');
      assert.deepEqual(result.events[0], { loaded: 0, total: declared || 0, done: false });
      assert.deepEqual(result.events.at(-1), { loaded: length, total: declared || length, done: true });
      assert.equal(result.events.filter(event => event.done).length, 1);
      assert.ok(result.events.length <= Math.floor(length / MB) + 2, `Forwarded ${result.events.length} progress messages for ${length} bytes`);
      for (let i = 1; i < result.events.length; i++) assert.ok(result.events[i].loaded >= result.events[i - 1].loaded);
    }
    await page.evaluate(() => window.__engine.terminate());
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: bounded worker progress, unknown/encoded lengths, reload reset, empty streams and unchanged bytes passed`);
  } finally {
    await browser.close();
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
