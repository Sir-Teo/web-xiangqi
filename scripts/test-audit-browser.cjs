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
    await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([{
      id: 'audit-repetition', savedAt: 1, gameMode: 'PvP', result: 'red',
      moves: ['a0a1', 'a9a8', 'a1a0', 'a8a9', 'a0a1', 'a9a8'],
    }])));
    await page.goto(base);
    const continuation = page.getByTestId('library-continuation-a0a1');
    await continuation.waitFor();
    assert.match(await continuation.innerText(), /1 game/);
    assert.match(await continuation.innerText(), /100%/);
    await page.evaluate(() => {
      const key = 'xiangqi:library:v1';
      const games = JSON.parse(localStorage.getItem(key));
      games[0].result = 'black'; // Same id, timestamp and move count.
      localStorage.setItem(key, JSON.stringify(games));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="library-continuation-a0a1"]')?.textContent.includes('0–1–0'));
    await page.getByTestId('cloud-book-enable').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-book-card"]')?.dataset.status === 'error', { }, { timeout: 11000 });
    assert.match(await page.getByTestId('cloud-book-card').innerText(), /did not answer/);
    await page.getByTestId('cloud-book-disable').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cloud-book-card"]')?.dataset.status === 'off');
    // A failed save must be visible and preserve damaged data for recovery.
    await page.evaluate(() => {
      const key = 'xiangqi:library:v1';
      localStorage.setItem(key, '{truncated');
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
    await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
    await page.getByTestId('save-game-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="save-game-btn"]')?.textContent.includes('Save Failed'));
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), '{truncated');
    await page.screenshot({ path: '/tmp/xiangqi-audit-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '/tmp/xiangqi-audit-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: distinct-game statistics, edited-result refresh, failed-save preservation, cloud timeout, opt-out, desktop/mobile layout, no page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
