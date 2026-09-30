const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ assistMode: 'pro', soundEnabled: false })));
    await page.route('**/src/App.tsx*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      assert.ok(source.includes('function App() {'));
      await route.fulfill({ response, body: source.replace('function App() {', 'function App() { window.__appRenders = (window.__appRenders || 0) + 1;') });
    });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = []; const emit = line => listeners.forEach(listener => listener(line)); window.emitTestEngine = emit;
        return { variant:'single-simd', addMessageListener: listener => listeners.push(listener), terminate(){}, postMessage(command) {
          if (command === 'uci') queueMicrotask(() => emit('uciok'));
          if (command === 'isready') queueMicrotask(() => emit('readyok'));
          if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
        }};
      };` }));
    await page.goto(base);
    await page.waitForFunction(() => typeof window.emitTestEngine === 'function');
    await page.keyboard.press('e');
    await page.getByTestId('engine-output-terminal').waitFor();
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => window.__appRenders);
    for (let i = 1; i <= 4; i++) {
      await page.evaluate(i => window.emitTestEngine(`info depth 12 nodes ${i * 1000} nps ${i * 10000} time ${i * 100}`), i);
      await page.waitForTimeout(240);
    }
    assert.match(await page.getByTestId('engine-search-status').innerText(), /D12/);
    assert.match(await page.getByTestId('engine-output-terminal').innerText(), /nodes 4000/);
    const after = await page.evaluate(() => window.__appRenders);
    assert.equal(after, before, 'Counters or raw logs rerendered the root App');
    console.log(`PASS: four telemetry flushes updated counters/logs with ${after - before} App renders`);
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
