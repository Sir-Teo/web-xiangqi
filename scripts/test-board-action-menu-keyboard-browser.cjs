const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const focused = locator => locator.evaluate(node => node === document.activeElement);

(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
      const errors = [], engineRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.url().endsWith('/pikafish.js')) engineRequests.push(request.url()); });
      try {
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await page.getByRole('button', { name: 'Open new game menu', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('h2e2 h9g7 b0c2 b9c7 *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        const orientation = await page.locator('.xiangqi-board-container').getAttribute('data-orientation');
        const opener = page.getByTestId('mobile-more-actions-btn');
        const menu = page.getByRole('menu', { name: 'More board actions', exact: true });
        const actions = menu.locator('[role="menuitem"]:enabled');
        const note = page.getByRole('menuitem', { name: 'Write note', exact: true });
        const settings = page.getByRole('menuitem', { name: 'Open settings', exact: true });
        for (const font of [16, 32]) {
          await page.evaluate(font => document.documentElement.style.fontSize = font + 'px', font);
          await opener.click(); await note.focus(); await page.keyboard.press('ArrowUp');
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen,
            'Browsing board actions must not jump the board to the starting position');
          assert.equal(await focused(settings), true, 'Up must wrap to the last enabled action');
          await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
          assert.equal(await focused(opener), true, 'Escape must return focus to More board actions');

          await page.keyboard.press('ArrowDown'); await menu.waitFor();
          assert.equal(await focused(note), true, 'Down on the opener must open the first action');
          const headerTop = await page.locator('.mobile-board-header').evaluate(node => node.getBoundingClientRect().top);
          const count = await actions.count();
          for (let index = 1; index <= count; index++) {
            await page.keyboard.press('ArrowDown');
            const action = actions.nth(index % count);
            assert.equal(await focused(action), true, 'Down must browse enabled actions and wrap');
            assert.equal(await action.evaluate(node => {
              const box = node.getBoundingClientRect();
              return box.top >= 0 && box.bottom <= innerHeight + 1
                && node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
            }), true, 'Keyboard focus must reveal an action within the scrolling menu');
          }
          assert.ok(Math.abs(await page.locator('.mobile-board-header').evaluate(node => node.getBoundingClientRect().top) - headerTop) < 1);
          await page.keyboard.press('End'); assert.equal(await focused(settings), true);
          await page.keyboard.press('Home'); assert.equal(await focused(note), true);
          for (const key of ['ArrowLeft', 'ArrowRight']) {
            await page.keyboard.press(key); assert.equal(await focused(note), true);
          }
          for (const flags of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
            { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
            const state = await note.evaluate((node, flags) => {
              const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true, ...flags });
              if (flags.prePrevented) event.preventDefault();
              node.dispatchEvent(event);
              return { retained: document.activeElement === node, prevented: event.defaultPrevented };
            }, flags);
            assert.deepEqual(state, { retained: true, prevented: !!flags.prePrevented });
          }
          await page.keyboard.type('se'); assert.equal(await focused(settings), true, 'Typing a label must find Settings');
          await page.keyboard.press('Home');
          await page.keyboard.press('Shift+f');
          assert.equal(await focused(menu.getByRole('menuitem', { name: 'Flip board', exact: true })), true,
            'Typing an uppercase label after arrow navigation must start a new label search');
          await page.keyboard.press('Home');
          await page.keyboard.press('s');
          const firstMatch = await page.evaluate(() => document.activeElement?.textContent);
          await page.keyboard.press('s');
          const nextMatch = await page.evaluate(() => document.activeElement?.textContent);
          assert.match(firstMatch.trim(), /^s/i); assert.match(nextMatch.trim(), /^s/i);
          assert.notEqual(firstMatch, nextMatch, 'Repeating a letter must cycle matching actions');
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
          assert.equal(await page.locator('.xiangqi-board-container').getAttribute('data-orientation'), orientation,
            'Searching for Flip board must not run the board shortcut');
          assert.equal(await menu.isVisible(), true, 'Menu letters must not open an analysis panel');
          await page.keyboard.press('Shift+Tab'); await menu.waitFor({ state: 'hidden' });
          assert.equal(await focused(opener), true);
          await page.keyboard.press('ArrowUp'); assert.equal(await focused(settings), true);
          await page.keyboard.press('Tab'); await menu.waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(() => document.activeElement === document.body), false, 'Tab must leave the menu at a page control');

          await opener.focus(); await page.keyboard.press('Enter'); assert.equal(await focused(note), true);
          await opener.click(); await menu.waitFor({ state: 'hidden' });
          assert.equal(await focused(opener), true, 'Clicking the opener a second time must close the menu');
          await page.keyboard.press('Space'); assert.equal(await focused(note), true);
          await page.keyboard.press('End'); await page.keyboard.press('Enter');
          await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'mobile-more-actions-btn');

          await page.keyboard.press('ArrowDown'); await page.keyboard.type('comm'); await page.keyboard.press('Enter');
          await page.getByRole('combobox', { name: 'Search commands' }).waitFor();
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'mobile-more-actions-btn');
          await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
          const editor = page.getByTestId('move-comment-input');
          await page.waitForFunction(() => document.activeElement?.id === 'move-comment-input');
          assert.equal(await editor.isVisible(), true, 'Write note must keep focus after the menu unmounts');
          await editor.fill('Keyboard annotation');
          await page.getByTestId('mobile-view-board').click();
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        }
        assert.deepEqual(errors, []); assert.deepEqual(engineRequests, []);
        console.log(`${browserType.name()} ${width}x${height}: menu arrows, label search, Tab, Escape, pointer toggle, dialog and note focus work at 100/200% text without moving the board or loading the engine`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-menu-keyboard-${browserType.name()}-${width}-failure.png` });
        throw error;
      } finally { await page.close(); }

      const root = await browser.newPage({ viewport: { width, height }, hasTouch: true });
      try {
        await root.goto(base); await root.locator('.xiangqi-board').waitFor();
        await root.getByTestId('mobile-more-actions-btn').focus(); await root.keyboard.press('ArrowDown');
        const menu = root.getByRole('menu', { name: 'More board actions', exact: true });
        assert.equal(await root.getByTestId('mobile-save-game-btn').isDisabled(), true);
        await root.keyboard.press('ArrowDown');
        assert.equal(await focused(root.getByTestId('mobile-copy-fen-btn')), true, 'Arrow navigation must skip disabled Save');
        await root.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
      } finally { await root.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
