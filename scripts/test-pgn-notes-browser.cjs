const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function importPgn(page, width, source) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(source);
  const start = Date.now();
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
  return Date.now() - start;
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              }
            };
          };` }));
        await page.goto(base);
        const elapsed = await importPgn(page, width, `h2e2 {${'[%'.repeat(99000)}} h9g7 *`);
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-chip').count(), 2);
        await page.locator('.mtree-chip').first().click();
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === '[%'.repeat(250));
        await command(page, 'Save game');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.moveTree[0].comment, '[%'.repeat(250));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-pgn-notes-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: 198k-character malformed-command note imported, bounded and saved at ${width}px (${elapsed}ms click-to-dialog-close)`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
