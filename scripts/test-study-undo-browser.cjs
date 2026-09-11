const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill(label);
  await page.keyboard.press('Enter');
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'second-study', savedAt: 1, gameMode: 'PvP', moves: ['b2e2', 'b9c7'] },
        ])));
        await page.goto(base + '?moves=h2e2%20h9g7%20h0g2');
        await page.keyboard.press('t');
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Delete this move and what follows');
        if (width < 900) {
          for (const button of await page.getByTestId('delete-undo-toast').getByRole('button').all()) {
            const box = await button.boundingBox();
            assert.ok(box.height >= 44 && box.width >= 44, 'Undo action is smaller than a touch target');
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
        assert.equal(await page.locator('.mtree-chip').count(), 3);

        await command(page, 'Delete this move and what follows');
        await command(page, 'Library');
        await page.getByTestId('load-saved-second-study').click();
        await page.getByRole('button', { name: 'Undo', exact: true }).waitFor({ state: 'hidden', timeout: 2000 });
        assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).count(), 0,
          'Deletion from another study can still be undone into this game');
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-chip').count(), 2);

        await command(page, 'Delete this move and what follows');
        await command(page, 'New game');
        await page.getByRole('button', { name: 'Undo', exact: true }).waitFor({ state: 'hidden', timeout: 2000 });
        assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).count(), 0,
          'New game retained a deletion snapshot from the previous game');
        assert.match(await page.locator('.bottombar-fen').getAttribute('title'), /RNBAKABNR w - - 0 1$/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`Study deletion undo, same-root load and new-game isolation passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
