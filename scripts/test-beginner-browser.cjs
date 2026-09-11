const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 568], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      const guide = page.getByTestId('beginner-guide');
      await guide.waitFor();
      const board = await page.locator('.xiangqi-board-container').boundingBox();
      assert.ok(board.width > (height < 500 ? 140 : 220), `Board remains usable at ${width}x${height}: ${board.width}`);
      assert.ok(Math.abs(board.width / board.height - .9) < .03, 'Board retains its aspect ratio');
      if (height < 700) await guide.locator('summary').click();
      await guide.getByRole('button', { name: 'Letter pieces' }).click();
      assert.equal(await guide.getByRole('button', { name: 'Letter pieces' }).getAttribute('aria-pressed'), 'true');
      assert.ok(await page.locator('.piece').filter({ hasText: /^K$/ }).count());
      await page.screenshot({ path: `/tmp/xiangqi-beginner-${browserType.name()}-${width}.png` });
      await guide.getByRole('button', { name: 'Dismiss first-move guide' }).click();
      await page.reload();
      await page.locator('.piece').first().waitFor();
      assert.equal(await guide.count(), 0, 'Dismissal persists');
      await page.evaluate(() => localStorage.removeItem('xiangqi:beginner-guide-dismissed:v1'));
      await page.reload();
      await guide.waitFor();
      if (height < 700) await guide.locator('summary').click();
      await guide.getByRole('button', { name: 'Play Beginner' }).click();
      await guide.waitFor({ state: 'detached' });
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:preferences:v1'))?.aiStrength === 1);
      await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
      await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
      // A real engine reply proves that the quick start resumes AI play.
      await page.waitForFunction(() => / w - - \d+ 2$/.test(document.querySelector('.bottombar-fen')?.getAttribute('title') || ''), null, { timeout: 20000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: beginner guide, letters, dismissal, and quick start at desktop/phone/short/landscape sizes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
