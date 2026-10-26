const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      try {
        await page.addInitScript(() => {
          window.__denyLibrary = true;
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (window.__denyLibrary && key === 'xiangqi:library:v1') throw new DOMException('Full', 'QuotaExceededError');
            return original.call(this, key, value);
          };
        });
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await page.clock.install();
        const error = page.getByTestId('save-game-error');
        await command(page, 'Save game');
        await error.waitFor();
        await page.clock.runFor(10000);
        assert.equal(await error.isVisible(), true, 'A save failure must remain available while the reader considers recovery');
        await error.getByRole('button', { name: 'Dismiss save error', exact: true }).click();
        await error.waitFor({ state: 'hidden' });

        await command(page, 'Save game');
        await error.waitFor();
        await page.evaluate(() => { window.__denyLibrary = false; });
        await command(page, 'Save game');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 1);
        await error.waitFor({ state: 'hidden' });

        await page.evaluate(() => { window.__denyLibrary = true; });
        await command(page, 'Save game');
        await error.waitFor();
        await command(page, 'New game');
        await page.waitForFunction(() => / w - - 0 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await error.waitFor({ state: 'hidden' });
        console.log(`${browserType.name()} ${width}px: save errors persist through elapsed time and clear on dismissal, successful retry or another game`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
