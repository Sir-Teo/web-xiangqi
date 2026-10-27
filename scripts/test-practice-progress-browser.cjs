const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 844 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'progress', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] },
        ])));
        const open = async () => {
          await page.locator('.xiangqi-board').waitFor();
          await page.keyboard.press('ControlOrMeta+k');
          await page.getByRole('combobox').fill('Library'); await page.keyboard.press('Enter');
          await page.getByTestId('practice-saved-progress').click();
          await page.getByTestId('study-practice-progress').waitFor();
        };
        await page.goto(base); await open();
        const dialog = page.getByTestId('study-practice-dialog');
        const progress = dialog.getByTestId('study-practice-progress');
        const reset = dialog.getByRole('button', { name: 'Reset progress for this side', exact: true });
        const undo = dialog.getByRole('button', { name: 'Undo reset', exact: true });
        const reply = dialog.getByRole('button', { name: 'Play saved reply', exact: true });
        const position = () => dialog.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
        const playRed = async () => {
          for (const [file, rank] of [[7, 2], [4, 2]]) await dialog.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        };
        const library = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        await playRed(); await reply.waitFor(); await page.reload(); await open();
        const midway = await position();
        await reset.click(); await undo.click();
        assert.deepEqual(await position(), midway, 'Undo must restore the exact position partway through a line');
        assert.equal(await reply.evaluate(node => node === document.activeElement), true, 'Undo must focus the restored reply action');
        await reply.click();
        await page.waitForFunction(() => document.querySelector('[data-testid="study-practice-progress"]').textContent.startsWith('1 of 1'));
        await dialog.getByRole('combobox', { name: 'Practice as' }).selectOption('b');
        assert.match(await progress.innerText(), /0 of 1/);
        await reply.click();
        await dialog.getByRole('button', { name: 'Show a saved move', exact: true }).click();
        for (const [file, rank] of [[7, 9], [6, 7]]) await dialog.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        assert.match(await progress.innerText(), /1 of 1/);
        assert.match(await dialog.getByTestId('study-practice-recall').innerText(), /0 of 1/);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.b?.completed.length === 1);
        const blackProgress = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.b);
        await dialog.getByRole('combobox', { name: 'Practice as' }).selectOption('w');
        assert.match(await progress.innerText(), /1 of 1/);
        const completed = await position();
        await page.evaluate(async () => { document.documentElement.style.fontSize = '32px'; await document.fonts.ready; });
        await reset.focus(); await page.keyboard.press('Enter');
        assert.equal(await reset.evaluate(node => node === document.activeElement), true, 'Reset must keep keyboard focus beside Undo');
        assert.match(await progress.innerText(), /0 of 1/);
        assert.ok(await undo.evaluate(node => node.getBoundingClientRect().height >= 44));
        assert.equal(await undo.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        // Repeating Reset must keep the original recovery snapshot.
        await reset.click(); await undo.click();
        assert.deepEqual(await position(), completed);
        assert.match(await progress.innerText(), /1 of 1/);
        assert.match(await dialog.getByTestId('study-practice-recall').innerText(), /1 of 1/);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.w.completed.length === 1);
        await page.reload(); await open();
        assert.match(await progress.innerText(), /1 of 1/, 'Restored progress must survive reload');
        await page.evaluate(async () => { document.documentElement.style.fontSize = '32px'; await document.fonts.ready; });
        await reset.click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.w.completed.length === 0);
        await page.evaluate(() => {
          window.__practiceStorageSet = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key === 'xiangqi:practice-progress:v1') throw new DOMException('Full', 'QuotaExceededError');
            return window.__practiceStorageSet.call(this, key, value);
          };
        });
        await undo.focus(); await page.keyboard.press('Enter');
        assert.match(await progress.innerText(), /1 of 1/, 'A storage failure must preserve restored progress in memory');
        await dialog.getByTestId('practice-progress-save').waitFor();
        const again = dialog.getByRole('button', { name: 'Practice again', exact: true });
        assert.equal(await again.evaluate(node => node === document.activeElement), true);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await again.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), true, 'Restoring progress must reveal its focused next action even when storage fails');
        await page.evaluate(() => { Storage.prototype.setItem = window.__practiceStorageSet; });
        await dialog.getByRole('button', { name: 'Retry saving progress', exact: true }).click();
        await reset.click();
        await dialog.getByRole('combobox', { name: 'Practice as' }).selectOption('b');
        assert.equal(await undo.count(), 0, 'Changing sides must dismiss the previous side’s reset recovery');
        assert.match(await progress.innerText(), /1 of 1/, 'Resetting Red must preserve Black’s independent progress');
        assert.match(await dialog.getByTestId('study-practice-recall').innerText(), /0 of 1/, 'Red reset recovery must preserve Black’s assisted score');
        await dialog.getByRole('combobox', { name: 'Practice as' }).selectOption('w');
        await reset.click(); await playRed();
        assert.equal(await undo.count(), 0, 'Starting another saved move must dismiss the old reset recovery');
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.b), blackProgress);
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), library, 'Practice recovery must preserve the saved study');
        console.log(`${browserType.name()} ${width}px: practice reload, independent sides, reset/undo positions and scores, repeated resets, enlarged text, storage recovery and resumed practice passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
