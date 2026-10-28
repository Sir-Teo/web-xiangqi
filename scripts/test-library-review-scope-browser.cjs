const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const tree = [
  { uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'draw' }] },
  { uci: 'b2e2', comment: 'Alternative cannon', children: [{ uci: 'h9i7', recordedResult: 'black-wins' }] },
];
const games = [
  { id: 'side', moves: ['b2e2', 'h9i7'], mainLinePinned: true, finalEval: 75 },
  { id: 'prefix', moves: ['h2e2'], finalEval: 42 },
  { id: 'complete', moves: ['h2e2', 'h9g7'], finalEval: 15 },
  { id: 'selected-side', moves: ['b2e2', 'h9i7'], finalEval: -90 },
].map((game, i) => ({ ...game, savedAt: i + 1, gameMode: 'PvP', label: game.id, moveTree: tree,
  review: { summary: { totalMoves: game.moves.length, accuracy: 90, reviewedAt: 1 },
    annotations: game.moves.map((_, moveIndex) => ({ moveIndex, evalScore: game.finalEval, quality: 'good', reviewNote: 'Saved review remains on this line' })),
  },
}));
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(games => localStorage.setItem('xiangqi:library:v1', JSON.stringify(games)), games);
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
        await page.goto(base);
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library');
        const card = id => page.getByTestId(`load-saved-${id}`).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," lib-card ")][1]');
        assert.equal(await page.getByTestId('review-scope-saved-side').innerText(), 'Review: saved variation');
        assert.equal(await page.getByTestId('review-scope-saved-prefix').innerText(), 'Review: first move');
        for (const id of ['complete', 'selected-side']) assert.equal(await page.getByTestId(`review-scope-saved-${id}`).count(), 0);
        assert.equal(await card('side').locator('.lib-result').innerText(), 'Draw');
        assert.match(await card('side').innerText(), /saved on variation at ply 2/);
        assert.match(await card('side').locator('.lib-eval').innerText(), /Saved position: \+0\.75/);
        assert.match(await card('prefix').locator('.lib-eval').innerText(), /Saved position: \+0\.42/);
        assert.equal(await card('complete').locator('.lib-eval').innerText(), '+0.15');
        assert.match(await page.getByTestId('review-meta-saved-side').getAttribute('aria-label'), /Review: saved variation/);
        const search = page.getByRole('searchbox', { name: 'Search library' });
        await search.fill('Review saved variation');
        await page.getByTestId('load-saved-side').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid^="load-saved-"]').length === 1);
        await card('side').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/xiangqi-review-scope-${browserType.name()}-${width}.png` });
        // Scope labels remain readable with enlarged text on the smallest phone.
        if (width === 320) await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
        await card('side').scrollIntoViewIfNeeded();
        const scope = await page.getByTestId('review-scope-saved-side').boundingBox();
        const bounds = await card('side').boundingBox();
        assert.ok(scope.x >= bounds.x && scope.x + scope.width <= bounds.x + bounds.width + 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width === 320) await page.screenshot({ path: `/tmp/xiangqi-review-scope-${browserType.name()}-320-large-text.png` });
        const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        await page.getByTestId('load-saved-side').click();
        await page.getByRole('dialog', { name: 'Black Wins', exact: true }).getByRole('button', { name: 'Review', exact: true }).click();
        await command(page, 'Move tree');
        await page.locator('.mtree-row .move-uci').first().waitFor();
        assert.deepEqual(await page.locator('.mtree-row .move-uci').allTextContents(), ['b2e2', 'h9i7']);
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: variation/prefix review scope, saved-position evaluations, compact matching-line cards, search, text scaling and intact loading passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
