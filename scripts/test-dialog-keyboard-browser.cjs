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

async function editorKeyboard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base);
    const trigger = page.getByTestId(viewport.width < 900 ? 'mobile-more-actions-btn' : 'command-palette-btn');
    await trigger.focus();
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Set up a position');
    await page.keyboard.press('Enter');
    const editor = page.getByTestId('board-editor');
    const first = editor.locator('button').first();
    const done = page.getByTestId('editor-done');
    await done.focus();
    await page.keyboard.press('Tab');
    assert.equal(await first.evaluate(el => el === document.activeElement), true, 'Tab escaped the editor');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await done.evaluate(el => el === document.activeElement), true);

    // A parent render (such as resizing) must not reset the chosen brush's focus.
    const brush = page.getByTestId('editor-brush-R');
    await brush.click();
    await page.setViewportSize({ width: viewport.width + 20, height: viewport.height });
    // The application's resize listener is debounced by 50ms.
    await page.waitForTimeout(150);
    assert.equal(await brush.evaluate(el => el === document.activeElement), true, 'Resizing stole editor focus');
    assert.equal(await brush.getAttribute('aria-pressed'), 'true');

    // Invalid positions disable Done; the trap must then wrap from Cancel.
    await page.getByTestId('editor-clear').click();
    assert.equal(await done.isDisabled(), true);
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await editor.getByRole('button', { name: 'Cancel', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Closing the editor lost the opener');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }]) {
      await paletteKeyboard(browser, viewport);
      await editorKeyboard(browser, viewport);
    }
    console.log('PASS: palette activates the focused command; palette/editor contain focus; editor preserves focus on resize and restores the opener; desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
