const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function openSettings(page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Settings');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 568], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      const guide = page.getByTestId('beginner-guide');
      const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      const activate = locator => touch ? locator.tap() : locator.click();
      await guide.waitFor();
      await openSettings(page);
      const guideToggle = page.getByRole('button', { name: 'First-move guide', exact: true });
      assert.equal(await guideToggle.getAttribute('aria-pressed'), 'true');
      await activate(guideToggle);
      assert.equal(await guideToggle.getAttribute('aria-pressed'), 'false');
      await page.keyboard.press('Escape');
      assert.equal(await guide.count(), 0);
      await page.reload(); await page.locator('.xiangqi-board').waitFor();
      assert.equal(await guide.count(), 0, 'The guide setting must persist when switched off');
      await openSettings(page);
      assert.equal(await guideToggle.getAttribute('aria-pressed'), 'false');
      const interfaces = page.getByRole('group', { name: 'Interface', exact: true });
      const pro = interfaces.getByRole('button', { name: /^Pro interface,/ });
      await activate(pro); await activate(guideToggle);
      assert.equal(await guideToggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await pro.getAttribute('aria-pressed'), 'true', 'Changing guide visibility must preserve the interface preference');
      await page.keyboard.press('Escape');
      assert.equal(await guide.count(), 0, 'The guide belongs to Coach mode');
      await openSettings(page);
      await activate(interfaces.getByRole('button', { name: /^Coach interface,/ }));
      await page.keyboard.press('Escape');
      await guide.waitFor();
      await page.reload(); await guide.waitFor();
      const board = await page.locator('.xiangqi-board-container').boundingBox();
      assert.ok(board.width > (height < 500 ? 140 : 220), `Board remains usable at ${width}x${height}: ${board.width}`);
      assert.ok(Math.abs(board.width / board.height - .9) < .03, 'Board retains its aspect ratio');
      if (height < 700) {
        if (touch) assert.ok((await guide.locator('summary').boundingBox()).height >= 44, 'The collapsed guide needs a touch target');
        await guide.locator('summary').click();
      }
      if (touch) {
        for (const button of await guide.getByRole('button').all()) {
          const box = await button.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, 'Guide actions need 44px touch targets');
        }
      }
      await activate(guide.getByRole('button', { name: 'Import a game', exact: true }));
      await page.locator('#new-game-line-input').waitFor();
      await page.waitForFunction(() => document.activeElement?.id === 'new-game-line-input');
      await page.keyboard.press('Escape');
      assert.equal(await guide.getByRole('button', { name: 'Import a game', exact: true }).evaluate(element => element === document.activeElement), true,
        'Closing the import dialog must return focus to its guide action');
      await guide.getByRole('button', { name: 'Open library', exact: true }).click();
      if (width <= 900) {
        await page.getByTestId('mobile-analysis-tab-library').waitFor();
        await page.getByTestId('mobile-view-board').click();
      }
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
      // A real engine reply proves that the quick start resumes AI play.
      try {
        await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
        await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
        // Match the app's cold-start budget for WASM compilation and the 53MB
        // network; the reply itself still has its own 20-second bound.
        await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'), null, { timeout: 90000 });
        await page.waitForFunction(() => / w - - \d+ 2$/.test(document.querySelector('.bottombar-fen')?.getAttribute('title') || ''), null, { timeout: 20000 });
      } catch (error) {
        const state = await page.evaluate(() => ({ hidden: document.hidden,
          fen: document.querySelector('.bottombar-fen')?.getAttribute('title'), body: document.body.innerText.slice(-2500) }));
        await page.screenshot({ path: `/tmp/xiangqi-beginner-reply-failure-${browserType.name()}-${width}.png` });
        throw new Error(`Beginner quick start did not finish at ${width}x${height}: ${JSON.stringify(state)}`, { cause: error });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${browserType.name()} ${width}x${height}: guide actions, persistence and real AI reply passed (${touch ? 'touch' : 'fine pointer'})`);
    }
    console.log('PASS: beginner guide, letters, dismissal, and quick start at desktop/phone/short/landscape sizes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
