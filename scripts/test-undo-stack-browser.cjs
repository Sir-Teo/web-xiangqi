const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, hasTouch: width < 900 });
      page.setDefaultTimeout(10000);
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'stacked-undo', savedAt: 1, gameMode: 'PvP', label: 'Saved study', moves: ['h2e2'] },
        ])));
        await page.goto(base + '?moves=h2e2%20h9g7');
        await page.waitForFunction(() => / w - - 2 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
        // Measuring both text sizes and taking a screenshot must not consume
        // the recovery window when browser rendering is slow on a CI runner.
        await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Delete this move and what follows');
        await command(page, 'Library');
        await page.getByTestId('delete-saved-stacked-undo').click();
        await page.getByTestId('confirm-delete-saved-stacked-undo').click();
        const saved = page.getByTestId('library-undo-toast');
        const move = page.getByTestId('delete-undo-toast');
        await saved.waitFor();
        for (const fontSize of ['16px', '32px']) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size; }, fontSize);
          const a = await saved.boundingBox(), b = await move.boundingBox();
          assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y,
            `${width}px/${fontSize}: simultaneous recovery notices must not cover each other`);
          for (const box of [a, b]) assert.ok(box.x >= 0 && box.x + box.width <= width,
            'Recovery notices and their actions must fit the viewport');
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
        await page.screenshot({ path: `/tmp/xiangqi-undo-stack-${browserType.name()}-${width}.png` });
        await page.getByTestId('library-undo-btn').click();
        await saved.waitFor({ state: 'hidden' });
        assert.equal(await move.isVisible(), true, 'Restoring a saved game must retain the separate move Undo');
        await page.getByTestId('delete-undo-btn').click();
        await move.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).length), 1);
        // Reading or tabbing through Undo must not consume the recovery window.
        await page.mouse.move(0, 0);
        await command(page, 'Delete this move and what follows');
        await page.getByTestId('delete-saved-stacked-undo').click();
        await page.getByTestId('confirm-delete-saved-stacked-undo').click();
        const undo = page.getByTestId('library-undo-btn');
        // Library deletion completes asynchronously under its storage lock.
        // Start measuring only once both notices exist and neither is hovered.
        await saved.waitFor(); await move.waitFor();
        await page.mouse.move(0, 0);
        await page.clock.fastForward(3000);
        await undo.focus(); await page.getByTestId('delete-undo-btn').hover();
        await page.clock.fastForward(15000);
        assert.equal(await saved.isVisible(), true, 'Focused Undo must survive its expiry');
        assert.equal(await move.isVisible(), true, 'Pointing at Undo must preserve the recovery window');
        await saved.getByRole('button', { name: 'Dismiss', exact: true }).focus();
        await page.clock.fastForward(15000);
        assert.equal(await saved.isVisible(), true, 'Moving within the notice must keep expiry paused');
        await page.getByRole('searchbox', { name: 'Search library', exact: true }).focus();
        await page.mouse.move(0, 0);
        // Headless browsers keep their lone page visible. Deliver the same
        // visibility signal as switching tabs, without relying on window focus.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.fastForward(60000);
        assert.equal(await saved.isVisible(), true, 'Hidden tabs must preserve library Undo');
        assert.equal(await move.isVisible(), true, 'Hidden tabs must preserve move Undo');
        await page.evaluate(() => {
          delete document.hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.fastForward(6000);
        assert.equal(await saved.isVisible(), true, 'Leaving Undo must retain its unspent recovery time');
        assert.equal(await move.isVisible(), true);
        await page.clock.fastForward(1001);
        // Timer callbacks enqueue React updates; observe the rendered result
        // before counting, without advancing either recovery deadline.
        await saved.waitFor({ state: 'hidden' });
        await move.waitFor({ state: 'hidden' });
        assert.equal(await saved.count(), 0, 'Unattended notices must eventually expire');
        assert.equal(await move.count(), 0);
        console.log(`${browserType.name()} ${width}px: separate recovery notices, enlarged text, restoring both edits, focus, pointer and tab visibility pause; resumed expiry passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
