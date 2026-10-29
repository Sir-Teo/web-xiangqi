const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function settings(page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Settings'); await page.keyboard.press('Enter');
  await page.getByTestId('settings-dialog').waitFor();
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, memory] of [[1440, 8], [1440, 2], [390, 8]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      await page.clock.install();
      await page.addInitScript(memory => { Object.defineProperty(navigator, 'deviceMemory', { get: () => memory }); }, memory);
      await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        window.__boots = 0; window.__terminated = 0; window.__instances = [];
        window.Pikafish = function() {};
        window.Pikafish.createWorkerEngine = async () => {
          window.__boots++; const listeners = new Set(); window.__instances.push(listeners);
          const emit = line => listeners.forEach(listener => listener(line));
          return { variant: 'single-simd', addMessageListener: fn => listeners.add(fn), removeMessageListener: fn => listeners.delete(fn),
            terminate() { window.__terminated++; }, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
        };` }));
      await page.goto(base); await page.getByTestId('start-engine-analysis').click();
      await page.waitForFunction(() => window.__boots === 1);
      await settings(page);
      const warm = width === 1440 && memory === 8;
      for (let round = 0; round < 3; round++) {
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.waitForFunction(warm => window.__terminated === (warm ? 0 : window.__boots), warm);
        await page.locator('#settings-workspace-mode').selectOption('analysis');
        await page.waitForFunction(expected => window.__boots === expected, warm ? 1 : round + 2);
      }
      assert.equal(await page.evaluate(() => window.__instances.at(-1).size), 1, 'Old subscriptions leaked on reuse');
      if (warm) {
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.clock.fastForward(15_100);
        await page.waitForFunction(() => window.__terminated === 1);
        await page.locator('#settings-workspace-mode').selectOption('analysis');
        await page.waitForFunction(() => window.__boots === 2);
      }
      await page.close();
      console.log(`${browserType.name()} ${width}px/${memory}GB: bounded idle reuse, expiry, low-memory/mobile policy and listener cleanup passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
