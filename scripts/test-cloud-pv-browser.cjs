const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function cloudLineFailures(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  const pending = [];
  let requests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/chessdb.php*', route => {
    if (new URL(route.request().url()).searchParams.get('action') === 'querypv') {
      requests++;
      pending.push(route);
    } else return route.fulfill({ body: 'unknown', contentType: 'text/plain' });
  });
  const reply = async body => {
    for (let i = 0; i < 200 && !pending.length; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(pending.length, 'Expected a cloud line request');
    await pending.shift().fulfill({ body, contentType: 'text/plain' });
  };
  try {
    await page.goto(base);
    if (width < 900) {
      await page.getByTestId('mobile-view-analysis').click();
      await page.getByTestId('mobile-analysis-tab-graph').click();
    }
    await page.getByTestId('cloud-book-enable').click();
    const status = page.getByTestId('cloud-pv-status');
    await status.waitFor();
    assert.match(await status.innerText(), /Loading cloud line/);
    // Exercise the actual eight-second deadline, not a simulated HTTP error.
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-pv-status"]')?.textContent.includes('unavailable'));
    await reply('score:1,depth:62,pv:c3c4'); // late answer cannot replace the error
    assert.match(await status.innerText(), /unavailable/);
    await page.getByTestId('cloud-book-disable').click();
    await status.waitFor({ state: 'detached' });
    await page.getByTestId('cloud-book-enable').click();
    await reply('invalid board');
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-pv-status"]')?.textContent.includes('unavailable'));
    // Invalid replies must not be cached as "no line".
    await page.getByTestId('cloud-book-disable').click();
    await page.getByTestId('cloud-book-enable').click();
    await reply('score:1,depth:62,pv:c3c4|b7c7');
    await page.getByTestId('cloud-pv').waitFor();
    assert.equal(requests, 3);
    assert.equal(await status.count(), 0);
    assert.equal(await page.getByTestId('cloud-pv-move-1').count(), 1);
    await page.getByTestId('cloud-pv').screenshot({ path: `/tmp/xiangqi-cloud-pv-${width}.png` });
    await page.getByTestId('cloud-pv-move-0').click();
    assert.equal(await page.getByTestId('cloud-pv').count(), 0, 'Previous position line remains visible');
    if (width < 900) {
      await page.getByTestId('mobile-view-analysis').click();
      await page.getByTestId('mobile-analysis-tab-graph').click();
    }
    await reply('unknown');
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-pv-status"]')?.textContent.includes('No cloud line'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`Cloud line timeout, retry, navigation and layout passed at ${width}px`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) await cloudLineFailures(browser, width);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
