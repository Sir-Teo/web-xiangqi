const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Run against an existing dev/preview server, keeping this focused regression
// gate usable after each small audit commit.
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/chessdb.php*', () => {}); // A connection that never answers.
    await page.goto(base);
    await page.getByTestId('cloud-book-enable').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-book-card"]')?.dataset.status === 'error', { }, { timeout: 11000 });
    assert.match(await page.getByTestId('cloud-book-card').innerText(), /did not answer/);
    await page.getByTestId('cloud-book-disable').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-book-card"]')?.dataset.status === 'off');
    await page.screenshot({ path: '/tmp/xiangqi-audit-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '/tmp/xiangqi-audit-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: cloud timeout, opt-out, desktop/mobile layout, no page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
