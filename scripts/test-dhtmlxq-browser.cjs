const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => document.querySelector('.bottombar-fen')?.getAttribute('title')?.includes('1C2C4'));
        const before = await page.locator('.bottombar-fen').getAttribute('title');
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        const input = page.getByTestId('uci-line-input');
        await input.fill('[DhtmlXQ_movelist]'.repeat(11000));
        await page.evaluate(() => {
          window.__dhtmlTiming = { ready: performance.now() };
          const clicked = event => {
            if (!event.target.closest('[data-testid="import-uci-line-btn"]')) return;
            window.__dhtmlTiming.clicked = performance.now();
            document.removeEventListener('click', clicked, true);
          };
          document.addEventListener('click', clicked, true);
          const observer = new MutationObserver(() => {
            if (!document.querySelector('#new-game-line-error') || !window.__dhtmlTiming.clicked) return;
            window.__dhtmlTiming.error = performance.now(); observer.disconnect();
          });
          observer.observe(document.body, { subtree: true, childList: true });
        });
        await page.getByTestId('import-uci-line-btn').click();
        await page.locator('#new-game-line-error').waitFor({ timeout: 5000 });
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), before, 'A malformed record changed the board');
        await page.waitForFunction(() => window.__dhtmlTiming.error);
        const timing = await page.evaluate(() => ({ clickToErrorDomMs: window.__dhtmlTiming.error - window.__dhtmlTiming.clicked, beforeClickMs: window.__dhtmlTiming.clicked - window.__dhtmlTiming.ready }));
        console.log(`${browserType.name()} ${width}px: malformed DhtmlXQ rejected; timing ${JSON.stringify(timing)}`);
        const record = 'İ [DhtmlXQ_movelist]77747062[/DhtmlXQ_movelist]'
          + '[DhtmlXQ_comment999]'.repeat(9800)
          + '[dhtmlxq_comment2]Xiangqi plan İ||炮[/DHTMLXQ_COMMENT2]';
        assert.ok(record.length < 200000);
        await page.getByTestId('uci-line-file-input').setInputFiles({ name: 'Chinese study.txt', mimeType: 'text/plain', buffer: Buffer.from(record) });
        await page.waitForFunction(record => document.querySelector('[data-testid="uci-line-input"]')?.value === record, record);
        await page.getByTestId('import-uci-line-btn').click();
        await input.waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        await page.locator('.mtree-chip').filter({ hasText: 'h9g7' }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(node => node.value === 'Xiangqi plan İ 炮'));
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Save game');
        await page.keyboard.press('Enter');
        const game = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.deepEqual(game.moves, ['h2h5', 'h9g7']);
        assert.equal(game.moveTree[0].children[0].comment, 'Xiangqi plan İ 炮');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: later valid DhtmlXQ comment, Unicode, saved moves/notes and responsive layout passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
