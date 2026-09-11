const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function wdlFreshness(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__commands = [];
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = [];
        window.__emit = line => listeners.forEach(listener => listener(line));
        return {
          variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
          postMessage(command) {
            window.__commands.push(command);
            if (command === 'uci') queueMicrotask(() => window.__emit('uciok'));
            if (command === 'isready') queueMicrotask(() => window.__emit('readyok'));
            if (command === 'stop') queueMicrotask(() => window.__emit('bestmove h0g2'));
          }
        };
      };
    ` }));
    await page.clock.install();
    await page.goto(base + '?moves=h2e2,h9g7');
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__commands?.some(command => command.startsWith('go ')));
    // Use the browser's clock origin; the Node clock can be a few ms behind.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    if (width < 900) await page.getByTestId('mobile-analysis-tab-graph').click();
    const bar = page.locator('.wdl-bar');
    const emit = line => page.evaluate(value => window.__emit(value), line);
    await emit('info depth 10 multipv 1 score cp 300 wdl 900 50 50 pv h0g2');
    await page.clock.runFor(200);
    assert.equal(await bar.getAttribute('aria-label'), 'Win/draw/loss estimate: Red 90.0%, Draw 5.0%, Black 5.0%');

    await page.locator('.graph-jump-controls [aria-label="Go to previous move"]').click();
    // The old search finishes during the new position's debounce window.
    await emit('info depth 11 multipv 1 score cp 300 wdl 900 50 50 pv h0g2');
    await emit('bestmove h0g2');
    assert.equal(await bar.getAttribute('aria-label'), 'Win/draw/loss estimate unavailable', 'Previous position WDL was assigned to the new side');
    await page.clock.runFor(350);
    await emit('info depth 10 multipv 1 score cp 200 wdl 700 200 100 pv h9g7');
    await page.clock.runFor(200);
    const exact = 'Win/draw/loss estimate: Red 10.0%, Draw 20.0%, Black 70.0%';
    assert.equal(await bar.getAttribute('aria-label'), exact);

    // A bound rejected by the PV must not replace that PV's exact WDL.
    await emit('info depth 10 multipv 1 score cp 900 lowerbound wdl 1000 0 0 pv h9g7');
    await page.clock.runFor(200);
    assert.equal(await bar.getAttribute('aria-label'), exact, 'Bounded WDL disagrees with the retained exact PV');
    await bar.screenshot({ path: `/tmp/xiangqi-wdl-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`WDL position identity, Red perspective and bound consistency passed at ${width}px`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try { for (const width of [1440, 390]) await wdlFreshness(browser, width); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
