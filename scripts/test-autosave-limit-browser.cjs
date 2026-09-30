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
        const notice = page.getByTestId('study-capacity-error');
        await notice.waitFor({ timeout: 3000 });
        assert.match(await notice.innerText(), /8,192|8192/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await notice.getByRole('button', { name: 'Dismiss study limit' }).click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.length === 16);
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.match(await page.locator('.bottombar-fen').getAttribute('title'), /RNBAKABNR w - - 0 1$/);
        await page.keyboard.press('t');
        assert.equal(await page.evaluate(() => { let count = 0, pending = [...JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game.moveTree]; while (pending.length) { const node = pending.pop(); count++; pending.push(...node.children || []); } return count; }), 8192);
        assert.deepEqual(errors, []);
        console.log(`Study capacity refusal preserves full recovery snapshot at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
