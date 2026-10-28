const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          let nodes = [];
          for (let index = 25; index >= 0; index--) nodes = [{
            uci: ['a0a1', 'a9a8', 'a1a0', 'a8a9'][index % 4], comment: 'Training loop ' + (index === 1 ? 'chosen' : index === 0 ? 'beginning' : index), children: nodes,
          }];
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            {id:'loop',savedAt:1,gameMode:'PvP',label:'Training study',moves:[],moveTree:nodes},
          ]));
        });
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const search = page.getByRole('searchbox', { name: 'Search library' });
        await search.fill('Training loop');
        const results = page.getByTestId('study-matches-loop');
        await results.getByRole('button', { name: 'Find matching positions', exact: true }).click();
        await results.locator('.lib-study-match').first().locator('summary').click();
        await search.fill('Training loop chosen');
        assert.equal(await results.locator('details[open]').count(), 0,
          'Expansion must not transfer to a different move after filtering');
        await results.locator('.lib-study-match').first().locator('summary').click();
        await search.fill('Training loop');
        const expanded = results.locator('.lib-study-match').filter({ has: page.locator('details[open]') });
        assert.equal(await expanded.count(), 1);
        assert.match(await expanded.getByRole('button').innerText(), /ply 2$/,
          'A retained move keeps its own expansion when its position in the list changes');
        const moveResults = results.locator('[data-library-action="open-match"]');
        for (const [count, firstNew] of [[20, 10], [26, 20]]) {
          await results.getByRole('button', { name: /Show \d+ more matching positions/, exact: false }).press('Enter');
          assert.equal(await results.locator('.lib-study-match').count(), count);
          assert.equal(await moveResults.nth(firstNew).evaluate(node => node === document.activeElement), true,
            'Showing more matches must focus the first new move, including when the More button disappears');
          await page.keyboard.press('Tab');
          assert.equal(await results.locator('.lib-study-match').nth(firstNew).locator('summary').evaluate(node => node === document.activeElement), true,
            'Tab must continue through the newly revealed move');
        }
        await search.fill('Training loop chosen');
        await search.fill('Training loop');
        assert.equal(await results.locator('.lib-study-match').count(), 10,
          'Changing a search resets its rendering limit');
        assert.equal(await search.evaluate(node => node === document.activeElement), true,
          'Filtering must keep focus in the search field');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: matching-move pagination keeps keyboard focus; sequence expansion stays with its move across queries`);
      } catch (error) {
        console.error(`${browserType.name()} ${width}px:`, await page.locator('body').innerText());
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
