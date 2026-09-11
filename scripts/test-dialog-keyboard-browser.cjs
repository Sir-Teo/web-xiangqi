const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function paletteKeyboard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base);
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: 'Search commands' });
    await input.fill('no matching command zzz');
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      assert.equal(await input.evaluate(el => el === document.activeElement), true,
        `${key} escaped the empty command palette`);
    }
    await input.fill('');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.command-palette-button:enabled').last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);

    // Tab used to focus Library while Enter ran the still-highlighted New game.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-command-id]')?.dataset.commandId), 'library');
    await page.keyboard.press('Enter');
    await page.getByTestId('saved-game-list').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);

    await page.keyboard.press('ControlOrMeta+k');
    await input.fill('');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }]) {
      await paletteKeyboard(browser, viewport);
    }
    console.log('PASS: command palette contains keyboard focus and activates the focused command on desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
