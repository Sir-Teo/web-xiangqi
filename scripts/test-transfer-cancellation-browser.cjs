const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const libraryKey = 'xiangqi:library:v1';
const lockName = 'xiangqi:library-write:v1';

async function holdLibraryLock(page) {
  await page.evaluate(name => new Promise(ready => {
    window.__heldLibraryLock = navigator.locks.request(name, () => new Promise(release => {
      window.__releaseLibraryLock = release;
      ready();
    }));
  }), lockName);
}
async function releaseLibraryLock(page) {
  // This barrier queues behind the pending transfer, so unchanged storage
  // cannot pass merely because the canceled action has not run yet.
  await page.evaluate(async name => {
    window.__releaseLibraryLock();
    await navigator.locks.request(name, () => {});
    await window.__heldLibraryLock;
  }, lockName);
}
async function check(browser, width, kind, replace) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base);
    await page.locator('.xiangqi-board').waitFor();
    await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
    const panel = kind === 'pgn' ? page.getByTestId('pgn-collection-import')
      : page.getByRole('region', { name: 'Library backup and recovery' });
    await panel.locator('summary').first().click();
    const input = panel.getByLabel(kind === 'pgn' ? 'Choose PGN collection' : 'Restore library backup', { exact: true });
    const upload = (newer = false) => input.setInputFiles(kind === 'pgn'
      ? { name: 'games.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(newer ? '[White "Replacement"]\n1.b2e2 *' : '1.h2e2 *') }
      : { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
        format: 'web-xiangqi-library', version: 1,
        games: [{ id: newer ? 'replacement' : 'queued', savedAt: 1, gameMode: 'PvP', moves: [newer ? 'b2e2' : 'h2e2'] }],
      })) });
    await upload();
    const submit = panel.getByRole('button', { name: kind === 'pgn' ? 'Import 1 game' : 'Restore 1 game', exact: true });
    await submit.waitFor();
    const before = await page.evaluate(key => localStorage.getItem(key), libraryKey);
    await holdLibraryLock(page);
    await submit.click();
    assert.equal(await submit.isDisabled(), true, 'The transfer should be waiting for the held lock');
    assert.equal(await input.isEnabled(), true, 'Replacing the file remains available while waiting');
    if (kind === 'pgn') {
      assert.equal(await panel.getByRole('button', { name: 'Select all', exact: true }).isDisabled(), true);
      assert.equal(await panel.locator('.lib-pgn-games input[type="checkbox"]').first().isDisabled(), true,
        'Selection must stay consistent with the submitted import');
      assert.equal(await panel.getByRole('checkbox', { name: 'Import duplicates as copies' }).isDisabled(), true);
    }
    if (replace) {
      await upload(true);
      // New data is already previewed while the old request is still waiting.
      await panel.getByText(kind === 'pgn' ? /Replacement/ : /Ready to add 1 game/).first().waitFor();
    } else {
      await panel.getByRole('button', { name: kind === 'pgn' ? 'Cancel import' : 'Cancel', exact: true }).click();
    }
    await releaseLibraryLock(page);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), before,
      `${kind}: ${replace ? 'replacing the file' : 'canceling'} must prevent a queued write`);
    if (replace) {
      await submit.waitFor({ state: 'visible' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /^(?:Import|Restore) 1 game$/.test(button.textContent) && !button.disabled));
      await submit.click();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '[]')[0]?.moves[0] === 'b2e2', libraryKey);
      const games = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), libraryKey);
      assert.equal(games.length, 1, 'Only the replacement may be saved');
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      for (const kind of ['pgn', 'backup']) {
        for (const replace of [false, true]) await check(browser, width, kind, replace);
      }
      console.log(`${browserType.name()} ${width}px: canceled and replaced PGN/backup transfers cannot write after a queued lock is released`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
