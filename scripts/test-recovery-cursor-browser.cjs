const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const cursorPly of [0, 1]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await page.addInitScript(cursorPly => {
        if (sessionStorage.getItem('fixture')) return;
        sessionStorage.setItem('fixture', 'yes');
        localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: 1, game: {
          id: 'draft', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'], cursorPly,
          review: { summary: {}, annotations: [{ moveIndex: 0, evalScore: 20, quality: 'good' }, { moveIndex: 1, evalScore: 10, quality: 'good' }] },
        } }));
      }, cursorPly);
      await page.goto(base);
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      assert.match(await page.locator('.wc-meta').innerText(), new RegExp(`${cursorPly || 'START'}\\s*\\/\\s*2`));
      await page.waitForFunction(cursor => {
        const game = JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game;
        return game?.cursorPly === cursor && game.moves.length === 2 && game.review?.annotations.length === 2;
      }, cursorPly);
      await page.reload();
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      assert.match(await page.locator('.wc-meta').innerText(), new RegExp(`${cursorPly || 'START'}\\s*\\/\\s*2`));
      await page.close();
    }
    console.log('PASS: reviewed studies recover at root or mid-line without losing the full review');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
