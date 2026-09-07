const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function fullLibrary(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({ id: `game-${i}`, savedAt: i + 1, gameMode: 'PvP', moves: ['h2e2'] }))
    )));
    await page.goto(base + '?moves=h2e2');
    const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
    await page.getByTestId(width < 900 ? 'mobile-save-game-btn' : 'save-game-btn').click();
    const notice = page.getByTestId('save-game-error');
    await notice.waitFor();
    assert.match(await notice.innerText(), /full \(500 games\)/);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/xiangqi-library-full-${width}.png` });
    await notice.getByRole('button', { name: 'Open library' }).click();
    await page.getByTestId('saved-game-list').waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function fenValidation(browser) {
  const page = await browser.newPage();
  try {
    const invalid = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PPP1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
    await page.goto(base + '?fen=' + encodeURIComponent(invalid));
    await page.waitForFunction(() => document.querySelector('[data-testid="notice-announcement"]')?.textContent.trim());
    assert.equal(await page.locator('.piece').count(), 32);
    assert.match(await page.getByTestId('notice-announcement').innerText(), /position|FEN/i);
    const valid = '3k5/9/9/9/9/9/9/9/9/3RK4 b - - 47 32';
    await page.goto(base + '?fen=' + encodeURIComponent(valid));
    await page.waitForFunction(() => document.querySelectorAll('.piece').length === 3);
    assert.equal(await page.getByTestId('notice-announcement').innerText(), '');
  } finally { await page.close(); }
}

async function cloudRuleFreshness(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pending = [];
  try {
    await page.route('**/chessdb.php*', route => {
      if (new URL(route.request().url()).searchParams.get('action') === 'queryrule') pending.push(route);
      else return route.fulfill({ body: 'unknown', contentType: 'text/plain' });
    });
    const moves = 'a0a1 a9a8 a1a0 a8a9 a0a1 a9a8 a1a0 a8a9';
    await page.goto(base + '?moves=' + encodeURIComponent(moves));
    await page.getByTestId('cloud-book-enable').click();
    const ruling = page.getByTestId('repetition-cloud-rule');
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('checking'));
    const waitForRoute = async () => {
      for (let i = 0; i < 100 && pending.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(pending.length, 'Expected a cloud rule request');
      return pending.shift();
    };
    await (await waitForRoute()).fulfill({ body: 'move:a0a1,rule:ban', contentType: 'text/plain' });
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('forbidden'));
    await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
    await page.locator('.hitbox[data-file="0"][data-rank="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('checking'));
    assert.doesNotMatch(await ruling.innerText(), /forbidden/);
    await (await waitForRoute()).fulfill({ body: 'invalid movelist', contentType: 'text/plain' });
    await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('unavailable'));
    await page.screenshot({ path: '/tmp/xiangqi-cloud-rule-unavailable.png' });
    await page.getByTestId('cloud-book-disable').click();
    await ruling.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await fullLibrary(browser, 1440);
    await fullLibrary(browser, 390);
    await fenValidation(browser);
    await cloudRuleFreshness(browser);
    console.log('PASS: current cloud verdicts and failures, FEN validity, full-library save preserves all games; desktop/mobile feedback and library action');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
