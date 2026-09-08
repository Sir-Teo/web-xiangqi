const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const games = [
  { id: 'tree', savedAt: 1, gameMode: 'PvAI-Black', result: 'red', label: 'Cannon study',
    moves: ['h2e2', 'h9i7', 'b0c2'],
    moveTree: [{ uci: 'h2e2', comment: 'Central cannon note', children: [
      { uci: 'h9g7', children: [{ uci: 'b0c2' }] },
      { uci: 'h9i7', comment: 'Edge horse note', children: [{ uci: 'b0c2' }] },
    ] }],
  },
  { id: 'plain', savedAt: 2, gameMode: 'PvP', label: 'Main line', moves: ['h2e2', 'h9g7', 'b0c2'] },
  { id: 'black-root', savedAt: 4, gameMode: 'PvP', label: 'Black to move', startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 20', moves: ['h7e7', 'h0g2'] },
  { id: 'bad', savedAt: 3, gameMode: 'PvP', label: 'Damaged game', moves: ['h2e2', 'h9h8'] },
];
(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(games => localStorage.setItem('xiangqi:library:v1', JSON.stringify(games)), games);
      const revealMatches = async () => {
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-graph').click();
        }
        const matches = page.getByTestId('library-matches');
        await matches.waitFor();
        if (await matches.getAttribute('open') === null) await matches.locator('summary').click();
        return matches;
      };
      const next = () => page.locator(width < 900 ? '.mobile-board-nav' : '.graph-jump-controls').getByRole('button', { name: 'Go to next move', exact: true }).click();
      const fen = () => page.locator('.bottombar-fen').getAttribute('title');
      await page.goto(base + '?moves=h2e2');
      const original = await fen();
      const matches = await revealMatches();
      await matches.getByTestId('library-match-tree').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/xiangqi-matching-games-${width}.png` });
      await matches.getByTestId('library-match-bad').click();
      await matches.getByRole('alert').waitFor();
      assert.equal(await fen(), original, 'Invalid game does not change the board');
      await matches.getByTestId('library-match-tree').click();
      assert.equal(await fen(), original, 'Opening a match stays on its occurrence');
      assert.equal(await page.getByRole('heading', { name: 'Red Wins', exact: true }).count(), 0, 'A recorded result must not end an earlier position');
      if (width < 900) {
        await page.getByTestId('mobile-view-analysis').click();
        await page.getByTestId('mobile-analysis-tab-moves').click();
      }
      await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Central cannon note', null, { timeout: 3000 });
      if (width < 900) await page.getByTestId('mobile-view-board').click();
      await next();
      await page.waitForFunction(() => document.querySelector('.hitbox[data-file="8"][data-rank="7"]')?.getAttribute('aria-label')?.includes('horse'));
      // The saved main line chose the SECOND branch. Jumping to the occurrence
      // must preserve that choice, the remaining moves, and every other branch.
      if (width < 900) {
        await page.getByTestId('mobile-view-analysis').click();
        await page.getByTestId('mobile-analysis-tab-moves').click();
      }
      await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Edge horse note');
      await page.screenshot({ path: `/tmp/xiangqi-library-match-${width}.png` });
      // An independent load of a plain game must also retain its future moves.
      await page.goto(base + '?moves=h2e2');
      // Visiting a new link can offer the prior in-progress game.
      const keep = page.getByRole('button', { name: "Keep the link's game", exact: true });
      if (await keep.count()) await keep.click();
      await revealMatches();
      await page.getByTestId('library-match-plain').click();
      assert.equal(await fen(), original);
      await next();
      await page.waitForFunction(() => document.querySelector('.hitbox[data-file="6"][data-rank="7"]')?.getAttribute('aria-label')?.includes('horse'));
      // A custom Black-to-move root must select ply zero, preserving counters.
      const customFen = games.find(game => game.id === 'black-root').startFen;
      await page.goto(base + '?fen=' + encodeURIComponent(customFen));
      if (await keep.count()) await keep.click();
      await revealMatches();
      await page.getByTestId('library-match-black-root').click();
      assert.equal(await fen(), customFen);
      await next();
      await page.waitForFunction(() => / w - - \d+ 21$/.test(document.querySelector('.bottombar-fen')?.getAttribute('title') || ''));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: matching-game navigation preserves position, future moves, chosen branches and notes; invalid records leave the board unchanged; desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
