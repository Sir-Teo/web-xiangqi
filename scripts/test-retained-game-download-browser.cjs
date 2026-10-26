const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) for (const kind of ['discard', 'library']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
      page.setDefaultTimeout(10000);
      const game = { id: 'retained-study', savedAt: 1, gameMode: 'PvP', result: 'ongoing', label: 'Retained study',
        moves: ['h2e2', kind === 'discard' ? 'h9h8' : 'h9g7'], rootComment: 'Keep the opening note',
        metadata: { redPlayer: 'Learner', event: 'Repair lesson' },
        moveTree: [{ uci: 'h2e2', comment: 'Keep the cannon note', children: [{ uci: kind === 'discard' ? 'h9h8' : 'h9g7', comment: 'Keep the reply note' }] }],
      };
      try {
        await page.addInitScript(({ game, kind }) => {
          localStorage.setItem(kind === 'discard' ? 'xiangqi:auto-saved-game:v1' : 'xiangqi:library:v1',
            JSON.stringify(kind === 'discard' ? { version: 1, savedAt: 1, game } : [game]));
        }, { game, kind });
        await page.goto(base + (kind === 'library' ? '?moves=b2e2' : ''));
        if (kind === 'discard') {
          await page.getByRole('dialog', { name: 'Unfinished game', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
        } else {
          await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
          await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
          await page.getByTestId('delete-saved-retained-study').click();
          await page.getByTestId('confirm-delete-saved-retained-study').click();
          await page.getByTestId('library-undo-toast').waitFor();
          await page.evaluate(() => {
            window.__denyLibrary = true;
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
              if (window.__denyLibrary && key === 'xiangqi:library:v1') throw new DOMException('Full', 'QuotaExceededError');
              return original.call(this, key, value);
            };
          });
        }
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.getByTestId(kind === 'discard' ? 'discard-undo-btn' : 'library-undo-btn').press('Enter');
        const download = page.getByTestId(kind === 'discard' ? 'discard-undo-download' : 'library-undo-download');
        await download.waitFor();
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
        await page.evaluate(() => {
          window.__realAnchorClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function() { throw new Error('Download blocked'); };
        });
        await download.press('Enter');
        assert.equal(await download.innerText(), 'Download failed — retry');
        assert.equal(await download.evaluate(element => element === document.activeElement), true);
        await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__realAnchorClick; });
        const event = page.waitForEvent('download');
        await download.press('Enter');
        const file = await event;
        assert.match(file.suggestedFilename(), /\.json$/);
        const text = await fs.readFile(await file.path(), 'utf8');
        const backup = JSON.parse(text);
        assert.equal(backup.format, 'web-xiangqi-library');
        assert.equal(backup.version, 1);
        assert.equal(backup.games.length, 1);
        for (const field of ['moves', 'moveTree', 'rootComment', 'metadata']) assert.deepEqual(backup.games[0][field], game[field]);
        if (kind === 'library') assert.equal(backup.games[0].id, game.id);
        if (kind === 'library' && width === 1440) {
          await page.evaluate(() => { window.__denyLibrary = false; });
          const transfer = page.getByRole('region', { name: 'Library backup and recovery' });
          await transfer.locator('summary').first().click();
          await transfer.getByLabel('Restore library backup', { exact: true }).setInputFiles({
            name: file.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text),
          });
          await transfer.getByRole('button', { name: 'Restore 1 game', exact: true }).press('Enter');
          await page.getByTestId('load-saved-retained-study').waitFor();
          await page.getByTestId('library-retry-undo-btn').press('Enter');
          await page.getByTestId('library-undo-toast').waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).length), 1,
            'Restoring the download and retrying Undo must not create a duplicate');
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        console.log(`${browserType.name()} ${width}px: ${kind} Undo failure retains a downloadable game with notes and metadata; blocked downloads can retry`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
