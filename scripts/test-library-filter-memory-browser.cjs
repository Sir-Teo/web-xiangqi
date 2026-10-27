const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
};
const games = [
  { id: 'alpha', savedAt: 1, label: 'Cannon 龙 alpha', result: 'red' },
  { id: 'beta', savedAt: 3, label: 'Cannon 龙 beta', result: 'red' },
  { id: 'draw', savedAt: 2, label: 'Cannon 龙 draw', result: 'draw' },
  { id: 'other', savedAt: 4, label: 'Other red game', result: 'red' },
].map(game => ({ ...game, gameMode: 'PvP', moves: ['h2e2'] }));

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(games => localStorage.setItem('xiangqi:library:v1', JSON.stringify(games)), games);
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.locator('.board-stage .hitbox[tabindex="0"]').first().focus();
        await command(page, 'Search library');
        const search = page.getByRole('searchbox', { name: 'Search library', exact: true });
        const review = page.getByRole('combobox', { name: 'Filter by review status', exact: true });
        const result = page.getByRole('combobox', { name: 'Filter by result', exact: true });
        const sort = page.getByRole('combobox', { name: 'Sort saved games', exact: true });
        const visibleIds = () => page.locator('.lib-card[data-game-id]').evaluateAll(cards => cards.map(card => card.dataset.gameId));
        const values = async () => ({ search: await search.inputValue(), review: await review.inputValue(), result: await result.inputValue(), sort: await sort.inputValue() });
        const defaults = { search: '', review: 'all', result: 'all', sort: 'recent' };
        const selected = { search: 'Cannon 龙', review: 'unreviewed', result: 'red', sort: 'oldest' };
        await page.waitForFunction(() => document.activeElement === document.querySelector('.lib-search'));
        await search.fill(selected.search); await review.selectOption(selected.review);
        await result.selectOption(selected.result); await sort.selectOption(selected.sort);
        await page.getByTestId('library-search-status').filter({ hasText: /^2 saved games\./ }).waitFor();
        assert.deepEqual(await visibleIds(), ['alpha', 'beta']);
        await command(page, 'Search library');
        await page.waitForFunction(() => document.activeElement === document.querySelector('.lib-search'));
        assert.deepEqual(await values(), selected, 'Search command preserves the current query and filters');
        assert.deepEqual(await search.evaluate(node => [node.selectionStart, node.selectionEnd]), [0, selected.search.length], 'Search command selects the current query for replacement');

        await command(page, 'Evaluation graph');
        assert.equal(await search.count(), 0, 'The lazy library should unmount while the graph is open');
        await command(page, 'Library'); await search.waitFor();
        assert.deepEqual(await values(), selected, 'Commands retain the query and each filter');
        await page.getByTestId('library-search-status').filter({ hasText: /^2 saved games\./ }).waitFor();
        assert.deepEqual(await visibleIds(), ['alpha', 'beta'], 'Restored choices produce the same ordered results');
        assert.match(await page.getByTestId('library-pgn-export').textContent(), /Download 2 games as PGN/);

        await page.getByTestId(width < 900 ? 'mobile-analysis-tab-graph' : 'left-panel-tab-graph').click();
        await page.getByTestId(width < 900 ? 'mobile-analysis-tab-library' : 'left-panel-tab-library').click();
        await search.waitFor(); assert.deepEqual(await values(), selected, 'Panel tabs retain the same choices');
        await search.focus();
        await search.evaluate(node => {
          node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
          const finalImeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
          Object.defineProperty(finalImeKey, 'keyCode', { value: 229 }); node.dispatchEvent(finalImeKey);
        });
        assert.deepEqual(await values(), selected, 'IME Escape and final 229 events preserve the query');
        await search.press('Escape');
        assert.deepEqual(await values(), { ...selected, search: '' }, 'Escape clears the query while preserving filters and sorting');
        assert.equal(await search.evaluate(node => node === document.activeElement), true, 'Clearing the query keeps search focus');
        for (const activation of ['pointer', 'keyboard']) {
          await search.fill(selected.search);
          await page.getByTestId('library-search-status').filter({ hasText: /^2 saved games\./ }).waitFor();
          const clear = page.getByRole('button', { name: 'Clear library search', exact: true });
          const target = await clear.boundingBox();
          assert.ok(target.width >= 44 && target.height >= 44, 'Clear search needs a touch target');
          if (activation === 'pointer') await clear.click();
          else { await clear.focus(); await page.keyboard.press('Enter'); }
          assert.deepEqual(await values(), { ...selected, search: '' }, `${activation}: Clear must preserve filters and sorting`);
          assert.equal(await search.evaluate(node => node === document.activeElement), true, 'Clear must return focus to the search field');
          assert.equal(await clear.count(), 0, 'The clear action must disappear with the empty query');
          await page.getByTestId('library-search-status').filter({ hasText: /^3 saved games\./ }).waitFor();
          assert.deepEqual(await visibleIds(), ['alpha', 'beta', 'other']);
        }
        await search.fill(selected.search);
        const reset = page.getByRole('button', { name: 'Reset', exact: true });
        await reset.focus(); await reset.press('Enter');
        assert.deepEqual(await values(), defaults);
        assert.equal(await search.evaluate(element => element === document.activeElement), true, 'Reset returns focus to search when its button disappears');
        await command(page, 'Evaluation graph'); await command(page, 'Library'); await search.waitFor();
        assert.deepEqual(await values(), defaults, 'Reset replaces the remembered choices');
        assert.deepEqual(await visibleIds(), ['other', 'beta', 'draw', 'alpha']);

        await search.fill(selected.search); await review.selectOption(selected.review);
        await result.selectOption(selected.result); await sort.selectOption(selected.sort);
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original, 'Navigation and filtering preserve saved records');
        await page.reload(); await page.locator('.xiangqi-board').waitFor(); await command(page, 'Library');
        await search.waitFor(); assert.deepEqual(await values(), defaults, 'A fresh page starts with the full library');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original, 'Navigation and filtering preserve saved records');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'Library navigation preserves the board');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: direct search command, retained query/filters, Escape/IME, reset focus and fresh-page defaults passed`);
      } finally { await page.close(); }
    }
    for (const [width, nextAction] of [[1440, 'board'], [390, 'settings'], [1440, 'tabs'], [390, 'tabs']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let requested;
      const moduleRequested = new Promise(resolve => { requested = resolve; });
      try {
        await page.route(url => /\/(?:assets\/LibraryPanel-[^/]+\.js|src\/components\/Library\/LibraryPanel\.tsx)(?:\?|$)/.test(url.href), async route => {
          requested(); await gate; await route.continue();
        });
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const origin = page.locator('.board-stage .hitbox[data-file="0"][data-rank="0"]');
        const libraryTab = page.getByTestId(width < 900 ? 'mobile-analysis-tab-library' : 'left-panel-tab-library');
        if (nextAction === 'tabs') {
          await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
          await libraryTab.focus();
        }
        else await origin.focus();
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Search library'); await moduleRequested;
        let target;
        if (nextAction === 'settings') {
          await command(page, 'Settings'); target = page.getByRole('dialog', { name: 'Settings', exact: true }); await target.waitFor();
        } else if (nextAction === 'board') {
          target = page.locator('.board-stage .hitbox[data-file="1"][data-rank="0"]'); await target.focus();
        } else {
          target = libraryTab;
          await page.getByTestId(width < 900 ? 'mobile-analysis-tab-moves' : 'left-panel-tab-graph').click();
        }
        release();
        if (nextAction === 'tabs') await libraryTab.click();
        await page.waitForFunction(() => Boolean(document.querySelector('.lib-search')));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await target.evaluate(node => node === document.activeElement || node.contains(document.activeElement)), true,
          'A delayed library must not take focus from a newer control or dialog');
        if (nextAction === 'settings') {
          await page.keyboard.press('Escape'); await target.waitFor({ state: 'hidden' });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.notEqual(await page.evaluate(() => document.activeElement?.className), 'lib-search', 'Consumed focus requests do not reactivate when a newer dialog closes');
        }
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        console.log(`${browserType.name()} ${width}px: delayed search command respects newer ${nextAction} focus`);
      } finally { release(); await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
