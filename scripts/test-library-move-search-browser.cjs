const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'en-US', hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          window.__matchEntries = 0;
          const push = Array.prototype.push;
          Array.prototype.push = function(...values) {
            for (const value of values) if (value?.node?.uci && typeof value.text === 'string' && Number.isInteger(value.ply)) window.__matchEntries++;
            return Reflect.apply(push, this, values);
          };
          const analysis = { version: 1, position: 'position startpos moves b2e2', move: 'h9g7', score: 125, scoreKind: 'cp', bounded: true, bound: 'lower',
            depth: 27, savedAt: 1, engine: { name: 'Pikafish Research build', variant: 'single-simd', threads: 1, hashMB: 64 }, multiPv: 2 };
          let loop = [];
          for (let i = 15; i >= 0; i--) loop = [{ uci: ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4], comment: 'Training loop ' + i, children: loop }];
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'prepared', savedAt: 1, gameMode: 'PvP', label: 'Prepared study', moves: ['h2e2', 'h9g7'], result: 'red',
              rootComment: 'Starting guide: 中炮 overview',
              metadata: { redPlayer: 'Lin' }, mainLinePinned: true,
              moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', comment: 'Shared preparation: main road' }] },
                { uci: 'b2e2', children: [{ uci: 'h9g7', comment: 'Shared preparation: Dragon trap 龙门', analysis }] }],
              review: { summary: { totalMoves: 2, accuracy: 90, reviewedAt: 1 },
                annotations: [{ moveIndex: 0, evalScore: 42, quality: 'good' }, { moveIndex: 1, evalScore: 50, quality: 'mistake', reviewNote: 'Review belongs to the saved path' }] } },
            { id: 'loop', savedAt: 2, gameMode: 'PvP', label: 'Training study', moves: [], moveTree: loop },
            { id: 'root-only', savedAt: 3, gameMode: 'PvP', label: 'Root lesson', moves: [],
              rootComment: 'A note-only lesson Cafe\u0301 龙门',
              startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 42' },
            { id: 'legacy', savedAt: 4, gameMode: 'PvP', label: 'Legacy study', moves: ['h2e2', 'h9g7'],
              cursorPly: 2, result: 'red', rootComment: 'Legacy starting guide' },
          ]));
        });
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
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library');
        const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const search = page.getByRole('searchbox', { name: 'Search library' });
        await search.fill('Pikafish Research');
        const matches = page.getByTestId('study-matches-prepared');
        assert.equal(await page.evaluate(() => window.__matchEntries), 0, 'Ordinary filtering must not build the move-location index');
        await matches.getByRole('button', { name: 'Find matching positions', exact: true }).click({ timeout: 5000 });
        assert.ok(await page.evaluate(() => window.__matchEntries) > 0, 'Probe must observe on-demand indexing');
        await page.evaluate(() => { window.__matchEntries = 0; });
        assert.match(await matches.innerText(), /1 matching position/);
        assert.match(await matches.innerText(), /lower bound, not exact/);
        await search.fill('Shared preparation');
        assert.equal(await matches.locator('[data-library-action="open-match"]').count(), 2);
        assert.equal(await page.evaluate(() => window.__matchEntries), 0, 'Changed queries must reuse the expanded study index');
        await matches.locator('.lib-study-match').last().locator('summary').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="study-matches-prepared"] code')?.textContent === 'b2e2 h9g7');
        assert.equal(await matches.locator('code').innerText(), 'b2e2 h9g7');
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          const button = matches.locator('[data-library-action="open-match"]').last();
          await button.scrollIntoViewIfNeeded();
          assert.ok((await button.boundingBox()).height >= 44, 'Open controls retain a touch target');
          assert.equal(await button.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-library-move-search-${browserType.name()}-${width}-${size}.png` });
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        // Equal UCI moves on two branches must open the chosen occurrence.
        await matches.locator('[data-library-action="open-match"]').first().focus();
        await page.keyboard.press('Tab');
        assert.equal(await matches.locator('summary').first().evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await matches.locator('[data-library-action="open-match"]').last().evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Shared preparation: Dragon trap 龙门');
        await page.getByTestId('saved-analysis-card').waitFor();
        assert.doesNotMatch(await page.getByTestId('move-tree-active').getAttribute('class'), /quality-mistake/);
        assert.deepEqual(await page.locator('.mtree-row .move-uci').allTextContents(), ['b2e2', 'h9g7']);
        assert.equal(await page.locator('.game-over-modal').count(), 0, 'Saved-line win must not end the selected side line');
        // Search through metadata still finds the game but must not invent a single-move match.
        await command(page, 'Library'); await search.fill('Lin Dragon');
        await matches.getByRole('button', { name: 'Find matching positions', exact: true }).click();
        assert.match(await matches.innerText(), /No single position matches every search word/);
        await search.fill('Shared preparation');
        await matches.locator('[data-library-action="open-match"]').first().click();
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Shared preparation: main road');
        assert.equal(await page.getByTestId('saved-analysis-card').count(), 0);
        assert.match(await page.getByTestId('move-tree-active').getAttribute('class'), /quality-mistake/);
        assert.deepEqual(await page.locator('.mtree-row .move-uci').allTextContents(), ['h2e2', 'h9g7']);
        assert.match(await page.locator('body').innerText(), /Review belongs to the saved path/);
        await command(page, 'Library'); await search.fill('Training loop');
        const loop = page.getByTestId('study-matches-loop');
        await loop.getByRole('button', { name: 'Find matching positions', exact: true }).click();
        assert.match(await loop.innerText(), /16 matching positions/);
        assert.equal(await loop.locator('[data-library-action="open-match"]').count(), 10);
        await loop.getByRole('button', { name: 'Show 6 more matching positions' }).click();
        assert.equal(await loop.locator('[data-library-action="open-match"]').count(), 16);
        await loop.locator('[data-library-action="open-match"]').last().click();
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Training loop 15');
        for (const [gameId, query, note, moveCount] of [
          ['prepared', '中炮 overview', 'Starting guide: 中炮 overview', 2],
          ['root-only', 'CAFÉ 龙门', 'A note-only lesson Café 龙门', 0],
          ['legacy', 'Legacy starting guide', 'Legacy starting guide', 2],
        ]) {
          await command(page, 'Library');
          await search.fill(query);
          const rootMatches = page.getByTestId(`study-matches-${gameId}`);
          await rootMatches.getByRole('button', { name: 'Find matching positions', exact: true }).click();
          assert.match(await rootMatches.innerText(), /1 matching position/);
          assert.equal(await rootMatches.locator('summary').count(), 0, 'The starting position must not invent a move sequence');
          for (const size of [16, 32]) {
            await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
            await rootMatches.getByRole('button', { name: 'Open starting position', exact: true }).scrollIntoViewIfNeeded();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          }
          await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
          await rootMatches.getByRole('button', { name: 'Open starting position', exact: true }).click();
          assert.equal((await page.getByTestId('move-comment-input').inputValue()).normalize('NFC'), note);
          assert.equal(await page.locator('.mtree-row .move-uci').count(), moveCount, 'Opening the root must retain the saved continuation');
          assert.equal(await page.getByTestId('move-comment-input').getAttribute('aria-label'), 'Note on starting position');
          assert.equal(await page.locator('.game-over-modal').count(), 0, 'The saved endpoint result must not end the starting position');
          if (gameId === 'root-only') {
            assert.match(await page.locator('.bottombar-fen').getAttribute('title'), / b - - 0 42$/);
          }
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before, 'Opening matches must preserve the stored cursor, tree, results and review');
        await command(page, 'Library'); await search.fill('Prepared study');
        await page.getByTestId('load-saved-prepared').click();
        await page.locator('.game-over-modal').waitFor();
        assert.match(await page.locator('.game-over-title').innerText(), /Red Wins/i, 'Normal Load must still honor the saved result');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: exact branch opening, saved analysis/review scope, mixed-field explanation, pagination and 100/200% text passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
