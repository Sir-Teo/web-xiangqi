const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function navigationDebounce(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(document, 'hidden', { get: () => false });
    });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__commands = [];
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = [];
        window.__emit = line => listeners.forEach(listener => listener(line));
        return {
          variant: 'single-simd',
          addMessageListener: listener => listeners.push(listener),
          terminate() {},
          postMessage(command) {
            window.__commands.push(command);
            if (command === 'uci') queueMicrotask(() => window.__emit('uciok'));
            if (command === 'isready') queueMicrotask(() => window.__emit('readyok'));
          }
        };
      };
    ` }));
    await page.clock.install();
    await page.goto(base + '?moves=' + encodeURIComponent('h2e2 h9g7 h0g2'));
    await page.getByTestId('start-engine-analysis').click();
    await page.waitForFunction(() => window.__commands?.some(command => command.startsWith('go ')));
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const searches = () => page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length);
    // Starting analysis returns focus to the board, where arrows move between
    // squares. Use the timeline controls to request history navigation.
    const previous = () => page.getByRole('button', { name: 'Go to previous move', exact: true }).filter({ visible: true }).first().click();
    const before = await searches();
    await previous();
    // Finish the old position while the new position is still debounced.
    await page.evaluate(() => window.__emit('bestmove a0a1'));
    assert.equal(await searches(), before, 'bestmove bypassed the navigation debounce');
    await page.clock.runFor(100);
    assert.equal(await searches(), before, 'Navigation started a search before its deadline');
    await previous();
    await page.clock.runFor(100);
    assert.equal(await searches(), before, 'Superseded position was searched');
    await page.clock.runFor(250);
    assert.equal(await searches(), before + 1, 'Latest position was not searched exactly once');
    assert.match(await page.evaluate(() => window.__commands.filter(command => command.startsWith('position ')).at(-1)), /moves h2e2$/);

    // Once the timer expires during an active search, stop once and wait for
    // bestmove. Completion must then dispatch immediately without another delay.
    await previous();
    await page.clock.runFor(350);
    assert.equal(await searches(), before + 1);
    assert.equal(await page.evaluate(() => window.__commands.filter(command => command === 'stop').length), 1);
    await page.evaluate(() => window.__emit('bestmove a0a1'));
    assert.equal(await searches(), before + 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`Search coalescing, stop acknowledgement and layout passed at ${width}px`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) await navigationDebounce(browser, width);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
