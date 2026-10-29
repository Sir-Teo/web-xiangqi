const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ assistMode: 'pro', soundEnabled: false }));
      window.__appRenders = 0;
      let previousApp;
      const renderers = new Map();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, renderers,
        inject(renderer) { renderers.set(1, renderer); return 1; },
        onCommitFiberUnmount() {},
        onCommitFiberRoot(_id, root) {
          const stack = [root.current];
          while (stack.length) {
            const fiber = stack.pop();
            if ((fiber.elementType?.displayName || fiber.type?.displayName || fiber.type?.name) === 'App') {
              // Memo bailouts can reuse the old fiber, including its old flags.
              if (fiber !== previousApp && (fiber.flags & 1)) window.__appRenders++;
              previousApp = fiber;
            }
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
          }
        },
      };
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
    await page.getByTestId('start-engine-analysis').click();
    await page.waitForFunction(() => typeof window.emitTestEngine === 'function');
    await page.keyboard.press('e');
    await page.getByTestId('engine-output-terminal').waitFor();
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => window.__appRenders);
    assert.ok(Number.isFinite(before) && before > 0, 'The render probe must observe App before checking isolation');
    for (let i = 1; i <= 4; i++) {
      await page.evaluate(i => window.emitTestEngine(`info depth 12 nodes ${i * 1000} nps ${i * 10000} time ${i * 100}`), i);
      await page.waitForTimeout(240);
    }
    assert.match(await page.getByTestId('engine-search-status').innerText(), /D12/);
    assert.match(await page.getByTestId('engine-output-terminal').innerText(), /nodes 4000/);
    const after = await page.evaluate(() => window.__appRenders);
    assert.equal(after, before, 'Counters or raw logs rerendered the root App');
    console.log(`PASS: four telemetry flushes updated counters/logs with ${after - before} App renders`);
    await page.evaluate(() => window.emitTestEngine('info depth 12 multipv 1 score cp 25 pv h2e2 h9g7'));
    await page.getByTestId('engine-pv-0-move-0').waitFor();
    await page.waitForTimeout(250);
    const beforeDepth = await page.evaluate(() => window.__appRenders);
    for (let depth = 13; depth <= 16; depth++) {
      await page.evaluate(depth => window.emitTestEngine(`info depth ${depth} multipv 1 score cp 25 pv h2e2 h9g7`), depth);
      await page.waitForTimeout(240);
    }
    assert.match(await page.getByTestId('engine-search-status').innerText(), /D16/);
    assert.equal(await page.evaluate(() => window.__appRenders), beforeDepth, 'Depth-only PV updates rerendered App');
    await page.getByRole('button', { name: 'Start new game', exact: true }).click();
    await page.getByTestId('uci-line-input').waitFor();
    const beforeTyping = await page.evaluate(() => window.__appRenders);
    await page.getByTestId('uci-line-input').pressSequentially('h2e2 h9g7 b0c2 b9c7');
    assert.equal(await page.evaluate(() => window.__appRenders), beforeTyping, 'New-game typing rerendered App');
    await page.keyboard.press('Escape');
    console.log('PASS: depth-only recommendations and new-game typing update their own subscribers with zero App renders');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
