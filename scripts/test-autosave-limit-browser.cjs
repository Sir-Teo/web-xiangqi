const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          if (sessionStorage.getItem('limit-fixture')) return;
          sessionStorage.setItem('limit-fixture', 'yes');
          const roots = ['h2c2','h2d2','h2e2','h2f2','h2g2','h2i2','b2a2','b2c2','b2d2','b2e2','b2f2','b2g2','h2h3','h2h4','h2h5','h2h6'];
          const children = roots.map(uci => {
            let children = [];
            for (let i = 510; i >= 0; i--) children = [{ uci: ['a9a8','a0a1','a8a9','a1a0'][i % 4], children }];
            return { uci, children };
          });
          localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: 1,
            game: { id: 'full-study', savedAt: 1, gameMode: 'PvP', moves: [], moveTree: children },
          }));
        });
        await page.goto(base);
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.locator('.hitbox[data-file="1"][data-rank="2"]').click();
        await page.locator('.hitbox[data-file="1"][data-rank="3"]').click();
        const notice = page.getByTestId('auto-save-error');
        await notice.waitFor({ timeout: 3000 });
        assert.match(await notice.innerText(), /too large for automatic recovery/);
        if (width < 900) {
          const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
          for (const button of coarse ? await notice.getByRole('button').all() : []) {
            const box = await button.boundingBox();
            assert.ok(box.height >= 44 && box.width >= 44, 'Recovery action is smaller than a touch target');
          }
          const warningBox = await notice.boundingBox();
          const navBox = await page.locator('.mobile-board-nav').boundingBox();
          assert.ok(warningBox.y + warningBox.height + 8 <= navBox.y, 'Recovery warning overlaps move navigation');
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1')), null);
        const pending = page.waitForEvent('download');
        await notice.getByRole('button', { name: 'Download PGN', exact: true }).click();
        const chunks = [];
        for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
        const pgn = Buffer.concat(chunks).toString();
        assert.equal((pgn.match(/\ba[0198]a[0198]\b/g) ?? []).length, 8176);
        assert.match(pgn, /b2b3/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-autosave-limit-${browserType.name()}-${width}.png` });
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox').fill('Delete this move and what follows');
        await page.keyboard.press('Enter');
        await notice.waitFor({ state: 'detached' });
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.length === 16);
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.match(await page.locator('.bottombar-fen').getAttribute('title'), /RNBAKABNR w - - 0 1$/);
        await page.keyboard.press('t');
        assert.equal(await page.evaluate(() => { let count = 0, pending = [...JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game.moveTree]; while (pending.length) { const node = pending.pop(); count++; pending.push(...node.children || []); } return count; }), 8192);
        assert.deepEqual(errors, []);
        console.log(`Autosave capacity warning, full PGN download, pruning and recovery passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
