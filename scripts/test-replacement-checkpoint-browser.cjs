const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const refuse of [false, true]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(base + '?moves=h2e2,h9g7&note=Original%20study');
      await page.locator('.xiangqi-board').waitFor();
      if (refuse) await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('xiangqi:recovery-draft:v1:checkpoint-')) throw new Error('Quota');
          return set.call(this, key, value);
        };
      });
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox').fill('New game');
      await page.keyboard.press('Enter');
      if (refuse) {
        await page.getByTestId('auto-save-error').waitFor();
        assert.match(await page.locator('.bottombar-fen').getAttribute('title'), / b | w /);
        assert.match(await page.locator('.wc-meta').innerText(), /2\s*\/\s*2/);
      } else {
        const snapshots = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('xiangqi:recovery-draft:v1:checkpoint-')).map(key => JSON.parse(localStorage[key])));
        assert.equal(snapshots.length, 1);
        assert.deepEqual(snapshots[0].game.moves, ['h2e2', 'h9g7']);
        assert.equal(snapshots[0].game.rootComment, 'Original study');
        await page.getByRole('button', { name: 'Recovery drafts (1)' }).click();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.match(await page.locator('.wc-meta').innerText(), /2\s*\/\s*2/);
      }
      await page.close();
    }
    console.log('PASS: replacement checkpoints restore the study; a failed checkpoint preserves the current board');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
