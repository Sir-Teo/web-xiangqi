const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browserType } = require('./qa-browser.cjs');

// Real wrapper/core/network, fresh contexts, interleaved samples. This measures
// progress delivery and startup, not application rendering or search speed.
(async () => {
  const baselinePath = process.argv[2];
  const sources = { current: fs.readFileSync(path.join(__dirname, '../templates/pikafish.js'), 'utf8') };
  if (baselinePath) sources.baseline = fs.readFileSync(baselinePath, 'utf8');
  const { preview } = await import('vite');
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'progress-benchmark-fixtures',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        let body;
        let type;
        if (url.pathname.endsWith('/qa-progress.html')) {
          body = '<!doctype html><title>Worker progress benchmark</title><script src="./pikafish.js"></script>';
          type = 'text/html';
        } else if (url.pathname.endsWith('/qa-progress-worker.js')) {
          body = sources[url.searchParams.get('implementation')];
          type = 'text/javascript';
        }
        if (body === undefined) return next();
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(body);
      });
    },
  }] });
  let browser;
  try {
    browser = await browserType.launch();
    const samples = Object.fromEntries(Object.keys(sources).map(name => [name, []]));
    for (let repeat = 0; repeat < 5; repeat++) {
      const names = Object.keys(sources);
      for (const implementation of repeat % 2 ? names.reverse() : names) {
        const page = await browser.newPage();
        try {
          await page.goto(new URL('qa-progress.html', server.resolvedUrls.local[0]).href);
          const result = await page.evaluate(async implementation => {
            const progress = [];
            const start = performance.now();
            const engine = await window.Pikafish.createWorkerEngine({
              basePath: new URL('./', location.href).href,
              workerScript: new URL(`qa-progress-worker.js?implementation=${implementation}`, location.href).href,
              variant: 'single-simd', threads: 1, hashMB: 16,
              onAssetProgress: event => progress.push(event),
            });
            try {
              await engine.uci(); await engine.isReady();
              const readyMs = performance.now() - start;
              engine.send('position startpos');
              engine.send('go depth 1');
              const bestmove = await engine.waitForLine(/^bestmove /);
              return { messages: progress.length, first: progress[0], last: progress.at(-1), readyMs, bestmove };
            } finally { await engine.terminate(); }
          }, implementation);
          assert.equal(result.first.loaded, 0);
          assert.equal(result.last.done, true);
          assert.equal(result.last.loaded, fs.statSync(path.join(__dirname, '../public/pikafish.nnue')).size);
          assert.match(result.bestmove, /^bestmove [a-i][0-9][a-i][0-9]/);
          samples[implementation].push(result);
          console.log(JSON.stringify({ browser: browserType.name(), implementation, repeat, ...result }));
        } finally { await page.close(); }
      }
    }
    for (const [implementation, runs] of Object.entries(samples)) {
      const median = key => runs.map(run => run[key]).sort((a, b) => a - b)[2];
      console.log(JSON.stringify({ summary: true, browser: browserType.name(), implementation,
        medianMessages: median('messages'), medianReadyMs: +median('readyMs').toFixed(1) }));
    }
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
