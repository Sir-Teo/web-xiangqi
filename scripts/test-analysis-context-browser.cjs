const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  for (const [width, height] of [[390,844],[320,568],[844,390]]) {
   const page = await browser.newPage({viewport:{width,height}, hasTouch:true});
   await page.goto(base + '?moves=h2e2');
   await page.getByTestId('mobile-view-analysis').click();
   const context = page.getByRole('button', {name:/Return to board, Black to move/});
   await context.waitFor();
   assert.equal(await context.locator('[data-square="4-2"]').getAttribute('data-piece'), 'C');
   assert.equal(await context.locator('[data-square="7-2"]').count(), 0);
   assert.equal(await context.locator('button').count(), 0);
   for (const tab of ['moves','graph','library']) {
    await page.getByTestId(`mobile-analysis-tab-${tab}`).click();
    assert.equal(await context.isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
   }
   await context.click();
   await page.locator('.board-stage').waitFor({state:'visible'});
   await page.screenshot({path:`/tmp/xiangqi-context-board-${width}.png`});
   await page.getByTestId('mobile-view-analysis').click();
   await page.getByTestId('mobile-analysis-tab-moves').click();
   await page.screenshot({path:`/tmp/xiangqi-context-${width}.png`});
   await page.close();
  }
  console.log('PASS: phone analysis retains current pieces, turn, return action, and fits all panels at three sizes');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
