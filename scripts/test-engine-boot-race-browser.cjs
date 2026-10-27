const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function lateBoot(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => { window.__WEB_XIANGQI_ENGINE_READY_TIMEOUT_MS = 5000; });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__boots = [];
      window.__terminated = [];
      window.__commands = [];
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = () => new Promise(resolve => {
        const id = window.__boots.length;
        const listeners = [];
        const emit = line => listeners.forEach(listener => listener(line));
        const engine = {
          variant: 'single-simd', addMessageListener: listener => listeners.push(listener),
          terminate() { window.__terminated.push(id); },
          postMessage(command) {
            window.__commands.push({ id, command });
            if (command === 'uci') queueMicrotask(() => emit('uciok'));
            if (command === 'isready') queueMicrotask(() => emit('readyok'));
            if (command.startsWith('go ')) queueMicrotask(() => {
              emit('info depth 10 score cp 20 pv h2e2');
              emit('bestmove h2e2');
            });
            if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
          }
        };
        window.__boots.push(() => resolve(engine));
        if (id >= 2) resolve(engine);
      });
    ` }));
    // Freeze before startup so protocol latency cannot overtake a pause target
    // or consume part of the boot watchdog's five-second deadline.
    const clockStart = new Date('2026-01-01T00:00:00Z');
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
    await page.goto(base);
    await page.getByTestId('start-engine-analysis').click();
    await page.waitForFunction(() => window.__boots?.length === 1);
    await page.keyboard.press('e');
    if (!(await page.getByTestId('restart-engine-btn').isVisible())) await page.getByTestId('advanced-engine-maintenance').locator('summary').click();
    await page.getByTestId('restart-engine-btn').click();
    assert.equal(await page.evaluate(() => window.__boots.length), 2);
    // Complete the abandoned constructor while its replacement is still booting.
    await page.evaluate(() => window.__boots[0]());
    assert.deepEqual(await page.evaluate(() => window.__terminated), [0]);
    assert.equal(await page.evaluate(() => window.__commands.some(entry => entry.id === 0)), false);
    await page.clock.runFor(5500);
    assert.ok(await page.evaluate(() => window.__boots.length >= 3), 'Late old worker cancelled the replacement boot watchdog');
    await page.clock.runFor(500);
    await page.getByTestId('engine-pv-0-move-0').waitFor();
    assert.equal(await page.evaluate(() => window.__commands.some(entry => entry.id === 1)), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`Late boot cleanup preserves replacement timeout and automatic recovery at ${width}px`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try { for (const width of [1440, 390]) await lateBoot(browser, width); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
