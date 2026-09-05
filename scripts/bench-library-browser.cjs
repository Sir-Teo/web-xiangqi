const { chromium } = require('playwright');
const assert = require('node:assert/strict');
// Run against an existing dev or preview server. Times are descriptive, not CI gates.
(async () => {
const browser = await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(()=>{
  localStorage.setItem('xiangqi:library:v1',JSON.stringify(Array.from({length:400},(_,i)=>({id:'bench-'+i,savedAt:i+1,gameMode:'PvP',moves:['h2e2'],label:'Study '+i}))));
  window.__dateCalls=0;
  const original=Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString=function(...args){window.__dateCalls++;return original.apply(this,args)};
 });
 await page.goto(process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/');
 await page.getByTestId('left-panel-tab-library').click();
 const input=page.getByPlaceholder('Search players, openings, moves, reviews…');
 await input.fill('zz');
 await page.waitForTimeout(150);
 await page.evaluate(()=>{window.__dateCalls=0});
 const times=[];
 for(const query of ['zzz','zzzz','zzzzz','zzzzzz']){
  const start=performance.now(); await input.fill(query); await page.locator('.lib-empty').first().waitFor(); times.push(performance.now()-start);
 }
 assert.equal(await page.evaluate(()=>window.__dateCalls), 0, 'Repeated searches should reuse formatted text');
 console.log(JSON.stringify({dateFormattingCalls:await page.evaluate(()=>window.__dateCalls),interactionMs:times}));
} finally {await browser.close()}

})().catch(error => { console.error(error); process.exitCode = 1; });
