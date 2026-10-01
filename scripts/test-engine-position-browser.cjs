const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const start = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
        window.__commands = [];
        window.Pikafish = function() {};
        window.Pikafish.createWorkerEngine = async () => {
          const listeners = [];
          const emit = line => listeners.forEach(listener => listener(line));
          return {
            variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
            postMessage(command) {
              window.__commands.push(command);
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
            }
          };
        };
      ` }));
      try {
        for (const [suffix, move, expectedRoot] of [
          ['w - - 0 1', 'h2e2', 'startpos'],
          ['w - - 47 32', 'h2e2', `fen ${start} w - - 47 32`],
          ['w - - 0 32', 'h2e2', `fen ${start} w - - 0 32`],
          ['b - - 47 32', 'h9g7', `fen ${start} b - - 47 32`],
        ]) {
          await page.goto(base + '?' + new URLSearchParams({ fen: `${start} ${suffix}`, moves: move }));
          await page.locator('.xiangqi-board').waitFor();
          const later = page.getByRole('button', { name: 'Decide later', exact: true });
          if (await later.isVisible()) await later.click();
          await page.getByTestId('start-engine-analysis').click();
          await page.waitForFunction(() => window.__commands?.some(command => command.startsWith('go ')));
          assert.equal(await page.evaluate(() => window.__commands.find(command => command.startsWith('position '))),
            `position ${expectedRoot} moves ${move}`, 'Engine position discarded the imported counters');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        assert.deepEqual(errors, []);
        console.log(`Imported FEN counters, side and move history reach the engine at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
