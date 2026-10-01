const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const fallback of [false, true]) {
      const context = await browser.newContext();
      if (fallback) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
      const pages = await Promise.all([context.newPage(), context.newPage()]);
      await Promise.all(pages.map((page, i) => page.goto(base + '?moves=' + (i ? 'b2e2' : 'h2e2'))));
      // Each page has an intentionally distinct board, regardless of which
      // autosave became visible while the other page was loading.
      for (const page of pages) {
        await page.bringToFront();
        await page.locator('.xiangqi-board').waitFor();
        const later = page.getByRole('button', { name: 'Decide later', exact: true });
        if (await later.count()) await later.click();
      }
      if (!fallback) {
        await pages[0].bringToFront();
        await pages[0].evaluate(() => {
          void navigator.locks.request('xiangqi:library-write:v1', async () => {
            window.lockHeld = true;
            await new Promise(resolve => { window.releaseLibraryLock = resolve; });
          });
        });
        await pages[0].waitForFunction(() => window.lockHeld, null, { polling: 100, timeout: 10000 });
      }
      await Promise.all(pages.map(page => page.getByTestId('save-game-btn').click()));
      if (!fallback) {
        assert.equal(await pages[0].evaluate(() => localStorage.getItem('xiangqi:library:v1')), null);
        assert.equal(await pages[1].getByTestId('save-game-btn').isDisabled(), true);
        await pages[0].evaluate(() => window.releaseLibraryLock());
      }
      // WebKit suspends background-page polling; observe the committed result in the foreground.
      await pages[0].bringToFront();
      await pages[0].waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 2, null, { polling: 100, timeout: 10000 });
      const games = await pages[0].evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')));
      assert.deepEqual(games.map(game => game.moves[0]).sort(), ['b2e2', 'h2e2']);
      assert.equal(new Set(games.map(game => game.id)).size, 2);
      await context.close();
      console.log(`PASS: simultaneous tab saves retain both records using ${fallback ? 'IndexedDB coordination' : 'Web Locks'}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
