const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const key = 'xiangqi:library:v1';
const lockName = 'xiangqi:library-write:v1';
const game = { id: 'recover-deletion', savedAt: 1, gameMode: 'PvP', label: 'Cannon study', moves: ['h2e2'], moveTree: [{ uci: 'h2e2', comment: 'Keep this note' }] };

async function remove(page) {
  await page.getByTestId(`delete-saved-${game.id}`).click();
  await page.getByTestId(`confirm-delete-saved-${game.id}`).click();
  await page.getByTestId('library-undo-toast').waitFor();
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), []);
}

async function holdLock(page) {
  await page.evaluate(name => new Promise(ready => {
    window.__heldLock = navigator.locks.request(name, () => new Promise(release => {
      window.__releaseLock = release;
      ready();
    }));
  }), lockName);
}

async function releaseLock(page) {
  await page.evaluate(async name => {
    window.__releaseLock();
    await navigator.locks.request(name, () => {});
    await window.__heldLock;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, lockName);
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      try {
        await page.addInitScript(({ key, game }) => localStorage.setItem(key, JSON.stringify([game])), { key, game });
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        await remove(page);
        await page.evaluate(key => {
          const original = Storage.prototype.setItem;
          window.__refuseUndo = true;
          Storage.prototype.setItem = function(name, value) {
            if (window.__refuseUndo && name === key) throw new DOMException('Quota', 'QuotaExceededError');
            return original.call(this, name, value);
          };
        }, key);
        await page.getByTestId('library-undo-btn').click();
        const retry = page.getByTestId('library-retry-undo-btn');
        await retry.waitFor();
        assert.equal(await retry.evaluate(element => element === document.activeElement), true,
          'A failed keyboard Undo must keep focus on Retry restore');
        assert.match(await page.getByTestId('library-undo-toast').innerText(), /Could not put it back/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const toast = await page.getByTestId('library-undo-toast').boundingBox();
        assert.ok(toast.x >= 0 && toast.x + toast.width <= width, 'Recovery actions must fit on screen');
        await holdLock(page);
        await page.keyboard.press('Enter');
        const search = page.getByRole('searchbox', { name: 'Search library', exact: true });
        await search.focus();
        await releaseLock(page);
        assert.equal(await retry.isEnabled(), true);
        assert.equal(await search.evaluate(element => element === document.activeElement), true,
          'A delayed restore failure must not steal focus from another control');
        await retry.focus();
        await page.evaluate(() => { window.__refuseUndo = false; });
        await page.keyboard.press('Enter');
        await page.getByTestId(`load-saved-${game.id}`).waitFor();
        assert.deepEqual((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key))[0].moveTree, game.moveTree);

        // Undo near the end of its ten-second window, then wait for another
        // tab's library lock. The toast must not expire during that request.
        await page.clock.install();
        await remove(page);
        await page.clock.runFor(8000);
        await holdLock(page);
        await page.getByTestId('library-undo-btn').click();
        await page.clock.runFor(2100);
        assert.equal(await page.getByTestId('library-undo-toast').isVisible(), true,
          'An accepted Undo must remain visible while waiting for storage');
        assert.equal(await page.getByTestId('library-undo-btn').isDisabled(), true,
          'Repeated clicks must not queue duplicate restores');
        await releaseLock(page);
        await page.getByTestId(`load-saved-${game.id}`).waitFor();
        await page.getByTestId('library-undo-toast').waitFor({ state: 'hidden' });
        assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).length, 1);

        await remove(page);
        await holdLock(page);
        await page.evaluate(() => { window.__refuseUndo = true; });
        await page.getByTestId('library-undo-btn').click();
        await page.getByTestId('library-undo-toast').getByRole('button', { name: 'Dismiss', exact: true }).click();
        await releaseLock(page);
        assert.equal(await page.getByTestId('library-undo-toast').count(), 0,
          'A late restore failure must not reopen a dismissed notice');
        console.log(`${browserType.name()} ${width}px: failed Undo retries; queued Undo survives expiry; dismissed notices stay closed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
