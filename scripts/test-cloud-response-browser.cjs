const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const original = window.fetch;
          window.__cloudRequests = {}; window.__cloudCancelled = {};
          window.fetch = async (input, options) => {
            const url = new URL(typeof input === 'string' ? input : input.url || input.toString(), location.href);
            if (!url.pathname.endsWith('/chessdb.php')) return original(input, options);
            const action = url.searchParams.get('action');
            const count = window.__cloudRequests[action] = (window.__cloudRequests[action] || 0) + 1;
            if (count === 1) {
              return new Response(new ReadableStream({ start(controller) {
                controller.enqueue(new TextEncoder().encode('move:h2e2,score:1,note:'));
                for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(64 * 1024).fill(120));
                // Leave the stream open; reaching a byte limit must cancel it.
              }, cancel() { window.__cloudCancelled[action] = true; } }), { headers: { 'Content-Length': '1' } });
            }
            const text = action === 'queryall' ? 'move:h2e2,score:1,rank:0,note:炮🐎,winrate:50'
              : action === 'querypv' ? 'score:1,depth:62,pv:h2e2|h9g7' : 'move:h2e2,rule:ban';
            const bytes = new TextEncoder().encode(text);
            return new Response(new ReadableStream({ start(controller) {
              for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
              controller.close();
            } }));
          };
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base + '?moves=a0a1+a9a8+a1a0+a8a9+a0a1+a9a8+a1a0+a8a9');
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-graph').click();
        }
        await page.getByTestId('cloud-book-enable').click();
        await page.waitForFunction(() => ['queryall', 'querypv', 'queryrule'].every(action => window.__cloudCancelled[action]), null, { timeout: 3000 });
        await page.waitForFunction(() => document.querySelector('[data-testid="cloud-book-card"]')?.dataset.status === 'error'
          && document.querySelector('[data-testid="cloud-pv-status"]')?.textContent.includes('unavailable'));
        assert.ok((await page.getByTestId('repetition-cloud-rule').textContent()).includes('unavailable'));
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.getByTestId('cloud-book-card').screenshot({ path: `/tmp/xiangqi-cloud-bound-${browserType.name()}-${width}.png` });
        await page.getByTestId('cloud-book-retry').click();
        await page.getByTestId('cloud-pv-retry').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="cloud-book-card"]')?.dataset.status === 'ok');
        await page.getByTestId('cloud-pv-move-1').waitFor();
        assert.ok((await page.getByTestId('cloud-book-card').textContent()).includes('炮🐎'));
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        const rulingRetry = page.getByTestId('repetition-cloud-retry');
        await page.evaluate(async () => {
          document.documentElement.style.fontSize = '32px';
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        assert.equal(await rulingRetry.evaluate(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1), false, 'The retry label must fit with enlarged text');
        assert.ok(await rulingRetry.evaluate(node => node.getBoundingClientRect().height >= 44));
        await rulingRetry.focus(); await page.keyboard.press('Enter');
        await rulingRetry.waitFor({ state: 'hidden' });
        assert.equal(await page.getByTestId('repetition-notice').evaluate(node => node === document.activeElement), true, 'Retrying a ruling must retain keyboard focus when its button disappears');
        await page.waitForFunction(() => window.__cloudRequests.queryrule === 2);
        await page.waitForFunction(() => document.querySelector('[data-testid="repetition-cloud-rule"]')?.textContent.includes('forbidden'));
        assert.deepEqual(await page.evaluate(() => window.__cloudRequests), { queryall: 2, querypv: 2, queryrule: 2 });
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen, 'Retrying a ruling must preserve the current game');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:preferences:v1')).cloudBookEnabled), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: bounded responses, independent retries, ruling retry focus, enlarged text and unchanged game passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
