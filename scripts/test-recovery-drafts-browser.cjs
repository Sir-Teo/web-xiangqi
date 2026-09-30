const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const extra of [{ rootComment: 'Notes before any move' }, { moveTree: [{ uci: 'h2e2' }] }, { metadata: { event: 'Study notes' } }, { rootResult: 'red-wins' }]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await page.addInitScript(extra => {
        if (sessionStorage.getItem('fixture')) return;
        sessionStorage.setItem('fixture', 'yes');
        localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: 1, game: { id: 'draft', savedAt: 1, gameMode: 'PvP', moves: [], ...extra } }));
      }, extra);
      await page.goto(base);
      await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
      await page.getByTestId('discard-undo-btn').click();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game);
      for (const [key, value] of Object.entries(extra)) assert.deepEqual(saved[key], value);
      await page.close();
    }
    console.log('PASS: discarding note-only, variation-only, metadata-only and result-only drafts is undoable');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
