const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const tree = [
  { uci: 'h2e2', comment: 'Primary cannon', children: [{ uci: 'h9g7', comment: 'Primary reply', children: [{ uci: 'b0c2', recordedResult: 'draw', comment: 'Agreed endpoint' }] }] },
  { uci: 'b2e2', comment: 'Side resignation', recordedResult: 'black-wins', evalScore: 75, evalScoreKind: 'cp', quality: 'good' },
];
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function install(page, game) {
  await page.addInitScript(game => {
    localStorage.setItem('xiangqi:library:v1', JSON.stringify([game]));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
  }, game);
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
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      for (const scenario of ['pinned-side', 'saved-midway', 'saved-root']) {
        const game = { id: 'study', savedAt: 1, gameMode: 'PvP', label: 'Complete study', moveTree: tree,
          moves: scenario === 'pinned-side' ? ['b2e2'] : scenario === 'saved-midway' ? ['h2e2'] : [],
          result: scenario === 'pinned-side' ? 'black' : 'ongoing',
          ...(scenario === 'pinned-side' ? { mainLinePinned: true, review: {
            summary: { totalMoves: 1, accuracy: 90, reviewedAt: 1 },
            annotations: [{ moveIndex: 0, evalScore: 125, evalScoreKind: 'cp', quality: 'good', reviewNote: 'Only the side line was reviewed' }],
          } } : {}),
        };
        const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        try {
          await install(page, game);
          await page.goto(base + '?moves=h2e2,h9g7');
          await page.locator('.hitboxes-layer').waitFor();
          const fen = await page.locator('.bottombar-fen').getAttribute('title');
          if (width < 900) {
            await page.getByTestId('mobile-view-analysis').click();
            await page.getByTestId('mobile-analysis-tab-graph').click();
          }
          const continuation = page.getByTestId('library-continuation-b0c2');
          await continuation.waitFor({ timeout: 10000 });
          assert.match(await continuation.innerText(), /0–0–1/, 'The primary draw was not counted');
          const matches = page.getByTestId('library-matches');
          if (await matches.getAttribute('open') === null) await matches.locator('summary').click();
          await page.getByTestId('library-match-study').click();
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'Opening a match selected the saved cursor or wrong variation');
          assert.equal(await page.locator('.game-over-modal').count(), 0, 'The saved side result ended an earlier primary position');
          await command(page, 'Go to latest move'); await page.keyboard.press('t');
          assert.match(await page.getByTestId('recorded-line-result').innerText(), /Draw/);
          await command(page, 'Copy PGN');
          const pgn = await page.evaluate(() => window.__copied);
          assert.match(pgn, /\[Result "1\/2-1\/2"\]/);
          assert.match(pgn, /Side resignation/);
          // The other line's annotations and declaration survive match loading.
          await page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: 'b2e2' }) }).click();
          assert.match(await page.getByTestId('recorded-line-result').innerText(), /Black wins/i);
          await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Side resignation');
          {
            const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
            await command(page, 'Save game');
            await page.waitForFunction(before => localStorage.getItem('xiangqi:library:v1') !== before, before);
          }
          const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
          assert.equal(saved.moveTree[1].recordedResult, 'black-wins');
          assert.equal(saved.moveTree[1].evalScore, scenario === 'pinned-side' ? 125 : 75);
          if (scenario === 'pinned-side') {
            assert.equal(saved.review.annotations[0].reviewNote, 'Only the side line was reviewed');
            assert.equal(saved.moveTree[0].evalScore, undefined, 'Side review was attached to the primary cannon');
          }
          assert.equal(saved.moveTree[0].children[0].children[0].recordedResult, 'draw');
          await command(page, 'Library');
          const card = page.getByTestId('load-saved-study').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," lib-card ")][1]');
          assert.equal(await card.locator('.lib-result').innerText(), 'Draw');
          assert.match(await card.innerText(), /3 main-line moves/);
          await page.getByRole('combobox', { name: 'Filter by result', exact: true }).selectOption('draw');
          await page.getByTestId('load-saved-study').waitFor();
          await page.getByRole('searchbox', { name: 'Search library' }).fill('Draw');
          await page.getByTestId('load-saved-study').waitFor();
          await page.getByRole('combobox', { name: 'Filter by result', exact: true }).selectOption('black');
          await page.getByTestId('load-saved-study').waitFor({ state: 'hidden' });
          await page.getByRole('combobox', { name: 'Filter by result', exact: true }).selectOption('all');
          await page.getByRole('searchbox', { name: 'Search library' }).fill('');
          await card.scrollIntoViewIfNeeded();
          if (scenario === 'pinned-side') await page.screenshot({ path: `/tmp/xiangqi-library-primary-${browserType.name()}-${width}.png` });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.deepEqual(errors, []);
          console.log(`${browserType.name()} ${width}px ${scenario}: complete primary line, draw statistics, exact match position, notes and saved variations passed`);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
