const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function paletteKeyboard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base); await page.locator('.xiangqi-board').waitFor();
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: 'Search commands' });
    await input.fill('no matching command zzz');
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      assert.equal(await input.evaluate(el => el === document.activeElement), true,
        `${key} escaped the empty command palette`);
    }
    await input.fill('');
    await page.getByRole('option').first().waitFor();
    await page.keyboard.press('Tab');
    const commandFocus = await input.evaluate(element => {
      const option = document.getElementById(element.getAttribute('aria-activedescendant'));
      return { matches: option === document.activeElement && option?.getAttribute('role') === 'option',
        selected: option?.id, focused: document.activeElement?.id, role: document.activeElement?.getAttribute('role') };
    });
    assert.equal(commandFocus.matches, true, `The announced command option must be the control reached with Tab: ${JSON.stringify(commandFocus)}`);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.command-palette-button:enabled').last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await input.evaluate(el => el === document.activeElement), true);

    // Tab used to focus Library while Enter ran the still-highlighted New game.
    await page.locator('[data-command-id="library"] button').focus();
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-command-id]')?.dataset.commandId), 'library');
    // Moving the pointer must not redirect Enter away from the focused button.
    await page.locator('[data-command-id="new-game"] button').hover();
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

async function compositionKeyboard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  try {
    await page.goto(base);
    await page.locator('.xiangqi-board').waitFor();
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: 'Search commands' });
    // A disabled row must still explain itself to touch users, without hover.
    const saveRow = page.locator('[data-command-id="save-game"]');
    await saveRow.click({ force: true });
    const help = page.getByTestId('command-palette-help');
    assert.equal(await help.innerText(), 'Play a move or set up a position first');
    await input.fill('no matching command zzz');
    assert.match(await help.innerText(), /Try fewer words/);
    await input.fill('Settings');
    // Synthetic native key events exercise both the standard IME flag and
    // WebKit's composition-ending event, whose flag may already be false.
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const active = await input.getAttribute('aria-activedescendant');
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape']) {
        await input.dispatchEvent('keydown', { key, bubbles: true, ...flags });
        assert.equal(await input.isVisible(), true, `Composing ${key} closed the palette`);
        assert.equal(await input.getAttribute('aria-activedescendant'), active,
          `Composing ${key} changed the selected command`);
      }
      await input.dispatchEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, ...flags });
      assert.equal(await input.isVisible(), true, 'Composing Ctrl+K toggled the palette');
    }
    // Normal activation still works once character composition has ended.
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    const field = page.getByRole('dialog').locator('input, select').first();
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      await field.dispatchEvent('keydown', { key: 'Escape', bubbles: true, ...flags });
      assert.equal(await page.getByRole('dialog').count(), 1, 'Composing Escape closed Settings');
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+k');
    await input.fill('Set up a position');
    await page.keyboard.press('Enter');
    const editor = page.getByTestId('board-editor');
    const fenInput = editor.locator('input[type="text"]');
    await fenInput.waitFor();
    const initial = await fenInput.inputValue();
    await fenInput.fill('9/9/9/9/9/9/9/9/9/9 w - - 0 1');
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      await fenInput.dispatchEvent('keydown', { key: 'Enter', bubbles: true, ...flags });
      assert.equal(await page.getByTestId('editor-done').isDisabled(), false,
        'Composing Enter loaded the unfinished FEN');
      await fenInput.dispatchEvent('keydown', { key: 'Escape', bubbles: true, ...flags });
      assert.equal(await editor.isVisible(), true, 'Composing Escape closed the editor');
    }
    await fenInput.fill(initial);
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}

