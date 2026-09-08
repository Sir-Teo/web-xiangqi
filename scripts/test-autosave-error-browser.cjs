const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, acceptDownloads: true });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.__rejectAutosave = true;
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'xiangqi:auto-saved-game:v1' && window.__rejectAutosave) throw new DOMException('Quota full', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      await page.goto(base);
      await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
      await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
      const notice = page.getByTestId('auto-save-error');
      await notice.waitFor();
      assert.match(await notice.innerText(), /could not save your latest changes/);
      const downloadPromise = page.waitForEvent('download');
      await notice.getByRole('button', { name: 'Download PGN', exact: true }).click();
      const download = await downloadPromise;
      assert.match(fs.readFileSync(await download.path(), 'utf8'), /h2e2/);
      await page.screenshot({ path: `/tmp/xiangqi-autosave-error-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(() => { window.__rejectAutosave = false; });
      await notice.getByRole('button', { name: 'Retry autosave' }).click();
      await notice.waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game.moves), ['h2e2']);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: autosave failures are visible, PGN recovery downloads moves, retry restores persistence; desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
