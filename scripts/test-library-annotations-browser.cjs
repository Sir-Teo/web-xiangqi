const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const games = [
  { id: 'notes', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'], metadata: { redPlayer: 'Lin' }, moveTree: [
    { uci: 'h2e2', comment: 'Main road', children: [
      { uci: 'h9g7' }, { uci: 'b9c7', comment: 'Dragon trap 龙门', quality: 'blunder', evalScore: 20000, evalScoreKind: 'cp' },
    ] },
  ] },
  { id: 'mate', savedAt: 2, gameMode: 'PvP', moves: ['h2e2'], finalEval: 29997, moveTree: [{ uci: 'h2e2', comment: 'Palace defense', evalScore: 29997 }] },
  { id: 'plain', savedAt: 3, gameMode: 'PvP', moves: ['b2e2'] },
];
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(games => localStorage.setItem('xiangqi:library:v1', JSON.stringify(games)), games);
        await page.goto(base);
        const command = async label => {
          await page.keyboard.press('ControlOrMeta+k');
          await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
          await page.keyboard.press('Enter');
        };
        await command('Library');
        const search = page.getByRole('searchbox', { name: 'Search library' });
        for (const [query, ids] of [
          ['dragon', ['notes']], ['Lin DRAGON', ['notes']], ['龙门', ['notes']], ['Main road', ['notes']],
          ['blunder', ['notes']], ['+200.00', ['notes']], ['20000cp', ['notes']],
          ['+M3', ['mate']], ['29997cp', []], ['h9g7', ['notes']], ['', ['mate', 'notes', 'plain']],
        ]) {
          await search.fill(query);
          await page.waitForFunction(ids => {
            const found = [...document.querySelectorAll('[data-testid^="load-saved-"]')].map(node => node.dataset.testid.slice('load-saved-'.length)).sort();
            return JSON.stringify(found) === JSON.stringify(ids);
          }, ids);
        }
        await search.fill('Lin dragon');
        await page.getByTestId('load-saved-notes').waitFor();
        await page.screenshot({ path: `/tmp/xiangqi-library-note-search-${browserType.name()}-${width}.png` });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        await page.getByTestId('load-saved-notes').click();
        await page.keyboard.press('t');
        await page.locator('.mtree-chip').filter({ hasText: 'b9c7' }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(node => node.value === 'Dragon trap 龙门'));
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before, 'Searching or opening a result mutated the saved study');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: mainline/variation notes, Chinese and mixed-field terms, qualities, typed scores, moves and intact study loading passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
