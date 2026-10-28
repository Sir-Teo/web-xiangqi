const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base);
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        const longNote = 'A quiet plan with room to improve. '.repeat(12) + 'Needle at the very end. 中炮 🐎';
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        const moves = Array.from({ length: 26 }, (_, index) => `${cycle[index % 4]} {Plan ${index + 1}}`).join(' ');
        await page.getByTestId('uci-line-input').fill(`{${longNote}} ${moves} *`);
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await command(page, 'Find study notes');
        const search = page.locator('#study-notes-search');
        await page.waitForFunction(() => document.activeElement?.id === 'study-notes-search');
        const finder = page.getByTestId('study-notes');
        const results = finder.locator('.study-note-result');
        const oneStop = async () => assert.equal(await finder.locator('.study-note-result[tabindex="0"]').count(), 1);
        const focused = async index => assert.equal(await results.nth(index).evaluate(element => element === document.activeElement), true);
        assert.equal(await results.count(), 20);
        await oneStop();
        await search.press('ArrowDown');
        await focused(0);
        await page.keyboard.press('ArrowDown');
        await focused(1);
        await page.keyboard.press('End');
        await focused(19);
        await page.keyboard.press('ArrowDown');
        await focused(19);
        await page.keyboard.press('Home');
        await focused(0);
        await page.keyboard.press('ArrowUp');
        await focused(0);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('move-comment-input')?.value === 'Plan 1');
        await results.nth(1).getByText('Current position', { exact: true }).waitFor();
        assert.equal(await results.nth(1).getAttribute('aria-current'), 'location');
        const note = await page.getByTestId('move-comment-input').inputValue();
        await page.keyboard.press('End');
        await focused(19);
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), note, 'Browsing results must not change the board');
        await page.keyboard.press('Tab');
        assert.equal(await page.getByRole('button', { name: 'Show 7 more notes', exact: true }).evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Shift+Tab');
        await focused(19);
        await oneStop();
        for (const target of [search, results.nth(19)]) {
          await target.focus();
          for (const flags of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
            const state = await target.evaluate((element, flags) => {
              const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true, ...flags });
              if (flags.prePrevented) event.preventDefault();
              element.dispatchEvent(event);
              return { retained: document.activeElement === element, prevented: event.defaultPrevented };
            }, flags);
            assert.deepEqual(state, { retained: true, prevented: !!flags.prePrevented });
          }
        }
        await search.fill('NEEDLE 中炮 🐎');
        assert.equal(await results.count(), 1);
        assert.deepEqual(await results.locator('mark').allTextContents(), ['Needle', '中炮', '🐎']);
        await oneStop();
        for (const fontSize of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, fontSize);
          await results.first().scrollIntoViewIfNeeded();
          const preview = await results.first().locator('.study-note-preview').evaluate(element => {
            const box = element.getBoundingClientRect();
            return { visible: [...element.querySelectorAll('mark')].every(mark => {
                const match = mark.getBoundingClientRect();
                return match.bottom <= box.bottom + 1 && match.top >= box.top - 1;
              }),
              fits: document.documentElement.scrollWidth <= innerWidth + 1 };
          });
          assert.deepEqual(preview, { visible: true, fits: true }, 'Search matches at the end of long notes must remain visible at 200% text size');
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
        await search.press('Escape');
        assert.equal(await search.inputValue(), '');
        assert.equal(await results.locator('mark').count(), 0, 'Clearing the query removes old highlights');
        await search.press('ArrowUp');
        await focused(19);
        await page.getByRole('button', { name: 'Show 7 more notes', exact: true }).click();
        assert.equal(await results.count(), 27);
        await focused(20);
        await oneStop();
        await search.fill('Plan 26');
        assert.equal(await results.count(), 1);
        await oneStop();
        if (width === 1440 && browserType.name() === 'chromium') {
          await page.emulateMedia({ forcedColors: 'active' });
          const colors = await results.locator('mark').first().evaluate(mark => {
            const style = getComputedStyle(mark);
            return { foreground: style.color, background: style.backgroundColor };
          });
          assert.notEqual(colors.foreground, colors.background, 'Highlighted words remain readable in forced colors');
          assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)');
          await page.emulateMedia({ forcedColors: 'none' });
        }
        await finder.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/xiangqi-note-highlights-${browserType.name()}-${width}.png` });
        await search.press('Tab');
        assert.equal(await finder.getByRole('button', { name: 'Clear note search' }).evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Tab');
        await focused(0);
        await search.fill('no matching note');
        await search.press('ArrowDown');
        assert.equal(await search.evaluate(element => element === document.activeElement), true);
        assert.equal(await results.count(), 0);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: one result tab stop, keyboard browsing, pagination focus and long matching notes at 200% text size passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
