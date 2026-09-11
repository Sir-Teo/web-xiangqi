const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    // Use real workers with controlled startup outcomes; no WASM is needed to
    // verify ownership, cancellation, and cleanup at the public wrapper API.
    await page.route('**/qa-wrapper.html', route => route.fulfill({ contentType: 'text/html',
      body: '<script src="./pikafish.js"></script>' }));
    await page.route('**/qa-lifecycle-worker.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
      self.onmessage = event => {
        const data = event.data;
        if (data.type === 'init') {
          const mode = new URL(self.location.href).searchParams.get('mode');
          if (mode === 'error') self.postMessage({ type: 'error', message: 'Controlled initialization failure' });
          if (mode === 'ready') self.postMessage({ type: 'inited', variant: 'single' });
        }
        if (data.type === 'rpc') self.postMessage({ type: 'rpcResult', requestId: data.requestId, ok: true });
      };
    ` }));
    await page.addInitScript(() => {
      window.__workers = [];
      const WorkerBase = window.Worker;
      window.Worker = class extends WorkerBase {
        constructor(...args) { super(...args); this.terminations = 0; window.__workers.push(this); }
        terminate() { this.terminations++; super.terminate(); }
      };
    });
    await page.goto(new URL('qa-wrapper.html', base).href);
    const create = async (mode, action) => page.evaluate(async ({ mode, action }) => {
      const controller = new AbortController();
      if (action === 'preabort') controller.abort();
      const before = window.__workers.length;
      const pending = window.Pikafish.createWorkerEngine({ variant: 'single', autoLoadNNUE: false,
        workerScript: new URL(`qa-lifecycle-worker.js?mode=${mode}`, location.href).href,
        initTimeoutMs: 250, signal: controller.signal });
      if (action === 'abort') controller.abort();
      const outcome = await pending.then(async engine => {
        controller.abort(); // Completed startup no longer belongs to the signal.
        const beforeTerminate = window.__workers.at(-1).terminations;
        await engine.terminate();
        return { result: 'ready', beforeTerminate };
      }, error => ({ result: error.name, message: error.message }));
      return { ...outcome, terminations: window.__workers.slice(before).map(worker => worker.terminations) };
    }, { mode, action });

    const failed = await create('error');
    assert.match(failed.message, /Controlled initialization failure/);
    assert.deepEqual(failed.terminations, [1], 'Failed initialization left its worker alive');
    const cancelled = await create('hang', 'abort');
    assert.equal(cancelled.result, 'AbortError');
    assert.deepEqual(cancelled.terminations, [1]);
    const preaborted = await create('hang', 'preabort');
    assert.equal(preaborted.result, 'AbortError');
    assert.deepEqual(preaborted.terminations, [], 'An already-cancelled startup still created a worker');
    const timedOut = await create('hang');
    assert.match(timedOut.message, /Timed out initializing/);
    assert.deepEqual(timedOut.terminations, [1]);
    const ready = await create('ready');
    assert.equal(ready.result, 'ready');
    assert.equal(ready.beforeTerminate, 0);
    assert.deepEqual(ready.terminations, [1]);
    console.log(`${browserType.name()}: failed, cancelled, timed-out and successful worker startup cleanup passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
