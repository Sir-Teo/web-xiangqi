const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 8 12';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      try {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {
            if (window.__copyDenied) throw new Error('Clipboard denied');
            if (window.__holdCopy) await new Promise((resolve, reject) => { window.__releaseCopy = resolve; window.__rejectCopy = reject; });
          } } });
          document.execCommand = () => false;
        });
        await page.goto(base);
        await page.locator('.xiangqi-board').waitFor();
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox').fill('Set up a position');
        await page.keyboard.press('Enter');
        // The lazy dialog's mount effect focuses its first brush. Let that
        // finish before fill() focuses the field and sends keyboard input.
        await page.waitForFunction(() => document.activeElement?.matches('[data-editor-first]'));
        await page.evaluate(() => document.fonts.ready);
        const field = page.getByTestId('editor-fen');
        const done = page.getByTestId('editor-done');
        const copy = page.getByTestId('editor-fen-copy');
        await page.evaluate(() => { window.__copyDenied = true; });
        await copy.click(); await page.getByTestId('editor-fen-notice').waitFor();
        assert.match(await page.getByTestId('editor-fen-notice').innerText(), /clipboard refused/i);
        assert.equal(await field.getAttribute('aria-invalid'), null, 'A clipboard denial must not describe a valid FEN as invalid');
        assert.equal(await field.getAttribute('aria-describedby'), 'board-editor-fen-notice');
        await page.evaluate(() => { window.__copyDenied = false; });
        await copy.click(); await copy.filter({ hasText: 'Copied' }).waitFor();
        await page.evaluate(() => { window.__holdCopy = true; });
        await copy.click(); await page.waitForFunction(() => typeof window.__rejectCopy === 'function');
        assert.equal(await copy.innerText(), 'Copy', 'A pending editor copy must clear its old success badge');
        await page.evaluate(() => { window.__holdCopy = false; });
        await copy.click(); await copy.filter({ hasText: 'Copied' }).waitFor();
        await page.evaluate(() => window.__rejectCopy(new Error('Old editor clipboard denial')));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await copy.innerText(), 'Copied', 'An old editor-copy failure must preserve the newer success');
        assert.equal(await page.getByTestId('editor-fen-notice').count(), 0);
        await page.getByTestId('editor-side-black').click();
        assert.equal(await copy.innerText(), 'Copy', 'Editing the position must clear its old copy badge');
        await page.evaluate(() => { window.__holdCopy = true; window.__releaseCopy = undefined; });
        await copy.click(); await page.waitForFunction(() => typeof window.__releaseCopy === 'function');
        const invalidFen = fen.replace('8 12', '-1 12');
        await field.fill(invalidFen);
        assert.equal(await field.inputValue(), invalidFen, 'The invalid draft must reach the field before Done');
        await done.click();
        await page.getByTestId('editor-fen-notice').waitFor();
        assert.match(await page.getByTestId('editor-fen-notice').innerText(), /halfmove clock/i);
        assert.equal(await field.getAttribute('aria-invalid'), 'true', 'A malformed FEN must still be described as invalid');
        assert.equal(await page.getByTestId('board-editor').isVisible(), true);
        assert.equal(await field.inputValue(), invalidFen, 'Validation must retain the invalid draft');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen);
        await page.evaluate(() => { window.__holdCopy = false; window.__releaseCopy(); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.match(await page.getByTestId('editor-fen-notice').innerText(), /halfmove clock/i, 'A delayed copy must preserve newer validation feedback');
        assert.equal(await copy.innerText(), 'Copy');

        await page.getByTestId('editor-clear').click();
        await field.fill(fen);
        assert.equal(await field.inputValue(), fen, 'The corrected draft must reach the field before Done');
        await done.click();
        await page.getByTestId('board-editor').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        console.log(`${browserType.name()} ${width}px: pending FEN validation, retained draft and side/clocks passed`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-editor-pending-fen-${browserType.name()}-${width}.png` }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
