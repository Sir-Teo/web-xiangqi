const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function importPgn(page, width, source, fromFile = false) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  if (fromFile) {
    await page.getByTestId('uci-line-file-input').setInputFiles({ name: 'Annotated study.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(source) });
    await page.waitForFunction(source => document.querySelector('[data-testid="uci-line-input"]')?.value === source, source);
  } else await page.getByTestId('uci-line-input').fill(source);
  const start = Date.now();
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
  return Date.now() - start;
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
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  if (window.__evaluationLine) emit(window.__evaluationLine);
                  emit('bestmove ' + (window.__evaluationLine ? 'h9g7' : '(none)'));
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              }
            };
          };` }));
        await page.goto(base);
        const elapsed = await importPgn(page, width, `h2e2 {${'[%'.repeat(99000)}} h9g7 *`);
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-chip').count(), 2);
        await page.locator('.mtree-chip').first().click();
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === '[%'.repeat(250));
        await command(page, 'Save game');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.moveTree[0].comment, '[%'.repeat(250));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-pgn-notes-${browserType.name()}-${width}.png` });

        const source = '1.h2e2 {Main cannon} {Second paragraph} (1.b2e2 {Side cannon 中炮 🐎} a9a8 {Side rook} (1...i9i8 {Nested rook} ; Keep this alternative\n) 2.h0g2 {Side horse}) h9g7 {Main horse} *';
        const expected = [
          { uci: 'h2e2', comment: 'Main cannon Second paragraph', children: [{ uci: 'h9g7', comment: 'Main horse' }] },
          { uci: 'b2e2', comment: 'Side cannon 中炮 🐎', children: [
            { uci: 'a9a8', comment: 'Side rook', children: [{ uci: 'h0g2', comment: 'Side horse' }] },
            { uci: 'i9i8', comment: 'Nested rook Keep this alternative' },
          ] },
        ];
        await importPgn(page, width, source);
        await command(page, 'Save game');
        const lastTree = () => page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1).moveTree);
        assert.deepEqual(await lastTree(), expected, 'Paste import lost or reassigned a branch note');
        await page.keyboard.press('t');
        await page.locator('.mtree-chip').filter({ hasText: 'i9i8' }).click();
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Nested rook Keep this alternative');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-pgn-branch-notes-${browserType.name()}-${width}.png` });
        // Export with the original main line selected, then import that file.
        await page.locator('.mtree-chip').filter({ hasText: 'h9g7' }).click();
        const downloadReady = page.waitForEvent('download');
        await command(page, 'Download PGN');
        const chunks = [];
        for await (const chunk of await (await downloadReady).createReadStream()) chunks.push(chunk);
        await importPgn(page, width, Buffer.concat(chunks).toString(), true);
        await command(page, 'Save game');
        assert.deepEqual(await lastTree(), expected, 'File round-trip lost a branch note');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[1]?.children?.[1]?.comment === 'Nested rook Keep this alternative');
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await command(page, 'Save game');
        assert.deepEqual(await lastTree(), expected, 'Reload recovery lost a branch note');
        await importPgn(page, width, 'h2e2 $6 {[%eval +0.42,18]} h9g7 $2 {[%eval -.75,21]} h0g2 {[%eval #+3,24]} b9c7 {[%eval #-0,0]} *');
        const reviewDownload = page.waitForEvent('download');
        await command(page, 'Download PGN');
        const reviewChunks = [];
        for await (const chunk of await (await reviewDownload).createReadStream()) reviewChunks.push(chunk);
        const reviewedPgn = Buffer.concat(reviewChunks).toString();
        for (const evaluation of ['0.42,18', '-0.75,21', '#3,24', '#-0,0']) {
          assert.ok(reviewedPgn.includes(`[%eval ${evaluation}]`), `Imported evaluation ${evaluation} was lost or changed sides`);
        }
        await command(page, 'Save game');
        const readSaved = () => page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        const annotatedGame = await readSaved();
        assert.equal(annotatedGame.review, undefined, 'Import fabricated a completed engine review');
        assert.deepEqual(annotatedGame.moveTree[0], { uci: 'h2e2', evalScore: 42, evalDepth: 18, quality: 'inaccuracy', children: [
          { uci: 'h9g7', evalScore: -75, evalDepth: 21, quality: 'mistake', children: [
            { uci: 'h0g2', evalScore: 29997, evalDepth: 24, children: [{ uci: 'b9c7', evalScore: -30000, evalDepth: 0 }] },
          ] },
        ] });
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[0]?.evalDepth === 18);
        await command(page, 'Copy link');
        const copied = await page.evaluate(() => window.__copied);
        assert.ok(new URL(copied).searchParams.has('tree'), 'An unbranched annotated line was shared as bare moves');
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await command(page, 'Save game');
        assert.deepEqual((await readSaved()).moveTree, annotatedGame.moveTree);
        assert.equal((await readSaved()).review, undefined);
        // Reimporting a link uses the same validated tree fields as PGN/library recovery.
        await page.goto(copied);
        await page.getByRole('button', { name: "Keep the link's game", exact: true }).click();
        await command(page, 'Save game');
        assert.deepEqual((await readSaved()).moveTree, annotatedGame.moveTree);
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-chip.quality-inaccuracy').count(), 1);
        await page.getByText('Saved PGN quality marks may use different criteria.', { exact: true }).waitFor();
        await page.screenshot({ path: `/tmp/xiangqi-pgn-evaluations-${browserType.name()}-${width}.png` });
        await page.locator('.mtree-chip').filter({ hasText: 'h2e2' }).click();
        await page.evaluate(() => { window.__evaluationLine = 'info depth 12 multipv 1 score cp -42 pv h9g7'; });
        await page.keyboard.press('e');
        await page.getByTestId('deep-dive-btn').click();
        await page.getByTestId('engine-pv-0-move-0').waitFor();
        await command(page, 'Save game');
        const updated = await readSaved();
        assert.equal(updated.moveTree[0].evalScore, 42);
        assert.equal(updated.moveTree[0].evalDepth, undefined, 'A fresh score inherited the old imported depth');
        assert.equal(updated.moveTree[0].children[0].evalDepth, 21, 'Updating one move erased another depth');
        await page.evaluate(() => { window.__evaluationLine = undefined; });
        await importPgn(page, width, 'h2e2 {[%eval 0.42,18]} h9g7 {[%eval -0.75,21]} (b9c7 $4 {[%eval #-3,20] Annotated alternative}) *');
        await command(page, 'Save game');
        assert.deepEqual((await readSaved()).moveTree[0].children[1], { uci: 'b9c7', evalScore: -29997, evalDepth: 20, quality: 'blunder', comment: 'Annotated alternative' });
        await page.keyboard.press('r');
        await page.locator('.review-panel [data-testid="start-review-btn"]').click();
        await page.getByTestId('notice-announcement').filter({ hasText: 'returned no evaluation' }).waitFor();
        await command(page, 'Save game');
        const cancelledReview = await readSaved();
        assert.equal(cancelledReview.review, undefined, 'A scoreless engine search became a completed review');
        assert.equal(cancelledReview.moveTree[0].evalScore, 42, 'A scoreless engine search overwrote a supplied evaluation');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: 198k-character malformed-command note imported, bounded and saved at ${width}px (${elapsed}ms click-to-dialog-close)`);
        console.log(`${browserType.name()}: nested notes, semicolon notes, paste/file PGN round-trip, save and recovery passed at ${width}px`);
        console.log(`${browserType.name()}: evaluations/depth/quality, mate zero, save/reload/share, branch annotations, depth invalidation and scoreless-review cancellation passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
