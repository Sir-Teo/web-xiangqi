const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440, 390, 320]) {
   const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
   const requests = [];
   page.on('request', request => { if (/pikafish\.js|\.nnue|\.wasm/.test(request.url())) requests.push(request.url()); });
   await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.Pikafish=function(){};window.Pikafish.createWorkerEngine=async()=>{const ls=[];return{variant:'single-simd',terminate(){},addMessageListener:l=>ls.push(l),postMessage(c){if(c==='uci'||c==='isready')queueMicrotask(()=>ls.forEach(l=>l(c==='uci'?'uciok':'readyok')));}};};` }));
   await page.goto(base + '?moves=h2e2,h9g7');
   await page.locator('.xiangqi-board').waitFor();
   await page.waitForTimeout(800);
   assert.deepEqual(requests, [], 'Opening a study must not download an engine');
   await page.getByTestId('start-engine-analysis').click();
   await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
   assert.equal(requests.filter(url => url.includes('pikafish.js')).length, 1);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.screenshot({ path: `/tmp/xiangqi-engine-on-demand-${width}.png` });
   await page.close();
   console.log(`PASS ${width}px: no engine download before explicit analysis, one boot afterward`);
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
