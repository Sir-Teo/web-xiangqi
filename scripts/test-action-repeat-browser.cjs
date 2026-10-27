const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function skipToBoard(browser) {
  for (const [width, height] of [[390, 844], [1440, 900], [320, 480], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
    try {
      await page.goto(base + '?moves=h2e2,h9g7');
      await page.waitForFunction(() => / w - - 2 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
      const initialFen = await page.locator('.bottombar-fen').getAttribute('title');
      const square = page.locator('.xiangqi-board .hitbox[data-file="8"][data-rank="0"]');
      const target = await square.elementHandle();
      for (const size of [16, 32]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
        for (const key of ['Enter', 'Space']) {
          await square.focus();
          if (width < 900) {
            await page.getByTestId('mobile-view-analysis').click();
            assert.equal(await page.locator('.app-shell').getAttribute('data-mobile-view'), 'analysis');
          } else {
            await page.locator('[role=tablist][aria-label="Analysis panels"] [role=tab]').nth(1).click();
          }
          await page.getByRole('button', { name: 'Skip to board', exact: true }).focus();
          await page.keyboard.press(key);
          await page.waitForFunction(node => node === document.activeElement, target, { timeout: 3000 });
          if (width < 900) assert.equal(await page.locator('.app-shell').getAttribute('data-mobile-view'), 'board');
          const reachable = await square.evaluate(node => {
            const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          });
          assert.equal(reachable, true, `${width}x${height}/${size}px/${key}: skipped-to square must be visible`);
          assert.equal(await square.getAttribute('tabindex'), '0');
          assert.doesNotMatch(await square.getAttribute('aria-label'), /\bselected\b/, 'Skipping must focus the piece without picking it up');
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), initialFen, 'Skipping must preserve the position');
        }
      }
      console.log(`${browserType.name()} ${width}x${height}: Enter/Space skip to the last board square at 100/200% text without selecting a piece or changing the game`);
    } finally { await page.close(); }
  }
}
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(base + '?moves=h2e2,h9g7');
    const board = page.locator('.xiangqi-board-container');
    await board.waitFor();
    await page.waitForFunction(() => / w - - 2 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
    const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        const prevented = await page.evaluate(({ key, flags }) => {
          document.activeElement?.blur();
          const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...flags });
          document.body.dispatchEvent(event); return event.defaultPrevented;
        }, { key, flags });
        assert.equal(prevented, false, `Composing ${key} must stay with the input method`);
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen,
          `Composing ${key} must preserve the current game position`);
      }
    }
    const checkOwnership = async (control, key, unchanged) => {
      for (const flags of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
        await control.focus();
        const result = await control.evaluate((node, { key, flags }) => {
          const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...flags });
          if (flags.prePrevented) event.preventDefault();
          node.dispatchEvent(event);
          return { prevented: event.defaultPrevented, retained: document.activeElement === node };
        }, { key, flags });
        assert.equal(result.prevented, !!flags.prePrevented, `${key}/${JSON.stringify(flags)} must keep its original owner`);
        assert.equal(result.retained, true, `${key}/${JSON.stringify(flags)} must retain focus`);
        await unchanged();
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
      }
    };
    for (const label of ['Graph and library panels', 'Analysis panels']) {
      const tabs = page.locator(`[role=tablist][aria-label="${label}"] [role=tab]`);
      const first = tabs.first(); await first.click();
      await checkOwnership(first, 'ArrowRight', async () => assert.equal(await first.getAttribute('aria-selected'), 'true'));
      await page.keyboard.press('ArrowRight');
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true', 'Plain Right must still select the next panel');
      await page.keyboard.press('Home');
      assert.equal(await first.getAttribute('aria-selected'), 'true', 'Plain Home must still select the first panel');
    }
    for (const side of ['left', 'right']) {
      const resize = page.getByTestId(`${side}-panel-resize-handle`);
      const before = await resize.getAttribute('aria-valuenow');
      await checkOwnership(resize, 'ArrowRight', async () => assert.equal(await resize.getAttribute('aria-valuenow'), before));
      await page.keyboard.press('ArrowRight');
      assert.notEqual(await resize.getAttribute('aria-valuenow'), before, 'Plain Right must still resize the panel');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await resize.getAttribute('aria-valuenow'), before);
    }
    const square = page.locator('.hitbox[data-file="4"][data-rank="4"]');
    await checkOwnership(square, 'ArrowLeft', async () => {});
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('.hitbox[data-file="3"][data-rank="4"]').evaluate(node => node === document.activeElement), true);
    for (const selector of ['.mtree-chip', '.tree-breadcrumb-chip']) {
      const controls = page.locator(selector);
      assert.ok(await controls.count() >= 2, `${selector} needs multiple real navigation targets`);
      await checkOwnership(controls.last(), 'Home', async () => {});
      await page.keyboard.press('Home');
      assert.equal(await controls.first().evaluate(node => node === document.activeElement), true, 'Plain Home must still move to the first item');
    }
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('f');
    await page.keyboard.down('f');
    await page.keyboard.down('f');
    await page.keyboard.up('f');
    assert.equal(await board.getAttribute('data-orientation'), 'black');
    await page.keyboard.press('f');
    assert.equal(await board.getAttribute('data-orientation'), 'red');
    await page.keyboard.down('Control');
    await page.keyboard.down('k');
    await page.keyboard.down('k');
    await page.keyboard.up('k');
    await page.keyboard.up('Control');
    await page.getByRole('combobox').waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.up('ArrowLeft');
    assert.match(await page.locator('.wc-meta').innerText(), /START\s*\/\s*2/);
    await page.close();
    await skipToBoard(browser);
    console.log('PASS: modified/composing/claimed keys preserve widget focus, panels and position; ordinary widget navigation and held actions still work');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
