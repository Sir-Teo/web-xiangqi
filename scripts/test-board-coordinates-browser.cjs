const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440,390,320]) {
   for (const notationStyle of ['uci','wxf','chinese']) for (const orientation of ['red','black']) {
    const page = await browser.newPage({viewport:{width,height:844}});
    await page.addInitScript(p=>localStorage.setItem('xiangqi:preferences:v1',JSON.stringify(p)), {notationStyle,orientation});
    await page.goto(base);
    const board = page.locator('.xiangqi-board'); await board.waitFor();
    const upper = board.locator('.coord-file-top').first(), lower = board.locator('.coord-file-bottom').first();
    const red = notationStyle==='chinese'?'九':'9';
    assert.equal(await upper.textContent(),notationStyle==='uci'?'a':orientation==='red'?'1':red);
    assert.equal(await lower.textContent(),notationStyle==='uci'?'a':orientation==='red'?red:'1');
    assert.equal(await lower.evaluate(el=>el.style.left),orientation==='red'?'0%':'100%');
    assert.equal(await board.locator('.coord-rank').count(),notationStyle==='uci'?20:0);
    assert.match(await board.locator('.hitbox[data-file="0"][data-rank="0"]').getAttribute('aria-label'),/^a0/);
    await page.close();
   }
  }
  console.log('PASS: UCI/WXF/Chinese coordinates follow both board orientations at three widths');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
