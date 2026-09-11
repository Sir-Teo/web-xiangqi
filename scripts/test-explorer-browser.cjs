const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
        { id: 'damaged', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9h8'] },
        { id: 'good', savedAt: 2, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] },
      ])));
      await page.goto(base + '?moves=h2e2');
      if (width < 900) {
        await page.getByTestId('mobile-view-analysis').click();
        await page.getByTestId('mobile-analysis-tab-graph').click();
      }
      await page.getByTestId('library-continuation-h9g7').waitFor();
      assert.equal(await page.getByTestId('library-continuation-h9h8').count(), 0);
      await page.getByTestId('library-continuation-h9g7').click();
      await page.waitForFunction(() => document.querySelector('.hitbox[data-file="6"][data-rank="7"]')?.getAttribute('aria-label')?.includes('horse'));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/xiangqi-explorer-${width}.png` });
      await page.close();
    }
    // Delay worker delivery: board interaction must work before the index exists.
    const page = await browser.newPage();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/*positionExplorer.worker*', async route => { await gate; await route.continue(); });
    await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
      { id: 'study', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] },
    ])));
    await page.goto(base);
    await page.getByTestId('library-explorer-status').waitFor();
    await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
    await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
    release();
    await page.getByTestId('library-continuation-h9g7').waitFor();
    assert.equal(await page.getByTestId('library-continuation-h2e2').count(), 0, 'Old root reply must not appear at the new position');
    await page.close();
    console.log('PASS: explorer excludes illegal saved moves and plays legal continuations on desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
