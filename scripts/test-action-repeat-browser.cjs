const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base + '?moves=h2e2,h9g7');
    const board = page.locator('.xiangqi-board-container');
    await board.waitFor();
    await page.keyboard.down('f');
    await page.keyboard.down('f');
    await page.keyboard.down('f');
    await page.keyboard.up('f');
    assert.equal(await board.getAttribute('data-orientation'), 'black');
    await page.keyboard.press('f');
    assert.equal(await board.getAttribute('data-orientation'), 'red');
    await page.keyboard.down('Control');
    await page.keyboard.down('k');
    await page.keyboard.down('k');
    await page.keyboard.up('k');
    await page.keyboard.up('Control');
    await page.getByRole('combobox').waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.up('ArrowLeft');
    assert.match(await page.locator('.wc-meta').innerText(), /START\s*\/\s*2/);
    await page.close();
    console.log('PASS: held action keys fire once; held navigation keys continue stepping');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
