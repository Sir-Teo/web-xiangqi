const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}

async function clickable(button) {
  await button.scrollIntoViewIfNeeded();
  assert.equal(await button.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, 'The visible action must receive the pointer');
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 480 }, { width: 844, height: 390 }]) {
      const page = await browser.newPage({ viewport, hasTouch: viewport.width < 900 });
      page.setDefaultTimeout(10000);
      try {
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi:recovery-draft:v1:damaged', '{broken');
          window.__refuseStorage = true;
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (window.__refuseStorage && (key === 'xiangqi:library:v1' || key.startsWith('xiangqi:recovery-draft:v1:'))) {
              if (key.startsWith('xiangqi:recovery-draft:v1:')) window.__failedDraftWrites = (window.__failedDraftWrites || 0) + 1;
              throw new DOMException('Full', 'QuotaExceededError');
            }
            return original.call(this, key, value);
          };
        });
        await page.goto(base + '?moves=h2e2%20h9g7');
        const recovery = page.getByTestId('recovery-data-error');
        await recovery.waitFor();
        await page.getByTestId('auto-save-error').waitFor();
        await command(page, 'Delete this move and what follows');
        await command(page, 'Save game');
        const failedSave = page.getByTestId('save-game-error');
        const removed = page.getByTestId('delete-undo-toast');
        await failedSave.waitFor();
        let normalErrorFont;
        for (const size of ['16px', '32px']) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size; }, size);
          const font = await recovery.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          if (size === '16px') normalErrorFont = font;
          else assert.equal(font, normalErrorFont * 2, 'Error text must respect enlarged reader text');
          const boxes = await Promise.all([recovery, failedSave, removed].map(notice => notice.boundingBox()));
          for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
            assert.ok(boxes[a].y + boxes[a].height <= boxes[b].y || boxes[b].y + boxes[b].height <= boxes[a].y,
              'Save errors, recovery warnings, and Undo must not cover each other');
          }
          for (const box of boxes) assert.ok(box.x >= 0 && box.x + box.width <= viewport.width);
          await clickable(recovery.getByRole('button', { name: 'Download recovery data', exact: true }));
          await clickable(failedSave.getByRole('button', { name: 'Open library', exact: true }));
          await clickable(page.getByTestId('delete-undo-btn'));
        }
        await page.screenshot({ path: `/tmp/xiangqi-notice-stack-${browserType.name()}-${viewport.width}.png` });
        const failedWrites = await page.evaluate(() => window.__failedDraftWrites);
        await page.getByTestId('delete-undo-btn').click();
        // Wait for the restored position's debounced write to fail before
        // unblocking storage, so an automatic retry cannot race our click.
        await page.waitForFunction(count => window.__failedDraftWrites > count, failedWrites);

        // Notifications must stay behind the command dialog, including when
        // their combined height needs scrolling on a short phone screen.
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Settings');
        await clickable(page.locator('[data-command-id="settings"] button'));
        await page.keyboard.press('Escape');
        const download = page.waitForEvent('download');
        await recovery.getByRole('button', { name: 'Download recovery data', exact: true }).click();
        const data = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
        assert.equal(data.find(copy => copy.draftId === 'damaged').raw, '{broken');
        await failedSave.getByRole('button', { name: 'Dismiss save error', exact: true }).click();
        await page.getByTestId('auto-save-error').waitFor();
        await page.evaluate(() => { window.__refuseStorage = false; });
        await page.getByRole('button', { name: 'Retry autosave', exact: true }).click();
        await page.getByTestId('auto-save-error').waitFor({ state: 'hidden' });
        assert.equal(await recovery.isVisible(), true, 'A successful retry must retain the independent recovery warning');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        console.log(`${browserType.name()} ${viewport.width}x${viewport.height}: independent errors and Undo stack at 100/200% text; downloads, autosave retry and dialog layering work`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
