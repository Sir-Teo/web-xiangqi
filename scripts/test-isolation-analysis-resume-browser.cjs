const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { browserType } = require('./qa-browser.cjs');
const root = path.resolve(__dirname, '../dist');
const base = '/web-xiangqi/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const engine = `window.Pikafish = function() {};
window.Pikafish.createWorkerEngine = async () => {
  const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
  return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
    if (command === 'uci') queueMicrotask(() => emit('uciok'));
    if (command === 'isready') queueMicrotask(() => emit('readyok'));
    if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
  } };
};`;

// Serve the actual built shell without isolation headers. Hold installation
// until after the reader's first action, making the startup race deterministic.
async function host() {
  let release;
  const installing = new Promise(resolve => { release = resolve; });
  let engineRequests = 0;
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname.startsWith(base) ? pathname.slice(base.length) || 'index.html' : '';
    if (relative === 'coi-sw.js') await installing;
    const text = (type, body) => { response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
    if (relative === 'pikafish.js') { engineRequests++; text('text/javascript', engine); return; }
    if (relative === 'sw.js') {
      text('text/javascript', `self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));`);
      return;
    }
    if (relative === 'legacy.html') { text('text/html', '<title>Legacy worker setup</title>'); return; }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}${base}`, release,
    engineRequests: () => engineRequests,
    close: () => new Promise(resolve => server.close(resolve)) };
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const legacy of [false, true]) for (const requested of [false, true]) {
      const server = await host();
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      try {
        if (legacy) {
          await page.goto(server.url + 'legacy.html');
          await page.evaluate(async () => { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; });
        }
        await page.goto(server.url);
        const start = page.getByTestId('start-engine-analysis');
        await start.waitFor();
        assert.equal(server.engineRequests(), 0, 'The worker installation must not request the engine');
        if (requested) {
          await start.click();
          await page.waitForFunction(() => document.body.innerText.includes('Engine ready'));
        }
        const before = navigations;
        server.release();
        await page.waitForFunction(() => crossOriginIsolated);
        await page.locator('.xiangqi-board').waitFor();
        assert.ok(navigations > before, 'The actual isolation worker must reload the document');
        if (requested) {
          await page.waitForFunction(() => document.body.innerText.includes('Engine ready'));
          assert.equal(await start.count(), 0, 'Automatic reload must retain the explicit analysis request');
        } else {
          await start.waitFor();
          assert.equal(server.engineRequests(), 0, 'Unrequested analysis must remain off after the automatic reload');
        }
        const requests = server.engineRequests();
        await page.reload();
        await start.waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(server.engineRequests(), requests, 'The resume request must be consumed; a manual reload leaves analysis off');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: ${legacy ? 'legacy' : 'fresh'} installation preserves ${requested ? 'requested analysis' : 'analysis off'} through its automatic reload; manual reload stays off`);
      } catch (error) {
        const label = `${browserType.name()}-${legacy ? 'legacy' : 'fresh'}-${requested ? 'requested' : 'off'}`;
        await page.screenshot({ path: path.resolve(__dirname, `../.cache/isolation-reload-${label}.png`) }).catch(() => {});
        throw new Error(`${label}: ${error.message}`, { cause: error });
      } finally { server.release(); await page.close(); await server.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
