const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440,390,320]) {
   const page = await browser.newPage({viewport:{width,height:844}});
   await page.goto(base); await page.locator('.xiangqi-board').waitFor();
   const before = await page.locator('.xiangqi-board').boundingBox();
   await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('combobox').fill('Settings'); await page.keyboard.press('Enter');
   await page.locator('#settings-ui-density').selectOption('comfortable');
   await page.waitForFunction(()=>document.querySelector('main').dataset.uiDensity==='comfortable');
   await page.waitForTimeout(300);
   const control = await page.locator('#settings-ui-density').evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));
   assert.ok(control.font>=14 && control.height>=44);
   await page.getByRole('button',{name:'Close settings',exact:true}).click();
   const after=await page.locator('.xiangqi-board').boundingBox(); assert.equal(after.width,before.width);
   if(width<900) await page.getByTestId('mobile-view-analysis').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.reload(); await page.waitForFunction(()=>document.querySelector('main')?.dataset.uiDensity==='comfortable');
   await page.close();
  }
  console.log('PASS: comfortable density enlarges controls, preserves board size, fits and survives reload at three widths');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
