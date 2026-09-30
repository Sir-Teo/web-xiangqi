const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const command = async (page,label) => {await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('combobox').fill(label);await page.keyboard.press('Enter');};
(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440,390,320]) {
   const page = await browser.newPage({viewport:{width,height:844}});
   await page.goto(base+'?moves=h2e2+h9g7'); await page.locator('.xiangqi-board').waitFor();
   const status=page.getByTestId('study-save-status');
   assert.match(await status.textContent(),/Unsaved study/); await status.click();
   await page.waitForFunction(()=>document.querySelector('[data-testid="study-save-status"]').textContent.includes('Saved study'));
   await command(page,'Go to start');
   await page.waitForTimeout(200); assert.match(await status.textContent(),/Saved study/);
   await command(page,'Move tree');
   await page.getByTestId('move-comment-input').fill('New root note');
   await page.waitForFunction(()=>document.querySelector('[data-testid="study-save-status"]').textContent.includes('Modified study'));
   await status.click();
   await page.waitForFunction(()=>document.querySelector('[data-testid="study-save-status"]').textContent.includes('Saved study'));
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0].rootComment),'New root note');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.close();
  }
  console.log('PASS: save indicator tracks save, navigation, pending notes and updates at three widths');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
