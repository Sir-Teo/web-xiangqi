const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      const read = File.prototype.arrayBuffer;
      window.pendingFiles = {};
      File.prototype.arrayBuffer = function() {
        return new Promise((resolve, reject) => { window.pendingFiles[this.name] = fail => fail ? reject(new Error('Old failure')) : read.call(this).then(resolve); });
      };
    });
    await page.goto(base);
    const open = () => page.getByRole('button', { name: 'Start new game', exact: true }).click();
    await open();
    const file = name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name === 'new.pgn' ? 'b2e2' : 'h2e2') });
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(file('old.pgn'));
    await input.setInputFiles(file('new.pgn'));
    await page.evaluate(() => window.pendingFiles['new.pgn']());
    await page.waitForFunction(() => document.querySelector('#new-game-line-input').value === 'b2e2');
    await page.evaluate(() => window.pendingFiles['old.pgn']());
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), 'b2e2');
    await input.setInputFiles(file('closing.pgn'));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.pendingFiles['closing.pgn'](true));
    await open();
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), '');
    assert.equal(await page.locator('#new-game-line-error').count(), 0);
    await input.setInputFiles(file('typing.pgn'));
    await page.getByTestId('uci-line-input').fill('b0c2');
    await page.evaluate(() => window.pendingFiles['typing.pgn']());
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), 'b0c2');
    await page.close();
    console.log('PASS: stale file success/failure cannot overwrite a newer file, a closed dialog, or typed input');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
