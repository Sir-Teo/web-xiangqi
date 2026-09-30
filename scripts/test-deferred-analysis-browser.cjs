const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const requested = [];
  page.on('request', r => requested.push(r.url()));
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route(/\/CommandPaletteModal[^/]*\.(tsx|js)(\?|$)/, async route => { await gate; await route.continue(); });
  await page.goto(base);
  const square = page.locator('.board-stage .hitbox[tabindex="0"]').first(); await square.focus();
  assert.equal(requested.some(url => /\/(CommandPaletteModal|CandidatePanel|EvalGraph)[^/]*\.(tsx|js)/.test(url)), false);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('dialog-load').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('dialog-load').waitFor({ state: 'hidden' });
  assert.equal(await square.evaluate(el => el === document.activeElement), true);
  release();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Go to start');
  await page.keyboard.press('Enter');
  await page.getByRole('combobox').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.xiangqi-board').count(), 1);
  await page.close();
  console.log('PASS: optional panels are absent from initial phone requests; pending commands cancel, restore focus and reopen successfully');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
