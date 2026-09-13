const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: 128 }, (_, i) => cycle[i % 4]).join('+'));
        await page.locator('.xiangqi-board').waitFor();
        await page.keyboard.press('t');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n128');
        await page.getByTestId('move-tree-active').click();
        assert.equal(await page.locator('.mtree-chip[tabindex="0"]').getAttribute('data-node-id'), 'n128');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.locator('button[aria-label="Go to first position"]:visible').first().click();
        await page.locator('.xiangqi-board .hitbox[data-file="7"][data-rank="2"]').click();
        await page.locator('.xiangqi-board .hitbox[data-file="4"][data-rank="2"]').click();
        await page.keyboard.press('t');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n129');
        assert.equal(await page.locator('.mtree-variation .mtree-chip').count(), 80);
        assert.equal(await page.locator('.mtree-variation-rest').innerText(), '+48');
        const stops = page.locator('.mtree-chip[tabindex="0"]');
        assert.equal(await stops.count(), 1, 'The remembered move is beyond the shortened variation; the visible list still needs a tab stop');
        assert.equal(await stops.getAttribute('data-node-id'), 'n129');
        await page.locator('.tree-breadcrumb-chip[tabindex="0"]').focus();
        // macOS WebKit uses Option-Tab for Safari's full control sequence.
        await page.keyboard.press(browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
        // Firefox also makes overflow containers native Tab stops.
        if (browserType.name() === 'firefox' && await page.locator('.mtree-scroll').evaluate(el => el === document.activeElement)) {
          await page.keyboard.press('Tab');
        }
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n129');
        await page.locator('.mtree-variation [data-node-id="n80"]').focus();
        assert.equal(await stops.getAttribute('data-node-id'), 'n80', 'A still-visible variation move should keep its tab stop');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n80');
        assert.equal(await stops.count(), 1);
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-node-id') === 'n80');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n128');
        // Space activation must also transfer focus when this short branch opens.
        await page.locator('.mtree-variation [data-node-id="n129"]').focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n129'
          && document.activeElement?.getAttribute('data-node-id') === 'n129');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n1');
        assert.equal(await stops.count(), 1);
        const removeLongLine = page.getByTestId('delete-variation-n1');
        await removeLongLine.focus();
        await page.keyboard.press('Enter');
        await removeLongLine.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-node-id') === 'n129', null, { timeout: 2000 });
        assert.equal(await stops.getAttribute('data-node-id'), 'n129');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('h2e2 h9g7 (b9c7) (a9a8) h0g2 *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        if (width === 320) await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
        const parent = page.locator('.mtree-row .mtree-chip').filter({ hasText: 'h2e2' });
        const parentId = await parent.getAttribute('data-node-id');
        const currentId = await page.getByTestId('move-tree-active').getAttribute('data-node-id');
        const variation = page.locator('.mtree-variation').filter({ hasText: 'b9c7' });
        const removeNestedLine = variation.locator('.mtree-var-delete');
        await removeNestedLine.focus();
        await page.keyboard.press('Space');
        await removeNestedLine.waitFor({ state: 'detached' });
        await page.waitForFunction(id => document.activeElement?.getAttribute('data-node-id') === id, parentId, { timeout: 2000 });
        assert.equal(await page.getByTestId('move-tree-active').getAttribute('data-node-id'), currentId, 'Focus recovery must not change the board position');
        assert.equal(await stops.count(), 1);
        assert.equal(await stops.getAttribute('data-node-id'), parentId);
        await page.screenshot({ path: `/tmp/xiangqi-delete-focus-${browserType.name()}-${width}.png` });
        const note = page.getByTestId('move-comment-input');
        await note.fill('Keep focus on my note');
        // Script/pointer activation that does not focus the delete button must
        // not steal focus from another control when the row disappears.
        await page.locator('.mtree-variation .mtree-var-delete').evaluate(button => button.click());
        await page.locator('.mtree-variation').waitFor({ state: 'detached' });
        assert.ok(await note.evaluate(element => element === document.activeElement));
        assert.equal(await note.inputValue(), 'Keep focus on my note');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: long-variation keyboard navigation, root/nested deletion focus, unchanged board, enlarged text and no focus stealing passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
