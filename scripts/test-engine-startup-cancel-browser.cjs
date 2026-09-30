const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__boots = 0; window.__aborted = [];
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = ({ signal }) => new Promise((resolve, reject) => {
            const id = window.__boots++;
            if (id < 2) {
              signal?.addEventListener('abort', () => {
                window.__aborted.push(id); reject(new DOMException('Cancelled', 'AbortError'));
              }, { once: true });
              return;
            }
            const listeners = [];
            const emit = line => listeners.forEach(listener => listener(line));
            resolve({ variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  emit('info depth 10 score cp 20 pv h2e2'); emit('bestmove h2e2');
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              }
            });
          });
        ` }));
        await page.goto(base);
    await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__boots === 1);
        await page.keyboard.press('e');
        await page.getByTestId('advanced-engine-maintenance').locator('summary').click();
        await page.getByTestId('restart-engine-btn').click();
        await page.waitForFunction(() => window.__boots === 2);
        assert.deepEqual(await page.evaluate(() => window.__aborted), [0], 'Restart did not cancel its pending predecessor');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox').fill('Settings');
        await page.keyboard.press('Enter');
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.waitForFunction(() => window.__aborted.includes(1));
        assert.equal(await page.evaluate(() => window.__boots), 2, 'Cancellation triggered an unwanted recovery');
        await page.locator('#settings-workspace-mode').selectOption('analysis');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.keyboard.press('e');
        await page.getByTestId('engine-pv-0-move-0').waitFor();
        assert.deepEqual(await page.evaluate(() => window.__aborted), [0, 1]);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: restart/disable cancel pending boot and analysis resumes at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
