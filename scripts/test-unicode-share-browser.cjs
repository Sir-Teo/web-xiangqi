const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const study = [{ uci: 'h2e2', comment: '中炮：先出車 🐎', children: [
  { uci: 'h9g7', comment: 'Défense — 将军' },
  { uci: 'b9c7', comment: '另一种选择' },
] }];

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill(label);
  await page.keyboard.press('Enter');
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = [];
      try {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: async text => { window.__copied = text; } } });
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(moveTree => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'unicode-study', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], moveTree },
        ])), study);
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library');
        await page.getByTestId('load-saved-unicode-study').click();
        await command(page, 'Copy link');
        const copied = await page.evaluate(() => window.__copied);
        assert.ok(copied, 'Sharing a small Unicode study failed');
        assert.ok(new URL(copied).searchParams.has('tree'), 'The shared URL lost the annotated tree');
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moves.length === 1);

        // A new page consumes only the URL; it has no in-memory study to fall back to.
        const recipient = await context.newPage();
        recipient.on('pageerror', error => errors.push(error.message));
        await recipient.goto(copied);
        await recipient.getByRole('button', { name: "Keep the link's game", exact: true }).click();
        await recipient.keyboard.press('t');
        await recipient.waitForFunction(note => document.querySelector('[data-testid="move-comment-input"]')?.value === note, study[0].comment);
        assert.equal(await recipient.getByTestId('move-comment-input').inputValue(), study[0].comment);
        assert.equal(await recipient.locator('.bottombar-fen').getAttribute('title'), fen);
        assert.equal(await recipient.locator('.mtree-chip').count(), 3);
        await command(recipient, 'Save game');
        const saved = await recipient.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.deepEqual(saved.moveTree, study, 'Opening the share link lost a branch or changed its note');
        assert.equal(await recipient.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await recipient.screenshot({ path: `/tmp/xiangqi-unicode-share-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(`Chinese/emoji study sharing, recipient notes, branches, save and layout passed at ${width}px`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
