const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
   localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ cloudBookEnabled: true }));
   window.cloudRequests = []; window.testVisibility = 'visible';
   Object.defineProperty(document, 'visibilityState', { get: () => window.testVisibility });
   Object.defineProperty(document, 'hidden', { get: () => window.testVisibility === 'hidden' });
   const fetch = window.fetch;
   window.fetch = (url, options) => {
    if (!String(url).includes('chessdb.php')) return fetch(url, options);
    window.cloudRequests.push(String(url));
    return Promise.resolve(new Response('unknown'));
   };
  });
  await page.goto(base + '?moves=h2e2+h9g7+b0c2');
  await page.locator('.xiangqi-board').waitFor(); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.cloudRequests.length), 0);
  const graph = async () => { await page.getByTestId('mobile-view-analysis').click(); await page.getByTestId('mobile-analysis-tab-graph').click(); };
  await graph(); await page.waitForFunction(() => window.cloudRequests.length === 2);
  await page.getByTestId('mobile-view-board').click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox').fill('Go to start'); await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.cloudRequests.length), 2, 'Hidden cloud cards must not follow board navigation');
  await page.evaluate(() => { window.testVisibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await graph(); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.cloudRequests.length), 2, 'A background page must not query');
  await page.evaluate(() => { window.testVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.cloudRequests.length === 4);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:preferences:v1')).cloudBookEnabled), true);
  await page.close();
  console.log('PASS: cloud requests wait for visible cards and foreground page; opening the panel resumes the current position without changing preference');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
