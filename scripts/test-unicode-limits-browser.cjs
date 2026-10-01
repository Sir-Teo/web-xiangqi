const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const bounded = '中'.repeat(499);
const preview = '中'.repeat(47);
const player = '林'.repeat(255);
const source = `[White "${player}𠮷"]\n{${bounded}🐎}\n1.h2e2 {${bounded}🐎} h9g7 {${preview}🐎 develops} *`;
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function atRoot(page, width) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.locator('button[aria-label="Go to first position"]:visible').first().click();
  await page.keyboard.press('t');
}
async function noteIs(page, text) {
  await page.waitForFunction(text => document.querySelector('[data-testid="move-comment-input"]')?.value === text, text);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.context().addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => { window.__copied = text; } } }));
        await page.goto(base);
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill(source);
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        await page.locator('.mtree-chip').filter({ hasText: 'h2e2' }).click(); await noteIs(page, bounded);
        const summaries = await page.locator('.mtree-comment').allTextContents();
        assert.ok(summaries.includes(preview + '…'), JSON.stringify(summaries));
        await page.getByTestId('game-metadata').locator('summary').click();
        assert.equal(await page.getByRole('textbox', { name: 'Red player', exact: true }).inputValue(), player);
        await page.getByTestId('game-metadata').locator('summary').click();
        await atRoot(page, width); await noteIs(page, bounded);
        {
          const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
          await command(page, 'Save game');
          await page.waitForFunction(before => localStorage.getItem('xiangqi:library:v1') !== before, before);
        }
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.rootComment, bounded); assert.equal(saved.metadata.redPlayer, player);
        assert.equal(saved.moveTree[0].comment, bounded);
        // Use a native download to exercise UTF-8 file encoding, not just clipboard text.
        const download = page.waitForEvent('download');
        await command(page, 'Export PGN');
        const chunks = []; for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        const pgn = Buffer.concat(chunks).toString('utf8');
        assert.ok(!pgn.includes('\ufffd')); assert.ok(pgn.includes(`{ ${bounded} }`));
        assert.ok(pgn.includes(preview + '🐎 develops'));
        await command(page, 'Copy link');
        const url = await page.evaluate(() => window.__copied);
        const shared = new URL(url);
        const params = shared.hash.startsWith('#share=1&') ? new URLSearchParams(shared.hash.slice('#share=1&'.length)) : shared.searchParams;
        assert.equal(params.get('note'), bounded);
        const recipient = await browser.newPage({ viewport: { width, height: 900 } });
        recipient.on('pageerror', error => errors.push(error.message));
        try {
          await recipient.goto(url); await recipient.locator('.xiangqi-board').waitFor(); await recipient.keyboard.press('t'); await noteIs(recipient, bounded);
          await recipient.locator('.mtree-chip').filter({ hasText: 'h2e2' }).click(); await noteIs(recipient, bounded);
          await recipient.locator('.mtree-chip').filter({ hasText: 'h9g7' }).click(); await noteIs(recipient, preview + '🐎 develops');
          assert.equal(await recipient.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        } finally { await recipient.close(); }
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.rootComment === '中'.repeat(499));
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.keyboard.press('t'); await noteIs(page, bounded);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: `/tmp/xiangqi-unicode-limits-${browserType.name()}-${width}.png` });
        console.log(`${browserType.name()} ${width}px: bounded Chinese/emoji notes, preview, player names, UTF-8 PGN download, sharing and recovery passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
