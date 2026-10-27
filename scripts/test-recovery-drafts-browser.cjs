const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) for (const extra of [{ rootComment: 'Notes before any move' }, { moveTree: [{ uci: 'h2e2' }] }, { metadata: { event: 'Study notes' } }, { rootResult: 'red-wins' }]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 } });
      page.setDefaultTimeout(10000);
      await page.addInitScript(extra => {
        if (sessionStorage.getItem('fixture')) return;
        sessionStorage.setItem('fixture', 'yes');
        localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: 1, game: { id: 'draft', savedAt: 1, gameMode: 'PvP', moves: [], ...extra } }));
      }, extra);
      await page.goto(base);
      await page.getByRole('dialog', { name: 'Unfinished game' }).waitFor();
      const before = await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1'));
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog', { name: 'Unfinished game' }).count(), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1')), before);
      if (width < 900) await page.getByTestId('mobile-more-actions-btn').click();
      await page.getByTestId('recovery-drafts-btn').click();
      if (extra.rootComment) {
        await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
        await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
      }
      await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
      if (extra.rootComment) {
        const undo = page.getByTestId('discard-undo-btn');
        await undo.focus(); await page.clock.fastForward(31000);
        assert.equal(await undo.isVisible(), true, 'A focused recovery action must survive the thirty-second expiry');
        assert.equal(await undo.evaluate(node => node === document.activeElement), true);
      }
      await page.getByTestId('discard-undo-btn').click();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game);
      for (const [key, value] of Object.entries(extra)) assert.deepEqual(saved[key], value);
      await page.close();
    }
    console.log('PASS: discarding note-only, variation-only, metadata-only and result-only drafts is undoable');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
