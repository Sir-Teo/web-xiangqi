const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.context().addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => { window.__copied = text; } } }));
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line)); let position = '';
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command.startsWith('position ')) position = command;
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  const root = position === 'position startpos';
                  const first = position === 'position startpos moves h2e2';
                  const score = window.__review ? (root || first ? 'cp 20000' : 'cp 0') : window.__score;
                  const move = root ? 'h2e2' : first ? 'h9g7' : 'h0g2';
                  if (score) emit('info depth 12 multipv 1 score ' + score + ' pv ' + move);
                  emit('bestmove ' + (score ? move : '(none)'));
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              }
            };
          };` }));
        await page.goto(base);
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('h2e2 {[%eval 200.00,18]} h9g7 {[%eval #10000,18]} (b9c7 {[%eval -300.00,20] Numeric alternative}) *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await command(page, 'Save game');
        const readSaved = () => page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        const imported = await readSaved();
        assert.equal(imported.moveTree[0].evalScoreKind, 'cp');
        assert.equal(imported.moveTree[0].children[0].evalScoreKind, undefined);
        assert.equal(imported.moveTree[0].children[1].evalScoreKind, 'cp');
        const download = page.waitForEvent('download');
        await command(page, 'Download PGN');
        const chunks = [];
        for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        const pgn = Buffer.concat(chunks).toString();
        for (const score of ['200.00,18', '#10000,18', '-300.00,20']) assert.ok(pgn.includes(`[%eval ${score}]`), `PGN changed ${score}`);
        const selectMove = async move => {
          await page.keyboard.press('t');
          await page.locator('.mtree-chip').filter({ hasText: move }).click();
        };
        const expectGraph = async label => {
          await page.getByTestId(width < 900 ? 'mobile-analysis-tab-graph' : 'left-panel-tab-graph').click();
          await page.waitForFunction(id => document.querySelector('[data-testid="' + id + '"]')?.getAttribute('aria-selected') === 'true', width < 900 ? 'mobile-analysis-tab-graph' : 'left-panel-tab-graph');
          await page.locator('.graph-wrap').waitFor({ state: 'visible' });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.getByTestId('graph-load-sweep').waitFor({ state: 'hidden' });
          await page.evaluate(async () => {
            const animations = document.querySelector('.mobile-analysis-tabs')?.getAnimations({ subtree: true }) ?? [];
            await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
          });
          await page.waitForFunction(label => document.querySelector('.graph-legend strong')?.textContent === 'Red POV ' + label, label);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        };
        await selectMove('h2e2'); await expectGraph('+200.00');
        await selectMove('h9g7'); await expectGraph('+M10000');
        assert.equal(await page.locator('.graph-extrema span').first().innerText(), 'Peak Red +M10000', 'A tied numeric cp value outranked a forced mate');
        await selectMove('b9c7'); await expectGraph('-300.00');
        assert.equal(await page.locator('.graph-extrema span').first().innerText(), 'Peak Red +200.00', 'A mate from an unselected variation changed this line’s peak');
        await page.screenshot({ path: `/tmp/xiangqi-eval-kind-visible-${browserType.name()}-${width}.png` });
        await selectMove('h2e2');
        await command(page, 'Save game');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[0]?.evalScoreKind === 'cp');
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await command(page, 'Save game');
        assert.deepEqual((await readSaved()).moveTree, imported.moveTree, 'Recovery lost a score kind');
        await command(page, 'Copy link');
        await page.goto(await page.evaluate(() => window.__copied));
        await page.getByRole('button', { name: "Keep the link's game", exact: true }).click();
        await command(page, 'Save game');
        assert.deepEqual((await readSaved()).moveTree, imported.moveTree, 'Share link lost a score kind');
        // Both readings normalize to +20000 for Red. Only their kinds change.
        await selectMove('h2e2');
        let numericSaveId, mateSaveId;
        for (const [score, kind] of [['cp -20000', 'cp'], ['mate -10000', undefined], ['cp -20000', 'cp']]) {
          await page.evaluate(score => { window.__score = score; }, score);
          await page.keyboard.press('e');
          await page.getByTestId('deep-dive-btn').click();
          await page.waitForFunction(label => document.querySelector('[data-testid="engine-pv-score-0"] strong')?.textContent === label, kind ? '+200.0' : '+M10000');
          await command(page, 'Save game');
          const saved = await readSaved();
          assert.deepEqual(saved.moves, ['h2e2'], 'The evaluated saved position is before the full line ends');
          assert.equal(saved.moveTree[0].evalScore, 20000);
          assert.equal(saved.moveTree[0].evalScoreKind, kind, 'A same-number engine result retained the previous kind');
          assert.equal(saved.moveTree[0].evalDepth, undefined);
          assert.equal(saved.finalEvalKind, kind, 'Library summary dropped the live score kind');
          if (kind) numericSaveId = saved.id; else mateSaveId = saved.id;
        }
        await expectGraph('+200.00');
        await command(page, 'Library');
        const numericCard = page.locator('.lib-card').filter({ has: page.getByTestId(`load-saved-${numericSaveId}`) });
        const mateCard = page.locator('.lib-card').filter({ has: page.getByTestId(`load-saved-${mateSaveId}`) });
        assert.equal(await numericCard.locator('.lib-eval').innerText(), 'Saved position: +200.00');
        assert.equal(await mateCard.locator('.lib-eval').innerText(), 'Saved position: +M10000');
        await selectMove('h9g7');
        await page.evaluate(() => { window.__review = true; window.__score = undefined; });
        await page.keyboard.press('r');
        await page.locator('.review-panel [data-testid="start-review-btn"]').click();
        await page.locator('.review-panel [data-testid="clear-review-btn"]').waitFor();
        await command(page, 'Save game');
        const reviewed = await readSaved();
        assert.equal(reviewed.review.annotations[0].evalScoreKind, 'cp');
        assert.equal(reviewed.review.summary.keyMoments[0].evalBeforeKind, 'cp');
        assert.equal(reviewed.review.summary.keyMoments[0].evalAfterKind, 'cp');
        assert.ok((await page.locator('.review-panel').innerText()).includes('200.00'));
        assert.equal((await page.locator('.review-panel').innerText()).includes('M10000'), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: large cp/mate PGN, graph, save/reload/share, same-score engine replacement and review kinds passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
