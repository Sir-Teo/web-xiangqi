const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const key = 'xiangqi:library:v1';
const game = { id: 'backup-study', savedAt: 1700000000000, gameMode: 'PvP', result: 'ongoing', moves: ['h2e2'], label: 'Cannon study', moveTree: [{ uci: 'h2e2', comment: 'Central cannon', children: [{ uci: 'h9g7' }] }] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
      await page.locator('.lib-transfer summary').click();
      const input = page.getByLabel('Restore library backup', { exact: true });
      const payload = JSON.stringify({ format: 'web-xiangqi-library', version: 1, games: [game] });
      const upload = text => input.setInputFiles({ name: 'library.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await upload(payload);
      await page.getByRole('button', { name: 'Restore 1 games', exact: true }).waitFor();
      assert.equal(await page.evaluate(k => localStorage.getItem(k), key), null);
      await page.getByRole('button', { name: 'Restore 1 games', exact: true }).click();
      await page.getByText('Restored 1 games. Skipped 0 identical games.', { exact: true }).waitFor();
      const saved = await page.evaluate(k => localStorage.getItem(k), key);
      assert.deepEqual(JSON.parse(saved)[0].moveTree, game.moveTree);
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download library backup', exact: true }).click();
      const downloaded = JSON.parse(await fs.readFile(await (await downloadEvent).path(), 'utf8'));
      assert.deepEqual(downloaded.games, JSON.parse(saved));
      await upload(payload);
      await page.getByRole('button', { name: 'Restore 0 games', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Restore 0 games', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await upload(JSON.stringify({ ...downloaded, games: [{ ...game, label: 'Conflict' }] }));
      await page.getByText(/conflicts with a saved game/).waitFor();
      assert.equal(await page.evaluate(k => localStorage.getItem(k), key), saved);
      await page.evaluate(k => { localStorage.setItem(k, '{damaged'); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, key);
      await page.getByRole('button', { name: 'Download recovery file', exact: true }).waitFor();
      const recoveryEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download recovery file', exact: true }).click();
      assert.equal(await fs.readFile(await (await recoveryEvent).path(), 'utf8'), '{damaged');
      assert.equal(await input.isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/xiangqi-backup-${width}.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: desktop/mobile backup download, restore preview, branch/comment preservation, duplicate/conflict protection, exact damaged-data recovery, no overflow or page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
