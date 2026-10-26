const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      try {
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await page.keyboard.press('ControlOrMeta+k');
        const input = page.getByRole('combobox', { name: 'Search commands' });
        await input.waitFor();
        // After filtering, Library takes this row's place under the stationary
        // pointer. Layout-generated enter events must not override typing.
        await page.locator('[data-command-id="new-game"] button').hover();
        assert.equal(await input.getAttribute('aria-activedescendant'), 'command-new-game');
        await input.fill('Save game');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await input.getAttribute('aria-activedescendant'), 'command-save-game',
          'Filtering must keep keyboard selection when the pointer has not moved');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 1);
        assert.equal(await page.getByRole('dialog').count(), 0);
        console.log(`${browserType.name()} ${width}px: stationary pointer cannot redirect a typed Save command`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
