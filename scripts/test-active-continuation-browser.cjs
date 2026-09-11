const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
const mainLine = page => page.locator('.mtree-row .move-uci').allTextContents();
const move = (page, uci) => page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: uci }) });
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } }));
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
        await page.goto(base);
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('1.h2e2 {Main cannon} h9g7 (1...b9c7 {Other horse}) 2.h0g2 {Main red horse} (2.b0c2 {Other red horse}) *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        const original = ['h2e2', 'h9g7', 'h0g2'];
        assert.deepEqual(await mainLine(page), original);
        await move(page, 'h2e2').click();
        assert.deepEqual(await mainLine(page), original, 'Clicking a shared ancestor must not select a different continuation');
        await page.locator('.tree-breadcrumb-chip[data-breadcrumb-index="0"]').click();
        assert.deepEqual(await mainLine(page), original, 'Clicking Start must preserve the chosen continuation');
        await command(page, 'Copy PGN');
        const before = await page.evaluate(() => window.__copied);
        assert.match(before, /1\. h2e2/);

        // Selecting another branch explicitly is still allowed. Its parent
        // and root then retain that choice, including after keyboard activation.
        await move(page, 'b9c7').click();
        assert.deepEqual(await mainLine(page), ['h2e2', 'b9c7']);
        await page.locator('.tree-breadcrumb-chip[data-breadcrumb-index="1"]').focus();
        await page.keyboard.press('Enter');
        assert.deepEqual(await mainLine(page), ['h2e2', 'b9c7']);
        await move(page, 'h9g7').click();
        await move(page, 'h0g2').click();
        assert.deepEqual(await mainLine(page), original);
        await move(page, 'h9g7').click();
        assert.deepEqual(await mainLine(page), original, 'A nested fork must keep its selected child');
        await page.locator('.tree-breadcrumb-chip[data-breadcrumb-index="0"]').click();
        await command(page, 'Copy PGN');
        assert.equal(await page.evaluate(() => window.__copied), before, 'Pure ancestor navigation must not change PGN branch priority');
        assert.equal(await page.locator('.mtree-chip').count(), 5);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: ancestor/root navigation preserves selected forks and PGN ordering; explicit branch switching still works`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
