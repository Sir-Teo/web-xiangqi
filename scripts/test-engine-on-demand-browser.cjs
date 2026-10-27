const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const engineScript = `window.Pikafish=function(){};window.Pikafish.createWorkerEngine=async()=>{window.__engineBoots=(window.__engineBoots||0)+1;if(window.__holdEngine)await new Promise(resolve=>{window.__releaseEngine=resolve;});const ls=[];return{variant:'single-simd',terminate(){},addMessageListener:l=>ls.push(l),postMessage(c){if(c==='uci'||c==='isready')queueMicrotask(()=>ls.forEach(l=>l(c==='uci'?'uciok':'readyok')));}};};`;
async function startButtonFocus(browser) {
 for (const [width, height] of [[1440, 900], [320, 480]]) for (const size of [16, 32]) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
  try {
   let boots = 0;
   await page.addInitScript(() => { window.__holdEngine = true; });
   await page.route('**/pikafish.js', route => {
    boots++;
    return route.fulfill({ contentType: 'application/javascript', body: engineScript });
   });
   await page.goto(base + '?moves=h2e2,h9g7');
   await page.waitForFunction(() => / w - - 2 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
   await page.evaluate(async size => { document.documentElement.style.fontSize = size + 'px'; await document.fonts.ready; }, size);
   const fen = await page.locator('.bottombar-fen').getAttribute('title');
   const square = page.locator('.xiangqi-board .hitbox[data-file="8"][data-rank="0"]');
   await square.focus();
   await page.getByTestId('start-engine-analysis').focus();
   assert.equal(boots, 0, 'Focusing the start control must not download an engine');
   await page.keyboard.press(size === 16 ? 'Enter' : 'Space');
   await page.waitForFunction(() => typeof window.__releaseEngine === 'function');
   await page.waitForFunction(() => document.activeElement?.matches('.xiangqi-board .hitbox[data-file="8"][data-rank="0"]'), null, { timeout: 3000 });
   assert.equal(await square.getAttribute('tabindex'), '0');
   assert.doesNotMatch(await square.getAttribute('aria-label'), /\bselected\b/, 'Starting analysis must focus without selecting a piece');
   assert.equal(await square.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true,
    'The restored board square must be visible and reachable');
   assert.equal(boots, 1, 'Starting analysis must boot the engine once');
   assert.equal(await page.evaluate(() => window.__engineBoots), 1, 'Starting analysis must create one engine');
   assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'Starting analysis must preserve the position');
   await page.evaluate(() => window.__releaseEngine());
   await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
   assert.equal(await square.evaluate(node => node === document.activeElement), true, 'Engine readiness must retain the restored board focus');
   console.log(`PASS ${width}x${height}/${size}px: starting analysis restores the last board square without selecting or moving`);
  } finally { await page.close(); }
 }
}
(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440, 390, 320]) {
   const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
   const requests = [];
   page.on('request', request => { if (/pikafish\.js|\.nnue|\.wasm/.test(request.url())) requests.push(request.url()); });
   await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: engineScript }));
   await page.goto(base + '?moves=h2e2,h9g7');
   await page.locator('.xiangqi-board').waitFor();
   await page.waitForTimeout(800);
   assert.deepEqual(requests, [], 'Opening a study must not download an engine');
   if (width === 1440) await page.getByTestId('analysis-tab-engine').click();
   else if (width === 390) await page.keyboard.press('e');
   else {
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Engine panel'); await page.keyboard.press('Enter');
   }
   await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
   assert.equal(requests.filter(url => url.includes('pikafish.js')).length, 1);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.screenshot({ path: `/tmp/xiangqi-engine-on-demand-${width}.png` });
   await page.close();
   console.log(`PASS ${width}px: no engine download before explicit analysis, one boot afterward`);
  }
  await startButtonFocus(browser);
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
