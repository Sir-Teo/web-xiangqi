const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          if (sessionStorage.getItem('limit-fixture')) return;
          sessionStorage.setItem('limit-fixture', 'yes');
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          let children = [];
          for (let i = 1023; i >= 0; i--) children = [{ uci: cycle[i % 4], children }];
          localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: 1,
            game: { id: 'full-study', savedAt: 1, gameMode: 'PvP', moves: [], moveTree: children },
          }));
        });
        await page.goto(base);
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
        await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
        const notice = page.getByTestId('auto-save-error');
        await notice.waitFor({ timeout: 3000 });
        assert.match(await notice.innerText(), /too large for automatic recovery/);
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1')), null);
        const pending = page.waitForEvent('download');
        await notice.getByRole('button', { name: 'Download PGN', exact: true }).click();
        const chunks = [];
        for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
        const pgn = Buffer.concat(chunks).toString();
        assert.equal((pgn.match(/\ba[0198]a[0198]\b/g) ?? []).length, 1024);
        assert.match(pgn, /h2e2/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-autosave-limit-${width}.png` });
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox').fill('Delete this move and what follows');
        await page.keyboard.press('Enter');
        await notice.waitFor({ state: 'detached' });
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.length === 1);
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.match(await page.locator('.bottombar-fen').getAttribute('title'), /RNBAKABNR w - - 0 1$/);
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-chip').count(), 1024);
        assert.deepEqual(errors, []);
        console.log(`Autosave capacity warning, full PGN download, pruning and recovery passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
