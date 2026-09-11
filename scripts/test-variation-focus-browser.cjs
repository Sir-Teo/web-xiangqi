const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: 128 }, (_, i) => cycle[i % 4]).join('+'));
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n128');
        await page.keyboard.press('t');
        await page.getByTestId('move-tree-active').click();
        assert.equal(await page.locator('.mtree-chip[tabindex="0"]').getAttribute('data-node-id'), 'n128');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.locator('button[aria-label="Go to first position"]:visible').first().click();
        await page.locator('.xiangqi-board .hitbox[data-file="7"][data-rank="2"]').click();
        await page.locator('.xiangqi-board .hitbox[data-file="4"][data-rank="2"]').click();
        await page.keyboard.press('t');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n129');
        assert.equal(await page.locator('.mtree-variation .mtree-chip').count(), 80);
        assert.equal(await page.locator('.mtree-variation-rest').innerText(), '+48');
        const stops = page.locator('.mtree-chip[tabindex="0"]');
        assert.equal(await stops.count(), 1, 'The remembered move is beyond the shortened variation; the visible list still needs a tab stop');
        assert.equal(await stops.getAttribute('data-node-id'), 'n129');
        await page.locator('.tree-breadcrumb-chip[tabindex="0"]').focus();
        // macOS WebKit uses Option-Tab for Safari's full control sequence.
        await page.keyboard.press(browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n129');
        await page.locator('.mtree-variation [data-node-id="n80"]').focus();
        assert.equal(await stops.getAttribute('data-node-id'), 'n80', 'A still-visible variation move should keep its tab stop');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n80');
        assert.equal(await stops.count(), 1);
        await stops.focus();
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n128');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: shortened variation focus fallback, native Tab entry, visible-focus retention and full-line keyboard navigation passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