async function closedDisclosureKeyboard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  try {
    await page.goto(base); await page.locator('.xiangqi-board').waitFor();
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Settings');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.waitFor();
    // End the dialog in a collapsed disclosure. Chromium can report boxes for
    // its descendants even though they cannot receive focus. Exercise the real
    // dialog listener, including the transition to an expanded last control.
    await dialog.evaluate(body => {
      const details = document.createElement('details');
      details.dataset.testid = 'focus-disclosure';
      const summary = document.createElement('summary'); summary.textContent = 'Extra settings';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Extra option';
      details.append(summary, button); body.append(details);
    });
    const summary = page.getByTestId('focus-disclosure').locator('summary');
    const extra = dialog.getByRole('button', { name: 'Extra option', exact: true, includeHidden: true });
    const close = dialog.getByRole('button', { name: 'Close settings', exact: true });
    await close.focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await summary.evaluate(element => element === document.activeElement), true,
      'Shift+Tab must wrap to the disclosure summary, not its hidden button');
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(element => element === document.activeElement), true,
      'Tab from the collapsed summary must return to the first dialog control');
    await summary.click();
    await close.focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await extra.evaluate(element => element === document.activeElement), true,
      'Expanding the disclosure makes its button the final tab stop');
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(element => element === document.activeElement), true);
  } finally { await page.close(); }
}

async function editorKeyboard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base); await page.locator('.xiangqi-board').waitFor();
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

async function modalShortcutGuard(browser, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  try {
    const assertPaletteBlocked = async (target = page) => {
      const dialog = target.getByRole('dialog');
      await dialog.waitFor();
      // Settled, not merely present. A lazily loaded dialog -- Set up a
      // position is one -- mounts `dialog-load` first and swaps the real one
      // in underneath when its chunk resolves. Focus transits `body` across
      // that swap, so a shortcut pressed on the placeholder read as having
      // escaped the modal: one run in three, and the same failure on main.
      // The guard being tested still held every time, as the two assertions
      // below it record -- no second modal, no palette -- so what fails here
      // is the wait, not the app.
      await target.waitForFunction(() => {
        const open = document.querySelector('[role="dialog"]');
        if (!open || !open.contains(document.activeElement)) return false;
        if (window.__settledDialog !== open) { window.__settledDialog = open; window.__settledSince = performance.now(); return false; }
        return performance.now() - window.__settledSince > 100;
      });
      for (const shortcut of ['Control+k', 'Meta+k']) {
        await target.keyboard.press(shortcut);
        assert.equal(await dialog.count(), 1, `${shortcut} opened a second modal`);
        assert.equal(await target.getByRole('combobox', { name: 'Search commands' }).count(), 0);
        assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      }
    };
    await page.goto(base); await page.locator('.xiangqi-board').waitFor();
    for (const command of ['Settings', 'Set up a position']) {
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox').fill(command);
      await page.keyboard.press('Enter');
      await assertPaletteBlocked();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
    }
    await page.getByRole('button', { name: viewport.width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
    await assertPaletteBlocked();
    await page.keyboard.press('Escape');

    const mate = 'R3k4/R8/9/9/9/9/9/9/9/3K5 b - - 0 1';
    await page.goto(base + '?fen=' + encodeURIComponent(mate));
    await page.getByRole('heading', { name: 'Red Wins' }).waitFor();
    await assertPaletteBlocked();
    await page.keyboard.press('Escape');
    // Recovery owns independent draft slots and flushes on pagehide. Give
    // this case a fresh context instead of clearing only the legacy mirror
    // while the terminal position can still write its own draft back.
    const recoveryPage = await browser.newPage({ viewport });
    try {
      await recoveryPage.goto(base + '?moves=h2e2');
      await recoveryPage.waitForFunction(() => localStorage.getItem('xiangqi:auto-saved-game:v1'));
      await recoveryPage.reload();
      await recoveryPage.getByRole('heading', { name: 'Unfinished game' }).waitFor();
      await assertPaletteBlocked(recoveryPage);
    } finally { await recoveryPage.close(); }
  } finally { await page.close(); }
}

(async () => {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }]) {
      await paletteKeyboard(browser, viewport);
      await compositionKeyboard(browser, viewport);
      await closedDisclosureKeyboard(browser, viewport);
      await editorKeyboard(browser, viewport);
      await modalShortcutGuard(browser, viewport);
    }
    console.log('PASS: palette activates the focused command; palette/editor contain focus; editor preserves focus on resize and restores the opener; shortcuts respect all five other modals; desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
