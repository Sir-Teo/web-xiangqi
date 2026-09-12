const assert = require('node:assert/strict');
const http = require('node:http');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  let server;
  try {
    const response = await fetch(new URL('pikafish.js', base));
    assert.equal(response.status, 200);
    const wrapper = await response.text();
    // Acknowledgments are released by an explicit command, not by timers.
    // Real wrapper and worker messaging; only the engine core is a fixture.
    const core = `self.PikafishCoreSingleSimd = async options => {
      const pending = [];
      return { FS: { readFile: () => 'barrier' }, ccall(_name, _returnType, _types, args) {
        const command = args[0];
        if (command === 'uci') pending.push('uciok');
        if (command === 'isready') pending.push('readyok');
        if (command === 'qa-flush') while (pending.length) options.listener(pending.shift());
      } };
    };`;
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      res.writeHead(200, { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(pathname === '/pikafish.js' ? wrapper : pathname === '/qa-core.js' ? core
        : '<!doctype html><script src="pikafish.js"></script><script src="qa-core.js"></script>');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for (const worker of [false, true]) {
      const results = await page.evaluate(async worker => {
        const options = { variant: 'single-simd', autoTune: false, autoLoadNNUE: false,
          coreScript: new URL('qa-core.js', location.href).href, coreFactory: window.PikafishCoreSingleSimd };
        const engine = await (worker ? window.Pikafish.createWorkerEngine(options) : window.Pikafish(options));
        const results = [];
        try {
          for (const [method, acknowledgment] of [['uci', 'uciok'], ['isReady', 'readyok']]) {
            const first = engine[method](); engine.postMessage('qa-flush'); await first;
            // Historical output remains available to callers that explicitly
            // use waitForLine's existing history-reading behavior.
            await engine.waitForLine(acknowledgment, { timeoutMs: 1000 });
            let resolved = false;
            const repeat = engine[method]().then(() => { resolved = true; });
            // The RPC completes after the command has reached the worker.
            // On a direct engine, awaiting also drains promise microtasks.
            await engine.readFile('/barrier', { encoding: 'utf8' });
            await Promise.resolve(); await Promise.resolve();
            results.push({ method, resolvedBeforeAcknowledgment: resolved });
            engine.postMessage('qa-flush'); await repeat;
            let timedOut = false;
            try { await engine[method]({ timeoutMs: 30 }); }
            catch (error) { timedOut = /Timed out waiting/.test(error.message); }
            results.at(-1).timedOutWithoutAcknowledgment = timedOut;
            engine.postMessage('qa-flush');
          }
          return results;
        } finally { await engine.terminate(); }
      }, worker);
      for (const result of results) {
        assert.equal(result.resolvedBeforeAcknowledgment, false, `${worker ? 'worker' : 'direct'} ${result.method} reused an old acknowledgment`);
        assert.equal(result.timedOutWithoutAcknowledgment, true, `${result.method} must time out when the engine does not reply`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: direct and worker UCI/readiness barriers await fresh acknowledgments, preserve history lookup and honor timeouts`);
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
