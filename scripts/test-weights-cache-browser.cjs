const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  let version = 'one';
  let failure = '';
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/coi-sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(__dirname, '../public/coi-sw.js')));
    } else if (req.url === '/pikafish.nnue') {
      requests.push(req.headers['if-none-match']);
      if (failure === 'network') { req.socket.destroy(); return; }
      if (failure === 'http') { res.writeHead(503); res.end('Unavailable'); return; }
      const etag = `"${version}"`;
      res.writeHead(req.headers['if-none-match'] === etag ? 304 : 200, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end(`weights-${version}`);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Weights cache QA</title><p>Service worker cache regression</p>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => { await navigator.serviceWorker.register('/coi-sw.js'); await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const fetchWeights = () => page.evaluate(async () => {
      try {
        const response = await fetch('/pikafish.nnue');
        return { status: response.status, text: await response.text() };
      } catch { return { failed: true }; }
    });
    assert.deepEqual(await fetchWeights(), { status: 200, text: 'weights-one' });
    assert.deepEqual(await fetchWeights(), { status: 200, text: 'weights-one' });
    assert.equal(requests.at(-1), '"one"', 'Cached weights must be revalidated');
    version = 'two';
    assert.deepEqual(await fetchWeights(), { status: 200, text: 'weights-two' });
    failure = 'http';
    assert.equal((await fetchWeights()).status, 503, 'An HTTP failure must not authorize old weights');
    failure = 'network';
    assert.deepEqual(await fetchWeights(), { failed: true }, 'A network failure must not authorize old weights');
    failure = '';
    assert.deepEqual(await fetchWeights(), { status: 200, text: 'weights-two' }, 'Failures preserve the cached body for a later successful revalidation');
    assert.equal(requests.at(-1), '"two"');
    console.log('PASS: real service worker caches/revalidates weights, updates versions, and rejects stale fallback after HTTP/network failures');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
