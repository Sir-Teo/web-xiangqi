const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function followEngineLine(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = [];
        const emit = line => listeners.forEach(listener => listener(line));
        let position = '';
        return {
          variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
          postMessage(command) {
            if (command.startsWith('position ')) position = command;
            if (command === 'uci') queueMicrotask(() => emit('uciok'));
            if (command === 'isready') queueMicrotask(() => emit('readyok'));
            if (command.startsWith('go ') && position === 'position startpos') queueMicrotask(() => {
              emit('info depth 12 multipv 1 score cp 30 pv h2e2 h9g7 h0g2');
              emit('bestmove h2e2');
            });
            if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
          }
        };
      };
    ` }));
    await page.goto(base);
    await page.keyboard.press('e');
    await page.getByTestId('engine-pv-0-move-2').click();
    for (const [file, rank, piece] of [[4, 2, 'red cannon'], [6, 7, 'black horse'], [6, 2, 'red horse']]) {
      assert.match(await page.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).getAttribute('aria-label'), new RegExp(piece));
    }
    await page.keyboard.press('t');
    assert.equal(await page.locator('.mtree-chip').count(), 3);
    assert.equal(await page.locator('.mtree-chip-active').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`Engine line replay, move tree and layout passed at ${width}px`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try { for (const width of [1440, 390]) await followEngineLine(browser, width); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
