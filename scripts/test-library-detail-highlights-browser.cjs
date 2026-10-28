const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'details', label: 'Study <b>Search</b> notebook', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], metadata: {
            redPlayer: 'Player '.repeat(30) + 'Alice', blackPlayer: 'Black player', redRating: '2500',
            event: 'Tournament '.repeat(20), site: 'City '.repeat(40) + 'Far Harbor',
            annotator: 'Coach '.repeat(35) + 'Irene Cafe\u0301', timeControl: '600+5',
          } },
          { id: 'other', label: 'Other study', savedAt: 2, gameMode: 'PvP', moves: ['b2e2'] },
        ])));
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const search = page.getByRole('searchbox', { name: 'Search library' });
        const metadata = page.getByTestId('metadata-saved-details');
        const lines = metadata.locator('.lib-detail-line');
        const toggle = metadata.getByRole('button', { name: 'Game details for Study <b>Search</b> notebook', exact: true });
        const raw = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        for (const fontSize of [16, 32]) {
          await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, fontSize);
          for (const [query, indices, expected] of [
            ['far HARBOR', [1], ['Far', 'Harbor']],
            ['Alice 2500', [0], ['Alice', '2500']],
            ['Irene café', [2], ['Irene', 'Cafe\u0301']],
            ['Alice Harbor Irene', [0, 1, 2], ['Alice', 'Harbor', 'Irene']],
            ['a Irene', [0, 1, 2], ['a', 'Irene']],
          ]) {
            await search.fill(query);
            await page.waitForFunction(({ count, expected }) => {
              const root = document.querySelector('[data-testid="metadata-saved-details"]');
              const marks = [...(root?.querySelectorAll('mark') ?? [])].map(node => node.textContent);
              return root?.querySelectorAll('[data-search-match="true"]').length === count && expected.every(text => marks.includes(text));
            }, { count: indices.length, expected });
            assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Search must preserve the reader’s disclosure choice');
            assert.equal(await search.evaluate(node => node === document.activeElement), true);
            for (const index of [0, 1, 2]) {
              const line = lines.nth(index);
              const size = await line.evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight, clamp: getComputedStyle(node).webkitLineClamp }));
              if (indices.includes(index)) {
                assert.ok(size.scroll <= size.client + 1, `${query}: matching detail is clipped (${JSON.stringify(size)})`);
                assert.notEqual(size.clamp, '2');
                assert.ok(await line.locator('mark').count() <= query.trim().split(/\s+/).length * 8,
                  'Common letters must not create an unbounded number of highlight elements');
                for (const mark of await line.locator('mark').all()) {
                  await mark.scrollIntoViewIfNeeded();
                  assert.equal(await mark.evaluate(node => {
                    const hit = node.getBoundingClientRect();
                    const parent = node.closest('.lib-detail-line').getBoundingClientRect();
                    return hit.top >= parent.top - 1 && hit.bottom <= parent.bottom + 1;
                  }), true, 'Highlighted original text must fit inside its detail line');
                }
              } else assert.equal(size.clamp, '2', 'Unrelated details keep their compact preview');
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          }
          await search.fill('Search');
          const title = page.locator('[data-game-id="details"] .lib-game-name-button');
          await title.locator('mark').waitFor();
          assert.equal(await title.textContent(), 'Study <b>Search</b> notebook');
          assert.equal(await title.locator('b').count(), 0, 'Saved text must render literally');
          await search.fill('');
          assert.equal(await metadata.locator('mark').count(), 0);
          assert.equal(await metadata.locator('[data-search-match="true"]').count(), 0);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          for (const line of await lines.all()) assert.equal(await line.evaluate(node => getComputedStyle(node).webkitLineClamp), '2');
          await toggle.click();
          await search.fill('Far Harbor');
          await metadata.locator('mark').first().waitFor();
          await search.fill('');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'Manual expansion survives search changes');
          for (const line of await lines.all()) assert.equal(await line.evaluate(node => node.scrollHeight <= node.clientHeight + 1), true);
          await toggle.click();
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), raw, 'Filtering must leave saved metadata untouched');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: title/detail highlights, original Unicode and literal text, full matching lines at 100/200%, compact reset, disclosure state and unchanged saves passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
