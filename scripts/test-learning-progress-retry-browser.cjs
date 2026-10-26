const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const command = async (page, name) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(name);
  await page.keyboard.press('Enter');
};
const activate = async (page, button) => { await button.focus(); await page.keyboard.press('Enter'); };
async function checkNotice(page, notice) {
  const retry = notice.getByRole('button', { name: 'Retry saving progress', exact: true });
  const initialFont = await retry.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  try {
    for (const size of [16, 32]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, size);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Resize before scrolling. WebKit's actionability wait can keep tracking
      // a focused control through font reflow; verify its actual hit target.
      await retry.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(Math.abs(await retry.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) - initialFont * size / 16) < 0.1,
        'Retry labels must grow with enlarged text');
      assert.equal(await notice.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'Save feedback must wrap at enlarged text');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.equal(await retry.evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44 && node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), true, 'Retry must remain a reachable touch target');
      const clipped = await notice.evaluate(node => [...node.closest('[role="dialog"]').querySelectorAll('button:not(.hitbox)')]
        .filter(button => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1)
        .map(button => button.getAttribute('aria-label') || button.textContent));
      assert.deepEqual(clipped, [], 'Enlarged dialog controls must keep their contents inside their targets');
      if (page.viewportSize().width < 900) {
        const before = await page.evaluate(() => window.__progressWriteAttempts);
        const box = await retry.boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(before => window.__progressWriteAttempts === before + 1, before, { timeout: 5000 });
      }
    }
  } catch (error) {
    await page.screenshot({ path: `/tmp/xiangqi-learning-notice-${browserType.name()}-${page.viewportSize().width}-failure.png` }).catch(() => {});
    throw error;
  } finally { await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; }); }
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 900 });
      try {
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'retry-progress', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] },
          ]));
          window.__progressWritesAllowed = false;
          window.__progressWriteAttempts = 0;
          const setItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (['xiangqi:rule-lessons:v1', 'xiangqi:practice-progress:v1'].includes(key)) {
              window.__progressWriteAttempts++;
              if (!window.__progressWritesAllowed) throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            return setItem.call(this, key, value);
          };
        });
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Learn the rules');
        const lessons = page.getByTestId('rule-lessons');
        await lessons.locator('.hitbox[data-file="0"][data-rank="7"]').click();
        await lessons.getByRole('alert').waitFor();
        const lessonRetry = lessons.getByRole('button', { name: 'Retry saving progress', exact: true });
        assert.equal(await lessonRetry.count(), 1, 'Failed lesson progress should offer a retry');
        await lessons.getByRole('button', { name: 'Next lesson', exact: true }).click();
        await activate(page, lessonRetry);
        await page.waitForFunction(() => document.querySelector('[data-testid="lesson-progress-save"]')?.textContent.includes('still'));
        assert.equal(await lessonRetry.evaluate(node => node === document.activeElement), true, 'A failed retry must keep keyboard focus');
        await checkNotice(page, page.getByTestId('lesson-progress-save'));
        await page.evaluate(() => {
          window.__progressWritesAllowed = true;
          localStorage.setItem('xiangqi:rule-lessons:v1', JSON.stringify(['cannon']));
        });
        await activate(page, lessonRetry);
        await lessons.getByRole('status').filter({ hasText: 'Lesson progress saved' }).waitFor();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:rule-lessons:v1'))), ['chariot', 'cannon']);
        assert.equal(await lessons.getByTestId('lesson-feedback').getAttribute('data-solved'), 'false', 'Retry must not complete the open horse lesson');
        assert.equal(await lessons.locator('.hitbox[tabindex="0"]').evaluate(node => node === document.activeElement), true);
        await page.evaluate(() => { window.__progressWritesAllowed = false; });
        await lessons.locator('.hitbox[data-file="6"][data-rank="5"]').click();
        await lessons.getByRole('alert').waitFor();
        await page.evaluate(() => { window.__progressWritesAllowed = true; });
        await activate(page, lessonRetry);
        await lessons.getByRole('status').filter({ hasText: 'Lesson progress saved' }).waitFor();
        assert.equal(await lessons.getByRole('button', { name: 'Next lesson', exact: true }).evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('Escape');
        await command(page, 'Learn the rules');
        assert.equal(await lessons.getByTestId('lesson-progress').innerText(), '3 of 9 completed');
        await page.keyboard.press('Escape');

        await page.evaluate(() => { window.__progressWritesAllowed = false; });
        await command(page, 'Library');
        const open = page.getByTestId('practice-saved-retry-progress');
        await open.click();
        const practice = page.getByTestId('study-practice-dialog');
        for (const [file, rank] of [[7, 2], [4, 2]]) await practice.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        await practice.getByRole('button', { name: 'Play saved reply', exact: true }).click();
        const progress = practice.getByTestId('study-practice-progress');
        const recall = practice.getByTestId('study-practice-recall');
        assert.match(await progress.innerText(), /1 of 1/); assert.match(await recall.innerText(), /1 of 1/);
        const practiceRetry = practice.getByRole('button', { name: 'Retry saving progress', exact: true });
        await activate(page, practiceRetry);
        await page.waitForFunction(() => document.querySelector('[data-testid="practice-progress-save"]')?.textContent.includes('still'));
        assert.equal(await practiceRetry.evaluate(node => node === document.activeElement), true);
        await checkNotice(page, page.getByTestId('practice-progress-save'));
        await page.evaluate(() => { window.__progressWritesAllowed = true; });
        await activate(page, practiceRetry);
        await practice.getByRole('status').filter({ hasText: 'Practice progress saved' }).waitFor();
        assert.equal(await practice.getByRole('button', { name: 'Practice again', exact: true }).evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('Escape'); await open.click();
        assert.match(await progress.innerText(), /1 of 1/); assert.match(await recall.innerText(), /1 of 1/);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
        console.log(`${browserType.name()} ${width}px: lesson/practice save retries retain focus and scores, merge completed lessons, preserve unsolved exercises, and fit at 100/200% text`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-learning-progress-retry-${browserType.name()}-${width}-failure.png` });
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
