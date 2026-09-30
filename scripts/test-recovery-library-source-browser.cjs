const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(base + '?moves=h2e2');
    await page.getByTestId('save-game-btn').click();
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0].id);
    await page.locator('.hitbox[data-file="7"][data-rank="9"]').click();
    await page.locator('.hitbox[data-file="6"][data-rank="7"]').click();
    await page.waitForFunction(id => {
      const draft = JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null');
      return draft?.sourceLibrary?.id === id && draft.game.moves.length === 2;
    }, id);
    await page.reload();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Update saved study');
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => {
      const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
      return games.length === 1 && games[0].id === id && games[0].moves.length === 2;
    }, id);
    assert.equal(await page.getByRole('dialog', { name: 'Commands' }).count(), 0);
    await page.close();
    console.log('PASS: recovery updates the original library study instead of creating a duplicate');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
