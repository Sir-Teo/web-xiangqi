const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 640], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900 });
      // macOS WebKit skips buttons with plain Tab unless Safari's full-control
      // preference is enabled. Option-Tab follows the complete control sequence.
      const tab = (reverse = false) => page.keyboard.press(
        `${browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}${reverse ? 'Shift+' : ''}Tab`
      );
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base);
        const launchSquare = page.locator('.xiangqi-board .hitbox[tabindex="0"]').first();
        await launchSquare.focus();
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Set up a position');
        await page.keyboard.press('Enter');
        const editor = page.getByTestId('board-editor');
        await editor.waitFor();
        const square = (file, rank) => editor.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`);
        const active = () => page.evaluate(() => ({ file: document.activeElement?.getAttribute('data-file'), rank: document.activeElement?.getAttribute('data-rank') }));
        const expectSquare = async (file, rank) => assert.deepEqual(await active(), { file: String(file), rank: String(rank) });
        assert.equal(await editor.locator('.hitbox').evaluateAll(nodes => nodes.filter(node => node.tabIndex === 0).length), 1, 'The position editor should have one board Tab stop');
        const grid = editor.getByRole('grid', { name: 'Position board' });
        assert.equal(await grid.getByRole('row').count(), 10);
        assert.equal(await grid.getByRole('gridcell').count(), 90);
        await square(0, 9).focus();
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
        await expectSquare(0, 9);
        await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
        await expectSquare(1, 8);
        await page.keyboard.press('Home'); await expectSquare(0, 8);
        await page.keyboard.press('End'); await expectSquare(8, 8);
        await page.keyboard.press('Control+Home'); await expectSquare(0, 9);
        await page.keyboard.press('Control+End'); await expectSquare(8, 0);
        await square(1, 8).focus();
        await tab();
        assert.equal(await page.getByRole('button', { name: 'Close the editor' }).evaluate(node => node === document.activeElement), true, 'Tab did not leave the board for the controls');
        await tab(true); await expectSquare(1, 8);
        await tab(true);
        assert.equal(await page.getByTestId('editor-done').evaluate(node => node === document.activeElement), true, 'Reverse Tab escaped the dialog instead of wrapping');
        await tab(); await expectSquare(1, 8);
        assert.equal(await editor.evaluate(node => {
          const point = document.activeElement.getBoundingClientRect(); const dialog = node.getBoundingClientRect();
          return point.top >= Math.max(0, dialog.top) && point.bottom <= Math.min(innerHeight, dialog.bottom);
        }), true, 'Wrapping focus left the board square outside the visible dialog');

        // Enter and Space activate native buttons once; arrows only move focus.
        await page.getByTestId('editor-brush-erase').focus(); await page.keyboard.press('Enter');
        await square(0, 0).focus(); await page.keyboard.press('Enter');
        assert.match(await square(0, 0).getAttribute('aria-label'), /empty/);
        await page.getByTestId('editor-brush-R').focus(); await page.keyboard.press('Space');
        await square(0, 0).focus(); await page.keyboard.press('Space');
        assert.match(await square(0, 0).getAttribute('aria-label'), /Red chariot/);
        await page.keyboard.press('ControlOrMeta+z');
        assert.match(await square(0, 0).getAttribute('aria-label'), /empty/);
        await page.keyboard.press('ControlOrMeta+Shift+z');
        assert.match(await square(0, 0).getAttribute('aria-label'), /Red chariot/);
        await page.getByTestId('editor-clear').click();
        assert.match(await square(0, 0).getAttribute('aria-label'), /empty/);
        await page.getByTestId('editor-undo').click();
        assert.match(await square(0, 0).getAttribute('aria-label'), /Red chariot/);
        await square(0, 0).focus();
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown');
        await expectSquare(0, 0);
        await square(8, 0).focus(); await page.keyboard.press('ArrowRight'); await expectSquare(8, 0);
        assert.equal(await editor.locator('.hitbox[tabindex="0"]').count(), 1);
        assert.equal(await page.getByTestId('editor-done').isEnabled(), true, 'Editing changed an otherwise legal position');

        // The shared trap must ignore hidden descendants and negative tab stops.
        await editor.evaluate(node => {
          const hidden = document.createElement('div'); hidden.style.display = 'none'; hidden.dataset.qaFocus = '';
          hidden.innerHTML = '<button>Hidden first</button>'; node.prepend(hidden);
          const skipped = document.createElement('button'); skipped.tabIndex = -1; skipped.dataset.qaFocus = '';
          skipped.textContent = 'Skipped last'; node.append(skipped);
        });
        await page.getByTestId('editor-done').focus(); await tab(); await expectSquare(8, 0);
        await tab(true);
        assert.equal(await page.getByTestId('editor-done').evaluate(node => node === document.activeElement), true);
        await editor.locator('[data-qa-focus]').evaluateAll(nodes => nodes.forEach(node => node.remove()));

        await editor.evaluate(node => { node.scrollTop = 0; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await editor.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        await page.screenshot({ path: `/tmp/xiangqi-editor-keyboard-${browserType.name()}-${width}.png` });
        await page.keyboard.press('Escape'); await editor.waitFor({ state: 'hidden' });
        await page.waitForFunction(node => document.activeElement === node, await launchSquare.elementHandle(), { timeout: 3000 });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: editor arrows, one Tab stop, painting, focus trap, escape and layout passed at ${width}x${height}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
