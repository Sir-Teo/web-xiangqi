const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const fixture = 'h2e2 (b2e2 h9g7 b0c2 b9c7 a0b0 a9b9 h0g2 c6c5) h9g7 b0c2 b9c7 a0b0 a9b9 h0g2 c6c5 *';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base);
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill(fixture);
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await command(page, 'Move tree');
        const moves = page.locator('.mtree-chip');
        const variation = page.locator('.mtree-variation').first().locator('.mtree-chip');
        const fen = () => page.locator('.bottombar-fen').getAttribute('title');
        const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-node-id'));
        let wrapped = 0;
        for (const fontSize of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, fontSize);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await command(page, 'Go to latest move');
          const latest = await fen();
          await moves.first().focus();
          const first = await focused();
          await page.keyboard.press('ArrowUp');
          assert.equal(await fen(), latest, 'Up at the first move must not jump the board to the starting position');
          assert.equal(await focused(), first);
          await command(page, 'Go to start');
          const start = await fen();
          await moves.last().focus();
          const last = await focused();
          await page.keyboard.press('ArrowDown');
          assert.equal(await fen(), start, 'Down at the last move must not jump the board to the end');
          assert.equal(await focused(), last);
          for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
            await page.keyboard.press(key);
            assert.equal(await fen(), start, 'Browsing move controls must leave the board unchanged');
          }
          await variation.first().focus();
          const rows = await variation.evaluateAll(nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return { id: node.dataset.nodeId, top: rect.top, bottom: rect.bottom };
          }));
          const below = rows.find(row => row.top >= rows[0].bottom + 1);
          if (below) {
            wrapped++;
            await page.keyboard.press('ArrowDown');
            assert.equal(await focused(), below.id, 'Down must visit the next visible row inside a wrapped variation');
            await page.keyboard.press('ArrowUp');
            assert.equal(await focused(), rows[0].id, 'Up must return to the preceding visible variation row');
            assert.equal(await fen(), start);
          }
          for (const flags of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
            const state = await variation.first().evaluate((node, flags) => {
              const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, ...flags });
              if (flags.prePrevented) event.preventDefault();
              node.dispatchEvent(event);
              return { retained: document.activeElement === node, prevented: event.defaultPrevented };
            }, flags);
            assert.deepEqual(state, { retained: true, prevented: !!flags.prePrevented });
            assert.equal(await fen(), start);
          }
          assert.equal(await page.locator('.mtree-chip[tabindex="0"]').count(), 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        }
        assert.ok(wrapped > 0, 'The regression must exercise a variation that actually wraps');
        const chosen = await variation.first().getAttribute('data-node-id');
        await variation.first().focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(id => document.activeElement?.getAttribute('data-node-id') === id
          && document.activeElement?.getAttribute('aria-current') === 'step', chosen);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: arrow browsing stops at edges, follows wrapped rows at 100/200% text, preserves the board and modifier/IME handling; Enter opens the variation with focus retained`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
