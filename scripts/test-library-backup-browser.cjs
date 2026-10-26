const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const key = 'xiangqi:library:v1';
/**
 * The panel promises a backup keeps "all saved games, variations, notes, and
 * reviews". Variations and notes are the `moveTree` with its comment; the
 * review is here because it was the one of the four nothing checked, and it is
 * the one a reader cannot simply retype -- a review is minutes of engine time.
 *
 * The download half was already general (it compares the whole stored array),
 * so only restore could drop a field: with no review in the fixture, a restore
 * that discarded reviews would have stored none, downloaded none, and passed.
 */
/**
 * Restore recomputes the accuracy figures from the annotations rather than
 * trusting the ones in the file, and drops a side's accuracy when that side has
 * no annotated move -- so a hand-edited backup cannot claim a score its own
 * moves do not support. Learned here: a first draft of this fixture said 98%
 * for a single best move and came back as 100, with `blackAccuracy` gone.
 *
 * The fixture is therefore self-consistent, and what the assertion really pins
 * is the part that cannot be recomputed: the annotation, its note, the
 * timestamp and the line signature.
 */
const review = {
  summary: {
    totalMoves: 1, accuracy: 100, averageCentipawnLoss: 0, redAccuracy: 100,
    bestCount: 1, goodCount: 0, inaccuracyCount: 0, mistakeCount: 0, blunderCount: 0,
    reviewedAt: 1700000001000, lineSignature: 'h2e2', keyMoments: [],
  },
  annotations: [{ moveIndex: 0, evalScore: 20, quality: 'best', swing: 0, winPercentLoss: 0, reviewNote: 'Engine-approved move.' }],
};
const game = { id: 'backup-study', savedAt: 1700000000000, gameMode: 'PvP', result: 'ongoing', moves: ['h2e2'], label: 'Cannon study', moveTree: [{ uci: 'h2e2', comment: 'Central cannon', children: [{ uci: 'h9g7' }] }], review };
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
      await page.locator('.lib-transfer summary').filter({ hasText: 'Backup and restore' }).click();
      const input = page.getByLabel('Restore library backup', { exact: true });
      const payload = JSON.stringify({ format: 'web-xiangqi-library', version: 1, games: [game] });
      const upload = text => input.setInputFiles({ name: 'library.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await upload(payload);
      await page.getByRole('button', { name: 'Restore 1 game', exact: true }).waitFor();
      assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.__backupRefuse = true;
        Storage.prototype.setItem = function(key, value) {
          if (window.__backupRefuse && key === 'xiangqi:library:v1') throw new Error('Quota');
          return original.call(this, key, value);
        };
      });
      await page.getByRole('button', { name: 'Restore 1 game', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Browser storage refused the restore' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Restore 1 game', exact: true }).isEnabled(), true,
        'A failed restore must keep its preview for retry');
      assert.equal(await page.getByRole('button', { name: 'Restore 1 game', exact: true }).evaluate(element => element === document.activeElement), true,
        'A failed restore keeps keyboard focus on Retry');
      assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
      await page.evaluate(() => { window.__backupRefuse = false; });
      await page.getByRole('button', { name: 'Restore 1 game', exact: true }).click();
      await page.getByText('Restored 1 game. Skipped 0 identical games.', { exact: true }).waitFor();
      assert.equal(await input.evaluate(element => element === document.activeElement), true, 'Restoring returns focus to the chooser');
      const saved = await page.evaluate(k => localStorage.getItem(k), key);
      assert.deepEqual(JSON.parse(saved)[0].moveTree, game.moveTree);
      assert.deepEqual(JSON.parse(saved)[0].review, game.review, 'a restored backup should still carry its review');
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download library backup', exact: true }).click();
      const downloaded = JSON.parse(await fs.readFile(await (await downloadEvent).path(), 'utf8'));
      assert.deepEqual(downloaded.games, JSON.parse(saved));
      await upload(payload);
      await page.getByRole('button', { name: 'Restore 0 games', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Restore 0 games', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await input.evaluate(element => element === document.activeElement), true, 'Canceling returns focus to the chooser');
      await upload(JSON.stringify({ ...downloaded, games: [{ ...game, label: 'Conflict' }] }));
      await page.getByRole('combobox', { name: 'Resolve Cannon study' }).waitFor();
      const choice = page.getByRole('combobox', { name: 'Resolve Cannon study' });
      await choice.selectOption('copy');
      await page.evaluate(() => { window.__backupRefuse = true; });
      await page.getByRole('button', { name: 'Restore 1 game', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Browser storage refused the restore' }).waitFor();
      assert.equal(await choice.inputValue(), 'copy', 'A failed write keeps conflict choices');
      await page.evaluate(() => { window.__backupRefuse = false; });
      assert.equal(await page.evaluate(k => localStorage.getItem(k), key), saved);
      await page.evaluate(k => { localStorage.setItem(k, '{damaged'); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, key);
      await page.getByRole('button', { name: 'Download recovery file', exact: true }).waitFor();
      const recoveryEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download recovery file', exact: true }).click();
      assert.equal(await fs.readFile(await (await recoveryEvent).path(), 'utf8'), '{damaged');
      assert.equal(await input.isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/xiangqi-backup-${width}.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: desktop/mobile backup download, restore preview, branch/comment/review preservation, duplicate/conflict protection, exact damaged-data recovery, no overflow or page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
