const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const solutions = ['a4a7', 'e4g5', 'e4e8', 'c4a2', 'd0e1', 'e0f0', 'e5d5', 'e5e6', 'e7e8'];
const progressKey = 'xiangqi:rule-lessons:v1';
async function openCommand(page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Learn the rules');
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 640], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const tab = reverse => page.keyboard.press(`${browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}${reverse ? 'Shift+' : ''}Tab`);
      try {
        await page.goto(base);
        const guide = page.getByTestId('beginner-guide'); await guide.waitFor();
        if (height < 700) await guide.locator('summary').click();
        const launch = guide.getByRole('button', { name: 'Learn the rules' });
        await launch.click();
        const dialog = page.getByTestId('rule-lessons'); await dialog.waitFor();
        const select = dialog.getByTestId('lesson-select');
        const square = point => dialog.locator(`.hitbox[data-file="${point.charCodeAt(0) - 97}"][data-rank="${point[1]}"]`);
        const feedback = dialog.getByTestId('lesson-feedback');
        assert.equal(await dialog.getByRole('button', { name: 'Close rule lessons' }).evaluate(node => document.activeElement === node), true);
        await tab(true);
        assert.equal(await dialog.getByRole('button', { name: 'Back to your board' }).evaluate(node => document.activeElement === node), true);
        await tab(false);
        assert.equal(await dialog.getByRole('button', { name: 'Close rule lessons' }).evaluate(node => document.activeElement === node), true);
        assert.equal(await dialog.locator('.hitbox[tabindex="0"]').count(), 1);
        await page.keyboard.press('ControlOrMeta+k');
        assert.equal(await page.getByRole('combobox', { name: 'Search commands' }).count(), 0, 'Commands must not open another modal over a lesson');
        assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const board = await dialog.locator('.xiangqi-board-container').boundingBox();
        assert.ok(board.width > 220 && Math.abs(board.width / board.height - .9) < .03, 'Practice board must retain usable size and shape');
        assert.equal(await dialog.locator('button:not(.hitbox)').evaluateAll(nodes => nodes.every(node => { const box = node.getBoundingClientRect(); return box.width >= 44 && box.height >= 44; })), true);
        await dialog.evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({ path: `/tmp/xiangqi-rule-lessons-${browserType.name()}-${width}.png` });

        await square('a5').click();
        assert.match(await feedback.textContent(), /That move is legal/);
        assert.match(await square('a4').getAttribute('aria-label'), /red chariot/);
        for (let i = 0; i < solutions.length; i++) {
          assert.equal(await select.inputValue(), String(i));
          if (i > 0) assert.equal(await square(solutions[i].slice(0, 2)).getAttribute('tabindex'), '0', 'Each lesson should enter the board at its selected exercise piece');
          if (i === 1) {
            await square('f6').click();
            assert.match(await feedback.textContent(), /leg is blocked/);
            assert.equal(await feedback.getAttribute('data-solved'), 'false');
            const hintButton = dialog.getByRole('button', { name: 'Show hint' });
            assert.equal(await hintButton.getAttribute('aria-expanded'), 'false');
            await hintButton.focus(); await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.querySelector('[data-testid="lesson-feedback"]')?.textContent.includes('Hint:'));
            assert.equal(await hintButton.getAttribute('aria-expanded'), 'true');
            assert.equal(await hintButton.getAttribute('aria-controls'), await feedback.getAttribute('id'));
            assert.match(await feedback.innerText(), /The first step toward g5 is f4/, 'Revealed hints must update the live feedback region');
            assert.match(await square('g5').getAttribute('aria-label'), /highlighted/);
            await dialog.getByRole('button', { name: 'Letter pieces' }).click();
            assert.ok(await dialog.locator('.piece').filter({ hasText: /^H$/ }).count());
          }
          // Native keyboard activation also exercises app-shortcut isolation.
          await square(solutions[i].slice(2)).focus(); await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.querySelector('[data-testid="lesson-feedback"]')?.getAttribute('data-solved') === 'true');
          await page.waitForFunction(() => {
            const result = document.querySelector('[data-testid="lesson-feedback"]').getBoundingClientRect();
            const modal = document.querySelector('[data-testid="rule-lessons"]').getBoundingClientRect();
            return result.top >= modal.top && result.bottom <= modal.bottom;
          });
          assert.equal(await dialog.getByTestId('lesson-progress').textContent(), `${i + 1} of 9 completed`);
          if (i < solutions.length - 1) {
            await dialog.getByRole('button', { name: 'Next lesson' }).click();
            assert.equal(await select.evaluate(node => node === document.activeElement), true, 'Next lesson must retain useful keyboard focus');
          }
        }
        assert.match(await feedback.textContent(), /Black is not in check, but has no legal move/);
        await dialog.getByRole('button', { name: 'Try again' }).click();
        assert.equal(await feedback.getAttribute('data-solved'), 'false');
        assert.equal(await dialog.getByTestId('lesson-progress').textContent(), '9 of 9 completed');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await launch.evaluate(node => document.activeElement === node), true, 'Closing lessons should restore launcher focus');
        assert.equal(await page.locator('.xiangqi-board .piece').count(), 32, 'Practice changed the main game');
        await page.reload(); await page.getByTestId('beginner-guide').waitFor(); await openCommand(page); await dialog.waitFor();
        assert.equal(await dialog.getByTestId('lesson-progress').textContent(), '9 of 9 completed');
        await page.keyboard.press('Escape');

        // A study loaded from a share link must survive practice and persistence.
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => document.querySelector('.bottombar-fen')?.getAttribute('title')?.includes('1C2C4'));
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await openCommand(page); await dialog.waitFor();
        await select.selectOption('0'); await square('a7').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="lesson-feedback"]')?.getAttribute('data-solved') === 'true');
        await dialog.getByRole('button', { name: 'Back to your board' }).click();
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        await page.keyboard.press('t');
        await page.locator('.mtree-chip').first().waitFor();
        assert.equal(await page.locator('.mtree-chip').count(), 1);

        // A quota error must announce the failure and preserve session progress.
        await page.evaluate(key => {
          localStorage.removeItem(key);
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError'); return original.call(this, name, value); };
        }, progressKey);
        await openCommand(page); await dialog.waitFor(); await square('a7').click();
        await dialog.getByRole('alert').waitFor();
        assert.equal(await dialog.getByTestId('lesson-progress').textContent(), '1 of 9 completed');
        await dialog.getByRole('button', { name: 'Next lesson' }).click(); await square('g5').click();
        assert.equal(await dialog.getByTestId('lesson-progress').textContent(), '2 of 9 completed');
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Draw the pieces as letters');
        await page.keyboard.press('Enter');
        const mainBoard = page.locator('.xiangqi-board').first();
        assert.equal(await mainBoard.locator('.piece-letter').count(), 32);
        await openCommand(page); await dialog.waitFor();
        const letters = dialog.getByRole('button', { name: 'Letter pieces' });
        assert.equal(await letters.getAttribute('aria-pressed'), 'true', 'Lessons must use the chosen piece style');
        assert.equal(await dialog.locator('.piece:not(.piece-letter)').count(), 0);
        await letters.click();
        assert.equal(await dialog.locator('.piece-letter').count(), 0);
        await page.keyboard.press('Escape');
        assert.equal(await mainBoard.locator('.piece-letter').count(), 32, 'Lesson toggles must preserve the board preference');
        await openCommand(page); await dialog.waitFor();
        assert.equal(await letters.getAttribute('aria-pressed'), 'true', 'Reopened lessons must follow the board preference');
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: nine solutions, hints, illegal moves, keyboard/focus, persistence, storage failure, piece preference, game isolation and responsive layout passed at ${width}x${height}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
