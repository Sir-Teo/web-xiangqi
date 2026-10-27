const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify(
          Array.from({ length: 205 }, (_, index) => ({ id: `paged-${index}`, label: `Paged study ${index}`,
            savedAt: 1000 + index, gameMode: 'PvP', moves: ['h2e2'] }))
        )));
        await page.goto(base + '?moves=b2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const cards = page.getByTestId('saved-game-list').locator('.lib-card');
        const more = page.getByTestId('library-show-more-saved');
        await cards.nth(99).waitFor();
        assert.equal(await cards.count(), 100);
        for (const [firstNew, expected] of [[100, 200], [200, 205]]) {
          await more.press('Enter');
          assert.equal(await cards.count(), expected);
          assert.equal(await cards.nth(firstNew).locator('[data-library-action="load"]').evaluate(element => element === document.activeElement), true,
            'Loading saved games must focus the first new card');
          await page.keyboard.press('ArrowDown');
          assert.equal(await cards.nth(firstNew + 1).locator('[data-library-action="load"]').evaluate(element => element === document.activeElement), true,
            'Arrow navigation must continue from the newly loaded page');
        }
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen,
          'Paging and arrow navigation must not load a saved game');
        assert.equal(await more.count(), 0);
        await page.getByTestId(width < 900 ? 'mobile-analysis-tab-graph' : 'left-panel-tab-graph').click();
        await page.getByTestId(width < 900 ? 'mobile-analysis-tab-library' : 'left-panel-tab-library').click();
        await cards.nth(204).waitFor();
        assert.equal(await cards.count(), 205, 'Returning from the graph retains already revealed pages');
        const search = page.getByRole('searchbox', { name: 'Search library', exact: true });
        await search.fill('Paged study 204');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length === 1);
        assert.equal(await search.evaluate(element => element === document.activeElement), true,
          'A later search must retain focus in its input');
        await search.clear();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length === 100);
        assert.equal(await more.count(), 1, 'A different search starts on its first page');
        await more.press('Enter'); assert.equal(await cards.count(), 200);
        await page.getByRole('combobox', { name: 'Sort saved games', exact: true }).selectOption('oldest');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length === 100);
        assert.equal(await cards.first().getAttribute('data-game-id'), 'paged-0', 'A different sort resets pages and applies its new order');
        for (const [name, value] of [['Filter by review status', 'unreviewed'], ['Filter by result', 'ongoing']]) {
          await more.press('Enter'); assert.equal(await cards.count(), 200);
          await page.getByRole('combobox', { name, exact: true }).selectOption(value);
          await page.waitForFunction(() => document.querySelectorAll('[data-testid="saved-game-list"] .lib-card').length === 100);
        }
        await page.reload(); await page.locator('.xiangqi-board').waitFor();
        await page.getByRole('dialog', { name: 'Unfinished game', exact: true }).getByRole('button', { name: 'Decide later', exact: true }).click();
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        await cards.nth(99).waitFor();
        assert.equal(await cards.count(), 100, 'A fresh page starts with the initial render limit');
        assert.equal(await page.getByRole('combobox', { name: 'Sort saved games', exact: true }).inputValue(), 'recent');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: new-page focus, arrow navigation, retained pages on return, query/sort resets and fresh-page defaults passed`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-library-pagination-${browserType.name()}-${width}-failure.png`, timeout: 5000 }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
